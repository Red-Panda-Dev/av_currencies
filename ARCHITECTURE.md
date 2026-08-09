# Architecture

## 1. High-Level Overview

**AV.by Валюты** is a cross-browser WebExtension (Manifest V3) for Firefox and Chrome-based browsers. It replaces BYN prices on AV.by (`https://*.av.by/*`) with USD/EUR/RUB equivalents sourced from the National Bank of the Republic of Belarus (NBRB) API, and ships a Russian-language popup with current rates, a converter, display-currency selection, and custom rate overrides. An optional VIN-sharing feature crowdsources vehicle identification numbers through a separate Cloudflare Worker backend.

The repository contains two loosely coupled projects that share no code and interact only over HTTPS at runtime: the browser extension (`src/`, `manifest.json`) and the VIN Worker (`worker/`). The extension is offline-resilient — failed NBRB responses write only `lastError` and never overwrite previously valid cached rates in `browser.storage.local`.

The overarching paradigm is a single privileged background service that owns all network access and storage, with a sandboxed content script and an action popup as UI-only frontends that communicate with it exclusively through `browser.runtime.sendMessage`. Pure parsing/conversion/formatting logic is isolated in one Node-importable module.

Evidence anchors: `manifest.json` (MV3, permissions, entrypoints), `src/background.js` (NBRB fetch, 240-min alarm, storage, messaging, VIN proxy), `src/content/avby.js` (content-script IIFE), `src/popup/popup.js` (popup controller), `src/lib/rates.js` (pure logic), `worker/wrangler.toml` (Cloudflare Worker config).

## 2. System Architecture (Logical)

### Pure conversion logic

- Responsibility: NBRB parsing, BYN↔target conversion (with `scale` handling), and display formatting. No I/O, no browser API coupling.
- Code locations: `src/lib/rates.js`.
- Entry points: `parseRates`, `convertFromBYN`, `formatDisplayPrice`, plus `parseBynPrice`/`convertFromBYN`/`formatDisplayPrice*` helpers consumed by the content script.
- Depends on: nothing (plain ES module).
- Must not depend on: `browser.*`, `document`, `fetch`, `window`.
- Owns: `TARGET_CURRENCIES = ["USD","EUR","RUB"]` and the conversion contract `(amount × scale) / rate`.
- State and external boundaries: stateless.
- Evidence: `src/lib/rates.js` (exports only, no imports); imported by `src/background.js` and `src/popup/popup.js`.

### Background service

- Responsibility: Sole owner of network `fetch`. Fetches NBRB rates on install, startup, and a 240-minute alarm. Persists `ratesData`, `lastError`, `customRates` to `browser.storage.local`. Merges custom overrides at read time. Proxies VIN read/write to the Cloudflare Worker. Routes all extension-internal messages.
- Code locations: `src/background.js`.
- Entry points: MV3 background module (`manifest.json` → `background.scripts`), `browser.runtime.onInstalled` / `onStartup`, `browser.alarms.onAlarm`, `browser.runtime.onMessage`.
- Depends on: `src/lib/rates.js`; NBRB API; VIN Worker API.
- Must not depend on: DOM / `document`.
- Owns: `ratesData`, `lastError`, `customRates`, alarm schedule, the 10 message actions (`ensureRates`, `getRates`, `refreshRates`, `getEffectiveRates`, `saveCustomRate`, `clearCustomRate`, `clearCustomRates`, `getCustomRates`, `getVinForPage`, `submitVinForPage`).
- State and external boundaries: `https://api.nbrb.by/*` and `https://avby.currencies-bel.top/api/*`.
- Evidence: `src/background.js` (`API_URL`, `ALARM_INTERVAL_MINUTES = 240`, `VIN_WORKER_API_BASE`, `onMessage` switch).

### Content script

- Responsibility: Price replacement on AV.by pages and optional days-on-sale restoration. Reads rates/preferences from storage, rewrites BYN `textContent` to the selected currency via `MutationObserver`, and reacts to `storage.onChanged`. Optionally renders VIN UI. Makes no network requests.
- Code locations: `src/content/avby.js`.
- Entry points: MV3 content script (`manifest.json` → `content_scripts`, `run_at: document_idle`).
- Depends on: `browser.storage.local`, `browser.runtime.sendMessage`; a manual duplicate of pure helpers from `src/lib/rates.js`.
- Must not depend on: ES `import`/`export`, `fetch`, or `src/lib/rates.js` at runtime.
- Owns: original-text restoration state (`dataset` fields, `WeakMap` for text nodes, tracked monthly nodes), `__NEXT_DATA__` `originalDaysOnSale` → `, всего N дней в продаже` annotation.
- State and external boundaries: AV.by DOM only; talks to the extension only via storage and messaging.
- Evidence: `src/content/avby.js` (IIFE `(function initAvByCurrencyConversion(){…})()`, `globalThis.browser ??= globalThis.chrome`, `MutationObserver`, `storage.onChanged`, `__NEXT_DATA__`).

### Popup UI

- Responsibility: Russian-language action popup — rates display, converter, display-currency selector, custom-rate editing, and VIN toggle. DOM updates use `textContent` exclusively.
- Code locations: `src/popup/` (`popup.html`, `popup.css`, `popup.js`).
- Entry points: MV3 action popup (`manifest.json` → `action.default_popup`).
- Depends on: `src/lib/rates.js`; background service via `browser.runtime.sendMessage`.
- Must not depend on: `fetch`, or any direct import of `src/background.js`.
- Owns: ephemeral converter/custom-rate form state; no persistent state of its own (writes through to `customRates`/`vinFeatureEnabled` via the background).
- State and external boundaries: its own DOM only.
- Evidence: `src/popup/popup.js` (imports from `../lib/rates.js`, 0 `innerHTML`, 13 `textContent`, `sendMessage` calls).

### VIN Worker

- Responsibility: Independent Cloudflare Worker (TypeScript) that stores and serves VIN records keyed by AV.by `pageId`, with write/read confirmation bookkeeping and request-identity hashing.
- Code locations: `worker/src/` (`index.ts`, `crypto.ts`, `storage.ts`, `validation.ts`, `types.ts`).
- Entry points: `worker/src/index.ts` fetch handler, deployed at `https://avby.currencies-bel.top`.
- Depends on: Cloudflare KV (`VIN_DATA`), Cloudflare Secrets Store (`IDENTITY_SALT`); the extension as its only documented client.
- Must not depend on: any extension source.
- Owns: VIN record shape, confirmation counters, CORS allowlist (`chrome-extension://*`, `moz-extension://*`).
- State and external boundaries: HTTPS boundary only; no shared code with the extension.
- Evidence: `worker/wrangler.toml` (routes, KV + secret bindings, observability), `worker/package.json`, `worker/README.md`.

Dependency direction:

```text
NBRB API ──fetch──▶ background.js ──sendMessage──▶ popup.js
                       │  │                            │
                       │  └──storage.local─────────────┤
                       │                               │ import
                       │                               ▼
                       │                          lib/rates.js (pure)
                       │                               ▲
                       └──storage.local──▶ content/avby.js  duplicate (no import)

VIN Worker ◀──fetch── background.js   (VIN read/write proxy)
```

## 3. Code Map (Physical)

```text
src/
├── background.js         # Background module: NBRB fetch, alarm, storage, messaging, VIN proxy, custom rates
├── lib/
│   └── rates.js          # Pure parsing/conversion/formatting — no browser APIs
├── content/
│   ├── AGENTS.md         # Content-script DOM rules and invariants
│   └── avby.js           # Self-contained IIFE: price replacement, days-on-sale, VIN UI
└── popup/
    ├── AGENTS.md         # Popup-local UI, storage, and test rules
    ├── popup.html        # Russian popup markup
    ├── popup.css         # Styling with light/dark theme support
    └── popup.js          # Popup controller: rates, converter, custom rates, messages

worker/                   # Independent Cloudflare Worker project (TypeScript)
├── src/                  # index.ts (CORS/routing), crypto.ts, storage.ts, validation.ts, types.ts
├── test/worker.test.ts   # Worker endpoint, validation, CORS, storage tests
├── wrangler.toml         # Routes, KV + secret bindings, observability
└── deploy.sh             # Build (tsc --noEmit) then wrangler deploy

tests/                    # parse / background / content / popup suites (AGENTS.md documents harness)
scripts/                  # build-chrome.mjs, build-firefox.mjs, package-utils.mjs (zip + AGENTS stripping)
examples/                 # NBRB fixture and saved AV.by HTML for tests
icons/                    # Extension icons
```

Source manifest: `manifest.json` (Firefox). The Chrome manifest is generated by `scripts/build-chrome.mjs` into `build/chrome/manifest.json`.

Generated artifacts (do not hand-edit): `build/firefox/`, `build/chrome/`, `coverage/`, `worker/coverage/`, `av-currencies-firefox.zip`, `av-currencies-chrome.zip`.

## 4. Life of a Request / Primary Data Flow

### Rate fetching and caching (background)

1. Trigger: `runtime.onInstalled`, `runtime.onStartup`, `alarms.onAlarm` (240 min), or popup `refreshRates` / content `ensureRates` message.
2. Entry point: `fetchRates({ force })` in `src/background.js`.
3. Coordination: in-flight de-duplication via `fetchInProgress` unless `force`; 10 s `AbortController` timeout.
4. Core or domain processing: `parseRates(data)` in `src/lib/rates.js` — requires all of USD/EUR/RUB or returns `null`.
5. Persistence or external interaction: on success, `storage.local.set({ ratesData, lastError: null })`; on failure, `storage.local.set({ lastError })` only — `ratesData` is never overwritten. `refreshRates` also resets `customRates` to `{}`.
6. Output or side effect: cached rates available to popup and content script via `storage.onChanged`.

Architectural boundaries crossed: NBRB API → background → `lib/rates.js` → `storage.local`.
Evidence: `src/background.js` (`fetchRates`, `getEffectiveRates`), `src/lib/rates.js`.

### Content-script price replacement (interactive)

1. Trigger: AV.by page load (`document_idle`) or `storage.onChanged` for `ratesData` / `selectedCurrency` / `customRates`.
2. Entry point: `avby.js` IIFE `init()`; sends `ensureRates` if no cached `ratesData`.
3. Coordination: `requestAnimationFrame(scheduleApply)` and a `MutationObserver` on `document.body` (childList/subtree/characterData).
4. Core or domain processing: per price element — parse BYN, convert via the duplicated pure helpers (custom override applied when set), format, write `textContent`; original text preserved in `dataset`/`WeakMap`. Separately, `applyOriginalDaysOnSale()` reads `__NEXT_DATA__` and appends the days-in-sale annotation.
5. Persistence or external interaction: reads `storage.local` only; no `fetch`.
6. Output or side effect: AV.by DOM rewritten in place; reversible to original BYN.

Architectural boundaries crossed: `storage.local` → content script → AV.by DOM (isolated world).
Evidence: `src/content/avby.js`.

### VIN submit/read (cross-project HTTP)

1. Trigger: user enables `vinFeatureEnabled` (default off) and acts on an AV.by car page.
2. Entry point: `getVinForPage` / `submitVinForPage` messages from the content script.
3. Coordination: `src/background.js` proxy handlers.
4. Core or domain processing: background issues `GET /api/vin/{pageId}` or `POST /api/vin`; Worker validates payload (`pageId`, `vin`, `pageUrl`), resolves create/confirm/conflict, and hashes request identity with `IDENTITY_SALT` (raw IP/User-Agent are not stored).
5. Persistence or external interaction: Cloudflare KV (`VIN_DATA`).
6. Output or side effect: VIN record returned to the content script for rendering.

Architectural boundaries crossed: content script → background (sendMessage) → HTTPS → Worker → KV.
Evidence: `src/background.js` (`fetchVinForPage`, `submitVinForPage`), `worker/src/index.ts`, `worker/wrangler.toml`.

## 5. Architectural Invariants & Constraints

- Rule: `src/lib/rates.js` has no `browser.*`, `document`, `fetch`, or `window` references and stays importable in plain Node.js.
  - Rationale: Keeps conversion logic testable without mocks and guarantees zero browser coupling.
  - Enforcement / Signals: Source has exports only; `tests/parse.test.js` imports it directly.

- Rule: All network `fetch` calls live in `src/background.js` only.
  - Rationale: Centralizes network access behind the privileged service, enabling offline resilience and the minimal host-permission surface.
  - Enforcement / Signals: No `fetch` in `src/popup/popup.js` or `src/content/avby.js`; popup/content use `sendMessage` and storage.

- Rule: Popup and background communicate only via `browser.runtime.sendMessage` (no mutual imports).
  - Rationale: Prevents circular coupling across the UI/service boundary.
  - Enforcement / Signals: `src/popup/popup.js` imports only `src/lib/rates.js`; background exposes the 10 `onMessage` actions.

- Rule: Popup DOM updates use `textContent` exclusively — never `innerHTML` or inline handlers.
  - Rationale: XSS defense against untrusted rate data.
  - Enforcement / Signals: 0 `innerHTML` occurrences and 13 `textContent` occurrences in `src/popup/popup.js`.

- Rule: The content script is a self-contained IIFE with no ES module `import`/`export`.
  - Rationale: MV3 content scripts execute in an isolated world without module support.
  - Enforcement / Signals: `src/content/avby.js` is `(function initAvByCurrencyConversion(){…})()` with no imports/exports.

- Rule: The pure helpers duplicated into the content script (`parseBynPrice`, `convertFromBYN`, `formatDisplayPrice`, `formatDisplayPriceRange`) must stay behaviorally aligned with `src/lib/rates.js`.
  - Rationale: Consistent conversion/formatting across surfaces that cannot share the module.
  - Enforcement / Signals: Convention documented in `src/content/AGENTS.md`; both implementations are covered by `tests/`.

- Rule: Failed API responses never overwrite previously valid `ratesData`; only `lastError` is written.
  - Rationale: Offline resilience — stale rates remain usable during network failures.
  - Enforcement / Signals: The `catch` path in `fetchRates` sets only `lastError`.

- Rule: Custom overrides live under `customRates`, separate from `ratesData`, merged at read time and cleared to `{}` after a successful forced refresh.
  - Rationale: Keeps authoritative NBRB data clean; overrides are transient.
  - Enforcement / Signals: `getEffectiveRates` applies `overrides[code] ?? info.rate`; `refreshRates` resets `customRates`.

- Rule: `manifest.json` is the source-of-truth manifest; the Chrome manifest is generated.
  - Rationale: Prevents Firefox/Chrome manifest divergence.
  - Enforcement / Signals: `scripts/build-chrome.mjs` reads and transforms `manifest.json` into `build/chrome/manifest.json`.

- Rule: Extension `host_permissions` are limited to the NBRB API and the VIN Worker API.
  - Rationale: Minimal-permission principle for a browser extension.
  - Enforcement / Signals: `manifest.json` lists exactly `https://api.nbrb.by/*` and `https://avby.currencies-bel.top/api/*`.

- Rule: `worker/` is an independent project with no source-level dependency on the extension.
  - Rationale: Separate deployment lifecycle, runtime, and language (TypeScript vs plain JS).
  - Enforcement / Signals: Own `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.toml`; the only link is the HTTPS boundary.

- Rule: `src/lib/rates.js` and `src/background.js` must each stay at or above 80% coverage (lines, functions, branches, statements).
  - Rationale: Protects the two load-bearing modules that carry the conversion contract and all network/state logic.
  - Enforcement / Signals: `vitest.config.js` coverage `include` covers `src/**/*.js` excluding `src/content/**` and `src/popup/**`, with 80% thresholds enforced via `npm test`.

## 6. Documentation Strategy

- `ARCHITECTURE.md` (this file) owns the global architecture map: component model, representative data flows, and architectural invariants.
- `AGENTS.md` owns repository-wide agent operating rules, change rules, where-to-work routing, and validation commands; child `AGENTS.md` files (`src/content/AGENTS.md`, `src/popup/AGENTS.md`, `tests/AGENTS.md`, `worker/AGENTS.md`) carry local instruction deltas.
- `DESIGN.md` owns UI design rules, visual language, interaction patterns, and Russian UX copy.
- `README.md` owns user-facing Russian documentation, privacy notes, and store links.
- `VIN-LOGIC.md` owns the user-facing explanation of optional VIN sharing.
- `worker/README.md` owns Worker business logic, the API base URL, CORS, and secret bindings.

Local boundaries vs. global architecture: cross-cutting concerns and invariants belong here; module-specific boundaries belong in the nearest `AGENTS.md`; user-facing behavior belongs in `README.md` / `DESIGN.md` / `VIN-LOGIC.md`. No additional architecture, ADR, or runbook documents exist in the repository.
