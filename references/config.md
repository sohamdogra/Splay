# Configuration Reference

Keep secrets in the shell environment or local `.env`; never commit them to the application.

## Company Brain

Company context is stored in `output/company-brain.json` through the frontend or `/api/v1/brain/context`. It has no external provider settings. A record must have `public_safe: true` before the runtime will return it to a generation job. The original external GBrain, MCP bridge, and bundled fallback dataset are intentionally unsupported.

## Generation

- `SOCIAL_AGENT_CREATIVE_MODE=1`: enable creative runtime variation.
- `SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST=1`: avoid sharing one image across LinkedIn/X posts.
- `SOCIAL_AGENT_IMAGE_MODE=canva|tokenmart-canva|placeholder`: select deterministic-only, TokenMart background plus deterministic composition, or placeholder rendering.
- `SOCIAL_AGENT_CREATIVE_IMAGE_MODE=tokenmart-canva`: use TokenMart backgrounds for API creative-generation jobs.
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: optional text-generation keys only.
- `TOKENMART_API_KEY`: TokenMart bearer credential. Keep it server-side.
- `TOKENMART_BASE_URL`: gateway override; defaults to `https://model.service-inference.ai`.
- `TOKENMART_IMAGE_MODEL`: defaults to `dola-seedream-5-0-pro-260628`.
- `TOKENMART_IMAGE_SIZE`: defaults to `1280x720` for the 16:9 composition contract.
- `TOKENMART_VIDEO_MODEL`: defaults to `dreamina-seedance-2-0-260128`.
- `TOKENMART_BACKGROUND_CANDIDATES`: number of ranked Seedream plates requested per post (default `2`).
- `TOKENMART_MAX_RETRIES`: retry count for timeouts, rate limits, and server errors only (default `2`). Billing and other terminal client errors are never retried.
- `TOKENMART_REQUEST_TIMEOUT_MS`, `TOKENMART_VIDEO_POLL_INTERVAL_MS`, `TOKENMART_VIDEO_TIMEOUT_MS`: request and asynchronous animation timing controls.

TokenMart produces concepts, background plates, and raw background animation only. Exact Splay logo assets, typography, CTA, pricing, and disclaimers stay outside the generative request and must be added afterward with the deterministic HTML/canvas renderer, Canva, or Figma. Splay never substitutes a different media model silently: confirm the configured key can see both exact model IDs through TokenMart's `GET /v1/models` endpoint before a live run.

As of July 18, 2026, TokenMart's unauthenticated public catalog lists the requested Seedance model but no Seedream image models. The requested Seedream ID is documented by BytePlus and may require key-specific TokenMart entitlement. Treat a TokenMart `403 ERR_MODEL_001` or `404 ERR_MODEL_002` as a configuration/access issue; Splay stops instead of switching providers or models.

Final publishing artwork follows the fixed 1200x675 (16:9) dark-blue wave contract regardless of background-provider dimensions. Existing rendered 1080x1350 posts retain their recorded QA metadata and remain readable as legacy assets; new attachments and replacements use 16:9.

## Output And Test Mode

- `SOCIAL_AGENT_OUTPUT_DIR`: override output location.
- `SOCIAL_AGENT_TEST_MODE=1`: use `output/test`, disable DB/external publishing, and allow mock publisher.
- `scheduled_for` on a post: optional exact Buffer schedule time, set via imported drafts or `schedule --time <ISO>`.

## Convex Media Storage

- `CONVEX_URL`: deployment URL used by the server-side Convex client. `convex dev` writes this to `.env.local`.
- `CONVEX_INGEST_TOKEN`: high-entropy shared secret used only for the runtime-to-Convex upload mutations. Set the same value locally and in the Convex deployment environment; never send it to a browser.
- `CONVEX_DEPLOYMENT`: development deployment selector managed by the Convex CLI.
- `CONVEX_DEPLOY_KEY`: optional CI/production deployment credential; never expose it to a frontend.

Local images are uploaded through a one-time Convex upload URL. Buffer receives only the public HTTPS URL returned by `storage.getUrl()`.

## Brand

- `BRAND_NAME`, `BRAND_AUDIENCE`, `BRAND_TONE`: optional brand profile overrides.
- `SPLAY_REFERENCE_ASSET_DIR`: optional local visual reference exports for Canva briefs.

The application includes Splay brand assets under `assets/brand-kit` and a renderer copy under `scripts/runtime/brand-kit`.

## LinkedIn Mentions

- `LINKEDIN_MENTION_REGISTRY_PATH`: optional path to a JSON array (or `{ "entities": [] }`) of verified people and organizations. Without this setting, the publisher reads `output/linkedin-mentions.json` when present.
- `LINKEDIN_BRAND_ORGANIZATION_ID` and `LINKEDIN_BRAND_VANITY_NAME`: optional verified Splay organization identity. Configure both to enable automatic brand mentions; no organization ID is hard-coded.
- `LINKEDIN_BRAND_LOCALIZED_NAME` and `LINKEDIN_BRAND_URL`: optional display-name and company-page overrides for the configured organization.
- Each extra entity requires `aliases`, `id`, `link`, `entity`, `vanityName`, `localizedName`, and `kind` (`person` or `organization`). Publishing fails closed when a configured registry is malformed.
