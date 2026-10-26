# Cart results repair · 2026-10-04

## Verified cause

The v33 cart only joined pick year/round/game number to the shared historical-sheet cache. At inspection time the baseball and soccer sheets ended on October 2, while Betman's October 4 official gameInfoInq.do already published completed game results. All 44 picks in 13 saved slips were therefore pending. Unsaved browser drafts did not request or render results at all.

## Implementation

- `src/betman-feed.mjs`: reuse the existing public, unauthenticated official transport to fetch a specific saved G101 round, even after that round disappears from today's schedule. Keep the existing www/mobile official-host fallback.
- `src/betman-results.mjs`: validate the official row schema and parse full-game results. `gameResult` 0/1/2 is home/draw/away (0/2 is under/over for totals); 4 is explicit cancellation. Final-state allowlist is copied from the official result-highlighting implementation. Other states/codes stay pending. No settlement from a running score, sale closure, or elapsed time.
- R2 `odds-lens/results-v1/<round>.json`: last successful normalized result table, actual observation time, last attempt and error. Changed raw responses are retained under `raw/<round>/<sha256>.json`. Existing slips are unchanged; no D1 schema migration.
- The ordinary odds collector also preserves the result rows it already receives, including prior-day games before the today filter. The cart separately refreshes saved rounds when necessary. Singleflight, 30-second throttling and a four-round refresh bound avoid duplicate/unbounded upstream work. Failed refreshes retain observed results and timestamps, display the delay, and do not fabricate freshness.
- `GET /api/slips`: return saved slips with official results, immediately from durable cache while a due refresh runs. `POST /api/slips/refresh`: await a due refresh and return the resulting slip page. `POST /api/slips/results`: read-only lookup for up to 20 browser draft picks. Legacy drafts recover sport/round/item metadata from their already stored official IDs.
- Exact event identity, offer ID, market, period, outcome set and line must match. A changed line remains withheld. Explicit cancellation is matched to the offer even if Betman resets its line.
- `mchScore` has different meanings: ordinary market is the final pair, under/over is the total (not a home/away pair), handicap is an adjusted pair. A matching independently published ordinary row can supply the real team score for other markets.
- Draft and saved rows show result, score, source check time and actual pending reason. Slip totals keep saved prices; cancellations become 1.00, any losing leg makes the combination unsuccessful. Failed requests do not clear existing picks. Automatic refresh preserves the loaded pages, stake input, and scroll; an initial background lookup is followed up after four seconds while the cart is visible.

## Source verification

Read on 2026-10-04:

- Official public POST: https://www.betman.co.kr/buyPsblGame/gameInfoInq.do, body gmId G101 and gmTs 260117.
- Official UI result mapping: https://m.betman.co.kr/js/slip/gameSlipProtoVictory.html.js?v=1.0 — result marking subtracts one from slip selection 1/2/3; published-state allowlist; gameResult 4 cancellation; total-score display handling.
- Public captured rows are preserved in `test/fixtures/betman-results-260117.json`. This fixture contains no private pick/amount records.

## Verification and reproduction

Run `npm test`. New `test/slip-results.test.mjs` covers real official results, moneyline/totals, transformed-score labels, handicap draw, cancellation, unannounced/unknown/changed-line outcomes, legacy drafts, old-round fetching, deduplication, outage retention, corrections/retractions, durable raw revisions, and Worker saved/draft endpoints.

For mobile tests, serve `public` on local port 61872 and run `npm run test:mobile`. A new case exercises initial automatic result completion, saved and unsaved picks, combination arithmetic, result refresh without a scroll jump, and phone-width overflow.

Local replay of the 13 existing slips against the official response at the recorded inspection time resolved 24 picks (15 won, 9 lost); 20 were still scheduled or officially unannounced. These counts are a point-in-time diagnosis, not a forecast or permanent result summary. No private slip data is committed.

## Limits

An official unannounced result, unrecognized settlement code, changed event identity or changed line stays pending with a concrete reason. The application does not infer a final outcome from an in-progress score. It checks while opened, and queries missed old rounds on return; this change does not install a scheduled background job.

Local validation: 91/91 unit and Worker tests passed; 6/6 mobile browser tests passed (including 360/390/430 px existing navigation coverage). Production build succeeded.
