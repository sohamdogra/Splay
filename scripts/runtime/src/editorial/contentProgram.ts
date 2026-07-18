import type { ContentPillar, GBrainContextItem, PostIntent } from "../types/index.ts";
import { EDITORIAL_SPEC } from "./editorialSpec.ts";

export function buildPostIntent(item: GBrainContextItem | undefined, topic: string, index = 0): PostIntent {
  const pillar = pillarFor(item, index);
  const audience = audienceFor(`${topic} ${item?.summary ?? ""}`);
  const productRole = pillar === "product_proof" ? "central" : pillar === "workflow_observation" ? "supporting" : "none";
  const objective = pillar === "product_proof"
    ? "product_understanding"
    : pillar === "market_point_of_view" || pillar === "founder_lesson"
      ? "authority"
      : "education";
  return {
    audience_segment: audience,
    content_pillar: pillar,
    objective,
    desired_reader_response: desiredResponse(pillar),
    product_role: productRole
  };
}

export function defaultContentProgram(): Record<ContentPillar, number> {
  return { ...EDITORIAL_SPEC.content_program } as Record<ContentPillar, number>;
}

function pillarFor(item: GBrainContextItem | undefined, index: number): ContentPillar {
  const kind = item?.kind.toLowerCase() ?? "";
  if (kind.includes("product")) return "product_proof";
  if (kind.includes("customer")) return "workflow_observation";
  if (kind.includes("sales")) return "operator_insight";
  if (kind.includes("founder")) return "founder_lesson";
  if (kind.includes("competitor") || kind.includes("market")) return "market_point_of_view";
  const rotation: ContentPillar[] = ["workflow_observation", "operator_insight", "product_proof", "founder_lesson", "market_point_of_view"];
  return rotation[index % rotation.length];
}

function audienceFor(text: string): string {
  if (/customer|buyer|user|client/i.test(text)) return "customers and prospective customers";
  if (/founder|operator|leader/i.test(text)) return "founders and operators";
  return "the configured company audience";
}

function desiredResponse(pillar: ContentPillar): string {
  if (pillar === "product_proof") return "Understand one concrete Splay behavior and where it fits.";
  if (pillar === "workflow_observation") return "Recognize a costly coordination problem in their own work.";
  if (pillar === "operator_insight") return "Leave with a practical way to evaluate the workflow.";
  if (pillar === "founder_lesson") return "See the operating lesson behind how Splay is being built.";
  return "Reconsider a common assumption about the category.";
}
