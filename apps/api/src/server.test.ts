import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const outputDir = await mkdtemp(path.join(tmpdir(), "splay-api-"));
process.env.SOCIAL_AGENT_OUTPUT_DIR = outputDir;
process.env.SOCIAL_AGENT_TEST_MODE = "0";
process.env.DATABASE_URL = "";
process.env.SPLAY_API_TOKEN = "test-token";
process.env.TOKENMART_API_KEY = "";

const { createApiServer } = await import("./server.ts");

await mkdir(path.join(outputDir, "images"), { recursive: true });
await mkdir(path.join(outputDir, "videos"), { recursive: true });
await writeFile(path.join(outputDir, "images", "post-1.png"), "png fixture");
await writeFile(path.join(outputDir, "videos", "post-1-background.mp4"), "mp4 fixture");
await writeFile(path.join(outputDir, "post-pack.json"), `${JSON.stringify(fixturePack(), null, 2)}\n`);

let server: Server;
let baseUrl: string;

test.before(async () => {
  server = createApiServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP port.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(outputDir, { recursive: true, force: true });
});

test("exposes health, posts, and frontend media URLs", async () => {
  const health = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.generation.media.provider, "tokenmart");
  assert.equal(healthBody.generation.media.configured, false);
  assert.equal(healthBody.generation.media.image_model, "dola-seedream-5-0-pro-260628");
  assert.equal(healthBody.generation.media.video_model, "dreamina-seedance-2-0-260128");
  assert.equal(healthBody.storage.product_data, "filesystem");
  assert.equal(healthBody.storage.output_writable, true);
  assert.equal(healthBody.storage.active_jobs, "memory");

  const response = await fetch(`${baseUrl}/api/v1/posts?platform=linkedin&status=draft`, {
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].media_url, "/media/images/post-1.png");
  assert.equal(body.data[0].animation_media_url, "/media/videos/post-1-background.mp4");

  const media = await fetch(`${baseUrl}${body.data[0].media_url}`);
  assert.equal(media.status, 200);
  assert.equal(await media.text(), "png fixture");

  const animation = await fetch(`${baseUrl}${body.data[0].animation_media_url}`);
  assert.equal(animation.status, 200);
  assert.equal(animation.headers.get("content-type"), "video/mp4");
  assert.equal(await animation.text(), "mp4 fixture");
});

test("requires bearer auth for mutations", async () => {
  const response = await fetch(`${baseUrl}/api/v1/posts/post-1/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve", reason: "strong_insight" })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "unauthorized");
});

test("fails closed when TokenMart animation is not configured", async () => {
  const response = await fetch(`${baseUrl}/api/v1/jobs/animate-background`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ post_id: "post-1" })
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "tokenmart_not_configured");
});

test("restricts animation requests to 8-12 seconds", async () => {
  process.env.TOKENMART_API_KEY = "test-tokenmart-key";
  try {
    for (const duration of [7, 13]) {
      const response = await fetch(`${baseUrl}/api/v1/jobs/animate-background`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ post_id: "post-1", duration })
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error.message, /duration must be an integer between 8 and 12/);
    }
  } finally {
    process.env.TOKENMART_API_KEY = "";
  }
});

test("records review decisions and explicit schedules", async () => {
  const decision = await fetch(`${baseUrl}/api/v1/posts/post-1/decisions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ decision: "approve", reason: "strong_insight" })
  });
  assert.equal(decision.status, 200);
  assert.equal((await decision.json()).data.status, "approved");

  const scheduledFor = new Date(Date.now() + 86_400_000).toISOString();
  const schedule = await fetch(`${baseUrl}/api/v1/posts/post-1/schedule`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ scheduled_for: scheduledFor })
  });
  assert.equal(schedule.status, 200);
  assert.equal((await schedule.json()).data.scheduled_for, scheduledFor);
});

test("rejects untrusted browser origins", async () => {
  const response = await fetch(`${baseUrl}/api/v1/posts`, {
    headers: { origin: "https://untrusted.example" }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "origin_forbidden");
});

test("persists weekly campaigns with future Buffer schedule slots", async () => {
  const startAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const response = await fetch(`${baseUrl}/api/v1/campaigns`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name: "Six weeks of source-backed diligence",
      brief: "Show how source-cited deal context prevents repeated reconstruction work",
      themes: ["handoffs", "buyer trackers", "meeting prep"],
      platforms: ["linkedin"],
      start_at: startAt,
      timezone: "America/Los_Angeles",
      interval_weeks: 1,
      occurrences: 6,
      creative: false
    })
  });
  assert.equal(response.status, 201);
  const campaign = (await response.json()).data;
  assert.equal(campaign.slots.length, 6);
  assert.equal(campaign.slots[0].scheduled_for, startAt);
  assert.equal(new Date(campaign.slots[1].scheduled_for).getTime() - new Date(startAt).getTime(), 7 * 86_400_000);

  const list = await fetch(`${baseUrl}/api/v1/campaigns`, { headers: { authorization: "Bearer test-token" } });
  assert.equal((await list.json()).data[0].name, "Six weeks of source-backed diligence");
});

test("persists a versioned brand kit", async () => {
  const response = await fetch(`${baseUrl}/api/v1/brand-kit`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      name: "Splay",
      tagline: "Deal context that survives the close.",
      audience: "deal teams",
      tone: "direct, credible, source-backed",
      positioning: "Reviewable deal context.",
      avoid: ["generic AI hype"],
      colors: { primary: "#0f5eff", secondary: "#0a3db8", accent: "#dce7ff", background: "#fbfcfe", text: "#1f2937" },
      typography: { heading_family: "Brawler", body_family: "Instrument Sans", heading_weight: 400, body_weight: 400, scale: "editorial" },
      logo_url: null
    })
  });
  assert.equal(response.status, 200);
  const kit = (await response.json()).data;
  assert.equal(kit.version, 1);
  assert.equal(kit.colors.primary, "#0F5EFF");

  const saved = await fetch(`${baseUrl}/api/v1/brand-kit`, { headers: { authorization: "Bearer test-token" } });
  assert.equal((await saved.json()).data.typography.heading_family, "Brawler");
});

test("stores company context locally and excludes it from generation by default", async () => {
  const created = await fetch(`${baseUrl}/api/v1/brain/context`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      title: "Launch note",
      kind: "product",
      summary: "The company released a new review workflow for its customers.",
      tags: ["launch", "product"]
    })
  });
  assert.equal(created.status, 201);
  const item = (await created.json()).data;
  assert.equal(item.public_safe, false);

  const list = await fetch(`${baseUrl}/api/v1/brain/context`, { headers: { authorization: "Bearer test-token" } });
  const body = await list.json();
  assert.equal(body.meta.total, 1);
  assert.equal(body.meta.public_safe, 0);

  const removed = await fetch(`${baseUrl}/api/v1/brain/context/${item.id}`, {
    method: "DELETE",
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(removed.status, 204);
});

function authHeaders(): Record<string, string> {
  return {
    authorization: "Bearer test-token",
    "content-type": "application/json"
  };
}

function fixturePack(): Record<string, unknown> {
  return {
    generated_at: "2026-07-18T12:00:00.000Z",
    brand: {
      name: "Splay",
      audience: "deal teams",
      tone: "direct",
      positioning: "Reviewable next steps.",
      avoid: []
    },
    discovered_themes: ["buyer tracker"],
    publish_logs: [],
    posts: [{
      id: "post-1",
      source_context: {
        summary: "Public-safe observation.",
        gbrain_references: ["meetings/research/example.md"],
        why_now: "Recent operator evidence."
      },
      platform: "linkedin",
      topic: "Buyer tracker updates",
      post_text: "The buyer tracker should reflect the conversation, not require a second reconstruction pass.",
      image_prompt: "",
      image_url: path.join(outputDir, "images", "post-1.png"),
      image_provider: "placeholder",
      animation_background_url: "videos/post-1-background.mp4",
      animation_provider: "tokenmart-seedance",
      animation_model: "dreamina-seedance-2-0-260128",
      canva_design_url: null,
      alt_text: "Splay buyer tracker graphic.",
      hashtags: ["DealOps", "PrivateEquity", "InvestmentBanking"],
      status: "draft",
      created_at: "2026-07-18T12:00:00.000Z",
      scheduled_for: null,
      quality_score: { hook: 8, clarity: 8, brand_fit: 8, platform_fit: 8, overall: 8 },
      warnings: [],
      review_history: []
    }]
  };
}
