let cachedCreativeSeed: string | null = null;

export function isCreativeMode(): boolean {
  return truthy(process.env.SOCIAL_AGENT_CREATIVE_MODE);
}

export function creativeRunSeed(): string {
  const configured = process.env.SOCIAL_AGENT_CREATIVE_SEED?.trim();
  if (configured) return configured;
  if (cachedCreativeSeed) return cachedCreativeSeed;

  cachedCreativeSeed = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
  return cachedCreativeSeed;
}

export function textTemperature(): number | undefined {
  const configured = process.env.SOCIAL_AGENT_TEXT_TEMPERATURE?.trim();
  if (configured) {
    const parsed = Number(configured);
    return Number.isFinite(parsed) ? clamp(parsed, 0, 2) : undefined;
  }
  return isCreativeMode() ? 0.95 : undefined;
}

export function shouldUseUniqueImagesPerPost(): boolean {
  if (truthy(process.env.SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST)) return true;
  if (process.env.SOCIAL_AGENT_SHARE_IMAGES === "1") return false;
  return isCreativeMode();
}

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
