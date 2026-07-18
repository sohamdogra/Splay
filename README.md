# Arvya Social Agent

Frontend-ready application backend for generating, reviewing, visually validating, scheduling, publishing, and learning from Arvya LinkedIn/X posts.

This repository no longer depends on being installed or invoked as a Codex skill. The editorial and publishing runtime is preserved as the domain core, while `apps/api` exposes a stable HTTP/JSON contract for a future frontend. No frontend is included yet.

## What changed

- A versioned API now exposes posts, media, review decisions, scheduling, generation jobs, publishing jobs, metrics, and feedback operations.
- Long-running and output-mutating jobs are serialized so a frontend cannot accidentally run conflicting generations or publishes.
- Publishing is fail-closed: it requires an explicit confirmation plus valid Buffer and, when needed, R2 configuration.
- Local-only networking, origin allowlisting, optional bearer authentication, bounded request bodies, and safe media paths are built in.
- The existing post-pack schema, editorial gates, deterministic compositor, visual QA, Buffer integration, database schema, and tests remain intact.

See [the application architecture](docs/app-architecture.md) and [the OpenAPI contract](apps/api/openapi.json).

## Requirements

- Node.js 22.6 or newer
- PostgreSQL only when database-backed metrics and feedback are needed
- Buffer and Cloudflare R2 credentials only for live publishing

Install the existing core dependencies:

```sh
npm --prefix scripts/runtime install
```

The root application uses Node's built-in HTTP server and has no additional production dependencies.

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

If `ARVYA_API_TOKEN` is configured, add `Authorization: Bearer <token>` to every request except the root, health, and OpenAPI discovery endpoints.

## Configuration

The API loads the root `.env` file. Existing secrets and generated output are not copied, rewritten, or committed. See `.env.example` for the full configuration surface.

This workspace copy intentionally excludes `.env`, `.gbrain-cache`, `output`, and `node_modules`. Set `GBRAIN_LOCAL_REPO` to a clean local GBrain checkout (or populate `<project>/.gbrain-cache`) before live generation. For a deterministic local demo, set `GBRAIN_USE_MOCK=1` and `SOCIAL_AGENT_USE_MOCK_LLM=1`.

Application settings:

- `API_HOST=127.0.0.1`
- `API_PORT=4173`
- `API_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173`
- `ARVYA_API_TOKEN` protects private API data and mutations and is mandatory for a non-loopback bind
- `API_BODY_LIMIT_BYTES` defaults to 2 MiB

Provider behavior:

- GBrain defaults to the credential-free, allowlisted local reader in `scripts/local-gbrain-mcp.py`.
- Text generation uses OpenAI or Anthropic when configured, otherwise the core's deterministic local generator.
- Visual generation keeps exact copy and official brand assets under the deterministic compositor.
- Publishing requires Buffer configuration and R2 whenever an approved post has local media.

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
scripts/runtime/       Existing editorial, visual, publishing, and analytics core
scripts/local-gbrain-* Credential-free local GBrain access
references/            Editorial and operational specifications
assets/brand-kit/      Official Arvya source assets
prisma (nested core)   Database schema and migrations
output/                Local post packs, previews, images, QA, and logs (ignored)
```

## Guardrails retained from the original workflow

- Use public-safe, traceable GBrain evidence; reject internal-only evidence.
- Use `Arvya`, never `Arvya.io`, in public copy.
- LinkedIn drafts require 3–4 relevant hashtags; X should normally use zero or one.
- Do not approve compliance failures or editorial rejects.
- Generate background artwork only; stamp exact copy and the official logo deterministically.
- Keep final artwork at 1200×675 and require passing visual QA.
- Queue only approved posts unless an explicitly designed no-review product flow is added later.

Before an internet or multi-user deployment, add the organization's identity-aware gateway and replace the in-memory job registry with a durable queue.
