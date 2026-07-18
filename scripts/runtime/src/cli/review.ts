import path from "node:path";
import { renderPreview } from "../render/previewRenderer.ts";
import { getOutputDir } from "../config/runtimeMode.ts";
import { prepareLinkedInPublishContent } from "../linkedin/mentions.ts";
import { countCharacters, X_CHARACTER_LIMIT } from "../postText.ts";
import { loadPostPack } from "../storage/postStore.ts";
import type { GeneratedPost } from "../types/index.ts";

const pack = await loadPostPack();
const previewPath = await renderPreview(pack);

console.log(`Review generated: ${pack.generated_at}`);
console.log(`Preview: ${previewPath}`);
console.log(`Post pack: ${path.join(getOutputDir(), "post-pack.json")}`);

if (pack.posts.length === 0) {
  console.log("No posts found in the current post pack.");
  process.exit(0);
}

const counts = countByStatus(pack.posts);
console.log(`Posts: ${pack.posts.length} total, ${counts.draft ?? 0} draft, ${counts.approved ?? 0} approved, ${counts.rejected ?? 0} rejected, ${counts.staged ?? 0} staged, ${counts.failed ?? 0} failed`);
console.log("");

for (const post of pack.posts) {
  await printPost(post);
}

const draftPosts = pack.posts.filter((post) => post.status === "draft");
if (draftPosts.length > 0) {
  console.log("Review in the application or use the CLI:");
  for (const post of draftPosts) {
    console.log(`  npm run decide -- --id ${post.id} --decision approve --reason strong_insight`);
    console.log(`  npm run decide -- --id ${post.id} --decision revise --reason too_generic`);
  }
}

const approvedPosts = pack.posts.filter((post) => post.status === "approved");
if (approvedPosts.length > 0) {
  console.log("Queue approved posts:");
  console.log("  npm run queue-approved");
}

async function printPost(post: GeneratedPost): Promise<void> {
  const publishContent = await prepareLinkedInPublishContent(post);
  const count = countCharacters(publishContent.text);
  const limit = post.platform === "x" ? `/${X_CHARACTER_LIMIT}` : "";
  console.log(`[${post.status}] ${post.platform.toUpperCase()} ${post.id}`);
  console.log(`  Topic: ${post.topic}`);
  console.log(`  Text: ${count}${limit} chars`);
  if (post.scheduled_for) console.log(`  Scheduled for: ${post.scheduled_for}`);
  if (post.image_url) console.log(`  Image: ${resolveOutputPath(post.image_url)}`);
  if (post.platform === "linkedin") console.log(`  LinkedIn mentions: ${publishContent.annotations.length}`);
  if (post.warnings.length > 0) console.log(`  Warnings: ${post.warnings.join(" | ")}`);
  if (post.post_intent) console.log(`  Intent: ${post.post_intent.content_pillar} / ${post.post_intent.objective} / product ${post.post_intent.product_role}`);
  if (post.editorial_evaluation) {
    const editorial = post.editorial_evaluation.editorial_review;
    console.log(`  Editorial verdict: ${editorial.verdict} (evidence ${editorial.source_fidelity}, insight ${editorial.insight_strength}, specificity ${editorial.specificity}, novelty ${editorial.novelty}, voice ${editorial.voice})`);
  }
  const selectedCandidate = post.editorial_candidates?.find((candidate) => candidate.selected);
  if (selectedCandidate) console.log(`  Selected candidate: ${selectedCandidate.angle} (${selectedCandidate.score}) from ${post.editorial_candidates?.length ?? 1}`);
  console.log(`  Copy: ${oneLine(publishContent.text)}`);
  console.log("");
}

function countByStatus(posts: GeneratedPost[]): Record<string, number> {
  return posts.reduce<Record<string, number>>((counts, post) => {
    counts[post.status] = (counts[post.status] ?? 0) + 1;
    return counts;
  }, {});
}

function resolveOutputPath(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (path.isAbsolute(value)) return value;
  return path.join(getOutputDir(), value);
}

function oneLine(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 180 ? compact : `${compact.slice(0, 177).trimEnd()}...`;
}
