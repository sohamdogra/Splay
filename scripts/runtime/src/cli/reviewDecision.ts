import { renderPreview } from "../render/previewRenderer.ts";
import { getOutputDir } from "../config/runtimeMode.ts";
import { recordReviewDecision } from "../storage/postStore.ts";
import type { ReviewDecisionReason } from "../types/index.ts";

const reasonCodes: ReviewDecisionReason[] = [
  "strong_insight",
  "strong_proof",
  "good_voice",
  "too_generic",
  "too_promotional",
  "repetitive",
  "unsupported",
  "wrong_audience",
  "different_angle",
  "visual_not_useful",
  "approved_without_note"
];

const id = readArg("--id");
const decision = readArg("--decision");
const reason = readArg("--reason");
const note = readArg("--note");

if (!id || !isDecision(decision) || !isReason(reason)) {
  console.error("Usage: decide --id <post_id> --decision <approve|revise|reject> --reason <reason_code> [--note <text>]");
  console.error(`Reason codes: ${reasonCodes.join(", ")}`);
  process.exit(1);
}

try {
  const pack = await recordReviewDecision(id, decision, reason, note);
  await renderPreview(pack);
  console.log(`Recorded ${decision} decision for ${id}: ${reason}`);
  console.log(`Preview refreshed: ${getOutputDir()}/latest-preview.html`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function isDecision(value: unknown): value is "approve" | "revise" | "reject" {
  return ["approve", "revise", "reject"].includes(String(value));
}

function isReason(value: unknown): value is ReviewDecisionReason {
  return reasonCodes.includes(value as ReviewDecisionReason);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
