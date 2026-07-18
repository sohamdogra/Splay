# Application architecture

This checkout is an application backend, not a Codex skill package. The existing TypeScript runtime remains the domain core while `apps/api` is the boundary a future frontend uses.

```text
Future frontend
      |
      | HTTP / JSON + generated media
      v
apps/api
  - authentication and CORS
  - request validation
  - serialized background jobs
  - publish preflight and confirmation
      |
      v
scripts/runtime
  - GBrain retrieval
  - editorial tournament and compliance gates
  - visual composition and QA
  - review state and scheduling
  - Convex storage, Buffer, metrics, and feedback
      |
      v
output/post-pack.json + optional PostgreSQL
```

## Why the core is still nested

The core is intentionally left in place during this conversion. That preserves the current post-pack format, image paths, migrations, tests, and uncommitted runtime work. The HTTP layer imports stable storage/review functions directly and runs long-lived generation or external-service operations as child jobs. A later refactor can promote the core to `packages/core` without changing the API contract.

## State and concurrency

`post-pack.json` remains the local source of truth. Generation, publishing, metrics, and feedback jobs run one at a time because they may touch the same output files. Review decisions and scheduling are serialized and rejected while a background job is active, preventing lost updates.

Jobs are currently process-local and retain the latest 100 completed records. Move jobs to a durable queue before running more than one API instance.

## Security model

- The API binds to `127.0.0.1` by default.
- A non-loopback bind is refused unless `SPLAY_API_TOKEN` is set.
- When a token is configured, every private data and mutation request requires `Authorization: Bearer <token>`; only root, health, and OpenAPI discovery remain public.
- Browser origins are allowlisted with `API_ALLOWED_ORIGINS`; wildcard CORS is not used.
- Publishing requires an explicit `confirm: true` request and preflights Buffer/Convex configuration.
- Local media is served only from the configured output directory.
- The default GBrain bridge is the repository's credential-free, public-safe local reader, not the legacy remote proxy.

For an internet deployment, put the API behind the application's normal identity-aware gateway. The bearer token is a useful local/shared-environment guard, not a multi-user authorization system.

## Frontend integration contract

The OpenAPI document lives at `apps/api/openapi.json` and is served from `/api/v1/openapi.json`. A future frontend should:

1. Read `/api/v1/health` for provider readiness.
2. Load and filter posts through `/api/v1/posts`.
3. use each post's returned `media_url` rather than its internal `image_url` path.
4. Submit decisions and schedules through the per-post endpoints.
5. Start long operations through `/api/v1/jobs/*` and poll the returned job URL/state.
6. Require a distinct user confirmation immediately before calling the publishing endpoint.

Do not parse `latest-preview.html` for application state; it is retained only as a compatibility review artifact.
