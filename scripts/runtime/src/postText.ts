import type { Platform } from "./types/index.ts";

export const X_CHARACTER_LIMIT = 280;

type DraftText = {
  text: string;
  hashtags: string[];
};

export type PlatformValidation = {
  ok: boolean;
  count: number;
  limit?: number;
  message?: string;
};

export function formatPostText(text: string, hashtags: string[]): string {
  const hashtagText = sanitizeHashtags(hashtags).map((tag) => `#${tag}`).join(" ");
  return [text.trim(), hashtagText].filter(Boolean).join("\n\n");
}

export function countCharacters(text: string): number {
  return Array.from(text).length;
}

export function validatePlatformPost(platform: Platform, text: string, hashtags: string[]): PlatformValidation {
  const formatted = formatPostText(text, hashtags);
  const count = countCharacters(formatted);

  if (platform === "x" && count > X_CHARACTER_LIMIT) {
    return {
      ok: false,
      count,
      limit: X_CHARACTER_LIMIT,
      message: `X post is ${count} characters; Buffer/X limit is ${X_CHARACTER_LIMIT}. Shorten by ${count - X_CHARACTER_LIMIT} characters before staging.`
    };
  }

  return { ok: true, count, limit: platform === "x" ? X_CHARACTER_LIMIT : undefined };
}

export function fitDraftToPlatform(platform: Platform, draft: DraftText): DraftText {
  const hashtagLimit = platform === "x" ? 1 : 4;
  const hashtags = sanitizeHashtags(draft.hashtags).slice(0, hashtagLimit);
  const text = platform === "x" ? formatXBody(draft.text) : draft.text.trim();

  if (platform !== "x") return { text, hashtags };

  let nextHashtags = [...hashtags];
  while (nextHashtags.length > 0 && !validatePlatformPost(platform, text, nextHashtags).ok) {
    nextHashtags = nextHashtags.slice(0, -1);
  }

  const validation = validatePlatformPost(platform, text, nextHashtags);
  if (validation.ok) return { text, hashtags: nextHashtags };

  const singleLineBreakText = text.replace(/\n{2,}/g, "\n");
  if (singleLineBreakText !== text && validatePlatformPost(platform, singleLineBreakText, nextHashtags).ok) {
    return { text: singleLineBreakText, hashtags: nextHashtags };
  }

  const compactText = compactWhitespace(text);
  if (compactText !== text && validatePlatformPost(platform, compactText, nextHashtags).ok) {
    return { text: compactText, hashtags: nextHashtags };
  }

  const hashtagSuffix = nextHashtags.length > 0 ? `\n\n${nextHashtags.map((tag) => `#${tag}`).join(" ")}` : "";
  const textLimit = X_CHARACTER_LIMIT - countCharacters(hashtagSuffix);
  return {
    text: truncateAtWordBoundary(text, textLimit),
    hashtags: nextHashtags
  };
}

function sanitizeHashtags(hashtags: string[]): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const rawTag of hashtags) {
    const tag = rawTag.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    sanitized.push(tag);
  }

  return sanitized;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatXBody(text: string): string {
  const normalized = normalizeParagraphWhitespace(text);
  if (normalized.includes("\n\n")) return normalized;
  return addReadableXBreaks(normalized);
}

function normalizeParagraphWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim())
    .filter(Boolean)
    .join("\n\n");
}

function addReadableXBreaks(text: string): string {
  const sentences = splitSentences(text);
  if (sentences.length < 2) return text;

  const firstBlockCount = countOpeningSentences(sentences);
  if (firstBlockCount <= 0 || firstBlockCount >= sentences.length) return text;

  const blocks = [
    sentences.slice(0, firstBlockCount).join(" "),
    ...remainingXBlocks(sentences.slice(firstBlockCount))
  ].filter(Boolean);

  return blocks.length > 1 ? blocks.join("\n\n") : text;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function countOpeningSentences(sentences: string[]): number {
  let block = "";
  for (let index = 0; index < sentences.length - 1; index += 1) {
    block = [block, sentences[index]].filter(Boolean).join(" ");
    if (countCharacters(block) >= 45 && countCharacters(block) <= 130) return index + 1;
  }

  return countCharacters(sentences[0] ?? "") <= 140 ? 1 : 0;
}

function remainingXBlocks(sentences: string[]): string[] {
  const remaining = sentences.join(" ");
  if (sentences.length < 3 || countCharacters(remaining) <= 145) return [remaining];

  let block = "";
  for (let index = 0; index < sentences.length - 1; index += 1) {
    block = [block, sentences[index]].filter(Boolean).join(" ");
    if (countCharacters(block) >= 70) {
      return [block, sentences.slice(index + 1).join(" ")];
    }
  }

  return [remaining];
}

function truncateAtWordBoundary(text: string, limit: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= limit) return text.trim();
  if (limit <= 3) return chars.slice(0, Math.max(0, limit)).join("");

  const head = chars.slice(0, limit - 3).join("").trimEnd();
  const sentenceCut = bestSentenceCut(head, limit);
  if (sentenceCut > 0) return head.slice(0, sentenceCut).trimEnd();

  const wordCut = head.lastIndexOf(" ");
  const candidate = wordCut > Math.floor(limit * 0.5)
    ? head.slice(0, wordCut)
    : head;

  return `${candidate.trimEnd()}...`;
}

function bestSentenceCut(text: string, limit: number): number {
  const minimum = Math.floor(limit * 0.55);
  const cuts = [". ", "? ", "! "]
    .map((marker) => {
      const index = text.lastIndexOf(marker);
      return index === -1 ? -1 : index + 1;
    })
    .filter((index) => index >= minimum);

  return cuts.length > 0 ? Math.max(...cuts) : -1;
}
