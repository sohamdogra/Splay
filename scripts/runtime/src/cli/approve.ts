import { approvePost } from "../storage/postStore.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { getOutputDir } from "../config/runtimeMode.ts";

const reasonCodes = ["strong_insight", "strong_proof", "good_voice", "approved_without_note"];

const id = readArg("--id");
if (!id) {
  console.error("Usage: npm run approve -- --id <post_id>");
  process.exit(1);
}

try {
  const rawReason = readArg("--reason") ?? "approved_without_note";
  if (!reasonCodes.includes(rawReason)) throw new Error(`Invalid review reason: ${rawReason}`);
  const reason = rawReason as Parameters<typeof approvePost>[1];
  const note = readArg("--note");
  const pack = await approvePost(id, reason, note);
  await renderPreview(pack);
  console.log(`Approved post: ${id}`);
  console.log(`Preview refreshed: ${getOutputDir()}/latest-preview.html`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
