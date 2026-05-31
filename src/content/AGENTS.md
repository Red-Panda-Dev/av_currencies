# AGENTS.md

## Scope

AV.by content script in `src/content/`. It runs on `https://*.av.by/*` at `document_idle` and replaces BYN prices with the selected display currency.

## What lives here

```text
src/content/
└── avby.js            # Self-contained IIFE for DOM scanning, conversion, VIN UI, observers
```

## Local boundaries and invariants

- `avby.js` is not an ES module. Do not add `import` or `export`; browser API compatibility comes from `globalThis.browser ??= globalThis.chrome;`.
- The content script does not fetch network resources. It reads `ratesData`, `selectedCurrency`, and `vinFeatureEnabled` from storage and asks background for `ensureRates`, `getVinForPage`, and `submitVinForPage`.
- DOM writes must use `textContent` or `nodeValue`, not `innerHTML`.
- The local copies of `parseBynPrice`, `convertFromBYN`, and `formatDisplayPrice` must stay behaviorally aligned with `src/lib/rates.js`.
- Original BYN text restoration depends on element dataset fields, `WeakMap` state for text nodes, and tracked monthly nodes. Preserve those mechanisms when changing selectors or processing flow.
- `MutationObserver` watches `document.body` for child-list and character-data changes. Avoid changes that reprocess converted text indefinitely.
- `originalDaysOnSale` is read from `__NEXT_DATA__` and appended as `, всего N дней в продаже` to matching card stats.

## Safe change rules

- Add new AV.by markup support by extending the relevant selector group and processing path; do not mix unrelated page-section logic into an existing branch just because selectors match today.
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
- `tests/content.test.js` — JSDOM harness, browser mock, AV.by fixture usage.
- `examples/` — saved AV.by pages used by content tests.
- `src/lib/rates.js` — pure source for duplicated conversion helpers.
