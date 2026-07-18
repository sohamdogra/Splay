import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "../config/loadEnv.ts";
import { getOutputDir } from "../config/runtimeMode.ts";
import { buildVisualBrief } from "../agents/visualBrief.ts";
import {
  appendVisualHistory,
  historyEntry,
  loadVisualHistory,
  selectVisualMetadata
} from "../agents/visualTemplateSelector.ts";
import { lockVisualToImageCopy, renderCuratedVisual } from "../render/socialVisualRenderer.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { loadPostPack, savePostPack } from "../storage/postStore.ts";
import type { CanvaImageRequest, GeneratedPost, VisualMetadata, VisualQaReport } from "../types/index.ts";
import {
  candidatePath,
  selectBestPassingCandidate,
  type BackgroundCandidate
} from "../visual/candidateSelector.ts";

type ImageMapEntry = BackgroundCandidate & {
  post_id?: string;
  id?: string;
  candidates?: BackgroundCandidate[];
};

loadEnv();

const mapPath = readArg("--map");
if (!mapPath) {
  console.error("Usage: attach-codex-images --map <post-image-map.json>");
  process.exit(1);
}

const outputDir = getOutputDir();
await mkdir(path.join(outputDir, "images"), { recursive: true });
await mkdir(path.join(outputDir, "canva-imports"), { recursive: true });

const pack = await loadPostPack();
const imageMap = await readImageMap(mapPath);
const visualHistory = await loadVisualHistory(outputDir);
const newHistory = [];
const qaReports: VisualQaReport[] = [];
const canvaRequests: CanvaImageRequest[] = [];
let attached = 0;
const stagingDirs: string[] = [];
const pendingArtifacts: Array<{
  stagingDir: string;
  rendered: { pngUrl: string; svgUrl: string; canvaImportHtml: string };
}> = [];

const posts: GeneratedPost[] = [];
try {
  for (const post of pack.posts) {
    const entry = imageMap.get(post.id);
    if (!entry) {
      posts.push(post);
      continue;
    }

    if (post.visual_treatment === "text_only") {
      throw new Error(`Post ${post.id} is intentionally text-only. Remove it from the background map or change visual_treatment after editorial review.`);
    }

    if (!post.image_copy?.headline?.trim() || !post.image_copy?.support?.trim()) {
      throw new Error(`Post ${post.id} has no gated image_copy. Re-import or regenerate the draft before attaching a background.`);
    }

    const selectedVisual = post.visual ?? selectVisualMetadata(await buildVisualBrief(post), `${post.id}:codex-imagegen`, visualHistory);
    const visual = lockVisualToImageCopy(post, selectedVisual);
    const selection = await selectBestPassingCandidate(normalizeCandidates(entry), async (candidate, index) => {
      const candidateFile = candidatePath(candidate);
      if (!candidateFile) throw new Error(`Image map candidate ${index + 1} for ${post.id} does not include a path.`);
      const backgroundImagePath = path.isAbsolute(candidateFile) ? candidateFile : path.resolve(outputDir, candidateFile);
      const stagingDir = await mkdtemp(path.join(os.tmpdir(), `splay-codex-${safeFilePart(post.id)}-${index + 1}-`));
      stagingDirs.push(stagingDir);
      await Promise.all(["images", "canva-imports"].map((dir) => mkdir(path.join(stagingDir, dir), { recursive: true })));
      const rendered = await renderCuratedVisual(post, visual, stagingDir, backgroundImagePath);
      return { rendered, stagingDir, backgroundImagePath };
    }, (result, candidate) => visualQaPreference(result.rendered.qa) + (candidate.preference_score ?? 0));
    const { rendered, stagingDir, backgroundImagePath } = selection.result;
    const prompt = selection.candidate.prompt ?? entry.prompt;
    const altText = selection.candidate.alt_text ?? entry.alt_text;
    const updated: GeneratedPost = {
      ...post,
      image_prompt: prompt ?? post.image_prompt ?? "Codex imagegen background with curated Splay text overlay.",
      image_url: rendered.imageUrl,
      image_provider: "codex-imagegen",
      alt_text: (altText ?? post.alt_text) || `Splay social graphic about ${post.topic.toLowerCase()}.`,
      image_notes: [
        ...(post.image_notes ?? []),
        ...selection.rejected.map((reason) => `Rejected generated background ${reason}.`),
        ...(selection.passingAlternatives ? [`Ranked ${selection.passingAlternatives + 1} QA-passing backgrounds by visual quality instead of accepting the first pass.`] : []),
        `Codex imagegen background attached from ${backgroundImagePath}.`,
        "Curated renderer preserved exact Splay logo, editable text layout, and visual QA."
      ],
      visual,
      visual_qa: rendered.qa
    };

    posts.push(updated);
    pendingArtifacts.push({ stagingDir, rendered });
    qaReports.push(rendered.qa);
    canvaRequests.push(buildCodexCanvaRequest(updated, visual, rendered, backgroundImagePath));
    const entryForHistory = historyEntry(post.id, post.created_at, visual);
    visualHistory.push(entryForHistory);
    newHistory.push(entryForHistory);
    attached += 1;
  }

  if (attached === 0) throw new Error("No post IDs in the image map matched the current post pack.");

  for (const artifact of pendingArtifacts) {
    await Promise.all([
      copyFile(path.join(artifact.stagingDir, artifact.rendered.pngUrl), path.join(outputDir, artifact.rendered.pngUrl)),
      copyFile(path.join(artifact.stagingDir, artifact.rendered.svgUrl), path.join(outputDir, artifact.rendered.svgUrl)),
      copyFile(path.join(artifact.stagingDir, artifact.rendered.canvaImportHtml), path.join(outputDir, artifact.rendered.canvaImportHtml))
    ]);
  }

  const updatedPack = { ...pack, posts };
  await savePostPack(updatedPack);
  await writeFile(path.join(outputDir, "visual-qa.json"), `${JSON.stringify(qaReports, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "canva-requests.json"), `${JSON.stringify(canvaRequests, null, 2)}\n`, "utf8");
  await appendVisualHistory(outputDir, newHistory);
  const previewPath = await renderPreview(updatedPack);

  console.log(`Attached ${attached} Codex image background(s).`);
  console.log(`Preview: ${previewPath}`);
} finally {
  await Promise.all(stagingDirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

async function readImageMap(filePath: string): Promise<Map<string, ImageMapEntry>> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const entries: ImageMapEntry[] = Array.isArray(raw)
    ? raw as ImageMapEntry[]
    : Array.isArray((raw as { images?: unknown }).images)
      ? (raw as { images: ImageMapEntry[] }).images
      : Object.entries(raw as Record<string, string | ImageMapEntry>).map(([post_id, value]) => {
          return typeof value === "string" ? { post_id, path: value } : { post_id, ...value };
        });

  return new Map(entries.flatMap((entry) => {
    const id = entry.post_id ?? entry.id;
    return id ? [[id, entry] as const] : [];
  }));
}

function normalizeCandidates(entry: ImageMapEntry): BackgroundCandidate[] {
  if (entry.candidates?.length) {
    return entry.candidates.map((candidate) => ({
      ...candidate,
      prompt: candidate.prompt ?? entry.prompt,
      alt_text: candidate.alt_text ?? entry.alt_text
    }));
  }
  return [{
    background_image_path: entry.background_image_path,
    image_path: entry.image_path,
    path: entry.path,
    prompt: entry.prompt,
    alt_text: entry.alt_text
  }];
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
}

function buildCodexCanvaRequest(
  post: GeneratedPost,
  visual: VisualMetadata,
  rendered: { imageUrl: string; svgUrl: string; canvaImportHtml: string; renderContract: CanvaImageRequest["render_contract"]; qa: VisualQaReport },
  backgroundImagePath: string
): CanvaImageRequest {
  return {
    post_id: post.id,
    platform: post.platform,
    design_type: post.platform === "x" ? "twitter_post" : "instagram_post",
    title: `${post.topic} - ${post.platform.toUpperCase()}`,
    canva_query: [
      "Use the QA-passed local PNG preview as the source of truth.",
      `Codex imagegen background: ${backgroundImagePath}.`,
      "Preserve the bundled official Splay SVG, bold sans headline, divider, and body as separate editable Canva layers.",
      "Do not add extra text, captions, icons, dashboards, charts, or decorative callouts."
    ].join(" "),
    visual_style: [
      "Use a near-black navy field, luminous company-blue bottom-quarter waves, white type, and restrained cobalt accents; never allow a gray-dominant card.",
      "Keep the bold sans headline and support line in one compact cluster with no large empty middle zone.",
      "Use subtle hairline rules, disciplined spacing, crisp rectangular UI silhouettes, and dark inset panels from the Splay design system.",
      "Use the generated background as atmosphere only; the official logo must be at least 64px and all logo/text geometry must remain exact."
    ],
    reference_asset_paths: [],
    background_image_path: backgroundImagePath,
    canva_import_html: rendered.canvaImportHtml,
    text_layers: {
      wordmark: "Splay",
      headline: visual.brief.headline,
      body: visual.brief.supporting_text
    },
    visual,
    alt_text: post.alt_text,
    local_preview: rendered.imageUrl,
    local_preview_png: rendered.imageUrl,
    local_preview_svg: rendered.svgUrl,
    render_contract: rendered.renderContract,
    qa: rendered.qa
  };
}

function visualQaPreference(qa: VisualQaReport): number {
  const value = (name: string): number => {
    const raw = qa.checks.find((check) => check.name === name)?.value;
    if (typeof raw === "number") return raw;
    const parsed = Number.parseFloat(String(raw ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return value("dark_blue_color_bias")
    + value("generated_background_visual_activity")
    + value("minimum_text_contrast") * 2
    + value("nonblank_pixel_variance") * 0.2
    - value("background_text_noise") * 2;
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
