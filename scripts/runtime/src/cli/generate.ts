import { loadEnv } from "../config/loadEnv.ts";
import { CompanyBrainClient } from "../brain/companyBrainClient.ts";
import { buildTopicFromManualInput, parseManualPostRequest } from "../agents/topicDiscoveryAgent.ts";
import { generatePostsForIdea } from "../agents/postGenerationAgent.ts";
import { attachImages } from "../agents/imagePromptAgent.ts";
import { savePostPack } from "../storage/postStore.ts";
import { brandProfileFromKit, loadBrandKit } from "../storage/campaignStore.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import type { PostPack } from "../types/index.ts";
import { defaultContentProgram } from "../editorial/contentProgram.ts";
import { EDITORIAL_SPEC_VERSION } from "../editorial/editorialSpec.ts";
import { generateBackgroundAnimations } from "../agents/backgroundAnimationAgent.ts";

loadEnv();

const topic = readArg("--topic");
const media = readMediaArg();
if (!topic) {
  console.error('Usage: npm run generate -- --topic "your topic"');
  process.exit(1);
}

const startedAt = Date.now();
const brandKit = await loadBrandKit();
const brand = brandProfileFromKit(brandKit);
const platforms = readPlatformsArg();
const brain = new CompanyBrainClient();
const request = parseManualPostRequest(topic);
const contexts = await brain.searchCompanyContext(`${request.topic} ${request.brief}`);
const idea = await buildTopicFromManualInput(topic, contexts, brand);
const textStartedAt = Date.now();
const drafts = (await generatePostsForIdea(idea, brand, { platforms }))
  .map((post) => ({ ...post, brand_kit_version: brandKit.version }));
console.log(`[timing] text generation: ${elapsedSeconds(textStartedAt)}s`);
const imageStartedAt = Date.now();
const posts = await attachImages(drafts, undefined, brandKit);
console.log(`[timing] image generation and render: ${elapsedSeconds(imageStartedAt)}s`);

let pack: PostPack = {
  generated_at: new Date().toISOString(),
  brand,
  discovered_themes: [idea.topic],
  posts,
  publish_logs: [],
  editorial_spec_version: EDITORIAL_SPEC_VERSION,
  content_program: defaultContentProgram()
};

await savePostPack(pack);
if (media === "video") {
  pack = { ...pack, posts: await generateBackgroundAnimations(posts) };
  await savePostPack(pack);
}
const previewPath = await renderPreview(pack);
console.log(`Generated ${posts.length} ${media} drafts for "${idea.topic}".`);
console.log(`[timing] total workflow: ${elapsedSeconds(startedAt)}s`);
console.log(`Preview: ${previewPath}`);

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readMediaArg(): "image" | "video" {
  const value = readArg("--media") || "image";
  if (value !== "image" && value !== "video") throw new Error("--media must be image or video.");
  return value;
}

function readPlatformsArg(): Array<"linkedin" | "x"> {
  const raw = readArg("--platforms");
  if (!raw) return ["linkedin", "x"];
  const platforms = [...new Set(raw.split(",").map((value) => value.trim()).filter((value): value is "linkedin" | "x" => value === "linkedin" || value === "x"))];
  if (platforms.length === 0) throw new Error("--platforms must contain linkedin, x, or both.");
  return platforms;
}

function elapsedSeconds(startedAt: number): string {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}
