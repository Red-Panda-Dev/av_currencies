# AGENTS.md

## Scope

Test suites for the extension. Two test files covering different components with different strategies.

## What lives here

```
tests/
├── parse.test.js      # Vitest tests for src/lib/rates.js (pure functions, no mocks needed)
└── content.test.js    # Vitest + jsdom tests for src/content/avby.js (browser mocks + DOM fixtures)
```

## Local boundaries and invariants

- **`parse.test.js`** imports directly from `src/lib/rates.js`. No mocks, no DOM — runs in plain Node.js.
- **`content.test.js`** is more complex:
  - Loads `src/content/avby.js` source via `readFileSync` and executes it inside a JSDOM `<script>` block.
  - Uses a `createBrowserMock()` function to simulate `browser.storage.local`, `browser.runtime.sendMessage`, and `browser.storage.onChanged`. If you add new browser API usage to the content script, you must extend this mock.
  - Reads HTML fixtures from `examples/` (`index.html`, `auto_card.html`, `auto_card_mobi.html`, `new_cars_list.html`, `new_car_page.html`, `parts_list.html`). These are real AV.by page snapshots. Other HTML files in `examples/` are saved pages not yet wired into tests.
  - The mock returns rate data in the shape `{ rates: { USD: { rate, scale }, ... } }` — this is the processed format from `src/lib/rates.js:parseRates`, not the raw NBRB API response.
  - `bootstrapContentScript()` sets up JSDOM, injects browser mocks into globals, evals the content script, and returns a cleanup function. Always call `cleanup()` in a `finally` block.

## Safe change rules

- When adding tests for new `src/lib/rates.js` functions, add them to `parse.test.js`.
- When adding tests for new content script behavior, add them to `content.test.js`. If the behavior uses a new browser API, extend `createBrowserMock()`.
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
