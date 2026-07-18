# Splay

Frontend-ready application backend for generating, reviewing, visually validating, scheduling, publishing, and learning from Splay LinkedIn/X posts.

This repository no longer depends on being installed or invoked as a Codex skill. The editorial and publishing runtime is preserved as the domain core, while `apps/api` exposes a stable HTTP/JSON contract for a future frontend. No frontend is included yet.

## What changed

- A versioned API now exposes posts, media, review decisions, scheduling, generation jobs, publishing jobs, metrics, and feedback operations.
- Long-running and output-mutating jobs are serialized so a frontend cannot accidentally run conflicting generations or publishes.
- Publishing is fail-closed: it requires an explicit confirmation plus valid Buffer and Convex storage configuration.
- Local-only networking, origin allowlisting, optional bearer authentication, bounded request bodies, and safe media paths are built in.
- The existing post-pack schema, editorial gates, deterministic compositor, visual QA, Buffer integration, database schema, and tests remain intact.

See [the application architecture](docs/app-architecture.md) and [the OpenAPI contract](apps/api/openapi.json).

## Requirements

- Node.js 22.6 or newer
- PostgreSQL only when database-backed metrics and feedback are needed
- A Convex deployment for durable public media URLs used by Buffer
- Buffer credentials only for live publishing

Install the application/Convex tooling and the existing core dependencies:

```sh
npm install
npm --prefix scripts/runtime install
```

The API uses Node's built-in HTTP server. The root Convex dependency serves the backend functions and the service-to-service upload client.

## Configure Convex storage

Start or connect a Convex development deployment:

```sh
npm run convex:dev
```

Convex writes `CONVEX_URL` and `CONVEX_DEPLOYMENT` to `.env.local`. Generate a high-entropy `CONVEX_INGEST_TOKEN`, put it in `.env.local` (or `.env`), and set the same value on the Convex deployment:

```sh
npm run convex:env -- set CONVEX_INGEST_TOKEN
```

The ingest token protects the two service-to-service mutations that issue upload URLs and finalize media. Deploy production functions with:

```sh
npm run convex:deploy
```

Convex returns a public bearer URL from `storage.getUrl()`. Buffer receives that URL, and it remains fetchable until the underlying Convex file is deleted. Do not delete scheduled-post media before Buffer has published it.

## Run the API

```sh
npm start
```

For restart-on-change development:

```sh
npm run dev
```

The default address is `http://127.0.0.1:4173`.

Useful endpoints:

- `GET /api/v1/health`
- `GET /api/v1/posts?platform=linkedin&status=draft`
- `GET /api/v1/posts/:id`
- `POST /api/v1/posts/:id/decisions`
- `PUT /api/v1/posts/:id/schedule`
- `POST /api/v1/jobs/generate`
- `POST /api/v1/jobs/publish-approved`
- `GET /api/v1/jobs/:id`
- `GET /media/*`
- `GET /preview` for the existing static compatibility preview

The full machine-readable contract is available at `GET /api/v1/openapi.json`.

## Example frontend flow

Generate from recent GBrain context:

```sh
curl -X POST http://127.0.0.1:4173/api/v1/jobs/generate \
  -H 'Content-Type: application/json' \
  -d '{"mode":"auto","creative":false}'
```

Generate for a specific topic:

```sh
curl -X POST http://127.0.0.1:4173/api/v1/jobs/generate \
  -H 'Content-Type: application/json' \
  -d '{"mode":"topic","topic":"buyer trackers lag behind the inbox"}'
```

Approve a post with structured feedback:

```sh
curl -X POST http://127.0.0.1:4173/api/v1/posts/POST_ID/decisions \
  -H 'Content-Type: application/json' \
  -d '{"decision":"approve","reason":"strong_insight"}'
```

Queue approved posts only after a distinct confirmation step:

```sh
curl -X POST http://127.0.0.1:4173/api/v1/jobs/publish-approved \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true}'
```

If `SPLAY_API_TOKEN` is configured, add `Authorization: Bearer <token>` to every request except the root, health, and OpenAPI discovery endpoints.

## Configuration

The API loads root `.env.local` first and then `.env`, without overwriting values already present in the process environment. Existing secrets and generated output are not copied, rewritten, or committed. See `.env.example` for the full configuration surface.

This workspace copy intentionally excludes `.env`, `.gbrain-cache`, `output`, and `node_modules`. Set `GBRAIN_LOCAL_REPO` to a clean local GBrain checkout (or populate `<project>/.gbrain-cache`) before live generation. For a deterministic local demo, set `GBRAIN_USE_MOCK=1` and `SOCIAL_AGENT_USE_MOCK_LLM=1`.

Application settings:

- `API_HOST=127.0.0.1`
- `API_PORT=4173`
- `API_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173`
- `SPLAY_API_TOKEN` protects private API data and mutations and is mandatory for a non-loopback bind
- `API_BODY_LIMIT_BYTES` defaults to 2 MiB

Provider behavior:

- GBrain defaults to the credential-free, allowlisted local reader in `scripts/local-gbrain-mcp.py`.
- Text generation uses OpenAI or Anthropic when configured, otherwise the core's deterministic local generator.
- Visual generation keeps exact copy and official brand assets under the deterministic compositor.
- Publishing requires Buffer configuration and Convex storage whenever an approved post has local media.

## Core commands

The CLI remains available for maintenance and automation, but the API is the application boundary:

```sh
npm run generate -- --topic "diligence context should survive the close"
npm run generate:auto
npm run decide -- --id <post_id> --decision revise --reason too_generic --note "Needs a source artifact"
npm run schedule -- --time 2026-07-20T16:00:00.000Z --all
npm run queue-approved
npm run metrics:collect
npm run metrics:score
npm run feedback:generate
```

## Test and validate

```sh
npm test
npm run check
npm run db:generate
```

Safe core generation remains available through the nested runtime:

```sh
npm --prefix scripts/runtime run test:generate:auto
```

Test mode writes to `output/test`, disables external publishing/database access, and uses mock providers.

## Layout

```text
apps/api/              HTTP application boundary and OpenAPI contract
convex/                Convex schema and protected media upload mutations
scripts/runtime/       Existing editorial, visual, publishing, and analytics core
scripts/local-gbrain-* Credential-free local GBrain access
references/            Editorial and operational specifications
assets/brand-kit/      Official Splay source assets
prisma (nested core)   Database schema and migrations
output/                Local post packs, previews, images, QA, and logs (ignored)
```

## Guardrails retained from the original workflow

- Use public-safe, traceable GBrain evidence; reject internal-only evidence.
- Use `Splay`, never `Splay.io`, in public copy.
- LinkedIn drafts require 3–4 relevant hashtags; X should normally use zero or one.
- Do not approve compliance failures or editorial rejects.
- Generate background artwork only; stamp exact copy and the official logo deterministically.
- Keep final artwork at 1200×675 and require passing visual QA.
- Queue only approved posts unless an explicitly designed no-review product flow is added later.

Before an internet or multi-user deployment, add the organization's identity-aware gateway and replace the in-memory job registry with a durable queue.
