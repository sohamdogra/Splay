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

const { createApiServer } = await import("./server.ts");

await mkdir(path.join(outputDir, "images"), { recursive: true });
await writeFile(path.join(outputDir, "images", "post-1.png"), "png fixture");
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
  assert.equal((await health.json()).ok, true);

  const response = await fetch(`${baseUrl}/api/v1/posts?platform=linkedin&status=draft`, {
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].media_url, "/media/images/post-1.png");

  const media = await fetch(`${baseUrl}${body.data[0].media_url}`, {
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(media.status, 200);
  assert.equal(await media.text(), "png fixture");
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
