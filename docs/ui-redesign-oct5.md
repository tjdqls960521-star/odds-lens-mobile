# Odds Lens UI/UX · 2026-10-05

## Screen flow

- Mobile: today/upcoming, statistics recommendations, cart, and more in a fixed four-button bottom navigation. More opens the existing pattern, validation, data, and methodology routes in a native dialog.
- The first viewport exposes sport/date/league/market controls and the first historical recommendation when one qualifies. A direct jump reaches upcoming fixtures below recommendations.
- Recommendation cards distinguish the selected price, historical hit rate, wins/sample count, evidence grade, and team/league/sport cohorts. Full evidence opens in a sheet. A historical 100% record remains labelled as a historical sample, with small-sample limitations visible.
- Detailed recommendation filters and optional scope/sequence/source information can be expanded. Their expanded state survives rendering and return navigation within the session.
- Quotes retain separate home/under blue, away/over red, and draw grey states. Added selections show “담김”; the cart badge and combination bar reflect the existing draft.
- Mobile cart places the draft, amount, combination odds, expected payout, and saved results in order. Desktop presents the draft and saved combinations side by side.

## Scope

Existing source collection, exact-odds calculations, A/B/C policy, saved quote/stake values, result settlement, and kickoff grouping are retained. No database migration or model training is part of this presentation change. There is no additional dependency or purchase/payment functionality.

## Verification

- `npm test`: 91 passed.
- `npm run test:mobile`: 6 passed at 360/390/430px, including filter/navigation, exact case counts, evidence sheet, draft amount, saved outcomes, reconnect recovery, refresh scroll stability, and detail-to-list restoration.
- Additional layout inspection: 390px mobile and 1440px desktop, including 200% root text size, detail, cart, menu, and fixture jump. No page overflow or JavaScript errors. Results are in `reports/redesign-layout-audit.json`.
- All new screenshots use the isolated QA fixtures in `test/mobile-v3.spec.mjs`; they are UI evidence, not current real matches or production recommendation performance. QA data is never copied to `public/` or the runtime database.

## Reproduce

In this checkout, serve `public/` on port 61872 (`python3 -m http.server 61872 --directory public`), then run `npm run test:mobile`. Tests intercept data requests with their QA fixtures. `npm run build` produces the existing Worker and static assets. For text enlargement, set the root font size to 32px in the local preview and check navigation, controls, detail, and cart at 390px and 1440px.

Representative captures: `reports/redesign-mobile-first-view.png`, `reports/redesign-mobile-evidence.png`, `reports/redesign-mobile-results.png`, and `reports/redesign-desktop-today.png`.
