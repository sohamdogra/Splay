import assert from "node:assert/strict";
import test from "node:test";
import { buildEditorialContext, normalizeEditorialContext, validateEditorialContext } from "./evidencePacket.ts";

test("builds a traceable evidence packet from concrete GBrain context", () => {
  const context = buildEditorialContext("Keep the buyer tracker current", [{
    id: "customer-note",
    title: "Buyer outreach",
    kind: "customer_insight",
    summary: "Buyer replies arrive in email while the Excel tracker waits for someone to copy the update.",
    date: "2026-07-09",
    references: ["meetings/research/buyer-outreach"],
    tags: ["buyer", "tracker"]
  }]);

  assert.equal(context.confidence, "direct");
  assert.equal(context.concrete_object, "buyer tracker");
  assert.equal(context.evidence[0].source_slug, "meetings/research/buyer-outreach");
  assert.match(context.audience_pain, /reconstruct/);
  assert.deepEqual(validateEditorialContext(context, {
    summary: context.claim,
    gbrain_references: ["meetings/research/buyer-outreach"],
    why_now: "Fresh customer evidence."
  }).errors, []);
});

test("rejects restricted and internal-only evidence", () => {
  const normalized = normalizeEditorialContext({
    claim: "A private deal fact",
    actor: "banker",
    concrete_object: "tracker",
    observed_behavior: "A private tracker changed.",
    audience_pain: "The tracker is stale.",
    public_safe_claim: "A private deal fact",
    sensitivity: "internal_only",
    confidence: "direct",
    evidence: [{ source_slug: "strategy/fundraising/private", excerpt: "Private evidence", source_type: "internal" }]
  }, {
    topic: "Private",
    sourceContext: { summary: "Private", gbrain_references: ["strategy/fundraising/private"], why_now: "" }
  });
  const result = validateEditorialContext(normalized.context, {
    summary: "Private",
    gbrain_references: ["strategy/fundraising/private"],
    why_now: ""
  });

  assert.ok(result.errors.some((error) => error.includes("internal_only")));
  assert.ok(result.errors.some((error) => error.includes("Restricted source")));
});
