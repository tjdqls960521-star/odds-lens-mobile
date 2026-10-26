#!/usr/bin/env python3
"""Conservative chronological odds-band hierarchy comparison.

The deepest effect is deliberately shrunk and requires substantially more
than the old 3--5 observation rule. This script compares M2 with M1; it does
not define or evaluate the app's high-confidence selection policy.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np


SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[1]
BASE_BACKTEST_PATH = SCRIPT_PATH.with_name('historical-backtest.py')
SPEC = importlib.util.spec_from_file_location('base_bt', BASE_BACKTEST_PATH)
bt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bt)
DEFAULT_OUT = PROJECT_ROOT / 'reports/historical-hierarchical-backtest.json'

# Fixed before reading 2025/2026 score comparisons.
LEVELS = {
    'sport': {'min_n': 100, 'shrink': 300.0},
    'league': {'min_n': 50, 'shrink': 150.0},
    'team': {'min_n': 30, 'shrink': 100.0},
}
MAX_LEVEL_ADJUSTMENT = 0.08


def normalize(values):
    x = np.clip(np.asarray(values, dtype=float), .01, .99)
    return x / x.sum()


def price_key(odds, mode):
    cents = int(round(float(odds) * 100))
    return cents if mode == 'exact' else (cents // 5) * 5


def team_keys(row, slot):
    # Side markets attach the selected side to its actual role. Draws do not
    # invent a "draw team". Totals use both clubs, each with home/away role.
    if row['market'] == '언오버':
        return [('H', bt.clean_text(row['home'])), ('A', bt.clean_text(row['away']))]
    if slot == 0:
        return [('H', bt.clean_text(row['home']))]
    if slot == row['k'] - 1:
        return [('A', bt.clean_text(row['away']))]
    return []


def base_key(row, slot, mode):
    return (row['sport'], row['market'], row['k'], slot, price_key(row['odds'][slot], mode))


def correction(stats, key, level):
    item = stats.get(key)
    rule = LEVELS[level]
    if not item or item['n'] < rule['min_n']:
        return 0.0
    value = item['residual'] / (item['n'] + rule['shrink'])
    return max(-MAX_LEVEL_ADJUSTMENT, min(MAX_LEVEL_ADJUSTMENT, value))


def build_stats(rows, probability_field, key_fn):
    stats = defaultdict(lambda: {'n': 0, 'residual': 0.0, 'wins': 0, 'expected': 0.0})
    for row in rows:
        p = row[probability_field]
        for slot in range(row['k']):
            hit = int(slot == row['y'])
            for key in key_fn(row, slot):
                item = stats[key]
                item['n'] += 1
                item['residual'] += hit - float(p[slot])
                item['wins'] += hit
                item['expected'] += float(p[slot])
    return dict(stats)


def add_level(rows, source_field, target_field, stats, key_fn, level):
    for row in rows:
        p = np.asarray(row[source_field], dtype=float).copy()
        for slot in range(row['k']):
            keys = key_fn(row, slot)
            if keys:
                p[slot] += float(np.mean([correction(stats, key, level) for key in keys]))
        row[target_field] = normalize(p)


def fit_hierarchy(train, mode):
    # Each layer learns only remaining residuals after the parent layer.
    sport_key = lambda r, s: [('S',) + base_key(r, s, mode)]
    league_key = lambda r, s: [('L',) + base_key(r, s, mode) + (bt.clean_text(r['league']),)]
    team_key = lambda r, s: [('T',) + base_key(r, s, mode) + item for item in team_keys(r, s)]

    sport = build_stats(train, 'm1', sport_key)
    add_level(train, 'm1', '_sport', sport, sport_key, 'sport')
    league = build_stats(train, '_sport', league_key)
    add_level(train, '_sport', '_league', league, league_key, 'league')
    team = build_stats(train, '_league', team_key)
    return {'mode': mode, 'sport': sport, 'league': league, 'team': team}


def predict(rows, model, field):
    mode = model['mode']
    sport_key = lambda r, s: [('S',) + base_key(r, s, mode)]
    league_key = lambda r, s: [('L',) + base_key(r, s, mode) + (bt.clean_text(r['league']),)]
    team_key = lambda r, s: [('T',) + base_key(r, s, mode) + item for item in team_keys(r, s)]
    for row in rows:
        p = np.asarray(row['m1'], dtype=float).copy()
        for level, stats, key_fn in [
            ('sport', model['sport'], sport_key),
            ('league', model['league'], league_key),
            ('team', model['team'], team_key),
        ]:
            for slot in range(row['k']):
                keys = key_fn(row, slot)
                if keys:
                    p[slot] += float(np.mean([correction(stats, key, level) for key in keys]))
            p = normalize(p)
        row[field] = p


def serializable_model_summary(model):
    result = {'mode': model['mode'], 'rules': LEVELS, 'max_level_adjustment': MAX_LEVEL_ADJUSTMENT}
    for level in ['sport', 'league', 'team']:
        stats = model[level]
        result[level] = {
            'groups': len(stats),
            'eligible_groups': sum(1 for item in stats.values() if item['n'] >= LEVELS[level]['min_n']),
            'max_n': max((item['n'] for item in stats.values()), default=0),
        }
    return result


def evaluate(rows, key):
    return bt.metric(rows, key)


def compare(rows, left, right):
    for row in rows:
        y = row['y']
        row['_delta'] = -math.log(max(1e-15, row[left][y])) + math.log(max(1e-15, row[right][y]))
    return {
        'left': evaluate(rows, left), 'right': evaluate(rows, right),
        'left_minus_right_log_loss': float(np.mean([r['_delta'] for r in rows])),
        'delta_interval': bt.weekly_bootstrap(rows, lambda r: r['_delta']),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(DEFAULT_OUT))
    args = parser.parse_args()
    output = Path(args.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    raw, _ = bt.load_rows()
    rows, audit = bt.prepare(raw, 'closing')
    parts = bt.split(rows)
    models_m1 = bt.calibrate_models(parts['calibration'], bt.fit_models(parts['train']))
    train = bt.with_probabilities(parts['train'], models_m1)
    policy = bt.with_probabilities(parts['policy'], models_m1)
    test = bt.with_probabilities(parts['test'], models_m1)
    report = {
        'analysis': 'fixed conservative sport → league → team odds-price hierarchy, closing quote research stage',
        'training': 'through 2023-12-24', 'calibration': '2024-01-08 through 2024-12-24',
        'policy_selection': '2025-01-08 through 2025-12-24', 'independent_test': '2026-01-08 through source maximum',
        'audit': audit, 'minimum_sample_and_shrinkage': LEVELS,
        'models': {}, 'comparisons': {},
        'notes': [
            'Exact means the selected outcome price at the exact domestic 0.01 quote; band means floor-to-0.05.',
            'The hierarchy is market/outcome-slot specific. Side markets attach home/away team by role; totals average separate home-team and away-team residuals; draws have no team layer.',
            'M1 coefficients and hierarchy effects are trained only through 2023; M1 temperature is calibrated on 2024 and no model component is updated with 2025/2026 labels.',
            'Seven days on both sides of every year boundary are excluded because exact result-known timestamps are unavailable.',
            'This report does not choose high-confidence games or test a probability/odds cutoff. The application policy is evaluated separately from this M2-versus-M1 comparison.',
        ],
    }
    for mode in ['band_0.05', 'exact']:
        model_mode = 'band' if mode == 'band_0.05' else 'exact'
        model = fit_hierarchy(train, model_mode)
        field = 'hier_' + model_mode
        predict(policy, model, field)
        predict(test, model, field)
        report['models'][mode] = serializable_model_summary(model)
        report['comparisons'][mode] = {'policy_2025': {}, 'test_2026': {}}
        for sport in sorted(bt.SPORTS):
            c_rows = [r for r in policy if r['sport'] == sport]
            d_rows = [r for r in test if r['sport'] == sport]
            report['comparisons'][mode]['policy_2025'][sport] = compare(c_rows, 'm1', field)
            report['comparisons'][mode]['test_2026'][sport] = compare(d_rows, 'm1', field)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    compact = {
        mode: {
            sport: {
                'policy_2025_m1_minus_m2_log_loss': report['comparisons'][mode]['policy_2025'][sport]['left_minus_right_log_loss'],
                'test_2026_m1_minus_m2_log_loss': report['comparisons'][mode]['test_2026'][sport]['left_minus_right_log_loss'],
                'test_2026_interval': report['comparisons'][mode]['test_2026'][sport]['delta_interval'],
            }
            for sport in sorted(bt.SPORTS)
        }
        for mode in report['comparisons']
    }
    print(json.dumps({'output': str(output), 'm2_vs_m1': compact}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
