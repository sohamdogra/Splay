import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type EditorialSpec = {
  version: string;
  source_policy: {
    restricted_slug_patterns: string[];
    corroboration_required_patterns: string[];
    internal_sensitivity_labels: string[];
  };
  public_copy: {
    banned_phrases: string[];
  };
  content_program: Record<string, number>;
  diversity: {
    lexical_warning_threshold: number;
    conceptual_warning_threshold: number;
    pain_capability_window: number;
    thesis_window: number;
    max_consecutive_narrative_shape: number;
  };
  review: {
    publish_floor: number;
    high_confidence_sample_size: number;
    metric_windows_hours: number[];
  };
  visual: {
    treatments: string[];
  };
};

const defaultSpecUrl = new URL("../../../../references/editorial-spec.json", import.meta.url);
const specPath = process.env.SOCIAL_AGENT_EDITORIAL_SPEC_PATH ?? fileURLToPath(defaultSpecUrl);

export const EDITORIAL_SPEC = JSON.parse(readFileSync(specPath, "utf8")) as EditorialSpec;
export const EDITORIAL_SPEC_VERSION = EDITORIAL_SPEC.version;

export function matchesSourcePattern(reference: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(reference));
}
