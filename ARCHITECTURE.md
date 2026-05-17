# Architecture

## 1. High-Level Overview

This repository contains a cross-browser WebExtension (Manifest V3) that replaces Belarusian Ruble (BYN) prices on AV.by — a Belarusian automotive marketplace — with USD, EUR, or RUB equivalents. Exchange rates are sourced from the National Bank of the Republic of Belarus (NBRB) public API. The extension is packaged for both Firefox and Chrome-based browsers from a single codebase.

The system consists of three runtime components: a background event page that fetches and caches exchange rates on a 4-hour schedule, a content script that performs DOM-based price replacement on AV.by pages, and a popup UI that displays current rates and provides a currency converter. All three components communicate exclusively through `browser.runtime.sendMessage` and `browser.storage.local` — there are no direct imports between background, popup, and content script.

**Evidence anchors:**
- `manifest.json` — defines MV3 manifest with `background`, `content_scripts`, `action` (popup), permissions (`alarms`, `storage`), and host permissions (`https://api.nbrb.by/*`, `https://*.av.by/*`)
- `src/background.js` — background event page with alarm-based rate fetching
- `src/content/avby.js` — content script IIFE targeting AV.by DOM
- `src/popup/popup.js` — popup controller importing from `src/lib/rates.js`
- `src/lib/rates.js` — pure logic module with zero browser API dependencies
- `scripts/build-chrome.mjs` / `scripts/build-firefox.mjs` — dual-browser build pipeline

The business purpose (inferred from UI strings in Russian, AV.by-specific CSS selectors, and NBRB API targeting) is to help Belarusian car buyers view prices in familiar foreign currencies without manual conversion.

## 2. System Architecture (Logical)

The extension has four logical layers:

```
┌─────────────────────────────────────────────────┐
│                  Popup UI                        │
│  (popup.html / popup.js / popup.css)             │
│  Displays rates, converter, currency selector    │
└──────────────┬──────────────────────────────────┘
               │ browser.runtime.sendMessage
               │ browser.storage.local (read/write selectedCurrency)
┌──────────────▼──────────────────────────────────┐
│              Background Event Page               │
│  (background.js)                                 │
│  Fetches NBRB rates, manages alarms,             │
│  persists ratesData + lastError to storage       │
└──┬───────────────────────────┬──────────────────┘
   │ browser.storage.local     │ browser.storage.local
   │ (read ratesData)          │ (read ratesData, selectedCurrency)
   │                           │ storage.onChanged events
┌──▼──────────────┐   ┌────────▼──────────────────┐
│  Content Script │   │     Pure Logic Library     │
│  (avby.js)      │   │     (lib/rates.js)         │
│  DOM mutation   │   │     Parsing, conversion,   │
│  on av.by pages │   │     formatting             │
└─────────────────┘   └───────────────────────────┘
```

**Background Event Page** — The sole owner of network I/O. Fetches rates from NBRB API on install, startup, alarm trigger (every 240 minutes), and on-demand via popup messages. Validates that all three target currencies (USD, EUR, RUB) are present before persisting. Failed fetches update only `lastError`, never overwriting valid cached rates.

**Popup UI** — Reads rates and error state from background via `browser.runtime.sendMessage`. Renders rate labels, a BYN converter, and a display currency selector. Persists the user's chosen display currency to `browser.storage.local`, which the content script observes.

**Content Script** — Runs in an isolated world on `https://*.av.by/*` pages. Reads rates and display currency from `browser.storage.local`. Uses CSS selectors to locate price elements, parses BYN amounts from their text content, converts to the selected currency, and replaces text via `textContent`. A `MutationObserver` handles dynamic content (infinite scroll, SPA navigation). Original BYN text is preserved in dataset attributes and `WeakMap` instances for reversible conversion.

**Pure Logic Library** (`src/lib/rates.js`) — Contains all parsing, conversion, and formatting functions. Has zero browser API dependencies. Imported by both background and popup. Duplicated (by necessity of MV3 content script isolation) inside the content script IIFE — changes must be mirrored.

**Intentional non-dependencies:**
- Popup never calls `fetch` directly — all network I/O flows through background
- Content script never calls `fetch` — reads rates from storage only
- `lib/rates.js` imports nothing from `browser.*`, `document`, or `window`
- Background and popup never import from each other — communicate via messaging only

## 3. Code Map (Physical)

```
av_currencies/
├── manifest.json              # Source-of-truth MV3 manifest (Firefox primary)
├── Makefile                   # Build/run/lint/test commands
├── package.json               # Dev deps: vitest, jsdom, prettier
├── vitest.config.js           # Test config, 80% coverage threshold on lib/
│
├── src/
│   ├── background.js          # Background event page: fetch, alarms, storage, messaging
│   ├── lib/
│   │   └── rates.js           # Pure logic: parsing, conversion, formatting
│   ├── content/
│   │   └── avby.js            # Content script: DOM price replacement (self-contained IIFE)
│   └── popup/
│       ├── popup.html         # Popup markup
│       ├── popup.css          # Styling (light/dark theme)
│       └── popup.js           # Popup controller: render, converter, refresh
│
├── scripts/
│   ├── build-chrome.mjs       # Chrome build: copies src/icons, transforms manifest, writes zip
│   ├── build-firefox.mjs      # Firefox build: copies manifest+src+icons, writes zip
│   └── package-utils.mjs      # Shared utilities: zip creation, AGENTS.md stripping
│
├── tests/
│   ├── parse.test.js          # Vitest tests for lib/rates.js
│   └── content.test.js        # Vitest + jsdom tests for content/avby.js
│
├── examples/                  # Test fixtures: NBRB API response, saved AV.by HTML pages
├── icons/                     # Extension icons (16, 32, 48, 128 PNG)
├── build/                     # Generated: firefox/ and chrome/ packaging directories
├── coverage/                  # Generated: test coverage reports
└── av-currencies-{firefox,chrome}.zip  # Generated packages
```

**Where is X?**
- Exchange rate parsing/conversion → `src/lib/rates.js`
- Network fetch logic → `src/background.js` only
- AV.by price selectors → constants at the top of `src/content/avby.js`
- Popup UI → `src/popup/`
- Build scripts → `scripts/`
- Test fixtures → `examples/`
- Browser-specific manifest differences → `scripts/build-chrome.mjs` transforms the Firefox manifest for Chrome

## 4. Primary Data Flow

**Rate fetch cycle (background-driven):**

```
browser alarm (240 min) / install / startup / popup refresh
  → background.js: fetchRates()
    → fetch("https://api.nbrb.by/exrates/rates?periodicity=0")
    → lib/rates.js: parseRates() — extracts USD, EUR, RUB; returns null if any missing
    → browser.storage.local.set({ ratesData, lastError: null })  // success
       or browser.storage.local.set({ lastError: { message, at } })  // failure
```

**Price replacement on AV.by page (content script):**

```
Page load (document_idle)
  → content/avby.js: init()
    → browser.storage.local.get(["ratesData", "selectedCurrency"])
    → if ratesData missing → browser.runtime.sendMessage({ action: "ensureRates" })
    → applyAll() — collect elements via CSS selectors, parse BYN, convert, replace textContent
    → MutationObserver observes body (childList, subtree, characterData)
       → on mutation → scheduleApply() via requestAnimationFrame
    → browser.storage.onChanged → re-apply when ratesData or selectedCurrency changes
```

**Popup interaction:**

```
Popup opens (DOMContentLoaded)
  → popup/popup.js: loadData()
    → browser.runtime.sendMessage({ action: "getRates" })
      → background returns { ratesData, lastError } from storage
    → render() — display rates, converter, status
  → User changes display currency
    → browser.storage.local.set({ selectedCurrency })
      → content script observes via storage.onChanged → re-applies prices
  → User clicks "Refresh"
    → browser.runtime.sendMessage({ action: "refreshRates" })
      → background fetches with force=true, updates storage
      → popup re-renders from updated storage
```

## 5. Architectural Invariants & Constraints

- **Rule:** All `fetch` calls must live in `src/background.js` only.
  - **Rationale:** Single point of network I/O; popup and content script are offline-resilient via cached storage.
  - **Enforcement / Signals (Observed):** `src/lib/rates.js` has zero browser API dependencies; popup and content script read from `browser.storage.local` only.

- **Rule:** `src/lib/rates.js` must remain importable in plain Node.js without mocks or polyfills.
  - **Rationale:** Enables unit testing without browser environment simulation.
  - **Enforcement / Signals (Observed):** Test coverage config in `vitest.config.js` targets `src/lib/**/*.js` only; no `browser.*`, `document`, `fetch`, or `window` references in the file.

- **Rule:** Background and popup communicate only via `browser.runtime.sendMessage` — never direct imports.
  - **Rationale:** MV3 architecture enforces separate execution contexts; direct imports would break in production.
  - **Enforcement / Signals (Observed):** `popup/popup.js` imports only from `../lib/rates.js`; background has no imports from popup.

- **Rule:** Content script is a self-contained IIFE with no ES module imports.
  - **Rationale:** MV3 content scripts run in an isolated world without module support.
  - **Enforcement / Signals (Observed):** `src/content/avby.js` wraps all code in `(function initAvByCurrencyConversion() { ... })();` and duplicates `parseBynPrice`, `convertFromBYN`, `formatDisplayPrice` from `lib/rates.js`.

- **Rule:** Content script uses `textContent` / `nodeValue` only — never `innerHTML`.
  - **Rationale:** XSS prevention when writing to untrusted DOM.
  - **Enforcement / Signals (Observed):** All DOM writes in `src/content/avby.js` use `element.textContent` or `node.nodeValue`.

- **Rule:** Failed API responses must not overwrite previously stored valid rates.
  - **Rationale:** Offline resilience — cached rates persist across network failures.
  - **Enforcement / Signals (Observed):** On fetch failure, `background.js` updates only `lastError` in storage; `ratesData` is untouched.

- **Rule:** Host permissions are limited to `https://api.nbrb.by/*` and `https://av.by/*` (plus subdomains).
  - **Rationale:** Minimum-privilege principle; the extension has no reason to access other origins.
  - **Enforcement / Signals (Observed):** `manifest.json` declares exactly these two host permissions.

- **Rule:** Test coverage for `lib/` must stay at or above 80% on all metrics (lines, functions, branches, statements).
  - **Rationale:** Core logic is the most critical and most reusable component.
  - **Enforcement / Signals (Observed):** `vitest.config.js` sets `thresholds` at 80 for all four metrics, scoped to `src/lib/**/*.js`.

- **Rule:** When changing shared logic (`parseBynPrice`, `convertFromBYN`, `formatDisplayPrice`), update both `src/lib/rates.js` and `src/content/avby.js`.
  - **Rationale:** Content script cannot import ES modules; duplication is unavoidable.
  - **Enforcement / Signals (Observed):** `src/content/AGENTS.md` explicitly documents this requirement; both files contain identical function implementations.

## 6. Documentation Strategy

`ARCHITECTURE.md` is the global map of components, data flow, and invariants. It answers "where is X?" and "what rules must be preserved?"

Module-level `AGENTS.md` files provide local detail for their specific scope:
- `AGENTS.md` (root) — repository conventions, build commands, testing approach, key gotchas
- `src/content/AGENTS.md` — content script boundaries, selector categories, safe change rules
- `tests/AGENTS.md` — test suite structure and fixture usage

`README.md` is the end-user and contributor-facing guide: installation, usage, feature list, and store links.

**What belongs where:**
- Global architecture (`ARCHITECTURE.md`): component boundaries, dependency directions, invariants, data flow across components
- Local docs (`AGENTS.md`): file-specific conventions, selector lists, test commands for that module, change rules scoped to one component
- User docs (`README.md`): how to install, how to use, where to download

If a change affects how two or more components interact, update `ARCHITECTURE.md`. If it affects only one component's internals, update that component's `AGENTS.md`.
