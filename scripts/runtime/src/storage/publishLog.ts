import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { PublishResult } from "../types/index.ts";

// Single writer for the publish audit trail. Every publish outcome — success, Buffer
// rejection, or a pre-Buffer failure like image hosting failing closed — is appended here
// so output/publish-log.jsonl is a complete record, not just what BufferPublisher saw.

export async function appendPublishLog(result: PublishResult): Promise<PublishResult> {
  const outputDir = getOutputDir();
  await mkdir(outputDir, { recursive: true });
  await appendFile(path.join(outputDir, "publish-log.jsonl"), `${JSON.stringify(result)}\n`, "utf8");
  return result;
}
