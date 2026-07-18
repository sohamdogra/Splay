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

const brand = brandProfileFromKit(await loadBrandKit());
const brain = new CompanyBrainClient();
const request = parseManualPostRequest(topic);
const contexts = await brain.searchCompanyContext(`${request.topic} ${request.brief}`);
const idea = await buildTopicFromManualInput(topic, contexts, brand);
const drafts = await generatePostsForIdea(idea, brand);
const posts = await attachImages(drafts);

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
