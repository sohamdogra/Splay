import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../config/loadEnv.ts";
import { findInternalJargon } from "../editorial/editorialGate.ts";
import { getOutputDir } from "../config/runtimeMode.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { loadPostPack, savePostPack } from "../storage/postStore.ts";
import type { GeneratedPost, VisualQaReport } from "../types/index.ts";
import { evaluateFinalImageContract, FINAL_IMAGE_HEIGHT, FINAL_IMAGE_WIDTH } from "../visual/finalImageContract.ts";

type ImageMapEntry = {
  post_id?: string;
  id?: string;
  image_path?: string;
  path?: string;
  prompt?: string;
  alt_text?: string;
};

loadEnv();

const mapPath = readArg("--map");
if (!mapPath) {
  console.error("Usage: attach-final-images --map <post-final-image-map.json> --allow-legacy-final-images");
  process.exit(1);
}
if (!process.argv.includes("--allow-legacy-final-images")) {
  console.error(`Legacy final-image attachment is disabled by default because it cannot guarantee exact logo geometry or editable gated copy. Use background-only generation plus attach-codex-images. Pass --allow-legacy-final-images only for manually composed ${FINAL_IMAGE_WIDTH}x${FINAL_IMAGE_HEIGHT} PNG artwork built from the official source assets.`);
  process.exit(1);
}

const outputDir = getOutputDir();
await mkdir(path.join(outputDir, "images"), { recursive: true });

const pack = await loadPostPack();
const imageMap = await readImageMap(mapPath);
let attached = 0;

const posts: GeneratedPost[] = [];
for (const post of pack.posts) {
  const entry = imageMap.get(post.id);
  if (!entry) {
    posts.push(post);
    continue;
  }

  const sourcePath = entry.image_path ?? entry.path;
  if (!sourcePath) throw new Error(`Image map entry for ${post.id} does not include a path.`);
  const extension = normalizedRasterExtension(sourcePath);
  const fileName = `${post.id}${extension}`;
  const relativeImage = `images/${fileName}`;
  const destinationPath = path.join(outputDir, relativeImage);
  await copyFile(sourcePath, destinationPath);

  const dimensions = await readPngDimensions(destinationPath);
  const qa = buildFinalImageQa(post.id, relativeImage, dimensions, entry.prompt ?? "");
  const editorialNotes = editorialImageNotes(post, entry);
  for (const note of editorialNotes) console.warn(`[editorial] ${post.id}: ${note}`);

  posts.push({
    ...post,
    image_prompt: entry.prompt ?? post.image_prompt ?? "Codex imagegen final social post artwork.",
    image_url: relativeImage,
    image_provider: "codex-imagegen",
    canva_design_url: null,
    alt_text: (entry.alt_text ?? post.alt_text) || `Splay social graphic about ${post.topic.toLowerCase()}.`,
    image_notes: [
      ...(post.image_notes ?? []),
      `Full Codex imagegen final artwork attached from ${sourcePath}.`,
      "Canva/compositor path bypassed for this asset; the image itself is the review and publishing source.",
      ...editorialNotes
    ],
    visual_qa: qa
  });
  attached += 1;
}

if (attached === 0) {
  console.error("No post IDs in the final-image map matched the current post pack.");
  process.exit(1);
}

const updatedPack = { ...pack, posts };
await savePostPack(updatedPack);
await rm(path.join(outputDir, "canva-requests.json"), { force: true });
await rm(path.join(outputDir, "canva-imports"), { recursive: true, force: true });
const previewPath = await renderPreview(updatedPack);

console.log(`Attached ${attached} final Codex image(s).`);
console.log(`Preview: ${previewPath}`);

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

function normalizedRasterExtension(filePath: string): ".png" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return ext;
  throw new Error(`Legacy final image must be an exact ${FINAL_IMAGE_WIDTH}x${FINAL_IMAGE_HEIGHT} PNG so dimensions can be verified: ${filePath}`);
}

async function readPngDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const buffer = await readFile(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return { width: 0, height: 0 };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function editorialImageNotes(post: GeneratedPost, entry: ImageMapEntry): string[] {
  const notes: string[] = [];
  const prompt = entry.prompt ?? "";

  if (post.image_copy?.headline) {
    if (prompt && !prompt.toLowerCase().includes(post.image_copy.headline.toLowerCase())) {
      notes.push(`Editorial check: image prompt does not contain the gated headline "${post.image_copy.headline}". Confirm the rendered image uses the approved copy.`);
    }
  } else {
    notes.push("Editorial check: post has no gated image_copy; the rendered image text was never validated.");
  }

  for (const phrase of findInternalJargon(prompt)) {
    notes.push(`Editorial check: image prompt contains internal jargon "${phrase}". If it appears as rendered text, regenerate the image.`);
  }

  return notes;
}

function buildFinalImageQa(
  postId: string,
  imagePath: string,
  dimensions: { width: number; height: number },
  prompt: string
): VisualQaReport {
  const contract = evaluateFinalImageContract(dimensions, prompt);
  return {
    post_id: postId,
    ok: contract.ok,
    checked_at: new Date().toISOString(),
    png_path: imagePath,
    svg_path: "",
    html_path: "",
    dimensions,
    pixel_diff: 0,
    checks: [
      { name: "final_image_attached", ok: true, value: true },
      { name: "canva_compositor_bypassed", ok: true, value: true },
      { name: "minimum_raster_dimensions", ok: contract.dimensionsOk, value: `${dimensions.width}x${dimensions.height}` },
      { name: "target_16_9_aspect_ratio", ok: contract.aspectRatioOk, value: `${contract.aspectRatio.toFixed(3)} (target ${FINAL_IMAGE_WIDTH}x${FINAL_IMAGE_HEIGHT})` },
      { name: "dark_blue_wave_prompt", ok: contract.stylePromptOk, value: contract.stylePromptOk }
    ]
  };
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
