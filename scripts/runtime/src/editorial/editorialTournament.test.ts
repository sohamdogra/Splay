import assert from "node:assert/strict";
import test from "node:test";
import { runEditorialTournament } from "./editorialTournament.ts";

const sourceContext = {
  summary: "Buyer replies arrive in email while the Excel tracker waits for someone to copy the update.",
  gbrain_references: ["meetings/research/buyer-outreach"],
  why_now: "Fresh workflow evidence."
};
const editorialContext = {
  claim: sourceContext.summary,
  actor: "banker",
  concrete_object: "buyer tracker",
  observed_behavior: sourceContext.summary,
  audience_pain: "A banker has to reconstruct the buyer tracker before outreach moves.",
  evidence: [{ source_slug: sourceContext.gbrain_references[0], excerpt: sourceContext.summary, source_type: "customer" as const }],
  public_safe_claim: sourceContext.summary,
  sensitivity: "public" as const,
  confidence: "direct" as const
};

test("selects a supported, specific candidate and keeps the runner-ups", () => {
  const result = runEditorialTournament({
    platform: "x",
    topic: "Keep the buyer tracker current",
    sourceContext,
    editorialContext,
    postIntent: {
      audience_segment: "investment banking deal teams",
      content_pillar: "workflow_observation",
      objective: "education",
      desired_reader_response: "Recognize the manual update gap.",
      product_role: "supporting"
    },
    evidenceSupplied: true,
    candidates: [
      { angle: "operator_observation", text: "Workflows are changing. Arvya is an innovative platform.", hashtags: [] },
      { angle: "boundary_condition", text: "A buyer reply in email does not make the Excel tracker current. The useful test is whether the next banker can move without rebuilding the update.", hashtags: [] },
      { angle: "product_proof", text: "The buyer replied. The Excel tracker is still stale. Arvya proposes the tracker change for a banker to review before writeback.", hashtags: [] }
    ]
  });

  assert.equal(result.summaries.length, 3);
  assert.equal(result.summaries.filter((candidate) => candidate.selected).length, 1);
  assert.doesNotMatch(result.selected.text, /innovative platform/);
  assert.ok(result.fingerprint.pain.length > 0);
});
