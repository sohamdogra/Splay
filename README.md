# Splay

Local-first application for generating, reviewing, visually validating, scheduling, publishing, and learning from Splay LinkedIn/X posts. The React frontend lives in `apps/web` and uses the HTTP API in `apps/api`.

This repository no longer depends on being installed or invoked as a Codex skill. The editorial and publishing runtime is preserved as the domain core, while `apps/api` exposes the stable HTTP/JSON contract consumed by the frontend.

## What changed

- A versioned API now exposes posts, media, review decisions, scheduling, generation jobs, publishing jobs, metrics, and feedback operations.
- Recurring campaigns turn one brief into timezone-aware weekly draft slots that can be reviewed and scheduled through Buffer.
- A versioned brand kit stores the typography, palette, audience, voice, positioning, and logo settings used by new generation runs.
- A project-local company brain stores manually ingested context; only records explicitly approved as public-safe can enter generation prompts.
- Long-running and output-mutating jobs are serialized so a frontend cannot accidentally run conflicting generations or publishes.
- Publishing is fail-closed: it requires an explicit confirmation plus valid Buffer and Convex storage configuration.
- Local-only networking, origin allowlisting, optional bearer authentication, bounded request bodies, and safe media paths are built in.
- The existing post-pack schema, editorial gates, deterministic compositor, visual QA, Buffer integration, database schema, and tests remain intact.

See [the application architecture](docs/app-architecture.md) and [the OpenAPI contract](apps/api/openapi.json).

## Requirements

- Node.js 22.6 or newer
- PostgreSQL only when database-backed metrics and feedback are needed
- A Convex deployment for durable public media URLs used by Buffer
- A TokenMart API key for generated concepts, background plates, or background animation
- Buffer credentials only for live publishing

Install the application/Convex tooling and the existing core dependencies:

```sh
npm install
npm --prefix scripts/runtime install
npm --prefix apps/web install
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

## Run the frontend

Start the API in one terminal:

```sh
npm run dev
```

Start the frontend in a second terminal:

```sh
npm run dev:web
```

Open `http://127.0.0.1:5173`. Vite proxies API and media requests to the local API on port 4173. If `SPLAY_API_TOKEN` is configured, open **Settings** and enter it there; the token is kept only for the current browser tab.

For a production frontend build:

```sh
npm run build:web
```

The generated static files are written to `apps/web/dist`. To point a deployed frontend at a separately hosted API, set `VITE_SPLAY_API_URL` when building.

## Weekly campaign workflow

Open **Campaigns** in the frontend, then:

1. Set the campaign brief, optional weekly themes, platforms, first publish time, cadence, and number of weeks.
2. Create the campaign and choose **Generate weekly drafts**. Splay generates one platform draft for every future slot and preserves the selected local time across daylight-saving changes.
3. Review and approve the generated posts in **Review queue**.
4. Use the existing confirm-gated publish action. Buffer receives each approved campaign post as `customScheduled` with its exact future timestamp. Unscheduled posts use `shareNow` and publish immediately.

Pausing a campaign keeps its approved posts out of the Buffer publishing job. Campaign generation never auto-approves or silently publishes posts.

Open **Brand & brain** to edit the live typography and palette preview plus the generation voice, audience, positioning, avoid-list, tagline, and logo URL. Every save creates a new local version in `output/brand-kit.json`; campaign posts record the version used to generate them. The same screen accepts company facts, product notes, customer lessons, and other source material. Context is stored in `output/company-brain.json` and is excluded from generation until **Approved for public content** is checked.

Useful endpoints:

- `GET /api/v1/health`
- `GET /api/v1/posts?platform=linkedin&status=draft`
- `GET /api/v1/posts/:id`
- `GET|POST /api/v1/campaigns`
- `GET|PATCH /api/v1/campaigns/:id`
- `POST /api/v1/campaigns/:id/generate`
- `GET|PUT /api/v1/brand-kit`
- `GET|POST /api/v1/brain/context`
- `DELETE /api/v1/brain/context/:id`
- `POST /api/v1/posts/:id/decisions`
- `PUT /api/v1/posts/:id/schedule`
- `POST /api/v1/jobs/generate`
- `POST /api/v1/jobs/animate-background`
- `POST /api/v1/jobs/publish-approved`
- `GET /api/v1/jobs/:id`
- `GET /media/*`
- `GET /preview` for the existing static compatibility preview

The full machine-readable contract is available at `GET /api/v1/openapi.json`.

## Example frontend flow

Generate from public-safe company-brain context:

```sh
curl -X POST http://127.0.0.1:4173/api/v1/jobs/generate \
  -H 'Content-Type: application/json' \
  -d '{"mode":"auto","creative":false}'
```

Generate for a specific topic:

```sh
curl -X POST http://127.0.0.1:4173/api/v1/jobs/generate \
  -H 'Content-Type: application/json' \
  -d '{"mode":"topic","topic":"what customers value during onboarding"}'
```

Animate an existing generated background plate with Seedance:

```sh
curl -X POST http://127.0.0.1:4173/api/v1/jobs/animate-background \
  -H 'Content-Type: application/json' \
  -d '{"post_id":"POST_ID","duration":5,"resolution":"720p"}'
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

This workspace intentionally starts without external company knowledge. Save the brand kit and add project-owned company context through the frontend before automatic generation. There is no GBrain bridge or bundled context fallback.

Application settings:

- `API_HOST=127.0.0.1`
- `API_PORT=4173`
- `API_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173`
- `SPLAY_API_TOKEN` protects private API data and mutations and is mandatory for a non-loopback bind
- `API_BODY_LIMIT_BYTES` defaults to 2 MiB

Provider behavior:

- Company context comes only from the project-local brain. Stored-only records never enter generation prompts.
- Text generation uses OpenAI or Anthropic when configured, otherwise the core's deterministic local generator.
- TokenMart uses `dola-seedream-5-0-pro-260628` for concepts/backgrounds and `dreamina-seedance-2-0-260128` for background animation. Set `SOCIAL_AGENT_IMAGE_MODE=tokenmart-canva` to request generated plates.
- Visual generation keeps exact copy, official brand assets, CTA, pricing, and disclaimers outside the generative request and under a deterministic renderer, Canva, or Figma.
- The animation endpoint stores a raw background-only MP4 for frontend review. Buffer still publishes the validated static composite until exact video overlays have been rendered.
- Publishing requires Buffer configuration and Convex storage whenever an approved post has local media.

TokenMart uses `https://model.service-inference.ai` with bearer authentication. Model access is scoped to the API key, so verify the exact configured IDs with `GET /v1/models`. Splay fails the job if an exact model is unavailable; it does not silently fall back to another model.

Current catalog note (July 18, 2026): TokenMart's public catalog includes the requested Seedance model but does not yet expose Seedream under `imageModels`. The exact Seedream ID is supported by BytePlus; confirm that TokenMart has enabled it for your key before relying on live image generation.

## Core commands

The CLI remains available for maintenance and automation, but the API is the application boundary:

```sh
npm run generate -- --topic "what customers value during onboarding"
npm run generate:auto
npm run animate-background -- --post-id <post_id>
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

Run only the frontend tests with:

```sh
npm run test:web
```

Test mode writes to `output/test` and disables external publishing/database access. Automatic generation still requires locally stored public-safe context; there is intentionally no bundled company-data fixture.

## Layout

```text
apps/api/              HTTP application boundary and OpenAPI contract
apps/web/              React + Vite frontend
convex/                Convex schema and protected media upload mutations
scripts/runtime/       Existing editorial, visual, publishing, and analytics core
scripts/runtime/src/brain/ Project-local company-brain adapter
references/            Editorial and operational specifications
assets/brand-kit/      Official Splay source assets
prisma (nested core)   Database schema and migrations
output/                Local post packs, previews, images, QA, and logs (ignored)
```

## Guardrails retained from the original workflow

- Use only project-local context explicitly approved as public-safe; reject stored-only and internal-only evidence.
- Use `Splay`, never `Splay.io`, in public copy.
- LinkedIn drafts require 3–4 relevant hashtags; X should normally use zero or one.
- Do not approve compliance failures or editorial rejects.
- Generate background artwork only; stamp exact copy and the official logo deterministically.
- Keep final artwork at 1200×675 and require passing visual QA.
- Queue only approved posts unless an explicitly designed no-review product flow is added later.

Before an internet or multi-user deployment, add the organization's identity-aware gateway and replace the in-memory job registry with a durable queue.
