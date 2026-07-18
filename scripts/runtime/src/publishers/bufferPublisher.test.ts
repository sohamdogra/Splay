import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { GeneratedPost, LinkedInMentionEntity } from "../types/index.ts";
import { BufferPublisher } from "./bufferPublisher.ts";

const SPLAY_LINKEDIN_ENTITY: LinkedInMentionEntity = {
  aliases: ["Splay"],
  id: "splay-test-org",
  link: "https://www.linkedin.com/company/splay-test",
  entity: "urn:li:organization:splay-test-org",
  vanityName: "splay-test",
  localizedName: "Splay",
  kind: "organization"
};

const ENV_KEYS = [
  "BUFFER_API_KEY",
  "BUFFER_LINKEDIN_PROFILE_IDS",
  "BUFFER_X_PROFILE_IDS",
  "BUFFER_PROFILE_IDS",
  "BUFFER_PUBLISH_MODE",
  "BUFFER_API_URL",
  "SOCIAL_AGENT_OUTPUT_DIR",
  "SOCIAL_AGENT_TEST_MODE"
];

let originalCwd: string;
let originalFetch: typeof globalThis.fetch;

before(async () => {
  originalCwd = process.cwd();
  originalFetch = globalThis.fetch;
  const dir = await mkdtemp(path.join(tmpdir(), "buffer-publisher-test-"));
  process.chdir(dir);
});

after(() => {
  process.chdir(originalCwd);
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.BUFFER_API_KEY = "test-key";
  process.env.BUFFER_LINKEDIN_PROFILE_IDS = "linkedin-channel";
  process.env.BUFFER_API_URL = "https://buffer.test/graphql";
  globalThis.fetch = originalFetch;
});

test("queues posts with addToQueue when no scheduled_for is set", async () => {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = fakeBufferFetch(calls);

  const result = await new BufferPublisher().publish(makePost({ scheduled_for: null }));
  const input = extractInput(calls);

  assert.equal(result.ok, true);
  assert.equal(result.target_status, "staged");
  assert.equal(input.mode, "addToQueue");
  assert.equal("dueAt" in input, false);
});

test("uses customScheduled and dueAt when scheduled_for is set", async () => {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = fakeBufferFetch(calls);
  const scheduledFor = new Date(Date.now() + 36e5).toISOString();

  const result = await new BufferPublisher().publish(makePost({ scheduled_for: scheduledFor }));
  const input = extractInput(calls);

  assert.equal(result.ok, true);
  assert.equal(result.target_status, "staged");
  assert.equal(input.mode, "customScheduled");
  assert.equal(input.dueAt, scheduledFor);
  assert.match(result.message, /scheduled/i);
});

test("adds verified LinkedIn annotations for every Splay mention", async () => {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = fakeBufferFetch(calls);

  const result = await new BufferPublisher().publish(makePost({
    post_text: "Splay reads the thread. Splay suggests the update.",
    hashtags: ["DealWorkflow"],
    linkedin_mentions: [SPLAY_LINKEDIN_ENTITY]
  }));
  const input = extractInput(calls);
  const metadata = input.metadata as { linkedin: { annotations: Array<Record<string, unknown>> } };

  assert.equal(result.ok, true);
  assert.equal(input.text, "Splay reads the thread. Splay suggests the update.\n\n#DealWorkflow");
  assert.equal(metadata.linkedin.annotations.length, 2);
  assert.deepEqual(metadata.linkedin.annotations.map((annotation) => ({
    entity: annotation.entity,
    start: annotation.start,
    length: annotation.length
  })), [
    { entity: SPLAY_LINKEDIN_ENTITY.entity, start: 0, length: 5 },
    { entity: SPLAY_LINKEDIN_ENTITY.entity, start: 24, length: 5 }
  ]);
});

test("rejects invalid scheduled_for before calling Buffer", async () => {
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = fakeBufferFetch(calls);

  const result = await new BufferPublisher().publish(makePost({ scheduled_for: "not-a-date" }));

  assert.equal(result.ok, false);
  assert.match(result.message, /scheduled_for/i);
  assert.equal(calls.length, 0);
});

test("replaces a scheduled image with editPost while preserving id, text, and dueAt", async () => {
  const calls: Record<string, unknown>[] = [];
  const scheduledFor = new Date(Date.now() + 36e5).toISOString();
  const post = makePost({
    status: "staged",
    scheduled_for: scheduledFor,
    image_url: "https://media.example.com/replacement.png",
    alt_text: "Replacement image",
    hashtags: ["DealWorkflow"]
  });
  globalThis.fetch = fakeBufferReplacementFetch(calls, post, scheduledFor);

  const result = await new BufferPublisher().replaceScheduledImage(post, "buffer-post-1");
  const editCall = calls[1];
  const input = (editCall.variables as Record<string, unknown>).input as Record<string, unknown>;

  assert.equal(result.ok, true);
  assert.equal(result.target_status, "staged");
  assert.deepEqual(result.buffer_post_ids, ["buffer-post-1"]);
  assert.equal(calls.length, 2);
  assert.match(String(calls[0].query), /BufferPostPreflight/);
  assert.match(String(editCall.query), /editPost/);
  assert.doesNotMatch(calls.map((call) => String(call.query)).join("\n"), /createPost|deletePost/);
  assert.equal(input.id, "buffer-post-1");
  assert.equal(input.mode, "customScheduled");
  assert.equal(input.dueAt, scheduledFor);
  assert.equal(input.text, "A short LinkedIn post.\n\n#DealWorkflow");
  const assets = input.assets as Array<{ image: { url: string; metadata: { dimensions: { width: number; height: number } } } }>;
  assert.equal(assets[0].image.url, post.image_url);
  assert.deepEqual(assets[0].image.metadata.dimensions, { width: 1200, height: 675 });
});

test("refuses replacement when the Buffer post is no longer scheduled", async () => {
  const calls: Record<string, unknown>[] = [];
  const scheduledFor = new Date(Date.now() + 36e5).toISOString();
  const post = makePost({
    status: "staged",
    scheduled_for: scheduledFor,
    image_url: "https://media.example.com/replacement.png"
  });
  globalThis.fetch = fakeBufferReplacementFetch(calls, post, scheduledFor, "sent");

  const result = await new BufferPublisher().replaceScheduledImage(post, "buffer-post-1");

  assert.equal(result.ok, false);
  assert.match(result.message, /not scheduled/i);
  assert.equal(calls.length, 1);
});

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: "post-1",
    source_context: { summary: "", gbrain_references: [], why_now: "" },
    platform: "linkedin",
    topic: "Topic",
    post_text: "A short LinkedIn post.",
    image_prompt: "",
    image_url: "",
    image_provider: "codex-imagegen",
    canva_design_url: null,
    alt_text: "",
    hashtags: [],
    status: "approved",
    created_at: new Date().toISOString(),
    scheduled_for: null,
    quality_score: { hook: 1, clarity: 1, brand_fit: 1, platform_fit: 1, overall: 1 },
    warnings: [],
    ...overrides
  };
}

function fakeBufferFetch(calls: Record<string, unknown>[]): typeof globalThis.fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    const input = extractInput(calls);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: {
            createPost: {
              __typename: "PostActionSuccess",
              post: {
                id: "buffer-post-1",
                status: "scheduled",
                dueAt: input.dueAt ?? "2026-07-09T16:00:00.000Z",
                externalLink: "https://buffer.test/post/buffer-post-1",
                channelId: input.channelId,
                channelService: "linkedin",
                shareMode: input.mode
              }
            }
          }
        };
      }
    } as Response;
  }) as typeof globalThis.fetch;
}

function fakeBufferReplacementFetch(
  calls: Record<string, unknown>[],
  post: GeneratedPost,
  dueAt: string,
  status = "scheduled"
): typeof globalThis.fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push(body);
    const query = String(body.query ?? "");
    const text = `${post.post_text}\n\n${post.hashtags.map((tag) => `#${tag}`).join(" ")}`.trim();
    if (query.includes("BufferPostPreflight")) {
      return response({
        data: {
          post: {
            id: "buffer-post-1",
            status,
            dueAt,
            text,
            assets: [{ source: "https://media.example.com/original.png", mimeType: "image/png" }]
          }
        }
      });
    }
    return response({
      data: {
        editPost: {
          __typename: "PostActionSuccess",
          post: {
            id: "buffer-post-1",
            status: "scheduled",
            dueAt,
            text,
            assets: [{ source: post.image_url, mimeType: "image/png" }]
          }
        }
      }
    });
  }) as typeof globalThis.fetch;
}

function response(body: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  } as Response;
}

function extractInput(calls: Record<string, unknown>[]): Record<string, unknown> {
  const latest = calls.at(-1);
  assert.ok(latest);
  const variables = latest.variables as Record<string, unknown>;
  return variables.input as Record<string, unknown>;
}
