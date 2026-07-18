import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/loadEnv.ts";
import { getOutputDir } from "../config/runtimeMode.ts";
import { TokenMartMediaClient } from "../providers/tokenMartMedia.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { hostImageIfLocal, isImageHostConfigured } from "../storage/imageHost.ts";
import { loadPostPack, savePostPack } from "../storage/postStore.ts";
import type { CanvaImageRequest, GeneratedPost } from "../types/index.ts";

loadEnv();

const postId = readArg("--post-id");
if (!postId) throw new Error("Usage: animate-background --post-id <post-id> [--background <path-or-url>] [--duration 5] [--resolution 720p]");
if (!process.env.TOKENMART_API_KEY?.trim()) throw new Error("TOKENMART_API_KEY must be configured before generating an animation.");

const duration = integerArg("--duration", 5, 2, 15);
const resolution = enumArg("--resolution", ["480p", "720p", "1080p"] as const, "720p");
const pack = await loadPostPack();
const post = pack.posts.find((candidate) => candidate.id === postId);
if (!post) throw new Error(`Post not found: ${postId}`);

const sourceBackground = readArg("--background") || await backgroundForPost(postId);
if (!sourceBackground) {
  throw new Error(`Post ${postId} has no generated background plate. Generate a TokenMart background first or pass --background explicitly.`);
}
const publicBackgroundUrl = await publicImageUrl(post, sourceBackground);
const prompt = animationPrompt(post, readArg("--prompt"));
const client = new TokenMartMediaClient();
const task = await client.createAnimation({
  prompt,
  imageUrl: publicBackgroundUrl,
  duration,
  resolution,
  ratio: "16:9"
});
console.log(`TokenMart animation task submitted: ${task.id}`);
const completed = await client.waitForAnimation(task);
const video = await client.downloadVideo(completed.videoUrl);

const outputDir = getOutputDir();
const relativeVideoPath = `videos/${post.id}-background.mp4`;
await mkdir(path.join(outputDir, "videos"), { recursive: true });
await writeFile(path.join(outputDir, relativeVideoPath), video);

const updatedPosts = pack.posts.map((candidate): GeneratedPost => candidate.id === post.id ? {
  ...candidate,
  animation_background_url: relativeVideoPath,
  animation_provider: "tokenmart-seedance",
  animation_model: task.model,
  animation_task_id: task.id,
  animation_prompt: prompt,
  animation_notes: [
    "Background animation only; Seedance was not asked to render the Splay logo, typography, CTA, pricing, or disclaimers.",
    "Apply all exact brand and legal layers afterward with the deterministic HTML/canvas renderer, Canva, or Figma before publishing."
  ]
} : candidate);
const updatedPack = { ...pack, posts: updatedPosts };
await savePostPack(updatedPack);
await renderPreview(updatedPack);
console.log(`Background animation saved: ${relativeVideoPath}`);

async function backgroundForPost(id: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(getOutputDir(), "canva-requests.json"), "utf8")) as CanvaImageRequest[];
    return raw.find((request) => request.post_id === id)?.background_image_path || null;
  } catch {
    return null;
  }
}

async function publicImageUrl(post: GeneratedPost, source: string): Promise<string> {
  if (/^https:\/\//i.test(source)) return source;
  if (/^http:\/\//i.test(source)) throw new Error("Animation background URL must use HTTPS.");
  if (!isImageHostConfigured()) {
    throw new Error("Convex storage must be configured to give TokenMart a public URL for the local background plate.");
  }
  const hosted = await hostImageIfLocal({ ...post, image_url: source });
  if (!/^https:\/\//i.test(hosted.post.image_url)) {
    throw new Error("Convex did not return a public HTTPS URL for the animation background.");
  }
  return hosted.post.image_url;
}

function animationPrompt(post: GeneratedPost, requested?: string): string {
  return [
    requested?.trim() || `Animate the abstract visual concept for: ${post.topic}.`,
    "Use the supplied image as the exact opening background plate and preserve its dark navy, blue wave, and restrained cobalt palette.",
    "Create slow, premium, subtle depth and layered wave motion with a fixed, stable camera and clean negative space.",
    "Background animation only: do not render words, letters, numbers, logos, brand marks, UI text, captions, CTA text, pricing, or disclaimers.",
    "Do not introduce people, products, dashboards, charts, neon effects, or unrelated objects.",
    "The exact logo, typography, CTA, pricing, and disclaimers will be composited afterward by a deterministic renderer."
  ].join(" ");
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function integerArg(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = readArg(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function enumArg<const T extends readonly string[]>(name: string, values: T, fallback: T[number]): T[number] {
  const value = readArg(name);
  if (value === undefined) return fallback;
  if (!(values as readonly string[]).includes(value)) throw new Error(`${name} must be one of: ${values.join(", ")}.`);
  return value as T[number];
}
