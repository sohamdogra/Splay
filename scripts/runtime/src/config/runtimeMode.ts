import path from "node:path";

export function isTestMode(): boolean {
  return process.env.SOCIAL_AGENT_TEST_MODE === "1";
}

export function getOutputDir(): string {
  if (isTestMode()) return path.join("output", "test");
  return process.env.SOCIAL_AGENT_OUTPUT_DIR?.trim() || "output";
}
