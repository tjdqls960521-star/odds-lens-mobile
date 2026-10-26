# ODDS LENS: many-match analysis workspace

The primary task is reviewing many fixtures and returning to a small number of candidates. The existing full-market cards made each fixture expensive to scan, while separate statistics and history screens forced the user to remember prices across navigation.

## Task sequence and screen decisions

| User task | UI decision | What stays visible |
| --- | --- | --- |
| Scan 100+ fixtures | Compact default list; one selected market per fixture; staged list expansion | Teams, start time, market/line, current odds and movement |
| Find something specific | Sticky search and filter access; league/date/market filters; changed and unreviewed queues | Active market/filter summary and result count |
| Keep candidates | Existing interest stars plus a separate maximum-four comparison selection | Selected comparison count; the cart remains a separate selection of outcomes |
| Compare candidates | Common rows in a comparison table; select the same market family; show each exact line and offer | Side labels, first/current prices, movement, observation time and market status |
| Inspect one fixture | A modal sheet with its markets, price history and exact historical evidence | Match identity and a clear route to full analysis |
| Resume work | Preserve list scroll; session review tokens change when quotes/conditions/status change | Reviewed / updated state; no reset for a repeated unchanged collection |
| Receive newer quotes while comparing | Freeze the visible sheet until explicit refresh; flag newer data | The displayed observation time and a refresh action |

## Density and meaning

- Started/completed matches are collapsed initially. Upcoming matches remain in time order by default; recent-change order is explicit.
- Historical evidence retains its own scope, sample count, grade and conflicts. It is never labelled as the current match's win probability.
- A different handicap or total line is shown as a different condition. Price movement arrows require comparable conditions.
- Missing markets and fixtures remain explicit in comparison. A different market is never substituted to fill an empty column.
- An interest star represents a fixture; a cart pick represents one outcome at a particular quote. The UI keeps those actions distinct.
- Comparison and reviewed markers are device/session preferences. Durable price history remains in the existing server ledger.

## Verification scope

Core tests cover primary-offer selection, unavailable market handling, review-token stability and invalidation, four-item comparison limits, market isolation, safe text rendering and KST day grouping. Existing data and price-history tests remain applicable. The managed environment has no supported browser-control tool, so actual mobile layout and touch interactions require visual verification outside this execution environment.

## Validation performed

- `npm test`: 112 tests passed, including 10 workspace behavior tests.
- Sites production build passed.
- Controller tests exercise frozen comparison prices, explicit refresh, stale-action protection and return from a fixture to its original comparison.
- Existing mobile browser test flows were updated for the compact default, filter sheet and unified candidate/pick dock, but could not be executed in this environment.
