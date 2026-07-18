import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { GeneratedPost } from "../types/index.ts";
import { attachImages } from "./imagePromptAgent.ts";

test("keeps curated SVG and Canva layouts on the same template metadata and bundled fonts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-image-layout-"));
  const previousImageMode = process.env.SOCIAL_AGENT_IMAGE_MODE;
  const previousMockMode = process.env.SOCIAL_AGENT_USE_MOCK_LLM;
  const previousApiKey = process.env.TOKENMART_API_KEY;
  process.env.SOCIAL_AGENT_IMAGE_MODE = "tokenmart-canva";
  process.env.SOCIAL_AGENT_USE_MOCK_LLM = "1";
  delete process.env.TOKENMART_API_KEY;

  try {
    const [post] = await attachImages([makePost()], outputDir);
    const png = await readFile(path.join(outputDir, post.image_url));
    const svg = await readFile(path.join(outputDir, `images/${post.id}.svg`), "utf8");
    const canvaHtml = await readFile(path.join(outputDir, post.visual ? `canva-imports/${post.id}.html` : ""), "utf8");
    const canvaRequests = JSON.parse(await readFile(path.join(outputDir, "canva-requests.json"), "utf8")) as Array<{
      local_preview_png: string;
      local_preview_svg: string;
      render_contract: { width: number; height: number; text_layers: Array<{ fits: boolean }> };
      qa: { ok: boolean; png_path: string };
      text_layers: { headline: string };
      visual: { template_family: string; density: string; motif: string };
    }>;
    const qaReports = JSON.parse(await readFile(path.join(outputDir, "visual-qa.json"), "utf8")) as Array<{ post_id: string; ok: boolean }>;
    const visual = post.visual;

    assert.equal(path.extname(post.image_url), ".png");
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(post.visual_qa?.ok, true);
    assert.equal(qaReports[0].post_id, post.id);
    assert.equal(qaReports[0].ok, true);
    assert.ok(visual);
    assert.equal(canvaRequests[0].visual.template_family, visual.template_family);
    assert.equal(canvaRequests[0].visual.density, visual.density);
    assert.equal(canvaRequests[0].visual.motif, visual.motif);
    assert.equal(canvaRequests[0].local_preview_png, post.image_url);
    assert.equal(canvaRequests[0].local_preview_svg, `images/${post.id}.svg`);
    assert.equal(canvaRequests[0].qa.ok, true);
    assert.equal(canvaRequests[0].qa.png_path, post.image_url);
    assert.equal(canvaRequests[0].render_contract.width, 1200);
    assert.equal(canvaRequests[0].render_contract.height, 675);
    assert.match(post.image_prompt, /dark navy-blue/i);
    assert.match(post.image_prompt, /layered flowing wave/i);
    assert.match(post.image_prompt, /1200x675/);
    assert.match(post.image_prompt, /Do not render words, letters, logos, brand marks.*typography.*CTA text, pricing, disclaimers/i);
    assert.match(post.image_prompt, /added afterward by a deterministic renderer, Canva, or Figma/i);
    assert.match(post.image_prompt, /never create a gray or washed-out neutral dominant field/i);
    assert.ok(canvaRequests[0].render_contract.text_layers.every((layer) => layer.fits));
    assert.notEqual(visual.brief.headline, post.topic);
    assert.ok(wordCount(visual.brief.headline) <= 7, visual.brief.headline);
    assert.ok(wordCount(visual.brief.supporting_text) <= 9, visual.brief.supporting_text);
    assert.doesNotMatch([
      visual.brief.headline,
      visual.brief.supporting_text,
      visual.brief.source_cue,
      ...visual.brief.points.map((item) => item.text),
      ...visual.brief.steps.map((item) => item.text),
      ...(visual.brief.contrast ? [visual.brief.contrast.left.text, visual.brief.contrast.right.text] : [])
    ].join(" "), /source-backed|source context|visible artifact|operating reality|evidence note|useful wedge|source trail|another destination|codify existing work|adoption cost/i);
    assert.equal(canvaRequests[0].text_layers.headline, visual.brief.headline);
    assert.notEqual(canvaRequests[0].text_layers.headline, post.topic);
    assert.match(svg, /@font-face\{font-family:"Brawler"/);
    assert.match(svg, /@font-face\{font-family:"Instrument Sans"/);
    assert.match(svg, /Splay/);
    assert.doesNotMatch(svg, /Splay\.io/);
    assert.doesNotMatch(svg, />SPLAY</);
    assert.match(svg, new RegExp(`&quot;template&quot;:&quot;${visual.template_family}&quot;`));

    assert.match(canvaHtml, new RegExp(`data-template-family="${visual.template_family}"`));
    assert.match(canvaHtml, new RegExp(`data-density="${visual.density}"`));
    assert.match(canvaHtml, new RegExp(`data-motif="${visual.motif}"`));
    assert.match(canvaHtml, /@font-face\{font-family:"Brawler"/);
    assert.match(canvaHtml, /left: 96px; top: 54px/);
  } finally {
    restoreEnv("SOCIAL_AGENT_IMAGE_MODE", previousImageMode);
    restoreEnv("SOCIAL_AGENT_USE_MOCK_LLM", previousMockMode);
    restoreEnv("TOKENMART_API_KEY", previousApiKey);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("creative mode generates separate visuals for each platform post", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-creative-images-"));
  const previousImageMode = process.env.SOCIAL_AGENT_IMAGE_MODE;
  const previousCreativeMode = process.env.SOCIAL_AGENT_CREATIVE_MODE;
  const previousUniqueImages = process.env.SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST;
  const previousMockMode = process.env.SOCIAL_AGENT_USE_MOCK_LLM;
  const previousApiKey = process.env.TOKENMART_API_KEY;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.SOCIAL_AGENT_IMAGE_MODE = "canva";
  process.env.SOCIAL_AGENT_CREATIVE_MODE = "1";
  process.env.SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST = "1";
  process.env.SOCIAL_AGENT_USE_MOCK_LLM = "1";
  delete process.env.TOKENMART_API_KEY;
  delete process.env.DATABASE_URL;

  try {
    const posts = await attachImages([
      makePost("linkedin", "idea-workflow-templates-linkedin-20260630200825123"),
      makePost("x", "idea-workflow-templates-x-20260630200825123")
    ], outputDir);

    assert.equal(posts.length, 2);
    assert.notEqual(posts[0].image_url, posts[1].image_url);
    assert.doesNotMatch((posts[1].image_notes ?? []).join(" "), /Uses shared image generated/);
  } finally {
    restoreEnv("SOCIAL_AGENT_IMAGE_MODE", previousImageMode);
    restoreEnv("SOCIAL_AGENT_CREATIVE_MODE", previousCreativeMode);
    restoreEnv("SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST", previousUniqueImages);
    restoreEnv("SOCIAL_AGENT_USE_MOCK_LLM", previousMockMode);
    restoreEnv("TOKENMART_API_KEY", previousApiKey);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("fails closed instead of substituting a deterministic live background", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "splay-live-background-failure-"));
  const previousImageMode = process.env.SOCIAL_AGENT_IMAGE_MODE;
  const previousMockMode = process.env.SOCIAL_AGENT_USE_MOCK_LLM;
  const previousApiKey = process.env.TOKENMART_API_KEY;
  const previousCandidateCount = process.env.TOKENMART_BACKGROUND_CANDIDATES;
  const previousRetries = process.env.TOKENMART_MAX_RETRIES;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.SOCIAL_AGENT_IMAGE_MODE = "tokenmart-canva";
  process.env.SOCIAL_AGENT_USE_MOCK_LLM = "1";
  process.env.TOKENMART_API_KEY = "test-key";
  process.env.TOKENMART_BACKGROUND_CANDIDATES = "2";
  process.env.TOKENMART_MAX_RETRIES = "0";
  delete process.env.DATABASE_URL;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: false,
      status: 503,
      async text() {
        return "image service unavailable";
      }
    } as Response;
  }) as typeof fetch;

  try {
    await assert.rejects(
      attachImages([makePost()], outputDir),
      /All 2 TokenMart background candidate\(s\) failed visual QA.*Refusing to substitute a deterministic live background/
    );
    assert.equal(calls, 2);
  } finally {
    restoreEnv("SOCIAL_AGENT_IMAGE_MODE", previousImageMode);
    restoreEnv("SOCIAL_AGENT_USE_MOCK_LLM", previousMockMode);
    restoreEnv("TOKENMART_API_KEY", previousApiKey);
    restoreEnv("TOKENMART_BACKGROUND_CANDIDATES", previousCandidateCount);
    restoreEnv("TOKENMART_MAX_RETRIES", previousRetries);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    globalThis.fetch = previousFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});

function makePost(platform: GeneratedPost["platform"] = "linkedin", id = "idea-workflow-templates-linkedin-20260630200825"): GeneratedPost {
  return {
    id,
    source_context: {
      summary: "The product team shipped a first pass at reusable workflow templates for recurring deal motions.",
      gbrain_references: ["product_updates/2026-06-21-workflow-templates"],
      why_now: "This theme is active in company context."
    },
    platform,
    topic: "Workflow templates beat blank-page automation",
    post_text: "A test post.",
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}
