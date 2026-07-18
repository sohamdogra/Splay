import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getPrisma, isDatabaseConfigured } from "../db/prisma.ts";
import type {
  VisualBrief,
  VisualDensity,
  VisualMetadata,
  VisualMotif,
  VisualPalette,
  VisualTemplateFamily
} from "../types/index.ts";

export type VisualHistoryEntry = {
  post_id: string;
  created_at: string;
  template_family: VisualTemplateFamily;
  density: VisualDensity;
  palette: VisualPalette;
  motif: VisualMotif;
};

type TemplateDefinition = {
  family: VisualTemplateFamily;
  density: VisualDensity;
  palette: VisualPalette;
  motif: VisualMotif;
  eligible: (brief: VisualBrief, approvedAsset?: string | null) => boolean;
};

const definitions: TemplateDefinition[] = [
  definition("dark-editorial-thesis", "simple", "charcoal", "citation-rail", () => true),
  definition("light-minimal-thesis", "simple", "mist", "quiet-geometry", () => true),
  definition("split-contrast", "structured", "split", "split-plane", (brief) => Boolean(brief.contrast)),
  definition("source-evidence-card", "structured", "charcoal", "document-fragments", (brief) => Boolean(brief.supporting_text)),
  definition("three-point-principles", "structured", "mist", "numbered-stack", (brief) => brief.points.length === 3),
  definition("three-step-workflow", "complex", "charcoal", "source-trail", (brief) => brief.steps.length === 3),
  definition("relationship-source-map", "complex", "split", "node-map", (brief) => brief.points.length >= 3 || brief.steps.length >= 3),
  definition("product-proof", "complex", "charcoal", "product-frame", (_brief, asset) => Boolean(asset))
];

// The current Splay campaign keeps layout variety while holding one recognizable
// dark-blue visual system. Light and split templates remain renderable for legacy
// packs, but new compatibility renders select from the charcoal set only.
const campaignDefinitions = definitions.filter((item) => item.palette === "charcoal");

const densityTargets: Record<VisualDensity, number> = {
  simple: 0.3,
  structured: 0.5,
  complex: 0.2
};

export function selectVisualMetadata(
  brief: VisualBrief,
  seed: string,
  history: VisualHistoryEntry[],
  approvedAsset?: string | null
): VisualMetadata {
  const recent = history.slice(-12);
  const eligible = campaignDefinitions.filter((item) => item.eligible(brief, approvedAsset));
  const lastFamily = recent.at(-1)?.template_family;
  const withoutImmediateRepeat = eligible.filter((item) => item.family !== lastFamily);
  const candidates = withoutImmediateRepeat.length > 0 ? withoutImmediateRepeat : eligible;
  const counts = countDensities(recent);
  const nextSize = recent.length + 1;

  const ranked = candidates.map((item) => {
    const densityDeficit = densityTargets[item.density] * nextSize - counts[item.density];
    const familyFrequency = recent.filter((entry) => entry.template_family === item.family).length;
    const paletteFrequency = recent.slice(-5).filter((entry) => entry.palette === item.palette).length;
    const motifFrequency = recent.slice(-8).filter((entry) => entry.motif === item.motif).length;
    const modeFit = contentModeFit(brief, item.family);
    return {
      item,
      score: densityDeficit * 100 + modeFit * 18 - familyFrequency * 16 - paletteFrequency * 5 - motifFrequency * 4,
      tie: seededRank(seed, item.family)
    };
  }).sort((left, right) => right.score - left.score || left.tie - right.tie);

  const selected = ranked[0]?.item ?? definitions[0];
  return {
    template_family: selected.family,
    density: selected.density,
    palette: selected.palette,
    motif: selected.motif,
    brief
  };
}

export async function loadVisualHistory(outputDir: string): Promise<VisualHistoryEntry[]> {
  const [fileHistory, databaseHistory] = await Promise.all([
    loadFileHistory(outputDir),
    loadDatabaseHistory()
  ]);
  const entries = [...databaseHistory, ...fileHistory];
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.post_id)) return false;
    seen.add(entry.post_id);
    return true;
  }).sort((left, right) => left.created_at.localeCompare(right.created_at));
}

async function loadFileHistory(outputDir: string): Promise<VisualHistoryEntry[]> {
  try {
    const raw = await readFile(path.join(outputDir, "visual-history.jsonl"), "utf8");
    return raw.split("\n").filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as VisualHistoryEntry];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function loadDatabaseHistory(): Promise<VisualHistoryEntry[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const prisma = await getPrisma();
    const rows = await (prisma.socialPost as any).findMany({
      where: { mediaMetadata: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, localPostId: true, createdAt: true, mediaMetadata: true }
    });
    return rows.flatMap((row: Record<string, unknown>) => {
      const media = asRecord(row.mediaMetadata);
      const visual = asRecord(media.visual);
      if (!isTemplateFamily(visual.template_family) || !isDensity(visual.density) || !isPalette(visual.palette) || !isMotif(visual.motif)) return [];
      return [{
        post_id: String(row.localPostId ?? row.id ?? ""),
        created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
        template_family: visual.template_family,
        density: visual.density,
        palette: visual.palette,
        motif: visual.motif
      }];
    });
  } catch {
    return [];
  }
}

export async function appendVisualHistory(outputDir: string, entries: VisualHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await mkdir(outputDir, { recursive: true });
  const existing = await loadVisualHistory(outputDir);
  const knownIds = new Set(existing.map((entry) => entry.post_id));
  const additions = entries.filter((entry) => !knownIds.has(entry.post_id));
  if (additions.length === 0) return;
  await appendFile(
    path.join(outputDir, "visual-history.jsonl"),
    `${additions.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );
}

export function historyEntry(postId: string, createdAt: string, visual: VisualMetadata): VisualHistoryEntry {
  return {
    post_id: postId,
    created_at: createdAt,
    template_family: visual.template_family,
    density: visual.density,
    palette: visual.palette,
    motif: visual.motif
  };
}

function definition(
  family: VisualTemplateFamily,
  density: VisualDensity,
  palette: VisualPalette,
  motif: VisualMotif,
  eligible: TemplateDefinition["eligible"]
): TemplateDefinition {
  return { family, density, palette, motif, eligible };
}

function countDensities(history: VisualHistoryEntry[]): Record<VisualDensity, number> {
  return history.reduce<Record<VisualDensity, number>>((counts, item) => {
    counts[item.density] += 1;
    return counts;
  }, { simple: 0, structured: 0, complex: 0 });
}

function contentModeFit(brief: VisualBrief, family: VisualTemplateFamily): number {
  const preferred: Partial<Record<VisualBrief["content_mode"], VisualTemplateFamily[]>> = {
    thesis: ["dark-editorial-thesis", "light-minimal-thesis"],
    contrast: ["split-contrast"],
    evidence: ["source-evidence-card"],
    principles: ["three-point-principles", "relationship-source-map"],
    workflow: ["three-step-workflow", "relationship-source-map"],
    relationship: ["relationship-source-map", "three-point-principles"]
  };
  return preferred[brief.content_mode]?.includes(family) ? 2 : 0;
}

function seededRank(seed: string, value: string): number {
  let hash = 17;
  for (const char of `${seed}:${value}`) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isTemplateFamily(value: unknown): value is VisualTemplateFamily {
  return definitions.some((item) => item.family === value);
}

function isDensity(value: unknown): value is VisualDensity {
  return ["simple", "structured", "complex"].includes(String(value));
}

function isPalette(value: unknown): value is VisualPalette {
  return ["charcoal", "mist", "split"].includes(String(value));
}

function isMotif(value: unknown): value is VisualMotif {
  return definitions.some((item) => item.motif === value);
}
