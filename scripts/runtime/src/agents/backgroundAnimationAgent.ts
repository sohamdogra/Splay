import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import {
  DEFAULT_ANIMATION_DURATION_SECONDS,
  TokenMartMediaClient
} from "../providers/tokenMartMedia.ts";
import { hostImageIfLocal, isImageHostConfigured } from "../storage/imageHost.ts";
import type { CanvaImageRequest, GeneratedPost } from "../types/index.ts";

type AnimationClient = Pick<TokenMartMediaClient, "createAnimation" | "waitForAnimation" | "downloadVideo">;

export type AnimationOptions = {
  background?: string;
  prompt?: string;
  duration?: number;
  resolution?: "480p" | "720p" | "1080p";
  client?: AnimationClient;
};

export async function generateBackgroundAnimation(post: GeneratedPost, options: AnimationOptions = {}): Promise<GeneratedPost> {
  if (!process.env.TOKENMART_API_KEY?.trim()) throw new Error("TOKENMART_API_KEY must be configured before generating an animation.");
  const sourceBackground = options.background || await backgroundForPost(post.id);
  if (!sourceBackground) {
    throw new Error(`Post ${post.id} has no generated background plate. Generate a TokenMart background first or pass a background explicitly.`);
  }

  const publicBackgroundUrl = await publicImageUrl(post, sourceBackground);
  const prompt = animationPrompt(post, options.prompt);
  const client = options.client ?? new TokenMartMediaClient();
  const task = await client.createAnimation({
    prompt,
    imageUrl: publicBackgroundUrl,
    duration: options.duration ?? DEFAULT_ANIMATION_DURATION_SECONDS,
    resolution: options.resolution ?? "720p",
    ratio: "16:9"
  });
  console.log(`TokenMart animation task submitted for ${post.id}: ${task.id}`);
  const completed = await client.waitForAnimation(task);
  const video = await client.downloadVideo(completed.videoUrl);

  const relativeVideoPath = `videos/${post.id}-background.mp4`;
  await mkdir(path.join(getOutputDir(), "videos"), { recursive: true });
  await writeFile(path.join(getOutputDir(), relativeVideoPath), video);

  return {
    ...post,
    animation_background_url: relativeVideoPath,
    animation_provider: "tokenmart-seedance",
    animation_model: task.model,
    animation_task_id: task.id,
    animation_prompt: prompt,
    animation_notes: [
      "Background animation only; Seedance was not asked to render the Splay logo, typography, CTA, pricing, or disclaimers.",
      "Apply all exact brand and legal layers afterward with the deterministic HTML/canvas renderer, Canva, or Figma before publishing."
    ]
  };
}

export async function generateBackgroundAnimations(posts: GeneratedPost[], options: AnimationOptions = {}): Promise<GeneratedPost[]> {
  const animated: GeneratedPost[] = [];
  for (const post of posts) {
    console.log(`Generating video preview for ${post.platform} post ${post.id}...`);
    try {
      animated.push(await generateBackgroundAnimation(post, options));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown animation error";
      animated.push({
        ...post,
        warnings: [...post.warnings, "Video generation was unavailable; delivered the static post instead."],
        animation_notes: [...(post.animation_notes ?? []), `Static fallback used after video generation failed: ${reason}`]
      });
    }
  }
  return animated;
}

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
