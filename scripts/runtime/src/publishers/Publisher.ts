import type { GeneratedPost, PublishResult } from "../types/index.ts";

export interface Publisher {
  publish(post: GeneratedPost): Promise<PublishResult>;
}
