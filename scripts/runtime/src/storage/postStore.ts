import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { BrandProfile, GeneratedPost, PostPack, PublishResult, ReviewDecisionReason } from "../types/index.ts";
import { attachPublishResultToSocialPost, persistPostPack } from "./socialPostRepository.ts";

export async function loadPostPack(): Promise<PostPack> {
  try {
    const raw = await readFile(path.join(getOutputDir(), "post-pack.json"), "utf8");
    return JSON.parse(raw) as PostPack;
  } catch {
    return {
      generated_at: new Date().toISOString(),
      brand: defaultBrandProfile(),
      discovered_themes: [],
      posts: [],
      publish_logs: []
    };
  }
}

export async function savePostPack(pack: PostPack): Promise<void> {
  const outputDir = getOutputDir();
  await mkdir(path.join(outputDir, "drafts"), { recursive: true });
  await mkdir(path.join(outputDir, "images"), { recursive: true });
  await mkdir(path.join(outputDir, "canva-imports"), { recursive: true });
  await pruneGeneratedArtifacts(pack);
  await writeFile(path.join(outputDir, "post-pack.json"), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  await Promise.all(pack.posts.map((post) => {
    const filePath = path.join(outputDir, "drafts", `${post.id}.json`);
    return writeFile(filePath, `${JSON.stringify(post, null, 2)}\n`, "utf8");
  }));
  await appendPostHistory(outputDir, pack.posts);
  await persistPostPack(pack);
}

export async function approvePost(id: string, reason: ReviewDecisionReason = "approved_without_note", note?: string): Promise<PostPack> {
  return recordReviewDecision(id, "approve", reason, note);
}

export async function recordReviewDecision(
  id: string,
  decision: "approve" | "revise" | "reject",
  reason: ReviewDecisionReason,
  note?: string
): Promise<PostPack> {
  const pack = await loadPostPack();
  let found = false;
  pack.posts = pack.posts.map((post) => {
    if (post.id !== id) return post;
    found = true;
    if (decision === "approve" && post.editorial_evaluation && !post.editorial_evaluation.compliance.passed) {
      throw new Error(`Post ${id} cannot be approved because editorial compliance failed: ${post.editorial_evaluation.compliance.errors.join(" | ")}`);
    }
    if (decision === "approve" && post.editorial_evaluation?.editorial_review.verdict === "reject") {
      throw new Error(`Post ${id} cannot be approved while the editorial verdict is reject.`);
    }
    if (decision === "approve" && post.editorial_evaluation?.editorial_review.verdict === "revise" && (!note?.trim() || reason === "approved_without_note")) {
      throw new Error(`Post ${id} has an editorial revise verdict. Approval requires a specific positive reason and --note explaining the override.`);
    }
    return {
      ...post,
      status: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "draft",
      review_history: [
        ...(post.review_history ?? []),
        {
          decision,
          reason,
          ...(note?.trim() ? { note: note.trim() } : {}),
          decided_at: new Date().toISOString(),
          text_snapshot: post.post_text
        }
      ]
    };
  });
  if (!found) throw new Error(`Post not found: ${id}`);
  await savePostPack(pack);
  return pack;
}

export type SchedulePostFilter = {
  id?: string;
  platform?: GeneratedPost["platform"];
  all?: boolean;
};

export async function schedulePosts(filter: SchedulePostFilter, scheduledFor: string | null): Promise<{ pack: PostPack; updated: GeneratedPost[] }> {
  const pack = await loadPostPack();
  const normalized = scheduledFor ? normalizeExplicitScheduleTime(scheduledFor) : null;
  const updated: GeneratedPost[] = [];

  pack.posts = pack.posts.map((post) => {
    if (!matchesScheduleFilter(post, filter)) return post;
    const next = { ...post, scheduled_for: normalized };
    updated.push(next);
    return next;
  });

  if (updated.length === 0) throw new Error("No posts matched the schedule filter.");
  await savePostPack(pack);
  return { pack, updated };
}

export async function applyPublishResult(result: PublishResult): Promise<PostPack> {
  const pack = await loadPostPack();
  pack.publish_logs = [...pack.publish_logs, result];
  pack.posts = pack.posts.map((post) => {
    if (post.id !== result.post_id) return post;
    return { ...post, status: result.ok ? (result.target_status ?? "posted") : "failed" };
  });
  await savePostPack(pack);
  await attachPublishResultToSocialPost(result);
  return pack;
}

export function defaultBrandProfile(): BrandProfile {
  return {
    name: process.env.BRAND_NAME ?? "Splay",
    audience: process.env.BRAND_AUDIENCE ?? "the audience configured in the brand kit",
    tone: process.env.BRAND_TONE ?? "clear, specific, credible",
    positioning: "Use the positioning configured in the brand kit.",
    avoid: ["unsupported claims", "fake certainty", "generic hype"]
  };
}

function matchesScheduleFilter(post: GeneratedPost, filter: SchedulePostFilter): boolean {
  if (filter.id) return post.id === filter.id;
  if (filter.platform) return post.platform === filter.platform;
  return Boolean(filter.all);
}

function normalizeExplicitScheduleTime(value: string): string {
  const trimmed = value.trim();
  if (!hasExplicitTimezone(trimmed)) {
    throw new Error("Schedule time must include an explicit timezone, e.g. 2026-07-09T09:00:00-07:00 or 2026-07-09T16:00:00.000Z.");
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid schedule time: ${value}`);
  if (date.getTime() <= Date.now()) throw new Error(`Schedule time must be in the future: ${date.toISOString()}`);
  return date.toISOString();
}

function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}

async function pruneGeneratedArtifacts(pack: PostPack): Promise<void> {
  const outputDir = getOutputDir();
  const currentDrafts = new Set(pack.posts.map((post) => `${post.id}.json`));
  const currentImages = new Set(pack.posts.flatMap((post) => {
    const base = path.basename(post.image_url);
    return [
      base,
      `${post.id}.png`,
      `${post.id}.svg`,
      `${post.id}-background.svg`,
      `${post.id}-background.png`,
      `${post.id}-background-1.png`,
      `${post.id}-background-2.png`,
      `${post.id}-background-3.png`,
      `${post.id}-background-4.png`,
      `${post.id}-background-5.png`,
      `${post.id}-background.jpg`,
      `${post.id}-background-1.jpg`,
      `${post.id}-background-2.jpg`,
      `${post.id}-background-3.jpg`,
      `${post.id}-background-4.jpg`,
      `${post.id}-background-5.jpg`,
      `${post.id}-background.jpeg`,
      `${post.id}-background-1.jpeg`,
      `${post.id}-background-2.jpeg`,
      `${post.id}-background-3.jpeg`,
      `${post.id}-background-4.jpeg`,
      `${post.id}-background-5.jpeg`,
      `${post.id}-background.webp`,
      `${post.id}-background-1.webp`,
      `${post.id}-background-2.webp`,
      `${post.id}-background-3.webp`,
      `${post.id}-background-4.webp`,
      `${post.id}-background-5.webp`
    ].filter(Boolean);
  }));
  const currentCanvaImports = new Set(pack.posts.map((post) => `${post.id}.html`));

  await pruneDirectory(path.join(outputDir, "drafts"), currentDrafts, [".json"]);
  await pruneDirectory(path.join(outputDir, "images"), currentImages, [".svg", ".png", ".jpg", ".jpeg", ".webp"]);
  await pruneDirectory(path.join(outputDir, "canva-imports"), currentCanvaImports, [".html"]);
}

async function pruneDirectory(dir: string, keep: Set<string>, extensions: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const ext = path.extname(entry.name).toLowerCase();
    if (!extensions.includes(ext) || keep.has(entry.name)) return;
    await unlink(path.join(dir, entry.name));
  }));
}

async function appendPostHistory(outputDir: string, posts: GeneratedPost[]): Promise<void> {
  const historyPath = path.join(outputDir, "post-history.jsonl");
  const knownIds = await loadHistoryIds(historyPath);
  const additions = posts
    .filter((post) => post.id && !knownIds.has(post.id))
    .map((post) => JSON.stringify({
      id: post.id,
      platform: post.platform,
      topic: post.topic,
      text: post.post_text,
      createdAt: post.created_at,
      sourceReferences: post.source_context.gbrain_references,
      fingerprint: post.content_fingerprint,
      lifecycle: post.status === "posted" || post.status === "staged" ? "published" : post.status
    }));
  if (additions.length === 0) return;
  await appendFile(historyPath, `${additions.join("\n")}\n`, "utf8");
}

async function loadHistoryIds(historyPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(historyPath, "utf8");
    return new Set(raw.split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return typeof parsed.id === "string" ? [parsed.id] : [];
      } catch {
        return [];
      }
    }));
  } catch {
    return new Set();
  }
}
