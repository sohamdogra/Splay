import { loadEnv } from "../config/loadEnv.ts";
import {
  DEFAULT_ANIMATION_DURATION_SECONDS,
  MAX_ANIMATION_DURATION_SECONDS,
  MIN_ANIMATION_DURATION_SECONDS,
} from "../providers/tokenMartMedia.ts";
import { generateBackgroundAnimation } from "../agents/backgroundAnimationAgent.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { loadPostPack, savePostPack } from "../storage/postStore.ts";

loadEnv();

const postId = readArg("--post-id");
if (!postId) throw new Error("Usage: animate-background --post-id <post-id> [--background <path-or-url>] [--duration 10] [--resolution 720p]");
if (!process.env.TOKENMART_API_KEY?.trim()) throw new Error("TOKENMART_API_KEY must be configured before generating an animation.");

const duration = integerArg(
  "--duration",
  DEFAULT_ANIMATION_DURATION_SECONDS,
  MIN_ANIMATION_DURATION_SECONDS,
  MAX_ANIMATION_DURATION_SECONDS
);
const resolution = enumArg("--resolution", ["480p", "720p", "1080p"] as const, "720p");
const pack = await loadPostPack();
const post = pack.posts.find((candidate) => candidate.id === postId);
if (!post) throw new Error(`Post not found: ${postId}`);

const updatedPost = await generateBackgroundAnimation(post, {
  background: readArg("--background"),
  prompt: readArg("--prompt"),
  duration,
  resolution
});
const updatedPosts = pack.posts.map((candidate) => candidate.id === post.id ? updatedPost : candidate);
const updatedPack = { ...pack, posts: updatedPosts };
await savePostPack(updatedPack);
await renderPreview(updatedPack);
console.log(`Background animation saved: ${updatedPost.animation_background_url}`);

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
