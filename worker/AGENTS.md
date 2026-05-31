# AGENTS.md

## Scope

Cloudflare Worker for the optional VIN sharing feature. It is deployed separately from the extension and serves the public API base URL `https://avby.currencies-bel.top`.

## What lives here

```text
worker/
├── src/
│   ├── index.ts           # Fetch handler, CORS, GET /api/vin/{pageId}, POST /api/vin
│   ├── crypto.ts          # Request identity hashing using IDENTITY_SALT
│   ├── storage.ts         # Cloudflare KV read/write and confirmation bookkeeping
│   ├── types.ts           # Env and VIN record TypeScript types
│   └── validation.ts      # pageId, VIN, and pageUrl normalization/validation
├── test/
│   └── worker.test.ts     # Endpoint, validation, CORS, storage, and confirmation tests
├── wrangler.toml          # Routes, KV binding, vars, Secrets Store binding, observability
├── deploy.sh              # Runs npm run build, then wrangler deploy
└── package.json           # Worker-local build/test/deploy scripts
```

## Local boundaries and invariants

- Runtime is Cloudflare Workers with TypeScript strict mode and `@cloudflare/workers-types`.
- Persistent storage is the `VIN_DATA` KV namespace. Do not introduce another storage backend without updating tests, config, and docs.
- `IDENTITY_SALT` is a Secrets Store binding; never hard-code or commit its value.
- Request identity is derived from salt, IP, User-Agent, and page data; raw IP/User-Agent values must not be stored.
- CORS is controlled by `ALLOWED_ORIGINS` in `wrangler.toml` and currently allows `chrome-extension://*` and `moz-extension://*`.
- VIN records track `pageId`, `pageUrl`, `vin`, read/write confirmations, and timestamps. Conflicting VIN submissions for an existing page are rejected, not replaced.
- Keep routes in `wrangler.toml`, extension `VIN_WORKER_API_BASE`, `manifest.json` host permissions, and Worker tests aligned with `https://avby.currencies-bel.top`.

## Safe change rules

- When changing the KV key format or record shape, provide compatibility or a deliberate migration path; existing records may already be in KV.
- When adding endpoints or changing error payloads, update `test/worker.test.ts` and extension-side handling in `src/background.js` if needed.
- Keep validation centralized in `src/validation.ts` rather than duplicating regexes in handlers.
- Do not broaden CORS or extension host permissions without a concrete product reason documented in code/config.

## Validation

```bash
cd worker
npm run build          # TypeScript check with no emit
npm test               # Worker Vitest suite with coverage
npm run deploy         # Wrangler deploy only
./deploy.sh            # Build, then deploy
```

From the repository root, `make test-worker` runs Worker tests and `make deploy-worker` runs `worker/deploy.sh`.

## Nearby docs

- `worker/README.md` — Worker business logic, API base URL, CORS, KV, and Secrets Store notes.
- `wrangler.toml` — deployment route, KV namespace binding, vars, observability, and smart placement.
- `VIN-LOGIC.md` — user-facing explanation of VIN sharing and confirmation behavior.
- Extension side: `src/background.js` handles `fetchVinForPage` and `submitVinForPage`.
