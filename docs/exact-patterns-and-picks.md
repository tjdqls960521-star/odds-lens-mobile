# Exact odds sequences and saved picks — 2026-10-04

## Scope

The existing Site, framework, official Betman collector and historical sources are retained. All first-half markets are excluded at collection, archive import, UI and pick-save boundaries. Raw collection evidence remains archived.

Pattern analysis uses the exact two-decimal domestic quote and the exact signed handicap/total line. The full combination and an individual selected quote are distinct comparisons. No tolerance slider or 0.05 bucket participates in displayed analysis. Legacy compatibility helpers also match exact cents.

## Statistical recommendations (updated 2026-10-04)

The main recommendation cards use exact-odds outcome distributions, not sequence matches. Each outcome needs at least three settled cases and must be the unique most frequent result within its cohort. Full combinations and a single selected price are separate; single-price evidence supports only the outcome whose price was matched. Draws remain in the denominator and count as wins only for a draw selection. Unresolved/void records are excluded from the settled denominator.

The visible headline is past hit rate plus wins/sample count. Sport, league and team evidence stay separate. Ranking first uses the number of agreeing scope families (sport, league, team; home/away team still one family), then the A/B/C statistical grade and strength. The representative evidence within the same grade prefers team, then league, then sport. Overlapping sample counts are not pooled.

Statistical grades in `statistics-recommendations.mjs`:

- C: at least 3 cases; a unique modal outcome. Small perfect records remain C.
- B: at least 12 cases, 6 earlier and 4 later; the same outcome is uniquely modal in both periods, later rate falls by no more than 15 percentage points, and the whole-cohort Wilson lower bound exceeds 1 / outcome count.
- A: additionally 30 cases, 15 earlier and 10 later; the later-period Wilson lower bound also exceeds 1 / outcome count.
- An opposing scope with equally strong or stronger evidence reduces the recommendation to C and is explicitly shown.

Grades describe historical evidence, not a calibrated probability or profitable return. Sequence contents never enter these recommendations, grades, or ranking. List pages skip sequence mining; details retain sequences in a closed reference section below the statistics and actual cases. The separate reference catalogue keeps its original sequence evidence grades, distinctly labelled.

## Discovery UX (2026-10-04)

The current-match home screen prioritizes finding inspectable team/price records. Existing statistical selection remains unchanged. `discovery-core.mjs` chooses a specific cohort for the visible fact and uses that cohort's own grade (or C for an existing statistical conflict). A 7/7 team cohort never inherits an A from a larger sport cohort.

- One-tap filters: all records, team records, perfect historical records, and agreement across scope families.
- Minimum sample and grade filters, plus agreement/team/sample/time sorting. These are UI filters; they do not mix similar prices or re-estimate probabilities.
- Each card shows exact quote, market and signed line, cohort/matching rule, wins/n, historical hit rate, observation date range and same-basis sport/league/team comparisons. An ordinary team win is described as a team win only when the selected home/away side belongs to that team. Handicap, totals, and opposite-side results have their own labels.
- A native modal opens the actual settled cases without navigating away. It uses the same physical-event deduplication, exact prices, scope, line, outcome arity and pre-target cutoff as the card. Missing/void results are reported separately. Cases paginate by 50 and include misses.
- Escape/close returns to the list position. Pick add from the modal checks for a changed quote; a mobile cart bar stays visible once picks are added.
- Source/refresh information is compact, with source errors still visible. Patterns remain in the separate reference view and collapsed detail section.

No odds-setter intent is inferred. Perfect records are explicitly labelled historical and display sample size. `test/discovery.test.mjs` covers hidden team perfection, own-cohort grading, sample filters, exact case reconciliation and team/result wording. Mobile tests cover perfect-record filtering, no-result reset, modal cases, scroll return and cart handoff.

## Sequence evidence (reference only)

`pattern-board.mjs` indexes exact quotes and deduplicates physical event/market/line records before matching. `sequence-patterns.mjs` enumerates fixed prefixes of length 1–3 within sport, league and same-role team cohorts. It reports actual next-outcome counts and examples, not a forecast probability. Missing/void outcomes break chains. Without a result-known timestamp, same-day results cannot be chained. Overlapping windows for the same prefix are not independent samples and are counted only once.

The first 70% of dates determines a proposed next result. The remaining dates can confirm or demote it, never select a different next result. A/B require a unique next outcome, improvement over the cohort's ordinary frequency, and a Wilson lower bound above that ordinary frequency. In the later period the result must remain most frequent, exceed its later baseline and lose no more than 15 percentage points versus the earlier period.

- A: at least 30 pattern samples, 15 earlier and 10 later; later Wilson lower bound exceeds the later baseline.
- B: at least 12 samples, 6 earlier and 4 later.
- C: at least 3 observed samples, with insufficient replication or conflicting evidence.

These are exploratory evidence grades. They are not an independent test of a frozen prediction model. Failed later replication is retained in the catalogue but marked as weakened replication. The sequence reference grades do not affect statistical recommendations. Overlapping scope counts are not pooled into one win rate. Small 3/3 samples cannot reach A/B. Existing model validation records remain available separately.

## Picks

An unfinished draft uses browser storage. Explicitly saved slips are persisted in the existing D1 database, with the original Betman offer ID, complete outcome set, line, kickoff, observed quote and stake. One pick per physical game, up to 20, is allowed. The server validates the feed, kickoff, market and unchanged price. Save IDs are idempotent; they cannot overwrite a different saved slip. New table: `pick_slips`, generated migration `0002_dear_ghost_rider.sql`. Older immutable ledger tables are unchanged.

The expected gross amount is the stake multiplied by selected odds, with exact integer-cent arithmetic and rounding down to whole won. It includes the stake and is before taxes/fees. There is no purchase or payment flow.

Results now come first from Betman’s public gameInfoInq.do response for each saved round, independently of the historical spreadsheet. Exact official offer ID, canonical event identity, full-game market, outcome set and saved line are checked. The published result code determines the outcome; live scores and sale closure never settle a pick. A draw wins only the draw selection. Official code 4 cancellation applies 1.00 to that offer, including cancellation rows whose line was reset. Unknown codes or changed lines stay pending with a reason. General match scores, total scores and handicap-adjusted scores have distinct display meanings. The historical sheet remains a strict fallback when no official offer is available. Original picks and losses remain immutable, and official corrections are applied on the next read. See cart-results-oct4.md for the result contract and verification.

## Speed

The fixture board appears before history analysis finishes. Exact indexes, sequence mining and catalogue generation run in a module Web Worker. Unchanged rows and market inputs reuse the index and results. Immutable bundled history can use browser cache. History endpoints immediately return saved data while synchronizing in the background; selected-source versions are checked again after a minute. Recommendations show 18 at a time and the catalogue is paginated by 50.

## Reproduction

- `npm test`: calculation, source exclusions, chronological sequences, sparse/failed replication, official-quote validation, gross arithmetic, draw/void settlement, SQLite reopen/idempotency.
- Start `python3 -m http.server 61872 --directory public`, then `npm run test:mobile`: 360/390/430px, navigation/scroll retention, exact-only controls, pick cart amount, reload and result updates using explicitly local QA fixtures.
- `node scripts/audit-exact-patterns.mjs`: real archived four-sport exact-combination catalogue counts and local timings, saved with source hashes in `reports/exact-sequence-oct4.json`.
- `npm run build`: deployable Worker and existing assets. Sites packaging includes the generated D1 migrations.
