import type {
  ContentFingerprint,
  EditorialContext,
  EditorialEvaluation,
  Platform,
  PostIntent,
  SourceContext
} from "../types/index.ts";
import { evaluatePlatformStrategy } from "../strategy/platformStrategy.ts";
import { checkPostDraft } from "./editorialGate.ts";
import { assessConceptualDiversity, buildContentFingerprint, type ConceptualReference } from "./contentFingerprint.ts";
import { validateEditorialContext } from "./evidencePacket.ts";
import { EDITORIAL_SPEC } from "./editorialSpec.ts";

export type EditorialReviewInput = {
  platform: Platform;
  topic: string;
  text: string;
  hashtags: string[];
  sourceContext: SourceContext;
  editorialContext: EditorialContext;
  postIntent?: PostIntent;
  recentPosts?: ConceptualReference[];
  evidenceSupplied?: boolean;
};

export function evaluateEditorialDraft(input: EditorialReviewInput): { evaluation: EditorialEvaluation; fingerprint: ContentFingerprint } {
  const postGate = checkPostDraft({ platform: input.platform, topic: input.topic, postText: input.text, hashtags: input.hashtags });
  const evidenceGate = validateEditorialContext(input.editorialContext, input.sourceContext, { supplied: input.evidenceSupplied });
  const strategy = evaluatePlatformStrategy(input.platform, input.text, input.hashtags);
  const fingerprint = buildContentFingerprint({
    text: input.text,
    topic: input.topic,
    editorialContext: input.editorialContext,
    postIntent: input.postIntent
  });
  const diversity = assessConceptualDiversity(fingerprint, input.recentPosts ?? []);
  const rationale: string[] = [];

  const sourceFidelity = scoreSourceFidelity(input.editorialContext, evidenceGate, rationale);
  const insightStrength = scoreInsight(input.text, rationale);
  const specificity = scoreSpecificity(input.text, input.editorialContext, rationale);
  const novelty = clamp(Math.round(10 - diversity.maxSimilarity * 7));
  if (!diversity.ok) rationale.push(...diversity.warnings);
  else rationale.push("The pain, thesis, and product behavior are distinct from recent references.");
  const voice = scoreVoice(input.text, postGate.errors, rationale);
  const promotionBalance = scorePromotionBalance(input.text, input.postIntent, rationale);

  const editorialScores = [sourceFidelity, insightStrength, specificity, novelty, voice, promotionBalance];
  const floor = EDITORIAL_SPEC.review.publish_floor;
  const complianceErrors = [...postGate.errors, ...evidenceGate.errors];
  const verdict = complianceErrors.length > 0
    ? "reject"
    : editorialScores.some((score) => score < 5)
      ? "revise"
      : editorialScores.every((score) => score >= floor)
        ? "publish"
        : "revise";
  if (verdict !== "publish") rationale.push("The candidate needs editorial revision before approval; passing syntax checks alone is not sufficient.");

  const blocks = input.text.split(/\n\s*\n/).filter(Boolean);
  const publishedLength = input.text.length + input.hashtags.reduce((sum, tag) => sum + tag.length + 2, 0);
  const nativeFit = clamp(9 - strategy.platformPenalty - strategy.warnings.length + strategy.platformBonus);
  const readability = clamp(6 + (blocks.length >= 2 ? 1 : 0) + (averageSentenceLength(input.text) <= 24 ? 2 : 0));
  const interactionPotential = clamp(5 + (insightStrength >= 7 ? 2 : 0) + (specificity >= 7 ? 1 : 0) + (input.platform === "x" && publishedLength <= 260 ? 1 : 0));

  return {
    fingerprint,
    evaluation: {
      compliance: {
        passed: complianceErrors.length === 0,
        errors: complianceErrors,
        warnings: unique([...postGate.warnings, ...evidenceGate.warnings, ...strategy.warnings, ...diversity.warnings])
      },
      editorial_review: {
        source_fidelity: sourceFidelity,
        insight_strength: insightStrength,
        specificity,
        novelty,
        voice,
        promotion_balance: promotionBalance,
        verdict,
        rationale: unique(rationale)
      },
      platform_review: {
        native_fit: nativeFit,
        readability,
        interaction_potential: interactionPotential,
        rationale: unique([
          ...(strategy.warnings.length ? strategy.warnings : ["Platform structure passes the current native-format checks."]),
          input.platform === "x" ? "X is evaluated as a standalone post, not as a LinkedIn summary." : "LinkedIn is evaluated for a complete argument and readable paragraph rhythm."
        ])
      }
    }
  };
}

export function editorialCompositeScore(evaluation: EditorialEvaluation): number {
  const editorial = evaluation.editorial_review;
  const platform = evaluation.platform_review;
  const base = (
    editorial.source_fidelity * 1.3
    + editorial.insight_strength * 1.4
    + editorial.specificity * 1.3
    + editorial.novelty * 1.2
    + editorial.voice
    + editorial.promotion_balance
    + platform.native_fit
    + platform.readability
    + platform.interaction_potential
  ) / 10.2;
  return Math.round((base - evaluation.compliance.errors.length * 3) * 10) / 10;
}

function scoreSourceFidelity(context: EditorialContext, gate: { errors: string[]; warnings: string[] }, rationale: string[]): number {
  let score = context.confidence === "corroborated" ? 10 : context.confidence === "direct" ? 9 : 6;
  score -= gate.errors.length * 3;
  score -= gate.warnings.filter((warning) => /inferred|Legacy|Strategy-only/i.test(warning)).length;
  score = clamp(score);
  rationale.push(score >= 8 ? "The claim is tied to direct or corroborated source evidence." : "The claim needs stronger direct evidence or corroboration.");
  return score;
}

function scoreInsight(text: string, rationale: string[]): number {
  let score = 5;
  if (/\b(not|but|instead|unless|only when|only if|the real|the useful moment|the point)\b/i.test(text)) score += 2;
  if (/\b(what changed|why it matters|before|after|when the|moment|test|tradeoff)\b/i.test(text)) score += 1;
  if (/\b(revolutionize|game changer|future of|transforming)\b/i.test(text)) score -= 3;
  score = clamp(score);
  rationale.push(score >= 7 ? "The post contains an interpretation or boundary, not just a product description." : "The post states a familiar problem without a sufficiently non-obvious interpretation.");
  return score;
}

function scoreSpecificity(text: string, context: EditorialContext, rationale: string[]): number {
  const concreteTerms = ["tracker", "CRM", "Excel", "spreadsheet", "thread", "email", "follow-up", "buyer", "calendar", "brief", "meeting", "notes", "dashboard", "owner", "handoff", "diligence", "decision", "risk", "status", "agenda", "template"];
  const count = concreteTerms.filter((term) => new RegExp(`\\b${term.replace(/[-]/g, "[-]")}s?\\b`, "i").test(text)).length;
  let score = 4 + Math.min(4, count);
  if (text.toLowerCase().includes(context.concrete_object.toLowerCase())) score += 1;
  if (/\b(some|things|stuff|solution|platform|efficiency)\b/i.test(text) && count < 2) score -= 2;
  score = clamp(score);
  rationale.push(score >= 7 ? "The copy names concrete workflow objects and actions." : "The copy needs more concrete objects, actions, or consequences from the evidence.");
  return score;
}

function scoreVoice(text: string, errors: string[], rationale: string[]): number {
  let score = 8 - errors.filter((error) => /jargon|Splay\.io/i.test(error)).length * 3;
  if (/\b(leverage|seamless|robust|innovative|unlock|ecosystem)\b/i.test(text)) score -= 2;
  if (averageSentenceLength(text) > 30) score -= 1;
  score = clamp(score);
  rationale.push(score >= 7 ? "The language is direct and avoids internal or generic AI phrasing." : "The voice still reads like positioning copy or a memo rather than a founder/operator post.");
  return score;
}

function scorePromotionBalance(text: string, intent: PostIntent | undefined, rationale: string[]): number {
  const index = text.toLowerCase().indexOf("splay");
  const hasProduct = index >= 0;
  let score = 8;
  if (intent?.product_role === "none" && hasProduct) score -= 3;
  if (intent?.product_role === "central" && !hasProduct) score -= 2;
  if (hasProduct && index < text.length * 0.35) score -= 2;
  if (/book a demo|schedule a call|get started/i.test(text)) score -= 3;
  score = clamp(score);
  rationale.push(score >= 7 ? "The product turn matches the post intent and follows reader value." : "The product appears too early, too heavily, or contrary to the intended editorial role.");
  return score;
}

function averageSentenceLength(text: string): number {
  const sentences = text.replace(/\s+/g, " ").split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  if (sentences.length === 0) return 0;
  return sentences.reduce((sum, sentence) => sum + sentence.split(/\s+/).length, 0) / sentences.length;
}

function clamp(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
