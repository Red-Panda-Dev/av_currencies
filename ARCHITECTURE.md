# Architecture

## 1. High-Level Overview

This is a Firefox WebExtension (Manifest V3) that replaces BYN prices on AV.by with USD, EUR, or RUB equivalents using exchange rates from the National Bank of the Republic of Belarus (NBRB) public API. It also provides a browser popup with current rate display, a simple currency converter, and a display-currency selector. The UI is in Russian. The extension is offline-resilient: previously cached rates persist across network failures.

**Observed** — Extension identity and purpose are stated in `manifest.json:3-5`, `README.md:1-5`, and `AGENTS.md:5`. Three host permissions (`https://api.nbrb.by/*`, `https://av.by/*`, `https://*.av.by/*`) and two extension permissions (`storage`, `alarms`) are declared in `manifest.json:6-11`.

**Observed** — The NBRB API endpoint and 240-minute refresh interval are constants in `background.js:3-5`.

**Observed** — The build pipeline (format-check, web-ext lint, tests with 80% coverage, zip) is defined in `Makefile:25-31` and `vitest.config.js:11-16`.

**Observed** — UI strings are exclusively in Russian throughout `popup/popup.html`, `popup/popup.js`, and `content/avby.js`.

## 2. System Architecture (Logical)

Four components, each with a distinct runtime role:

1. **Pure Logic** (`lib/rates.js`) — stateless functions for parsing API responses, converting currencies, and formatting prices. Zero browser or Node dependencies. Shared source of truth for conversion math and formatting.

2. **Background Script** (`background.js`) — the extension's sole network actor. Fetches rates from the NBRB API on install, startup, alarm (every 240 min), and on-demand messages. Persists results to `browser.storage.local`. Never touches the DOM.

3. **Content Script** (`content/avby.js`) — self-contained IIFE injected into AV.by pages. Reads rates and the selected display currency from `browser.storage.local`. Finds price elements in the live DOM, converts and replaces their text, and monitors mutations for dynamically loaded content. Cannot import ES modules; carries duplicated copies of three core functions from `lib/rates.js`.

4. **Popup UI** (`popup/`) — HTML/CSS/JS panel opened by the browser action. Displays current rates, a BYN converter, a display-currency selector, and a manual refresh button. Reads rates via `browser.runtime.sendMessage` to the background script. Never calls `fetch` directly.

**Dependency direction:**

```
Popup ──imports──▶ lib/rates.js
Popup ──messages──▶ Background Script
Background ──imports──▶ lib/rates.js
Content Script ──storage──▶ browser.storage.local ◀──storage── Background Script
Content Script ──duplicates──▶ (subset of lib/rates.js)
```

**Key boundaries:**

- `lib/rates.js` does **not** depend on `browser.*`, `document`, `fetch`, `window`, or any Node built-in.
- The popup does **not** call `fetch`; all network access goes through the background script via `browser.runtime.sendMessage`.
- The content script does **not** call `fetch` or `XMLHttpRequest`; it reads rates from `browser.storage.local` and requests a fetch via the `ensureRates` message if storage is empty.
- The popup and background script do **not** share a JavaScript module scope; they communicate exclusively through `browser.runtime.sendMessage` and `browser.storage.local`.

## 3. Code Map (Physical)

```
manifest.json           # MV3 manifest: permissions, entrypoints, extension ID
background.js           # Background event page (ES module): fetch, alarms, storage, messaging
lib/
  rates.js              # Pure logic: parse, convert, format — no browser APIs
content/
  avby.js               # AV.by content script (self-contained IIFE, no imports)
popup/
  popup.html            # Popup markup (lang="ru", loads popup.js as ES module)
  popup.css             # Styling with light/dark theme via prefers-color-scheme
  popup.js              # Popup controller: render rates, converter, refresh, currency selector
tests/
  parse.test.js         # Vitest unit tests for lib/rates.js
  content.test.js       # Vitest + jsdom tests for content/avby.js
examples/
  nbrb_response.json    # Real NBRB API response fixture
  index.html            # Saved AV.by listing page fixture
  auto_card.html        # Saved AV.by car detail page fixture
Makefile                # build/run/lint/test targets; web-ext commands
vitest.config.js        # Vitest config with 80% coverage threshold on lib/
AGENTS.md               # Contributor-facing rules and conventions
```

- **Where is currency conversion math?** `lib/rates.js` (canonical) and duplicated in `content/avby.js`.
- **Where is the NBRB API called?** Only in `background.js:10-69`.
- **Where are DOM prices replaced?** Only in `content/avby.js`.
- **Where is the popup logic?** `popup/popup.js`.
- **Where are test fixtures?** `examples/`.

## 4. Life of a Request / Primary Data Flow

**Rate refresh cycle:**

1. Browser fires `onInstalled` or `onStartup` event, or the 240-minute alarm fires (`background.js:80-94`).
2. `fetchRates()` in `background.js:10-69` calls `fetch(API_URL)` with a 10-second timeout.
3. The JSON response is passed to `parseRates()` in `lib/rates.js:7-27`, which extracts USD, EUR, RUB (validating all three are present).
4. On success, rates are written to `browser.storage.local` under the `ratesData` key; `lastError` is cleared (`background.js:36-46`).
5. On failure, only `lastError` is updated — existing `ratesData` is never overwritten (`background.js:49-60`).

**AV.by price replacement:**

1. Content script initializes on `document_idle` (`manifest.json:29`), reads `ratesData` and `selectedCurrency` from `browser.storage.local` (`content/avby.js:411-425`).
2. If `ratesData` is missing, sends `ensureRates` message to background (`content/avby.js:379-391`), which triggers a fetch and returns the result via storage change.
3. `applyAll()` (`content/avby.js:279-303`) collects price elements via CSS selectors, parses the BYN amount from their text, converts with `convertFromBYN()`, and replaces `textContent`.
4. A `MutationObserver` on `document.body` (`content/avby.js:317-377`) watches for dynamically added nodes (infinite scroll, SPA navigation) and schedules `applyAll()` via `requestAnimationFrame`.
5. Monthly-payment text nodes ("… BYN в месяц") are tracked in a `WeakMap` with original text preserved, and reprocessed on currency or rate changes.

**Popup data flow:**

1. On `DOMContentLoaded`, popup sends `getRates` message to background (`popup/popup.js:114`).
2. Background responds from `browser.storage.local` (`background.js:115-118`).
3. Popup renders rates, converter result, and status using functions from `lib/rates.js`.
4. "Refresh" button sends `refreshRates` message, which triggers `fetchRates({ force: true })` in background (`background.js:110-113`).
5. Display-currency selector writes to `browser.storage.local`; the content script's storage listener picks up the change (`content/avby.js:393-409`).

## 5. Architectural Invariants & Constraints

- **Rule:** `lib/rates.js` must have zero browser or Node API dependencies.
  - **Rationale:** Keeps business logic testable in plain Vitest without mocks or polyfills.
  - **Enforcement / Signals (Observed):** No `browser.*`, `document`, `fetch`, `window`, or Node built-in references in the file. Vitest imports it directly in `tests/parse.test.js`. `vitest.config.js:10` restricts coverage to `lib/**/*.js`.

- **Rule:** All network fetches live in `background.js` only.
  - **Rationale:** Single point of control for rate fetching, error handling, and caching policy.
  - **Enforcement / Signals (Observed):** Only `background.js` contains `fetch()` calls. Popup uses `browser.runtime.sendMessage` (`popup/popup.js:114,120`). Content script uses `browser.storage.local` and one `ensureRates` message (`content/avby.js:379-391`).

- **Rule:** Failed API responses must not overwrite previously stored valid rates.
  - **Rationale:** Offline resilience — users see last-known-good rates when the API is down.
  - **Enforcement / Signals (Observed):** `background.js:49-60` writes only `lastError` on failure; `ratesData` is untouched. `AGENTS.md:38` documents this rule.

- **Rule:** Popup and background communicate only via `browser.runtime.sendMessage`.
  - **Rationale:** Extension architecture boundary — no shared JS scope between popup and background.
  - **Enforcement / Signals (Observed):** Popup never imports from `background.js`. All data flows through message actions (`getRates`, `refreshRates`, `ensureRates`).

- **Rule:** `content/avby.js` must be a self-contained IIFE with no ES module imports.
  - **Rationale:** MV3 content scripts run in an isolated world without module support.
  - **Enforcement / Signals (Observed):** The file wraps everything in `(function initAvByCurrencyConversion() { ... })();`. `manifest.json:28` loads it as plain JS, not as a module.

- **Rule:** Three functions (`parseBynPrice`, `convertFromBYN`, `formatDisplayPrice`) must be kept in sync between `lib/rates.js` and `content/avby.js`.
  - **Rationale:** The content script cannot import from `lib/`, so logic is duplicated. Divergence causes conversion bugs on AV.by pages.
  - **Enforcement / Signals (Observed):** Convention documented in `AGENTS.md:32,42`. Both test suites (`tests/parse.test.js`, `tests/content.test.js`) independently verify the duplicated logic. No automated sync check exists (`Inferred`).

- **Rule:** No `innerHTML` assignments — only `textContent` for DOM writes.
  - **Rationale:** XSS prevention on untrusted page DOM.
  - **Enforcement / Signals (Observed):** All DOM writes in `content/avby.js` and `popup/popup.js` use `textContent` or `nodeValue`. Documented in `AGENTS.md:29`.

- **Rule:** Test coverage for `lib/` must stay at or above 80% on all metrics.
  - **Rationale:** The pure-logic module is the canonical source for conversion and formatting.
  - **Enforcement / Signals (Observed):** `vitest.config.js:11-16` sets thresholds for lines, functions, branches, and statements. `make test` in `Makefile:10-11` runs coverage.

- **Rule:** Host permissions are limited to `https://api.nbrb.by/*` and `https://av.by/*` (including subdomains).
  - **Rationale:** Minimal privilege principle for a browser extension.
  - **Enforcement / Signals (Observed):** Declared in `manifest.json:7-11`. `AGENTS.md:40` forbids adding more without justification.

- **Rule:** Original BYN price text must be preserved for restoration when the user switches back to BYN.
  - **Rationale:** Without preservation, converting back to BYN would lose the original formatted price.
  - **Enforcement / Signals (Observed):** Content script stores original text in `data-*` attributes on elements (`content/avby.js:31-32,101-106`) and in `WeakMap` entries for monthly-payment text nodes (`content/avby.js:34,168`).

## 6. Documentation Strategy

- `ARCHITECTURE.md` (this file) — global map: component model, data flow, invariants, and physical layout. Start here for "where is X?" and "what must not change?".
- `AGENTS.md` — contributor-facing rules: change rules, validation commands, repository-specific gotchas, and module-level boundaries. The authoritative reference for what developers must preserve when editing code.
- `README.md` — user-facing and developer onboarding: features, usage instructions, development setup, build commands, and release process.
- `content/AGENTS.md` — local rules for the content script: DOM handling constraints, selector management, and testing guidance.
- `tests/AGENTS.md` — local rules for the test suite.

Global architecture docs cover component boundaries, data flow, and cross-cutting invariants. Local `AGENTS.md` files cover module-specific change rules, safety constraints, and nearby documentation references. Module-level `README.md` files are absent — each module is small enough that `AGENTS.md` and inline code suffice.
