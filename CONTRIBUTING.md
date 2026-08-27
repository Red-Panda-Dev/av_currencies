# Contributing

Thank you for your interest in **AV.by Валюты** — a cross-browser WebExtension
(Firefox / Chrome) that shows AV.by car prices in USD, EUR, and RUB using NBRB
exchange rates, with an optional VIN-sharing feature backed by a Cloudflare
Worker. All contributions are welcome: bug reports, ideas, code fixes,
documentation, and translations.

> **Note on languages:** user-facing UI strings and the main
> [`README.md`](README.md) are in Russian — please keep them in Russian.
> Code comments, commit messages, and discussions may be written in English
> or Russian.

## Repository map

Before you start, familiarize yourself with the project documentation:

- [`README.md`](README.md) — user-facing documentation (in Russian);
- [`AGENTS.md`](AGENTS.md) — repository overview and key change rules;
- local `AGENTS.md` files in `src/content/`, `src/popup/`, `tests/`, and
  `worker/` — rules specific to each part of the codebase;
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — architecture and data flow;
- [`DESIGN.md`](DESIGN.md) — UI, components, and Russian UX copy;
- [`VIN-LOGIC.md`](VIN-LOGIC.md) — VIN-sharing behavior;
- [`worker/README.md`](worker/README.md) — the Cloudflare Worker behind the
  VIN API.

## Setting up your environment

1. Install a current LTS version of [Node.js](https://nodejs.org/).
2. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

3. If you plan to work on the Worker, install its dependencies too:

   ```bash
   cd worker && npm install
   ```

## Checks before opening a PR

Make sure everything passes locally:

```bash
npm run format          # Prettier (or npm run format:check)
npm test                # Vitest with coverage
make test-worker        # Worker tests (if you changed worker/)
npm run package         # build Firefox and Chrome packages
```

Or run everything at once:

```bash
make build              # format, lint, test, then package both browsers
```

Coverage requirement: `src/lib/rates.js` and `src/background.js` must stay at
**≥ 80%** for lines, functions, branches, and statements.

## Key codebase rules

- **`src/lib/rates.js` is pure logic**: no `browser.*`, `document`, `fetch`, or
  `window` references. The module must stay importable in plain Node.js.
- **Network only in the background script**: all extension network requests
  live in `src/background.js`; the popup and content script communicate via
  `browser.runtime.sendMessage` and storage.
- **DOM via `textContent` only**: no `innerHTML` or inline event handlers.
- **Duplicates in the content script**: `src/content/avby.js` is a
  self-contained IIFE; when changing `parseBynPrice`, `convertFromBYN`,
  `formatDisplayPrice`, or `formatDisplayPriceRange`, keep its copies in sync
  with `src/lib/rates.js`.
- **Rate offline resilience**: a failed NBRB refresh must never overwrite the
  last valid `ratesData` cache — only `lastError` is updated.
- **Custom rates** are stored separately under `customRates` and merged with
  official rates only at read time.
- **Permissions**: `host_permissions` are limited to the NBRB API and the
  VIN Worker API; new permissions require explicit justification.
- **Russian UI strings** must be preserved when editing the popup, content
  script, or user-facing documentation.
- **Tests**: every feature or bugfix ships with tests; if the content script
  starts using a new browser API, extend its local mock in
  `tests/content.test.js`.

## Commit and pull request style

- One logical change per PR, with a clear description in English or Russian.
- Commits in the imperative mood: `Add EUR tooltip`, `Fix RUB scale`.
- Reference related issues (`Fixes #123`).

## Running locally for debugging

```bash
make run          # Firefox
make run-chrome   # Chrome
make run-android  # Firefox for Android
```

## Questions and bug reports

Open an issue describing the problem, reproduction steps, browser version, and
screenshots where appropriate. Write in Russian or English.

This project is licensed under the [MIT License](LICENSE.md). By participating
in this project you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
