# AGENTS.md

## Scope and inheritance

Applies to: `ios/`.

Inherits repository-wide guidance from `../AGENTS.md`. This file defines only local differences for this subtree.

## What lives here

```text
ios/
└── av-currencies.user.js   # Standalone iOS Safari userscript (Userscripts-app compatible);
                            # same AV.by price conversion as the extension, single file
```

## Local boundaries and invariants

- The userscript is one self-contained IIFE: no `import`/`export`, no build step, no bundler. It must stay installable as a single file; `@match` is limited to `av.by` and `@connect` to `api.nbrb.by`.
- Storage is `localStorage` with keys `avc.ratesData.v1` and `avc.selectedCurrency.v1` — not `browser.storage.local`. Rates cache TTL is 4 hours (`RATES_TTL_MS`).
- Network: NBRB fetch via `window.fetch` with a 10s abort timeout, falling back to `GM.xmlHttpRequest` / `GM_xmlhttpRequest` when the userscript manager provides them.
- `PRICE_SELECTORS` and regexes are copies of `src/content/avby.js`; the pure helpers (`parseBynPrice`, `convertFromBYN`, `formatDisplayPrice`, `formatDisplayPriceRange`) mirror `src/lib/rates.js`. Change all copies together.
- Monthly-price and days-on-sale behavior follows the content script: dataset fields, `WeakMap` text-node state, and the `__NEXT_DATA__` suffix `, всего N дней в продаже`.
- `DISPLAY_CURRENCIES` includes BYN and defaults to BYN; the in-page widget (`#avc-panel`, `.avc-currency-btn`, `.avc-err` error line) replaces the extension popup.
- Failed refreshes keep the last cached rates; errors render in the widget, never throw.
- No custom rates, VIN sharing, or runtime messaging exists here; do not port extension-only behavior into this file.

## Safe change rules

- Bump `@version` in the `==UserScript==` header in step with the extension version in `manifest.json` so shipped artifacts stay comparable.
- Widget DOM updates use `textContent` / `classList`; no `innerHTML` or inline handlers.
- New external hosts require both an `@connect` entry and a concrete product reason.

## Validation

```bash
npx vitest run tests/ios.test.js   # Userscript tests only
npm test                           # Full suite; ios coverage gated per-glob
```

Coverage for `ios/**/*.js` is thresholded separately in `vitest.config.js` (lines 70, functions 75, branches 50, statements 65) and depends on the import-based harness in `tests/ios.test.js` — do not switch it back to `dom.window.eval`, which is invisible to v8 coverage. Prettier covers `ios/**/*.js` via `npm run format:check`.

## Nearby docs

- `tests/AGENTS.md` — ios test harness contract.
- `src/content/AGENTS.md` — selector and processing rules this script mirrors.
- `src/lib/rates.js` — pure source for the duplicated helpers.
