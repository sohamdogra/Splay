import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { BrandProfile, TopicIdea } from "../types/index.ts";
import { generatePostsForIdea } from "./postGenerationAgent.ts";

test("local post generation avoids internal strategy jargon", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "arvya-post-generation-"));
  const previousOutputDir = process.env.SOCIAL_AGENT_OUTPUT_DIR;
  const previousTestMode = process.env.SOCIAL_AGENT_TEST_MODE;
  const previousMockMode = process.env.SOCIAL_AGENT_USE_MOCK_LLM;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousCreativeMode = process.env.SOCIAL_AGENT_CREATIVE_MODE;
  process.env.SOCIAL_AGENT_OUTPUT_DIR = outputDir;
  process.env.SOCIAL_AGENT_USE_MOCK_LLM = "1";
  process.env.SOCIAL_AGENT_CREATIVE_MODE = "1";
  delete process.env.SOCIAL_AGENT_TEST_MODE;
  delete process.env.DATABASE_URL;

  try {
    for (const idea of [makeDashboardIdea(), makeWorkflowToolIdea()]) {
      const posts = await generatePostsForIdea(idea, makeBrand());
      assert.equal(posts.length, 2);
      for (const post of posts) {
        assertNoRoboticCopy(post.post_text);
        assert.ok(post.image_copy);
        assert.ok(wordCount(post.image_copy.headline) >= 3 && wordCount(post.image_copy.headline) <= 8);
        assert.ok(wordCount(post.image_copy.support) >= 5 && wordCount(post.image_copy.support) <= 12);
        assert.ok((post.editorial_candidates?.length ?? 0) >= 3);
        assert.equal(post.editorial_candidates?.filter((candidate) => candidate.selected).length, 1);
        assert.ok(post.editorial_context?.evidence.length);
        assert.ok(post.content_fingerprint?.thesis);
        assert.ok(post.editorial_evaluation?.editorial_review.verdict);
      }
      const linkedin = posts.find((post) => post.platform === "linkedin");
      assert.ok(linkedin);
      assert.ok(linkedin.hashtags.length >= 3 && linkedin.hashtags.length <= 4);
      assert.match(linkedin.post_text, /\b(next owner|handoff|workflow|decision|team|update|work)\b/i);
    }
  } finally {
    restoreEnv("SOCIAL_AGENT_OUTPUT_DIR", previousOutputDir);
    restoreEnv("SOCIAL_AGENT_TEST_MODE", previousTestMode);
    restoreEnv("SOCIAL_AGENT_USE_MOCK_LLM", previousMockMode);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("SOCIAL_AGENT_CREATIVE_MODE", previousCreativeMode);
    await rm(outputDir, { recursive: true, force: true });
  }
});

function makeDashboardIdea(): TopicIdea {
  return {
    id: "idea-dashboard-accountability",
    topic: "Dashboards show work; they do not assign it",
    angle: "Draw a sharp line between visibility and ownership in deal operations.",
    score: 9,
    source_context: {
      summary: "Several competitor tools emphasize dashboards. Internal discussion noted that dashboards help visibility, but they do not by themselves create clear ownership or repeatable follow-through.",
      gbrain_references: ["market_notes/2026-06-23-dashboard-tools"],
      why_now: "Recent market notes show this theme is active."
    }
  };
}

function makeWorkflowToolIdea(): TopicIdea {
  return {
    id: "idea-workflow-tool-objection",
    topic: "The workflow-tool objection is really about adoption cost",
    angle: "Answer the objection that teams do not need another place to work.",
    score: 9,
    source_context: {
      summary: "Prospects worry that new systems create another destination. The strongest response has been to frame Arvya as a way to codify existing work into a lightweight operating system, not replace every tool.",
      gbrain_references: ["sales_notes/2026-06-18-objections"],
      why_now: "Recent sales notes show this theme is active."
    }
  };
}

function makeBrand(): BrandProfile {
  return {
    name: "Arvya",
    audience: "private equity, investment banking, deal teams, founders, operators",
    tone: "sharp, credible, founder-led, direct, thoughtful",
    positioning: "Arvya turns undocumented deal workflows into repeatable operating systems.",
    avoid: ["generic AI hype", "revolutionize", "game changer", "fake certainty", "too many emojis", "overexplaining"]
  };
}

function assertNoRoboticCopy(value: string): void {
  assert.doesNotMatch(value, /source-backed|source context|visible artifact|operating reality|evidence note|useful wedge|source trail|another destination|codify existing work|adoption cost/i);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
