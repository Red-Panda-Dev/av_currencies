# AGENTS.md

## Scope

AV.by content script in `src/content/`. It runs on `https://*.av.by/*` at `document_idle` and replaces BYN prices with the selected display currency, using effective rates that account for custom rate overrides.

## What lives here

```text
src/content/
└── avby.js            # Self-contained IIFE for DOM scanning, conversion, VIN UI, observers
```

## Local boundaries and invariants

- `avby.js` is not an ES module. Do not add `import` or `export`; browser API compatibility comes from `globalThis.browser ??= globalThis.chrome;`.
- The content script does not fetch network resources. It reads `ratesData`, `selectedCurrency`, `vinFeatureEnabled`, and `customRates` from storage and asks background for `ensureRates`, `getVinForPage`, and `submitVinForPage`.
- DOM writes must use `textContent` or `nodeValue`, not `innerHTML`.
- The local copies of `parseBynPrice`, `convertFromBYN`, `formatDisplayPrice`, and `formatDisplayPriceRange` must stay behaviorally aligned with `src/lib/rates.js`.
- `getRateInfo(currencyCode)` merges custom overrides: if `customRates[currencyCode]` is set, it replaces `rate` from the base `ratesData`; `scale` and `code` remain from NBRB.
- Original BYN text restoration depends on element dataset fields (`avCurrenciesOriginalText`, `avCurrenciesBynAmount`), `WeakMap` state for text nodes, and tracked monthly nodes. Preserve those mechanisms when changing selectors or processing flow.
- `MutationObserver` watches `document.body` for child-list and character-data changes. Avoid changes that reprocess converted text indefinitely.
- `originalDaysOnSale` is read from `__NEXT_DATA__` and appended as `, всего N дней в продаже` to matching card stats.
- `customRates` changes from the storage listener trigger `scheduleApply()`.
- `.salon-listing-top__prices` shows a separate BYN suffix element next to the converted price `<div>`, rendered by AV.by as either `<span>p.</span>` or `<small> руб.</small>`. `applySalonPriceSuffixes()` targets `wrapper.lastElementChild` (tag-agnostic) and clears it on conversion when `isBynSuffixText` matches (`р.`, `р`, `p.`, `руб.`, `руб`), restoring the cached suffix text on revert.

## Safe change rules

- Add new AV.by markup support by extending the relevant selector group and processing path; do not mix unrelated page-section logic into an existing branch just because selectors match today.
- `PRICE_SELECTORS` covers plain BYN price elements across listing cards, detail cards, salon listings, stats/graph views, and the fullscreen photo-gallery modal (`.fullscreen-gallery__price`, rendered as `109\u00A0000 <small>руб.</small>`). Like every other price, the modal price is flattened to plain text on conversion (the `<small>` is removed) and restored to its cached BYN text on revert; the modal opens dynamically and is picked up by the existing `MutationObserver`, so no extra observer wiring is needed.
- If conversion parsing or display formatting changes, update both this file and `src/lib/rates.js`, then run parsing and content tests.
- Keep VIN feature behavior gated by `vinFeatureEnabled`; the default is off.
- Preserve Russian user-facing messages and AV.by-specific text fragments.

## Validation

```bash
npx vitest run tests/content.test.js   # Content-script tests only
npm test                               # Full extension suite with coverage
```

## Nearby docs

- `ARCHITECTURE.md` — content-script data flow and invariants.
- `DESIGN.md` — DOM update rules and data display patterns.
- `tests/content.test.js` — JSDOM harness, browser mock, AV.by fixture usage.
- `examples/` — saved AV.by pages used by content tests.
- `src/lib/rates.js` — pure source for duplicated conversion helpers.
