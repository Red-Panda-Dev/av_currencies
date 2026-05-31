# AGENTS.md

## Scope

Cloudflare Worker for the optional VIN feature. Handles VIN storage, retrieval, and confirmation for AV.by car pages. Deployed separately from the extension at `https://vin-api.redpandadev.workers.dev/`.

## What lives here

```
worker/
├── src/
│   ├── index.ts           # Main fetch handler: GET /api/vin/{pageId}, POST /api/vin
│   ├── crypto.ts          # Identity hash generation from request headers
│   ├── storage.ts         # KV namespace operations (get, put, record creation)
│   ├── types.ts           # TypeScript interfaces (Env, VinRecord, etc.)
│   └── validation.ts       # Input validation: pageId, VIN, pageUrl normalization
├── test/
│   └── worker.test.ts     # Vitest tests for all endpoints and edge cases
├── package.json           # Dependencies: wrangler, @cloudflare/workers-types, vitest, typescript
├── wrangler.jsonc         # Worker configuration: KV namespace binding, vars, observability
└── tsconfig.json          # TypeScript strict mode configuration
```

## Local boundaries and invariants

- **Independent deployment**: this Worker is deployed separately via `wrangler deploy` and has its own lifecycle
- **TypeScript project**: uses ES modules, strict TypeScript, and Cloudflare Workers types
- **KV storage**: uses `VIN_DATA` KV namespace for persistent storage — no other storage mechanisms
- **Identity tracking**: uses hashed IP + User-Agent + pageId to track requesters, not raw identifiers
- **CORS**: accepts requests from `chrome-extension://*` and `moz-extension://*` origins only (configurable via `ALLOWED_ORIGINS`)
- **No extension dependencies**: the Worker has zero dependencies on the extension codebase — it's a standalone service
- **Data model**: stores `{ pageId, pageUrl, vin, readConfirmations, writeConfirmations, createdAt, updatedAt }` records

## Safe change rules

- When changing KV key structure, ensure backward compatibility or implement migration logic
- When adding new endpoints, add corresponding tests to `test/worker.test.ts`
- Do not store raw IP addresses or User-Agent strings — use hashed identities only
- Keep `ALLOWED_ORIGINS` in `wrangler.jsonc` synchronized with any origin checks in code
- Test with both Chrome and Firefox extension origins

## Validation

```bash
cd worker
npm run typecheck         # TypeScript type checking
npm test                  # Run worker tests with Vitest
npm run dev               # Local development with wrangler dev
npm run deploy            # Deploy to Cloudflare
```

## Nearby docs

- `wrangler.jsonc` — KV namespace configuration and environment variables
- `src/types.ts` — TypeScript interfaces for the Worker environment and data models
- `ARCHITECTURE.md` (repo root) — section 5 covers the VIN feature data flow
- Extension side: VIN proxy logic in `src/background.js` (fetchVinForPage, submitVinForPage)
