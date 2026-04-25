# AGENTS.md

## Repository overview

Firefox WebExtension (Manifest V3) showing USD/EUR/RUB exchange rates against BYN from the NBRB API. UI is in Russian. Offline-resilient: cached rates persist across network failures.

## Where to work

```
background.js          # Background event page: fetch, alarms, storage, messaging
lib/
└── rates.js           # Pure logic: parsing, conversion, formatting — no browser APIs
popup/
├── popup.html         # Popup markup
├── popup.css          # Styling with light/dark theme support
└── popup.js           # Popup controller: render, converter, refresh
tests/
└── parse.test.js      # Vitest tests for lib/rates.js
```

## Architecture and boundaries

- `lib/rates.js` has **zero** browser API dependencies — never add `browser.*`, `document`, `fetch`, or `window` references to it
- Background and popup communicate **only** via `browser.runtime.sendMessage` — never import one from the other
- All `fetch` calls live in `background.js` only — popup never calls `fetch` directly
- Popup uses `textContent` exclusively — never `innerHTML` (XSS prevention)
- No remote code, no CDN scripts, no inline event handlers

Read `ARCHITECTURE.md` for the full component model, data flow, and invariants.

## Change rules

- Failed API responses must not overwrite previously stored valid rates — only `lastError` is updated on failure
- `lib/rates.js` must remain importable in plain Node.js without mocks or polyfills
- The only host permission is `https://api.nbrb.by/*` — do not add additional host permissions without justification
- Test coverage for `lib/` must stay at or above 80% on all metrics (lines, functions, branches, statements)

## Validation

```bash
npm test                  # Run tests
npm run test:coverage     # Run tests with coverage (enforces 80% threshold on lib/)
npm run format:check      # Check formatting
npm run format            # Auto-format
make lint                 # web-ext lint (extension-specific checks)
make build                # Full pipeline: format-check + lint + test + zip
```

## Key docs

- `ARCHITECTURE.md` — full architecture, data flow, invariants, code map
- `nbrb_reponse.json` — real NBRB API response fixture used by tests
- `manifest.json` — extension permissions, entrypoints, version
- `Makefile` — build/run/lint/test commands

## Repository-specific gotchas

- NBRB API uses `Cur_Abbreviation`, `Cur_Scale`, `Cur_OfficialRate` — PascalCase field names from the upstream API
- RUB rate has scale 100 (not 1) — conversion must divide by scale: `(amount * rate) / scale`
- `TARGET_CURRENCIES` is `["USD", "EUR", "RUB"]` — `parseRates` returns `null` if any of the three are missing from the API response
- UI strings are in Russian — preserve Russian text when editing popup markup or JS
- Alarm interval is 240 minutes (4 hours) — configured as `ALARM_INTERVAL_MINUTES` in `background.js`
- `nbrb_reponse.json` is a test fixture checked into the repo — it documents the expected API response shape
