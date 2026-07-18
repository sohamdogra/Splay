import { loadEnv } from "../config/loadEnv.ts";
import { CompanyBrainClient } from "../brain/companyBrainClient.ts";
import { discoverTopicIdeas } from "../agents/topicDiscoveryAgent.ts";
import { generatePostsForIdea, postToRecentReference } from "../agents/postGenerationAgent.ts";
import { attachImages } from "../agents/imagePromptAgent.ts";
import { savePostPack } from "../storage/postStore.ts";
import { brandProfileFromKit, loadBrandKit } from "../storage/campaignStore.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { PostPack } from "../types/index.ts";
import { defaultContentProgram } from "../editorial/contentProgram.ts";
import { EDITORIAL_SPEC_VERSION } from "../editorial/editorialSpec.ts";
import { generateBackgroundAnimations } from "../agents/backgroundAnimationAgent.ts";

loadEnv();

export async function runGenerateAuto(media: "image" | "video" = readMediaArg()): Promise<PostPack> {
  const startedAt = Date.now();
  const brandKit = await loadBrandKit();
  const brand = brandProfileFromKit(brandKit);
  const platforms = readPlatformsArg();
  const brain = new CompanyBrainClient();
  const { ideas, themes } = await discoverTopicIdeas(brain, brand);
  if (ideas.length === 0) {
    throw new Error("The company brain has no public-safe context. Add context in Brand & brain before using auto generation.");
  }

  const selectedIdeas = ideas.slice(0, maxAutoIdeas());
  const drafts: PostPack["posts"] = [];
  const textStartedAt = Date.now();
  for (const idea of selectedIdeas) {
    const generated = await generatePostsForIdea(idea, brand, {
      recentPosts: drafts.map(postToRecentReference),
      platforms
    });
    drafts.push(...generated.map((post) => ({ ...post, brand_kit_version: brandKit.version })));
  }
  console.log(`[timing] text generation: ${((Date.now() - textStartedAt) / 1000).toFixed(1)}s`);
  const imageStartedAt = Date.now();
  const posts = await attachImages(drafts, undefined, brandKit);
  console.log(`[timing] image generation and render: ${((Date.now() - imageStartedAt) / 1000).toFixed(1)}s`);

  let pack: PostPack = {
    generated_at: new Date().toISOString(),
    brand,
    discovered_themes: themes,
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
  console.log(`Generated ${posts.length} ${media} drafts from ${selectedIdeas.length} idea${selectedIdeas.length === 1 ? "" : "s"}.`);
  console.log(`[timing] total workflow: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`Preview: ${previewPath}`);
  console.log(`Post pack: ${getOutputDir()}/post-pack.json`);
  return pack;
}

runGenerateAuto().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

function readMediaArg(): "image" | "video" {
  const index = process.argv.indexOf("--media");
  const value = index === -1 ? "image" : process.argv[index + 1];
  if (value !== "image" && value !== "video") throw new Error("--media must be image or video.");
  return value;
}

function readPlatformsArg(): Array<"linkedin" | "x"> {
  const index = process.argv.indexOf("--platforms");
  if (index === -1) return ["linkedin", "x"];
  const platforms = [...new Set((process.argv[index + 1] || "").split(",").map((value) => value.trim()).filter((value): value is "linkedin" | "x" => value === "linkedin" || value === "x"))];
  if (platforms.length === 0) throw new Error("--platforms must contain linkedin, x, or both.");
  return platforms;
}

function maxAutoIdeas(): number {
  const parsed = Number(process.env.SOCIAL_AGENT_AUTO_IDEA_LIMIT ?? "1");
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}
