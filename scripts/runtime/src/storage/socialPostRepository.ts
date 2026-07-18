import { isDatabaseConfigured, getPrisma } from "../db/prisma.ts";
import type { GeneratedPost, PostPack, PublishResult } from "../types/index.ts";

type SocialPostDelegate = {
  upsert(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<unknown>;
};

let warnedAboutPersistence = false;

export async function persistPostPack(pack: PostPack): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await Promise.all(pack.posts.map((post) => upsertGeneratedPost(post)));
  } catch (error) {
    warnOnce(`Database post persistence skipped: ${errorMessage(error)}`);
  }
}

export async function attachPublishResultToSocialPost(result: PublishResult): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const prisma = await getPrisma();
    const socialPost = prisma.socialPost as SocialPostDelegate;
    const bufferPost = firstBufferPost(result);
    await socialPost.updateMany({
      where: { localPostId: result.post_id },
      data: {
        bufferPostId: bufferPost.id,
        channelId: bufferPost.channelId,
        status: result.ok ? normalizeStatus(result.target_status) : "failed",
        scheduledAt: bufferPost.dueAt ?? undefined,
        sentAt: result.ok ? new Date(result.published_at) : undefined
      }
    });
  } catch (error) {
    warnOnce(`Database publish persistence skipped: ${errorMessage(error)}`);
  }
}

async function upsertGeneratedPost(post: GeneratedPost): Promise<void> {
  const prisma = await getPrisma();
  const socialPost = prisma.socialPost as SocialPostDelegate;
  await socialPost.upsert({
    where: { localPostId: post.id },
    create: buildSocialPostData(post),
    update: buildSocialPostData(post)
  });
}

function buildSocialPostData(post: GeneratedPost): Record<string, unknown> {
  return {
    localPostId: post.id,
    platform: post.platform,
    status: normalizeStatus(post.status),
    text: post.post_text,
    mediaMetadata: {
      imageUrl: post.image_url || null,
      imageProvider: post.image_provider,
      canvaDesignUrl: post.canva_design_url,
      altText: post.alt_text,
      hasMedia: Boolean(post.image_url),
      visual: post.visual ?? null,
      visualQa: post.visual_qa ?? null
    },
    generationInput: {
      sourceContext: post.source_context,
      qualityScore: post.quality_score,
      warnings: post.warnings,
      hashtags: post.hashtags,
      editorialSpecVersion: post.editorial_spec_version ?? null,
      editorialContext: post.editorial_context ?? null,
      postIntent: post.post_intent ?? null,
      contentFingerprint: post.content_fingerprint ?? null,
      editorialEvaluation: post.editorial_evaluation ?? null,
      editorialCandidates: post.editorial_candidates ?? null,
      reviewHistory: post.review_history ?? [],
      visualTreatment: post.visual_treatment ?? null
    },
    generationModel: post.generation_model ?? null,
    promptVersion: post.prompt_version ?? null,
    topic: post.topic,
    hookType: post.hook_type ?? null,
    formatType: post.format_type ?? null,
    ctaType: post.cta_type ?? null,
    scheduledAt: parseDate(post.scheduled_for),
    createdAt: parseDate(post.created_at) ?? undefined
  };
}

function firstBufferPost(result: PublishResult): { id?: string; channelId?: string; dueAt?: Date } {
  const payload = asRecord(result.payload);
  const explicitIds = Array.isArray(result.buffer_post_ids) ? result.buffer_post_ids.filter(Boolean) : [];
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  for (const response of responses) {
    const post = asRecord(asRecord(asRecord(asRecord(response).body).data).createPost).post;
    const id = typeof post.id === "string" ? post.id : explicitIds[0];
    if (!id) continue;
    return {
      id,
      channelId: typeof post.channelId === "string" ? post.channelId : undefined,
      dueAt: parseDate(typeof post.dueAt === "string" ? post.dueAt : null) ?? undefined
    };
  }
  return { id: explicitIds[0] };
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "draft");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function warnOnce(message: string): void {
  if (warnedAboutPersistence) return;
  warnedAboutPersistence = true;
  console.warn(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
