import { getPrisma } from "../db/prisma.ts";
import { EDITORIAL_SPEC } from "../editorial/editorialSpec.ts";

export type FeedbackPostInput = {
  id: string;
  platform?: string | null;
  topic?: string | null;
  hookType?: string | null;
  formatType?: string | null;
  ctaType?: string | null;
  hasMedia?: boolean | null;
  finalSuccessScore?: number | null;
  engagementRate?: number | null;
  commentRate?: number | null;
  shareRate?: number | null;
  contentPillar?: string | null;
  pain?: string | null;
  proofType?: string | null;
  productRole?: string | null;
  narrativeShape?: string | null;
  visualTreatment?: string | null;
  humanDecision?: string | null;
};

export type GeneratedLesson = {
  platform?: string | null;
  topic?: string | null;
  formatType?: string | null;
  promptVersion?: string | null;
  windowStart: Date;
  windowEnd: Date;
  lessonType: "winner" | "loser";
  summary: string;
  evidence: {
    group: Record<string, unknown>;
    sampleSize: number;
    medianScore: number;
    comparisonBaseline: number;
    postIds: string[];
    confidence: "high" | "low";
  };
};

type LessonField = "platform" | "topic" | "hookType" | "formatType" | "ctaType" | "hasMedia" | "contentPillar" | "pain" | "proofType" | "productRole" | "narrativeShape" | "visualTreatment" | "humanDecision";

const groupFields: LessonField[] = ["platform", "contentPillar", "pain", "proofType", "productRole", "narrativeShape", "visualTreatment", "humanDecision", "hookType", "formatType", "ctaType", "hasMedia", "topic"];

export function generateFeedbackLessonsFromPosts(
  posts: FeedbackPostInput[],
  options: { windowStart: Date; windowEnd: Date; includeLowConfidence?: boolean }
): GeneratedLesson[] {
  const scored = posts.filter((post) => typeof post.finalSuccessScore === "number");
  const baseline = median(scored.map((post) => post.finalSuccessScore));
  if (baseline === null) return [];

  const lessons: GeneratedLesson[] = [];
  for (const field of groupFields) {
    for (const [value, group] of groupBy(scored, (post) => groupValue(post, field))) {
      if (!value || value === "unknown") continue;
      const sampleSize = group.length;
      const confidence = sampleSize >= EDITORIAL_SPEC.review.high_confidence_sample_size ? "high" : "low";
      if (confidence === "low" && !options.includeLowConfidence) continue;
      const groupMedian = median(group.map((post) => post.finalSuccessScore));
      if (groupMedian === null) continue;
      const lift = baseline === 0 ? 0 : groupMedian / baseline;
      const lessonType = lift >= 1.2 ? "winner" : lift <= 0.8 ? "loser" : null;
      if (!lessonType) continue;

      lessons.push({
        platform: commonValue(group, "platform"),
        topic: field === "topic" ? String(value) : null,
        formatType: field === "formatType" ? String(value) : commonValue(group, "formatType"),
        promptVersion: null,
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        lessonType,
        summary: summarizeLesson(field, value, lessonType, lift),
        evidence: {
          group: { [field]: coerceGroupValue(value) },
          sampleSize,
          medianScore: round(groupMedian),
          comparisonBaseline: round(baseline),
          postIds: group.map((post) => post.id).slice(0, 10),
          confidence
        }
      });
    }
  }

  return lessons
    .sort((left, right) => Math.abs(right.evidence.medianScore - right.evidence.comparisonBaseline)
      - Math.abs(left.evidence.medianScore - left.evidence.comparisonBaseline))
    .slice(0, 20);
}

export async function generateAndStoreFeedbackLessons(options: {
  days?: number;
  includeLowConfidence?: boolean;
} = {}): Promise<{ created: number }> {
  const prisma = await getPrisma();
  const socialPost = prisma.socialPost as any;
  const feedbackLesson = prisma.feedbackLesson as any;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - (options.days ?? 30) * 24 * 60 * 60 * 1000);
  const posts = await socialPost.findMany({
    where: { createdAt: { gte: windowStart, lte: windowEnd } },
    include: {
      postScores: {
        orderBy: { calculatedAt: "desc" },
        take: 1
      }
    }
  });
  const lessons = generateFeedbackLessonsFromPosts(posts.map((post: any) => {
    const input = asRecord(post.generationInput);
    const intent = asRecord(input.postIntent);
    const fingerprint = asRecord(input.contentFingerprint);
    const reviewHistory = Array.isArray(input.reviewHistory) ? input.reviewHistory : [];
    const latestReview = asRecord(reviewHistory.at(-1));
    return {
      id: post.id,
      platform: post.platform,
      topic: post.topic,
      hookType: post.hookType,
      formatType: post.formatType,
      ctaType: post.ctaType,
      hasMedia: Boolean(post.mediaMetadata?.hasMedia ?? post.mediaMetadata?.imageUrl),
      finalSuccessScore: post.postScores[0]?.finalSuccessScore,
      engagementRate: post.postScores[0]?.engagementRate,
      commentRate: post.postScores[0]?.commentRate,
      shareRate: post.postScores[0]?.shareRate,
      contentPillar: stringOrNull(intent.content_pillar),
      pain: stringOrNull(fingerprint.pain),
      proofType: stringOrNull(fingerprint.proof_type),
      productRole: stringOrNull(intent.product_role),
      narrativeShape: stringOrNull(fingerprint.narrative_shape),
      visualTreatment: stringOrNull(input.visualTreatment),
      humanDecision: stringOrNull(latestReview.decision)
    };
  }), {
    windowStart,
    windowEnd,
    includeLowConfidence: options.includeLowConfidence
  });

  await Promise.all(lessons.map((lesson) => feedbackLesson.create({ data: lesson })));
  return { created: lessons.length };
}

function summarizeLesson(field: LessonField, rawValue: string, lessonType: "winner" | "loser", lift: number): string {
  const value = labelValue(field, rawValue);
  const direction = lessonType === "winner" ? "outperformed" : "underperformed";
  return `${value} ${direction} recent baseline at ${round(lift)}x median score.`;
}

function labelValue(field: LessonField, rawValue: string): string {
  if (field === "hasMedia") return rawValue === "true" ? "Posts with media" : "Posts without media";
  const label = field.replace(/Type$/, "").replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
  return `${titleCase(String(rawValue))} ${label}`;
}

function groupValue(post: FeedbackPostInput, field: LessonField): string {
  if (field === "hasMedia") return String(Boolean(post.hasMedia));
  const value = post[field];
  return value ? String(value).trim().toLowerCase() : "unknown";
}

function commonValue(posts: FeedbackPostInput[], field: "platform" | "formatType"): string | null {
  const values = new Set(posts.map((post) => post[field]).filter(Boolean).map((value) => String(value)));
  return values.size === 1 ? [...values][0] : null;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[middle - 1] + clean[middle]) / 2 : clean[middle];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function coerceGroupValue(value: string): string | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
