# Configuration Reference

Keep secrets in the shell environment or local `.env`; never commit them to the application.

## GBrain

- `GBRAIN_USE_MOCK=1`: force local JSON fallback.
- `GBRAIN_CONTEXT_FILE`: local context JSON path.
- `GBRAIN_MCP_HTTP_URL`: optional JSON-RPC HTTP bridge.
- `GBRAIN_MCP_BRIDGE_PATH`: optional stdio bridge path. The application defaults to `scripts/local-gbrain-mcp.py`, which reads the synced local checkout without transmitting credentials.
- `GBRAIN_LOCAL_REPO`: clean, sparse local `arvya-gbrain` cache used by `scripts/local-gbrain-mcp.py` (default `<project>/.gbrain-cache`). Do not point autonomous runs at a developer worktree that may contain uncommitted files.
- `GBRAIN_LOCAL_MAX_STALENESS_HOURS`: maximum allowed age of the checkout's latest commit before local retrieval fails closed (default `48`).
- `GBRAIN_MCP_TIMEOUT_MS`: bridge timeout.
- `GBRAIN_MCP_*_METHOD`: method name overrides for actual MCP tool names.

## Generation

- `SOCIAL_AGENT_CREATIVE_MODE=1`: enable creative runtime variation.
- `SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST=1`: avoid sharing one image across LinkedIn/X posts.
- `SOCIAL_AGENT_IMAGE_MODE=canva|gpt-canva|placeholder`: compatibility renderer mode.
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: optional compatibility keys only.
- `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_FORMAT`: optional GPT image compatibility settings.

Final publishing artwork follows the fixed 1200x675 (16:9) dark-blue wave contract regardless of compatibility background-provider dimensions. Existing rendered 1080x1350 posts retain their recorded QA metadata and remain readable as legacy assets; new attachments and replacements use 16:9.

## Output And Test Mode

- `SOCIAL_AGENT_OUTPUT_DIR`: override output location.
- `SOCIAL_AGENT_TEST_MODE=1`: use `output/test`, disable DB/external publishing, and allow mock publisher.
- `scheduled_for` on a post: optional exact Buffer schedule time, set via imported drafts or `schedule --time <ISO>`.

## Brand

- `BRAND_NAME`, `BRAND_AUDIENCE`, `BRAND_TONE`: optional brand profile overrides.
- `ARVYA_REFERENCE_ASSET_DIR`: optional local visual reference exports for Canva briefs.

The application includes Arvya brand assets under `assets/brand-kit` and a renderer copy under `scripts/runtime/brand-kit`.

## LinkedIn Mentions

- `LINKEDIN_MENTION_REGISTRY_PATH`: optional path to a JSON array (or `{ "entities": [] }`) of verified people and organizations. Without this setting, the publisher reads `output/linkedin-mentions.json` when present.
- Arvya is built in with the verified organization URN `urn:li:organization:114174190`; it does not need to be repeated in the registry.
- Each extra entity requires `aliases`, `id`, `link`, `entity`, `vanityName`, `localizedName`, and `kind` (`person` or `organization`). Publishing fails closed when a configured registry is malformed.
