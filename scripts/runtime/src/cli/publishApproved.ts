import { loadEnv } from "../config/loadEnv.ts";
import { BufferPublisher } from "../publishers/bufferPublisher.ts";
import { MockPublisher } from "../publishers/mockPublisher.ts";
import type { Publisher } from "../publishers/Publisher.ts";
import { applyPublishResult, loadPostPack } from "../storage/postStore.ts";
import { publishWithHosting } from "../publishers/publishWithHosting.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { getOutputDir, isTestMode } from "../config/runtimeMode.ts";
import { listCampaigns } from "../storage/campaignStore.ts";

loadEnv();

const pack = await loadPostPack();
const postId = readArg("--post-id");
const publishMode = readArg("--mode") === "queue" ? "queue" : "now";
const activeCampaignIds = new Set((await listCampaigns()).filter((campaign) => campaign.status === "active").map((campaign) => campaign.id));
const approved = pack.posts.filter((post) => post.status === "approved"
  && (!postId || post.id === postId)
  && (!post.campaign_id || activeCampaignIds.has(post.campaign_id)));
const publisher = selectPublisher();

if (approved.length === 0) {
  console.log("No eligible approved posts to publish. Paused campaign posts remain local.");
  process.exit(0);
}

let latestPack = pack;
for (const post of approved) {
  const result = await publishWithHosting(publisher, post);
  latestPack = await applyPublishResult(result);
  console.log(`${result.ok ? (result.target_status === "posted" ? "Posted" : "Scheduled") : "Failed"} ${post.id}: ${result.message}`);
}

await renderPreview(latestPack);
console.log(`Stage logs written to ${getOutputDir()}/publish-log.jsonl`);

function selectPublisher(): Publisher {
  if (isTestMode()) return new MockPublisher();
  if (process.env.BUFFER_API_KEY && hasBufferProfileIds()) {
    return new BufferPublisher({ mode: publishMode });
  }
  return new MockPublisher();
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasBufferProfileIds(): boolean {
  return Boolean(process.env.BUFFER_LINKEDIN_PROFILE_IDS || process.env.BUFFER_X_PROFILE_IDS || process.env.BUFFER_PROFILE_IDS);
}
