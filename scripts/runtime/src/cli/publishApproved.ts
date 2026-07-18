import { loadEnv } from "../config/loadEnv.ts";
import { BufferPublisher } from "../publishers/bufferPublisher.ts";
import { MockPublisher } from "../publishers/mockPublisher.ts";
import type { Publisher } from "../publishers/Publisher.ts";
import { applyPublishResult, loadPostPack } from "../storage/postStore.ts";
import { publishWithHosting } from "../publishers/publishWithHosting.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { getOutputDir, isTestMode } from "../config/runtimeMode.ts";

loadEnv();

const pack = await loadPostPack();
const approved = pack.posts.filter((post) => post.status === "approved");
const publisher = selectPublisher();

if (approved.length === 0) {
  console.log("No approved posts to stage.");
  process.exit(0);
}

let latestPack = pack;
for (const post of approved) {
  const result = await publishWithHosting(publisher, post);
  latestPack = await applyPublishResult(result);
  console.log(`${result.ok ? "Staged" : "Failed"} ${post.id}: ${result.message}`);
}

await renderPreview(latestPack);
console.log(`Stage logs written to ${getOutputDir()}/publish-log.jsonl`);

function selectPublisher(): Publisher {
  if (isTestMode()) return new MockPublisher();
  if (process.env.BUFFER_API_KEY && hasBufferProfileIds()) {
    return new BufferPublisher();
  }
  return new MockPublisher();
}

function hasBufferProfileIds(): boolean {
  return Boolean(process.env.BUFFER_LINKEDIN_PROFILE_IDS || process.env.BUFFER_X_PROFILE_IDS || process.env.BUFFER_PROFILE_IDS);
}
