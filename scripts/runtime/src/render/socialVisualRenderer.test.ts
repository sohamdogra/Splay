import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { BrandKit, GeneratedPost, VisualMetadata, VisualTemplateFamily } from "../types/index.ts";
import { buildTemplateSceneForTest, lockVisualToImageCopy, renderCuratedVisual } from "./socialVisualRenderer.ts";

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

test("keeps text boxes inside the 96px horizontal and 54px vertical safe area for every curated family", () => {
  for (const family of families) {
    const scene = buildTemplateSceneForTest(makePost(), metadata(family));
    for (const text of scene.texts) {
      assert.ok(text.x >= 96, `${family}: x=${text.x}`);
      assert.ok(text.x + text.width <= 1104, `${family}: right=${text.x + text.width}`);
      assert.ok(text.top >= 54, `${family}: top=${text.top}`);
      assert.ok(text.top + text.lineHeight * text.maxLines <= 621, `${family}: bottom overflow`);
    }
  }
});

test("keeps curated template text slots compact", () => {
  for (const family of families) {
    const scene = buildTemplateSceneForTest(makePost(), metadata(family));
    for (const text of scene.texts) {
      if (text.uppercase) {
        assert.equal(text.maxLines, 1, `${family}: label expanded beyond one line`);
      } else if (text.role === "headline") {
        assert.ok(text.maxLines <= 3, `${family}: display slot allows ${text.maxLines} lines`);
      } else {
        assert.ok(text.maxLines <= 2, `${family}: body slot allows ${text.maxLines} lines`);
      }
    }
  }
});

test("locks the standard compositor to exact gated image copy", () => {
  const post = {
    ...makePost(),
    image_copy: {
      headline: "Prep before the scramble",
      support: "Briefs should arrive when calls get scheduled"
    }
  };
  const locked = lockVisualToImageCopy(post, metadata("source-evidence-card"));
  const scene = buildTemplateSceneForTest(post, locked);

  assert.equal(locked.template_family, "dark-editorial-thesis");
  assert.equal(locked.brief.source_cue, "");
  assert.deepEqual(
    scene.texts.map((text) => text.text).filter(Boolean),
    [post.image_copy.headline, post.image_copy.support]
  );
});

test("measures generated background noise before typography and preserves provider artwork", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-generated-background-"));
  await Promise.all(["images", "canva-imports"].map((dir) => mkdir(path.join(outputDir, dir), { recursive: true })));
  const backgroundPath = path.join(outputDir, "quiet-generated-background.svg");
  await writeFile(backgroundPath, campaignBackgroundSvg(), "utf8");

  try {
    const post = {
      ...makePost(),
      id: "generated-background-copy",
      image_copy: {
        headline: "Keep trackers current",
        support: "Review email changes before Excel writeback"
      }
    };
    const result = await renderCuratedVisual(post, metadata("dark-editorial-thesis"), outputDir, backgroundPath);
    const svg = await readFile(path.join(outputDir, result.svgUrl), "utf8");
    const noise = result.qa.checks.find((check) => check.name === "background_text_noise");
    const textVisible = result.qa.checks.find((check) => check.name === "text_layers_visible_in_final_raster");

    assert.equal(result.qa.ok, true);
    assert.equal(noise?.ok, true);
    assert.equal(textVisible?.ok, true);
    assert.ok(Number(noise?.value) <= 36, `background noise=${noise?.value}`);
    assert.match(svg, /stop-opacity="\.48"/);
    assert.match(svg, /fill="#[0-9A-F]+" opacity="\.18"/i);
    assert.doesNotMatch(svg, /M-90 555/);
    assert.doesNotMatch(svg, /node-map|campaign-lower-third/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("rejects gray and visually empty generated backgrounds", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-empty-background-"));
  await Promise.all(["images", "canva-imports"].map((dir) => mkdir(path.join(outputDir, dir), { recursive: true })));
  const backgroundPath = path.join(outputDir, "gray-empty-background.svg");
  await writeFile(backgroundPath, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#777777"/></svg>`, "utf8");

  try {
    const post = {
      ...makePost(),
      id: "gray-empty-background",
      image_copy: {
        headline: "Keep trackers current",
        support: "Review email changes before Excel writeback"
      }
    };
    await assert.rejects(
      renderCuratedVisual(post, metadata("dark-editorial-thesis"), outputDir, backgroundPath),
      /dark_blue_color_bias|dark_navy_pixel_coverage|lower_third_wave_activity|generated_background_visual_activity/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("renders matching SVG and Canva metadata for every curated family", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-template-render-"));
  const officialBlueLogo = (await readFile(path.resolve("brand-kit/assets/splay-logo-blue.svg"))).toString("base64");
  await Promise.all(["images", "canva-imports"].map(async (dir) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(outputDir, dir), { recursive: true });
  }));

  try {
    for (const family of families) {
      const post = { ...makePost(), id: `render-${family}` };
      const visual = metadata(family);
      const result = await renderCuratedVisual(post, visual, outputDir);
      const png = await readFile(path.join(outputDir, result.pngUrl));
      const svg = await readFile(path.join(outputDir, result.svgUrl), "utf8");
      const html = await readFile(path.join(outputDir, result.canvaImportHtml), "utf8");
      assert.equal(result.imageUrl, result.pngUrl);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(result.qa.ok, true);
      assert.equal(result.qa.dimensions.width, 1200);
      assert.equal(result.qa.dimensions.height, 675);
      assert.ok(result.renderContract.text_layers.every((layer) => layer.fits), `${family}: fitted text`);
      assert.match(svg, new RegExp(`&quot;template&quot;:&quot;${family}&quot;`));
      assert.match(html, new RegExp(`data-template-family="${family}"`));
      assert.match(svg, /Splay/);
      assert.match(html, /Splay/);
      assert.doesNotMatch(svg, /Splay\.io/);
      assert.doesNotMatch(html, /Splay\.io/);
      assert.doesNotMatch(svg, /VISIBLE ARTIFACT|OPERATING REALITY|EVIDENCE NOTE|SOURCE TO ACTION|SOURCE 0|STEP 0|SOURCE CONTEXT|SOURCE-BACKED|THINGS TO KEEP|ADOPTION COST|CODIFY EXISTING WORK/i);
      assert.doesNotMatch(svg, /\u2026|[.]{3}/);
      assert.ok(result.renderContract.signature.logo_size >= 64);
      assert.ok(result.renderContract.signature.font_size >= 30);

      if (family === "dark-editorial-thesis") {
        const headline = result.renderContract.text_layers.find((layer) => layer.role === "headline");
        const support = result.renderContract.text_layers.find((layer) => layer.role === "body");
        assert.ok(headline && support);
        assert.equal(headline.font_family, "Instrument Sans");
        assert.equal(headline.font_weight, 600);
        assert.ok(svg.includes(officialBlueLogo), "dark thesis must embed the bundled official blue logo bytes");
        const gap = support.y - (headline.y + headline.height);
        assert.ok(gap >= 28 && gap <= 100, `headline/support gap=${gap}`);
        assert.equal(result.qa.checks.find((check) => check.name === "brand_signature_scale")?.ok, true);
        assert.equal(result.qa.checks.find((check) => check.name === "dark_blue_color_bias")?.ok, true);
        assert.equal(result.qa.checks.find((check) => check.name === "dark_navy_pixel_coverage")?.ok, true);
        assert.equal(result.qa.checks.find((check) => check.name === "lower_third_wave_activity")?.ok, true);
        assert.equal(result.qa.checks.find((check) => check.name === "hierarchy_headline_support_gap")?.ok, true);
      }
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("fits the source-evidence-card headline without truncation", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-source-card-render-"));
  await Promise.all(["images", "canva-imports"].map(async (dir) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(outputDir, dir), { recursive: true });
  }));

  try {
    const result = await renderCuratedVisual(
      { ...makePost(), id: "source-card-fit" },
      metadata("source-evidence-card"),
      outputDir
    );
    const svg = await readFile(path.join(outputDir, result.svgUrl), "utf8");
    assert.equal(result.qa.ok, true);
    assert.doesNotMatch(svg, /survive every\u2026|survive every[.]{3}/);
    assert.match(svg, /handoff/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("renders a non-Splay brand with its saved palette, wordmark, and typography", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "custom-brand-render-"));
  await Promise.all(["images", "canva-imports"].map((dir) => mkdir(path.join(outputDir, dir), { recursive: true })));
  const brandKit: BrandKit = {
    version: 3,
    updated_at: "2026-07-18T21:58:26.611Z",
    name: "Churnary",
    tagline: "AI retention for local business",
    audience: "local business owners",
    tone: "warm and plainspoken",
    positioning: "Practical customer retention.",
    avoid: ["AI hype"],
    colors: { primary: "#B4532A", secondary: "#3B2A20", accent: "#73E2C5", background: "#F0E7D8", text: "#2A211C" },
    typography: { heading_family: "Spectral", body_family: "Hanken Grotesk", heading_weight: 700, body_weight: 400, scale: "balanced" },
    logo_url: null
  };

  try {
    const result = await renderCuratedVisual(makePost(), metadata("dark-editorial-thesis"), outputDir, null, brandKit);
    const svg = await readFile(path.join(outputDir, result.svgUrl), "utf8");
    assert.equal(result.qa.ok, true);
    assert.match(svg, /Churnary/);
    assert.match(svg, /#B4532A/i);
    assert.match(svg, /#3B2A20/i);
    assert.match(svg, /#73E2C5/i);
    assert.doesNotMatch(svg, />Splay</);
    assert.equal(result.renderContract.signature.wordmark, "Churnary");
    assert.equal(result.renderContract.signature.font_family, "Hanken Grotesk");
    assert.equal(result.renderContract.text_layers.find((layer) => layer.role === "headline")?.font_family, "Spectral");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

function metadata(family: VisualTemplateFamily): VisualMetadata {
  const density = family.includes("thesis") ? "simple"
    : ["three-step-workflow", "relationship-source-map", "product-proof"].includes(family) ? "complex" : "structured";
  const motif = {
    "dark-editorial-thesis": "citation-rail",
    "light-minimal-thesis": "quiet-geometry",
    "split-contrast": "split-plane",
    "source-evidence-card": "document-fragments",
    "three-point-principles": "numbered-stack",
    "three-step-workflow": "source-trail",
    "relationship-source-map": "node-map",
    "product-proof": "product-frame"
  }[family] as VisualMetadata["motif"];
  const palette = family === "light-minimal-thesis" || family === "three-point-principles" ? "mist"
    : family === "split-contrast" || family === "relationship-source-map" ? "split" : "charcoal";
  const items = [
    { text: "Capture the decision trail", source_excerpt: "Capture the decision trail" },
    { text: "Keep open risks visible", source_excerpt: "Keep open risks visible" },
    { text: "Carry context into execution", source_excerpt: "Carry context into execution" }
  ];
  return {
    template_family: family,
    density,
    motif,
    palette,
    brief: {
      content_mode: "workflow",
      headline: "Deal context should survive every handoff",
      supporting_text: "Keep the why close to the work.",
      points: items,
      steps: items,
      contrast: { left: items[0], right: items[1] },
      source_cue: "FROM THE WORK",
      validation_status: "validated"
    }
  };
}

function makePost(): GeneratedPost {
  return {
    id: "renderer-post",
    source_context: { summary: "Context", gbrain_references: [], why_now: "" },
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

function campaignBackgroundSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <rect width="1200" height="675" fill="#020D20"/>
    <rect x="900" y="150" width="250" height="100" rx="18" fill="#0B2946" stroke="#287AB0" stroke-width="3"/>
    <rect x="940" y="280" width="210" height="100" rx="18" fill="#0A223A" stroke="#C9933C" stroke-width="3"/>
    <path d="M-80 545 C210 430 470 640 760 535 S1080 450 1280 510" fill="none" stroke="#35A9F2" stroke-width="18"/>
    <path d="M-100 590 C180 490 490 665 780 580 S1090 510 1290 555" fill="none" stroke="#D5A03E" stroke-width="9"/>
    <path d="M-100 635 C210 550 510 690 800 625 S1100 570 1290 610" fill="none" stroke="#1D6EA2" stroke-width="12"/>
  </svg>`;
}
