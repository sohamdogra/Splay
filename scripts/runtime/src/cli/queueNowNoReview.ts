import { loadEnv } from "../config/loadEnv.ts";
import { isTestMode } from "../config/runtimeMode.ts";
import { BufferPublisher } from "../publishers/bufferPublisher.ts";
import { MockPublisher } from "../publishers/mockPublisher.ts";
import type { Publisher } from "../publishers/Publisher.ts";
import { publishWithHosting } from "../publishers/publishWithHosting.ts";
import { applyPublishResult, loadPostPack } from "../storage/postStore.ts";

loadEnv();

if (!process.argv.includes("--no-review")) {
  console.error("Refusing direct Buffer queueing without --no-review.");
  process.exit(1);
}

const pack = await loadPostPack();
const candidates = pack.posts.filter((post) => post.status === "draft" || post.status === "approved");
if (candidates.length === 0) {
  console.log("No draft or approved posts to queue.");
  process.exit(0);
}

const publisher = selectPublisher();
let ok = 0;
let failed = 0;

for (const post of candidates) {
  const result = await publishWithHosting(publisher, post);
  await applyPublishResult(result);
  if (result.ok) ok += 1;
  else failed += 1;
}

console.log(`No-review queue complete: ${ok} accepted, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;

function selectPublisher(): Publisher {
  if (isTestMode()) return new MockPublisher();
  return new BufferPublisher();
}
