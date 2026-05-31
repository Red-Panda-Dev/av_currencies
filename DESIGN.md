# DESIGN.md

## Purpose

This file provides UI design rules for AI agents modifying the extension's user-facing elements:

- Popup UI (`src/popup/popup.html`, `popup.css`, `popup.js`)
- Content script DOM manipulation (`src/content/avby.js`)
- Extension icons (`icons/`)
- User-facing copy in Russian

For architecture boundaries, data flow, and code organization, see `AGENTS.md` and `ARCHITECTURE.md`.

## Product feel

- **Functional utility tool** — prices are the focus, not chrome
- **Calm and data-focused** — neutral colors, minimal visual emphasis
- **Dense but scannable** — compact 320px popup, tabular rates, no decoration
- **Restrained** — no illustrations, animations, or promotional visuals
- **Offline-aware** — visual warnings when showing cached data
- **Respectful of host site** — content script changes blend into AV.by layout
- **Russian-language** — all user-facing text is in Russian

## Canonical UI examples

- `src/popup/popup.html` — complete popup layout with header, rates, converter, settings, footer
- `src/popup/popup.css` — CSS custom properties for light/dark theming, fixed-width popup
- `src/popup/popup.js:34-49` — `renderRates()` demonstrates safe DOM updates with `textContent`
- `src/popup/popup.js:70-79` — `renderStatus()` shows warning state styling
- `src/content/avby.js:227-233` — `formatDisplayPrice()` currency formatting pattern
- `src/content/avby.js:317-349` — `applyElementPrices()` DOM text replacement with original preservation
- `icons/icon.svg` — source icon; PNGs derived at standard sizes

## Layout rules

- Popup is fixed-width: `320px` via `--popup-width` in `:root`
- All width constraints applied to `html`, `body`, and `.popup` together
- Section order: header → rates → error/loading → converter → settings → footer
- Vertical rhythm: consistent `margin-bottom: 12px` between sections
- Padding: `16px` popup container, `10px 12px` for cards and rows
- No horizontal scrolling: `overflow-x: hidden` on `html` and `body`

## Visual language

### Colors (defined as CSS custom properties in `popup.css`)

Light mode:
- `--bg: #ffffff` — page background
- `--bg-card: #f7f8fa` — card/input background
- `--text: #1a1a2e` — primary text
- `--text-muted: #6b7280` — secondary text, labels
- `--border: #e5e7eb` — borders, separators
- `--accent: #1e40af` — currency codes, links, active states
- `--accent-hover: #1d4ed8` — hover variant
- `--error-bg/#error-text` — error states (red tones)
- `--warning-bg/#warning-text` — cached data warning (amber tones)

Dark mode via `prefers-color-scheme: dark`:
- Colors invert appropriately; see `popup.css:18-33`

### Typography

- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- Base: `14px` / `line-height: 1.5`
- Title: `16px`, `font-weight: 700`
- Section headers: `13px`, `font-weight: 600`, uppercase, letter-spacing
- Small text (status, timestamps): `11px`
- Numeric values: `font-variant-numeric: tabular-nums` for alignment

### Borders and radius

- Standard radius: `8px` (`--radius`)
- Subtle shadow: `0 1px 3px rgba(0, 0, 0, 0.08)` (`--shadow`)
- Borders: `1px solid var(--border)`

### Icons

- Currency flags: emoji (e.g., `🇺🇸`, `🇪🇺`, `🇷🇺`) at `18px` size
- Extension icons: simple two-tone design, SVG source, PNG exports at 16/32/48/128px

## Components and patterns

### Rate row (`src/popup/popup.html:14-30`)

```
.rate-row
├── .rate-row__flag    (emoji, 28px width)
├── .rate-row__code    (currency code, accent color, 36px width)
└── .rate-row__value   (rate text, right-aligned, tabular)
```

### Card container (`.rates`)

- Background: `var(--bg-card)`
- Rounded: `var(--radius)`
- Shadow: `var(--shadow)`
- Rows separated by `1px` border; last row has no bottom border

### Form inputs (`.converter__input`, `.settings__select`)

- Min-height: `44px` (touch-friendly)
- Padding: `10px 12px`
- Focus: accent border + subtle `box-shadow`
- No outline on focus (replaced by border/shadow)

### Buttons (`.footer__refresh`)

- Min-height: `44px`
- Default: card background, accent text, border
- Hover: accent background, white text
- Disabled: `opacity: 0.5`, `cursor: not-allowed`

### Status indicators

- Normal: empty status span
- Warning (cached data): yellow background, amber text, small padding, `4px` radius

### Error section (`.error`)

- Red background/text via `--error-*` variables
- Standard card padding and radius
- Hidden by default, shown when `lastError` exists without rates

### Loading state (`.loading`)

- Centered text, muted color
- Shown while waiting for initial rates

## Interaction rules

- **DOM updates use `textContent` only** — never `innerHTML` in popup or content script
- **Form state persists via storage** — `selectedCurrency` and `vinFeatureEnabled` saved immediately on change
- **Refresh button disables during fetch** — prevents duplicate requests
- **Content script converts in-place** — replaces price text, preserves "от" prefix
- **Original text preserved** — stored in `data-av-currencies-original-text` for restoration
- **VIN feature off by default** — checkbox unchecked, gated by explicit `true` in storage
- **External links** — use `target="_blank" rel="noopener noreferrer"`

## Data display rules

### Currency and rates

- Currency codes: 3-letter uppercase (`USD`, `EUR`, `RUB`, `BYN`)
- Rate display: numeric value with scale label (e.g., `3.25 за 1`, `3.51 за 100`)
- Converted prices: formatted with `Intl.NumberFormat("ru-RU")`, space before symbol
- Symbols: `$` for USD, `€` for EUR, `RUB` text for RUB, `р.` for BYN
- No decimal places for displayed prices (`maximumFractionDigits: 0`)

### Timestamps

- Format: `HH:MM` for "Обновлено:" line
- Muted text color, small font

### Price ranges

- Format: `NNN — NNN $` (en-dash, space-separated)

## Forms, filters, and validation

- Amount input: `type="number"`, `min="0"`, `step="any"`
- Currency selects: hardcoded options (USD, EUR, RUB for converter; BYN/USD/EUR/RUB for display)
- Validation: client-side only, invalid currencies fall back to default
- Labels: `<label>` elements with `for` attribute; `aria-label` on inputs

## Tables and charts

Not applicable — this extension has no tables or charts.

## User-facing text

- **Language:** Russian only
- **Tone:** Neutral, informative, no exclamation marks
- **Labels:** Short, descriptive ("Конвертер", "Валюта на av.by", "Обновить")
- **Status messages:** Factual ("Показаны сохранённые данные")
- **Error messages:** From API response, displayed as-is
- **VIN explanation link:** Points to `VIN-LOGIC.md` on GitHub

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

## Accessibility basics

- Inputs have visible `<label>` elements or `aria-label` attributes
- Buttons use `<button type="button">` with descriptive text
- Touch targets: minimum `44px` height
- Focus states: visible border color change
- Links: underlined, distinguishable color
- No hover-only critical information
- Semantic HTML: `<header>`, `<section>`, `<footer>`, `<h1>`, `<h2>`

## Do / Don't

Do:
- Use CSS custom properties for colors
- Update DOM with `textContent`, never `innerHTML`
- Preserve Russian text when editing UI
- Test popup width constraints remain aligned
- Keep emoji flags for currency indicators
- Store original BYN text before converting

Don't:
- Add inline event handlers in HTML
- Introduce new colors without updating CSS variables
- Add animations or transitions beyond existing button hover
- Import background.js or content script code into popup
- Change fixed popup width without testing browser popup behavior
- Remove VIN feature gating by `vinFeatureEnabled`
- Use `\n` or template literals for line breaks in UI text

## When unsure

- Inspect `src/popup/popup.html` and `popup.css` for current patterns
- Check `src/content/avby.js` for DOM manipulation style
- Reference `src/popup/AGENTS.md` for popup-specific invariants
- Reference `src/content/AGENTS.md` for content script rules
- Keep changes minimal; match the nearest existing pattern
- Ask before introducing new visual elements, colors, or interaction patterns
