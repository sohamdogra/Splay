# Pipeline Reference

## Runtime Location

The application API lives in `apps/api` and the domain core lives in `scripts/runtime`. Use the HTTP API for frontend flows and root `npm` commands for operator maintenance.

## Provider Model

- `ContextProvider`: project-local `output/company-brain.json`. Only records explicitly marked `public_safe` are returned to generation.
- `TextProvider`: OpenAI or Anthropic when configured, then deterministic local templates.
- `ImageProvider`: TokenMart Seedream (`dola-seedream-5-0-pro-260628`) for optional concepts/background plates, followed by deterministic official-logo/text composition. Full model-generated final artwork is legacy/manual only.
- `AnimationProvider`: TokenMart Seedance (`dreamina-seedance-2-0-260128`) for asynchronous background-only animation. Raw animation is exposed for frontend review but is not selected by the Buffer publisher as final media.
- `PublishMode`: review by default. The application records an explicit approval before Buffer queueing.

Inspect provider readiness with:

```bash
curl http://127.0.0.1:4173/api/v1/health
```

## Draft Import Shape

Use this shape for `import-drafts --input`. Write the copy to the rules in `references/editorial.md` first; the import runs an editorial gate over it.

```bash
npm run import-drafts -- --input /path/to/drafts.json
```

```json
{
  "generated_at": "2026-07-08T12:00:00.000Z",
  "discovered_themes": ["customer onboarding lessons"],
  "posts": [
    {
      "platform": "linkedin",
      "topic": "What customers value during onboarding",
      "post_text": "LinkedIn copy...",
      "hashtags": ["CustomerExperience", "Onboarding", "ProductStrategy"],
      "linkedin_mentions": [
        {
          "aliases": ["Jane", "Jane Smith"],
          "id": "verified-linkedin-id",
          "link": "https://www.linkedin.com/in/jane-smith",
          "entity": "urn:li:person:verified-linkedin-id",
          "vanityName": "jane-smith",
          "localizedName": "Jane Smith",
          "kind": "person"
        }
      ],
      "image_copy": {
        "headline": "Start with customer clarity",
        "support": "One onboarding lesson changed the product"
      },
      "scheduled_for": "2026-07-09T16:00:00.000Z",
      "source_context": {
        "summary": "Public-safe source summary.",
        "gbrain_references": ["brain/project-local-record-id"],
        "why_now": "Why this is timely."
      },
      "editorial_context": {
        "claim": "The factual claim supported by the source.",
        "actor": "customer",
        "concrete_object": "onboarding workflow",
        "observed_behavior": "Customers ask for a clear first success milestone.",
        "audience_pain": "New customers cannot tell which first step matters most.",
        "evidence": [{
          "source_slug": "brain/project-local-record-id",
          "excerpt": "Exact public-safe supporting excerpt.",
          "source_type": "customer",
          "observed_at": "2026-07-09"
        }],
        "public_safe_claim": "Customers value a clear first success milestone.",
        "sensitivity": "public",
        "confidence": "direct"
      },
      "post_intent": {
        "audience_segment": "new and prospective customers",
        "content_pillar": "workflow_observation",
        "objective": "education",
        "desired_reader_response": "Recognize why early product clarity matters.",
        "product_role": "supporting"
      }
    },
    {
      "platform": "x",
      "topic": "What customers value during onboarding",
      "post_text": "X copy...",
      "hashtags": [],
      "image_copy": {
        "headline": "Clarity earns early trust",
        "support": "Show customers the first useful outcome"
      },
      "source_context": {
        "summary": "Public-safe source summary.",
        "gbrain_references": ["brain/project-local-record-id"],
        "why_now": "Why this is timely."
      }
    }
  ]
}
```

The importer preserves the original `PostPack` fields and adds optional `editorial_context`, `post_intent`, `content_fingerprint`, `editorial_evaluation`, `editorial_candidates`, `review_history`, and `visual_treatment` metadata. Legacy packs remain readable. Missing structured evidence is converted to an inferred packet and warned in review.

`source_context.gbrain_references` is a legacy field name retained for post-pack compatibility. New values come only from the project-local company brain and do not connect to an external GBrain service.

`scheduled_for` is optional. When present, it must be an ISO 8601 timestamp with an explicit timezone. The frontend should convert user language such as "tomorrow at 9am PT" into an explicit timestamp before import or scheduling.

### Editorial gate at import

`import-drafts` fails closed when the topic, post text, or `image_copy` contains internal jargon (banned list in `references/editorial.md`), uses `Splay.io`, breaks the image-copy word budgets (headline 3-8 words, support 5-12 words), or gives a LinkedIn post fewer than 3 or more than 4 unique hashtags. Fix the copy and re-import. `--skip-editorial-gate` converts the errors to warnings for a deliberate, explained exception only.

`image_copy` is carried onto each post; `attach-background-images` stamps those exact lines with the bundled official Splay logo.

`linkedin_mentions` is optional. Splay is resolved automatically only when the verified `LINKEDIN_BRAND_*` organization settings are configured. Other named people or organizations are annotated only from verified post-level records or the configured registry; unresolved names are never guessed. The review preview renders the exact LinkedIn publish text and reports the verified annotation count.

## Full Final Image Map (Legacy/Manual Only)

Use this shape only when the complete image was already composed with exact source logo/text assets. Do not use it for image-model-generated logos or typography:

```json
{
  "post-id-1": "/absolute/path/to/final-social-post.png",
  "post-id-2": {
    "path": "/absolute/path/to/final-social-post-2.png",
    "prompt": "Create a 1200x675 dark navy-blue Splay social card with layered flowing blue waves, one restrained cobalt accent, and the exact gated headline and support text."
  }
}
```

Run:

```bash
npm run attach-final-images -- --map /path/to/final-image-map.json --allow-legacy-final-images
```

This copies the final image into `output/images`, marks `image_provider` as `codex-imagegen`, bypasses Canva/compositor artifacts, and refreshes the static review preview.

Always include the full generation `prompt` in each entry, and render exactly the post's gated `image_copy` lines in the artwork. Final-image QA requires an exact 1200x675 (16:9) raster and a prompt that names the dark-blue wave direction; failed QA blocks live publishing. Attach also warns (in the console and in `image_notes`) when the prompt is missing the gated headline or contains a banned phrase.

## Generated Background Map Shape (Default)

Use this for normal runs. Generate background artwork with no words or brand marks, then attach it under the deterministic official-logo/text renderer.

Use either an object map:

```json
{
  "post-id-1": "/absolute/path/to/generated-background.png",
  "post-id-2": {
    "path": "/absolute/path/to/generated-background-2.png",
    "prompt": "Background-only prompt used for traceability."
  }
}
```

To provide ranked alternatives and let visual QA select the first passing plate, use a backward-compatible candidate list:

```json
{
  "post-id-1": {
    "candidates": [
      { "path": "/absolute/path/to/candidate-1.png", "prompt": "Background-only prompt." },
      { "path": "/absolute/path/to/candidate-2.png", "prompt": "Background-only prompt." }
    ]
  }
}
```

Each candidate renders in an isolated staging directory. No generated artifact or post-pack change is promoted until every mapped post has a passing candidate. Live runs fail closed when all supplied or provider-generated candidates fail; the deterministic background is reserved for offline/test generation or runs where no image provider was requested.

or an array:

```json
[
  {
    "post_id": "post-id-1",
    "background_image_path": "/absolute/path/to/generated-background.png",
    "alt_text": "Splay social graphic..."
  }
]
```

Run:

```bash
npm run attach-background-images -- --map /path/to/image-map.json
```

This updates `image_provider` to `codex-imagegen`, writes PNG/SVG/HTML compatibility artifacts, updates `canva-requests.json`, and refreshes the preview. All QA-passing candidates are ranked by blue bias, visual activity, contrast, variance, and copy-zone noise; the first passing plate is no longer automatically selected.

For a strictly read-only review, inspect the existing `post-pack.json` and `latest-preview.html` directly. The `review` command refreshes `latest-preview.html`, so do not run it when the user explicitly prohibits file changes.

## TokenMart background animation

After a post has a generated background plate, start a background-only Seedance task through the API:

```bash
curl -X POST http://127.0.0.1:4173/api/v1/jobs/animate-background \
  -H 'Content-Type: application/json' \
  -d '{"post_id":"post-id-1","duration":5,"resolution":"720p"}'
```

Or use the operator command:

```bash
npm run animate-background -- --post-id post-id-1 --duration 5 --resolution 720p
```

For a local plate, this workflow first uploads the image to Convex and passes its public HTTPS URL to TokenMart as the Seedance first frame. The completed raw background is saved as `videos/<post-id>-background.mp4`, recorded in the post as `animation_background_url`, and returned to a frontend as `animation_media_url`.

The Seedance prompt explicitly excludes words, logos, CTA text, pricing, and disclaimers. Apply those exact layers afterward with the deterministic HTML/canvas renderer, Canva, or Figma. Until that composition step exists for video, Buffer continues to use the visually validated static `image_url`; the raw animation cannot be published accidentally.

## Output Artifacts

The runtime continues to write:

- `post-pack.json`
- `drafts/*.json`
- `images/*.png`
- `images/*.svg`
- `videos/*-background.mp4` when Seedance animation is requested
- `canva-requests.json` only for compatibility compositor runs
- `canva-imports/*.html` only for compatibility compositor runs
- `visual-qa.json`
- `visual-history.jsonl`
- `publish-log.jsonl`

Use `visual:qa` before publishing if a post pack was edited manually.
