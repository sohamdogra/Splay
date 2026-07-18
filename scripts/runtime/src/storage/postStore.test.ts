import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPostPack, recordReviewDecision, savePostPack } from "./postStore.ts";

test("records structured approve, revise, and reject feedback with a text snapshot", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-review-history-"));
  const previousOutput = process.env.SOCIAL_AGENT_OUTPUT_DIR;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.SOCIAL_AGENT_OUTPUT_DIR = outputDir;
  delete process.env.DATABASE_URL;

  try {
    await savePostPack({
      generated_at: "2026-07-10T00:00:00.000Z",
      brand: { name: "Splay", audience: "deal teams", tone: "direct", positioning: "", avoid: [] },
      discovered_themes: [],
      publish_logs: [],
      posts: [{
        id: "review-me",
        source_context: { summary: "A tracker is stale.", gbrain_references: [], why_now: "" },
        platform: "x",
        topic: "Tracker updates",
        post_text: "The tracker is stale.",
        image_prompt: "",
        image_url: "",
        image_provider: "placeholder",
        canva_design_url: null,
        alt_text: "",
        hashtags: [],
        status: "draft",
        created_at: "2026-07-10T00:00:00.000Z",
        scheduled_for: null,
        quality_score: { hook: 5, clarity: 5, brand_fit: 5, platform_fit: 5, overall: 5 },
        warnings: []
      }]
    });

    await recordReviewDecision("review-me", "revise", "too_generic", "Needs a source artifact.");
    let post = (await loadPostPack()).posts[0];
    assert.equal(post.status, "draft");
    assert.equal(post.review_history?.[0].reason, "too_generic");
    assert.equal(post.review_history?.[0].text_snapshot, "The tracker is stale.");

    await recordReviewDecision("review-me", "reject", "repetitive");
    post = (await loadPostPack()).posts[0];
    assert.equal(post.status, "rejected");
    assert.equal(post.review_history?.length, 2);
  } finally {
    if (previousOutput === undefined) delete process.env.SOCIAL_AGENT_OUTPUT_DIR;
    else process.env.SOCIAL_AGENT_OUTPUT_DIR = previousOutput;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("repairs hashtag-only compliance failures during approval", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-review-hashtags-"));
  const previousOutput = process.env.SOCIAL_AGENT_OUTPUT_DIR;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.SOCIAL_AGENT_OUTPUT_DIR = outputDir;
  delete process.env.DATABASE_URL;

  try {
    const basePost = {
      id: "repair-hashtags",
      source_context: { summary: "Customer outreach should stay timely and relevant.", gbrain_references: [], why_now: "" },
      platform: "linkedin" as const,
      topic: "Customer outreach",
      post_text: "Keep customer outreach timely and relevant for local business owners.",
      image_prompt: "",
      image_url: "",
      image_provider: "placeholder" as const,
      canva_design_url: null,
      alt_text: "",
      hashtags: ["Create", "Something", "Cool", "Direct"],
      status: "draft" as const,
      created_at: "2026-07-10T00:00:00.000Z",
      scheduled_for: null,
      quality_score: { hook: 5, clarity: 5, brand_fit: 5, platform_fit: 5, overall: 5 },
      warnings: [],
      editorial_evaluation: {
        compliance: { passed: false, errors: ["LinkedIn hashtag(s) are not supported by this post: #Direct."], warnings: [] },
        editorial_review: { source_fidelity: 7, insight_strength: 7, specificity: 7, novelty: 7, voice: 7, promotion_balance: 7, verdict: "reject" as const, rationale: [] },
        platform_review: { native_fit: 7, readability: 7, interaction_potential: 7, rationale: [] }
      }
    };
    await savePostPack({
      generated_at: "2026-07-10T00:00:00.000Z",
      brand: { name: "Splay", audience: "operators", tone: "direct", positioning: "", avoid: [] },
      discovered_themes: [],
      publish_logs: [],
      posts: [basePost]
    });

    await recordReviewDecision(basePost.id, "approve", "strong_insight");
    const repaired = (await loadPostPack()).posts[0];
    assert.equal(repaired.status, "approved");
    assert.equal(repaired.editorial_evaluation?.compliance.passed, true);
    assert.equal(repaired.editorial_evaluation?.editorial_review.verdict, "publish");
    assert.ok(repaired.hashtags.length >= 3);
    assert.doesNotMatch(repaired.hashtags.join(" "), /Direct/i);
  } finally {
    if (previousOutput === undefined) delete process.env.SOCIAL_AGENT_OUTPUT_DIR;
    else process.env.SOCIAL_AGENT_OUTPUT_DIR = previousOutput;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    await rm(outputDir, { recursive: true, force: true });
  }
});
