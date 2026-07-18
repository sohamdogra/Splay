import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/loadEnv.ts";
import { BufferPublisher } from "../publishers/bufferPublisher.ts";
import { hostImageIfLocal, isImageHostConfigured } from "../storage/imageHost.ts";
import { loadPostPack } from "../storage/postStore.ts";
import type { GeneratedPost } from "../types/index.ts";
import { FINAL_IMAGE_HEIGHT, FINAL_IMAGE_WIDTH } from "../visual/finalImageContract.ts";

type ReplacementEntry = {
  post_id?: string;
  id?: string;
  buffer_post_id?: string;
  buffer_id?: string;
};

loadEnv();

const mapPath = readArg("--map");
if (!mapPath) throw new Error("Usage: replace-scheduled-images --map <post-buffer-map.json>");
if (!isImageHostConfigured()) throw new Error("R2 image hosting must be configured before replacing scheduled Buffer images.");

const pack = await loadPostPack();
const entries = await readReplacementMap(mapPath);
const prepared = entries.map((entry) => {
  const postId = entry.post_id ?? entry.id;
  const bufferPostId = entry.buffer_post_id ?? entry.buffer_id;
  if (!postId || !bufferPostId) throw new Error("Every replacement map entry requires post_id and buffer_post_id.");
  const post = pack.posts.find((candidate) => candidate.id === postId);
  if (!post) throw new Error(`Replacement post not found in current pack: ${postId}`);
  assertReplacementReady(post);
  return { post, bufferPostId };
});

if (prepared.length === 0) throw new Error("Replacement map is empty.");
if (new Set(prepared.map((item) => item.post.id)).size !== prepared.length) throw new Error("Replacement map contains duplicate post IDs.");
if (new Set(prepared.map((item) => item.bufferPostId)).size !== prepared.length) throw new Error("Replacement map contains duplicate Buffer post IDs.");

const hosted = await Promise.all(prepared.map(async ({ post, bufferPostId }) => {
  const result = await hostImageIfLocal(post);
  if (!/^https?:\/\//i.test(result.post.image_url)) throw new Error(`R2 hosting did not produce a public image URL for ${post.id}.`);
  return { post: result.post, bufferPostId, hostedKey: result.hostedKey };
}));

const publisher = new BufferPublisher();
for (const item of hosted) {
  const result = await publisher.replaceScheduledImage(item.post, item.bufferPostId);
  if (!result.ok) throw new Error(result.message);
  console.log(`Replaced scheduled image: ${item.post.id} -> ${item.bufferPostId} (${item.post.scheduled_for})`);
}

function assertReplacementReady(post: GeneratedPost): void {
  if (post.status !== "staged") throw new Error(`Post ${post.id} must be staged before replacement.`);
  if (!post.scheduled_for || Number.isNaN(new Date(post.scheduled_for).getTime()) || new Date(post.scheduled_for).getTime() <= Date.now()) {
    throw new Error(`Post ${post.id} must have a future scheduled_for timestamp.`);
  }
  if (/^https?:\/\//i.test(post.image_url) || path.extname(post.image_url).toLowerCase() !== ".png") {
    throw new Error(`Post ${post.id} must point to a local replacement PNG.`);
  }
  const qa = post.visual_qa;
  if (!qa?.ok) throw new Error(`Post ${post.id} does not have passing visual QA.`);
  if (qa.dimensions.width !== FINAL_IMAGE_WIDTH || qa.dimensions.height !== FINAL_IMAGE_HEIGHT) {
    throw new Error(`Post ${post.id} replacement must be exactly ${FINAL_IMAGE_WIDTH}x${FINAL_IMAGE_HEIGHT}.`);
  }
  if (path.basename(qa.png_path) !== path.basename(post.image_url)) {
    throw new Error(`Post ${post.id} visual QA does not match its selected PNG.`);
  }
}

async function readReplacementMap(filePath: string): Promise<ReplacementEntry[]> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (Array.isArray(raw)) return raw as ReplacementEntry[];
  const record = raw as { replacements?: unknown } & Record<string, unknown>;
  if (Array.isArray(record.replacements)) return record.replacements as ReplacementEntry[];
  return Object.entries(record).map(([post_id, value]) => {
    return typeof value === "string" ? { post_id, buffer_post_id: value } : { post_id, ...(value as ReplacementEntry) };
  });
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
