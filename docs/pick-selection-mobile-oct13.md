# Pick selection and mobile decision UI

## Objective and separation

The user asked for a logical way to prioritize hit rate and a mobile-first interface. A lower decimal price is a market reference, not a calibrated probability or a profitability recommendation. The default ordering therefore transparently uses the lowest currently sellable quote per fixture. A separate fixed historical screen provides corroboration and review reasons. It does not replace the default price order because the replay did not establish superior accuracy.

## Fixed historical screen

- Quote: before kickoff, selling, valid complete market, observed within 120 seconds.
- Choose the first sufficiently populated cohort, without inspecting its win rate: league/full quote 30; league/selected price 60; sport/full quote 60; sport/selected price 120. Preserve market, line, side and outcome count.
- At least 15 earlier and 10 later cases. Require the same dominant result and no more than 15 percentage points of deterioration in the later period.
- Require the two-sided 95% Wilson lower bound to be at least 50%, and a matching case within the previous year.
- Require alignment with that market’s lowest price. Hold when another supported A/B cohort has at least 30 cases, 10 later cases and an opposing result.
- Keep one fixture once, sort corroborated candidates by historical lower bound, and never combine overlapping team/league/sport sample counts. No movement or streak bonuses.
- Thresholds are declared product rules, not empirically optimized thresholds or proof of predictive skill.

## Retrospective replay (not live validation)

The same rule was frozen before a single retrospective replay using training data through 2024-12-31 and evaluation fixtures from 2025-01-03 onward. At most 1,200 fixtures per sport were selected at evenly spaced chronological indices without using outcomes. Final closing quotes lack observation timestamps, and result-known timestamps are absent. Timezone is assumed KST. Keeping training history frozen also reduces coverage as evidence becomes old. The different selections, odds and markets prevent a causal accuracy comparison.

| Sport | Historical-screen hits | Rate | Lowest-price benchmark hits | Rate | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseball | 96/164 | 58.5% | 808/1200 | 67.3% | 13.7% |
| soccer | 326/525 | 62.1% | 766/1200 | 63.8% | 43.8% |
| basketball | 211/320 | 65.9% | 793/1200 | 66.1% | 26.7% |
| volleyball | 7/9 | 77.8% | 704/1005 | 70.0% | 0.9% |

Negative evidence is retained in the shipped report and the interface. The small volleyball selection is inconclusive. No threshold was tuned to these results and no real match probability is displayed.

## Mobile behavior

- Separate price ordering, corroborated evidence, review queue and full historical lookup.
- Three aligned historical metrics: full-sample hit rate, later-period rate, Wilson lower bound. Every number is labelled as historical.
- At narrow widths, team names span the row above large outcome buttons; critical actions have at least 44–48 px target height.
- Shared search and filter sheet; persistent fixture comparison and pick dock.
- Existing frozen comparison sheets remain intact; adding a displayed pick revalidates both price and the exact market/line/outcome configuration.
- The cart explains that all selections must win. The 70% → 49% → 34.3% illustration is explicitly hypothetical and assumes independent fixtures.

## Sources

- NIST Wilson interval: https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
- Temporal evaluation: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html

## Verification

Core policy and UI contracts are covered by Node tests, including a DOM port for frozen sheet interactions. Production build is required. Managed browser control is unavailable; browser layout and touch checks cannot be executed here. Existing browser scenarios were updated but are not counted as executed tests.

Validation result: 124 Node tests passed; production build passed. The focused source review also fixed an undefined fixture reference in the full-analysis history link. Mobile browser test execution remains unavailable.
