# DESIGN.md

## Purpose

This file provides UI design rules for AI agents modifying user-facing elements in this WebExtension:

- Popup UI (`src/popup/popup.html`, `popup.css`, `popup.js`)
- Content script DOM manipulation on AV.by (`src/content/avby.js`)
- Extension icons (`icons/`)
- Russian user-facing copy and currency formatting (`src/lib/rates.js`)

For architecture boundaries, data flow, and code organization, see `AGENTS.md`, `src/popup/AGENTS.md`, and `src/content/AGENTS.md`. For the bigger picture, see `ARCHITECTURE.md`.

## Product feel

- **Functional utility tool** — prices are the focus, not chrome.
- **Dark, calm, data-focused** — dark background, neutral colors, minimal visual emphasis.
- **Dense but scannable** — compact 320px popup, tabular rates, no decoration.
- **Restrained** — no illustrations, animations, or promotional visuals.
- **Offline-aware** — visual warning when showing cached data.
- **Respectful of host site** — content script changes blend into AV.by layout, never restyle it.
- **Russian-language** — all user-facing text is in Russian.
- **Non-intrusive** — the extension is opt-in per currency and opt-in for VIN sharing; defaults are conservative.

## Canonical UI examples

- `src/popup/popup.html` — full popup layout: header, rates card, loading, error, converter, settings, footer.
- `src/popup/popup.css:1-17` — CSS custom properties (dark theme) and the `--popup-width: 320px` constraint.
- `src/popup/popup.css:78-84` — `.rates` card container with background, radius, shadow.
- `src/popup/popup.css:86-175` — `.rate-row` structure (flag, code, value, edit) and state modifiers (`--custom`, `--editing`).
- `src/popup/popup.css:194-207` — `.loading` and `.error` state styling.
- `src/popup/popup.css:209-280` — `.converter` section (title, row, input, select, result).
- `src/popup/popup.css:282-316` — `.settings` (label, select, VIN block, link).
- `src/popup/popup.css:351-402` — `.footer` (updated timestamp, refresh button) plus the `max-width: 380px` mobile tweak.
- `src/popup/popup.js:55-81` — `renderRates()` safe DOM updates with `textContent`.
- `src/popup/popup.js:103-112` — `renderStatus()` warning state (cached data).
- `src/popup/popup.js:173-293` — `enterEditMode()` / `exitEditMode()` for custom rate editing.
- `src/lib/rates.js:55-67` — `formatDisplayPrice()` and `formatRateLabel()` currency formatting.
- `src/content/avby.js` (IIFE) — in-place text replacement with original-text preservation; `applyElementPrices()`, `applySalonPriceSuffixes()`, `applyOriginalDaysOnSale()`.
- `icons/icon.svg` — source icon; PNGs derived at 16/32/48/128px.

## Layout rules

- Popup is fixed-width: `320px` via `--popup-width`. Apply `width`/`min-width`/`max-width` to `html`, `body`, and `.popup` together so the browser popup stays predictable.
- No horizontal scrolling: `overflow-x: hidden` on `html` and `body`.
- Section order in `popup.html` (visual order): `header` → `rates` → `loading` → `error` → `converter` → `settings` → `footer`. The `loading`, `error`, `rates`, and `converter` sections toggle with the `hidden` attribute rather than being conditionally rendered.
- Vertical rhythm: `margin-bottom: 12px` between sections.
- Padding: `16px` on `.popup`, `12px` on narrow screens, `10px 12px` for cards/rows/inputs.
- Narrow-viewport tweak: at `max-width: 380px`, reduce popup padding to `12px` and let the footer stretch (`gap: 8px; align-items: stretch`).

## Visual language

### Colors (CSS custom properties in `popup.css`)

Dark theme (single theme, no `prefers-color-scheme` toggle):
- `--bg: #1a1a2e` — page background.
- `--bg-card: #252542` — card and input background.
- `--text: #e5e7eb` — primary text.
- `--text-muted: #9ca3af` — secondary text, labels, status.
- `--border: #374151` — borders, separators.
- `--accent: #60a5fa` — currency codes, links, active state, focus borders.
- `--accent-hover: #93bbfd` — hover variant.
- `--error-bg: #3b1c1c` / `--error-text: #fca5a5` — error states.
- `--warning-bg: #3b2e1c` / `--warning-text: #fcd34d` — cached-data warning.
- `--custom-rate: #fbbf24` — rate value when the user overrode it.

Add a new semantic color by introducing a CSS variable, not a raw hex. All colors flow through variables so a future light theme can be added by overriding the `:root` block.

### Typography

- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- Base: `14px`, `line-height: 1.5`.
- Title (`h1`): `16px`, `font-weight: 700`.
- Section labels: `13px`, `font-weight: 600`, uppercase, `letter-spacing: 0.5px`, muted color.
- Settings label: `12px`, `font-weight: 600`.
- Status / timestamps: `11px`, muted.
- Converter/select inputs: `16px`, `font-weight: 600` for emphasis.
- Numeric values use `font-variant-numeric: tabular-nums` for alignment.

### Borders, radius, shadow

- Standard radius: `8px` (`--radius`); smaller controls use `4px`.
- Shadow: `0 1px 3px rgba(0, 0, 0, 0.3)`.
- Borders: `1px solid var(--border)`.
- Card rows inside `.rates` are separated by a `1px` bottom border; the last row has none.

### Icons

- Currency flags: emoji (`🇺🇸`, `🇪🇺`, `🇷🇺`) at `18px`, fixed `28px` column width.
- Rate row edit affordance: `✎` (pencil); accept `✓`; drop `✕`. Buttons share the same `4px` radius, `1px` border, and `--border` color; accept text is `#16a34a`, drop text is `#dc2626`.
- Extension icon: simple two-tone SVG, PNG exports at 16/32/48/128px.

## Components and patterns

### Rate row (`src/popup/popup.html:15-38`)

```
.rate-row                              (flex row, 10px 12px padding)
├── .rate-row__flag                    (emoji, 28px column)
├── .rate-row__code                    (3-letter code, accent color, 36px column)
├── .rate-row__value                   (right-aligned rate, tabular)
└── .rate-row__edit                    (✎ button; hidden in editing state)
    ├── .rate-row__input               (number input, replaces value in editing state)
    ├── .rate-row__accept              (✓)
    └── .rate-row__drop                (✕)
```

State modifiers:
- `.rate-row--custom` recolors `.rate-row__value` to `--custom-rate`.
- `.rate-row--editing` hides `.rate-row__value` and `.rate-row__edit`, exposing input/accept/drop.
- Editing completes on Enter, blur, ✓, or ✕. Escape cancels.

### Card container (`.rates`)

- Background `var(--bg-card)`, `var(--radius)`, `var(--shadow)`, `overflow: hidden`.
- Rows separated by `1px` border; last row has no bottom border.

### Form inputs (`.converter__input`, `.settings__select`)

- Min-height `44px` (touch-friendly).
- Padding `10px 12px`.
- Focus: accent border + `box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.25)` on the converter input; accent border only on selects.
- Hover on selects: inverts to accent background with white text.
- No native outline (replaced by border/shadow).

### Buttons (`.footer__refresh`, `.rate-row__edit/accept/drop`)

- Refresh: `min-height: 44px`, default `--bg-card` with `--accent` text, hover inverts to accent bg with white text. Disabled: `opacity: 0.5; cursor: not-allowed`.
- Inline rate-row buttons: `padding: 2px 6px`, no background, accent border, accept/drop use semantic green/red text and a tinted hover.

### Status indicators

- Normal: empty status span.
- Warning (cached data): `header__status--warning` modifier — amber background, amber text, `2px 6px` padding, `4px` radius.

### Error section (`.error`)

- Red background/text via `--error-*` variables; standard card padding and radius.
- Hidden by default; shown when `lastError` exists without rates, or shown together with rates when the network failed but cached data is still usable.

### Loading state (`.loading`)

- Centered muted text, `padding: 24px 0`.
- Shown until first successful rates response, hidden afterwards.

## Interaction rules

- **DOM updates use `textContent` only** — never `innerHTML` in popup or content script. Content script text-node updates use `nodeValue`.
- **No inline event handlers** — all listeners attach in `popup.js` (`addEventListener`).
- **Form state persists in storage** — `selectedCurrency` and `vinFeatureEnabled` are saved on `change`; invalid display currency falls back to `BYN`; VIN defaults to disabled unless stored value is `true`.
- **Refresh button disables during fetch** — prevents duplicate requests.
- **Custom rate editing** — clicking ✎ enters edit mode; saving sends `saveCustomRate`; ✕ sends `clearCustomRate` and restores the NBRB rate.
- **Content script converts in-place** — replaces price text, preserves `от` prefix, and suppresses the BYN `р.` suffix when the value is already in another currency.
- **Original text preserved** — content script caches BYN text in `data-av-currencies-original-text` and `data-av-currencies-byn-amount` for restoration.
- **VIN feature off by default** — gated by explicit `true`; never enable silently.
- **External links** — `target="_blank" rel="noopener noreferrer"`.
- **No new animations** — only the existing `transition: background 0.15s, border-color 0.15s` on the refresh button.

## Data display rules

- **Currency codes** are 3-letter uppercase (`USD`, `EUR`, `RUB`, `BYN`).
- **Rate display** — `formatRateLabel()` produces `X.XXXX BYN за 1 USD` / `… за 100 RUB`; SCALE_LABELS is the source of truth for the denominator.
- **Converted prices** use `Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 })` with a space before the symbol. Symbols: `р.` for BYN, `$` for USD, `€` for EUR, `RUB` for RUB.
- **Timestamps** use `formatTime()` for `Обновлено:` (`dd.mm HH:MM`).
- **Date ranges** — `formatDisplayPriceRange()` uses an em-dash with spaces (`N — N $`).
- **Days-on-sale** — content script appends `, всего N дней в продаже` to the first card stat whose text matches a date keyword (`опубликовано`, `обновлено`, `часов назад`, `дня назад`, `…`).
- **Empty / unknown values** — leave sections hidden rather than showing placeholders. Errors render the API message as-is in `.error`.
- **Comparisons / uncertainty** — when AV.by shows paired `р. ≈ $` lines (`PRICE_HISTORY_DUAL_REGEX`) or `≈ $…` secondary values, the content script converts both sides to the selected currency; if USD rate is missing, the secondary side stays in USD.

## Forms, filters, and validation

- Amount input: `type="number"`, `min="0"`, `step="any"`, default `value="1"`.
- Currency selects are hardcoded: converter uses `USD/EUR/RUB`; display-currency select uses `BYN/USD/EUR/RUB`.
- Custom rate input: `type="number"`, `step="0.001"`, `min="0.001"`; non-positive or non-numeric values are ignored.
- Validation is client-side only. Invalid or missing values fall back to safe defaults (`BYN` for display currency, disabled for VIN).
- Labels: `<label for="…">` for select/checkbox; `aria-label` is set when a visible label is impractical (e.g., row edit buttons).
- The converter always shows the result as `= … BYN` regardless of source currency.

## Tables and charts

Not applicable — the extension has no tables or charts. Numerical alignment is achieved with `font-variant-numeric: tabular-nums` on rates, converter input/result, and custom rate input.

## User-facing text

- **Language:** Russian only.
- **Tone:** Neutral, informative, no exclamation marks.
- **Labels:** Short and descriptive (`Конвертер`, `Валюта на av.by`, `Обновить`).
- **Status messages:** Factual — cached data is `Показаны сохранённые данные`; loading is `Загрузка…`.
- **Error messages:** Render the API response as-is.
- **VIN explanation link** points to `VIN-LOGIC.md` on GitHub; keep it aligned with that file.
- Avoid technical implementation words in user-visible strings; never expose background/content-script internals.

### Key Russian strings (preserve these)

- Header title: `AV.by Валюты`
- Loading: `Загрузка…`
- Refresh button: `Обновить`
- Converter section: `Конвертер`
- Display currency label: `Валюта на av.by`
- VIN checkbox: `Сохранение VIN: Автоматически показывать и сохранять VIN автомобиля в общей базе.`
- Updated timestamp prefix: `Обновлено:`
- Warning status: `Показаны сохранённые данные`
- Days on sale suffix: `, всего N дней в продаже`
- Rate row edit button `aria-label` pattern: `Изменить курс USD` / `Сохранить курс USD` / `Отменить изменение курса USD`.
- Russian escape sequences (e.g. `\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e:` in `popup.js`) are the same strings — keep them aligned with the visible text.

## Accessibility basics

- All inputs have a visible `<label>` with `for` or a meaningful `aria-label`.
- Buttons use `<button type="button">` with descriptive text or `aria-label`.
- Touch targets: minimum `44px` height for primary controls (inputs, refresh button).
- Focus states: visible border color change; the converter input also shows a 2px accent ring.
- Links: underlined, distinguishable accent color.
- No hover-only critical information; cached-data warning and errors remain visible.
- Semantic HTML: `<header>`, `<section>`, `<footer>`, `<h1>`, `<h2>`.
- Color is not the only signal: cached-data state adds a background tint, errors use a dedicated section, custom rates add a text color change plus the persisted override in storage.

## Do / Don't

Do:
- Reuse CSS custom properties for any new color or shadow.
- Update DOM with `textContent` or `nodeValue` only.
- Preserve Russian text and the `popup.js` Unicode escapes when editing visible strings.
- Toggle sections with the `hidden` attribute; do not remove them from the DOM.
- Keep the popup width constraints in `popup.css` aligned across `html`, `body`, and `.popup`.
- Store original BYN text in `data-av-currencies-*` dataset fields before converting.
- Mirror conversion logic changes in both `src/content/avby.js` and `src/lib/rates.js`.
- Keep VIN behavior gated by `vinFeatureEnabled === true`.

Don't:
- Add inline event handlers in `popup.html`.
- Introduce raw hex colors; update the CSS custom properties instead.
- Add animations or transitions beyond the existing refresh-button transition.
- Import `src/background.js` or content-script code into the popup.
- Change the fixed popup width without verifying both browser popups.
- Restyle AV.by host elements; only replace their `textContent`.
- Add a new visual pattern (toast, modal, banner) without explicit UX intent.
- Use `\n` or template literals for line breaks in user-visible UI text.
- Enable the VIN feature by default or remove the storage gate.

## When unsure

- Inspect `src/popup/popup.html`, `src/popup/popup.css`, and `src/popup/popup.js` for current patterns before adding UI.
- Read `src/popup/AGENTS.md` and `src/content/AGENTS.md` for local invariants.
- For new AV.by markup, add a new selector group with its own `apply…` function rather than overloading an existing one.
- Keep diffs minimal; match the nearest existing pattern.
- Ask before introducing new visual elements, colors, typography, or interaction patterns.
- Document the assumption briefly in the change (e.g., commit message) when the nearest pattern is unclear.
