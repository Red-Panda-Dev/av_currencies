# AGENTS.md

## Repository overview

Cross-browser WebExtension (Manifest V3) for Firefox and Chrome-based browsers. It replaces BYN prices on AV.by with USD/EUR/RUB equivalents from the NBRB API, provides a Russian-language popup with rates and a converter, and supports an optional VIN sharing feature through a separate Cloudflare Worker in `worker/`.

Rates are offline-resilient: failed refreshes must preserve the last valid cached rates in `browser.storage.local`.

## Where to work

```text
src/
├── background.js          # Background event page: NBRB fetch, alarms, storage, messaging, VIN proxy
├── lib/
│   └── rates.js           # Pure parsing/conversion/formatting logic; no browser APIs
├── content/
│   ├── AGENTS.md          # Content-script-specific DOM and AV.by rules
│   └── avby.js            # Self-contained AV.by content script IIFE
└── popup/
    ├── AGENTS.md          # Popup-local UI, storage, and test rules
    ├── popup.html         # Russian popup markup
    ├── popup.css          # Popup styling with light/dark theme support
    └── popup.js           # Popup controller and storage/message handling

tests/
├── AGENTS.md              # Test harness and mocking details
├── parse.test.js          # `src/lib/rates.js` pure-function tests
├── background.test.js     # Background tests with hoisted browser/fetch mocks
├── content.test.js        # JSDOM content-script tests using AV.by fixtures
└── popup.test.js          # JSDOM popup tests using popup markup

worker/
├── AGENTS.md              # Cloudflare Worker-specific guidance
├── src/                   # Worker TypeScript source for VIN API
├── test/                  # Worker Vitest tests
├── wrangler.toml          # Worker routes, KV, vars, secrets-store binding, observability
└── deploy.sh              # Builds then deploys the Worker

scripts/                   # Browser packaging scripts and shared package utilities
examples/                  # NBRB fixture and saved AV.by HTML test fixtures
icons/                     # Extension icons
```

Generated artifacts; do not hand-edit:

```text
build/firefox/
build/chrome/
coverage/
worker/coverage/
av-currencies-firefox.zip
av-currencies-chrome.zip
```

## Architecture and boundaries

- `src/lib/rates.js` must remain importable in plain Node.js; do not add `browser.*`, `document`, `fetch`, or `window` references there.
- Network fetches for extension code belong in `src/background.js`. The popup and content script communicate through `browser.runtime.sendMessage` and storage.
- Popup DOM updates use `textContent`; do not introduce `innerHTML` or inline event handlers.
- `src/content/avby.js` is a self-contained IIFE, not an ES module. It duplicates `parseBynPrice`, `convertFromBYN`, and `formatDisplayPrice` from `src/lib/rates.js`; keep both copies in sync.
- `manifest.json` is the source manifest. `scripts/build-chrome.mjs` generates the Chrome build manifest in `build/chrome/`.
- Source entrypoints use `globalThis.browser ??= globalThis.chrome;` for Firefox/Chrome API compatibility.
- `worker/` is an independent Cloudflare Worker project with its own `package.json`, TypeScript config, Vitest config, and Wrangler deployment.

## Change rules

- Failed NBRB responses must update `lastError` only; never overwrite previously valid `ratesData` on failure.
- `parseRates` expects NBRB PascalCase fields: `Cur_Abbreviation`, `Cur_Scale`, `Cur_OfficialRate`.
- RUB has `Cur_Scale` 100; conversion must account for `scale` in both directions.
- `TARGET_CURRENCIES` is `["USD", "EUR", "RUB"]`; missing any of the three makes `parseRates` return `null`.
- Keep the only extension `host_permissions` limited to the NBRB API and the VIN Worker API unless a new permission is explicitly justified in `manifest.json`.
- Preserve Russian UI strings when editing popup markup, popup logic, content-script messages, and user-facing docs.
- Build scripts call `removeAgentsFiles()` from `scripts/package-utils.mjs`; packaged extension directories should not contain `AGENTS.md` files.

## Validation

```bash
npm test                  # Run extension Vitest suite with coverage
npm run format:check      # Check formatting for source, scripts, tests, worker TS, manifest
npm run format            # Apply Prettier to the configured files
npm run package:firefox   # Build Firefox package output
npm run package:chrome    # Build Chrome package output
npm run package           # Build both browser packages
make lint                 # Makefile alias for format check
make build                # Format, lint, test, then package Firefox and Chrome
make build-chrome         # Format, lint, test, then package Chrome
make test-worker          # Run Worker tests from worker/
```

Worker-only validation is documented in `worker/AGENTS.md`.

## Key docs

- `ARCHITECTURE.md` — component model, data flow, and invariants.
- `README.md` — user-facing Russian documentation, module summary, privacy notes, extension links.
- `VIN-LOGIC.md` — user-facing explanation of optional VIN sharing behavior.
- `manifest.json` — extension permissions, entrypoints, Firefox ID, content-script matches.
- `Makefile` and `package.json` — discoverable validation, packaging, and run commands.
- `worker/README.md` — Worker business logic, storage, API base URL, CORS, secrets.

## Repository-specific gotchas

- Alarm interval is 240 minutes (`ALARM_INTERVAL_MINUTES` in `src/background.js`).
- `VIN_WORKER_API_BASE` is `https://avby.currencies-bel.top`; keep it aligned with `manifest.json`, Worker routes, and tests.
- `vinFeatureEnabled` defaults to off and is stored in `browser.storage.local`.
- Content-script original BYN text restoration relies on dataset fields, `WeakMap` state for text nodes, and tracked monthly nodes; do not remove those mechanisms.
- Content script also reads `originalDaysOnSale` from `__NEXT_DATA__` and appends `, всего N дней в продаже` to matching card stats.
- `tests/content.test.js` executes the content script source in JSDOM; if the content script uses new browser APIs, its local browser mock must be extended.
- `tests/background.test.js` imports `src/background.js` after `vi.hoisted()` globals because background code registers browser listeners at module load time.
