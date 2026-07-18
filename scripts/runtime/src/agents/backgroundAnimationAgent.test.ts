import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CreateAnimationInput } from "../providers/tokenMartMedia.ts";
import type { GeneratedPost } from "../types/index.ts";
import { generateBackgroundAnimation } from "./backgroundAnimationAgent.ts";

test("turns a generated image plate into a persisted video preview", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-generated-video-"));
  const previousOutput = process.env.SOCIAL_AGENT_OUTPUT_DIR;
  const previousKey = process.env.TOKENMART_API_KEY;
  let animationInput: CreateAnimationInput | undefined;
  process.env.SOCIAL_AGENT_OUTPUT_DIR = outputDir;
  process.env.TOKENMART_API_KEY = "test-key";

  try {
    const client = {
      async createAnimation(input: CreateAnimationInput) {
        animationInput = input;
        return { id: "video-task", model: "seedance-test", raw: {} };
      },
      async waitForAnimation(task: { id: string; model: string; raw: Record<string, unknown> }) {
        return { ...task, status: "succeeded", videoUrl: "https://media.test/video.mp4" };
      },
      async downloadVideo() {
        return new Uint8Array([0, 1, 2, 3]);
      }
    };
    const updated = await generateBackgroundAnimation(makePost(), {
      background: "https://media.test/first-frame.png",
      duration: 10,
      resolution: "720p",
      client
    });

    assert.equal(animationInput?.imageUrl, "https://media.test/first-frame.png");
    assert.equal(animationInput?.duration, 10);
    assert.equal(updated.animation_background_url, "videos/post-video-background.mp4");
    assert.equal(updated.animation_task_id, "video-task");
    assert.deepEqual(await readFile(path.join(outputDir, "videos", "post-video-background.mp4")), Buffer.from([0, 1, 2, 3]));
  } finally {
    restore("SOCIAL_AGENT_OUTPUT_DIR", previousOutput);
    restore("TOKENMART_API_KEY", previousKey);
    await rm(outputDir, { recursive: true, force: true });
  }
});

function makePost(): GeneratedPost {
  return {
    id: "post-video",
    source_context: { summary: "Retention signal", gbrain_references: [], why_now: "Now" },
    platform: "x",
    topic: "Retention signals",
    post_text: "Spot the signal early.",
    image_prompt: "",
    image_url: "images/post-video.png",
    image_provider: "tokenmart-canva",
    canva_design_url: null,
    alt_text: "Retention signal",
    hashtags: [],
    status: "draft",
    created_at: new Date().toISOString(),
    scheduled_for: null,
    quality_score: { hook: 1, clarity: 1, brand_fit: 1, platform_fit: 1, overall: 1 },
    warnings: []
  };
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
