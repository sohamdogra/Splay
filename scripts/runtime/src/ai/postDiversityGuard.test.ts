import assert from "node:assert/strict";
import test from "node:test";
import { assessPostDiversity, selectDiverseVariant } from "./postDiversityGuard.ts";

test("flags exact duplicate posts", () => {
  const assessment = assessPostDiversity("The same post text.", [
    { id: "recent-1", platform: "linkedin", text: "The same post text." }
  ]);

  assert.equal(assessment.ok, false);
  assert.equal(assessment.exactDuplicate, true);
  assert.equal(assessment.matchedPostId, "recent-1");
});

test("flags highly similar posts", () => {
  const assessment = assessPostDiversity(
    "Deal workflows fail when owner memory, risk context, and follow through never make it into a system.",
    [
      {
        id: "recent-1",
        platform: "x",
        text: "Deal workflows fail because owner memory, risk context, and follow-through do not make it into the system."
      }
    ]
  );

  assert.equal(assessment.ok, false);
  assert.equal(assessment.exactDuplicate, false);
});

test("selects the least similar local draft variant", () => {
  const selected = selectDiverseVariant("seed", [
    "The same opening about spreadsheets and workflow memory.",
    "A different post about diligence handoffs and decision trails."
  ], [
    { id: "recent-1", platform: "linkedin", text: "The same opening about spreadsheets and workflow memory." }
  ]);

  assert.equal(selected, "A different post about diligence handoffs and decision trails.");
});

test("flags repeated opening frames even when the nouns change", () => {
  const assessment = assessPostDiversity(
    "The practical question behind diligence handoffs: what breaks when the deal owner changes?",
    [
      {
        id: "recent-frame",
        platform: "linkedin",
        text: "The practical question behind workflow templates: what breaks when the team changes?"
      }
    ]
  );

  assert.equal(assessment.ok, false);
  assert.equal(assessment.matchedPostId, "recent-frame");
});
