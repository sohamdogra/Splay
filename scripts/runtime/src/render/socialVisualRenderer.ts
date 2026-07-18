import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  GeneratedPost,
  RenderContract,
  RenderContractTextLayer,
  VisualEvidenceItem,
  VisualMetadata,
  VisualQaCheck,
  VisualQaReport
} from "../types/index.ts";

const WIDTH = 1200;
const HEIGHT = 675;
const GUTTER = 96;
const VERTICAL_GUTTER = 54;
const CONTENT_WIDTH = WIDTH - GUTTER * 2;
const SIGNATURE_TOP = VERTICAL_GUTTER;
const SIGNATURE_LOGO_SIZE = 64;
const SIGNATURE_WORDMARK_SIZE = 32;
const SIGNATURE_GAP = 18;
const PRODUCT_X = 585;
const PRODUCT_Y = 145;
const PRODUCT_WIDTH = WIDTH - PRODUCT_X - GUTTER;
const PRODUCT_HEIGHT = 430;
const BRAND_SIGNATURE = "Splay";
const CHARCOAL = "#1F2937";
const PANEL = "#374151";
const NAVY_PANEL = "#102B40";
const MIST = "#F3F6FA";
const WHITE = "#FFFFFF";
const ACCENT = "#0F5EFF";
const BLUE = "#60A5FA";
const DEEP_NAVY = "#0B2235";
const MUTED_DARK = "#D1D5DB";
const MUTED_LIGHT = "#4B5563";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type TextStyle = "display" | "sans";
type TextRole = "label" | "headline" | "body";
type SceneText = {
  text: string;
  x: number;
  top: number;
  width: number;
  size: number;
  lineHeight: number;
  maxLines: number;
  align?: "left" | "center";
  style?: TextStyle;
  weight?: 400 | 600;
  color: string;
  uppercase?: boolean;
  tracking?: number;
  role: TextRole;
};

type FittedSceneText = SceneText & {
  lines: string[];
  fits: boolean;
};

type Scene = {
  background: string;
  decorations: string;
  generatedDecorations?: string;
  texts: SceneText[];
  darkSignature: boolean;
};

type FittedScene = Omit<Scene, "texts"> & {
  texts: FittedSceneText[];
};

type BrowserLike = {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
};

type PageLike = {
  setViewport(options: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
  screenshot(options: unknown): Promise<Uint8Array>;
  evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: unknown[]): Promise<T>;
  close(): Promise<void>;
};

type PngStats = {
  width: number;
  height: number;
  mean: [number, number, number];
  stddev: number;
  navyCoverage: number;
  rects: Array<{
    id: string;
    mean: [number, number, number];
    stddev: number;
    navyCoverage: number;
  }>;
};

export type CuratedRenderResult = {
  imageUrl: string;
  pngUrl: string;
  svgUrl: string;
  canvaImportHtml: string;
  renderContract: RenderContract;
  qa: VisualQaReport;
};

export function lockVisualToImageCopy(post: GeneratedPost, visual: VisualMetadata): VisualMetadata {
  const headline = post.image_copy?.headline?.trim();
  const support = post.image_copy?.support?.trim();
  if (!headline || !support) return visual;

  const treatment = visualForTreatment(post, visual);
  return {
    ...treatment,
    brief: {
      ...treatment.brief,
      headline,
      supporting_text: support,
      source_cue: treatment.brief.source_cue
    }
  };
}

function visualForTreatment(post: GeneratedPost, visual: VisualMetadata): VisualMetadata {
  if (!post.visual_treatment || post.visual_treatment === "editorial_thesis" || post.visual_treatment === "text_only") {
    return { ...visual, template_family: "dark-editorial-thesis", density: "simple", palette: "charcoal", motif: "citation-rail", brief: { ...visual.brief, content_mode: "thesis", points: [], steps: [], contrast: null, source_cue: "" } };
  }
  if (post.visual_treatment === "workflow_explainer" && visual.brief.steps.length === 3) {
    return { ...visual, template_family: "three-step-workflow", density: "complex", palette: "charcoal", motif: "source-trail", brief: { ...visual.brief, content_mode: "workflow" } };
  }
  if (post.visual_treatment === "product_proof" && post.approved_visual_asset) {
    return { ...visual, template_family: "product-proof", density: "complex", palette: "charcoal", motif: "product-frame" };
  }
  return { ...visual, template_family: "source-evidence-card", density: "structured", palette: "charcoal", motif: "document-fragments", brief: { ...visual.brief, content_mode: "evidence", steps: [], contrast: null } };
}

export async function renderCuratedVisual(
  post: GeneratedPost,
  visual: VisualMetadata,
  outputDir: string,
  backgroundImagePath?: string | null
): Promise<CuratedRenderResult> {
  const lockedVisual = lockVisualToImageCopy(post, visual);
  const rawScene = buildScene(post, lockedVisual);
  const scene = { ...rawScene, texts: rawScene.texts.filter((text) => text.text.trim().length > 0) };
  const [fontCss, logoHref, backgroundHref, productHref] = await Promise.all([
    embeddedFontCss(),
    embeddedLogo(scene.darkSignature ? "blue" : "charcoal"),
    backgroundImagePath ? embeddedAsset(outputDir, backgroundImagePath) : Promise.resolve(null),
    lockedVisual.template_family === "product-proof" && post.approved_visual_asset
      ? embeddedAbsoluteAsset(post.approved_visual_asset)
      : Promise.resolve(null)
  ]);

  const browser = await launchBrowser();
  try {
    const fittedTexts = await fitSceneTexts(browser, scene.texts, fontCss);
    const fittedScene = { ...scene, texts: compactPrimaryCopy(fittedTexts, lockedVisual) };
    const renderContract = buildRenderContract(fittedScene, lockedVisual, backgroundImagePath ?? null);
    const svg = renderSvg(fittedScene, lockedVisual, fontCss, logoHref, backgroundHref, productHref, renderContract);
    const html = renderHtml(fittedScene, lockedVisual, fontCss, logoHref, backgroundHref, productHref, post.topic);
    const backgroundSvg = renderBackgroundOnlySvg(fittedScene, backgroundHref, productHref, lockedVisual);
    const pngName = `${post.id}.png`;
    const svgName = `${post.id}.svg`;
    const htmlName = `${post.id}.html`;
    const pngUrl = `images/${pngName}`;
    const svgUrl = `images/${svgName}`;
    const htmlUrl = `canva-imports/${htmlName}`;
    const pngPath = path.join(outputDir, pngUrl);
    const svgPath = path.join(outputDir, svgUrl);
    const htmlPath = path.join(outputDir, htmlUrl);

    await writeFile(svgPath, svg, "utf8");
    await writeFile(htmlPath, html, "utf8");

    const svgRender = await renderFileToPng(browser, svgPath);
    const htmlRender = await renderFileToPng(browser, htmlPath);
    const backgroundPng = await renderSvgMarkupToPng(browser, backgroundSvg);
    await writeFile(pngPath, svgRender.buffer);

    const qa = await buildVisualQaReport(browser, {
      postId: post.id,
      pngPath: pngUrl,
      svgPath: svgUrl,
      htmlPath: htmlUrl,
      svgPng: svgRender.buffer,
      htmlPng: htmlRender.buffer,
      backgroundPng,
      svgFontsLoaded: svgRender.fontsLoaded,
      htmlFontsLoaded: htmlRender.fontsLoaded,
      scene: fittedScene,
      renderContract,
      backgroundImagePath: backgroundImagePath ?? null
    });

    if (!qa.ok) {
      throw new Error(`Visual QA failed for ${post.id}: ${failedCheckSummary(qa.checks)}`);
    }

    return {
      imageUrl: pngUrl,
      pngUrl,
      svgUrl,
      canvaImportHtml: htmlUrl,
      renderContract,
      qa
    };
  } finally {
    await browser.close();
  }
}

export async function renderCuratedBackground(
  post: GeneratedPost,
  visual: VisualMetadata,
  outputDir: string
): Promise<string> {
  const scene = buildScene(post, visual);
  const fileName = `${post.id}-background.svg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${scene.background}
</svg>`;
  await writeFile(path.join(outputDir, "images", fileName), svg, "utf8");
  return `images/${fileName}`;
}

export function buildTemplateSceneForTest(post: GeneratedPost, visual: VisualMetadata): Scene {
  return buildScene(post, visual);
}

function buildScene(post: GeneratedPost, visual: VisualMetadata): Scene {
  const brief = visual.brief;
  switch (visual.template_family) {
    case "light-minimal-thesis":
      return lightThesis(brief.headline, brief.supporting_text);
    case "split-contrast":
      return splitContrast(brief);
    case "source-evidence-card":
      return evidenceCard(brief.headline, brief.supporting_text, brief.source_cue);
    case "three-point-principles":
      return principles(brief.headline, brief.points);
    case "three-step-workflow":
      return workflow(brief.headline, brief.steps);
    case "relationship-source-map":
      return relationshipMap(brief.headline, brief.points.length >= 3 ? brief.points : brief.steps);
    case "product-proof":
      return productProof(brief.headline, brief.supporting_text, Boolean(post.approved_visual_asset));
    default:
      return darkThesis(brief.headline, brief.supporting_text, brief.source_cue);
  }
}

function darkThesis(headline: string, supporting: string, sourceCue: string): Scene {
  const structuralDecorations = `
      <line x1="${GUTTER}" x2="${WIDTH - GUTTER}" y1="137" y2="137" stroke="${MIST}" stroke-opacity=".1" stroke-width="1"/>
      <line x1="${GUTTER}" x2="248" y1="137" y2="137" stroke="${ACCENT}" stroke-opacity=".9" stroke-width="2"/>
      <line x1="${GUTTER}" x2="${GUTTER}" y1="177" y2="520" stroke="${ACCENT}" stroke-width="3"/>
      <circle cx="${GUTTER}" cy="177" r="7" fill="${ACCENT}"/>`;
  return {
    background: darkField("32%", "74%"),
    decorations: `${structuralDecorations}
      <path d="M-90 555 C190 465 420 630 720 545 S1040 470 1290 520" fill="none" stroke="${BLUE}" stroke-opacity=".62" stroke-width="4"/>
      <path d="M-110 595 C170 510 460 650 750 585 S1050 520 1310 565" fill="none" stroke="${ACCENT}" stroke-opacity=".42" stroke-width="3"/>
      <path d="M-80 635 C210 565 490 675 780 625 S1080 580 1300 610" fill="none" stroke="${BLUE}" stroke-opacity=".3" stroke-width="2"/>
      <circle cx="120" cy="550" r="7" fill="${ACCENT}"/><circle cx="455" cy="605" r="6" fill="${BLUE}"/><circle cx="805" cy="575" r="7" fill="${ACCENT}"/><circle cx="1090" cy="505" r="6" fill="${BLUE}"/>
      <g opacity=".18">${nodePattern(900, 105, 250, 210)}</g>`,
    generatedDecorations: structuralDecorations,
    texts: [
      label(sourceCue, 122, 165, 720, MUTED_DARK),
      display(headline, 122, 205, 940, 68, 2, WHITE),
      body(supporting, 122, 385, 900, 32, 2, MIST)
    ],
    darkSignature: true
  };
}

function compactPrimaryCopy(texts: FittedSceneText[], visual: VisualMetadata): FittedSceneText[] {
  if (visual.template_family !== "dark-editorial-thesis") return texts;
  const headline = texts.find((text) => text.role === "headline");
  const support = texts.find((text) => text.role === "body");
  if (!headline || !support) return texts;

  const headlineBottom = headline.top + headline.lineHeight * headline.lines.length;
  const supportTop = Math.min(430, headlineBottom + 38);
  return texts.map((text) => text === support ? { ...text, top: supportTop } : text);
}

function lightThesis(headline: string, supporting: string): Scene {
  return {
    background: `<rect width="${WIDTH}" height="${HEIGHT}" fill="${MIST}"/><circle cx="1030" cy="150" r="240" fill="#DBEAFE"/>`,
    decorations: `
      <path d="M96 580 H1104" stroke="${CHARCOAL}" stroke-opacity=".2"/>
      <path d="M965 70 C1080 145 1090 270 960 345" fill="none" stroke="${ACCENT}" stroke-width="3"/>
      <g opacity=".13">${nodePattern(90, 430, 260, 190, CHARCOAL)}</g>`,
    texts: [
      label("SPLAY TAKE", GUTTER, 160, CONTENT_WIDTH, MUTED_LIGHT, "center"),
      display(headline, GUTTER, 205, CONTENT_WIDTH, 66, 2, CHARCOAL, "center"),
      body(supporting, 190, 405, 820, 30, 2, MUTED_LIGHT, "center")
    ],
    darkSignature: false
  };
}

function splitContrast(brief: VisualMetadata["brief"]): Scene {
  const left = brief.contrast?.left.text ?? brief.headline;
  const right = brief.contrast?.right.text ?? brief.supporting_text;
  return {
    background: `<rect width="600" height="${HEIGHT}" fill="${CHARCOAL}"/><rect x="600" width="600" height="${HEIGHT}" fill="${MIST}"/>`,
    decorations: `
      <rect x="588" width="24" height="${HEIGHT}" fill="${ACCENT}"/>
      <circle cx="600" cy="555" r="52" fill="${ACCENT}"/>
      <path d="M145 545 H500 M700 545 H1055" stroke="${BLUE}" stroke-opacity=".45" stroke-width="2"/>`,
    texts: [
      label("WHAT TEAMS SEE", GUTTER, 175, 410, MUTED_DARK),
      display(left, GUTTER, 220, 410, 50, 3, WHITE),
      label("WHAT TEAMS NEED", 690, 175, 410, MUTED_LIGHT),
      display(right, 690, 220, 410, 50, 3, CHARCOAL),
      body(brief.supporting_text, 690, 470, 410, 26, 2, MUTED_LIGHT)
    ],
    darkSignature: true
  };
}

function evidenceCard(headline: string, supporting: string, sourceCue: string): Scene {
  return {
    background: darkField("76%", "24%"),
    decorations: `
      <rect x="260" y="130" width="844" height="480" rx="10" fill="${NAVY_PANEL}" stroke="${BLUE}" stroke-opacity=".24"/>
      <rect x="260" y="130" width="14" height="480" fill="${ACCENT}"/>
      <path d="M320 505 H1035 M320 545 H930" stroke="${MIST}" stroke-opacity=".16" stroke-width="2"/>
      <circle cx="205" cy="530" r="58" fill="none" stroke="${BLUE}" stroke-opacity=".34" stroke-width="2"/>`,
    texts: [
      label("THE TAKEAWAY", 320, 170, 720, MUTED_DARK),
      display(headline, 320, 215, 720, 58, 2, WHITE),
      body(supporting, 320, 375, 720, 30, 2, MUTED_DARK),
      label(sourceCue, 320, 545, 720, BLUE)
    ],
    darkSignature: true
  };
}

function principles(headline: string, items: VisualEvidenceItem[]): Scene {
  const normalized = padItems(items, "Keep the why close");
  const texts: SceneText[] = [
    label("THE BETTER PATH", GUTTER, 150, CONTENT_WIDTH, MUTED_LIGHT),
    display(headline, GUTTER, 190, CONTENT_WIDTH, 52, 2, CHARCOAL)
  ];
  normalized.forEach((item, index) => {
    const left = GUTTER + index * 336;
    texts.push(label(`0${index + 1}`, left + 24, 405, 80, ACCENT));
    texts.push(body(item.text, left + 24, 447, 280, 27, 2, CHARCOAL));
  });
  return {
    background: `<rect width="${WIDTH}" height="${HEIGHT}" fill="${MIST}"/><rect x="0" y="0" width="24" height="${HEIGHT}" fill="${ACCENT}"/>`,
    decorations: `
      <rect x="96" y="380" width="304" height="210" rx="12" fill="${WHITE}" stroke="${CHARCOAL}" stroke-opacity=".14"/>
      <rect x="432" y="380" width="304" height="210" rx="12" fill="${WHITE}" stroke="${CHARCOAL}" stroke-opacity=".14"/>
      <rect x="768" y="380" width="304" height="210" rx="12" fill="${WHITE}" stroke="${CHARCOAL}" stroke-opacity=".14"/>
      <g opacity=".1">${nodePattern(900, 65, 230, 180, CHARCOAL)}</g>`,
    texts,
    darkSignature: false
  };
}

function workflow(headline: string, items: VisualEvidenceItem[]): Scene {
  const normalized = padItems(items, "Keep the work moving");
  const texts: SceneText[] = [
    label("WHAT TO FIX FIRST", GUTTER, 150, CONTENT_WIDTH, MUTED_DARK),
    display(headline, GUTTER, 190, CONTENT_WIDTH, 52, 2, WHITE)
  ];
  normalized.forEach((item, index) => {
    const left = 150 + index * 340;
    texts.push(label(`0${index + 1}`, left, 405, 80, BLUE));
    texts.push(body(item.text, left, 452, 270, 27, 2, MIST));
  });
  return {
    background: darkField("24%", "78%"),
    decorations: `
      <line x1="150" x2="1050" y1="375" y2="375" stroke="${BLUE}" stroke-opacity=".58" stroke-width="3"/>
      <circle cx="150" cy="375" r="18" fill="${ACCENT}"/>
      <circle cx="490" cy="375" r="18" fill="${CHARCOAL}" stroke="${ACCENT}" stroke-width="4"/>
      <circle cx="830" cy="375" r="18" fill="${CHARCOAL}" stroke="${ACCENT}" stroke-width="4"/>
      <path d="M830 590 C950 610 1050 590 1120 545" fill="none" stroke="${ACCENT}" stroke-opacity=".24" stroke-width="2"/>`,
    texts,
    darkSignature: true
  };
}

function relationshipMap(headline: string, items: VisualEvidenceItem[]): Scene {
  const normalized = padItems(items, "Keep the why close");
  const positions = [
    { x: 96, y: 385 },
    { x: 438, y: 350 },
    { x: 780, y: 385 }
  ];
  const texts: SceneText[] = [
    label("KEEP WITH THE WORK", GUTTER, 150, 500, MUTED_LIGHT),
    display(headline, GUTTER, 190, 720, 52, 2, CHARCOAL)
  ];
  normalized.forEach((item, index) => {
    const position = positions[index];
    texts.push(label(`0${index + 1}`, position.x + 28, position.y + 28, 80, index === 1 ? MUTED_DARK : MUTED_LIGHT));
    texts.push(body(item.text, position.x + 28, position.y + 70, 250, 25, 2, index === 1 ? WHITE : CHARCOAL));
  });
  return {
    background: `<rect width="${WIDTH}" height="${HEIGHT}" fill="${MIST}"/><path d="M930 0 H1200 V675 H1050 C980 555 960 300 930 0Z" fill="${CHARCOAL}"/>`,
    decorations: `
      <path d="M380 490 C430 430 470 420 520 440 M730 455 C760 470 790 490 820 510" fill="none" stroke="${BLUE}" stroke-opacity=".62" stroke-width="3"/>
      <rect x="96" y="385" width="300" height="190" rx="14" fill="${WHITE}" stroke="${CHARCOAL}" stroke-opacity=".12"/>
      <rect x="438" y="350" width="300" height="190" rx="14" fill="${PANEL}" stroke="${ACCENT}" stroke-opacity=".5"/>
      <rect x="780" y="385" width="300" height="190" rx="14" fill="${WHITE}" stroke="${CHARCOAL}" stroke-opacity=".12"/>
      <circle cx="418" cy="465" r="18" fill="${ACCENT}"/><circle cx="760" cy="485" r="18" fill="${ACCENT}"/>`,
    texts,
    darkSignature: false
  };
}

function productProof(headline: string, supporting: string, hasAsset: boolean): Scene {
  return {
    background: darkField("80%", "18%"),
    decorations: `
      <rect x="${PRODUCT_X}" y="${PRODUCT_Y}" width="${PRODUCT_WIDTH}" height="${PRODUCT_HEIGHT}" rx="18" fill="${PANEL}" stroke="${ACCENT}" stroke-opacity=".46"/>
      ${hasAsset ? "" : `<path d="M640 500 L760 355 L865 430 L980 280 L1050 385" fill="none" stroke="${BLUE}" stroke-opacity=".45" stroke-width="4"/>`}
      <rect x="${GUTTER}" y="575" width="250" height="6" fill="${ACCENT}"/>`,
    texts: [
      label("PRODUCT NOTE", GUTTER, 160, 410, MUTED_DARK),
      display(headline, GUTTER, 205, 410, 54, 3, WHITE),
      body(supporting, GUTTER, 455, 410, 28, 2, MUTED_DARK)
    ],
    darkSignature: true
  };
}

async function launchBrowser(): Promise<BrowserLike> {
  const puppeteer = (await import("puppeteer")).default;
  return await puppeteer.launch({ headless: true });
}

async function fitSceneTexts(browser: BrowserLike, texts: SceneText[], fontCss: string): Promise<FittedSceneText[]> {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><html><head><style>${fontCss}</style></head><body><canvas id="measure"></canvas></body></html>`, { waitUntil: "networkidle0" });
    return await page.evaluate(async (rawTexts, safeBottom) => {
      await document.fonts.ready;
      const canvas = document.getElementById("measure") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const fitted: Array<Record<string, unknown>> = [];

      function family(text: Record<string, unknown>): string {
        return text.style === "sans" ? "Instrument Sans" : "Brawler";
      }

      function minimumSize(text: Record<string, unknown>): number {
        if (text.uppercase) return 16;
        if (text.style === "display") return 40;
        return 20;
      }

      function measure(value: string, text: Record<string, unknown>, size: number): number {
        const weight = Number(text.weight ?? 400);
        ctx.font = `${weight} ${size}px "${family(text)}"`;
        const tracking = Number(text.tracking ?? 0);
        return ctx.measureText(value).width + Math.max(0, value.length - 1) * tracking;
      }

      function splitLongWord(word: string, text: Record<string, unknown>, size: number): string[] {
        const chunks: string[] = [];
        let current = "";
        for (const char of Array.from(word)) {
          const next = `${current}${char}`;
          if (current && measure(next, text, size) > Number(text.width)) {
            chunks.push(current);
            current = char;
          } else {
            current = next;
          }
        }
        if (current) chunks.push(current);
        return chunks;
      }

      function wrap(value: string, text: Record<string, unknown>, size: number): string[] {
        const lines: string[] = [];
        let current = "";
        const words = value.split(/\s+/).filter(Boolean);
        for (const word of words) {
          const wordParts = measure(word, text, size) > Number(text.width)
            ? splitLongWord(word, text, size)
            : [word];
          for (const part of wordParts) {
            const next = current ? `${current} ${part}` : part;
            if (current && measure(next, text, size) > Number(text.width)) {
              lines.push(current);
              current = part;
            } else {
              current = next;
            }
          }
        }
        if (current) lines.push(current);
        return lines;
      }

      for (const text of rawTexts as Array<Record<string, unknown>>) {
        const value = text.uppercase ? String(text.text).toUpperCase() : String(text.text);
        const originalSize = Number(text.size);
        const originalLineHeight = Number(text.lineHeight);
        const ratio = originalLineHeight / originalSize;
        const min = minimumSize(text);
        let bestLines = wrap(value, text, min);
        let bestSize = min;
        let fits = bestLines.length <= Number(text.maxLines);

        for (let size = originalSize; size >= min; size -= 1) {
          const lines = wrap(value, text, size);
          const lineHeight = Math.round(size * ratio);
          const bottom = Number(text.top) + lineHeight * lines.length;
          if (lines.length <= Number(text.maxLines) && bottom <= Number(safeBottom)) {
            bestLines = lines;
            bestSize = size;
            fits = true;
            break;
          }
        }

        fitted.push({
          ...text,
          size: bestSize,
          lineHeight: Math.round(bestSize * ratio),
          lines: bestLines,
          fits
        });
      }
      return fitted as unknown as FittedSceneText[];
    }, texts, HEIGHT - VERTICAL_GUTTER);
  } finally {
    await page.close();
  }
}

function renderSvg(
  scene: FittedScene,
  visual: VisualMetadata,
  fontCss: string,
  logoHref: string,
  backgroundHref: string | null,
  productHref: string | null,
  renderContract: RenderContract
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(visual.brief.headline)}">
  <defs><style>${fontCss}</style><clipPath id="productClip"><rect x="${PRODUCT_X}" y="${PRODUCT_Y}" width="${PRODUCT_WIDTH}" height="${PRODUCT_HEIGHT}" rx="18"/></clipPath></defs>
  ${renderSceneBackground(scene, backgroundHref)}
  ${renderSceneDecorations(scene, Boolean(backgroundHref))}
  ${productHref && visual.template_family === "product-proof" ? `<image href="${productHref}" x="${PRODUCT_X}" y="${PRODUCT_Y}" width="${PRODUCT_WIDTH}" height="${PRODUCT_HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#productClip)"/>` : ""}
  ${renderSvgSignature(logoHref, scene.darkSignature)}
  ${scene.texts.map(renderSvgText).join("\n  ")}
  <metadata>${escapeXml(JSON.stringify({
    template: visual.template_family,
    density: visual.density,
    palette: visual.palette,
    motif: visual.motif,
    render_contract: renderContract
  }))}</metadata>
</svg>`;
}

function renderHtml(
  scene: FittedScene,
  visual: VisualMetadata,
  fontCss: string,
  logoHref: string,
  backgroundHref: string | null,
  productHref: string | null,
  title: string
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${WIDTH}">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: ${WIDTH}px ${HEIGHT}px; margin: 0; }
    ${fontCss}
    * { box-sizing: border-box; }
    body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; }
    .artboard { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    .decor { position: absolute; inset: 0; width: 100%; height: 100%; }
    .text { position: absolute; white-space: nowrap; }
    .signature { position: absolute; left: ${GUTTER}px; top: ${SIGNATURE_TOP}px; display: flex; align-items: center; gap: ${SIGNATURE_GAP}px; color: ${scene.darkSignature ? WHITE : CHARCOAL}; font: 600 ${SIGNATURE_WORDMARK_SIZE}px "Instrument Sans", Inter, Arial, sans-serif; letter-spacing: .04em; }
    .signature img { width: ${SIGNATURE_LOGO_SIZE}px; height: ${SIGNATURE_LOGO_SIZE}px; }
  </style>
</head>
<body>
  <main class="artboard" data-template-family="${visual.template_family}" data-density="${visual.density}" data-palette="${visual.palette}" data-motif="${visual.motif}">
    <svg class="decor" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">
      <defs><clipPath id="productClip"><rect x="${PRODUCT_X}" y="${PRODUCT_Y}" width="${PRODUCT_WIDTH}" height="${PRODUCT_HEIGHT}" rx="18"/></clipPath></defs>
      ${renderSceneBackground(scene, backgroundHref)}
      ${renderSceneDecorations(scene, Boolean(backgroundHref))}
      ${productHref && visual.template_family === "product-proof" ? `<image href="${productHref}" x="${PRODUCT_X}" y="${PRODUCT_Y}" width="${PRODUCT_WIDTH}" height="${PRODUCT_HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#productClip)"/>` : ""}
    </svg>
    <div class="signature"><img src="${logoHref}" alt=""><span>${BRAND_SIGNATURE}</span></div>
    ${scene.texts.map(renderHtmlText).join("\n    ")}
  </main>
</body>
</html>`;
}

function renderSvgSignature(logoHref: string, dark: boolean): string {
  return `<image href="${logoHref}" x="${GUTTER}" y="${SIGNATURE_TOP}" width="${SIGNATURE_LOGO_SIZE}" height="${SIGNATURE_LOGO_SIZE}"/>
  <text x="${GUTTER + SIGNATURE_LOGO_SIZE + SIGNATURE_GAP}" y="${SIGNATURE_TOP + 47}" font-family="Instrument Sans, Inter, Arial, sans-serif" font-size="${SIGNATURE_WORDMARK_SIZE}" font-weight="600" letter-spacing="1.3" fill="${dark ? WHITE : CHARCOAL}">${BRAND_SIGNATURE}</text>`;
}

function generatedBackgroundLayer(backgroundHref: string): string {
  return `<defs><linearGradient id="generatedTextShield" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${DEEP_NAVY}" stop-opacity=".48"/><stop offset=".68" stop-color="${DEEP_NAVY}" stop-opacity=".32"/><stop offset="1" stop-color="${DEEP_NAVY}" stop-opacity="0"/></linearGradient></defs><image href="${backgroundHref}" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/><rect width="${WIDTH}" height="${HEIGHT}" fill="${DEEP_NAVY}" opacity=".18"/><rect x="0" y="130" width="1000" height="360" fill="url(#generatedTextShield)"/><rect width="${WIDTH}" height="${HEIGHT}" fill="${BLUE}" opacity=".02"/>`;
}

function renderSceneBackground(scene: FittedScene, backgroundHref: string | null): string {
  return backgroundHref ? generatedBackgroundLayer(backgroundHref) : scene.background;
}

function renderSceneDecorations(scene: FittedScene, hasGeneratedBackground: boolean): string {
  return hasGeneratedBackground ? scene.generatedDecorations ?? scene.decorations : scene.decorations;
}

function renderBackgroundOnlySvg(
  scene: FittedScene,
  backgroundHref: string | null,
  productHref: string | null,
  visual: VisualMetadata
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs><clipPath id="productClip"><rect x="${PRODUCT_X}" y="${PRODUCT_Y}" width="${PRODUCT_WIDTH}" height="${PRODUCT_HEIGHT}" rx="18"/></clipPath></defs>
  ${renderSceneBackground(scene, backgroundHref)}
  ${renderSceneDecorations(scene, Boolean(backgroundHref))}
  ${productHref && visual.template_family === "product-proof" ? `<image href="${productHref}" x="${PRODUCT_X}" y="${PRODUCT_Y}" width="${PRODUCT_WIDTH}" height="${PRODUCT_HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#productClip)"/>` : ""}
</svg>`;
}

function renderSvgText(text: FittedSceneText): string {
  const anchor = text.align === "center" ? "middle" : "start";
  const x = text.align === "center" ? text.x + text.width / 2 : text.x;
  const family = text.style === "sans" ? "Instrument Sans, Inter, Arial, sans-serif" : "Brawler, Georgia, serif";
  const baseline = text.top + text.size * (text.style === "sans" ? 0.9 : 0.92);
  return text.lines.map((line, index) => `<text x="${x}" y="${Math.round(baseline + index * text.lineHeight)}" text-anchor="${anchor}" font-family="${family}" font-size="${text.size}" font-weight="${text.weight ?? 400}" letter-spacing="${text.tracking ?? 0}" fill="${text.color}">${escapeXml(line)}</text>`).join("\n  ");
}

function renderHtmlText(text: FittedSceneText): string {
  const family = text.style === "sans" ? '"Instrument Sans", Inter, Arial, sans-serif' : 'Brawler, Georgia, serif';
  return text.lines.map((line, index) => `<div class="text" style="left:${text.x}px;top:${text.top + index * text.lineHeight}px;width:${text.width}px;text-align:${text.align ?? "left"};font:${text.weight ?? 400} ${text.size}px/${text.lineHeight}px ${family};letter-spacing:${text.tracking ?? 0}px;color:${text.color};">${escapeHtml(line)}</div>`).join("\n    ");
}

function buildRenderContract(scene: FittedScene, visual: VisualMetadata, backgroundImagePath: string | null): RenderContract {
  return {
    width: WIDTH,
    height: HEIGHT,
    safe_area: {
      left: GUTTER,
      top: VERTICAL_GUTTER,
      right: WIDTH - GUTTER,
      bottom: HEIGHT - VERTICAL_GUTTER
    },
    template_family: visual.template_family,
    density: visual.density,
    palette: visual.palette,
    motif: visual.motif,
    background_image_path: backgroundImagePath,
    signature: {
      x: GUTTER,
      y: SIGNATURE_TOP,
      logo_size: SIGNATURE_LOGO_SIZE,
      wordmark: BRAND_SIGNATURE,
      color: scene.darkSignature ? WHITE : CHARCOAL,
      font_family: "Instrument Sans",
      font_size: SIGNATURE_WORDMARK_SIZE
    },
    text_layers: scene.texts.map((text, index): RenderContractTextLayer => ({
      id: `${text.role}-${index + 1}`,
      role: text.role,
      text: text.uppercase ? text.text.toUpperCase() : text.text,
      lines: text.lines,
      x: text.x,
      y: text.top,
      width: text.width,
      height: text.lineHeight * text.lines.length,
      font_family: text.style === "sans" ? "Instrument Sans" : "Brawler",
      font_size: text.size,
      line_height: text.lineHeight,
      font_weight: text.weight ?? 400,
      color: text.color,
      align: text.align ?? "left",
      letter_spacing: text.tracking ?? 0,
      fits: text.fits
    }))
  };
}

async function renderFileToPng(browser: BrowserLike, filePath: string): Promise<{ buffer: Buffer; fontsLoaded: boolean }> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(filePath).href, { waitUntil: "networkidle0" });
    const fontsLoaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('24px "Instrument Sans"');
    });
    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }
    });
    return { buffer: Buffer.from(screenshot), fontsLoaded };
  } finally {
    await page.close();
  }
}

async function renderSvgMarkupToPng(browser: BrowserLike, svg: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}</style></head><body>${svg}</body></html>`, { waitUntil: "networkidle0" });
    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }
    });
    return Buffer.from(screenshot);
  } finally {
    await page.close();
  }
}

async function buildVisualQaReport(
  browser: BrowserLike,
  args: {
    postId: string;
    pngPath: string;
    svgPath: string;
    htmlPath: string;
    svgPng: Buffer;
    htmlPng: Buffer;
    backgroundPng: Buffer;
    svgFontsLoaded: boolean;
    htmlFontsLoaded: boolean;
    scene: FittedScene;
    renderContract: RenderContract;
    backgroundImagePath: string | null;
  }
): Promise<VisualQaReport> {
  const rects = args.renderContract.text_layers.map((layer) => ({
    id: layer.id,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height
  }));
  rects.push({ id: "signature", x: GUTTER, y: SIGNATURE_TOP, width: 260, height: SIGNATURE_LOGO_SIZE });
  rects.push({ id: "campaign-lower-third", x: 0, y: 500, width: WIDTH, height: 175 });
  rects.push({ id: "campaign-right-art", x: 850, y: 120, width: 300, height: 410 });

  const stats = await analyzePng(browser, args.svgPng, rects);
  const backgroundStats = await analyzePng(browser, args.backgroundPng, rects);
  const pixelDiff = await comparePngs(browser, args.svgPng, args.htmlPng);
  const textContrast = args.renderContract.text_layers.map((layer) => {
    const rect = backgroundStats.rects.find((item) => item.id === layer.id);
    return rect ? contrastRatio(hexToRgb(layer.color), rect.mean) : 0;
  });
  const textLayerIds = new Set(args.renderContract.text_layers.map((layer) => layer.id));
  const textNoise = backgroundStats.rects
    .filter((rect) => textLayerIds.has(rect.id))
    .map((rect) => rect.stddev);
  const textLayersVisible = [...textLayerIds].every((id) => {
    const finalRect = stats.rects.find((rect) => rect.id === id);
    const backgroundRect = backgroundStats.rects.find((rect) => rect.id === id);
    if (!finalRect || !backgroundRect) return false;
    const meanDelta = finalRect.mean.reduce((sum, value, index) => sum + Math.abs(value - backgroundRect.mean[index]), 0) / 3;
    return meanDelta >= 1 || finalRect.stddev - backgroundRect.stddev >= 0.75;
  });
  const signature = stats.rects.find((rect) => rect.id === "signature");
  const textSafe = args.renderContract.text_layers.every((layer) => {
    return layer.x >= GUTTER &&
      layer.y >= VERTICAL_GUTTER &&
      layer.x + layer.width <= WIDTH - GUTTER &&
      layer.y + layer.height <= HEIGHT - VERTICAL_GUTTER;
  });
  const noClipping = args.renderContract.text_layers.every((layer) => {
    return layer.fits && !/[.]{3}|\u2026/.test(layer.lines.join(" "));
  });
  const headlineLayers = args.renderContract.text_layers.filter((layer) => layer.role === "headline");
  const bodyLayers = args.renderContract.text_layers.filter((layer) => layer.role === "body");
  const headlineMax = Math.max(...headlineLayers.map((layer) => layer.font_size), 0);
  const bodyMax = Math.max(...bodyLayers.map((layer) => layer.font_size), 0);
  const textTop = Math.min(...args.renderContract.text_layers.map((layer) => layer.y));
  const textBottom = Math.max(...args.renderContract.text_layers.map((layer) => layer.y + layer.height));
  const textAreaRatio = args.renderContract.text_layers
    .reduce((sum, layer) => sum + layer.width * layer.height, 0) / (WIDTH * HEIGHT);
  const textSpanRatio = (textBottom - textTop) / HEIGHT;
  const primaryHeadline = headlineLayers[0];
  const primaryBody = bodyLayers[0];
  const headlineSupportGap = primaryHeadline && primaryBody
    ? primaryBody.y - (primaryHeadline.y + primaryHeadline.height)
    : 0;
  const requiresCompactPrimaryCopy = args.renderContract.template_family === "dark-editorial-thesis";
  const blueBias = backgroundStats.mean[2] - backgroundStats.mean[0];
  const requiresBlueField = args.renderContract.palette === "charcoal";
  const campaignLowerThird = backgroundStats.rects.find((rect) => rect.id === "campaign-lower-third");
  const campaignRightArt = backgroundStats.rects.find((rect) => rect.id === "campaign-right-art");
  const lowerThirdBlueBias = campaignLowerThird ? campaignLowerThird.mean[2] - campaignLowerThird.mean[0] : 0;
  const generatedArtActivity = Math.max(campaignLowerThird?.stddev ?? 0, campaignRightArt?.stddev ?? 0);
  const requiresCampaignWave = args.renderContract.template_family === "dark-editorial-thesis";

  const checks: VisualQaCheck[] = [
    check("dimensions", stats.width === WIDTH && stats.height === HEIGHT, `${stats.width}x${stats.height}`),
    check("nonblank_pixel_variance", stats.stddev >= 8, round(stats.stddev)),
    check("fonts_loaded", args.svgFontsLoaded && args.htmlFontsLoaded, args.svgFontsLoaded && args.htmlFontsLoaded),
    check("text_safe_area", textSafe, textSafe),
    check("no_clipped_or_ellipsized_text", noClipping, noClipping),
    check("text_layers_visible_in_final_raster", textLayersVisible, textLayersVisible),
    check("brand_signature_visible", Boolean(signature && signature.stddev >= 4), signature ? round(signature.stddev) : "missing"),
    check("brand_signature_scale", args.renderContract.signature.logo_size >= 64 && args.renderContract.signature.font_size >= 30, `${args.renderContract.signature.logo_size}px / ${args.renderContract.signature.font_size}px`),
    check("dark_blue_color_bias", !requiresBlueField || blueBias >= 8, round(blueBias)),
    check("dark_navy_pixel_coverage", !requiresBlueField || backgroundStats.navyCoverage >= 0.72, round(backgroundStats.navyCoverage)),
    check("lower_third_wave_activity", !requiresCampaignWave || Boolean(campaignLowerThird && campaignLowerThird.stddev >= 8 && lowerThirdBlueBias >= 8), campaignLowerThird ? `${round(campaignLowerThird.stddev)} / ${round(lowerThirdBlueBias)}` : "missing"),
    check("generated_background_visual_activity", !args.backgroundImagePath || generatedArtActivity >= 8, round(generatedArtActivity)),
    check("minimum_text_contrast", textContrast.every((value) => value >= 4.5), round(Math.min(...textContrast))),
    check("background_text_noise", !args.backgroundImagePath || textNoise.every((value) => value <= 36), textNoise.length ? round(Math.max(...textNoise)) : 0),
    check("hierarchy_headline_scale", headlineMax <= 88, headlineMax),
    check("hierarchy_support_smaller_than_headline", bodyMax === 0 || headlineMax === 0 || bodyMax <= headlineMax * 0.72, bodyMax),
    check("hierarchy_text_area_compact", textAreaRatio <= 0.42, round(textAreaRatio)),
    check("hierarchy_text_span_balanced", textSpanRatio <= 0.82, round(textSpanRatio)),
    check("hierarchy_headline_support_gap", !requiresCompactPrimaryCopy || (headlineSupportGap >= 28 && headlineSupportGap <= 100), round(headlineSupportGap)),
    check("svg_html_pixel_diff", pixelDiff <= 0.18, round(pixelDiff))
  ];

  return {
    post_id: args.postId,
    ok: checks.every((item) => item.ok),
    checked_at: new Date().toISOString(),
    png_path: args.pngPath,
    svg_path: args.svgPath,
    html_path: args.htmlPath,
    dimensions: {
      width: stats.width,
      height: stats.height
    },
    pixel_diff: round(pixelDiff),
    checks
  };
}

function check(name: string, ok: boolean, value: string | number | boolean, message?: string): VisualQaCheck {
  return { name, ok, value, ...(message ? { message } : {}) };
}

async function analyzePng(
  browser: BrowserLike,
  buffer: Buffer,
  rects: Array<{ id: string; x: number; y: number; width: number; height: number }>
): Promise<PngStats> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async (dataUrl, rawRects) => {
      const image = new Image();
      image.src = dataUrl as string;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      function statsForRect(rect: { id: string; x: number; y: number; width: number; height: number }) {
        const step = 10;
        let count = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let luminance = 0;
        let luminanceSquared = 0;
        let navyCount = 0;
        const left = Math.max(0, Math.floor(rect.x));
        const top = Math.max(0, Math.floor(rect.y));
        const right = Math.min(canvas.width, Math.ceil(rect.x + rect.width));
        const bottom = Math.min(canvas.height, Math.ceil(rect.y + rect.height));
        for (let y = top; y < bottom; y += step) {
          for (let x = left; x < right; x += step) {
            const index = (y * canvas.width + x) * 4;
            const pr = imageData[index];
            const pg = imageData[index + 1];
            const pb = imageData[index + 2];
            const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
            r += pr;
            g += pg;
            b += pb;
            luminance += lum;
            luminanceSquared += lum * lum;
            if (pb - pr >= 8 && pb - pg >= 3 && lum <= 105) navyCount += 1;
            count += 1;
          }
        }
        const meanLum = count ? luminance / count : 0;
        const variance = count ? luminanceSquared / count - meanLum * meanLum : 0;
        return {
          id: rect.id,
          mean: [
            count ? r / count : 0,
            count ? g / count : 0,
            count ? b / count : 0
          ],
          stddev: Math.sqrt(Math.max(0, variance)),
          navyCoverage: count ? navyCount / count : 0
        };
      }

      const full = statsForRect({ id: "full", x: 0, y: 0, width: canvas.width, height: canvas.height });
      return {
        width: canvas.width,
        height: canvas.height,
        mean: full.mean,
        stddev: full.stddev,
        navyCoverage: full.navyCoverage,
        rects: (rawRects as Array<{ id: string; x: number; y: number; width: number; height: number }>).map(statsForRect)
      };
    }, `data:image/png;base64,${buffer.toString("base64")}`, rects);
  } finally {
    await page.close();
  }
}

async function comparePngs(browser: BrowserLike, left: Buffer, right: Buffer): Promise<number> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async (leftUrl, rightUrl) => {
      async function load(src: string): Promise<HTMLImageElement> {
        const image = new Image();
        image.src = src;
        await image.decode();
        return image;
      }
      const [leftImage, rightImage] = await Promise.all([load(leftUrl as string), load(rightUrl as string)]);
      if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) return 1;

      const canvas = document.createElement("canvas");
      canvas.width = leftImage.width;
      canvas.height = leftImage.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(leftImage, 0, 0);
      const leftData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(rightImage, 0, 0);
      const rightData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      let diff = 0;
      let count = 0;
      const step = 12;
      for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
          const index = (y * canvas.width + x) * 4;
          diff += Math.abs(leftData[index] - rightData[index]) / 255;
          diff += Math.abs(leftData[index + 1] - rightData[index + 1]) / 255;
          diff += Math.abs(leftData[index + 2] - rightData[index + 2]) / 255;
          count += 3;
        }
      }
      return count ? diff / count : 1;
    }, `data:image/png;base64,${left.toString("base64")}`, `data:image/png;base64,${right.toString("base64")}`);
  } finally {
    await page.close();
  }
}

function display(
  text: string,
  x: number,
  top: number,
  width: number,
  size: number,
  maxLines: number,
  color: string,
  align: "left" | "center" = "left"
): SceneText {
  return { text, x, top, width, size, lineHeight: Math.round(size * 1.04), maxLines, align, style: "sans", weight: 600, color, role: "headline" };
}

function body(
  text: string,
  x: number,
  top: number,
  width: number,
  size: number,
  maxLines: number,
  color: string,
  align: "left" | "center" = "left"
): SceneText {
  return { text, x, top, width, size, lineHeight: Math.round(size * 1.27), maxLines, align, style: "sans", color, role: "body" };
}

function label(
  text: string,
  x: number,
  top: number,
  width: number,
  color: string,
  align: "left" | "center" = "left"
): SceneText {
  return { text, x, top, width, size: 24, lineHeight: 30, maxLines: 1, align, style: "sans", weight: 600, color, uppercase: true, tracking: 2, role: "label" };
}

function darkField(accentX: string, blueY: string): string {
  return `<defs>
    <radialGradient id="accentField" cx="${accentX}" cy="34%" r="52%"><stop offset="0" stop-color="${ACCENT}" stop-opacity=".08"/><stop offset=".6" stop-color="${DEEP_NAVY}" stop-opacity=".03"/><stop offset="1" stop-color="${DEEP_NAVY}" stop-opacity="0"/></radialGradient>
    <radialGradient id="blueField" cx="78%" cy="${blueY}" r="62%"><stop offset="0" stop-color="${BLUE}" stop-opacity=".32"/><stop offset=".58" stop-color="${DEEP_NAVY}" stop-opacity=".16"/><stop offset="1" stop-color="${CHARCOAL}" stop-opacity="0"/></radialGradient>
  </defs><rect width="${WIDTH}" height="${HEIGHT}" fill="${DEEP_NAVY}"/><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#accentField)"/><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#blueField)"/><g fill="none" stroke="${BLUE}" stroke-linecap="round"><path d="M-90 550 C190 470 445 620 750 545 S1080 490 1290 530" stroke-opacity=".2" stroke-width="3"/><path d="M-80 595 C190 525 470 655 770 590 S1080 545 1280 575" stroke-opacity=".11" stroke-width="2"/><path d="M-60 635 C220 575 490 680 790 630 S1090 590 1270 615" stroke-opacity=".07" stroke-width="2"/></g>`;
}

function nodePattern(x: number, y: number, width: number, height: number, color = BLUE): string {
  const points = [[0.08, .2], [.38, .08], [.7, .3], [.92, .12], [.22, .72], [.55, .58], [.86, .82]];
  const lines = [[0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 6], [2, 5]];
  return `${lines.map(([a, b]) => `<line x1="${x + points[a][0] * width}" y1="${y + points[a][1] * height}" x2="${x + points[b][0] * width}" y2="${y + points[b][1] * height}" stroke="${color}" stroke-width="2"/>`).join("")}${points.map(([px, py]) => `<circle cx="${x + px * width}" cy="${y + py * height}" r="6" fill="${color}"/>`).join("")}`;
}

function padItems(items: VisualEvidenceItem[], fallback: string): VisualEvidenceItem[] {
  return Array.from({ length: 3 }, (_, index) => items[index] ?? { text: `${fallback} ${index + 1}`, source_excerpt: fallback });
}

async function embeddedLogo(kind: "blue" | "white" | "charcoal"): Promise<string> {
  const filePath = path.join(ROOT, "brand-kit", "assets", `splay-logo-${kind}.svg`);
  const bytes = await readFile(filePath);
  return `data:image/svg+xml;base64,${bytes.toString("base64")}`;
}

async function embeddedFontCss(): Promise<string> {
  const fonts = [
    { file: "Brawler-Regular.ttf", family: "Brawler", weight: "400" },
    { file: "InstrumentSans-Variable.ttf", family: "Instrument Sans", weight: "100 900" }
  ];
  const rules = await Promise.all(fonts.map(async (font) => {
    try {
      const bytes = await readFile(path.join(ROOT, "brand-kit", "fonts", font.file));
      return `@font-face{font-family:"${font.family}";src:url(data:font/ttf;base64,${bytes.toString("base64")}) format("truetype");font-weight:${font.weight};font-style:normal;font-display:block;}`;
    } catch {
      return "";
    }
  }));
  return rules.join("");
}

async function embeddedAsset(outputDir: string, assetPath: string): Promise<string> {
  const absolute = path.isAbsolute(assetPath) ? assetPath : path.join(outputDir, assetPath);
  return embeddedAbsoluteAsset(absolute);
}

async function embeddedAbsoluteAsset(absolutePath: string): Promise<string> {
  const bytes = await readFile(absolutePath);
  return `data:${mimeType(absolutePath)};base64,${bytes.toString("base64")}`;
}

function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function hexToRgb(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function failedCheckSummary(checks: VisualQaCheck[]): string {
  return checks
    .filter((checkItem) => !checkItem.ok)
    .map((checkItem) => `${checkItem.name}=${String(checkItem.value ?? "failed")}`)
    .join(", ");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}
