#!/usr/bin/env python3
"""Exploratory test of whether a same-price result sequence adds information.

The archive has game start times, but no odds-observation or result-known
timestamps. This is a chronological *retrospective replay*, not proof of a
prospectively available signal. No application model or policy is changed.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from bisect import bisect_right
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
BASE = Path(__file__).with_name('historical-backtest.py')
DEFAULT_OUTPUT = ROOT / 'reports/pattern-sequence-backtest.json'
SPEC = importlib.util.spec_from_file_location('historical_backtest', BASE)
bt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bt)

STATIC_MIN = 100
STATIC_SHRINK = 300.0
TRANSITION_MIN = 50
TRANSITION_SHRINK = 150.0
MAX_ADJUSTMENT = 0.08
RESULT_LAG_DAYS = 2
BOOTSTRAP_REPS = 1000


def price_key(row, slot, mode):
    cents = int(round(float(row['odds'][slot]) * 100))
    price = cents if mode == 'exact_0.01' else (cents // 5) * 5
    # Total and handicap observations at different lines are different bets.
    line = row['line'] if row['market'] != '일반' else None
    return (row['sport'], row['market'], row['k'], line, slot, price)


def normalize(values):
    values = np.clip(np.asarray(values, dtype=float), .01, .99)
    return values / values.sum()


def adjustment(residual, count, minimum, shrink):
    if count < minimum:
        return 0.0
    return max(-MAX_ADJUSTMENT, min(MAX_ADJUSTMENT, residual / (count + shrink)))


def add_preceding_results(rows, mode):
    """Attach the last eligible same-price hit/miss, never a current result.

    A 48-hour gap avoids using same-day results whose completion times are
    unknown. It is only an approximation: settlement timestamps are absent.
    """
    history = defaultdict(lambda: ([], []))
    for row in rows:
        cutoff = row['dt'] - timedelta(days=RESULT_LAG_DAYS)
        previous = []
        for slot in range(row['k']):
            dates, hits = history[price_key(row, slot, mode)]
            index = bisect_right(dates, cutoff) - 1
            previous.append(hits[index] if index >= 0 else None)
        row['_previous_hit'] = previous
        for slot in range(row['k']):
            dates, hits = history[price_key(row, slot, mode)]
            dates.append(row['dt'])
            hits.append(int(row['y'] == slot))


def fit_static(train, mode):
    stats = defaultdict(lambda: [0, 0.0])
    for row in train:
        for slot in range(row['k']):
            cell = stats[price_key(row, slot, mode)]
            cell[0] += 1
            cell[1] += int(row['y'] == slot) - float(row['m1'][slot])
    return dict(stats)


def static_probability(row, mode, stats):
    values = row['m1'].copy()
    for slot in range(row['k']):
        count, residual = stats.get(price_key(row, slot, mode), (0, 0.0))
        values[slot] += adjustment(residual, count, STATIC_MIN, STATIC_SHRINK)
    return normalize(values)


def fit_transition(train, mode, static):
    stats = defaultdict(lambda: [0, 0.0])
    for row in train:
        reference = static_probability(row, mode, static)
        for slot, previous in enumerate(row['_previous_hit']):
            if previous is None:
                continue
            cell = stats[(price_key(row, slot, mode), previous)]
            cell[0] += 1
            cell[1] += int(row['y'] == slot) - float(reference[slot])
    return dict(stats)


def transition_probability(row, mode, static_prob, stats):
    values = static_prob.copy()
    affected = False
    for slot, previous in enumerate(row['_previous_hit']):
        if previous is None:
            continue
        count, residual = stats.get((price_key(row, slot, mode), previous), (0, 0.0))
        if count >= TRANSITION_MIN:
            affected = True
        values[slot] += adjustment(residual, count, TRANSITION_MIN, TRANSITION_SHRINK)
    return normalize(values), affected


def metrics(rows, mode, static, transition):
    scored = []
    for row in rows:
        reference = static_probability(row, mode, static)
        sequence, affected = transition_probability(row, mode, reference, transition)
        scored.append({**row, 'static': reference, 'sequence': sequence, 'affected': affected})
    result = {}
    for sport in sorted(bt.SPORTS):
        subset = [row for row in scored if row['sport'] == sport]
        affected = [row for row in subset if row['affected']]
        deltas = [
            -math.log(max(1e-15, float(row['sequence'][row['y']])))
            + math.log(max(1e-15, float(row['static'][row['y']])))
            for row in subset
        ]
        for row, delta in zip(subset, deltas):
            row['_sequence_minus_static_log_loss'] = delta
        result[sport] = {
            'all': {
                'n': len(subset),
                'uniqueEvents': len({row['event_key'] for row in subset}),
                'm1': bt.metric(subset, 'm1'),
                'staticPrice': bt.metric(subset, 'static'),
                'firstOrderSequence': bt.metric(subset, 'sequence'),
                'sequenceMinusStaticLogLoss': float(np.mean(deltas)) if deltas else None,
                'sequenceMinusStaticInterval': bt.weekly_bootstrap(
                    subset, lambda row: row['_sequence_minus_static_log_loss'],
                    reps=BOOTSTRAP_REPS,
                ),
            },
            'affected': {
                'n': len(affected),
                'uniqueEvents': len({row['event_key'] for row in affected}),
                'fractionOfMarkets': len(affected) / len(subset) if subset else 0.0,
                'staticPriceLogLoss': bt.metric(affected, 'static')['log_loss'] if affected else None,
                'firstOrderSequenceLogLoss': bt.metric(affected, 'sequence')['log_loss'] if affected else None,
            },
        }
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    raw, sources = bt.load_rows()
    rows, audit = bt.prepare(raw, 'closing')
    splits = bt.split(rows)
    models = bt.calibrate_models(splits['calibration'], bt.fit_models(splits['train']))
    for row in rows:
        row['m1'] = bt.m1_probability(row, models)

    report = {
        'kind': 'exploratory-retrospective-sequence-replay',
        'question': 'Does the previous settled outcome at the same domestic price improve prediction beyond M1 and a static same-price correction?',
        'quoteStage': 'closing',
        'source': sources,
        'audit': audit,
        'split': {
            'training': 'before 2023-12-25',
            'm1Calibration': '2024-01-08 through 2024-12-24',
            'policyReplay': '2025-01-08 through 2025-12-24',
            'laterReplay': '2026-01-08 through archive maximum',
            'embargo': '7 days on each side of year boundaries',
            'marketRows': {name: len(items) for name, items in splits.items()},
        },
        'method': {
            'marketIdentity': 'sport + market + outcome count + exact line + outcome slot + selected domestic odds',
            'static': f'M1 residual per price bucket; minimum {STATIC_MIN}; shrinkage {STATIC_SHRINK}; adjustment capped at +/-{MAX_ADJUSTMENT}',
            'sequence': f'last prior hit/miss in the same bucket at least {RESULT_LAG_DAYS} days earlier; residual beyond static; minimum {TRANSITION_MIN}; shrinkage {TRANSITION_SHRINK}; same cap',
            'evaluation': 'all eligible event-markets, not a selected winning subset; lower Log loss and Brier are better; weekly paired bootstrap for Log loss delta',
            'selection': 'Both exact 0.01 and fixed 0.05 price bands are reported; no winner was chosen for production from these results.',
        },
        'results': {},
        'limitations': [
            'Historical files contain game start times but no odds observation time, result-known time, or declared source timezone.',
            'The 48-hour lag reduces same-day leakage but cannot prove the previous result was known before the next quote.',
            'The 2026 archive was already inspected while designing Odds Lens. Treat it as a later retrospective replay, not a newly untouched independent test.',
            'This test covers one-step hit/miss transitions at the same price; it does not establish that longer apparent streaks are predictive.',
            'A negative or tiny difference does not imply any particular future outcome is due.',
        ],
    }
    for mode in ('exact_0.01', 'band_0.05'):
        add_preceding_results(rows, mode)
        static = fit_static(splits['train'], mode)
        transition = fit_transition(splits['train'], mode, static)
        report['results'][mode] = {
            'fitGroups': {
                'staticTotal': len(static),
                'staticAboveMinimum': sum(value[0] >= STATIC_MIN for value in static.values()),
                'transitionTotal': len(transition),
                'transitionAboveMinimum': sum(value[0] >= TRANSITION_MIN for value in transition.values()),
            },
            'policy2025': metrics(splits['policy'], mode, static, transition),
            'later2026': metrics(splits['test'], mode, static, transition),
        }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(args.out)
    for mode, result in report['results'].items():
        print(mode)
        for sport, data in result['later2026'].items():
            scored = data['all']
            print(f"  {sport:10} n={scored['n']:5} affected={data['affected']['n']:5} "
                  f"M1={scored['m1']['log_loss']:.6f} "
                  f"static={scored['staticPrice']['log_loss']:.6f} "
                  f"sequence={scored['firstOrderSequence']['log_loss']:.6f}")


if __name__ == '__main__':
    main()
