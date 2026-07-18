import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import { renderCuratedVisual } from "../render/socialVisualRenderer.ts";
import type { GeneratedPost, VisualMetadata, VisualTemplateFamily } from "../types/index.ts";

const families: VisualTemplateFamily[] = [
  "dark-editorial-thesis",
  "light-minimal-thesis",
  "split-contrast",
  "source-evidence-card",
  "three-point-principles",
  "three-step-workflow",
  "relationship-source-map",
  "product-proof"
];
const outputDir = path.join(getOutputDir(), "visual-contact-sheet");
await mkdir(path.join(outputDir, "images"), { recursive: true });
await mkdir(path.join(outputDir, "canva-imports"), { recursive: true });

const cards = [];
for (const family of families) {
  const post = makePost(family);
  const visual = metadata(family);
  const rendered = await renderCuratedVisual(post, visual, outputDir);
  cards.push(`<article><img src="${rendered.imageUrl}" alt="${family}"><h2>${family.replace(/-/g, " ")}</h2><p>${visual.density} · ${visual.palette} · ${visual.motif}</p></article>`);
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Arvya visual template contact sheet</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; background: #0b1018; color: #f9fafb; font-family: system-ui, sans-serif; }
    header { max-width: 1440px; margin: 0 auto 28px; }
    h1 { margin: 0 0 8px; font: 400 44px Georgia, serif; }
    header p, article p { color: #d3d6d9; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; max-width: 1440px; margin: auto; }
    article { overflow: hidden; border: 1px solid #3a424e; border-radius: 12px; background: #252a31; }
    img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; }
    h2 { margin: 18px 18px 5px; font-size: 17px; text-transform: capitalize; }
    article p { margin: 0 18px 18px; font-size: 13px; }
  </style>
</head>
<body>
  <header><h1>Curated visual system</h1><p>All approved template families rendered from the same concise fixture.</p></header>
  <main>${cards.join("")}</main>
</body>
</html>`;
await writeFile(path.join(outputDir, "index.html"), html, "utf8");
console.log(path.join(outputDir, "index.html"));

function metadata(family: VisualTemplateFamily): VisualMetadata {
  const complex = ["three-step-workflow", "relationship-source-map", "product-proof"].includes(family);
  const simple = family.includes("thesis");
  const items = [
    { text: "Capture the decision trail", source_excerpt: "Capture the decision trail" },
    { text: "Keep open risks visible", source_excerpt: "Keep open risks visible" },
    { text: "Carry context into execution", source_excerpt: "Carry context into execution" }
  ];
  const lookup = {
    "dark-editorial-thesis": ["charcoal", "citation-rail"],
    "light-minimal-thesis": ["mist", "quiet-geometry"],
    "split-contrast": ["split", "split-plane"],
    "source-evidence-card": ["charcoal", "document-fragments"],
    "three-point-principles": ["mist", "numbered-stack"],
    "three-step-workflow": ["charcoal", "source-trail"],
    "relationship-source-map": ["split", "node-map"],
    "product-proof": ["charcoal", "product-frame"]
  } as const;
  return {
    template_family: family,
    density: simple ? "simple" : complex ? "complex" : "structured",
    palette: lookup[family][0],
    motif: lookup[family][1],
    brief: {
      content_mode: complex ? "workflow" : family === "split-contrast" ? "contrast" : "principles",
      headline: "Deal context should survive every handoff",
      supporting_text: "Keep the why close to the work.",
      points: items,
      steps: items,
      contrast: { left: { text: "Shows the work", source_excerpt: "Shows the work" }, right: { text: "Needs an owner", source_excerpt: "Needs an owner" } },
      source_cue: "FROM THE WORK",
      validation_status: "validated"
    }
  };
}

function makePost(family: VisualTemplateFamily): GeneratedPost {
  return {
    id: `contact-sheet-${family}`,
    source_context: { summary: "Work should carry the why.", gbrain_references: [], why_now: "" },
    platform: "linkedin",
    topic: "Deal context should survive every handoff",
    post_text: "Test",
    image_prompt: "",
    image_url: "",
    image_provider: "placeholder",
    canva_design_url: null,
    alt_text: "",
    hashtags: [],
    status: "draft",
    created_at: "2026-06-30T00:00:00.000Z",
    scheduled_for: null,
    quality_score: { hook: 8, clarity: 8, brand_fit: 8, platform_fit: 8, overall: 8 },
    warnings: []
  };
}
