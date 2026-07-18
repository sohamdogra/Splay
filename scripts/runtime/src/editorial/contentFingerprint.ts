import type { ContentFingerprint, EditorialContext, PostIntent } from "../types/index.ts";
import { EDITORIAL_SPEC } from "./editorialSpec.ts";

export type FingerprintInput = {
  text: string;
  topic?: string | null;
  editorialContext?: EditorialContext | null;
  postIntent?: PostIntent | null;
  hookType?: string | null;
  formatType?: string | null;
  ctaType?: string | null;
};

export type ConceptualReference = {
  id: string;
  text: string;
  topic?: string | null;
  fingerprint?: ContentFingerprint | null;
  lifecycle?: string | null;
};

export type ConceptualDiversityAssessment = {
  ok: boolean;
  maxSimilarity: number;
  matchedPostId: string | null;
  repeatedDimensions: string[];
  warnings: string[];
};

const dimensions: Array<keyof ContentFingerprint> = [
  "audience_segment",
  "pain",
  "job_to_be_done",
  "system_or_artifact",
  "thesis",
  "proof_type",
  "product_capability",
  "hook_shape",
  "narrative_shape",
  "cta_shape"
];

const weights: Record<keyof ContentFingerprint, number> = {
  audience_segment: 0.05,
  pain: 0.18,
  job_to_be_done: 0.1,
  system_or_artifact: 0.08,
  thesis: 0.2,
  proof_type: 0.08,
  product_capability: 0.16,
  hook_shape: 0.05,
  narrative_shape: 0.06,
  cta_shape: 0.04
};

export function buildContentFingerprint(input: FingerprintInput): ContentFingerprint {
  const corpus = `${input.topic ?? ""} ${input.editorialContext?.public_safe_claim ?? ""} ${input.editorialContext?.audience_pain ?? ""} ${input.text}`;
  return {
    audience_segment: normalize(input.postIntent?.audience_segment || inferAudience(corpus)),
    pain: canonicalPain(corpus),
    job_to_be_done: canonicalJob(corpus),
    system_or_artifact: canonicalArtifact(corpus),
    thesis: canonicalThesis(corpus),
    proof_type: normalize(input.editorialContext?.confidence || inferProofType(corpus)),
    product_capability: canonicalCapability(corpus),
    hook_shape: normalize(input.hookType || inferHookShape(input.text)),
    narrative_shape: normalize(input.formatType || inferNarrativeShape(input.text)),
    cta_shape: normalize(input.ctaType || inferCtaShape(input.text))
  };
}

export function fingerprintSimilarity(left: ContentFingerprint, right: ContentFingerprint): { score: number; repeatedDimensions: string[] } {
  let score = 0;
  const repeatedDimensions: string[] = [];
  for (const dimension of dimensions) {
    const similarity = fieldSimilarity(left[dimension], right[dimension]);
    score += similarity * weights[dimension];
    if (similarity >= 0.85 && left[dimension] !== "unknown" && right[dimension] !== "unknown") repeatedDimensions.push(dimension);
  }
  return { score, repeatedDimensions };
}

export function assessConceptualDiversity(
  fingerprint: ContentFingerprint,
  recentPosts: ConceptualReference[]
): ConceptualDiversityAssessment {
  let maxSimilarity = 0;
  let matchedPostId: string | null = null;
  let repeatedDimensions: string[] = [];

  for (const post of recentPosts) {
    const candidate = post.fingerprint ?? buildContentFingerprint({ text: post.text, topic: post.topic });
    const comparison = fingerprintSimilarity(fingerprint, candidate);
    const lifecycleWeight = post.lifecycle === "published" || post.lifecycle === "posted" ? 1 : post.lifecycle === "approved" ? 0.95 : post.lifecycle === "rejected" ? 0.3 : 0.6;
    const similarity = comparison.score * lifecycleWeight;
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      matchedPostId = post.id;
      repeatedDimensions = comparison.repeatedDimensions;
    }
  }

  const threshold = EDITORIAL_SPEC.diversity.conceptual_warning_threshold;
  const warnings = maxSimilarity >= threshold
    ? [`Conceptual diversity warning: draft repeats ${humanDimensions(repeatedDimensions)} from recent post ${matchedPostId} (${Math.round(maxSimilarity * 100)}% conceptual similarity).`]
    : [];
  return { ok: warnings.length === 0, maxSimilarity, matchedPostId, repeatedDimensions, warnings };
}

function canonicalPain(text: string): string {
  const lower = text.toLowerCase();
  if (/stale|out.of.date|still shows|waits for someone|rebuild.*(?:tracker|log|record)|copy.*(?:tracker|crm|excel)/.test(lower)) return "system of record is stale";
  if (/handoff|next owner|reconstruct|lost after|survive the close|lives? in.*head|missing story/.test(lower)) return "handoff loses context";
  if (/last.minute|too late|scramble|before the meeting/.test(lower)) return "preparation arrives too late";
  if (/dashboard.*(?:ownership|accountability)|visible.*owned/.test(lower)) return "visibility does not create ownership";
  if (/another (?:tool|tab|place)|duplicate work|leave outlook/.test(lower)) return "new software creates duplicate work";
  if (/approval|audit|what changed|old value|new value/.test(lower)) return "automation is hard to verify";
  return compactMeaning(text);
}

function canonicalJob(text: string): string {
  const lower = text.toLowerCase();
  if (/follow-up/.test(lower)) return "prepare and send the next follow-up";
  if (/brief|pre-call|agenda/.test(lower)) return "prepare the team for a call";
  if (/tracker|crm|excel|buyer log|record/.test(lower)) return "keep the deal record current";
  if (/handoff|next owner|post-close/.test(lower)) return "hand work to the next owner";
  if (/assign|owner|accountab/.test(lower)) return "make the next step owned";
  return "move the next deal step";
}

function canonicalArtifact(text: string): string {
  const lower = text.toLowerCase();
  const matches: Array<[RegExp, string]> = [
    [/buyer (?:tracker|log|list)/, "buyer tracker"],
    [/\bcrm\b/, "crm"],
    [/\bexcel\b|spreadsheet/, "spreadsheet"],
    [/meeting notes|transcript/, "meeting notes"],
    [/email thread|\bthread\b|\binbox\b|outlook/, "email thread"],
    [/pre-call brief|\bbrief\b/, "pre-call brief"],
    [/dashboard/, "dashboard"],
    [/workflow template|template/, "workflow template"]
  ];
  return matches.find(([pattern]) => pattern.test(lower))?.[1] ?? "deal record";
}

function canonicalThesis(text: string): string {
  const lower = text.toLowerCase();
  if (/already (?:in|has)|update exists|in the thread/.test(lower)) return "the source already contains the missing update";
  if (/without (?:leaving|asking)|inside (?:outlook|the inbox)|where.*work/.test(lower)) return "automation should act where the team already works";
  if (/reviewable|approve|before anything moves|before writeback/.test(lower)) return "automation earns trust through reviewable changes";
  if (/next owner|carry.*(?:history|story|judgment)|handoff/.test(lower)) return "the workflow should preserve context across handoffs";
  if (/not.*(?:summary|screen|dashboard)|the (?:hard part|point|test)/.test(lower)) return "workflow outcomes matter more than surface output";
  return firstMeaningfulSentence(text);
}

function canonicalCapability(text: string): string {
  const lower = text.toLowerCase();
  const capabilities: string[] = [];
  if (/read.*(?:thread|email)|watches.*calendar|meeting.*(?:notes|takeaways)/.test(lower)) capabilities.push("read work context");
  if (/(?:update|write back|writeback|suggest|propose).*(?:tracker|crm|excel|record|log)/.test(lower)) capabilities.push("propose system-of-record update");
  if (/draft|ready-to-send.*follow-up/.test(lower)) capabilities.push("draft follow-up");
  if (/prepare.*brief|firm summary/.test(lower)) capabilities.push("prepare call brief");
  if (/approve|reviewable|review them/.test(lower)) capabilities.push("human approval before action");
  return capabilities.join(" + ") || "no explicit product capability";
}

function inferAudience(text: string): string {
  if (/banker|investment bank|buyer outreach|sell-side/.test(text.toLowerCase())) return "investment banking deal teams";
  if (/private equity|sponsor|post-close|diligence/.test(text.toLowerCase())) return "private equity deal teams";
  return "deal-team operators";
}

function inferProofType(text: string): string {
  if (/customer|prospect|observed|recent call|in practice/.test(text.toLowerCase())) return "direct";
  if (/example|source|notes|thread/.test(text.toLowerCase())) return "inferred";
  return "assertion";
}

function inferHookShape(text: string): string {
  const first = firstMeaningfulSentence(text);
  if (first.endsWith("?")) return "question";
  if (/^(every|most|many)\b/i.test(first)) return "generalized observation";
  if (/^(the|a)\b.+(?:ended|arrived|replied|went out|still)/i.test(first)) return "operator scene";
  if (/\bnot\b|\bbut\b|\binstead\b/i.test(first)) return "contrast";
  return "point of view";
}

function inferNarrativeShape(text: string): string {
  if (/^[-*]|^\d+\./m.test(text)) return "list";
  if (/\bSplay\b/i.test(text) && text.toLowerCase().indexOf("splay") < text.length * 0.45) return "product led explainer";
  if (/\bSplay\b/i.test(text)) return "pain to product";
  if (/\bnot\b.+\b(?:but|instead)\b/is.test(text)) return "contrast argument";
  return text.split(/\n\s*\n/).length <= 2 ? "compact observation" : "operator narrative";
}

function inferCtaShape(text: string): string {
  const last = text.trim().split(/\n/).filter(Boolean).at(-1) ?? "";
  if (last.endsWith("?")) return "question";
  if (/\b(comment|reply|dm|book|schedule)\b/i.test(last)) return "explicit";
  if (/\bSplay\b/i.test(last)) return "product close";
  return "point of view close";
}

function fieldSimilarity(left: string, right: string): number {
  if (!left || !right || left === "unknown" || right === "unknown") return 0;
  if (left === right) return 1;
  const leftTokens = new Set(normalize(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalize(right).split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((item) => rightTokens.has(item)).length;
  return intersection / Math.max(1, new Set([...leftTokens, ...rightTokens]).size);
}

function compactMeaning(text: string): string {
  const value = normalize(firstMeaningfulSentence(text));
  return value.split(" ").slice(0, 10).join(" ") || "unknown";
}

function firstMeaningfulSentence(text: string): string {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).find(Boolean)?.trim() ?? "unknown";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() || "unknown";
}

function humanDimensions(values: string[]): string {
  const labels = values.map((value) => value.replace(/_/g, " "));
  if (labels.length === 0) return "the same underlying idea";
  return labels.slice(0, 4).join(", ");
}
