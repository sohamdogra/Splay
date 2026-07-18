import { countCharacters, formatPostText, X_CHARACTER_LIMIT } from "../postText.ts";
import type { Platform } from "../types/index.ts";

type PlatformStrategy = {
  name: string;
  objective: string;
  promptRules: string[];
};

export type StrategyEvaluation = {
  warnings: string[];
  hookBonus: number;
  clarityBonus: number;
  brandBonus: number;
  platformBonus: number;
  platformPenalty: number;
};

const STRATEGIES: Record<Platform, PlatformStrategy> = {
  x: {
    name: "X organic-reach",
    objective: "fast comprehension, community fit, portable value, and credible continuation",
    promptRules: [
      "Choose one job: sharp observation, useful fact, contrarian argument, build lesson, product proof, or timely implication.",
      "Make the post complete as a standalone post; do not force a thread.",
      "Lead with the claim, contrast, observed pattern, proof, or timely implication.",
      "Give readers a legitimate reason to repost or quote: a concise phrase, defensible stance, useful fact, or concrete result.",
      "Use concise conversational writing. Avoid generic suspense, ragebait, explicit repost asks, unrelated hashtags, and artificial amplification.",
      "Use one blank line between short thought groups when it makes the post easier to scan.",
      `Keep the final published text at or below ${X_CHARACTER_LIMIT} characters total, including hashtags. Prefer zero hashtags.`
    ]
  },
  linkedin: {
    name: "LinkedIn organic-reach",
    objective: "right-audience professional distribution followed by saves, sends, discussion, profile visits, or qualified action",
    promptRules: [
      "Choose one archetype: contrarian lesson, build decision, failure analysis, mini case study, operator framework, industry reaction, product lesson, or artifact teardown.",
      "Reject an archetype if the source context lacks proof for it.",
      "Use one tension mechanism and pay it off quickly: decision, exception, mistake, result, tradeoff, or second-order implication.",
      "Put a proof marker near the opening: observation, artifact, specific event, concrete result, or source-grounded detail.",
      "Use 3-6 short beats before increasing information density.",
      "Make the professional lesson useful without buying the product, state boundary conditions, and end with a narrow practitioner question when useful.",
      "Add 3-4 tightly relevant hashtags for discovery: mix an audience or industry tag, a workflow or use-case tag, and a topic tag.",
      "Avoid direct engagement bait, pure promotion, irrelevant tags, unoriginal generic AI prose, and unconstructive provocation."
    ]
  }
};

const GENERIC_OPENERS = [
  "unpopular opinion",
  "hot take",
  "here's the truth",
  "you won't believe",
  "everyone needs to hear this",
  "stop scrolling"
];

const GENERIC_AI_TERMS = [
  "unlock your potential",
  "unlock unprecedented",
  "seamless solution",
  "transform your business",
  "revolutionary platform"
];

export function platformStrategyPrompt(platform: Platform): string[] {
  const strategy = STRATEGIES[platform];
  return [
    `${strategy.name} strategy objective: ${strategy.objective}.`,
    ...strategy.promptRules
  ];
}

export function evaluatePlatformStrategy(platform: Platform, text: string, hashtags: string[]): StrategyEvaluation {
  const publishedText = formatPostText(text, hashtags);
  const publishedLength = countCharacters(publishedText);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? "";
  const hookText = platform === "x" ? firstSentence(firstLine) : firstLine;
  const lower = text.toLowerCase();
  const firstBlock = text.slice(0, 240).toLowerCase();
  const warnings: string[] = [];

  const genericHits = GENERIC_OPENERS.filter((term) => lower.includes(term));
  const aiHits = GENERIC_AI_TERMS.filter((term) => lower.includes(term));
  const engagementBait = hasEngagementBait(lower);
  const proofMarker = hasProofMarker(firstBlock);
  const contrast = hasUsefulContrast(lower);
  const boundary = hasBoundaryCondition(lower);
  const narrowQuestion = hasNarrowQuestion(lines.at(-1) ?? "");

  if (genericHits.length > 0) {
    warnings.push(`Strategy warning: avoid generic opener "${genericHits[0]}"; use a specific claim or observation.`);
  }
  if (aiHits.length > 0) {
    warnings.push(`Strategy warning: generic AI phrase detected: "${aiHits[0]}".`);
  }
  if (engagementBait) {
    warnings.push("Strategy warning: direct engagement bait can suppress useful distribution.");
  }

  if (platform === "x") {
    if (hashtags.length > 1) warnings.push("Strategy warning: X strategy favors zero or one highly relevant hashtag.");
    if (isThreadMarker(firstLine)) warnings.push("Strategy warning: X strategy says not to force a thread when one post carries the idea.");
    if (hookText.length > 140) warnings.push("Strategy warning: X hook should survive a fast timeline scan.");

    return {
      warnings,
      hookBonus: (hookText.length <= 110 ? 1 : 0) + (contrast || proofMarker ? 1 : 0),
      clarityBonus: publishedLength <= X_CHARACTER_LIMIT && publishedLength >= 80 ? 1 : 0,
      brandBonus: contrast ? 1 : 0,
      platformBonus: (hashtags.length === 0 ? 1 : 0) + (publishedLength <= 260 ? 1 : 0),
      platformPenalty: (publishedLength > X_CHARACTER_LIMIT ? 4 : 0)
        + (publishedLength > 260 ? 1 : 0)
        + (hashtags.length > 1 ? 1 : 0)
        + (engagementBait ? 2 : 0)
        + (genericHits.length > 0 ? 2 : 0)
    };
  }

  if (hashtags.length < 3 || hashtags.length > 4) warnings.push("Strategy warning: LinkedIn strategy requires 3-4 relevant hashtags for targeted discovery.");
  if (isPurePromotion(lower)) warnings.push("Strategy warning: LinkedIn strategy puts insight before product promotion.");
  if (!proofMarker) warnings.push("Strategy warning: LinkedIn hook should include a proof marker or source-grounded detail near the opening.");

  return {
    warnings,
    hookBonus: (firstLine.length <= 120 ? 1 : 0) + (proofMarker || contrast ? 1 : 0),
    clarityBonus: (lines.length >= 5 ? 1 : 0) + (boundary ? 1 : 0),
    brandBonus: boundary ? 1 : 0,
    platformBonus: (narrowQuestion ? 1 : 0) + (proofMarker ? 1 : 0) + (hashtags.length >= 3 && hashtags.length <= 4 ? 1 : 0),
    platformPenalty: (text.length < 350 ? 2 : 0)
      + (text.length > 2200 ? 1 : 0)
      + (hashtags.length < 3 || hashtags.length > 4 ? 1 : 0)
      + (engagementBait ? 2 : 0)
      + (genericHits.length > 0 ? 2 : 0)
      + (isPurePromotion(lower) ? 2 : 0)
  };
}

function hasProofMarker(text: string): boolean {
  return /\b\d+[%x]?\b/.test(text)
    || /\b(recent|observed|in practice|example|case|artifact|source|result|decision|tradeoff|deal|diligence|operator|team|workflow)\b/.test(text);
}

function hasUsefulContrast(text: string): boolean {
  return /\b(most|many)\b.+\b(but|while|yet)\b/.test(text)
    || /\b(not|isn't|is not)\b.+\b(it'?s|it is|the)\b/.test(text)
    || /\b(bottleneck|hard part|real risk|instead of|tradeoff|trade-off)\b/.test(text);
}

function hasBoundaryCondition(text: string): boolean {
  return /\b(when|unless|except|only if|not when|works best|less useful|boundary|tradeoff|trade-off|does not apply)\b/.test(text);
}

function hasNarrowQuestion(line: string): boolean {
  const lower = line.trim().toLowerCase();
  return lower.endsWith("?")
    && /^(what|where|which|when|how)\b/.test(lower)
    && !/\b(thoughts|agree|like|comment|share|repost)\b/.test(lower);
}

function hasEngagementBait(text: string): boolean {
  return /\b(like|comment|share|repost|retweet)\s+(if|for|to|and)\b/.test(text)
    || /\bfollow\s+(us|me|for)\b/.test(text)
    || /\btag\s+(someone|a|your)\b/.test(text)
    || /\bwhat do you think\??\s*$/.test(text);
}

function isThreadMarker(line: string): boolean {
  return /^(\d+\/|thread\b|a thread\b)/i.test(line.trim());
}

function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return (match?.[0] ?? text).trim();
}

function isPurePromotion(text: string): boolean {
  return /\b(book a demo|buy now|get started today|schedule a call|sign up now)\b/.test(text);
}
