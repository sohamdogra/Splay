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
