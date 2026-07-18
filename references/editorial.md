# Editorial Reference

This project starts without company knowledge. Brand details and source context must be supplied through the project-local Brand & brain setup before automatic generation.

## Evidence-first workflow

1. Select one company-brain record explicitly marked `public_safe: true`.
2. Build one central claim from the stored summary; do not add facts that are absent from the record.
3. Keep the record's source reference attached to the post for review.
4. Set the audience, objective, content pillar, desired response, and product role.
5. Compare an observation, a boundary or limitation, and a product-proof angle.
6. Draft LinkedIn and X independently from the same evidence.
7. Keep compliance, editorial judgment, and platform fit as separate decisions.
8. Generate background art without words or logos, then apply exact brand assets and approved copy deterministically.

Records not marked public-safe may be stored for future product work, but they are excluded from generation prompts. Do not ingest another company's private documents, exported memory, credentials, customer names, or confidential metrics.

## Editorial gate

Hard errors include:

- Unsupported claims, fabricated names, numbers, partnerships, or outcomes.
- Evidence marked confidential, private, NDA, or internal-only.
- Internal shorthand from `references/editorial-spec.json` in public copy.
- `Splay.io`; the configured name is `Splay` unless the brand kit is intentionally changed.
- LinkedIn hashtag counts outside 3–4 unique relevant tags.
- Missing image copy or image-copy text outside the configured word limits.

LinkedIn targets 500–650 characters when the subject supports it. X must remain within 280 characters. These platform limits do not justify adding facts or padding copy.

## Source and review rules

- A source reference may be a public URL or a project-local identifier.
- A summary must be understandable and safe on its own before it is marked public-safe.
- Strategy or positioning claims should be corroborated by a product, customer, founder, or market record when possible.
- Approval is a human action. Compliance failures and editorial rejects remain fail-closed.
- Verified LinkedIn identities are required before generating mention annotations; never guess an ID or URN.

## Image and brand rules

- Headline: 3–8 words.
- Support line: 5–12 words.
- Final static artwork: 1200×675.
- Generate background artwork only; never ask an image model to render the logo, wordmark, headline, CTA, pricing, or disclaimer.
- Apply official logo files, typography, exact copy, CTA, pricing, and disclaimers with the deterministic renderer, Canva, or Figma.
- Require passing visual QA before publishing.

## Review feedback

Record approve, revise, or reject decisions with a reason. Supported reasons include `strong_insight`, `strong_proof`, `good_voice`, `too_generic`, `too_promotional`, `repetitive`, `unsupported`, `wrong_audience`, `different_angle`, and `visual_not_useful`.

Use the evidence and brand configuration saved in this project. Never use knowledge from the original system that this repository was adapted from.
