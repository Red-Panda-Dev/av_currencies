# AGENTS.md

## Scope

Extension test suites in `tests/`. These use Vitest with targeted browser and DOM mocks rather than real browser automation.

## What lives here

```text
tests/
├── parse.test.js       # Pure tests for src/lib/rates.js using NBRB fixture data
├── background.test.js  # Background event-page tests with hoisted browser/fetch mocks
├── content.test.js     # JSDOM tests that execute src/content/avby.js against AV.by fixtures
└── popup.test.js       # JSDOM tests that import popup.js after injecting popup.html
```

## Local boundaries and invariants

- `parse.test.js` imports `src/lib/rates.js` directly. Keep it free of browser, DOM, and fetch mocks.
- `background.test.js` uses `vi.hoisted()` to stub `browser`, `fetch`, storage state, alarm state, and event listeners before importing `src/background.js`. New top-level browser API usage in background must be represented in that hoisted mock.
- `content.test.js` reads `src/content/avby.js` as text, executes it in JSDOM, and uses `createBrowserMock()` for storage changes and runtime messages. Extend this mock when content-script browser API usage changes.
- `popup.test.js` injects `src/popup/popup.html`, stubs `browser`/`chrome`, resets modules, dynamically imports `src/popup/popup.js`, then dispatches `DOMContentLoaded`.
- `examples/*.html` are saved AV.by pages used as fixtures; update them deliberately when AV.by markup changes.
- `examples/nbrb_response.json` is raw upstream NBRB shape; processed test rates should match the `parseRates` output shape.

## Custom rates test expectations

- `background.test.js` covers `getEffectiveRates`, `saveCustomRate`, `clearCustomRate`, `clearCustomRates`, `getCustomRates` message handlers, and `refreshRates` clearing `customRates`.
- `content.test.js` covers `customRates` overriding `ratesData.rates[code].rate` for conversion and storage listener pickup.
- `popup.test.js` covers edit mode toggle, save/cancel custom rates, `.rate-row--custom` class, and refresh clearing customs.

## Safe change rules

- Put tests next to the component boundary they exercise: rates in `parse.test.js`, background messaging/fetch/alarms/customs in `background.test.js`, AV.by DOM conversion in `content.test.js`, popup UI/storage/custom-rate behavior in `popup.test.js`.
- Do not rely on real extension globals. Stub browser APIs explicitly and keep state mutations observable to assertions.
- If a source module registers listeners at import time, stub globals before importing it and reset module cache between independent DOM module tests.
- Keep Russian text assertions intentional; they protect user-visible popup/content messages.

## Validation

```bash
npm test                         # Full extension suite with coverage
npx vitest run tests/parse.test.js
npx vitest run tests/background.test.js
npx vitest run tests/content.test.js
npx vitest run tests/popup.test.js
```

Coverage thresholds in `vitest.config.js` apply to `src/**/*.js` except `src/content/**` and `src/popup/**`, so `src/lib/rates.js` and `src/background.js` must stay at or above 80% for lines, functions, branches, and statements.

## Nearby docs

- `vitest.config.js` — test include pattern and coverage thresholds.
- `examples/` — NBRB JSON and AV.by HTML fixtures.
- `src/content/AGENTS.md` and `src/popup/AGENTS.md` — local behavior that DOM tests protect.
