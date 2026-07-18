import { loadEnv } from "../config/loadEnv.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { schedulePosts, type SchedulePostFilter } from "../storage/postStore.ts";
import type { Platform } from "../types/index.ts";

loadEnv();

const clear = process.argv.includes("--clear");
const scheduledFor = readArg("--time") ?? readArg("--scheduled-for") ?? readArg("--at");
const id = readArg("--id");

try {
  const platform = normalizePlatform(readArg("--platform"));
  const all = process.argv.includes("--all") || (!id && !platform);

  if (!clear && !scheduledFor) {
    console.error("Usage: schedule --time <ISO-8601-with-timezone> [--all | --id <post_id> | --platform linkedin|x]");
    console.error("       schedule --clear [--all | --id <post_id> | --platform linkedin|x]");
    process.exit(1);
  }

  if ([Boolean(id), Boolean(platform), all && (Boolean(id) || Boolean(platform))].filter(Boolean).length > 1) {
    console.error("Use only one schedule target: --all, --id, or --platform.");
    process.exit(1);
  }

  const filter: SchedulePostFilter = { id, platform, all };
  const { pack, updated } = await schedulePosts(filter, clear ? null : scheduledFor ?? null);
  const previewPath = await renderPreview(pack);
  const label = clear ? "Cleared schedule for" : `Scheduled for ${updated[0]?.scheduled_for}`;
  for (const post of updated) console.log(`${label}: ${post.id} (${post.platform})`);
  console.log(`Preview refreshed: ${previewPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function normalizePlatform(value: string | undefined): Platform | undefined {
  if (!value) return undefined;
  if (value === "linkedin" || value === "x") return value;
  throw new Error(`Unsupported platform: ${value}. Use linkedin or x.`);
}
