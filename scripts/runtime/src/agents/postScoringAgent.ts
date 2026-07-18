import type { Platform, QualityScore } from "../types/index.ts";
import { evaluatePlatformStrategy } from "../strategy/platformStrategy.ts";

const SENSITIVE_TERMS = [
  "confidential",
  "do not share",
  "internal only",
  "nda",
  "customer private",
  "unreleased"
];

const AVOID_TERMS = [
  "revolutionize",
  "game changer",
  "cutting-edge",
  "unlock unprecedented",
  "ai-powered transformation"
];

export function sensitivityWarnings(text: string): string[] {
  return SENSITIVE_TERMS
    .filter((term) => new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`, "i").test(text))
    .map((term) => `Sensitive term detected: "${term}"`);
}

export function scorePost(platform: Platform, text: string, hashtags: string[], warnings: string[]): QualityScore {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? "";
  const lower = text.toLowerCase();
  const avoidHits = AVOID_TERMS.filter((term) => lower.includes(term)).length;
  const strategy = evaluatePlatformStrategy(platform, text, hashtags);

  const hook = clamp(6 + (firstLine.length <= 90 ? 2 : 0) + (firstLine.includes("?") || firstLine.includes(":") ? 1 : 0) + strategy.hookBonus - avoidHits);
  const clarity = clamp(7 + (lines.length >= 3 ? 1 : 0) + strategy.clarityBonus - avoidHits - (text.length > 2800 ? 2 : 0));
  const brandFit = clamp(8 + strategy.brandBonus - avoidHits - warnings.length);
  const platformFit = clamp(7 + strategy.platformBonus - strategy.platformPenalty);
  const overall = clamp(Math.round((hook + clarity + brandFit + platformFit) / 4));

  return { hook, clarity, brand_fit: brandFit, platform_fit: platformFit, overall };
}

function clamp(value: number): number {
  return Math.max(1, Math.min(10, value));
}
