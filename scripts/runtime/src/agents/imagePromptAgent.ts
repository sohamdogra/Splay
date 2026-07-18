import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { creativeRunSeed, isCreativeMode, shouldUseUniqueImagesPerPost } from "../config/creativeMode.ts";
import { INTERNAL_JARGON_PHRASES } from "../editorial/editorialGate.ts";
import { getOutputDir } from "../config/runtimeMode.ts";
import { lockVisualToImageCopy, renderCuratedVisual } from "../render/socialVisualRenderer.ts";
import { FINAL_IMAGE_HEIGHT, FINAL_IMAGE_WIDTH } from "../visual/finalImageContract.ts";
import type { CanvaImageRequest, GeneratedPost, RenderContract, VisualMetadata, VisualQaReport } from "../types/index.ts";
import { buildVisualBrief } from "./visualBrief.ts";
import {
  appendVisualHistory,
  historyEntry,
  loadVisualHistory,
  selectVisualMetadata,
  type VisualHistoryEntry
} from "./visualTemplateSelector.ts";

const SPLAY_VISUAL_STYLE = [
  "Use the SPLAY references as a mood and quality bar, not as templates to copy.",
  "Vary composition across posts while preserving one recognizable campaign system: dark navy-blue depth, layered flowing wave forms, white typography, and one restrained cobalt accent.",
  "Use a deep navy-blue and Charcoal #1F2937 field across 75-85% of the canvas. Use company blue #60A5FA for layered wave contours and cool depth. Keep White #FFFFFF and Mist #F3F6FA for type, and limit Splay Blue #0F5EFF to 3-5% as one small accent.",
  "Never use a light gray, beige, washed-out charcoal, or washed-out neutral field as the dominant background. The dark blue base must be unmistakable, with luminous blue and crisp cobalt wave energy rather than flat gray panels.",
  "Avoid blue-purple AI gradients, neon cyan/teal glow fields, neon brains, robots, holograms, fake dashboards, generic charts, and decorative tech clutter.",
  "Use bold Instrument Sans/Inter-style sans typography for the main headline and supporting copy. Do not use a large serif headline in the standard campaign layout.",
  "Favor clean editorial cues, document fragments, fine node-line patterns derived from the logo, Outlook-native workflow hints, and quiet architectural geometry.",
  "Borrow the Splay design-system discipline: thin hairline rules, compact modular spacing, crisp rectangular UI silhouettes, small blue actions, and dark inset panels. Keep these cues subtle and secondary to the social headline.",
  "Keep the composition calm but visually active: one useful message, controlled negative space, a compact headline/support cluster, luminous layered blue waves across the bottom quarter, and one restrained cobalt highlight.",
  `Use a ${FINAL_IMAGE_WIDTH}x${FINAL_IMAGE_HEIGHT} (16:9) widescreen social-card canvas; do not generate a portrait or square composition.`,
  "Keep image text compact, concrete, and scannable: one headline of 3-8 words, one support line of 5-12 words, and no extra text callouts beyond the curated template layers.",
  `Avoid public-facing jargon and internal positioning language such as ${INTERNAL_JARGON_PHRASES.join(", ")}.`,
  "Use a 96px horizontal safe-area gutter and a 54px vertical safe-area gutter. Keep the support line 28-100px below the fitted headline block so the short canvas remains compact and readable.",
  "Use the bundled official Splay fan SVG at no less than 64px on a 1200px-wide canvas, with a 30px-or-larger Splay wordmark. Never redraw, approximate, or ask an image model to generate the logo.",
  "Keep the final message text and small body copy as editable Canva text layers whenever possible.",
  "Use the official Splay fan mark with Splay as the consistent brand signature. Do not use Splay.io in social creative."
];

type ImageMode = "canva" | "gpt-canva" | "placeholder";

type ImageAssetResult = {
  imageUrl: string;
  pngUrl: string;
  svgUrl: string;
  backgroundImagePath: string | null;
  canvaImportHtml: string;
  renderContract: RenderContract;
  qa: VisualQaReport;
  notes: string[];
};

type SharedImageAsset = {
  prompt: string;
  altText: string;
  asset: ImageAssetResult;
  provider: ImageMode;
  ownerPostId: string;
  visual: VisualMetadata;
};

export async function attachImages(posts: GeneratedPost[], outputDir = getOutputDir()): Promise<GeneratedPost[]> {
  await mkdir(path.join(outputDir, "images"), { recursive: true });
  await mkdir(path.join(outputDir, "canva-imports"), { recursive: true });
  const updated: GeneratedPost[] = [];
  const canvaRequests: CanvaImageRequest[] = [];
  const visualQaReports: VisualQaReport[] = [];
  const referenceAssetPaths = await getReferenceAssetPaths();
  const imageAssetsByIdea = new Map<string, SharedImageAsset>();
  const visualHistory = await loadVisualHistory(outputDir);
  const newHistory: VisualHistoryEntry[] = [];
  const uniqueImagesPerPost = shouldUseUniqueImagesPerPost();
  const creativeSeed = creativeRunSeed();

  for (const post of posts) {
    if (post.visual_treatment === "text_only") {
      updated.push({
        ...post,
        image_prompt: "",
        image_url: "",
        image_provider: "placeholder",
        alt_text: "",
        image_notes: [...(post.image_notes ?? []), "Editorial program selected a text-only treatment for this post."],
        visual: undefined,
        visual_qa: undefined
      });
      continue;
    }
    const groupKey = uniqueImagesPerPost ? imagePostKey(post, creativeSeed) : imageGroupKey(post);
    let sharedImage = imageAssetsByIdea.get(groupKey);

    if (!sharedImage) {
      const image_provider = getImageMode();
      const brief = await buildVisualBrief(post);
      const approvedVisualAsset = await existingApprovedVisualAsset(post.approved_visual_asset);
      const visualSeed = isCreativeMode() ? `${post.id}:${post.platform}:${creativeSeed}` : post.id;
      const selectedVisual = selectVisualMetadata(brief, visualSeed, visualHistory, approvedVisualAsset);
      const visual = lockVisualToImageCopy(post, selectedVisual);
      const visualPost = approvedVisualAsset === post.approved_visual_asset
        ? post
        : { ...post, approved_visual_asset: approvedVisualAsset };
      const image_prompt = image_provider === "gpt-canva"
        ? buildGptBackgroundPrompt(post, referenceAssetPaths, visual)
        : buildImagePrompt(post, visual);
      const alt_text = buildAltText(post, visual);
      const imageAsset = image_provider === "gpt-canva"
        ? await createGptCanvaAssets(visualPost, image_prompt, outputDir, visual)
        : await createCuratedAssets(visualPost, outputDir, visual);

      sharedImage = {
        prompt: image_prompt,
        altText: alt_text,
        asset: imageAsset,
        provider: image_provider,
        ownerPostId: post.id,
        visual
      };
      imageAssetsByIdea.set(groupKey, sharedImage);
      visualQaReports.push(imageAsset.qa);
      const entry = historyEntry(post.id, post.created_at, visual);
      visualHistory.push(entry);
      newHistory.push(entry);

      if (image_provider === "canva" || image_provider === "gpt-canva") {
        canvaRequests.push(buildCanvaRequest(post, image_prompt, alt_text, imageAsset, referenceAssetPaths, visual));
      }
    }

    const sharedNote = post.id === sharedImage.ownerPostId
      ? []
      : [`Uses shared image generated for ${sharedImage.ownerPostId}.`];

    updated.push({
      ...post,
      image_prompt: sharedImage.prompt,
      alt_text: sharedImage.altText,
      image_url: sharedImage.asset.imageUrl,
      image_provider: sharedImage.provider,
      canva_design_url: null,
      warnings: post.warnings,
      image_notes: sharedImage.provider === "canva" || sharedImage.provider === "gpt-canva"
        ? [...sharedImage.asset.notes, getCanvaNote(sharedImage.provider), ...sharedNote]
        : [...sharedImage.asset.notes, ...sharedNote],
      visual: sharedImage.visual,
      visual_qa: sharedImage.asset.qa
    });
  }

  if (canvaRequests.length > 0) {
    await writeFile(path.join(outputDir, "canva-requests.json"), `${JSON.stringify(canvaRequests, null, 2)}\n`, "utf8");
  }
  if (visualQaReports.length > 0) {
    await writeFile(path.join(outputDir, "visual-qa.json"), `${JSON.stringify(visualQaReports, null, 2)}\n`, "utf8");
  }
  await appendVisualHistory(outputDir, newHistory);

  return updated;
}

function imageGroupKey(post: GeneratedPost): string {
  return [
    post.topic,
    post.source_context.summary,
    ...post.source_context.gbrain_references
  ].join("\n");
}

function imagePostKey(post: GeneratedPost, creativeSeed: string): string {
  return [
    imageGroupKey(post),
    post.platform,
    post.id,
    creativeSeed
  ].join("\n");
}

async function existingApprovedVisualAsset(value: string | null | undefined): Promise<string | null> {
  if (!value || !path.isAbsolute(value)) return null;
  try {
    return (await stat(value)).isFile() ? value : null;
  } catch {
    return null;
  }
}

function buildImagePrompt(post: GeneratedPost, visual: VisualMetadata): string {
  return [
    "Create a Splay startup social image brief.",
    `Topic: ${post.topic}.`,
    `Approved template: ${visual.template_family}; density: ${visual.density}; palette: ${visual.palette}; motif: ${visual.motif}.`,
    ...creativeVisualInstructions(post, visual),
    ...SPLAY_VISUAL_STYLE,
    "The references guide design philosophy only. Vary the layout and wave geometry, but keep the same dark-blue color balance and recurring flowing-wave signature."
  ].join(" ");
}

function buildGptBackgroundPrompt(post: GeneratedPost, referenceAssetPaths: string[], visual: VisualMetadata): string {
  return [
    "Generate a premium abstract background plate for a Splay social post.",
    "This is background artwork only. Do not render words, letters, logos, brand marks, symbols, captions, UI text, numbers, or a visible headline.",
    "The final headline and official mark plus Splay signature will be added later by the curated layout.",
    `Compose the background for a final ${FINAL_IMAGE_WIDTH}x${FINAL_IMAGE_HEIGHT} (16:9) crop; do not build a portrait or square composition.`,
    `Topic guiding the mood: ${post.topic}.`,
    `Visual direction: ${visual.motif} using the ${visual.palette} palette for the ${visual.template_family} curated layout.`,
    ...creativeVisualInstructions(post, visual),
    "Design philosophy: serious enterprise intelligence, deal workflow memory, founder-led judgment, modern private-market operating systems.",
    "Use depth, atmosphere, focus, high contrast, and quiet restraint. Keep clean negative space where text can sit.",
    "Use a near-black dark navy-blue plus Charcoal #1F2937 base, luminous layered flowing waves in company blue #60A5FA, and only a small 3-5% Splay Blue #0F5EFF accent. Keep the bottom quarter visually active and never create a gray or washed-out neutral dominant field.",
    "Do not copy the local SPLAY references exactly; use them only as a quality bar for palette discipline, editorial polish, source-citation motifs, and institutional restraint.",
    referenceAssetPaths.length > 0
      ? `Local style references available to the downstream Canva step: ${referenceAssetPaths.join(", ")}.`
      : "No local SPLAY reference exports were found.",
    "Avoid fake dashboards, robot imagery, icons, charts, literal paperwork, stock-photo hands, office scenes, beige templates, blue-purple AI gradients, neon cyan glow fields, and decorative clutter.",
    "Vary spatial rhythm from other posts while preserving the same dark-blue palette and recognizable wave language."
  ].join(" ");
}

function creativeVisualInstructions(post: GeneratedPost, visual: VisualMetadata): string[] {
  if (!isCreativeMode()) return [];
  return [
    `Creative run seed: ${creativeRunSeed()}. Treat this as a fresh visual direction for this exact ${post.platform} draft, not a recycled campaign tile.`,
    "Take the extra creative pass: choose one specific visual metaphor from the source context, vary spatial rhythm, and make the composition feel custom to this post.",
    `Lean into the selected ${visual.motif} motif, but change scale, negative space, texture, and focal hierarchy so the post does not feel like a repeated template.`,
    "Keep it premium and restrained, but allow more editorial drama, asymmetry, and depth than the default conservative system."
  ];
}

function buildAltText(post: GeneratedPost, visual: VisualMetadata): string {
  return `Splay ${visual.density} ${visual.template_family.replace(/-/g, " ")} graphic about ${post.topic.toLowerCase()}.`;
}

async function createCuratedAssets(
  post: GeneratedPost,
  outputDir: string,
  visual: VisualMetadata
): Promise<ImageAssetResult> {
  const rendered = await renderCuratedVisual(post, visual, outputDir);
  return {
    imageUrl: rendered.imageUrl,
    pngUrl: rendered.pngUrl,
    svgUrl: rendered.svgUrl,
    backgroundImagePath: null,
    canvaImportHtml: rendered.canvaImportHtml,
    renderContract: rendered.renderContract,
    qa: rendered.qa,
    notes: [
      `Curated template: ${visual.template_family} (${visual.density}, ${visual.motif}).`,
      "Visual QA passed; PNG preview is the publishing source of truth."
    ]
  };
}

async function createGptCanvaAssets(
  post: GeneratedPost,
  prompt: string,
  outputDir: string,
  visual: VisualMetadata
): Promise<ImageAssetResult> {
  const notes: string[] = [];
  const candidateCount = getGptBackgroundCandidateCount();

  if (process.env.OPENAI_API_KEY) {
    for (let candidate = 1; candidate <= candidateCount; candidate += 1) {
      try {
        const backgroundImagePath = await createGptBackgroundImage(post, prompt, outputDir, candidate);
        const rendered = await renderCuratedVisual(post, visual, outputDir, backgroundImagePath);
        return {
          imageUrl: rendered.imageUrl,
          pngUrl: rendered.pngUrl,
          svgUrl: rendered.svgUrl,
          backgroundImagePath,
          canvaImportHtml: rendered.canvaImportHtml,
          renderContract: rendered.renderContract,
          qa: rendered.qa,
          notes: [
            ...notes,
            `GPT background candidate ${candidate} passed visual QA.`,
            "Visual QA passed; PNG preview is the publishing source of truth."
          ]
        };
      } catch (error) {
        notes.push(`GPT background candidate ${candidate} rejected: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    throw new Error(`All ${candidateCount} GPT background candidate(s) failed visual QA. Refusing to substitute a deterministic live background. ${notes.join(" ")}`);
  } else {
    notes.push("Deterministic background used because OPENAI_API_KEY is not set.");
  }

  const rendered = await renderCuratedVisual(post, visual, outputDir);
  return {
    imageUrl: rendered.imageUrl,
    pngUrl: rendered.pngUrl,
    svgUrl: rendered.svgUrl,
    backgroundImagePath: null,
    canvaImportHtml: rendered.canvaImportHtml,
    renderContract: rendered.renderContract,
    qa: rendered.qa,
    notes: [
      ...notes,
      "Curated deterministic background used after GPT background was unavailable or failed QA.",
      "Visual QA passed; PNG preview is the publishing source of truth."
    ]
  };
}

async function createGptBackgroundImage(post: GeneratedPost, prompt: string, outputDir: string, candidate: number): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  const size = process.env.OPENAI_IMAGE_SIZE ?? "1024x1536";
  const quality = process.env.OPENAI_IMAGE_QUALITY ?? "medium";
  const outputFormat = process.env.OPENAI_IMAGE_FORMAT ?? "png";
  const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
  const fileName = `${post.id}-background-${candidate}.${extension}`;
  const filePath = path.join(outputDir, "images", fileName);

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      output_format: outputFormat,
      n: 1
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI image request failed (${response.status}): ${errorBody.slice(0, 300)}`);
  }

  const result = await response.json() as { data?: Array<{ b64_json?: string }> };
  const imageBase64 = result.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("OpenAI image response did not include b64_json");

  await writeFile(filePath, Buffer.from(imageBase64, "base64"));
  return `images/${fileName}`;
}

function buildCanvaRequest(
  post: GeneratedPost,
  prompt: string,
  altText: string,
  imageAsset: ImageAssetResult,
  referenceAssetPaths: string[],
  visual: VisualMetadata
): CanvaImageRequest {
  const body = visual.brief.supporting_text || "Workflows deal teams can trust.";
  return {
    post_id: post.id,
    platform: post.platform,
    design_type: post.platform === "x" ? "twitter_post" : "instagram_post",
    title: `${post.topic} - ${post.platform.toUpperCase()}`,
    canva_query: [
      prompt,
      `Primary visual headline: ${visual.brief.headline}.`,
      `Context summary for visual metaphor only: ${post.source_context.summary}`,
      referenceAssetPaths.length > 0
        ? `Use these local reference exports for visual style context when creating the Canva design: ${referenceAssetPaths.join(", ")}.`
        : "No local SPLAY reference exports were found; follow the embedded Splay visual style guide exactly.",
      imageAsset.backgroundImagePath
        ? `Use the generated background plate at ${imageAsset.backgroundImagePath}; preserve the bundled official Splay SVG, bold sans headline, divider, and body copy as separate Canva layers.`
        : "Use the curated background and preserve its bundled official Splay SVG, bold sans headline, divider, and body copy as separate Canva layers.",
      imageAsset.canvaImportHtml
        ? `A local Canva import prototype is available at ${imageAsset.canvaImportHtml}.`
        : "No Canva import HTML was generated for this request.",
      `Use the QA-passed local PNG preview at ${imageAsset.pngUrl} as the visual source of truth.`,
      `Editable/debug SVG source is available at ${imageAsset.svgUrl}.`,
      "Create a single static social media graphic. Do not include confidential details, customer names, emails, numbers, or private meeting content.",
      "Do not add extra text boxes, pull quotes, captions, bullets, decorative words, or internal framework labels beyond the provided editable text layers.",
      `Use an exact ${FINAL_IMAGE_WIDTH}x${FINAL_IMAGE_HEIGHT} 16:9 widescreen feed layout. Never use a portrait or square canvas. Keep the headline/support cluster compact and the bottom-quarter waves visually active.`,
      "Do not flatten text into the background image. Text must remain editable in Canva."
    ].join(" "),
    visual_style: SPLAY_VISUAL_STYLE,
    reference_asset_paths: referenceAssetPaths,
    background_image_path: imageAsset.backgroundImagePath,
    canva_import_html: imageAsset.canvaImportHtml,
    text_layers: {
      wordmark: "Splay",
      headline: toDisplayHeadline(visual.brief.headline),
      body
    },
    visual,
    alt_text: altText,
    local_preview: imageAsset.pngUrl,
    local_preview_png: imageAsset.pngUrl,
    local_preview_svg: imageAsset.svgUrl,
    render_contract: imageAsset.renderContract,
    qa: imageAsset.qa
  };
}

function getGptBackgroundCandidateCount(): number {
  const parsed = Number(process.env.SOCIAL_AGENT_GPT_BACKGROUND_CANDIDATES ?? "2");
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}

function getImageMode(): ImageMode {
  if (process.env.SOCIAL_AGENT_IMAGE_MODE === "placeholder") return "placeholder";
  if (process.env.SOCIAL_AGENT_IMAGE_MODE === "gpt-canva") return "gpt-canva";
  if (isCreativeMode() && process.env.SOCIAL_AGENT_CREATIVE_IMAGE_MODE === "gpt-canva" && process.env.OPENAI_API_KEY) return "gpt-canva";
  return "canva";
}

function getCanvaNote(imageMode: ImageMode): string {
  if (imageMode === "gpt-canva") {
    return "GPT background plus Canva text pipeline queued: use output/canva-requests.json and output/canva-imports/ for final editable Canva designs.";
  }
  return "Canva image queued: create the final design from output/canva-requests.json.";
}

async function getReferenceAssetPaths(): Promise<string[]> {
  const dir = process.env.SPLAY_REFERENCE_ASSET_DIR ?? path.join(os.homedir(), "Downloads", "SPLAY");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|svg)$/i.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function toDisplayHeadline(value: string): string {
  return value
    .replace(/\bai\b/gi, "AI")
    .replace(/\bgbrain\b/gi, "GBrain")
    .replace(/\bcrm\b/gi, "CRM");
}
