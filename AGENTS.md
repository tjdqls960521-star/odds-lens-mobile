# AI coding instructions

These instructions apply to every AI coding assistant working in this repository.

## Before editing
- Read `README.md` and the relevant design or methodology note in `docs/`.
- Keep changes focused on the requested behavior and preserve the app’s mobile-first layout.
- Never add credentials, `.env` files, Cloudflare account or resource IDs, or private Sites metadata.
- Keep `wrangler.local.jsonc` local-only; create it from `wrangler.local.example.jsonc`.

## Data and model safeguards
- Preserve source provenance, observation timestamps, market rules, and uncertainty.
- Treat historical observations and D1 ledger events as immutable; add a migration instead of changing an applied migration.
- Never substitute overseas odds or inferred values when the official domestic source is missing.
- Keep historical pattern frequencies separate from current-event probability estimates.
- Do not present historical hit rates or traffic-light colors as forecasts or evidence of positive expected value.
- Do not enable bet/pass recommendations without independent calibration and forward, market-specific ROI validation including costs.
- Respect source-specific reuse terms for historical datasets; the MIT license covers code only.

## Local development and deployment
- Install dependencies with `npm ci`. Local Cloudflare D1/R2 bindings require a private `wrangler.local.jsonc`, copied from the example and filled with local resource settings.
- Run checks relevant to the change before handing it off.
- Local edits do not deploy the production Site. Report deployment only after the hosting workflow confirms it.
