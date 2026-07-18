import type {
  EditorialAngle,
  EditorialCandidateSummary,
  EditorialContext,
  Platform,
  PostIntent,
  ProductRole,
  SourceContext,
  TopicIdea
} from "../types/index.ts";
import type { ConceptualReference } from "./contentFingerprint.ts";
import { editorialCompositeScore, evaluateEditorialDraft } from "./editorialReview.ts";

export type AngleBrief = {
  angle: EditorialAngle;
  thesis: string;
  reader_takeaway: string;
  product_role: ProductRole;
  hook_direction: string;
};

export type DraftCandidate = {
  text: string;
  hashtags: string[];
  angle: EditorialAngle;
  thesis?: string;
  readerTakeaway?: string;
};

export type TournamentResult = {
  selected: DraftCandidate;
  summaries: EditorialCandidateSummary[];
  evaluation: ReturnType<typeof evaluateEditorialDraft>["evaluation"];
  fingerprint: ReturnType<typeof evaluateEditorialDraft>["fingerprint"];
};

export function buildAngleBriefs(idea: TopicIdea): AngleBrief[] {
  const context = idea.editorial_context;
  const pain = context?.audience_pain ?? idea.source_context.summary;
  const behavior = context?.observed_behavior ?? idea.topic;
  const object = context?.concrete_object ?? "work item";
  return [
    {
      angle: "operator_observation",
      thesis: pain,
      reader_takeaway: `Recognize where the ${object} creates avoidable reconstruction work.`,
      product_role: idea.post_intent?.content_pillar === "product_proof" ? "supporting" : idea.post_intent?.product_role ?? "supporting",
      hook_direction: `Open on the moment the ${object} stops matching the work.`
    },
    {
      angle: "boundary_condition",
      thesis: `The useful boundary is not whether the task can be automated, but whether ${behavior.toLowerCase()}.`,
      reader_takeaway: "Leave with a sharper test or limitation they can apply to similar software.",
      product_role: "none",
      hook_direction: "Open with a tradeoff, limitation, or counterexample instead of the product."
    },
    {
      angle: "product_proof",
      thesis: context?.public_safe_claim ?? idea.topic,
      reader_takeaway: "Understand one concrete behavior and the review point before anything changes.",
      product_role: "central",
      hook_direction: `Open with the source artifact or workflow event; introduce Splay only after the consequence is clear.`
    }
  ];
}

export function runEditorialTournament(input: {
  platform: Platform;
  topic: string;
  sourceContext: SourceContext;
  editorialContext: EditorialContext;
  postIntent?: PostIntent;
  candidates: DraftCandidate[];
  recentPosts?: ConceptualReference[];
  evidenceSupplied?: boolean;
}): TournamentResult {
  if (input.candidates.length === 0) throw new Error("Editorial tournament requires at least one candidate.");

  const evaluated = input.candidates.map((candidate, index) => {
    const intendedRole = input.postIntent?.product_role ?? "supporting";
    const candidateRole = candidate.angle === "boundary_condition" ? "none" : candidate.angle === "product_proof" ? "central" : intendedRole;
    const review = evaluateEditorialDraft({
      platform: input.platform,
      topic: input.topic,
      text: candidate.text,
      hashtags: candidate.hashtags,
      sourceContext: input.sourceContext,
      editorialContext: input.editorialContext,
      postIntent: { ...(input.postIntent ?? fallbackIntent()), product_role: candidateRole },
      recentPosts: input.recentPosts,
      evidenceSupplied: input.evidenceSupplied
    });
    const penalty = alignmentPenalty(intendedRole, candidateRole);
    const adjustedReview = penalty >= 2 && review.evaluation.editorial_review.verdict === "publish"
      ? {
          ...review,
          evaluation: {
            ...review.evaluation,
            editorial_review: {
              ...review.evaluation.editorial_review,
              verdict: "revise" as const,
              rationale: [...review.evaluation.editorial_review.rationale, `The candidate's product role (${candidateRole}) conflicts with the content-program intent (${intendedRole}).`]
            }
          }
        }
      : review;
    return {
      candidate,
      review: adjustedReview,
      index,
      score: Math.round((editorialCompositeScore(adjustedReview.evaluation) - penalty) * 10) / 10
    };
  }).sort((left, right) => verdictRank(right.review.evaluation.editorial_review.verdict) - verdictRank(left.review.evaluation.editorial_review.verdict)
    || right.score - left.score
    || left.index - right.index);

  const winner = evaluated[0];
  const summaries = evaluated.map((item) => ({
    id: `candidate-${item.index + 1}`,
    angle: item.candidate.angle,
    thesis: item.candidate.thesis ?? firstSentence(item.candidate.text),
    reader_takeaway: item.candidate.readerTakeaway ?? "Deliver one supported, useful takeaway.",
    product_role: item.candidate.angle === "boundary_condition" ? "none" : item.candidate.angle === "product_proof" ? "central" : input.postIntent?.product_role ?? "supporting",
    hook: firstLine(item.candidate.text),
    text: item.candidate.text,
    hashtags: item.candidate.hashtags,
    score: item.score,
    verdict: item.review.evaluation.editorial_review.verdict,
    selected: item === winner,
    rationale: item.review.evaluation.editorial_review.rationale
  } satisfies EditorialCandidateSummary));

  return {
    selected: winner.candidate,
    summaries,
    evaluation: winner.review.evaluation,
    fingerprint: winner.review.fingerprint
  };
}

function verdictRank(value: "publish" | "revise" | "reject"): number {
  return value === "publish" ? 3 : value === "revise" ? 2 : 1;
}

function alignmentPenalty(intended: ProductRole, candidate: ProductRole): number {
  if (intended === candidate) return 0;
  if ((intended === "none" && candidate === "central") || (intended === "central" && candidate === "none")) return 2;
  return 0.8;
}

function fallbackIntent(): PostIntent {
  return {
    audience_segment: "the configured company audience",
    content_pillar: "workflow_observation",
    objective: "education",
    desired_reader_response: "Recognize one concrete workflow tension.",
    product_role: "supporting"
  };
}

function firstLine(value: string): string {
  return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function firstSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).find(Boolean) ?? value.trim();
}
