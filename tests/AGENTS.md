# AGENTS.md

## Scope

Test suites for the extension. Three test files covering different components with different strategies.

## What lives here

```
tests/
├── parse.test.js       # Vitest tests for src/lib/rates.js (pure functions, no mocks needed)
├── content.test.js     # Vitest + jsdom tests for src/content/avby.js (browser mocks + DOM fixtures)
└── background.test.js  # Vitest tests for src/background.js (vi.hoisted mocks for browser/fetch)
```

## Local boundaries and invariants

- **`parse.test.js`** imports directly from `src/lib/rates.js`. No mocks, no DOM — runs in plain Node.js.
- **`content.test.js`** is more complex:
  - Loads `src/content/avby.js` source via `readFileSync` and executes it inside a JSDOM `<script>` block.
  - Uses a `createBrowserMock()` function to simulate `browser.storage.local`, `browser.runtime.sendMessage`, and `browser.storage.onChanged`. If you add new browser API usage to the content script, you must extend this mock.
  - Reads HTML fixtures from `examples/` (`index.html`, `auto_card.html`, `auto_card_mobi.html`, `new_cars_list.html`, `new_car_page.html`, `parts_list.html`). These are real AV.by page snapshots. Other HTML files in `examples/` are saved pages not yet wired into tests.
  - The mock returns rate data in the shape `{ rates: { USD: { rate, scale }, ... } }` — this is the processed format from `src/lib/rates.js:parseRates`, not the raw NBRB API response.
  - `bootstrapContentScript()` sets up JSDOM, injects browser mocks into globals, evals the content script, and returns a cleanup function. Always call `cleanup()` in a `finally` block.
- **`background.test.js`** tests `src/background.js` with heavy mocking:
  - Uses `vi.hoisted()` to set up `browserMock`, `fetchMock`, `storageState`, `alarmState`, and `listeners` **before** the module import — required because `background.js` calls top-level browser APIs and registers event listeners on import.
  - Mocks `browser` (storage, alarms, runtime events) and `fetch` via `vi.stubGlobal()`.
  - Imports `fetchRates`, `ensureAlarm`, `API_URL`, `ALARM_NAME`, `ALARM_INTERVAL_MINUTES`, `FETCH_TIMEOUT_MS` as named exports after globals are stubbed.
  - `storageState` and `alarmState` are plain objects shared between the mock and test assertions — mutations by the module under test are directly observable.
  - `listeners` object captures registered event listeners (`onInstalled`, `onStartup`, `onAlarm`, `onMessage`) so tests can invoke them directly.

## Safe change rules

- When adding tests for new `src/lib/rates.js` functions, add them to `parse.test.js`.
- When adding tests for new content script behavior, add them to `content.test.js`. If the behavior uses a new browser API, extend `createBrowserMock()`.
- When adding tests for background behavior (new message actions, alarm logic, fetch edge cases), add them to `background.test.js`. If the new behavior uses a new browser API, extend the `vi.hoisted()` mock block.
- Do not add real browser globals to the test environment — use the mock system.
- HTML fixtures in `examples/` are checked into the repo. If AV.by changes their markup, update fixtures by saving the relevant page HTML.

## Validation

```bash
npm test                  # Run all tests
npm run test:coverage     # Run with coverage (80% threshold enforced on lib/)
```

## Nearby docs

- `examples/nbrb_response.json` — raw NBRB API fixture (used by `parse.test.js`)
- `examples/*.html` — AV.by page fixtures (used by `content.test.js`)
- `vitest.config.js` — coverage configuration
