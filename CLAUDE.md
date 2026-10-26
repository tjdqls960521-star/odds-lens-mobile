# Claude Code instructions

## Project

ODDS LENS is a Korean mobile-first sports-odds research app. It collects publicly available Betman odds, keeps immutable quote and result history, and presents statistical evidence for baseball, soccer, basketball, and volleyball.

## Start here

- Read `README.md` and the relevant design or methodology note in `docs/` before changing behavior.
- Install with `npm ci`.
- Run `npm test` and `npm run build` before handing off a code change.
- For responsive UI work, run `npm run test:mobile` when Playwright browsers are available.
- Run locally with `npm run migrate:local` and `npm run dev`.

## Architecture

- `src/worker.mjs`: Worker routes, API and storage integration.
- `src/ledger.mjs`, `src/quote-history.mjs`, `src/slips.mjs`: durable records and event settlement.
- `public/odds-lens/`: mobile UI, statistical analysis modules, and bundled historical snapshots.
- `db/schema.ts`, `drizzle/`: D1 schema and append-only migrations.
- `test/`: calculation, API, collection, and mobile acceptance tests.
- `scripts/`: reproducible data audits and model backtests.

## Data and model rules

- Preserve source provenance, observation timestamps, market rules, and uncertainty when changing collection or analysis.
- Treat D1 ledger events and historical observations as immutable. Add a new migration instead of editing an applied migration.
- Never substitute overseas odds or inferred values when the official domestic source is missing. Show source failures and stale data clearly.
- Keep historical pattern frequencies separate from current-event probability estimates.
- A traffic-light color or historical hit rate is not a probability forecast or evidence of positive expected value.
- Keep the bet/pass gate locked unless independent probability calibration and forward, market-specific ROI validation—including costs—support a change. User-entered probabilities must not count as validated model output.
- Do not describe the app as financial advice or present it as an automatic betting system.

## Secrets and deployment

- Never commit API tokens, account IDs, `.dev.vars`, `.env*` files, or private Sites metadata.
- `wrangler.local.jsonc` is for local development. Production D1 and R2 resources require account-specific bindings outside this source package.
- Local builds and commits do not deploy the production Site. Only report a deployment after the authorized hosting workflow confirms it.
- Historical datasets may have source-specific reuse terms. Do not extend the MIT license to data supplied by third parties.
