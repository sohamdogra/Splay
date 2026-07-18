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

test("uses social-native visual copy for current Splay content patterns", () => {
  const examples: Array<[string, string, string]> = [
    [
      "Dashboards show work; they do not assign it",
      "Several competitor tools emphasize dashboards. Internal discussion noted that dashboards help visibility, but they do not by themselves create clear ownership or repeatable follow-through.",
      "Visibility is not ownership"
    ],
    [
      "Automation needs process memory before agents",
      "The memo argues that automation in deal environments fails when it begins with generic agents instead of process memory. The useful wedge is documenting how a specific firm actually makes decisions.",
      "Teach the agent your process"
    ],
    [
      "Reusable deal motions need inspection before automation",
      "The product team shipped a first pass at reusable workflow templates for recurring deal motions. The update is intended to make repeated work easier to inspect, improve, and assign.",
      "Make repeated work inspectable"
    ],
    [
      "The workflow-tool objection is really about adoption cost",
      "Prospects worry that new systems create another destination. The strongest response has been to frame Splay as a way to codify existing work into a lightweight operating system, not replace every tool.",
      "Don't make teams work twice"
    ]
  ];

  for (const [topic, summary, headline] of examples) {
    const brief = buildExtractiveBrief(makePost({ topic, summary }));
    assert.equal(brief.headline, headline);
    if (headline === "Don't make teams work twice") {
      assert.equal(brief.content_mode, "principles");
      assert.equal(brief.contrast, null);
    }
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
