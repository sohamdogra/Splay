import { readFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir, isTestMode } from "../config/runtimeMode.ts";
import type { GeneratedPost, PublishResult, VisualQaReport } from "../types/index.ts";
import { hostImageIfLocal, isImageHostConfigured } from "../storage/imageHost.ts";
import { appendPublishLog } from "../storage/publishLog.ts";
import type { Publisher } from "./Publisher.ts";

// Shared publish path for CLI entry points.
//
// A post whose image_url is a local file must be uploaded to a public URL before
// Buffer will accept it. Current packs point at QA-passed PNGs; legacy SVG packs are
// still rasterized by imageHost before upload.
//
// It FAILS CLOSED: a post that is supposed to carry an image is never silently published
// as text-only. If hosting is unconfigured or the upload fails, the post is marked failed
// so it can be retried, rather than going out without its image.

function hasLocalImage(post: GeneratedPost): boolean {
  return Boolean(post.image_url) && !/^https?:\/\//i.test(post.image_url);
}

function isLocalPng(post: GeneratedPost): boolean {
  return hasLocalImage(post) && path.extname(post.image_url).toLowerCase() === ".png";
}

// Fail-closed results never reach BufferPublisher, so log them here too — otherwise
// output/publish-log.jsonl would silently omit posts that were blocked before Buffer.
function failClosed(post: GeneratedPost, message: string): Promise<PublishResult> {
  return appendPublishLog({
    post_id: post.id,
    ok: false,
    publisher: "image-host",
    message,
    published_at: new Date().toISOString()
  });
}

export async function publishWithHosting(publisher: Publisher, post: GeneratedPost): Promise<PublishResult> {
  if (isTestMode()) return publisher.publish(post);

  // No image (or already an external URL) — nothing to host, publish as-is.
  if (!hasLocalImage(post)) {
    return publisher.publish(post);
  }

  const qaProblem = await localVisualQaProblem(post);
  if (qaProblem) {
    return failClosed(post, qaProblem);
  }

  if (!isImageHostConfigured()) {
    return failClosed(post, "Image hosting is not configured (set R2_* env vars). Refusing to publish an image post as text-only.");
  }

  let hostedPost: GeneratedPost;
  try {
    const hosted = await hostImageIfLocal(post);
    hostedPost = hosted.post;
  } catch (error) {
    return failClosed(post, `Image hosting failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  if (hasLocalImage(hostedPost)) {
    return failClosed(post, "Image hosting did not produce an external URL.");
  }

  return publisher.publish(hostedPost);
}

async function localVisualQaProblem(post: GeneratedPost): Promise<string | null> {
  if (!isLocalPng(post)) return null;
  const qa = post.visual_qa ?? await readQaSidecar(post.id);
  if (!qa?.ok) {
    return "Visual QA has not passed for the local PNG. Refusing to publish an unverified image.";
  }
  if (path.basename(qa.png_path) !== path.basename(post.image_url)) {
    return "Visual QA report does not match the local PNG selected for publishing.";
  }
  return null;
}

async function readQaSidecar(postId: string): Promise<VisualQaReport | null> {
  try {
    const raw = await readFile(path.join(getOutputDir(), "visual-qa.json"), "utf8");
    const reports = JSON.parse(raw) as VisualQaReport[];
    return reports.find((report) => report.post_id === postId) ?? null;
  } catch {
    return null;
  }
}
