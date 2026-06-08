# AGENTS.md

## Scope

Popup UI in `src/popup/`. This is the extension action popup shown to users for rates, conversion, display-currency selection, manual refresh, custom rate editing, and the optional VIN toggle.

## What lives here

```text
src/popup/
├── popup.html         # Russian MV3 popup markup; loads popup.js as a module
├── popup.css          # Fixed-width popup styling with light/dark color variables
└── popup.js           # DOM controller, rates rendering, custom rate editing, storage, messages
```

## Local boundaries and invariants

- `popup.js` imports pure helpers from `../lib/rates.js`; it must not import `src/background.js` or content-script code.
- Rate refresh and loading go through `browser.runtime.sendMessage({ action: "getRates" | "refreshRates" })`; do not fetch NBRB or Worker APIs from the popup.
- DOM updates use `textContent` and form properties. Do not add `innerHTML` or inline event handlers in `popup.html`.
- `selectedCurrency` and `vinFeatureEnabled` are persisted in `browser.storage.local`. Invalid or absent display currency falls back to `BYN`; VIN defaults to disabled unless the stored value is exactly `true`.
- `customRates` state is loaded on init via `getCustomRates` message and maintained locally. `refreshRates` clears both the local `customRates` object and the storage key.
- `getEffectiveRatesData(ratesData)` merges `customRates` onto `ratesData.rates` at render time; the converter uses effective rates.
- Popup text is Russian and visible in store screenshots/user docs; preserve tone and wording unless intentionally changing UX copy.
- External links in popup markup use `_blank` with `rel="noopener noreferrer"`.

## Custom rate editing

- Each `.rate-row` has a `✎` edit button with `data-currency`. Clicking it calls `enterEditMode()`, which hides `.rate-row__value` and `.rate-row__edit` and inserts a number input, `✓` accept button, and `✕` drop button.
- Accept/Enter sends `saveCustomRate` message, stores locally, and re-renders. Drop sends `clearCustomRate` (single currency), deletes locally, and re-renders.
- Rows with custom overrides get the `.rate-row--custom` class, recoloring the value to `--custom-rate` (amber).
- Blur on the input dismisses without saving unless the accept or drop button was the cause.

## Safe change rules

- If adding new controls to `popup.html`, update the `els` map in `popup.js` and add or adjust tests in `tests/popup.test.js`.
- Keep popup width constraints in `popup.css` aligned across `html`, `body`, and `.popup` so browser popup sizing stays predictable.
- When editing the VIN explanation link, keep it aligned with `VIN-LOGIC.md` and `tests/popup.test.js` expectations.
- New rate-row buttons or state modifiers must use `classList` and `textContent`; no `innerHTML`.

## Validation

```bash
npx vitest run tests/popup.test.js   # Popup tests only
npm test                             # Full extension suite with coverage
```

## Nearby docs

- `DESIGN.md` — full UI design rules, visual language, interaction patterns, and Russian string list.
- `tests/popup.test.js` — JSDOM popup harness and storage/message mock.
- `VIN-LOGIC.md` — user-facing VIN feature explanation linked from the popup.
- `src/lib/rates.js` — formatting and conversion helpers used by `popup.js`.