# AV Currencies VIN Worker

Cloudflare Worker backend for the optional VIN feature in the AV Currencies browser extension.

## Business logic (brief)

- Stores and serves VIN data for AV.by vehicle pages.
- `POST /api/vin` accepts `{ pageId, pageUrl, vin }` and:
  - validates payload,
  - creates a new record if page has no VIN yet,
  - confirms existing VIN if the same VIN is submitted again,
  - rejects conflicting VIN for the same page.
- `GET /api/vin/{pageId}` returns VIN data and records read confirmations.
- Tracks request identity via hash of IP + User-Agent + salt, not raw identifiers.

## Network and platform

- Runtime: Cloudflare Workers.
- Storage: Cloudflare KV namespace `VIN_DATA`.
- Secrets: `IDENTITY_SALT` bound from Cloudflare Secrets Store (store id `629e5dd6594845a889e6ddabb26cc009`, secret name `AV_BY_USERS_SALT`). The salt value is never stored in git.
- Public API base URL used by the extension:
  - `https://avby.currencies-bel.top`
- API endpoints:
  - `GET /api/vin/{pageId}`
  - `POST /api/vin`
- CORS policy:
  - allows browser extension origins (`chrome-extension://*`, `moz-extension://*`) configured via `ALLOWED_ORIGINS`.

## Request flow (high level)

1. Extension content/popup logic sends message to extension background script.
2. Background script calls this Worker over HTTPS.
3. Worker validates input, reads/writes KV, returns JSON response.
