# Statistical value picker — 2026-10-14 KST

## User correction

The user wants recommendations derived from the statistics whose estimated
probability exceeds the offered price's break-even probability. A historical
hit-rate replay and a lowest-odds ranking do not answer this question.

## Reproduced empty-list cause

The official feed captured at 2026-10-13T15:33:23.161Z (00:33 KST) contained
121 upcoming fixtures. All 87 announced market quotes were closed, while 402
market entries were pending. Baseball contained four fixtures: two with closed
announced prices and two awaiting prices. The previous screen required selling
status, so its reference list was empty. The regression fixture preserves those
four official baseball fixtures without credentials.

Analysis and availability are now independent. Closed/stale quotes remain
visible as last-observed-price comparisons and cannot be added from a value
card. Pending fixtures have explicit cards without invented probabilities.
When there is no positive candidate, the default tab visibly falls back to all
comparisons, without promoting negative-edge picks to recommendations.

## Fixed estimation rule

For every outcome, select the first group with at least 12 settled observations:
same-league exact whole-price combination, same-league own selection price,
same-sport exact combination, same-sport own selection price. If none qualifies,
use the largest available group for comparison only. Price position, market,
line and two-/three-way outcome shape must match. We never choose a group by
its observed win rate or add overlapping group sample counts.

Let d be the decimal price, q = (1/d) / sum(1/d) across the market, w the
outcome count and n its sample size. First shrink each conditional estimate:

    r = (w + 20q) / (n + 20)
    p = r / sum(r across market outcomes)
    breakEven = 1/d
    edge = p - breakEven
    expectedReturn = p*d - 1

The normalization is explicitly disclosed; per-outcome cohorts can differ.
This is a transparent estimation rule, not a claim of a coherent Bayesian joint
posterior or a prospectively calibrated match probability. The shrinkage
weight 20 and minimum 12 are declared design parameters, not backtest-optimized
thresholds. Estimates require at least three samples; recommendations require
the selected outcome's n >= 12 and each other outcome's n >= 3. Other outcomes
with fewer samples retain q internally and make the whole market comparison-only.

Rank positive-edge candidates first, then by probability-point edge, with one
pick per fixture. Price favoritism and result streaks do not enter the score.
Before scoring duplicate rounds of the same market condition, prefer a current
sellable quote, then the latest observation/round, regardless of flattering edge.
The add action rechecks current policy, availability, price and market condition.

During the live-data check, using a common single-price cohort for all outcomes
was rejected: conditioning only on a draw price distorted home/away estimates.
The final rule strictly uses each selection's own price. A regression test
covers this error. The value-card evidence action opens that exact cohort.

The displayed Wilson interval is a descriptive sampling interval, not a bound
on the current match's model probability. Frequency, adjusted probability and
price break-even are labeled separately. Closed-price research is distinct from
a current purchase opportunity. Void/refund cases are excluded; expected return
is before tax/fees. The data lacks historical quote observation timestamps and
does not encode current lineups/injuries.

## Mobile display

Three tabs: 통계 우위 / 전체 비교 / 통계 원문. Each card exposes estimated
probability, price break-even and signed percentage-point difference side by
side. Fixture counts distinguish announced prices from pending prices.
Unavailable prices show their status without removing statistical analysis.
Search/filter emptiness has a reset action; loading/error states retain prices;
pending-only sports show actual scheduled fixtures. Evidence and odds-history
drawers remain accessible. Price refreshes and fixture start transitions update
the picker while preserving scroll.

## Verification

The real current feed was evaluated with the same bundled archive plus current
history deltas used by the app. This is a current-display/calculation audit,
not a replay of past selection accuracy. `reports/value-feed-check-20261014.json`
records the input time and results: baseball 2 priced / 2 waiting / 1 positive
candidate; soccer 22 priced / 86 waiting / 12 positive candidates; basketball
5 pending; volleyball 4 pending. Every displayed cohort's sample count was
cross-checked against the actual evidence drawer query. All announced prices
in that capture were closed and are labeled reference-only.

Targeted regression tests cover the original empty screen, actual-price versus
no-vig threshold, underdog selection, shrinkage, normalization, own-price sample
identity, duplicate rounds, missing odds, sale state, loading/errors, mobile
markup escaping, action payloads and line/time boundaries.

Browser QA is unavailable in this managed environment; no alternate browser or
preview path was started. The native deployment result verifies publication,
not pixel-level mobile rendering or touch interactions.

References: the beta/binomial update formula is described at
https://statproofbook.github.io/P/bin-post.html; the decimal implied-probability
conversion at https://help.smarkets.com/hc/en-gb/articles/214058369-How-to-calculate-implied-probability-in-betting.
