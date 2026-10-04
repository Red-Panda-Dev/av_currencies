# AGENTS.md

## Scope

Test suites in `tests/` for the extension and the ios userscript. These use Vitest with targeted browser and DOM mocks rather than real browser automation.

## What lives here

```text
tests/
├── parse.test.js       # Pure tests for src/lib/rates.js using NBRB fixture data
├── background.test.js  # Background event-page tests with hoisted browser/fetch mocks
├── content.test.js     # JSDOM tests that execute src/content/avby.js against AV.by fixtures
├── popup.test.js       # JSDOM tests that import popup.js after injecting popup.html
└── ios.test.js         # JSDOM tests that import ios/av-currencies.user.js with globals installed
```

## Local boundaries and invariants

- `parse.test.js` imports `src/lib/rates.js` directly. Keep it free of browser, DOM, and fetch mocks.
- `background.test.js` uses `vi.hoisted()` to stub `browser`, `fetch`, storage state, alarm state, and event listeners before importing `src/background.js`. New top-level browser API usage in background must be represented in that hoisted mock.
- `content.test.js` reads `src/content/avby.js` as text, executes it in JSDOM, and uses `createBrowserMock()` for storage changes and runtime messages. Extend this mock when content-script browser API usage changes.
- `popup.test.js` injects `src/popup/popup.html`, stubs `browser`/`chrome`, resets modules, dynamically imports `src/popup/popup.js`, then dispatches `DOMContentLoaded`.
- `ios.test.js` creates a fresh JSDOM page per test, installs its globals (`document`, `localStorage`, `requestAnimationFrame`, `MutationObserver`, `NodeFilter`, `fetch`) on `globalThis`, then executes the userscript with `await vi.resetModules()` + `await import("../ios/av-currencies.user.js")`, restoring globals in `afterEach`. The literal-path import is required: `dom.window.eval` runs in JSDOM's VM context and is invisible to v8 coverage (reports 0%).
- `ios.test.js` seeds the userscript's `localStorage` keys `avc.ratesData.v1` / `avc.selectedCurrency.v1`, mocks `fetch` with `examples/nbrb_response.json` data, and settles scheduled work by awaiting `requestAnimationFrame` callbacks (`settle()`) instead of fixed sleeps.
- `examples/*.html` are saved AV.by pages used as fixtures; update them deliberately when AV.by markup changes.
- `examples/nbrb_response.json` is raw upstream NBRB shape; processed test rates should match the `parseRates` output shape.

## Custom rates test expectations

- `background.test.js` covers `getEffectiveRates`, `saveCustomRate`, `clearCustomRate`, `clearCustomRates`, `getCustomRates` message handlers, and `refreshRates` clearing `customRates`.
- `content.test.js` covers `customRates` overriding `ratesData.rates[code].rate` for conversion and storage listener pickup.
- `popup.test.js` covers edit mode toggle, save/cancel custom rates, `.rate-row--custom` class, and refresh clearing customs.

## Safe change rules

- Put tests next to the component boundary they exercise: rates in `parse.test.js`, background messaging/fetch/alarms/customs in `background.test.js`, AV.by DOM conversion in `content.test.js`, popup UI/storage/custom-rate behavior in `popup.test.js`, ios userscript DOM/storage/network behavior in `ios.test.js`.
- Do not rely on real extension globals. Stub browser APIs explicitly and keep state mutations observable to assertions.
- If a source module registers listeners at import time, stub globals before importing it and reset module cache between independent DOM module tests.
- Keep Russian text assertions intentional; they protect user-visible popup/content messages.

## Validation

```bash
npm test                         # Full extension + ios suite with coverage
npx vitest run tests/parse.test.js
npx vitest run tests/background.test.js
npx vitest run tests/content.test.js
npx vitest run tests/popup.test.js
npx vitest run tests/ios.test.js
```

Coverage thresholds in `vitest.config.js` are per-glob: `src/**/*.js` except `src/content/**` and `src/popup/**` must stay at or above 80% for lines, functions, branches, and statements; `ios/**/*.js` is gated at 70/75/50/65 (lines/functions/branches/statements).

## Nearby docs

- `vitest.config.js` — test include pattern and coverage thresholds.
- `examples/` — NBRB JSON and AV.by HTML fixtures.
- `src/content/AGENTS.md`, `src/popup/AGENTS.md`, and `ios/AGENTS.md` — local behavior that DOM tests protect.
