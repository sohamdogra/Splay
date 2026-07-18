import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { BrandKit, BrandProfile, Campaign, CampaignSlot, CampaignStatus, Platform } from "../types/index.ts";

export type CreateCampaignInput = {
  name: string;
  brief: string;
  themes: string[];
  platforms: Platform[];
  start_at: string;
  timezone: string;
  interval_weeks: number;
  occurrences: number;
  creative: boolean;
};

const campaignsPath = () => path.join(getOutputDir(), "campaigns.json");
const brandKitPath = () => path.join(getOutputDir(), "brand-kit.json");

export async function listCampaigns(): Promise<Campaign[]> {
  try {
    const parsed = JSON.parse(await readFile(campaignsPath(), "utf8")) as Campaign[];
    return parsed
      .map((campaign) => ({ ...campaign, timezone: campaign.timezone || "UTC" }))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  } catch {
    return [];
  }
}

export async function getCampaign(id: string): Promise<Campaign | undefined> {
  return (await listCampaigns()).find((campaign) => campaign.id === id);
}

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const now = new Date().toISOString();
  const campaign: Campaign = {
    id: randomUUID(),
    ...input,
    status: "draft",
    generated_post_ids: [],
    created_at: now,
    updated_at: now
  };
  await writeCampaigns([campaign, ...(await listCampaigns())]);
  return campaign;
}

export async function updateCampaign(id: string, update: Partial<CreateCampaignInput> & {
  status?: CampaignStatus;
  generated_post_ids?: string[];
  last_error?: string;
}): Promise<Campaign> {
  const campaigns = await listCampaigns();
  let updated: Campaign | undefined;
  const next = campaigns.map((campaign) => {
    if (campaign.id !== id) return campaign;
    updated = { ...campaign, ...update, updated_at: new Date().toISOString() };
    if (!update.last_error) delete updated.last_error;
    return updated;
  });
  if (!updated) throw new Error(`Campaign not found: ${id}`);
  await writeCampaigns(next);
  return updated;
}

export function campaignSlots(campaign: Pick<Campaign, "brief" | "themes" | "start_at" | "timezone" | "interval_weeks" | "occurrences">): CampaignSlot[] {
  const start = new Date(campaign.start_at);
  return Array.from({ length: campaign.occurrences }, (_, index) => ({
    occurrence: index + 1,
    scheduled_for: weeklyOccurrence(start, campaign.timezone, index * campaign.interval_weeks).toISOString(),
    theme: campaign.themes[index % campaign.themes.length] || campaign.brief
  }));
}

function weeklyOccurrence(start: Date, timezone: string, weeks: number): Date {
  if (weeks === 0) return start;
  const base = zonedParts(start, timezone);
  const targetWallTime = Date.UTC(base.year, base.month - 1, base.day + weeks * 7, base.hour, base.minute, base.second) + start.getUTCMilliseconds();
  let guess = targetWallTime;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const actualWallTime = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second) + new Date(guess).getUTCMilliseconds();
    guess += targetWallTime - actualWallTime;
  }
  return new Date(guess);
}

function zonedParts(date: Date, timezone: string): Record<"year" | "month" | "day" | "hour" | "minute" | "second", number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

export async function loadBrandKit(): Promise<BrandKit> {
  try {
    return JSON.parse(await readFile(brandKitPath(), "utf8")) as BrandKit;
  } catch {
    return defaultBrandKit();
  }
}

export async function saveBrandKit(input: Omit<BrandKit, "version" | "updated_at">): Promise<BrandKit> {
  const current = await loadBrandKit();
  const next: BrandKit = {
    ...input,
    version: current.version + 1,
    updated_at: new Date().toISOString()
  };
  await mkdir(getOutputDir(), { recursive: true });
  await writeFile(brandKitPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function brandProfileFromKit(kit: BrandKit): BrandProfile {
  return {
    name: kit.name,
    audience: kit.audience,
    tone: kit.tone,
    positioning: kit.positioning,
    avoid: kit.avoid
  };
}

export function defaultBrandKit(): BrandKit {
  return {
    version: 1,
    updated_at: new Date(0).toISOString(),
    name: process.env.BRAND_NAME ?? "Splay",
    tagline: "Deal context that survives the close.",
    audience: process.env.BRAND_AUDIENCE ?? "private equity, investment banking, deal teams, founders, operators",
    tone: process.env.BRAND_TONE ?? "sharp, credible, founder-led, direct, thoughtful",
    positioning: "Splay reads deal work where it happens and turns it into reviewable next steps.",
    avoid: ["generic AI hype", "revolutionize", "game changer", "fake certainty", "too many emojis", "overexplaining"],
    colors: {
      primary: "#0F5EFF",
      secondary: "#0A3DB8",
      accent: "#DCE7FF",
      background: "#FBFCFE",
      text: "#1F2937"
    },
    typography: {
      heading_family: "Brawler",
      body_family: "Instrument Sans",
      heading_weight: 400,
      body_weight: 400,
      scale: "editorial"
    },
    logo_url: null
  };
}

async function writeCampaigns(campaigns: Campaign[]): Promise<void> {
  await mkdir(getOutputDir(), { recursive: true });
  await writeFile(campaignsPath(), `${JSON.stringify(campaigns, null, 2)}\n`, "utf8");
}
