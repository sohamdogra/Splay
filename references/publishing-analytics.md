# Publishing And Analytics Reference

## R2 Image Hosting

Buffer requires a public HTTPS image URL and rejects local files. The runtime uploads local PNG/SVG media to R2 before Buffer publishing when these are all set:

- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`

`R2_PUBLIC_BASE_URL` must be a permanent public bucket/custom-domain URL, not a presigned URL. The runtime fails closed if hosting is missing for image posts outside test mode.

## Buffer

Required for live Buffer queueing:

- `BUFFER_API_KEY`
- `BUFFER_LINKEDIN_PROFILE_IDS` and/or `BUFFER_X_PROFILE_IDS`
- `BUFFER_PROFILE_IDS` as fallback
- `BUFFER_PUBLISH_MODE=queue|now`, default `queue`
- `BUFFER_API_URL`, optional GraphQL endpoint override

Review mode queues only posts with `status: "approved"` after an application or CLI decision. A no-review publishing flow is intentionally not exposed by the application API.

Approval records a structured `review_history` event. Compliance failures and editorial `reject` verdicts cannot be approved. An editorial `revise` verdict requires a positive reason plus an explanatory review note.

## Metrics and learning

- Metric checkpoints use comparable 24-hour and 168-hour windows. Percentile scoring does not compare a 24-hour snapshot with a mature 7-day snapshot.
- Feedback groups include content pillar, audience pain, proof type, product role, narrative shape, visual treatment, and human decision in addition to platform metadata.
- A pattern requires at least eight examples before it is labeled high confidence. Smaller samples remain tentative.
- Recommendations are hypotheses for controlled tests, not universal rules. Hold the evidence packet constant and vary one of hook, product role, or visual treatment at a time.

To schedule approved posts at an exact Buffer time, set `scheduled_for` before queueing:

```bash
npm run schedule -- --time 2026-07-09T16:00:00.000Z --all
npm run queue-approved
```

The scheduler requires an explicit timezone (`Z` or `±HH:MM`). If `scheduled_for` is set, Buffer receives `mode: customScheduled` and `dueAt`. If it is not set, Buffer receives the existing `addToQueue` or `shareNow` mode.

### Replace media on an existing scheduled post

Use the in-place replacement command when a QA-passed local PNG must replace the media on an already scheduled Buffer post without creating a duplicate:

```json
{
  "local-post-id": "buffer-post-id"
}
```

```bash
npm run replace-scheduled-images -- --map /path/to/replacement-map.json
```

The command requires the local post to remain `staged`, retain a future `scheduled_for`, point to an exact 1200x675 PNG, and carry a matching passing visual-QA report. It uploads the PNG to R2, verifies Buffer still has the same scheduled text and due time, calls `editPost` with the replacement asset, verifies the returned post ID/status/time/media, and appends an audited `replace-scheduled-image` event to `publish-log.jsonl`.

## Database

Set `DATABASE_URL` and run the root Prisma commands when persistence is desired:

```bash
npm run db:generate
npm run db:migrate
```

Generated posts, publish results, metric snapshots, scores, and feedback lessons use the copied Prisma schema.

## Metrics And Feedback

Use:

```bash
npm run metrics:collect
npm run metrics:score
npm run feedback:generate
npm run feedback:print
```

The feedback loop reads historical Buffer metrics, calculates performance scores, stores lessons, and injects those lessons into future runtime prompt context when compatibility generation is used.
