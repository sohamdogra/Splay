import { loadEnv } from "../config/loadEnv.ts";
import { GBrainClient } from "../gbrain/gbrainClient.ts";
import { buildTopicFromManualInput } from "../agents/topicDiscoveryAgent.ts";
import { generatePostsForIdea, postToRecentReference } from "../agents/postGenerationAgent.ts";
import { attachImages } from "../agents/imagePromptAgent.ts";
import { loadPostPack, savePostPack } from "../storage/postStore.ts";
import {
  brandProfileFromKit,
  campaignSlots,
  getCampaign,
  loadBrandKit,
  updateCampaign
} from "../storage/campaignStore.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import type { GeneratedPost } from "../types/index.ts";

loadEnv();

const campaignId = readArg("--campaign");
if (!campaignId) {
  console.error("Usage: generateCampaign.ts --campaign CAMPAIGN_ID");
  process.exit(1);
}

const campaign = await getCampaign(campaignId);
if (!campaign) {
  console.error(`Campaign not found: ${campaignId}`);
  process.exit(1);
}

await updateCampaign(campaign.id, { status: "generating" });

try {
  const brandKit = await loadBrandKit();
  const brand = brandProfileFromKit(brandKit);
  const pack = await loadPostPack();
  const existing = pack.posts.filter((post) => post.campaign_id !== campaign.id);
  const generated: GeneratedPost[] = [];
  const gbrain = new GBrainClient();
  const slots = campaignSlots(campaign);

  for (const slot of slots) {
    const topic = `${campaign.brief}. Campaign ${campaign.name}, week ${slot.occurrence} of ${campaign.occurrences}. Weekly focus: ${slot.theme}`;
    const contexts = await gbrain.searchCompanyContext(topic);
    const idea = await buildTopicFromManualInput(topic, contexts, brand);
    const drafts = await generatePostsForIdea(idea, brand, {
      recentPosts: [...existing, ...generated].map(postToRecentReference)
    });
    generated.push(...drafts
      .filter((post) => campaign.platforms.includes(post.platform))
      .map((post) => ({
        ...post,
        campaign_id: campaign.id,
        campaign_occurrence: slot.occurrence,
        brand_kit_version: brandKit.version,
        scheduled_for: slot.scheduled_for
      })));
  }

  const posts = await attachImages(generated);
  const nextPack = {
    ...pack,
    brand,
    generated_at: new Date().toISOString(),
    discovered_themes: [...new Set([...pack.discovered_themes, campaign.name, ...campaign.themes])],
    posts: [...posts, ...existing]
  };
  await savePostPack(nextPack);
  await renderPreview(nextPack);
  await updateCampaign(campaign.id, {
    status: "active",
    generated_post_ids: posts.map((post) => post.id)
  });
  console.log(`Generated ${posts.length} scheduled drafts across ${slots.length} campaign weeks.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await updateCampaign(campaign.id, { status: "draft", last_error: message });
  console.error(message);
  process.exit(1);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
