#!/usr/bin/env python3
"""Read-only exploratory chronological backtest for the Odds Lens archive.

This deliberately does not import application model code.  It treats each
historical row's match datetime as ordering metadata and the supplied opening
or closing vector as a research quote.  It cannot establish a production
as-of timestamp because the archive does not contain one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from scipy.optimize import minimize


SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[1]
ROOT = PROJECT_ROOT / 'public/odds-lens'
SPORTS = {
    'baseball': ROOT / 'data/manifest.json',
    'soccer': ROOT / 'data/v2/soccer/manifest.json',
    'basketball': ROOT / 'data/v2/basketball/manifest.json',
    'volleyball': ROOT / 'data/v2/volleyball/manifest.json',
}
ALLOWED_MARKETS = {'일반', '핸디캡', '언오버'}
RESULT_SLOT = {
    '일반': {'승': 0, '무': 1, '무승부': 1, '패': 2},
    '핸디캡': {'핸디승': 0, '승': 0, '핸디무': 1, '무': 1, '무승부': 1, '핸디패': 2, '패': 2},
    '언오버': {'언더': 0, '무': 1, '무승부': 1, '오버': 2},
}
BOUNDARIES = {
    'train_before': '2024-01-01 00:00',
    'calibration_before': '2025-01-01 00:00',
    'policy_before': '2026-01-01 00:00',
    'embargo_days': 7,
}
BOOTSTRAP_REPS = 5000
SEED = 28092026


def clean_text(value):
    return re.sub(r'\s+', '', str(value or '').strip().casefold())


def parse_id(value):
    numbers = [int(x) for x in re.findall(r'\d+', str(value))]
    return tuple(numbers + [0] * (3 - len(numbers)))[:3]


def parse_date(value):
    try:
        return datetime.strptime(str(value).strip(), '%Y-%m-%d %H:%M')
    except ValueError:
        return None


def line_key(value):
    if value is None or value == '':
        return None
    try:
        return round(float(value), 8)
    except (TypeError, ValueError):
        return str(value).strip()


def load_rows():
    loaded = []
    source = {}
    for sport, manifest_path in SPORTS.items():
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        data_root = manifest.get('dataRoot')
        if not data_root:
            data_root = f"data/{manifest['snapshot']}"
        fields = manifest['fields']
        consumed_files = {
            manifest_path.relative_to(PROJECT_ROOT).as_posix(): hashlib.sha256(manifest_bytes).hexdigest(),
        }
        for year in sorted(manifest['years'], key=int):
            data_path = ROOT / data_root / f'{year}.json'
            data_bytes = data_path.read_bytes()
            consumed_files[data_path.relative_to(PROJECT_ROOT).as_posix()] = hashlib.sha256(data_bytes).hexdigest()
            packed = json.loads(data_bytes)
            for values in packed:
                row = dict(zip(fields, values))
                row['sport'] = sport
                loaded.append(row)
        content_hash = hashlib.sha256(json.dumps(
            consumed_files, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
        ).encode()).hexdigest()
        source[sport] = {
            'manifest': manifest_path.relative_to(PROJECT_ROOT).as_posix(),
            'source_url': manifest.get('sourceUrl'),
            'fetched_at': manifest.get('fetchedAt'),
            'date_range': manifest.get('dateRange'),
            'rows': manifest.get('rows'),
            'quote_timestamps_available': manifest.get('quoteTimestampsAvailable'),
            'timezone': manifest.get('timezone'),
            'sha256_manifest': hashlib.sha256(manifest_bytes).hexdigest(),
            'consumed_files': consumed_files,
            'sha256_consumed_content': content_hash,
        }
    return loaded, source


def stable_hash(value):
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False,
    ).encode()).hexdigest()


def rows_hash(rows):
    """Fingerprint the exact prepared rows consumed by one chronological partition."""
    digest = hashlib.sha256()
    for row in rows:
        record = {
            'sport': row['sport'], 'date': row['date'], 'league': row['league'],
            'home': row['home'], 'away': row['away'], 'market': row['market'],
            'line': row['line'], 'id': row['id'], 'event_key': row['event_key'],
            'market_key': row['market_key'], 'odds': row['odds'].tolist(),
            'q': row['q'].tolist(), 'y': row['y'], 'k': row['k'],
            'result_slot': row['result_slot'], 'slots': row['slots'],
        }
        digest.update(json.dumps(
            record, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False,
        ).encode())
        digest.update(b'\n')
    return digest.hexdigest()


def prepare(raw_rows, stage):
    audit = Counter()
    candidates = []
    for row in raw_rows:
        audit['raw'] += 1
        if row.get('market') not in ALLOWED_MARKETS:
            audit['excluded_market'] += 1
            continue
        if (
            row['sport'] == 'soccer' and row.get('league') == 'NPB'
            or row['sport'] == 'basketball' and row.get('league') == '축월드컵'
        ):
            audit['sport_league_mismatch'] += 1
            continue
        if not clean_text(row.get('home')) or not clean_text(row.get('away')):
            audit['missing_team'] += 1
            continue
        if re.search(r'미정|승자|패자', f"{row.get('home', '')} {row.get('away', '')}"):
            audit['placeholder_team'] += 1
            continue
        dt = parse_date(row.get('date'))
        if dt is None:
            audit['bad_date'] += 1
            continue
        vector = row.get(stage)
        if not isinstance(vector, list) or len(vector) < 3:
            audit['missing_odds_vector'] += 1
            continue
        valid = [i for i, value in enumerate(vector[:3]) if isinstance(value, (int, float)) and math.isfinite(value) and value > 1]
        if valid == [0, 2]:
            slots = [0, 2]
        elif valid == [0, 1, 2]:
            slots = [0, 1, 2]
        else:
            audit['incomplete_odds_vector'] += 1
            continue
        result_slot = RESULT_SLOT.get(row['market'], {}).get(str(row.get('result') or '').strip())
        if result_slot not in slots:
            audit['unresolved_result'] += 1
            continue
        odds = np.asarray([float(vector[i]) for i in slots], dtype=float)
        inverse = 1.0 / odds
        q = inverse / inverse.sum()
        y = slots.index(result_slot)
        event_key = '|'.join([
            row['sport'], row['date'], clean_text(row.get('league')),
            clean_text(row.get('home')), clean_text(row.get('away')),
        ])
        market_key = '|'.join([row['market'], str(line_key(row.get('line')) if row['market'] != '일반' else None)])
        candidates.append({
            'sport': row['sport'], 'date': row['date'], 'dt': dt,
            'week': (dt - timedelta(days=dt.weekday())).date().isoformat(),
            'league': str(row.get('league') or '').strip(),
            'home': str(row.get('home') or '').strip(), 'away': str(row.get('away') or '').strip(),
            'market': row['market'], 'line': line_key(row.get('line')),
            'id': row.get('id'), 'id_order': parse_id(row.get('id')),
            'event_key': event_key, 'market_key': market_key,
            'odds': odds, 'q': q, 'y': y, 'k': len(slots),
            'result_slot': result_slot, 'slots': slots,
        })

    grouped = defaultdict(list)
    for row in candidates:
        grouped[(row['event_key'], row['market_key'])].append(row)

    selected = []
    duplicate_groups = 0
    duplicate_rows = 0
    conflicting_labels = 0
    conflicting_vectors = 0
    for group in grouped.values():
        if len(group) > 1:
            duplicate_groups += 1
            duplicate_rows += len(group) - 1
            if len({(r['k'], r['y']) for r in group}) > 1:
                conflicting_labels += 1
                continue
            if len({tuple(np.round(r['odds'], 8)) for r in group}) > 1:
                conflicting_vectors += 1
        # Highest year/round/item id is a deterministic proxy for the later
        # sale listing.  Its true publication time is absent from the archive.
        selected.append(max(group, key=lambda r: (r['id_order'], str(r['id']))))

    selected.sort(key=lambda r: (r['dt'], r['event_key'], r['market_key']))
    audit.update({
        'candidate_rows': len(candidates),
        'canonical_event_market_groups': len(grouped),
        'duplicate_groups': duplicate_groups,
        'duplicate_rows_removed': duplicate_rows,
        'conflicting_label_groups_quarantined': conflicting_labels,
        'duplicate_groups_with_different_odds': conflicting_vectors,
        'analysis_rows': len(selected),
        'unique_events': len({r['event_key'] for r in selected}),
    })
    return selected, dict(audit)


def split(rows):
    train_end = parse_date(BOUNDARIES['train_before'])
    calibration_end = parse_date(BOUNDARIES['calibration_before'])
    policy_end = parse_date(BOUNDARIES['policy_before'])
    embargo = timedelta(days=BOUNDARIES['embargo_days'])
    return {
        'train': [r for r in rows if r['dt'] < train_end - embargo],
        'calibration': [r for r in rows if train_end + embargo <= r['dt'] < calibration_end - embargo],
        'policy': [r for r in rows if calibration_end + embargo <= r['dt'] < policy_end - embargo],
        'test': [r for r in rows if r['dt'] >= policy_end + embargo],
        'embargo': [r for r in rows if not (
            r['dt'] < train_end - embargo
            or train_end + embargo <= r['dt'] < calibration_end - embargo
            or calibration_end + embargo <= r['dt'] < policy_end - embargo
            or r['dt'] >= policy_end + embargo
        )],
    }


def fit_group(rows, ridge=0.02):
    k = rows[0]['k']
    q = np.stack([r['q'] for r in rows])
    y = np.asarray([r['y'] for r in rows], dtype=int)

    def unpack(x):
        alpha = math.exp(float(x[0]))
        bias = np.r_[x[1:], 0.0]
        return alpha, bias

    def objective(x):
        alpha, bias = unpack(x)
        logits = alpha * np.log(q) + bias
        logits -= logits.max(axis=1, keepdims=True)
        prob = np.exp(logits)
        prob /= prob.sum(axis=1, keepdims=True)
        loss = -np.log(np.clip(prob[np.arange(len(y)), y], 1e-15, 1)).mean()
        return float(loss + ridge * (x[0] ** 2 + np.square(x[1:]).sum()))

    result = minimize(objective, np.zeros(k), method='L-BFGS-B', bounds=[(-2.0, 2.0)] + [(-2.0, 2.0)] * (k - 1))
    alpha, bias = unpack(result.x)
    return {
        'alpha': alpha, 'bias': bias.tolist(), 'success': bool(result.success),
        'iterations': int(result.nit), 'training_rows': len(rows), 'ridge': ridge,
    }


def fit_models(train):
    grouped = defaultdict(list)
    for row in train:
        grouped[(row['sport'], row['market'], row['k'])].append(row)
    models = {}
    for key, rows in grouped.items():
        if len(rows) < 200:
            continue
        models[key] = fit_group(rows)
    return models


def calibrate_models(rows, models):
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row['sport'], row['market'], row['k'])].append(row)
    for key, model in models.items():
        samples = grouped.get(key, [])
        if not samples:
            model['temperature'] = 1.0
            model['calibration_rows'] = 0
            continue

        def objective(x):
            temperature = math.exp(float(x[0]))
            losses = []
            for row in samples:
                logits = model['alpha'] * np.log(row['q']) + np.asarray(model['bias'])
                logits = logits / temperature
                logits -= logits.max()
                probability = np.exp(logits)
                probability /= probability.sum()
                losses.append(-math.log(max(1e-15, float(probability[row['y']]))))
            return float(np.mean(losses))

        result = minimize(objective, np.zeros(1), method='L-BFGS-B', bounds=[(-0.7, 0.7)])
        model['temperature'] = math.exp(float(result.x[0]))
        model['calibration_rows'] = len(samples)
        model['calibration_success'] = bool(result.success)
    return models


def m1_probability(row, models):
    model = models.get((row['sport'], row['market'], row['k']))
    if model is None:
        return row['q']
    logits = model['alpha'] * np.log(row['q']) + np.asarray(model['bias'])
    logits /= model.get('temperature', 1.0)
    logits -= logits.max()
    prob = np.exp(logits)
    return prob / prob.sum()


def with_probabilities(rows, models):
    result = []
    for row in rows:
        result.append({**row, 'm0': row['q'], 'm1': m1_probability(row, models)})
    return result


def metric(rows, key):
    if not rows:
        return {'n': 0, 'events': 0, 'weeks': 0, 'log_loss': None, 'brier': None}
    losses = []
    briers = []
    for row in rows:
        p = row[key]
        losses.append(-math.log(max(1e-15, float(p[row['y']]))))
        target = np.zeros(row['k'])
        target[row['y']] = 1
        briers.append(float(np.square(p - target).sum()))
    return {
        'n': len(rows), 'events': len({r['event_key'] for r in rows}),
        'weeks': len({r['week'] for r in rows}),
        'log_loss': float(np.mean(losses)), 'brier': float(np.mean(briers)),
    }


def percentile(values, p):
    if not values:
        return None
    values = sorted(values)
    index = min(len(values) - 1, max(0, int(math.floor(p * len(values)))))
    return float(values[index])


def weekly_bootstrap(rows, value, reps=BOOTSTRAP_REPS):
    groups = defaultdict(list)
    for row in rows:
        groups[row['week']].append(float(value(row)))
    blocks = list(groups.values())
    if len(blocks) < 16:
        return {'blocks': len(blocks), 'lower': None, 'upper': None, 'reason': 'INSUFFICIENT_WEEKS'}
    rng = random.Random(SEED)
    draws = []
    for _ in range(reps):
        chosen = [blocks[rng.randrange(len(blocks))] for _ in blocks]
        flat = [x for block in chosen for x in block]
        draws.append(sum(flat) / len(flat))
    return {
        'blocks': len(blocks), 'lower': percentile(draws, .025),
        'upper': percentile(draws, .975), 'replicates': reps,
        'method': 'weekly block bootstrap; rows within a calendar week resampled together',
    }


def compare(rows):
    m0 = metric(rows, 'm0')
    m1 = metric(rows, 'm1')
    deltas = []
    for row in rows:
        y = row['y']
        row['ll_delta'] = -math.log(max(1e-15, row['m0'][y])) + math.log(max(1e-15, row['m1'][y]))
        deltas.append(row['ll_delta'])
    interval = weekly_bootstrap(rows, lambda r: r['ll_delta'])
    return {'M0': m0, 'M1': m1, 'M0_minus_M1_log_loss': float(np.mean(deltas)) if deltas else None, 'delta_interval': interval}


def calibration_bins(rows, key, width=.1):
    values = []
    for row in rows:
        for idx, p in enumerate(row[key]):
            values.append((float(p), int(idx == row['y'])))
    bins = []
    for lower in np.arange(0, 1, width):
        upper = min(1.0, lower + width)
        bucket = [x for x in values if lower <= x[0] < upper or upper == 1 and x[0] == 1]
        if bucket:
            bins.append({
                'lower': round(float(lower), 3), 'upper': round(float(upper), 3),
                'n': len(bucket), 'predicted': float(np.mean([x[0] for x in bucket])),
                'observed': float(np.mean([x[1] for x in bucket])),
            })
    return bins


def event_best_rows(rows, key):
    best = {}
    for row in rows:
        probability = float(max(row[key]))
        prior = best.get(row['event_key'])
        rank = (probability, str(row['market_key']))
        if prior is None or rank > prior[0]:
            best[row['event_key']] = (rank, row)
    return [item[1] for item in best.values()]


def paired_weekly_bootstrap(selected, eligible, reps=BOOTSTRAP_REPS):
    selected_by_week = defaultdict(list)
    eligible_by_week = defaultdict(list)
    for row in selected:
        selected_by_week[row['week']].append(row)
    for row in eligible:
        eligible_by_week[row['week']].append(row)
    weeks = sorted(eligible_by_week)
    if len(selected_by_week) < 16:
        return {'blocks': len(selected_by_week), 'lower': None, 'upper': None, 'reason': 'INSUFFICIENT_WEEKS'}
    rng = random.Random(SEED + 17)
    draws = []
    for _ in range(reps):
        sampled = [weeks[rng.randrange(len(weeks))] for _ in weeks]
        chosen = [row for week in sampled for row in selected_by_week.get(week, [])]
        baseline = [row for week in sampled for row in eligible_by_week[week]]
        if chosen and baseline:
            draws.append(
                float(np.mean([row['hit'] for row in chosen]))
                - float(np.mean([row['hit'] for row in baseline]))
            )
    return {
        'blocks': len(selected_by_week), 'lower': percentile(draws, .025),
        'upper': percentile(draws, .975), 'replicates': reps,
        'method': 'paired calendar-week bootstrap; one best market/outcome per event',
    }


def selection(rows, key, threshold, policy, tier):
    eligible = []
    for row in event_best_rows(rows, key):
        idx = int(np.argmax(row[key]))
        eligible.append({
            **row, 'pick_probability': float(row[key][idx]),
            'hit': int(idx == row['y']), 'pick_odds': float(row['odds'][idx]),
        })
    chosen = []
    odds_floor = policy.get('odds_floor')
    for row in eligible:
        if row['pick_probability'] < threshold:
            continue
        if odds_floor is not None and row['pick_odds'] < float(odds_floor):
            continue
        chosen.append(row)
    if not chosen:
        return {
            'tier': tier['id'], 'tier_label': tier['label'], 'threshold': threshold, 'n': 0, 'events': 0, 'weeks': 0,
            'hit_rate': None, 'mean_probability': None, 'mean_odds': None,
            'coverage': 0.0, 'interval': {'lower': None, 'upper': None, 'blocks': 0, 'reason': 'NO_SELECTIONS'},
            'passes': False,
        }
    hit_rate = float(np.mean([r['hit'] for r in chosen]))
    predicted = float(np.mean([r['pick_probability'] for r in chosen]))
    interval = weekly_bootstrap(chosen, lambda r: r['hit'])
    calibration_interval = weekly_bootstrap(chosen, lambda r: r['hit'] - r['pick_probability'])
    uplift_interval = paired_weekly_bootstrap(chosen, eligible)
    half_width = None if interval['lower'] is None else (interval['upper'] - interval['lower']) / 2
    coverage = len(chosen) / max(1, len(eligible))
    baseline_hit_rate = float(np.mean([row['hit'] for row in eligible]))
    # The label is an accuracy tier, so a positive uplift alone is not enough.
    # Require an absolute lower confidence bound per tier and rule out material
    # over-confidence using the lower bound of (observed - predicted).
    passes = (
        interval['lower'] is not None
        and half_width <= policy['maximum_interval_half_width']
        and interval['lower'] >= tier['minimum_hit_rate_lower_bound']
        and calibration_interval['lower'] is not None
        and calibration_interval['lower'] >= -policy['maximum_overconfidence']
        and len(chosen) >= policy['minimum_events']
        and len({r['week'] for r in chosen}) >= policy['minimum_weeks']
        and coverage >= tier['minimum_replay_coverage']
        and uplift_interval['lower'] is not None
        and uplift_interval['lower'] > 0
    )
    return {
        'tier': tier['id'], 'tier_label': tier['label'], 'threshold': threshold, 'n': len(chosen),
        'events': len(chosen),
        'weeks': len({r['week'] for r in chosen}),
        'hits': int(sum(r['hit'] for r in chosen)), 'hit_rate': hit_rate,
        'mean_probability': predicted, 'mean_odds': float(np.mean([r['pick_odds'] for r in chosen])),
        'coverage': coverage, 'eligible_events': len(eligible),
        'interval': interval, 'interval_half_width': half_width,
        'minimum_hit_rate_lower_bound': tier['minimum_hit_rate_lower_bound'],
        'calibration_error': abs(hit_rate - predicted), 'calibration_residual': hit_rate - predicted,
        'calibration_residual_interval': calibration_interval,
        'baseline_hit_rate': baseline_hit_rate, 'uplift': hit_rate - baseline_hit_rate,
        'uplift_interval': uplift_interval, 'passes': bool(passes),
    }


def evaluate_stage(rows, models):
    rows = with_probabilities(rows, models)
    report = {'overall': compare(rows), 'sports': {}, 'markets': {}}
    report['overall']['M1_calibration'] = calibration_bins(rows, 'm1')
    for sport in sorted({r['sport'] for r in rows}):
        subset = [r for r in rows if r['sport'] == sport]
        report['sports'][sport] = compare(subset)
        report['sports'][sport]['M1_calibration'] = calibration_bins(subset, 'm1')
    for key in sorted({(r['sport'], r['market'], r['k']) for r in rows}):
        subset = [r for r in rows if (r['sport'], r['market'], r['k']) == key]
        report['markets']['|'.join(map(str, key))] = compare(subset)
    return rows, report


def run_stage(raw_rows, source, odds_stage, selection_policy):
    prepared, audit = prepare(raw_rows, odds_stage)
    splits = split(prepared)
    models = calibrate_models(splits['calibration'], fit_models(splits['train']))
    policy_rows, policy_metrics = evaluate_stage(splits['policy'], models)
    test_rows, test_metrics = evaluate_stage(splits['test'], models)

    policies = {}
    for sport in sorted(SPORTS):
        val = [r for r in policy_rows if r['sport'] == sport]
        tst = [r for r in test_rows if r['sport'] == sport]
        validation_trials = []
        replay_trials = []
        val_best = event_best_rows(val, 'm1')
        val_probabilities = [float(max(row['m1'])) for row in val_best]
        for tier in selection_policy['tiers']:
            threshold = float(np.quantile(val_probabilities, tier['quantile'])) if val_probabilities else None
            if threshold is None:
                continue
            validation_trials.append(selection(val, 'm1', threshold, selection_policy, tier))
            replay_trials.append(selection(tst, 'm1', threshold, selection_policy, tier))
        test_delta = test_metrics['sports'][sport]['M0_minus_M1_log_loss']
        test_interval = test_metrics['sports'][sport]['delta_interval']
        model_validated = bool(test_delta > 0 and test_interval['lower'] is not None and test_interval['lower'] > 0)
        operating = 'M1' if model_validated else 'M0'
        tier_reports = []
        for validation, replay in zip(validation_trials, replay_trials):
            # The tier definition is selected on C only. Whether the underlying
            # M1 is publishable remains a separate D-based model decision.
            selected_on_2025 = bool(validation['passes'])
            reproduced = bool(selected_on_2025 and replay['passes'])
            tier_reports.append({
                'id': validation['tier'], 'label': validation['tier_label'],
                'quantile': next(tier['quantile'] for tier in selection_policy['tiers'] if tier['id'] == validation['tier']),
                'threshold': validation['threshold'], 'policy_2025': validation,
                'selected_on_2025': selected_on_2025,
                'replay_2026': replay, 'historically_reproduced': reproduced,
            })
        # Publication eligibility is decided from C only. D is reported as a
        # replay and never selects, removes or changes a tier.
        display_tiers = [tier for tier in tier_reports if tier['selected_on_2025']]
        chosen_tier = display_tiers[0] if display_tiers else None
        historically_reproduced = bool(display_tiers and all(tier['historically_reproduced'] for tier in display_tiers))
        policies[sport] = {
            'operating_model_after_2026_test': operating,
            'model_choice_rule': 'M1 only if the frozen model improves M0 and the weekly-bootstrap 95% interval is entirely above zero on the 2026 independent test',
            'model_validated': model_validated,
            'classification_unit': 'one highest-M1-probability market/outcome per actual event',
            'tier_reports': tier_reports,
            'display_tiers': display_tiers,
            'chosen_before_2026_test': chosen_tier['policy_2025'] if chosen_tier else None,
            'independent_test_2026': chosen_tier['replay_2026'] if chosen_tier else None,
            'historically_reproduced_high_confidence_policy': historically_reproduced,
            'validated_high_probability_policy': False,
            'independent_validation_passed': False,
            'validation_kind': 'retrospective-redesign-replay',
        }

    model_serialized = {
        '|'.join(map(str, key)): value for key, value in sorted(models.items())
    }
    return {
        'odds_stage': odds_stage,
        'audit': audit,
        'splits': {
            name: {
                'rows': len(values), 'events': len({r['event_key'] for r in values}),
                'weeks': len({r['week'] for r in values}),
                'range': [values[0]['date'], values[-1]['date']] if values else [None, None],
                'sha256_prepared_rows': rows_hash(values),
            }
            for name, values in splits.items()
        },
        'model': {
            'type': 'per-sport/market/outcome-count power calibration with outcome intercepts',
            'formula': 'softmax((alpha * log(M0) + outcome_bias) / temperature), alpha > 0; fixed ridge=0.02',
            'fitted_on': 'dates before 2023-12-25; temperature calibration on 2024-01-08 through 2024-12-24; 7-day embargo on both sides of each boundary',
            'groups': model_serialized,
        },
        'policy_evaluation_2025': policy_metrics,
        'independent_test_2026': test_metrics,
        'high_probability_policies': policies,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(PROJECT_ROOT / 'reports/historical-backtest.json'))
    args = parser.parse_args()
    output = Path(args.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    raw_rows, source = load_rows()
    selection_policy = {
        'name': 'event-best-quantile-confidence-v1',
        'classification_unit': 'one highest-M1-probability market/outcome per actual event',
        'tie_break': 'highest probability, then deterministic market identity; first outcome index on probability ties',
        'tiers': [
            {
                'id': 'top', 'label': '상위 10% · 최상위 신뢰', 'quantile': .90,
                'minimum_replay_coverage': .05, 'minimum_hit_rate_lower_bound': .80,
            },
            {
                'id': 'high', 'label': '상위 20% · 고신뢰 관찰', 'quantile': .80,
                'minimum_replay_coverage': .10, 'minimum_hit_rate_lower_bound': .75,
            },
        ],
        'odds_floor': None,
        'minimum_events': 100,
        'minimum_weeks': 26,
        'maximum_interval_half_width': .05,
        'maximum_overconfidence': .05,
        'choice_rule': 'co-primary 90th/80th percentile event-best M1 cutoffs are selected only on C; D only replays the frozen cutoffs and cannot change publication eligibility',
        'publication_tier': 'retrospective-research',
        'redesigned_after_final_test_review': True,
    }
    report = {
        'analysis': 'read-only retrospective chronological exploration',
        'created_at': datetime.now().astimezone().isoformat(),
        'source': source,
        'boundaries': BOUNDARIES,
        'deduplication': {
            'event': 'sport + source datetime string + league + normalized home + normalized away',
            'market': 'market + signed line; one row per canonical event-market',
            'duplicate_choice': 'highest numeric year/round/item id; conflicting outcome labels quarantined',
        },
        'bootstrap': {'replicates': BOOTSTRAP_REPS, 'seed': SEED, 'block': 'calendar week'},
        'selection_policy': selection_policy,
        'stages': {},
        'limitations': [
            'No true odds observation/publish timestamps; match time orders rows but does not prove either quote existed at a fixed forecast horizon.',
            'No result-known timestamp; using later calendar periods prevents temporal model leakage at row level but cannot prove label availability dates.',
            'Source timezone is unspecified; timestamps are used verbatim, so week boundaries can be shifted.',
            'Settlement rules and result labels are not independently verified; handicap/total scores are transformed in some rows and cannot reconstruct settlement safely.',
            'Canonical event identity is inferred from datetime/league/team strings and is not a provider event ID.',
            'Highest round/item id is only a deterministic duplicate resolution proxy; true sale publication order is unavailable.',
            'Closing odds may be unavailable at the app current-quote decision time; opening and closing stages are evaluated separately for sensitivity.',
            'The high-confidence tiers were redesigned after the original 2026 test was reviewed; 2026 is retrospective replay evidence, not a new independent holdout.',
            'A seven-day embargo on both sides of every year boundary reduces label-boundary leakage because result-known timestamps are absent.',
        ],
    }
    for stage in ['opening', 'closing']:
        report['stages'][stage] = run_stage(raw_rows, source, stage, selection_policy)
    preprocessing_protocol = {
        'version': 'historical-archive-preparation-v2',
        'analysis_code_sha256': hashlib.sha256(SCRIPT_PATH.read_bytes()).hexdigest(),
        'allowed_markets': sorted(ALLOWED_MARKETS),
        'result_slot_mapping': RESULT_SLOT,
        'odds_vector_rule': 'three stored slots; retain [0,2] or [0,1,2], finite decimal odds > 1',
        'quarantine': ['soccer league NPB', 'basketball league 축월드컵'],
        'placeholder_team_pattern': '미정|승자|패자',
        'event_identity': 'sport + source datetime string + league + normalized home + normalized away',
        'market_identity': 'market + signed line; general line is null',
        'duplicate_choice': 'highest numeric year/round/item id; conflicting outcome labels quarantined',
        'stages': ['opening', 'closing'],
        'boundaries': BOUNDARIES,
    }
    data_fingerprint = {
        'consumed_input_content': {
            sport: {
                'sha256': value['sha256_consumed_content'],
                'files': value['consumed_files'],
            }
            for sport, value in sorted(source.items())
        },
        'preprocessing': preprocessing_protocol,
    }
    report['data_version'] = stable_hash(data_fingerprint)

    closing = report['stages']['closing']
    model_protocol = {
        'version': 'historical-power-calibration-v1',
        'quote_stage': 'closing',
        'scope_groups': sorted(closing['model']['groups']),
        'formula': closing['model']['formula'],
        'fit': 'L-BFGS-B; fixed ridge=0.02; alpha=exp(parameter); outcome bias reference=last slot',
        'calibration': 'one joint temperature per sport/market/outcome-count on B; exp(parameter) bounded exp(-0.7)..exp(0.7)',
        'train_partition': closing['splits']['train'],
        'calibration_partition': closing['splits']['calibration'],
        'preprocessing_code_sha256': preprocessing_protocol['analysis_code_sha256'],
    }
    frozen_model_artifact = {
        'protocol': model_protocol,
        'groups': closing['model']['groups'],
    }
    model_hash = stable_hash(frozen_model_artifact)
    report['model_version'] = f'historical-m1-{model_hash}'
    approved_sports = [
        sport for sport in sorted(SPORTS)
        if closing['high_probability_policies'][sport]['model_validated']
    ]
    display_policy_sports = [
        sport for sport in approved_sports
        if closing['high_probability_policies'][sport]['display_tiers']
    ]
    policy_artifact = {
        'model_version': report['model_version'],
        'quote_stage': 'closing',
        'policy_partition_sha256': closing['splits']['policy']['sha256_prepared_rows'],
        'selection_policy': selection_policy,
        'display_sports': {
            sport: {
                'classification_unit': closing['high_probability_policies'][sport]['classification_unit'],
                'tiers': [
                    {
                        'id': tier['id'], 'label': tier['label'],
                        'quantile': tier['quantile'], 'threshold': tier['threshold'],
                    }
                    for tier in closing['high_probability_policies'][sport]['display_tiers']
                ],
            }
            for sport in display_policy_sports
        },
    }
    report['policy_version'] = (
        f"historical-confidence-{stable_hash(policy_artifact)}" if display_policy_sports else None
    )
    if display_policy_sports:
        deployment_reason = (
            f"Closing-quote M1 independently validated for: {', '.join(approved_sports)}. "
            f"C-selected event-best confidence tiers are enabled for retrospective research display in: "
            f"{', '.join(display_policy_sports)}. D is replay evidence, not a fresh independent policy test."
        )
    elif approved_sports:
        deployment_reason = (
            f"Closing-quote M1 approved for: {', '.join(approved_sports)}. "
            'No event-best confidence tier passed the C-only publication requirements.'
        )
    else:
        deployment_reason = 'No closing-quote M1 beat M0 on the frozen D test.'
    deployment = {
        'model_trained': True,
        'independent_validation_finished': True,
        'quote_stage': 'closing',
        'approved_sports': approved_sports,
        'model_independent_validation_finished': True,
        'high_probability_policy_approved': False,
        'high_confidence_display_enabled': bool(display_policy_sports),
        'high_confidence_display_sports': display_policy_sports,
        'high_confidence_validation_kind': 'retrospective-redesign-replay',
        'policy_independent_validation_finished': False,
        'reason': deployment_reason,
    }
    evaluation_protocol = {
        'version': 'historical-chronological-evaluation-v2',
        'primary_quote_stage': 'closing',
        'boundaries': BOUNDARIES,
        'bootstrap': report['bootstrap'],
        'model_choice': 'M1 only if M0-minus-M1 Log loss is positive and its weekly-bootstrap 95% interval lower bound is above zero on D',
        'high_probability_policy': {
            **selection_policy,
            'chosen_on': 'C', 'replayed_on': 'D',
            'validation_kind': 'retrospective-redesign-replay',
        },
    }
    evaluation_fingerprint = {
        'model_version': report['model_version'],
        'data_version': report['data_version'],
        'protocol': evaluation_protocol,
        'independent_test_D': closing['independent_test_2026'],
        'policy_and_model_decisions': closing['high_probability_policies'],
        'deployment': deployment,
    }
    evaluation_hash = stable_hash(evaluation_fingerprint)
    report['evaluation_id'] = f'historical-eval-{evaluation_hash}'
    report['provenance'] = {
        'data_fingerprint': data_fingerprint,
        'model_fingerprint': frozen_model_artifact,
        'evaluation_fingerprint': evaluation_fingerprint,
    }
    # Re-running an unchanged source must reproduce the same immutable
    # evaluation payload instead of reusing its id with a new timestamp.
    if output.exists():
        try:
            previous = json.loads(output.read_text())
            if previous.get('evaluation_id') == report['evaluation_id'] and previous.get('created_at'):
                report['created_at'] = previous['created_at']
        except (OSError, ValueError, TypeError):
            pass
    report['deployment'] = deployment
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    summary = {
        'output': str(output),
        'opening': {
            sport: {
                'chosen_model': value['operating_model_after_2026_test'],
                'policy': value['chosen_before_2026_test'],
                'test': value['independent_test_2026'],
                'selected_on_2025': bool(value['display_tiers']),
                'historically_reproduced': value['historically_reproduced_high_confidence_policy'],
                'independently_validated': value['validated_high_probability_policy'],
            }
            for sport, value in report['stages']['opening']['high_probability_policies'].items()
        },
        'closing': {
            sport: {
                'chosen_model': value['operating_model_after_2026_test'],
                'policy': value['chosen_before_2026_test'],
                'test': value['independent_test_2026'],
                'selected_on_2025': bool(value['display_tiers']),
                'historically_reproduced': value['historically_reproduced_high_confidence_policy'],
                'independently_validated': value['validated_high_probability_policy'],
            }
            for sport, value in report['stages']['closing']['high_probability_policies'].items()
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
