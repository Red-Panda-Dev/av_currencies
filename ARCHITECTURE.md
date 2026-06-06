# Architecture

## 1. High-Level Overview

**AV.by Валюты** is a cross-browser WebExtension (Manifest V3) for Firefox and Chrome-based browsers. It replaces BYN prices on AV.by (`https://*.av.by/*`) with USD/EUR/RUB equivalents using official rates from the National Bank of the Republic of Belarus (NBRB) API. A Russian-language popup shows current rates, a currency converter, display-currency selection, and custom rate overrides. An optional VIN-sharing feature lets users crowdsource vehicle identification numbers through a separate Cloudflare Worker backend.

The repository contains two loosely coupled projects: the browser extension (`src/`, `manifest.json`) and the VIN Worker (`worker/`). They share no code and communicate only over HTTPS at runtime. The extension is offline-resilient — failed NBRB responses never overwrite previously valid cached rates stored in `browser.storage.local`.

Evidence anchors: `manifest.json` (MV3, permissions, entrypoints), `src/background.js` (NBRB fetch, alarms, VIN proxy), `src/content/avby.js` (content script IIFE), `src/popup/` (popup UI), `src/lib/rates.js` (pure logic), `worker/wrangler.toml` (Cloudflare Worker config).

## 2. System Architecture (Logical)

Five logical components:

1. **Pure logic** (`src/lib/rates.js`) — parsing, conversion, and formatting functions with zero browser or Node API dependencies. Shared by background and popup via ES imports; manually duplicated into the content script.
2. **Background service** (`src/background.js`) — sole owner of all network `fetch` calls. Fetches NBRB rates on install, startup, and a 240-minute alarm. Stores `ratesData`, `lastError`, and `customRates` in `browser.storage.local`. Proxies VIN read/write to the Cloudflare Worker. Handles extension-internal messages from popup and content script.
3. **Content script** (`src/content/avby.js`) — self-contained IIFE injected on AV.by pages. Reads rates and user preferences from storage, replaces BYN prices in the DOM via `MutationObserver`, and optionally renders VIN UI. Never makes network requests.
4. **Popup UI** (`src/popup/`) — action popup with rates display, converter, display-currency selector, custom rate editing, and VIN toggle. Communicates with background via `browser.runtime.sendMessage`; imports pure helpers from `src/lib/rates.js`.
5. **VIN Worker** (`worker/`) — independent Cloudflare Worker (TypeScript) deployed at `https://avby.currencies-bel.top`. Stores VIN records in Cloudflare KV. The extension never imports Worker code; the boundary is HTTP only.

Dependency direction:

```
NBRB API  ──fetch──▶  background.js  ──sendMessage──▶  popup.js
                         │                                │
                    storage.local                    lib/rates.js
                         │
                    storage.local
                         │
                    sendMessage
                         │
                         ▼
                    content/avby.js

Cloudflare Worker  ◀──fetch──  background.js  (VIN only)
```

Key boundaries:

- `src/lib/rates.js` has no `browser.*`, `document`, `fetch`, or `window` references.
- All `fetch` calls live in `src/background.js` only — popup and content script never make network requests.
- Popup and background communicate only via `browser.runtime.sendMessage` — they never import one another.
- Content script is an IIFE, not an ES module — it duplicates helpers from `src/lib/rates.js` rather than importing them.
- `worker/` is a fully independent project with its own `package.json`, `tsconfig.json`, and test suite — no source-level dependency on the extension.

## 3. Code Map (Physical)

```
src/
├── background.js           # Background event page: NBRB fetch, alarms, storage, messaging, VIN proxy, custom rates
├── lib/
│   └── rates.js            # Pure parsing/conversion/formatting logic — no browser APIs
├── content/
│   ├── AGENTS.md           # Content-script boundaries and DOM rules
│   └── avby.js             # Self-contained IIFE for AV.by price replacement and VIN UI
└── popup/
    ├── AGENTS.md           # Popup-local UI and storage rules
    ├── popup.html          # Russian popup markup
    ├── popup.css           # Styling with light/dark theme support
    └── popup.js            # Popup controller: rates, converter, custom rates, storage, messages

worker/                     # Independent Cloudflare Worker project (TypeScript)
├── src/
│   ├── index.ts            # Fetch handler, CORS, routing
│   ├── crypto.ts           # Request identity hashing
│   ├── storage.ts          # KV read/write and confirmation bookkeeping
│   ├── types.ts            # Env and VIN record types
│   └── validation.ts       # pageId, VIN, pageUrl validation
├── test/
│   └── worker.test.ts      # Worker endpoint, validation, CORS, storage tests
├── wrangler.toml           # Routes, KV binding, secrets, observability
└── deploy.sh               # Build + wrangler deploy

tests/
├── AGENTS.md               # Test harness and mocking conventions
├── parse.test.js           # lib/rates.js pure-function tests
├── background.test.js      # Background tests with hoisted browser/fetch mocks
├── content.test.js         # JSDOM content-script tests using AV.by fixtures
└── popup.test.js           # JSDOM popup tests using popup markup

scripts/
├── build-chrome.mjs        # Chrome build: copies files, transforms manifest, writes install note
├── build-firefox.mjs       # Firefox build: copies files, creates zip
└── package-utils.mjs       # Shared: zip creation, AGENTS.md stripping from packages

examples/                   # NBRB API fixture and saved AV.by HTML pages for tests
icons/                      # Extension icons
```

Source manifest: `manifest.json` (Firefox). Chrome manifest is generated by `scripts/build-chrome.mjs` into `build/chrome/manifest.json`.

Generated artifacts (do not hand-edit): `build/firefox/`, `build/chrome/`, `coverage/`, `worker/coverage/`, `av-currencies-firefox.zip`, `av-currencies-chrome.zip`.

## 4. Life of a Request / Primary Data Flow

### Rate Fetching and Caching

```
NBRB API ──fetch (10s timeout)──▶ background.js :: fetchRates()
    │
    ▼  parseRates() [src/lib/rates.js]
    { USD, EUR, RUB } with code, name, scale, rate
    │
    ▼  browser.storage.local.set()
    { ratesData: {base, source, fetchedAt, ratesDate, rates}, lastError: null, customRates: {} }
```

On failure, `fetchRates()` writes only `lastError` — `ratesData` is never overwritten. Custom rates are cleared to `{}` after a successful NBRB fetch.

Fetch triggers (Observed in `src/background.js`): `runtime.onInstalled`, `runtime.onStartup`, `alarms.onAlarm` (every 240 min), content-script `ensureRates` message (if no cached data), popup `refreshRates` message (force bypass).

### Content-Script Price Replacement

```
AV.by page loads → document_idle → avby.js IIFE init
    │
    ├─ storage.local.get(["ratesData", "selectedCurrency", "customRates"])
    ├─ sendMessage({ action: "ensureRates" }) if no ratesData
    ├─ scheduleApply() → requestAnimationFrame → applyAll()
    ├─ MutationObserver on document.body (childList, subtree, characterData)
    └─ storage.onChanged listener → re-apply on ratesData / selectedCurrency / customRates changes
```

For each price element: parse BYN amount → convert via `(amount × scale) / rate` (with custom override if set) → format → write `textContent`. Original text preserved in `dataset` and `WeakMap` for BYN restoration.

### Popup Communication

Popup sends `browser.runtime.sendMessage` with actions: `getRates`, `refreshRates`, `saveCustomRate`, `clearCustomRate`, `clearCustomRates`, `getCustomRates`, `getEffectiveRates`. Background responds from storage or triggers a fetch. Custom rate overrides merge at read time: `customRates[code] ?? ratesData.rates[code].rate`.

### VIN Feature Flow

Content script reads `vinFeatureEnabled` from storage (defaults off). When enabled on an AV.by car page:

```
content/avby.js
    ├─ sendMessage({ action: "getVinForPage", pageId })  →  background.js
    │   └─ fetchVinForPage()  →  GET https://avby.currencies-bel.top/api/vin/{pageId}
    └─ sendMessage({ action: "submitVinForPage", ... })  →  background.js
        └─ submitVinForPage()  →  POST https://avby.currencies-bel.top/api/vin
```

Worker stores/retrieves VINs in Cloudflare KV (`VIN_DATA` binding). Request identity is hashed with `IDENTITY_SALT` — raw IP/User-Agent are never stored.

## 5. Architectural Invariants & Constraints

- Rule: `src/lib/rates.js` must remain importable in plain Node.js without mocks or polyfills.
  - Rationale: Enables testing pure logic directly and guarantees zero browser coupling.
  - Enforcement / Signals (Observed): No `browser.*`, `document`, `fetch`, or `window` references in the file.

- Rule: All network `fetch` calls live in `src/background.js` only.
  - Rationale: Centralizes network access, enables offline resilience, enforces security boundary.
  - Enforcement / Signals (Observed): `fetch` appears only in `src/background.js`; popup uses `sendMessage`; content script reads from storage.

- Rule: Popup and background communicate only via `browser.runtime.sendMessage`.
  - Rationale: Prevents circular dependencies and maintains clear separation.
  - Enforcement / Signals (Observed): No direct imports between `src/popup/popup.js` and `src/background.js`.

- Rule: Popup uses `textContent` exclusively — never `innerHTML`.
  - Rationale: XSS prevention from untrusted rate data.
  - Enforcement / Signals (Observed): All DOM updates in `src/popup/popup.js` use `textContent` and form properties.

- Rule: Content script is a self-contained IIFE with no ES module `import`/`export`.
  - Rationale: MV3 content scripts run in isolated world without module support.
  - Enforcement / Signals (Observed): `src/content/avby.js` is an IIFE; duplicates helpers from `src/lib/rates.js`.

- Rule: Duplicated helpers (`parseBynPrice`, `convertFromBYN`, `formatDisplayPrice`, `formatDisplayPriceRange`) must stay behaviorally aligned between `src/lib/rates.js` and `src/content/avby.js`.
  - Rationale: Consistent conversion and formatting across extension surfaces.
  - Enforcement / Signals (Observed): Documented in `src/content/AGENTS.md`; tests cover both implementations.

- Rule: Failed API responses never overwrite previously valid `ratesData`.
  - Rationale: Offline resilience — stale rates remain usable during network failures.
  - Enforcement / Signals (Observed): `src/background.js` writes only `lastError` on failure; `ratesData` untouched.

- Rule: Custom rates are stored separately under `customRates` — never written into `ratesData`. They are cleared to `{}` after a successful NBRB fetch.
  - Rationale: Keeps authoritative NBRB data clean; overrides are transient.
  - Enforcement / Signals (Observed): `getEffectiveRates` in `src/background.js` merges at read time; `refreshRates` clears `customRates`.

- Rule: `manifest.json` is the source-of-truth manifest. Chrome manifest is generated by `scripts/build-chrome.mjs`.
  - Rationale: Single source of truth prevents Firefox/Chrome manifest divergence.
  - Enforcement / Signals (Observed): Build script reads and transforms `manifest.json` for Chrome output.

- Rule: Host permissions are limited to NBRB API and VIN Worker API only.
  - Rationale: Minimal permission principle for browser extensions.
  - Enforcement / Signals (Observed): `manifest.json` lists exactly `https://api.nbrb.by/*` and `https://avby.currencies-bel.top/api/*`.

- Rule: `worker/` is an independent project — no source-level dependency on the extension.
  - Rationale: Separate deployment lifecycle, runtime, and language (TypeScript vs plain JS).
  - Enforcement / Signals (Observed): Own `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.toml`.

## 6. Documentation Strategy

- `ARCHITECTURE.md` (this file) — global map: component model, data flow, architectural boundaries, and invariants.
- `AGENTS.md` — repository-level conventions, change rules, where to work, and validation commands.
- `DESIGN.md` — UI design rules, visual language, interaction patterns, and Russian string preservation.
- `README.md` — user-facing Russian documentation, module summary, privacy notes, extension store links.
- `VIN-LOGIC.md` — user-facing explanation of optional VIN sharing behavior.

Module-level documentation:

- `src/content/AGENTS.md` — content-script DOM rules, invariants, safe change rules.
- `src/popup/AGENTS.md` — popup-local UI, storage, custom rate editing, and test rules.
- `tests/AGENTS.md` — test harness conventions and mocking details.
- `worker/AGENTS.md` — Worker boundaries, KV storage, deployment, and validation.
- `worker/README.md` — Worker business logic, API base URL, CORS, secrets.

What belongs where:

- Global architecture, cross-cutting concerns, and invariants → `ARCHITECTURE.md`.
- Repository-specific conventions and validation → `AGENTS.md`.
- Module-specific boundaries and implementation notes → module-level `AGENTS.md`.
- User-facing documentation and usage → `README.md`.
- UI design rules and visual language → `DESIGN.md`.
