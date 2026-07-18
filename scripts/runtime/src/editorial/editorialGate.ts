import type { Platform } from "../types/index.ts";
import { EDITORIAL_SPEC } from "./editorialSpec.ts";

// Internal Splay positioning language that reads as jargon to a social audience.
// Shared by the import gate (chat-authored drafts) and the runtime fallback agents.
export const INTERNAL_JARGON_PHRASES = EDITORIAL_SPEC.public_copy.banned_phrases;

export const LINKEDIN_TARGET_MIN = 500;
export const LINKEDIN_TARGET_MAX = 650;
export const LINKEDIN_HASHTAG_MIN = 3;
export const LINKEDIN_HASHTAG_MAX = 4;
const LINKEDIN_WARN_MIN = LINKEDIN_TARGET_MIN;
const LINKEDIN_WARN_MAX = LINKEDIN_TARGET_MAX;

export const IMAGE_HEADLINE_MIN_WORDS = 3;
export const IMAGE_HEADLINE_MAX_WORDS = 8;
export const IMAGE_SUPPORT_MIN_WORDS = 5;
export const IMAGE_SUPPORT_MAX_WORDS = 12;

export type EditorialCheck = {
  errors: string[];
  warnings: string[];
};

export type PostDraftInput = {
  platform: Platform;
  topic: string;
  postText: string;
  hashtags: string[];
};

export type ImageCopyInput = {
  headline?: string;
  support?: string;
};

export function findInternalJargon(text: string): string[] {
  return INTERNAL_JARGON_PHRASES.filter((phrase) => jargonPattern(phrase).test(text));
}

export function checkPostDraft(input: PostDraftInput): EditorialCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const phrase of findInternalJargon(input.topic)) {
    errors.push(`Internal jargon in topic: "${phrase}". Rewrite the topic in plain audience language.`);
  }
  for (const phrase of findInternalJargon(input.postText)) {
    errors.push(`Internal jargon in post text: "${phrase}". Rewrite it in plain language, or keep it only with an immediate one-line explanation and re-import with --skip-editorial-gate.`);
  }
  if (/splay\.io/i.test(`${input.topic} ${input.postText}`)) {
    errors.push('Post uses "Splay.io". The brand name in social copy is "Splay".');
  }

  if (input.platform === "linkedin") {
    const hashtagCount = normalizedHashtagCount(input.hashtags);
    if (hashtagCount < LINKEDIN_HASHTAG_MIN || hashtagCount > LINKEDIN_HASHTAG_MAX) {
      errors.push(`LinkedIn draft has ${hashtagCount} unique hashtag(s); use ${LINKEDIN_HASHTAG_MIN}-${LINKEDIN_HASHTAG_MAX} relevant hashtags for targeted discovery.`);
    }

    const irrelevant = irrelevantHashtags(input.hashtags, `${input.topic} ${input.postText}`);
    if (irrelevant.length > 0) {
      errors.push(`LinkedIn hashtag(s) are not supported by this post: ${irrelevant.map((tag) => `#${tag}`).join(", ")}. Use audience, workflow, and topic tags that match the claim.`);
    }

    const count = Array.from(input.postText.trim()).length;
    if (count < LINKEDIN_WARN_MIN) {
      warnings.push(`LinkedIn draft is ${count} chars; the target is ${LINKEDIN_TARGET_MIN}-${LINKEDIN_TARGET_MAX}. Confirm the post still lands one clear pain and one concrete Splay angle.`);
    } else if (count > LINKEDIN_WARN_MAX) {
      warnings.push(`LinkedIn draft is ${count} chars; the target is ${LINKEDIN_TARGET_MIN}-${LINKEDIN_TARGET_MAX}. Keep the extra length only if the topic truly needs it.`);
    }
  }

  if (input.platform === "x" && input.hashtags.length > 0) {
    const irrelevant = irrelevantHashtags(input.hashtags, `${input.topic} ${input.postText}`);
    if (irrelevant.length > 0) {
      errors.push(`X hashtag is not supported by this post: ${irrelevant.map((tag) => `#${tag}`).join(", ")}. Omit it or use one tag that materially improves discovery.`);
    }
  }

  return { errors, warnings };
}

export function checkImageCopy(input: ImageCopyInput): EditorialCheck {
  const errors: string[] = [];
  const headline = clean(input.headline);
  const support = clean(input.support);

  if (!headline) {
    errors.push("image_copy.headline is missing.");
  } else {
    const words = wordCount(headline);
    if (words < IMAGE_HEADLINE_MIN_WORDS || words > IMAGE_HEADLINE_MAX_WORDS) {
      errors.push(`Image headline "${headline}" is ${words} word(s); it must be ${IMAGE_HEADLINE_MIN_WORDS}-${IMAGE_HEADLINE_MAX_WORDS} words.`);
    }
    for (const phrase of findInternalJargon(headline)) {
      errors.push(`Internal jargon in image headline: "${phrase}". Use a concrete, scannable line instead.`);
    }
  }

  if (!support) {
    errors.push("image_copy.support is missing.");
  } else {
    const words = wordCount(support);
    if (words < IMAGE_SUPPORT_MIN_WORDS || words > IMAGE_SUPPORT_MAX_WORDS) {
      errors.push(`Image support line "${support}" is ${words} word(s); it must be ${IMAGE_SUPPORT_MIN_WORDS}-${IMAGE_SUPPORT_MAX_WORDS} words.`);
    }
    for (const phrase of findInternalJargon(support)) {
      errors.push(`Internal jargon in image support line: "${phrase}". Use a concrete, scannable line instead.`);
    }
  }

  if (/splay\.io/i.test(`${headline} ${support}`)) {
    errors.push('Image copy uses "Splay.io". The brand name on creative is "Splay".');
  }

  return { errors, warnings: [] };
}

function jargonPattern(phrase: string): RegExp {
  const flexible = phrase.replace(/[- ]+/g, "[\\s-]+");
  return new RegExp(`\\b${flexible}\\b`, "i");
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizedHashtagCount(values: string[]): number {
  return new Set(values
    .map((value) => value.trim().replace(/^#+/, "").replace(/\s+/g, "").toLowerCase())
    .filter(Boolean)).size;
}

function irrelevantHashtags(values: string[], corpus: string): string[] {
  const lower = corpus.toLowerCase();
  const normalizedCorpus = lower.replace(/[^a-z0-9]+/g, " ");
  const unique = new Map<string, string>();
  for (const value of values) {
    const display = value.trim().replace(/^#+/, "").replace(/\s+/g, "");
    const normalized = display.toLowerCase();
    if (normalized && !unique.has(normalized)) unique.set(normalized, display);
  }

  return [...unique.entries()].filter(([tag, display]) => {
    const knownPattern = knownHashtagPattern(tag);
    if (knownPattern) return !knownPattern.test(lower);
    const words = display
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4);
    return words.length === 0 || !words.some((word) => normalizedCorpus.includes(word));
  }).map(([, display]) => display);
}

function knownHashtagPattern(tag: string): RegExp | null {
  const patterns: Record<string, RegExp> = {
    privateequity: /\b(private equity|sponsor|portfolio|buyer|deal|transaction)\b/i,
    investmentbanking: /\b(bank|bankers?|buyer|seller|deal|transaction|m&a|capital markets)\b/i,
    dealteams: /\b(deal|transaction|buyer|seller|diligence|team|workflow)\b/i,
    capitalmarkets: /\b(bank|banker|capital markets|financing|transaction|deal)\b/i,
    dealops: /\b(deal|workflow|tracker|inbox|follow-up|handoff|owner|brief|call)\b/i,
    dealworkflow: /\b(deal|workflow|tracker|brief|call|meeting|calendar|handoff|agenda)\b/i,
    dealtechnology: /\b(deal|workflow|technology|tool|software|system|tracker|splay)\b/i,
    mergersandacquisitions: /\b(m&a|merger|acquisition|buyer|seller|deal|transaction)\b/i,
    artificialintelligence: /\b(ai|artificial intelligence|agent|automation|splay)\b/i,
    salesenablement: /\b(sales|call|meeting|brief|prep|agenda|pipeline)\b/i
  };
  return patterns[tag] ?? null;
}
