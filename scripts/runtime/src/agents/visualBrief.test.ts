import assert from "node:assert/strict";
import test from "node:test";
import type { GeneratedPost, VisualBrief } from "../types/index.ts";
import { buildExtractiveBrief, validateVisualBriefCandidate } from "./visualBrief.ts";

test("rejects unsupported numbers, proper nouns, and missing source excerpts", () => {
  const post = makePost();
  assert.equal(validateVisualBriefCandidate({
    content_mode: "evidence",
    headline: post.topic,
    supporting_text: "Acme reduced review time by 47%.",
    points: [],
    steps: [],
    contrast: null,
    source_cue: "FROM THE WORK"
  }, post), null);

  assert.equal(validateVisualBriefCandidate({
    content_mode: "principles",
    headline: post.topic,
    supporting_text: post.source_context.summary,
    points: [
      { text: "Preserve owner context", source_excerpt: "not present in the source" },
      { text: "Keep risks visible", source_excerpt: "Open risks remain visible" },
      { text: "Carry decisions forward", source_excerpt: "Decisions survive handoffs" }
    ],
    steps: [],
    contrast: null,
    source_cue: "FROM THE WORK"
  }, post), null);
});

test("builds an extractive three-step brief when source context supports it", () => {
  const brief = buildExtractiveBrief(makePost());
  assert.equal(brief.content_mode, "workflow");
  assert.equal(brief.steps.length, 3);
  assert.notEqual(brief.headline, makePost().topic);
  assertCompactVisualCopy(brief);
  assert.ok(brief.steps.every((step) => makePost().source_context.summary.includes(step.source_excerpt)));
  assert.equal(brief.validation_status, "extractive_fallback");
});

test("rejects visual candidates with wordy image copy", () => {
  const post = makePost();
  assert.equal(validateVisualBriefCandidate({
    content_mode: "workflow",
    headline: "This image headline is far too long for a social visual template",
    supporting_text: "A compact support line should not become a paragraph on the image.",
    points: [],
    steps: [
      { text: "Owners capture the decision trail", source_excerpt: "Owners capture the decision trail" },
      { text: "Open risks remain visible", source_excerpt: "Open risks remain visible" },
      { text: "Decisions survive handoffs into execution", source_excerpt: "Decisions survive handoffs into execution" }
    ],
    contrast: null,
    source_cue: "FROM THE WORK"
  }, post), null);
});

test("accepts compact visual candidates", () => {
  const post = makePost();
  const brief = validateVisualBriefCandidate({
    content_mode: "workflow",
    headline: "Open risks visible",
    supporting_text: "Decision trail captured",
    points: [],
    steps: [
      { text: "Decision trail captured", source_excerpt: "Owners capture the decision trail" },
      { text: "Open risks visible", source_excerpt: "Open risks remain visible" },
      { text: "Context survives handoffs", source_excerpt: "Decisions survive handoffs into execution" }
    ],
    contrast: null,
    source_cue: "FROM THE WORK"
  }, post);

  assert.ok(brief);
  assert.equal(brief.validation_status, "validated");
  assertCompactVisualCopy(brief);
  assert.equal(brief.source_cue, "FROM THE WORK");
});

test("uses compact, source-grounded visual copy across company contexts", () => {
  const examples: Array<[string, string]> = [
    [
      "Dashboards show work; they do not assign it",
      "Dashboards help visibility, but they do not by themselves create clear ownership or repeatable follow-through."
    ],
    [
      "Automation needs documented process context",
      "The team found that useful automation begins by documenting how people actually make decisions."
    ],
    [
      "Reusable workflows need inspection before automation",
      "The product team shipped reusable workflow templates. Repeated work is now easier to inspect, improve, and assign."
    ],
    [
      "New software should reduce adoption cost",
      "Customers prefer systems that fit current routines without forcing every team into a separate workspace."
    ]
  ];

  for (const [topic, summary] of examples) {
    const brief = buildExtractiveBrief(makePost({ topic, summary }));
    assert.ok(brief.headline.length > 0);
    assert.ok(brief.supporting_text.length > 0);
    assertCompactVisualCopy(brief);
    assertNoRoboticVisualCopy(brief);
  }
});

function makePost(overrides: { topic?: string; summary?: string } = {}): GeneratedPost {
  return {
    id: "visual-brief-post",
    source_context: {
      summary: overrides.summary ?? "Owners capture the decision trail. Open risks remain visible. Decisions survive handoffs into execution.",
      gbrain_references: ["deal_notes/handoff"],
      why_now: "Current workflow work"
    },
    platform: "linkedin",
    topic: overrides.topic ?? "Deal context should survive every handoff",
    post_text: "Test",
    image_prompt: "",
    image_url: "",
    image_provider: "placeholder",
    canva_design_url: null,
    alt_text: "",
    hashtags: [],
    status: "draft",
    created_at: "2026-06-30T00:00:00.000Z",
    scheduled_for: null,
    quality_score: { hook: 8, clarity: 8, brand_fit: 8, platform_fit: 8, overall: 8 },
    warnings: []
  };
}

function assertCompactVisualCopy(brief: VisualBrief): void {
  assert.ok(wordCount(brief.headline) <= 7, brief.headline);
  assert.ok(wordCount(brief.supporting_text) <= 9, brief.supporting_text);
  assert.doesNotMatch(`${brief.headline} ${brief.supporting_text}`, /\u2026/);

  const items = [
    ...brief.points,
    ...brief.steps,
    ...(brief.contrast ? [brief.contrast.left, brief.contrast.right] : [])
  ];
  for (const item of items) {
    assert.ok(wordCount(item.text) <= 5, item.text);
    assert.doesNotMatch(item.text, /\u2026/);
  }
}

function assertNoRoboticVisualCopy(brief: VisualBrief): void {
  const text = [
    brief.headline,
    brief.supporting_text,
    brief.source_cue,
    ...brief.points.map((item) => item.text),
    ...brief.steps.map((item) => item.text),
    ...(brief.contrast ? [brief.contrast.left.text, brief.contrast.right.text] : [])
  ].join(" ");
  assert.doesNotMatch(text, /source-backed|source context|visible artifact|operating reality|evidence note|useful wedge|source trail|another destination|codify existing work|adoption cost/i);
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}
