# AGENTS.md

## Repository overview

Cross-browser WebExtension (Manifest V3) for Firefox and Chrome-based browsers. It replaces BYN prices on AV.by with USD/EUR/RUB equivalents from the NBRB API, provides a Russian-language popup with rates and a converter, supports custom rate overrides per currency, and supports an optional VIN sharing feature through a separate Cloudflare Worker in `worker/`.

Rates are offline-resilient: failed refreshes must preserve the last valid cached rates in `browser.storage.local`. Custom rate overrides are stored separately under `customRates` and cleared when NBRB rates are refreshed.

## Where to work

```text
src/
├── background.js          # Background event page: NBRB fetch, alarms, storage, messaging, VIN proxy, custom rates
├── lib/
│   └── rates.js           # Pure parsing/conversion/formatting logic; no browser APIs
├── content/
│   ├── AGENTS.md          # Content-script-specific DOM and AV.by rules
│   └── avby.js            # Self-contained AV.by content script IIFE
└── popup/
    ├── AGENTS.md          # Popup-local UI, storage, and test rules
    ├── popup.html         # Russian popup markup
    ├── popup.css          # Popup styling with light/dark theme support
    └── popup.js           # Popup controller, custom rate editing, storage, messages

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
release-notes/             # Per-version bilingual release notes (v1.2.0–v1.5.0)
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
- `src/content/avby.js` is a self-contained IIFE, not an ES module. It duplicates `parseBynPrice`, `convertFromBYN`, `formatDisplayPrice`, and `formatDisplayPriceRange` from `src/lib/rates.js`; keep all copies in sync.
- `manifest.json` is the source manifest. `scripts/build-chrome.mjs` generates the Chrome build manifest in `build/chrome/`.
- Source entrypoints use `globalThis.browser ??= globalThis.chrome;` for Firefox/Chrome API compatibility.
- `worker/` is an independent Cloudflare Worker project with its own `package.json`, TypeScript config, Vitest config, and Wrangler deployment.

## Change rules

- Failed NBRB responses must update `lastError` only; never overwrite previously valid `ratesData` on failure.
- `parseRates` expects NBRB PascalCase fields: `Cur_Abbreviation`, `Cur_Scale`, `Cur_OfficialRate`.
- RUB has `Cur_Scale` 100; conversion must account for `scale` in both directions.
- `TARGET_CURRENCIES` is `["USD", "EUR", "RUB"]`; missing any of the three makes `parseRates` return `null`.
- Custom rates are stored under `customRates` (shape: `{ USD: 3.1 }`) — never written into `ratesData`. The `getRateInfo` / `getEffectiveRates` helpers merge at read time: `customRates[code] ?? ratesData.rates[code].rate`.
- `refreshRates` clears `customRates` to `{}` after a successful NBRB fetch.
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
- `DESIGN.md` — UI design rules, visual language, components, interaction rules, and Russian string preservation.
- `README.md` — user-facing Russian documentation, module summary, privacy notes, extension links.
- `VIN-LOGIC.md` — user-facing explanation of optional VIN sharing behavior.
- `CUSTOM-RATES-PLAN.md` — execution plan for the custom rates feature (implemented).
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
- Background message actions: `ensureRates`, `getRates`, `refreshRates`, `getEffectiveRates`, `saveCustomRate`, `clearCustomRate`, `clearCustomRates`, `getCustomRates`, `getVinForPage`, `submitVinForPage`.
- Coverage thresholds in `vitest.config.js` apply to `src/**/*.js` except `src/content/**` and `src/popup/**`, so `src/lib/rates.js` and `src/background.js` must stay at or above 80% for lines, functions, branches, and statements.
