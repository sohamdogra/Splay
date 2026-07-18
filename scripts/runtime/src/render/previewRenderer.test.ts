import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { GeneratedPost, PostPack } from "../types/index.ts";
import { renderPreview } from "./previewRenderer.ts";

test("uses one responsive gutter for header, content, and cards", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "arvya-preview-layout-"));

  try {
    const previewPath = await renderPreview(makePack(), outputDir);
    const html = await readFile(previewPath, "utf8");

    assert.match(html, /--page-width: 1180px;/);
    assert.match(html, /--page-shell-width: calc\(var\(--page-width\) \+ 48px\);/);
    assert.match(html, /--page-gutter: 24px;/);
    assert.match(html, /padding: 24px var\(--page-gutter\) 30px;/);
    assert.match(html, /max-width: var\(--page-shell-width\);/);
    assert.doesNotMatch(html, /\.visual-card \.card-body/);
    assert.match(html, /:root \{ --page-gutter: 16px; \}/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("renders application review preview without embedded server actions", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "arvya-preview-chat-"));

  try {
    const previewPath = await renderPreview({ ...makePack(), posts: [makePost()] }, outputDir);
    const html = await readFile(previewPath, "utf8");

    assert.doesNotMatch(html, /127\.0\.0\.1/);
    assert.doesNotMatch(html, /\/api\/posts/);
    assert.doesNotMatch(html, /\/api\/publish-approved/);
    assert.doesNotMatch(html, /data-action=/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Application review/);
    assert.match(html, /decide --id draft-1 --decision approve --reason strong_insight/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

function makePack(): PostPack {
  return {
    generated_at: "2026-06-30T00:00:00.000Z",
    brand: {
      name: "Arvya",
      audience: "Deal teams",
      tone: "Direct",
      positioning: "Source-backed workflows",
      avoid: []
    },
    discovered_themes: [],
    posts: [],
    publish_logs: []
  };
}

function makePost(): GeneratedPost {
  return {
    id: "draft-1",
    source_context: {
      summary: "A buyer update changed in email before the tracker.",
      gbrain_references: ["sales/buyer-update-thread"],
      why_now: "Deal teams are still chasing manual buyer status updates."
    },
    platform: "linkedin",
    topic: "Stop chasing buyer updates",
    post_text: "The CRM says one thing. The inbox says another. Arvya keeps the buyer update tied to the work.",
    image_prompt: "Arvya social image prompt",
    image_url: "images/draft-1.png",
    image_provider: "codex-imagegen",
    canva_design_url: null,
    alt_text: "Arvya social post image.",
    hashtags: ["PrivateEquity"],
    status: "draft",
    created_at: "2026-06-30T00:00:00.000Z",
    scheduled_for: null,
    quality_score: {
      hook: 4,
      clarity: 4,
      brand_fit: 4,
      platform_fit: 4,
      overall: 4
    },
    warnings: [],
    image_copy: {
      headline: "Stop chasing buyer updates",
      support: "The inbox already has the next move"
    }
  };
}
