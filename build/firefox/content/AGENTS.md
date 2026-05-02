# AGENTS.md

## Scope

AV.by content script. Runs in the context of av.by pages to replace BYN prices with the user's selected display currency.

## What lives here

```
content/
└── avby.js            # Self-contained IIFE — the entire content script
```

## Local boundaries and invariants

- **Self-contained IIFE**: this script cannot use ES module `import`/`export`. MV3 content scripts run in an isolated world without module support.
- **Duplicated helpers**: `parseBynPrice`, `convertFromBYN`, `formatDisplayPrice` are copied from `lib/rates.js`. They must stay in sync — if you change one, change the other.
- **No network access**: the content script reads rates from `browser.storage.local` only. It never calls `fetch`. If storage is empty, it sends `ensureRates` to the background via `browser.runtime.sendMessage`.
- **DOM is untrusted**: all price text is parsed from the page DOM. The script never writes `innerHTML` — only `textContent` and `nodeValue` modifications.
- **Original text preservation**: BYN prices are saved in dataset attributes `avCurrenciesOriginalText` and `avCurrenciesBynAmount` on price elements, and in `WeakMap` instances (`monthlyOriginalText`, `monthlyBynAmount`) for monthly-payment text nodes. A `Set` (`trackedMonthlyNodes`) tracks all registered monthly nodes. These must not be removed — they enable restoring original BYN text when the user switches currency back to BYN.
- **MutationObserver**: observes `document.body` with `{ childList: true, subtree: true, characterData: true }`. Processes newly added nodes, attribute changes, and live text edits. Be careful not to trigger infinite loops — the script guards against re-processing already-converted elements.
- **Selector categories**: price elements (`PRICE_SELECTORS`), monthly elements (`MONTHLY_ELEMENT_SELECTORS`), finance ranges (`FINANCE_RANGE_SELECTORS`), price history descriptions (`PRICE_HISTORY_DESC_SELECTORS`), and salon price wrappers (`SALON_PRICE_WRAPPER_SELECTOR`). Each has its own collection and processing function.

## Safe change rules

- When adding support for a new AV.by page section, add the selector to the appropriate selector constant at the top of the script, then add handling in `applyAll()` if needed.
- When changing conversion math, update the duplicated helpers here AND in `lib/rates.js`, then run both test suites.
- Do not add `fetch`, `XMLHttpRequest`, or any network calls to this file.
- Do not add `innerHTML` assignments — use `textContent` and `nodeValue` only.

## Validation

Tests live in `tests/content.test.js`. They load this script via `readFileSync` and execute it in a JSDOM environment with browser API mocks. Fixtures (saved AV.by HTML pages) are in `examples/`.

```bash
npx vitest run tests/content.test.js   # Run content script tests only
npm test                                # Run all tests
```

## Nearby docs

- `ARCHITECTURE.md` — section 4 covers the AV.by price replacement data flow
- `lib/rates.js` — source of truth for the duplicated helpers
- `examples/` — HTML fixtures used by `tests/content.test.js`
