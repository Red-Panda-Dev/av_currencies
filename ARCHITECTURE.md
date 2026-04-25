# Architecture

## 1. High-Level Overview

This is a Firefox WebExtension that displays exchange rates of USD, EUR, and RUB against the Belarusian ruble (BYN), sourced from the National Bank of the Republic of Belarus (NBRB) public API. The extension also provides a simple currency converter. UI is in Russian (`Observed`: `manifest.json` name/description, `popup.js` strings).

The problem it solves: give Belarusian Firefox users quick, always-fresh BYN exchange rates via a toolbar popup, with offline resilience — cached rates survive network failures (`Observed`: `background.js` preserves previous `ratesData` on fetch failure, stores `lastError` separately).

Architectural paradigm: a classic WebExtension with a background event page (fetch scheduling), a shared pure-logic library, and a popup UI. No content scripts, no options page, no remote code (`Observed`: `manifest.json` permissions are only `alarms` + `storage`, single host permission for `api.nbrb.by`).

Evidence anchors: `manifest.json`, `background.js`, `lib/rates.js`, `popup/popup.html`, `popup/popup.js`, `vitest.config.js`.

## 2. System Architecture (Logical)

Three components:

- **Shared Library** (`lib/rates.js`) — pure functions: NBRB API response parsing, currency conversion, formatting. No browser APIs, no side effects. Imported by both background and popup.
- **Background Event Page** (`background.js`) — fetches rates from NBRB API on install, startup, and every 4 hours via `browser.alarms`. Stores results in `browser.storage.local`. Responds to popup messages for refresh and data retrieval.
- **Popup UI** (`popup/`) — renders rates and converter on user click. Reads from storage, sends refresh messages to background. All DOM updates use `textContent`, never `innerHTML`.

Dependency direction:

```
popup.js ──imports──► lib/rates.js
background.js ──imports──► lib/rates.js
popup.js ──messages──► background.js (via browser.runtime.sendMessage)
```

Key boundaries:

- `lib/rates.js` has zero browser API dependencies — it is testable in Node without mocks.
- Background and popup never import each other directly; they communicate via `browser.runtime.sendMessage`.
- The popup never calls `fetch` directly; all network access is centralized in the background script.
- No external dependencies at runtime — no CDN, no bundler output, no remote scripts (`Observed`: no `content_security_policy` override in manifest, no script tags in popup HTML).

## 3. Code Map (Physical)

```
av_currencies/
├── manifest.json          Extension entrypoint, permissions, background/popup registration
├── background.js          Background event page: alarms, fetch, storage, message handling
├── lib/
│   └── rates.js           Pure logic: parseRates, convert, formatRate, formatDate, formatTime
├── popup/
│   ├── popup.html         Popup markup (rates table, converter, refresh button)
│   ├── popup.css          Styling with light/dark theme support via prefers-color-scheme
│   └── popup.js           Popup controller: render, converter, refresh, event listeners
├── icons/                 Extension icons at 16/32/48/128px (PNG) + source SVG
├── tests/
│   └── parse.test.js      Vitest test suite for lib/rates.js (30 tests)
├── nbrb_reponse.json      Real NBRB API response fixture for tests
├── vitest.config.js       Test runner config: coverage on lib/, 80% threshold
├── Makefile               Build orchestration: test, lint, format, build, run, clean
└── package.json           Dev dependencies only: vitest, @vitest/coverage-v8, prettier
```

Where is X?

- **Rate parsing logic** → `lib/rates.js:parseRates`
- **Currency conversion math** → `lib/rates.js:convert`
- **API fetch and caching** → `background.js:fetchRates`
- **Alarm scheduling** → `background.js:ensureAlarm`
- **Popup rendering** → `popup/popup.js:render`, `renderRates`, `renderConverter`
- **Test fixtures** → `nbrb_reponse.json` (real API snapshot)
- **Build commands** → `Makefile`

## 4. Life of a Request / Primary Data Flow

**Data refresh path (background-initiated):**

```
browser startup / alarm fire (every 4h)
  → background.js event listener
    → fetchRates() with AbortController timeout
      → fetch('https://api.nbrb.by/exrates/rates?periodicity=0')
        → parseRates() from lib/rates.js
          → validate all 3 currencies present
            → browser.storage.local.set({ ratesData, lastError })
```

**User interaction path (popup):**

```
user clicks toolbar icon
  → popup.html loads → popup.js DOMContentLoaded
    → browser.runtime.sendMessage({ action: 'getRates' })
      → background reads browser.storage.local → returns { ratesData, lastError }
        → popup renders rates table, converter, status, timestamp
          → user changes converter input → local recalculation via convert()
          → user clicks "Обновить" → sendMessage({ action: 'refreshRates' })
            → background fetchRates({ force: true }) → popup re-renders
```

**Offline resilience:** if `fetchRates` fails, `lastError` is stored but previous `ratesData` is preserved. Popup detects `lastError` and shows a warning alongside cached rates (`Observed`: `background.js` catch block, `popup.js` render logic).

## 5. Architectural Invariants & Constraints

- **Rule:** `lib/rates.js` must not import or reference any browser API (`browser.*`, `document`, `fetch`, `window`).
  - **Rationale:** Keeps the shared logic testable in plain Node.js without mocks or polyfills.
  - **Enforcement / Signals (Inferred):** No browser globals in the file; vitest runs coverage against it with 100% pass rate and no setup/teardown.

- **Rule:** All network requests go through `background.js` only; popup never calls `fetch`.
  - **Rationale:** Centralizes network access and error handling; popup works with cached data when offline.
  - **Enforcement / Signals (Observed):** No `fetch` calls in `popup/popup.js`; popup requests data via `browser.runtime.sendMessage`.

- **Rule:** Popup must use `textContent` for all dynamic content, never `innerHTML`.
  - **Rationale:** Prevents XSS from malformed API responses.
  - **Enforcement / Signals (Observed):** All DOM assignments in `popup/popup.js` use `textContent` or `className`.

- **Rule:** No remote code execution — no CDN scripts, no inline script handlers, no `eval`.
  - **Rationale:** Content Security Policy compliance for Firefox extensions.
  - **Enforcement / Signals (Observed):** `popup.html` has no inline event handlers; no `content_security_policy` override in manifest; `web-ext lint` passes with 0 errors.

- **Rule:** Test coverage for `lib/` must not fall below 80% on any metric (lines, functions, branches, statements).
  - **Rationale:** The shared library contains all financial calculations and API response parsing — correctness is critical.
  - **Enforcement / Signals (Observed):** `vitest.config.js` thresholds block CI on regression; current coverage is 100%.

- **Rule:** Background and popup communicate only via `browser.runtime.sendMessage`, never by direct import.
  - **Rationale:** Matches WebExtension lifecycle — background and popup are separate execution contexts with independent lifetimes.
  - **Enforcement / Signals (Observed):** `background.js` registers `onMessage` listener; `popup.js` uses `sendMessage`; no cross-directory imports between them.

- **Rule:** The only host permission is `https://api.nbrb.by/*`.
  - **Rationale:** Principle of least privilege; no telemetry, no tracking, no third-party services.
  - **Enforcement / Signals (Observed):** `manifest.json` `host_permissions` contains exactly one entry.

- **Rule:** Failed API responses must not overwrite previously stored valid rates.
  - **Rationale:** Graceful degradation — users see last-known rates during network issues.
  - **Enforcement / Signals (Observed):** `background.js` catch block sets `lastError` without modifying `ratesData`.

## 6. Documentation Strategy

`ARCHITECTURE.md` (this file) is the global map of the repository: component boundaries, data flow, invariants, and the code map.

Module-level and local documentation is currently absent — there are no `AGENTS.md`, `README.md`, or per-directory documentation files in this repository (`Observed`).

What belongs where:

- **Global (this file):** component model, dependency direction, invariants, data flow, physical layout.
- **Local/module docs (if added):** API response shape details, popup UI behavior specifics, build/deploy instructions. These would live alongside the relevant files (e.g., `popup/README.md`, `lib/README.md`).

The `Makefile` doubles as runnable documentation for the available development commands (`test`, `lint`, `build`, `format`, `run`, `clean`). The `nbrb_reponse.json` fixture documents the expected NBRB API response shape for test purposes.
