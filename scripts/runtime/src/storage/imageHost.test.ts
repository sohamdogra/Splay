import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { GeneratedPost } from "../types/index.ts";
import { hostImageIfLocal, isImageHostConfigured } from "./imageHost.ts";

const ENV_KEYS = ["CONVEX_URL", "CONVEX_INGEST_TOKEN"] as const;
const originalEnv = new Map<string, string | undefined>();
let imagePath: string;

before(async () => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
  const dir = await mkdtemp(path.join(tmpdir(), "convex-image-host-"));
  imagePath = path.join(dir, "post.png");
  await writeFile(imagePath, Buffer.from("png fixture"));
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

after(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("reports Convex hosting configured only when URL and ingest token are present", () => {
  assert.equal(isImageHostConfigured(), false);
  process.env.CONVEX_URL = "https://example.convex.cloud";
  assert.equal(isImageHostConfigured(), false);
  process.env.CONVEX_INGEST_TOKEN = "secret";
  assert.equal(isImageHostConfigured(), true);
});

test("uploads local media through a Convex upload URL and returns storage.getUrl", async () => {
  process.env.CONVEX_URL = "https://example.convex.cloud";
  process.env.CONVEX_INGEST_TOKEN = "secret";
  const mutationCalls: Array<Record<string, unknown>> = [];
  const client = {
    async mutation(_reference: unknown, args: Record<string, unknown>): Promise<unknown> {
      mutationCalls.push(args);
      return mutationCalls.length === 1
        ? "https://uploads.convex.cloud/upload"
        : { storageId: "storage-123", url: "https://example.convex.cloud/api/storage/storage-123" };
    }
  };
  let uploadedBody = "";
  let uploadedContentType = "";

  const result = await hostImageIfLocal(makePost(imagePath), {
    client,
    fetch: async (_input, init) => {
      uploadedBody = Buffer.from(init?.body as Buffer).toString("utf8");
      uploadedContentType = String((init?.headers as Record<string, string>)["content-type"]);
      return new Response(JSON.stringify({ storageId: "storage-123" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(uploadedBody, "png fixture");
  assert.equal(uploadedContentType, "image/png");
  assert.equal(mutationCalls.length, 2);
  assert.deepEqual(mutationCalls[0], { ingestToken: "secret" });
  assert.deepEqual(mutationCalls[1], {
    ingestToken: "secret",
    storageId: "storage-123",
    postId: "post-1",
    contentType: "image/png",
    sourceName: "post.png"
  });
  assert.equal(result.storageId, "storage-123");
  assert.equal(result.post.image_url, "https://example.convex.cloud/api/storage/storage-123");
});

test("rejects a finalized URL that Buffer cannot fetch over HTTPS", async () => {
  process.env.CONVEX_URL = "https://example.convex.cloud";
  process.env.CONVEX_INGEST_TOKEN = "secret";
  let call = 0;

  await assert.rejects(
    hostImageIfLocal(makePost(imagePath), {
      client: {
        async mutation(): Promise<unknown> {
          call += 1;
          return call === 1
            ? "https://uploads.convex.cloud/upload"
            : { storageId: "storage-123", url: "http://localhost/file.png" };
        }
      },
      fetch: async () => new Response(JSON.stringify({ storageId: "storage-123" }), { status: 200 })
    }),
    /public HTTPS media URL/
  );
});

function makePost(imageUrl: string): GeneratedPost {
  return { id: "post-1", image_url: imageUrl } as unknown as GeneratedPost;
}
