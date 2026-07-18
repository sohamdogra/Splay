import type {
  EditorialContext,
  EvidenceConfidence,
  EvidenceItem,
  EvidenceSensitivity,
  EvidenceSourceType,
  GBrainContextItem,
  SourceContext
} from "../types/index.ts";
import { EDITORIAL_SPEC, matchesSourcePattern } from "./editorialSpec.ts";

export type EvidenceValidation = {
  errors: string[];
  warnings: string[];
};

export function buildEditorialContext(topic: string, items: GBrainContextItem[]): EditorialContext {
  const primary = items[0];
  const evidence = items.flatMap((item) => evidenceFromItem(item));
  const claim = cleanClaim(primary?.summary ?? topic);
  const actor = actorFor(primary);
  const concreteObject = concreteObjectFor(`${topic} ${claim}`);
  const behavior = firstSentence(claim) || topic;
  const sensitivity = sensitivityFor(items);

  return {
    claim,
    actor,
    concrete_object: concreteObject,
    observed_behavior: behavior,
    audience_pain: audiencePain(actor, concreteObject, behavior),
    evidence,
    public_safe_claim: publicSafeClaim(claim),
    sensitivity,
    confidence: confidenceFor(items)
  };
}

export function normalizeEditorialContext(
  value: unknown,
  fallback: { topic: string; sourceContext: SourceContext }
): { context: EditorialContext; supplied: boolean } {
  const record = asRecord(value);
  const supplied = Object.keys(record).length > 0;
  const fallbackItem: GBrainContextItem = {
    id: fallback.sourceContext.gbrain_references[0] ?? fallback.topic,
    title: fallback.topic,
    kind: "gbrain_context",
    summary: fallback.sourceContext.summary,
    references: fallback.sourceContext.gbrain_references,
    tags: []
  };
  const derived = buildEditorialContext(fallback.topic, [fallbackItem]);
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.map(normalizeEvidenceItem).filter((item): item is EvidenceItem => Boolean(item))
    : derived.evidence;

  return {
    supplied,
    context: {
      claim: clean(record.claim) || derived.claim,
      actor: clean(record.actor) || derived.actor,
      concrete_object: clean(record.concrete_object) || derived.concrete_object,
      observed_behavior: clean(record.observed_behavior) || derived.observed_behavior,
      audience_pain: clean(record.audience_pain) || derived.audience_pain,
      evidence,
      public_safe_claim: clean(record.public_safe_claim) || derived.public_safe_claim,
      sensitivity: isSensitivity(record.sensitivity) ? record.sensitivity : derived.sensitivity,
      confidence: isConfidence(record.confidence) ? record.confidence : derived.confidence
    }
  };
}

export function validateEditorialContext(
  context: EditorialContext,
  sourceContext: SourceContext,
  options: { supplied?: boolean } = {}
): EvidenceValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const supplied = options.supplied ?? true;

  if (!context.claim.trim()) errors.push("Editorial evidence packet is missing claim.");
  if (!context.public_safe_claim.trim()) errors.push("Editorial evidence packet is missing public_safe_claim.");
  if (!context.actor.trim() || !context.concrete_object.trim() || !context.observed_behavior.trim()) {
    errors.push("Editorial evidence packet must name the actor, concrete object, and observed behavior.");
  }
  if (context.sensitivity === "internal_only") {
    errors.push("Editorial evidence packet is internal_only and cannot be used for public copy.");
  }
  if (context.evidence.length === 0) {
    (supplied ? errors : warnings).push("Editorial evidence packet has no supporting excerpt.");
  }

  const sourceRefs = new Set(sourceContext.gbrain_references);
  const evidenceRefs = new Set(context.evidence.map((item) => item.source_slug));
  const missingEvidence = [...sourceRefs].filter((reference) => !evidenceRefs.has(reference));
  if (supplied && missingEvidence.length > 0) {
    errors.push(`Source reference(s) have no evidence excerpt: ${missingEvidence.join(", ")}.`);
  }
  for (const item of context.evidence) {
    if (!item.source_slug.trim() || !item.excerpt.trim()) {
      errors.push("Every evidence item requires source_slug and excerpt.");
    }
  }

  const allRefs = [...new Set([...sourceRefs, ...evidenceRefs])];
  const restricted = allRefs.filter((reference) => matchesSourcePattern(reference, EDITORIAL_SPEC.source_policy.restricted_slug_patterns));
  if (restricted.length > 0) {
    errors.push(`Restricted source(s) cannot support public copy: ${restricted.join(", ")}.`);
  }
  const corroborationRequired = allRefs.filter((reference) => matchesSourcePattern(reference, EDITORIAL_SPEC.source_policy.corroboration_required_patterns));
  const independent = allRefs.filter((reference) => !matchesSourcePattern(reference, EDITORIAL_SPEC.source_policy.corroboration_required_patterns));
  if (corroborationRequired.length > 0 && independent.length === 0) {
    (supplied ? errors : warnings).push("Strategy-only evidence needs an independent customer, product, or market source before publication.");
  }
  if (!supplied) {
    warnings.push("Legacy source_context was converted to an inferred evidence packet; add exact excerpts before approval.");
  }
  if (context.confidence === "inferred") {
    warnings.push("The central claim is inferred; prefer direct or corroborated evidence.");
  }

  return { errors: unique(errors), warnings: unique(warnings) };
}

function evidenceFromItem(item: GBrainContextItem): EvidenceItem[] {
  const references = item.references.length > 0 ? item.references : [item.id];
  return references.map((reference) => ({
    source_slug: reference,
    excerpt: compact(item.summary, 420),
    source_type: sourceTypeFor(item.kind),
    ...(item.date ? { observed_at: item.date } : {})
  }));
}

function normalizeEvidenceItem(value: unknown): EvidenceItem | null {
  const record = asRecord(value);
  const sourceSlug = clean(record.source_slug);
  const excerpt = clean(record.excerpt);
  if (!sourceSlug && !excerpt) return null;
  const sourceType = isSourceType(record.source_type) ? record.source_type : "internal";
  const observedAt = clean(record.observed_at);
  return { source_slug: sourceSlug, excerpt, source_type: sourceType, ...(observedAt ? { observed_at: observedAt } : {}) };
}

function sourceTypeFor(kind: string): EvidenceSourceType {
  const lower = kind.toLowerCase();
  if (lower.includes("customer") || lower.includes("sales")) return "customer";
  if (lower.includes("product")) return "product";
  if (lower.includes("founder")) return "founder";
  if (lower.includes("market") || lower.includes("competitor")) return "market";
  return "internal";
}

function actorFor(item?: GBrainContextItem): string {
  const kind = item?.kind.toLowerCase() ?? "";
  if (kind.includes("customer")) return "customer";
  if (kind.includes("sales")) return "prospect";
  if (kind.includes("product")) return "product team";
  if (kind.includes("founder")) return "founder";
  if (kind.includes("market") || kind.includes("competitor")) return "market participant";
  return "company audience";
}

function concreteObjectFor(text: string): string {
  const objects = ["product", "service", "customer workflow", "buyer tracker", "document", "record", "tracker", "CRM", "email thread", "follow-up", "meeting notes", "brief", "calendar", "dashboard", "template"];
  return objects.find((object) => new RegExp(`\\b${escapeRegExp(object)}\\b`, "i").test(text)) ?? "work item";
}

function audiencePain(actor: string, object: string, behavior: string): string {
  const lower = behavior.toLowerCase();
  if (/stale|out of date|rebuild|copy|paste|lost|missing|rarely survive/.test(lower)) {
    return `${actor} has to reconstruct the ${object} before the next step can move.`;
  }
  return `${actor} cannot rely on the ${object} without checking the surrounding work.`;
}

function sensitivityFor(items: GBrainContextItem[]): EvidenceSensitivity {
  const labels = items.flatMap((item) => item.sensitivity ?? []).map((label) => label.toLowerCase());
  if (labels.some((label) => EDITORIAL_SPEC.source_policy.internal_sensitivity_labels.includes(label))) return "internal_only";
  const references = items.flatMap((item) => item.references);
  if (references.some((reference) => matchesSourcePattern(reference, EDITORIAL_SPEC.source_policy.corroboration_required_patterns))) return "redacted";
  return "public";
}

function confidenceFor(items: GBrainContextItem[]): EvidenceConfidence {
  const types = new Set(items.map((item) => sourceTypeFor(item.kind)));
  if (types.size >= 2) return "corroborated";
  return types.has("customer") || types.has("product") ? "direct" : "inferred";
}

function publicSafeClaim(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone redacted]")
    .replace(/\bprocess memory\b/gi, "how the firm makes decisions")
    .replace(/\bworkflow memory\b/gi, "the history attached to the work")
    .replace(/\bworkflow fit\b/gi, "working where the team already works")
    .replace(/\buseful wedge\b/gi, "first useful workflow")
    .replace(/\banother destination\b/gi, "another place to update")
    .replace(/\bcodify existing work\b/gi, "capture the work the team already does")
    .replace(/\badoption cost\b/gi, "duplicate work")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanClaim(value: string): string {
  return value.replace(/^Recent [^:]+ context:\s*/i, "").replace(/\s+/g, " ").trim();
}

function firstSentence(value: string): string {
  return value.split(/(?<=[.!?])\s+/).find(Boolean)?.trim() ?? value.trim();
}

function compact(value: string, limit: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 3).trim()}...`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isSensitivity(value: unknown): value is EvidenceSensitivity {
  return ["public", "redacted", "internal_only"].includes(String(value));
}

function isConfidence(value: unknown): value is EvidenceConfidence {
  return ["direct", "corroborated", "inferred"].includes(String(value));
}

function isSourceType(value: unknown): value is EvidenceSourceType {
  return ["customer", "product", "founder", "market", "internal"].includes(String(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
