# Architecture

## 1. High-Level Overview

This is a Firefox WebExtension that replaces BYN prices on AV.by with a user-selected display currency (BYN, USD, EUR, or RUB), sourced from the National Bank of the Republic of Belarus (NBRB) public API. The popup also displays exchange rates and provides a simple currency converter. UI is in Russian (`Observed`: `manifest.json` name/description, `popup.js` strings).

The problem it solves: let Belarusian Firefox users browse AV.by with prices shown in their preferred currency while keeping the original BYN prices restorable. Cached rates survive network failures (`Observed`: `background.js` preserves previous `ratesData` on fetch failure, stores `lastError` separately).

Architectural paradigm: a classic WebExtension with a background event page (fetch scheduling), a shared pure-logic library, a popup UI, and a content script for AV.by DOM price replacement. No options page and no remote code (`Observed`: `manifest.json` permissions are `alarms` + `storage`, with host permissions for NBRB API and AV.by pages).

Evidence anchors: `manifest.json`, `background.js`, `lib/rates.js`, `popup/popup.html`, `popup/popup.js`, `vitest.config.js`.

## 2. System Architecture (Logical)

Four components:

- **Shared Library** (`lib/rates.js`) — pure functions: NBRB API response parsing, currency conversion, formatting. No browser APIs, no side effects. Imported by both background and popup.
- **Background Event Page** (`background.js`) — fetches rates from NBRB API on install, startup, and every 4 hours via `browser.alarms`. Stores results in `browser.storage.local`. Responds to popup messages for refresh and data retrieval.
- **Popup UI** (`popup/`) — renders rates and converter on user click. Reads from storage, sends refresh messages to background. All DOM updates use `textContent`, never `innerHTML`.
- **AV.by Content Script** (`content/avby.js`) — reads cached rates and selected display currency from storage, replaces AV.by price text, observes dynamic DOM updates, and restores original BYN text when needed.

Dependency direction:

```
popup.js ──imports──► lib/rates.js
background.js ──imports──► lib/rates.js
popup.js ──messages──► background.js (via browser.runtime.sendMessage)
content/avby.js ──reads──► browser.storage.local
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
├── content/
│   └── avby.js            AV.by content script: price replacement and DOM observation
├── lib/
│   └── rates.js           Pure logic: parseRates, convert, convertFromBYN, price parsing, formatting
├── popup/
│   ├── popup.html         Popup markup (rates table, converter, refresh button)
│   ├── popup.css          Styling with light/dark theme support via prefers-color-scheme
│   └── popup.js           Popup controller: render, converter, refresh, event listeners
├── icons/                 Extension icons at 16/32/48/128px (PNG) + source SVG
├── tests/
│   ├── parse.test.js      Vitest test suite for lib/rates.js
│   └── content.test.js    Vitest + jsdom tests for AV.by content script
├── examples/              Saved AV.by/NBRB fixtures for tests
├── vitest.config.js       Test runner config: coverage on lib/, 80% threshold
├── Makefile               Build orchestration: test, lint, format, build, run, Android run/log, clean
└── package.json           Dev dependencies only: vitest, @vitest/coverage-v8, jsdom, prettier
```

Where is X?

- **Rate parsing logic** → `lib/rates.js:parseRates`
- **Currency conversion math** → `lib/rates.js:convert`
- **API fetch and caching** → `background.js:fetchRates`
- **AV.by price replacement** → `content/avby.js`
- **Alarm scheduling** → `background.js:ensureAlarm`
- **Popup rendering** → `popup/popup.js:render`, `renderRates`, `renderConverter`
- **Test fixtures** → `examples/nbrb_response.json` (real API snapshot)
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

**AV.by price replacement path:**

```
user selects display currency in popup
  → popup stores selectedCurrency in browser.storage.local
    → content/avby.js receives storage change or reads storage on page load
      → finds known AV.by price elements and monthly-payment text
        → preserves original BYN text in dataset/WeakMap
          → converts BYN to selected currency using cached NBRB rates
            → replaces page text with formatted selected-currency price
```

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

- **Rule:** No remote code execution — no CDN scripts and no inline script handlers.
  - **Rationale:** Content Security Policy compliance for Firefox extensions.
  - **Enforcement / Signals (Observed):** `popup.html` has no inline event handlers; no `content_security_policy` override in manifest; `web-ext lint` passes with 0 errors.

- **Rule:** Test coverage for `lib/` must not fall below 80% on any metric (lines, functions, branches, statements).
  - **Rationale:** The shared library contains all financial calculations and API response parsing — correctness is critical.
  - **Enforcement / Signals (Observed):** `vitest.config.js` thresholds block CI on regression; current coverage is 100%.

- **Rule:** Background and popup communicate only via `browser.runtime.sendMessage`, never by direct import.
  - **Rationale:** Matches WebExtension lifecycle — background and popup are separate execution contexts with independent lifetimes.
  - **Enforcement / Signals (Observed):** `background.js` registers `onMessage` listener; `popup.js` uses `sendMessage`; no cross-directory imports between them.

- **Rule:** Host permissions are limited to the NBRB API and AV.by pages.
  - **Rationale:** Principle of least privilege; the extension only needs rates from NBRB and DOM access on AV.by.
  - **Enforcement / Signals (Observed):** `manifest.json` `host_permissions` contains `https://api.nbrb.by/*`, `https://av.by/*`, and `https://*.av.by/*`.

- **Rule:** Failed API responses must not overwrite previously stored valid rates.
  - **Rationale:** Graceful degradation — users see last-known rates during network issues.
  - **Enforcement / Signals (Observed):** `background.js` catch block sets `lastError` without modifying `ratesData`.

## 6. Android Considerations

- Popup layout must remain responsive because Android surfaces extension UI in a constrained mobile container (`Observed`: `popup/popup.html` has viewport meta, `popup/popup.css` uses responsive width and 44px controls).
- AV.by content script is optimized to avoid full-page text rescans on each mutation. It tracks monthly-payment text nodes and processes newly added/mutated subtrees (`Observed`: `content/avby.js` with `trackedMonthlyNodes` and `pendingMonthlyNodes`).
- Mobile lifecycle can be more aggressive about background suspension, so content script can request rate initialization via runtime messaging when storage is empty (`Observed`: `content/avby.js` sends `ensureRates`, `background.js` handles it).
- Android test flow is codified in build tooling (`Observed`: `Makefile` targets `run-android`, `run-android-nightly`, `android-log`).

## 7. Documentation Strategy

`ARCHITECTURE.md` (this file) is the global map of the repository: component boundaries, data flow, invariants, and the code map.

Repository-level documentation includes `README.md` (user-facing behavior, module descriptions, and Android test steps) and `AGENTS.md` (agent constraints and invariants).

What belongs where:

- **Global (this file):** component model, dependency direction, invariants, data flow, physical layout.
- **Local/module docs (if added):** API response shape details, popup UI behavior specifics, build/deploy instructions. These would live alongside the relevant files (e.g., `popup/README.md`, `lib/README.md`).

The `Makefile` doubles as runnable documentation for the available development commands (`test`, `lint`, `build`, `format`, `run`, `run-android`, `run-android-nightly`, `android-log`, `clean`). The `examples/nbrb_response.json` fixture documents the expected NBRB API response shape for test purposes.
