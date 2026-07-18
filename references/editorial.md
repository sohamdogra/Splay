# Editorial Reference

Read this before drafting any post or image copy. The `import-drafts` command enforces the hard rules below (the "editorial gate"); everything else is judgment the drafting model must apply before import.

## The evidence-first editorial pipeline

Every post has one central idea grounded in one or more corroborating GBrain claims. Do not confuse one central idea with exactly one source. Use this order:

1. **Retrieve.** Call `mcp__gbrain.get_recent_salience` first. Pick ONE public-safe claim: a specific behavior, pain, decision, or thing that happened. A claim is concrete when you can name the object it touches (a thread, a tracker, a follow-up, a buyer list) and who feels it (the analyst, the VP, the partner).
2. **Corroborate.** Use `mcp__gbrain.query` only to support or enrich the claim you already selected - never for broad theme mining. Avoid fundraising and internal strategy pages (`strategy/fundraising/*` and similar) unless no better source exists; if you must use one, extract the underlying product fact, not the pitch language. Copy the exact page slugs verbatim into `source_context.gbrain_references`.
3. **Build the evidence packet.** Record the claim, actor, concrete object, observed behavior, audience pain, exact supporting excerpts, source types, public-safe claim, sensitivity, and confidence. Restricted and `internal_only` evidence fails closed.
4. **Set the intent.** Choose the audience segment, content pillar, objective, desired reader response, and whether Splay is absent, supporting, or central.
5. **Develop competing angles.** Create an operator observation, boundary condition, and product-proof lane. Rank the angle briefs, draft the strongest candidates, and compare them rather than polishing the first draft.
6. **Draft natively.** One clear idea per post. LinkedIn and X share evidence but do not summarize one another. LinkedIn targets 500-650 characters unless the topic genuinely needs more, plus 3-4 targeted hashtags; X stays within 280.
   For LinkedIn, `Splay` occurrences are converted at publish time only when the verified Splay organization identity is configured. If the copy names another person or company, include a verified `linkedin_mentions` entity record or remove the name; never invent a LinkedIn URN or rely on an ambiguous name search.
7. **Evaluate.** Keep compliance, editorial judgment, and platform fit separate. Compliance is pass/fail; the editorial verdict is publish/revise/reject with reasons. Never treat the legacy `quality_score` as editorial approval.
8. **Image copy.** From the same evidence, write `image_copy.headline` (3-8 words) and `image_copy.support` (5-12 words).
9. **Gate.** Import with `import-drafts`. If the gate rejects the draft, rewrite it. Do not bypass unsupported or sensitive evidence.

### Content program defaults

- Workflow observations: 30%.
- Product proof: 25%.
- Operator insight: 20%.
- Founder lessons: 15%.
- Market points of view: 10%.

These are mix targets, not per-week quotas. Do not repeat the same pain plus product capability within five published posts or the same thesis within ten.

### Human review feedback

Record decisions with `decide --id <id> --decision <approve|revise|reject> --reason <code> [--note <text>]`. Useful reasons include `strong_insight`, `strong_proof`, `good_voice`, `too_generic`, `too_promotional`, `repetitive`, `unsupported`, `wrong_audience`, `different_angle`, and `visual_not_useful`.

## The editorial gate (enforced at import)

Hard errors (import fails):

- Any banned phrase (below) in the topic, post text, or image copy.
- `Splay.io` anywhere. The name is `Splay`.
- LinkedIn hashtag count outside 3-4 unique, relevant tags.
- Missing `image_copy`; final artwork must use editorially gated headline and support lines.
- Image headline outside 3-8 words; image support line outside 5-12 words.

Warnings (import succeeds, shown in review):

- LinkedIn body outside the 500-650 character target.

`attach-final-images` is a legacy/manual escape hatch that requires `--allow-legacy-final-images`. It records failing visual QA unless the asset is an exact 1200x675 PNG and its traceability prompt specifies the dark-blue wave system. It also warns when the prompt drops the gated headline or contains a banned phrase.

## Banned phrases and what to write instead

These are internal positioning shorthand. They feel meaningful inside Splay and read as jargon outside it.

| Banned | Write instead (examples) |
| --- | --- |
| workflow memory | "the history that lives in one analyst's head", "the update was already in the thread" |
| process memory | "how the firm actually works", "the steps the last deal followed" |
| workflow fit | "works where the team already works", "no new tab to keep updated" |
| model IQ / model intelligence | "a smarter model" |
| operating reality / operating continuity | "how the team actually works", "a cleaner handoff" |
| source-backed | "with the email that said it" |
| source context | "the notes behind it", "the thread it came from" |
| source trail / evidence note / visible artifact | "the email trail", "the message that proves it" |
| another destination | "one more tab to update", "one more place to keep current" |
| codify existing work | "capture the work the team already does" |
| adoption cost | "duplicate work", "one more thing to remember" |
| useful wedge | (cut it - describe the actual first use) |
| deal-ops layer / operating layer | "reads the thread, updates the tracker, drafts the follow-up" |

The pattern behind every replacement: name the object, name the action, name the person. Outlook, thread, tracker, buyer list, follow-up, IC memo, Friday update. Rebuild, chase, paste, forward, remember, approve.

## Concreteness rules for post copy

- Open with something that happened or a pain the reader recognizes, not a thesis. "Every Monday someone rebuilds the tracker" beats "Workflow fit beats model IQ."
- One pain per post. If the hook needs two "and"s, cut one idea.
- The Splay angle is one specific behavior ("reads the thread and updates the tracker"), not a category claim ("a deal-ops layer").
- Abstractions are allowed only after the concrete version has landed, and only if explained in the same breath.
- No fabricated numbers, client names, deal names, or counterparties. Public-safe means an outsider could read the source summary without learning anything private.

## LinkedIn hashtag rules

- Supply 3-4 hashtags in the structured `hashtags` array; do not paste them into `post_text`.
- Mix one audience or industry tag, one workflow or use-case tag, and one topic tag. Examples include `PrivateEquity`, `InvestmentBanking`, `DealOps`, `DealTechnology`, `MergersAndAcquisitions`, and `ArtificialIntelligence` when they genuinely match the claim.
- Prefer specific discovery paths over generic reach. Do not add unrelated trending tags or repeat near-duplicates.
- X remains zero or one hashtag unless the extra tag materially improves discovery and the full post stays within 280 characters.

## LinkedIn mention rules

- The publisher annotates `Splay` only when a verified Splay LinkedIn organization identity is present in `LINKEDIN_BRAND_*`, the post, or the configured registry. The exact preview uses the configured LinkedIn display name.
- Other people and organizations are automatically mentioned only when their verified identity exists in `linkedin_mentions` on the post or in the configured mention registry. A record requires aliases, LinkedIn ID/URN, profile or company link, vanity name, localized name, and entity kind.
- Member mentions may match a verified first name, last name, or full name. Organization aliases are replaced with the exact localized organization name before annotation.
- Unresolved names stay plain text. In autonomous/no-review runs, remove an unresolved named entity or fail closed rather than guessing the wrong LinkedIn account.
- Mention offsets are calculated after hashtags and organization-name normalization, so the review preview must be refreshed before approval.

## Image copy rules

- Headline 3-8 words, support 5-12 words. Nothing else on the image beyond the brand mark and `Splay`.
- Both lines must survive the glance test: a reader scrolling at speed should get the point without reading the post.
- Good shapes: a command ("Stop rebuilding the tracker"), an observation ("The inbox already knows"), a cadence ("One thread. One tracker. One next step."), a rule ("Deal follow-ups should not live in memory").
- Never restate the post's first line verbatim; the image adds a complementary beat.
- Use exactly the gated `image_copy` lines when generating the final image. Do not improvise new text at image time.
- Use a 16:9 widescreen social-card canvas, targeting 1200x675. Reject portrait and square output.
- Generate background artwork only. Never ask an image model to render the Splay logo, wordmark, headline, or support copy.
- Stamp the bundled official Splay SVG and exact gated copy locally. On a 1080px-wide card, the fan mark must be at least 64px and the wordmark at least 30px.
- Use bold Instrument Sans for the standard campaign headline. Keep the support line 48-160px below the fitted headline block; reject large empty middle zones.
- Hold one campaign system across posts: near-black navy/charcoal over 75-85% of the canvas, luminous layered blue wave forms across the bottom quarter, white or mist typography, and cobalt blue limited to one restrained accent.
- Borrow the Splay Figma system's quiet component language: thin hairline rules, compact modular spacing, crisp rectangular UI silhouettes, and dark inset panels. Keep those cues subtle and secondary to the headline.
- Vary layout, scale, and wave geometry without changing the dominant color balance. Reject light gray, beige, washed-out charcoal, washed-out neutral, sparse, or low-energy candidates.

## Before / after

### LinkedIn post

Before (831 chars, rejected - abstract positioning, three stacked ideas, jargon hook):

> The hard part of AI adoption in deal work is not getting a model to say something useful.
>
> It is getting useful work back into the place the team already operates.
>
> [...] That is why workflow fit matters more than model IQ. [...] The product becomes valuable when the workflow itself becomes memory. That is the bar for Splay: not another destination, but a deal-ops layer that completes the coordination work where bankers already live.

After (615 chars, one pain, one angle, plain words):

> Every live deal has a tracker. And every Monday, someone rebuilds it.
>
> The update was already in the thread: the buyer replied Thursday, the follow-up went out Friday, the partner approved the revised terms. None of it counts until an analyst pastes it into Excel.
>
> That is the real adoption test for AI in deal work. Not whether the model writes a good summary - whether the update lands in the tracker without anyone leaving Outlook.
>
> That is what Splay is built to do: read the thread, update the tracker, draft the follow-up, and keep the history for the next person, inside the inbox the team already lives in.

### X post

Before (rejected - leads with internal slogan):

> Workflow fit beats model IQ.
>
> If an analyst has to leave Outlook, copy the answer, update Excel, and draft the follow-up manually, the AI tool just created another handoff.

After (238 chars):

> The buyer replied Thursday. The follow-up went out Friday. The tracker still says "awaiting response."
>
> Deal teams do not need a smarter model. They need the update to land in the tracker without leaving Outlook.
>
> That is what Splay does.

### Image copy

| | Headline | Support |
| --- | --- | --- |
| Before (rejected) | Workflow fit beats model IQ | Agents work when the workflow remembers |
| After | Stop rebuilding the tracker | The update was already in the thread |
| Also good | The inbox already knows | One thread. One tracker. One next step. |

## GBrain retrieval discipline

- Order of operations: `get_recent_salience` → select one claim → `query` to corroborate → `get_page` for the exact source if needed.
- Prefer recent product, usage, and customer-conversation pages over strategy documents. Fundraising applications describe positioning, not reader pain; use them last and translate hard.
- `source_context.gbrain_references` must contain the slugs exactly as GBrain returned them - no paraphrasing, no reconstruction from memory.
- `source_context.summary` must be public-safe on its own: no client names, counterparties, numbers, or anything an outsider should not learn.
- `source_context.why_now` states why this claim today, in one or two sentences.
