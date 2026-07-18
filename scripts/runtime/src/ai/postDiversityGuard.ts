import { readFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import { isDatabaseConfigured, getPrisma } from "../db/prisma.ts";
import type { ContentFingerprint, Platform } from "../types/index.ts";
import { assessConceptualDiversity, buildContentFingerprint } from "../editorial/contentFingerprint.ts";
import { EDITORIAL_SPEC } from "../editorial/editorialSpec.ts";

export type RecentPostReference = {
  id: string;
  platform?: string | null;
  topic?: string | null;
  text: string;
  createdAt?: Date | string | null;
  sourceReferences?: string[];
  fingerprint?: ContentFingerprint;
  lifecycle?: string | null;
};

export type DiversityAssessment = {
  ok: boolean;
  exactDuplicate: boolean;
  maxSimilarity: number;
  matchedPostId: string | null;
  warnings: string[];
  lexicalSimilarity: number;
  conceptualSimilarity: number;
  repeatedDimensions: string[];
};

type DiversityContext = {
  promptContext: string;
  recentPosts: RecentPostReference[];
};

const exactDuplicateThreshold = 0.98;
const similarPostThreshold = EDITORIAL_SPEC.diversity.lexical_warning_threshold;
const maxRecentPosts = 50;

export async function buildPostDiversityContext(
  platform: Platform,
  topic: string,
  additionalPosts: RecentPostReference[] = []
): Promise<DiversityContext> {
  const recentPosts = dedupeById([...additionalPosts, ...(await loadRecentPostReferences(platform))])
    .filter((post) => samePlatformPost(post, platform))
    .filter((post) => post.text.trim().length > 0)
    .slice(0, maxRecentPosts);
  const samePlatform = recentPosts.slice(0, 12);
  if (samePlatform.length === 0) return { promptContext: "", recentPosts };

  const openings = unique(samePlatform.map((post) => firstNonEmptyLine(post.text)).filter(Boolean)).slice(0, 8);
  const repeatedTerms = repeatedMeaningfulTerms(samePlatform.map((post) => post.text)).slice(0, 10);
  const topicOverlap = samePlatform
    .filter((post) => post.topic && post.topic.toLowerCase() === topic.toLowerCase())
    .slice(0, 5);

  const lines = [
    "DIVERSITY GUARDRAILS",
    "Do not reuse the same opening structure, central analogy, CTA, or sequence of points from recent posts.",
    "Make this post feel meaningfully new in angle, framing, and sentence rhythm while staying on brand.",
    openings.length > 0 ? `Recent openings to avoid echoing: ${openings.map((line) => `"${truncate(line, 120)}"`).join("; ")}.` : "",
    repeatedTerms.length > 0 ? `Overused terms to use sparingly or replace with fresher specifics: ${repeatedTerms.join(", ")}.` : "",
    topicOverlap.length > 0 ? "This topic has recent coverage; use a distinct sub-angle, example, or narrative structure." : "",
    "Prefer one concrete workflow example, tension, or operator insight over broad AI/productivity claims."
  ];

  return {
    promptContext: lines.filter(Boolean).join("\n"),
    recentPosts
  };
}

export function assessPostDiversity(text: string, recentPosts: RecentPostReference[]): DiversityAssessment {
  const normalized = normalizePostText(text);
  let maxSimilarity = 0;
  let matchedPostId: string | null = null;
  let exactDuplicate = false;

  for (const post of recentPosts) {
    const similarity = postSimilarity(normalized, normalizePostText(post.text));
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      matchedPostId = post.id;
    }
    if (similarity >= exactDuplicateThreshold) exactDuplicate = true;
  }

  const warnings: string[] = [];
  if (exactDuplicate) {
    warnings.push(`Diversity warning: draft is an exact or near-exact duplicate of recent post ${matchedPostId}.`);
  } else if (maxSimilarity >= similarPostThreshold) {
    warnings.push(`Diversity warning: draft is highly similar to recent post ${matchedPostId} (${Math.round(maxSimilarity * 100)}% similarity).`);
  }

  const conceptual = assessConceptualDiversity(buildContentFingerprint({ text }), recentPosts);
  warnings.push(...conceptual.warnings);

  return {
    ok: warnings.length === 0,
    exactDuplicate,
    maxSimilarity: Math.max(maxSimilarity, conceptual.maxSimilarity),
    matchedPostId: conceptual.maxSimilarity > maxSimilarity ? conceptual.matchedPostId : matchedPostId,
    warnings: unique(warnings),
    lexicalSimilarity: maxSimilarity,
    conceptualSimilarity: conceptual.maxSimilarity,
    repeatedDimensions: conceptual.repeatedDimensions
  };
}

export function selectDiverseVariant(seed: string, candidates: string[], recentPosts: RecentPostReference[]): string {
  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      assessment: assessPostDiversity(candidate, recentPosts)
    }))
    .sort((left, right) => left.assessment.maxSimilarity - right.assessment.maxSimilarity
      || seededRank(seed, left.index) - seededRank(seed, right.index));
  return ranked[0]?.candidate ?? candidates[0] ?? "";
}

export async function loadRecentPostReferences(platform?: Platform): Promise<RecentPostReference[]> {
  const [databasePosts, filePosts] = await Promise.all([
    loadDatabasePosts(platform),
    loadFilePosts(platform)
  ]);
  return dedupeById([...databasePosts, ...filePosts])
    .filter((post) => post.text.trim().length > 0)
    .slice(0, maxRecentPosts);
}

async function loadDatabasePosts(platform?: Platform): Promise<RecentPostReference[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const prisma = await getPrisma();
    const socialPost = prisma.socialPost as any;
    const rows = await socialPost.findMany({
      ...(platform ? { where: { platform } } : {}),
      orderBy: { createdAt: "desc" },
      take: maxRecentPosts,
      select: {
        id: true,
        platform: true,
        topic: true,
        text: true,
        createdAt: true,
        status: true,
        generationInput: true
      }
    });
    return rows.map((row: Record<string, unknown>) => toRecentPostReference(row));
  } catch {
    return [];
  }
}

async function loadFilePosts(platform?: Platform): Promise<RecentPostReference[]> {
  const [packPosts, historyPosts] = await Promise.all([
    loadPostPackReferences(platform),
    loadPostHistoryReferences(platform)
  ]);
  return [...packPosts, ...historyPosts]
    .sort((left, right) => createdAtValue(right.createdAt) - createdAtValue(left.createdAt));
}

async function loadPostPackReferences(platform?: Platform): Promise<RecentPostReference[]> {
  try {
    const raw = await readFile(path.join(getOutputDir(), "post-pack.json"), "utf8");
    const pack = JSON.parse(raw) as { posts?: Array<Record<string, unknown>> };
    return (pack.posts ?? [])
      .map(toRecentPostReference)
      .filter((post) => platformMatches(post, platform))
      .reverse();
  } catch {
    return [];
  }
}

async function loadPostHistoryReferences(platform?: Platform): Promise<RecentPostReference[]> {
  try {
    const raw = await readFile(path.join(getOutputDir(), "post-history.jsonl"), "utf8");
    return raw.split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [toRecentPostReference(JSON.parse(line) as Record<string, unknown>)];
        } catch {
          return [];
        }
      })
      .filter((post) => platformMatches(post, platform));
  } catch {
    return [];
  }
}

function toRecentPostReference(post: Record<string, unknown>): RecentPostReference {
  const sourceContext = post.source_context && typeof post.source_context === "object"
    ? post.source_context as Record<string, unknown>
    : {};
  const sourceReferences = Array.isArray(post.sourceReferences)
    ? post.sourceReferences.map(String)
    : Array.isArray(sourceContext.gbrain_references)
      ? sourceContext.gbrain_references.map(String)
      : [];
  const generationInput = post.generationInput && typeof post.generationInput === "object"
    ? post.generationInput as Record<string, unknown>
    : {};
  const fingerprintValue = post.content_fingerprint ?? post.fingerprint ?? generationInput.contentFingerprint;
  return {
    id: String(post.id ?? ""),
    platform: typeof post.platform === "string" ? post.platform : null,
    topic: typeof post.topic === "string" ? post.topic : null,
    text: String(post.text ?? post.post_text ?? ""),
    createdAt: typeof post.createdAt === "string" || post.createdAt instanceof Date
      ? post.createdAt
      : typeof post.created_at === "string"
        ? post.created_at
        : null,
    sourceReferences,
    fingerprint: isFingerprint(fingerprintValue) ? fingerprintValue : undefined,
    lifecycle: typeof post.lifecycle === "string"
      ? post.lifecycle
      : typeof post.status === "string"
        ? post.status === "posted" || post.status === "staged" ? "published" : post.status
        : "generated"
  };
}

function isFingerprint(value: unknown): value is ContentFingerprint {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["audience_segment", "pain", "job_to_be_done", "system_or_artifact", "thesis", "proof_type", "product_capability", "hook_shape", "narrative_shape", "cta_shape"]
    .every((key) => typeof record[key] === "string");
}

function postSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  return Math.max(
    jaccard(tokens(left), tokens(right)),
    jaccard(ngrams(tokens(left), 3), ngrams(tokens(right), 3)),
    firstLineSimilarity(left, right),
    openingFrameSimilarity(left, right)
  );
}

function firstLineSimilarity(left: string, right: string): number {
  const leftLine = firstNonEmptyLine(left);
  const rightLine = firstNonEmptyLine(right);
  if (!leftLine || !rightLine) return 0;
  if (leftLine === rightLine) return 0.95;
  return jaccard(tokens(leftLine), tokens(rightLine)) * 0.85;
}

function normalizePostText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[a-z0-9_]+/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token));
}

function ngrams(items: string[], size: number): string[] {
  if (items.length < size) return items;
  const grams: string[] = [];
  for (let index = 0; index <= items.length - size; index += 1) {
    grams.push(items.slice(index, index + size).join(" "));
  }
  return grams;
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function openingFrameSimilarity(left: string, right: string): number {
  const leftFrame = openingFrame(firstNonEmptyLine(left));
  const rightFrame = openingFrame(firstNonEmptyLine(right));
  if (!leftFrame || !rightFrame) return 0;
  return leftFrame === rightFrame ? 0.82 : 0;
}

function openingFrame(line: string): string {
  if (/^a useful test for\b/.test(line)) return "useful-test";
  if (/^the question is not whether\b/.test(line)) return "question-not-whether";
  if (/^every firm has\b/.test(line)) return "every-firm";
  if (/^one source backed signal\b/.test(line)) return "source-signal";
  if (/^the practical question\b/.test(line)) return "practical-question";
  if (/^the sharper read\b/.test(line)) return "sharper-read";
  return tokens(line).slice(0, 4).join(" ");
}

function samePlatformPost(post: RecentPostReference, platform: Platform): boolean {
  return String(post.platform ?? "").toLowerCase() === platform;
}

function platformMatches(post: RecentPostReference, platform?: Platform): boolean {
  return !platform || samePlatformPost(post, platform);
}

function repeatedMeaningfulTerms(texts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of new Set(tokens(normalizePostText(text)))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((left, right) => right[1] - left[1])
    .map(([token]) => token);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeById(posts: RecentPostReference[]): RecentPostReference[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    if (!post.id || seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}

function createdAtValue(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function seededRank(seed: string, index: number): number {
  let hash = index + 17;
  for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}

const stopWords = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "you",
  "your",
  "are",
  "but",
  "not",
  "into",
  "because",
  "most",
  "they",
  "what",
  "when",
  "where",
  "another",
  "through",
  "around",
  "their",
  "there"
]);
