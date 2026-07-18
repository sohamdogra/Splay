import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { GeneratedPost, PublishResult } from "../types/index.ts";
import type { Publisher } from "./Publisher.ts";
import { publishWithHosting } from "./publishWithHosting.ts";

const R2_KEYS = [
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL"
];

class FakePublisher implements Publisher {
  public readonly calls: GeneratedPost[] = [];

  async publish(post: GeneratedPost): Promise<PublishResult> {
    this.calls.push(post);
    return {
      post_id: post.id,
      ok: true,
      publisher: "fake",
      message: "ok",
      published_at: new Date().toISOString()
    };
  }
}

function makePost(imageUrl: string, id = "post-1"): GeneratedPost {
  return { id, image_url: imageUrl } as unknown as GeneratedPost;
}

let originalCwd: string;

// Run in a temp cwd so the audit-log writes (output/publish-log.jsonl) don't touch the repo.
before(async () => {
  originalCwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), "publish-hosting-test-"));
  process.chdir(dir);
});

after(() => {
  process.chdir(originalCwd);
});

// Ensure hosting reads as unconfigured unless a test opts in.
beforeEach(() => {
  for (const key of R2_KEYS) delete process.env[key];
});

test("publishes a text-only post as-is", async () => {
  const publisher = new FakePublisher();
  const result = await publishWithHosting(publisher, makePost(""));

  assert.equal(result.ok, true);
  assert.equal(publisher.calls.length, 1);
});

test("passes a post that already has an external image URL straight through", async () => {
  const publisher = new FakePublisher();
  const url = "https://example.com/image.png";
  const result = await publishWithHosting(publisher, makePost(url));

  assert.equal(result.ok, true);
  assert.equal(publisher.calls.length, 1);
  assert.equal(publisher.calls[0].image_url, url);
});

test("fails closed (and never publishes) when an image post has no hosting configured", async () => {
  const publisher = new FakePublisher();
  const result = await publishWithHosting(publisher, makePost("images/post-1.svg"));

  assert.equal(result.ok, false);
  assert.equal(result.publisher, "image-host");
  assert.match(result.message, /not configured/i);
  // The post must NOT have been published text-only.
  assert.equal(publisher.calls.length, 0);
});

test("fails closed when a local PNG has no passing visual QA report", async () => {
  const publisher = new FakePublisher();
  const result = await publishWithHosting(publisher, makePost("images/post-1.png"));

  assert.equal(result.ok, false);
  assert.equal(result.publisher, "image-host");
  assert.match(result.message, /visual qa/i);
  assert.equal(publisher.calls.length, 0);
});
