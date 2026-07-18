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

loadEnv();

export async function runGenerateAuto(): Promise<PostPack> {
  const brand = brandProfileFromKit(await loadBrandKit());
  const brain = new CompanyBrainClient();
  const { ideas, themes } = await discoverTopicIdeas(brain, brand);
  if (ideas.length === 0) {
    throw new Error("The company brain has no public-safe context. Add context in Brand & brain before using auto generation.");
  }

  const drafts: PostPack["posts"] = [];
  for (const idea of ideas) {
    const generated = await generatePostsForIdea(idea, brand, {
      recentPosts: drafts.map(postToRecentReference)
    });
    drafts.push(...generated);
  }
  const posts = await attachImages(drafts);

  const pack: PostPack = {
    generated_at: new Date().toISOString(),
    brand,
    discovered_themes: themes,
    posts,
    publish_logs: [],
    editorial_spec_version: EDITORIAL_SPEC_VERSION,
    content_program: defaultContentProgram()
  };

  await savePostPack(pack);
  const previewPath = await renderPreview(pack);
  console.log(`Generated ${posts.length} drafts from ${ideas.length} ideas.`);
  console.log(`Preview: ${previewPath}`);
  console.log(`Post pack: ${getOutputDir()}/post-pack.json`);
  return pack;
}

runGenerateAuto().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
