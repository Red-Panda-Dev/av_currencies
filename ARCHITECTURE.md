# Architecture

## 1. High-Level Overview

**AV.by Валюты** is a cross-browser WebExtension (Manifest V3) for Firefox and Chrome-based browsers. It replaces BYN prices on AV.by with USD/EUR/RUB equivalents using official rates from the National Bank of the Republic of Belarus (NBRB) API. The extension also provides a popup with current exchange rates and a currency converter. All UI strings are in Russian.

The extension is offline-resilient: cached rates persist in `browser.storage.local` and survive network failures. When the network is unavailable, previously stored rates continue to be used and a warning is shown.

Observed: `manifest.json` (Manifest V3), `src/background.js` (background event page), `src/content/avby.js` (content script), `src/popup/` (popup UI), `src/lib/rates.js` (pure logic).

## 2. System Architecture (Logical)

```
┌─────────────────────────────────────────────────────────────────┐
│                        NBRB API                                 │
│            https://api.nbrb.by/exrates/rates                    │
└─────────────────────────────────────────────────────────────────┘
                              │ fetch (only here)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     background.js                               │
│  • Fetches rates on install, startup, and alarm (240 min)       │
│  • Parses API response via lib/rates.js                         │
│  • Stores ratesData + lastError in browser.storage.local        │
│  • Handles messages: ensureRates, refreshRates, getRates        │
│  • Proxies VIN requests to Cloudflare Worker                    │
└──────────┬──────────────────────────────┬───────────────────────┘
           │                              │
           │ browser.storage.local        │ browser.runtime.sendMessage
           │ (read)                       │ (popup↔background, content↔background)
           ▼                              ▼
┌──────────────────────────┐   ┌─────────────────────────────────┐
│    content/avby.js       │   │       popup/popup.js            │
│  • Reads ratesData from  │   │  • Shows rates via getRates     │
│    browser.storage.local │   │  • Refreshes via refreshRates   │
│  • Sends ensureRates if  │   │  • Currency converter           │
│    no cached rates       │   │  • Display currency selector    │
│  • MutationObserver on   │   │  • Uses textContent only        │
│    document.body         │   │    (no innerHTML — XSS safe)    │
│  • Replaces BYN prices   │   └─────────────────────────────────┘
│    in the DOM            │
│  • Self-contained IIFE   │   ┌─────────────────────────────────┐
│    (no ES imports)       │   │       lib/rates.js              │
└──────────────────────────┘   │  • Pure logic, zero browser deps│
                                │  • parseRates, convert, format  │
                                │  • Shared by background + popup │
                                └─────────────────────────────────┘
```

**Key Boundaries:**
- `lib/rates.js` has zero browser API dependencies — no `browser.*`, `document`, `fetch`, or `window` references
- Background and popup communicate only via `browser.runtime.sendMessage` — never import one from the other
- All `fetch` calls live in `background.js` only — popup and content script never make network requests
- Content script is a self-contained IIFE — cannot use ES module `import`/`export` (MV3 content scripts run in isolation)
- Popup uses `textContent` exclusively — never `innerHTML` (XSS prevention)

## 3. Code Map (Physical)

```
src/
├── background.js           # Background event page: fetch, alarms, storage, messaging, VIN proxy
├── lib/
│   └── rates.js            # Pure logic: parsing, conversion, formatting — no browser APIs
├── content/
│   └── avby.js             # AV.by content script: DOM price replacement (self-contained IIFE)
└── popup/
    ├── popup.html          # Popup markup
    ├── popup.css           # Styling with light/dark theme support
    └── popup.js            # Popup controller: render, converter, refresh

scripts/
├── build-chrome.mjs        # Chrome build: copies files, transforms manifest, writes install note
├── build-firefox.mjs       # Firefox build: copies files, creates zip
└── package-utils.mjs       # Shared: zip creation, AGENTS.md stripping

tests/
├── parse.test.js           # Vitest tests for lib/rates.js
├── content.test.js         # Vitest + jsdom tests for content/avby.js
└── background.test.js      # Vitest tests for background.js (vi.hoisted mocks for browser/fetch)

examples/                   # Test fixtures: NBRB API response, saved AV.by HTML pages

manifest.json               # Extension manifest (Firefox source-of-truth)
package.json                # Project metadata and scripts
vitest.config.js            # Vitest config with 80% coverage threshold on lib/ and background.js
Makefile                    # Build/run/lint/test commands

icons/                      # Extension icons
```

**Generated artifacts (do not hand-edit):**
```
build/firefox/               # Firefox packaging directory
build/chrome/                # Chrome packaging directory with generated manifest.json
av-currencies-firefox.zip    # Firefox package
av-currencies-chrome.zip     # Chrome-based package
```

## 4. Life of a Request / Primary Data Flow

### Rate Fetching and Storage

```
NBRB API (https://api.nbrb.by/exrates/rates?periodicity=0)
  │
  ▼  fetch (10s timeout) [src/background.js:108]
background.js :: fetchRates()
  │
  ▼  parseRates() [src/lib/rates.js:7]
  { USD: {code, name, scale, rate}, EUR: {...}, RUB: {...} }
  │
  ▼  browser.storage.local.set() [src/background.js:126]
  { ratesData: {base, source, sourceUrl, fetchedAt, ratesDate, rates}, lastError: null }
```

On failure, `fetchRates()` stores only `lastError` — **never overwriting previously valid `ratesData`**. This ensures offline resilience: stale rates remain usable.

### Triggers for Rate Fetching

| Event | Action | Location |
|---|---|---|
| `runtime.onInstalled` | `ensureAlarm()` + `fetchRates()` | `src/background.js:170` |
| `runtime.onStartup` | `ensureAlarm()` + `fetchRates()` | `src/background.js:175` |
| `alarms.onAlarm` (every 240 min) | `fetchRates()` | `src/background.js:180` |
| Content script `ensureRates` message | `fetchRates()` only if no `ratesData` in storage | `src/background.js:187` |
| Popup `refreshRates` message | `fetchRates({ force: true })` — bypasses in-flight dedup | `src/background.js:200` |

### Content Script Price Replacement

```
av.by page loads
  │
  ▼  document_idle
content/avby.js :: init() [src/content/avby.js:3]
  │
  ├─ browser.storage.local.get(["ratesData", "selectedCurrency"])
  │   → stores in module-level vars
  │
  ├─ requestRatesIfMissing()
  │   → sends { action: "ensureRates" } to background if no ratesData
  │
  ├─ scheduleApply()
  │   → requestAnimationFrame → applyAll()
  │
  ├─ setupObserver()
  │   → MutationObserver on document.body
  │   → { childList: true, subtree: true, characterData: true }
  │
  └─ setupStorageListener()
      → reacts to ratesData / selectedCurrency changes
      → triggers scheduleApply() on change
```

For each price element matching selector categories:
1. Read original BYN text from `dataset.avCurrenciesOriginalText` (set on first access)
2. Parse BYN amount via duplicated `parseBynPrice()`
3. Convert: `convertFromBYN(amount, rateInfo)` → `(amount × scale) / rate`
4. Format: `formatDisplayPrice(converted, currencyCode)` → `"NNN $"`
5. Preserve "от" prefix if present in original text
6. Write to `element.textContent` (never `innerHTML`)

When user switches back to BYN, original text is restored from `dataset.avCurrenciesOriginalText`.

### Popup Communication

```
popup.js
  │
  ├─ loadData()        → sendMessage({ action: "getRates" }) [src/popup/popup.js:118]
  ├─ refreshRates()    → sendMessage({ action: "refreshRates" }) [src/popup/popup.js:121]
  └─ display currency  → browser.storage.local.set({ selectedCurrency }) [src/popup/popup.js:142]
                       → content script picks up via storage.onChanged
```

### VIN Feature Flow

```
content/avby.js
  │
  ├─ Reads pageId from URL
  │
  └─ If VIN feature enabled:
      ├─ sendMessage({ action: "getVinForPage", pageId }) → background
      │   → background.js :: fetchVinForPage() [src/background.js:35]
      │       → fetch to https://vin-api.redpandadev.workers.dev/api/vin/{pageId}
      │
      └─ On user VIN input:
          → sendMessage({ action: "submitVinForPage", pageId, pageUrl, vin })
              → background.js :: submitVinForPage() [src/background.js:64]
                  → POST to https://vin-api.redpandadev.workers.dev/api/vin
```

## 5. Architectural Invariants & Constraints

- Rule: `src/lib/rates.js` must remain importable in plain Node.js without mocks or polyfills
  - Rationale: Enables testing pure logic in Node.js environment and ensures zero browser API dependencies
  - Enforcement / Signals (Observed): No `browser.*`, `document`, `fetch`, or `window` references in `src/lib/rates.js`

- Rule: All `fetch` calls live in `src/background.js` only
  - Rationale: Centralizes network access, enables offline resilience, and enforces security boundaries
  - Enforcement / Signals (Observed): `fetch` calls only in `src/background.js`; popup uses `sendMessage`; content script reads from storage

- Rule: Popup and background communicate only via `browser.runtime.sendMessage`
  - Rationale: Maintains clear separation of concerns and prevents circular dependencies
  - Enforcement / Signals (Observed): No direct imports between `src/popup/popup.js` and `src/background.js`; message protocol defined in both

- Rule: Popup uses `textContent` exclusively — never `innerHTML`
  - Rationale: XSS prevention from untrusted data
  - Enforcement / Signals (Observed): All DOM updates in `src/popup/popup.js` use `textContent`

- Rule: Content script is a self-contained IIFE with duplicated helpers
  - Rationale: MV3 content scripts run in isolated world without module support
  - Enforcement / Signals (Observed): `src/content/avby.js` is IIFE; duplicates `parseBynPrice`, `convertFromBYN`, `formatDisplayPrice` from `src/lib/rates.js`

- Rule: Duplicated helpers must stay in sync between `src/lib/rates.js` and `src/content/avby.js`
  - Rationale: Ensures consistent conversion and formatting behavior
  - Enforcement / Signals (Observed): AGENTS.md explicitly states this requirement; tests cover both implementations

- Rule: Failed API responses never overwrite previously valid rates
  - Rationale: Offline resilience — stale rates remain usable during network failures
  - Enforcement / Signals (Observed): `src/background.js:142` writes only `lastError` on failure; `ratesData` untouched

- Rule: Original BYN text must be preserved via dataset attributes and WeakMaps
  - Rationale: Enables restoring original BYN display when user switches currency back
  - Enforcement / Signals (Observed): Uses `dataset.avCurrenciesOriginalText`, `dataset.avCurrenciesBynAmount`, `WeakMap` instances for text nodes

- Rule: Only two host permissions: `https://api.nbrb.by/*` and `https://vin-api.redpandadev.workers.dev/*`
  - Rationale: Minimal required permissions for functionality
  - Enforcement / Signals (Observed): `manifest.json:8-9` defines exactly these host permissions

- Rule: Test coverage ≥80% on `src/lib/**/*.js` and `src/background.js`
  - Rationale: Ensures quality of core logic and background operations
  - Enforcement / Signals (Observed): Configured in `vitest.config.js:10-16`

- Rule: `manifest.json` is the source-of-truth; Chrome manifest is generated
  - Rationale: Single source of truth prevents divergence
  - Enforcement / Signals (Observed): `scripts/build-chrome.mjs` transforms Firefox manifest for Chrome

- Rule: All entrypoints include cross-browser shim: `globalThis.browser ??= globalThis.chrome`
  - Rationale: Cross-browser compatibility (Firefox `browser.*` vs Chrome `chrome.*`)
  - Enforcement / Signals (Observed): Present in `src/background.js:1`, `src/content/avby.js:1`, `src/popup/popup.js:1`

## 6. Documentation Strategy

- `ARCHITECTURE.md` is the global map: component model, data flow, architectural boundaries, and invariants for the entire repository
- `AGENTS.md` provides repository overview, where to work, architecture and boundaries, change rules, and validation commands
- `README.md` contains user-facing documentation, module descriptions, privacy policy, and extension links
- `manifest.json` documents extension permissions, entrypoints, and version
- `Makefile` documents build/run/lint/test commands

Module-level documentation:
- `src/content/AGENTS.md` covers content script boundaries, invariants, and safe change rules
- Module-level `README.md` files are not present; local detail is documented in `AGENTS.md` files

What belongs where:
- Global architecture, cross-cutting concerns, and invariants → `ARCHITECTURE.md`
- Repository-specific conventions, change rules, and validation → `AGENTS.md`
- User-facing documentation and usage → `README.md`
- Module-specific boundaries and implementation notes → module-level `AGENTS.md`
