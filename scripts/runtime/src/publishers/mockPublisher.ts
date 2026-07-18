import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { GeneratedPost, PublishResult } from "../types/index.ts";
import type { Publisher } from "./Publisher.ts";

export class MockPublisher implements Publisher {
  async publish(post: GeneratedPost): Promise<PublishResult> {
    const outputDir = getOutputDir();
    await mkdir(outputDir, { recursive: true });
    const result: PublishResult = {
      post_id: post.id,
      ok: true,
      publisher: "mock",
      target_status: post.scheduled_for ? "staged" : "posted",
      published_url: `https://mock.publisher.local/${post.platform}/${post.id}`,
      message: "Mock publish completed. No external API was called.",
      payload: {
        platform: post.platform,
        text: post.post_text,
        image_url: post.image_url,
        hashtags: post.hashtags,
        scheduled_for: post.scheduled_for
      },
      published_at: new Date().toISOString()
    };

    await appendFile(path.join(outputDir, "publish-log.jsonl"), `${JSON.stringify(result)}\n`, "utf8");
    return result;
  }
}
