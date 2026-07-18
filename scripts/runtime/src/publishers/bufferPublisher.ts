import { mkdir } from "node:fs/promises";
import { getOutputDir } from "../config/runtimeMode.ts";
import { prepareLinkedInPublishContent, type LinkedInPublishContent } from "../linkedin/mentions.ts";
import { validatePlatformPost } from "../postText.ts";
import { appendPublishLog } from "../storage/publishLog.ts";
import type { GeneratedPost, Platform, PublishResult } from "../types/index.ts";
import { FINAL_IMAGE_HEIGHT, FINAL_IMAGE_WIDTH } from "../visual/finalImageContract.ts";
import type { Publisher } from "./Publisher.ts";

type PublishMode = "queue" | "now";
type BufferShareMode = "addToQueue" | "shareNow" | "customScheduled";

export class BufferPublisher implements Publisher {
  private readonly apiKey: string;
  private readonly fallbackProfileIds: string[];
  private readonly platformProfileIds: Record<Platform, string[]>;
  private readonly apiUrl: string;
  private readonly mode: PublishMode;

  constructor(options: { mode?: PublishMode } = {}) {
    this.apiKey = String(process.env.BUFFER_API_KEY ?? "");
    this.fallbackProfileIds = parseIds(process.env.BUFFER_PROFILE_IDS);
    this.platformProfileIds = {
      linkedin: parseIds(process.env.BUFFER_LINKEDIN_PROFILE_IDS),
      x: parseIds(process.env.BUFFER_X_PROFILE_IDS)
    };
    this.apiUrl = String(process.env.BUFFER_API_URL ?? "https://api.buffer.com");
    this.mode = options.mode ?? (process.env.BUFFER_PUBLISH_MODE === "queue" ? "queue" : "now");
  }

  async publish(post: GeneratedPost): Promise<PublishResult> {
    await mkdir(getOutputDir(), { recursive: true });
    const profileIds = this.profileIdsFor(post.platform);

    if (!this.apiKey || profileIds.length === 0) {
      return this.log({
        post_id: post.id,
        ok: false,
        publisher: "buffer",
        message: `BUFFER_API_KEY and Buffer profile IDs for ${post.platform} are required.`,
        published_at: new Date().toISOString()
      });
    }

    const assets = buildAssets(post);
    const schedule = resolveSchedule(post, this.mode);
    if (!schedule.ok) {
      return this.log({
        post_id: post.id,
        ok: false,
        publisher: "buffer",
        message: schedule.message,
        payload: {
          target_platform: post.platform,
          target_profile_ids: profileIds,
          requested_scheduled_for: post.scheduled_for
        },
        published_at: new Date().toISOString()
      });
    }

    let publishContent: LinkedInPublishContent;
    try {
      publishContent = await prepareLinkedInPublishContent(post);
    } catch (error) {
      return this.log({
        post_id: post.id,
        ok: false,
        publisher: "buffer",
        message: `LinkedIn mention preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        published_at: new Date().toISOString()
      });
    }

    const payload = {
      text: publishContent.text,
      channel_ids: profileIds,
      assets,
      mode: schedule.mode,
      due_at: schedule.dueAt,
      metadata: publishContent.metadata,
      linkedin_mentions: publishContent.mentionedEntities
    };
    const validation = validatePlatformPost(post.platform, post.post_text, post.hashtags);

    if (!validation.ok) {
      return this.log({
        post_id: post.id,
        ok: false,
        publisher: "buffer",
        message: validation.message ?? "Post does not meet platform publishing requirements.",
        payload: {
          target_platform: post.platform,
          target_profile_ids: profileIds,
          mode: schedule.mode,
          due_at: schedule.dueAt,
          character_count: validation.count,
          character_limit: validation.limit,
          omitted_local_media: post.image_url && assets.length === 0 ? post.image_url : undefined
        },
        published_at: new Date().toISOString()
      });
    }

    try {
      const responses = await Promise.all(profileIds.map((profileId) => this.createPost(post, profileId, payload.text, payload.assets, schedule, payload.metadata)));
      const failures = responses.filter((response) => !response.ok);
      const failureDetails = failures.map((failure) => summarizeBufferFailure(failure)).filter(Boolean).join("; ");
      const acceptedMessage = acceptedBufferMessage(schedule);
      const bufferPostIds = responses.map((response) => extractBufferPostId(response.body)).filter((id): id is string => Boolean(id));
      const result: PublishResult = {
        post_id: post.id,
        ok: failures.length === 0,
        publisher: "buffer",
        target_status: schedule.mode === "shareNow" ? "posted" : "staged",
        buffer_post_ids: bufferPostIds,
        published_url: extractBufferUrl(responses[0]?.body),
        message: failures.length === 0
          ? acceptedMessage
          : `Buffer request failed for ${failures.length} channel(s)${failureDetails ? `: ${failureDetails}` : "."}`,
        payload: {
          responses,
          target_platform: post.platform,
          target_profile_ids: profileIds,
          mode: schedule.mode,
          due_at: schedule.dueAt,
          linkedin_mentions: publishContent.mentionedEntities,
          omitted_local_media: post.image_url && assets.length === 0 ? post.image_url : undefined
        },
        published_at: new Date().toISOString()
      };
      return this.log(result);
    } catch (error) {
      return this.log({
        post_id: post.id,
        ok: false,
        publisher: "buffer",
        message: error instanceof Error ? error.message : "Buffer request failed.",
        payload,
        published_at: new Date().toISOString()
      });
    }
  }

  async replaceScheduledImage(post: GeneratedPost, bufferPostId: string): Promise<PublishResult> {
    await mkdir(getOutputDir(), { recursive: true });
    const scheduledFor = post.scheduled_for;
    const assets = buildAssets(post, true);
    const fail = (message: string, payload?: unknown) => this.log({
      post_id: post.id,
      ok: false,
      publisher: "buffer",
      target_status: "staged",
      buffer_post_ids: [bufferPostId],
      message,
      payload: { operation: "replace-scheduled-image", buffer_post_id: bufferPostId, ...(asRecord(payload)) },
      published_at: new Date().toISOString()
    });

    if (!this.apiKey) return fail("BUFFER_API_KEY is required to replace a scheduled Buffer image.");
    if (post.status !== "staged") return fail(`Post ${post.id} must be staged before its Buffer image can be replaced.`);
    if (!scheduledFor || Number.isNaN(new Date(scheduledFor).getTime()) || new Date(scheduledFor).getTime() <= Date.now()) {
      return fail(`Post ${post.id} must have a future scheduled_for timestamp before its Buffer image can be replaced.`);
    }
    if (assets.length !== 1) return fail(`Post ${post.id} must have one externally hosted image before Buffer replacement.`);
    const validation = validatePlatformPost(post.platform, post.post_text, post.hashtags);
    if (!validation.ok) return fail(validation.message ?? "Post does not meet platform publishing requirements.");
    let publishContent: LinkedInPublishContent;
    try {
      publishContent = await prepareLinkedInPublishContent(post);
    } catch (error) {
      return fail(`LinkedIn mention preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = publishContent.text;

    try {
      const preflightResponse = await this.getPost(bufferPostId);
      if (!preflightResponse.ok) {
        return fail(`Buffer preflight failed: ${summarizeGraphqlFailure(preflightResponse, "post")}`, { preflight: preflightResponse });
      }
      const before = extractPost(preflightResponse.body, "post");
      if (!before.id || before.id !== bufferPostId) return fail(`Buffer preflight did not return scheduled post ${bufferPostId}.`);
      if (before.status !== "scheduled") return fail(`Buffer post ${bufferPostId} is ${before.status || "unknown"}, not scheduled.`);
      if (!sameInstant(before.dueAt, scheduledFor)) return fail(`Buffer post ${bufferPostId} dueAt does not match ${scheduledFor}.`);
      if (before.text !== text) return fail(`Buffer post ${bufferPostId} text differs from the local staged copy; refusing to overwrite a possible manual edit.`);

      const editResponse = await this.editPost(bufferPostId, text, assets, new Date(scheduledFor).toISOString(), publishContent.metadata);
      if (!editResponse.ok) {
        return fail(`Buffer edit failed: ${summarizeGraphqlFailure(editResponse, "editPost")}`, { preflight: before, edit: editResponse });
      }
      const after = extractPost(editResponse.body, "editPost");
      const expectedImageUrl = extractImageUrl(assets);
      if (after.id !== bufferPostId || after.status !== "scheduled" || !sameInstant(after.dueAt, scheduledFor)) {
        return fail(`Buffer edit response did not preserve the scheduled post ID and due time.`, { preflight: before, after });
      }
      if (after.text !== text) return fail(`Buffer edit response did not preserve the staged post text.`, { preflight: before, after });
      if (!expectedImageUrl || !after.assetSources.includes(expectedImageUrl)) {
        return fail(`Buffer edit response did not confirm the replacement image asset.`, { preflight: before, after });
      }

      return this.log({
        post_id: post.id,
        ok: true,
        publisher: "buffer",
        target_status: "staged",
        buffer_post_ids: [bufferPostId],
        message: `Buffer scheduled image replaced in place for ${new Date(scheduledFor).toISOString()}.`,
        payload: {
          operation: "replace-scheduled-image",
          buffer_post_id: bufferPostId,
          due_at: new Date(scheduledFor).toISOString(),
          before_asset_sources: before.assetSources,
          replacement_asset_source: expectedImageUrl,
          after_asset_sources: after.assetSources,
          linkedin_mentions: publishContent.mentionedEntities
        },
        published_at: new Date().toISOString()
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Buffer scheduled image replacement failed.");
    }
  }

  private async log(result: PublishResult): Promise<PublishResult> {
    return appendPublishLog(result);
  }

  private profileIdsFor(platform: Platform): string[] {
    return this.platformProfileIds[platform].length > 0 ? this.platformProfileIds[platform] : this.fallbackProfileIds;
  }

  private async createPost(
    post: GeneratedPost,
    channelId: string,
    text: string,
    assets: Record<string, unknown>[],
    schedule: ResolvedSchedule,
    metadata?: LinkedInPublishContent["metadata"]
  ): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    const query = `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess {
          post {
            id
            status
            dueAt
            externalLink
            channelId
            channelService
            shareMode
          }
        }
        ... on NotFoundError { message }
        ... on UnauthorizedError { message }
        ... on UnexpectedError { message }
        ... on RestProxyError { message link code }
        ... on LimitReachedError { message }
        ... on InvalidInputError { message }
      }
    }`;
    const variables = {
      input: {
        channelId,
        text,
        schedulingType: "automatic",
        mode: schedule.mode,
        ...(schedule.dueAt ? { dueAt: schedule.dueAt } : {}),
        assets,
        ...(metadata ? { metadata } : {}),
        source: "splay",
        aiAssisted: true,
        saveToDraft: false
      }
    };

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const body = asRecord(await response.json().catch(() => ({})));
    const payload = asRecord(body.data);
    const createPost = asRecord(payload.createPost);
    const ok = response.ok && !body.errors && createPost.__typename === "PostActionSuccess";
    return { ok, status: response.status, body };
  }

  private async getPost(bufferPostId: string): Promise<GraphqlResponse> {
    const query = `query BufferPostPreflight($input: PostInput!) {
      post(input: $input) {
        id
        status
        dueAt
        text
        assets { source mimeType }
      }
    }`;
    return this.requestGraphql(query, { input: { id: bufferPostId } }, "post");
  }

  private async editPost(
    bufferPostId: string,
    text: string,
    assets: Record<string, unknown>[],
    dueAt: string,
    metadata?: LinkedInPublishContent["metadata"]
  ): Promise<GraphqlResponse> {
    const query = `mutation ReplaceScheduledImage($input: EditPostInput!) {
      editPost(input: $input) {
        __typename
        ... on PostActionSuccess {
          post {
            id
            status
            dueAt
            text
            assets { source mimeType }
          }
        }
        ... on NotFoundError { message }
        ... on UnauthorizedError { message }
        ... on UnexpectedError { message }
        ... on RestProxyError { message link code }
        ... on LimitReachedError { message }
        ... on InvalidInputError { message }
      }
    }`;
    return this.requestGraphql(query, {
      input: {
        id: bufferPostId,
        text,
        schedulingType: "automatic",
        mode: "customScheduled",
        dueAt,
        assets,
        ...(metadata ? { metadata } : {}),
        source: "splay",
        aiAssisted: true,
        saveToDraft: false
      }
    }, "editPost");
  }

  private async requestGraphql(query: string, variables: Record<string, unknown>, operation: "post" | "editPost"): Promise<GraphqlResponse> {
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const body = asRecord(await response.json().catch(() => ({})));
    const data = asRecord(body.data);
    const operationPayload = asRecord(data[operation]);
    const ok = response.ok && !body.errors && (operation === "post" ? Boolean(operationPayload.id) : operationPayload.__typename === "PostActionSuccess");
    return { ok, status: response.status, body };
  }
}

type GraphqlResponse = { ok: boolean; status: number; body: Record<string, unknown> };

type BufferPostSnapshot = {
  id: string;
  status: string;
  dueAt: string;
  text: string;
  assetSources: string[];
};

type ResolvedSchedule = {
  ok: true;
  mode: BufferShareMode;
  dueAt?: string;
};

type RejectedSchedule = {
  ok: false;
  message: string;
};

function resolveSchedule(post: GeneratedPost, publishMode: PublishMode): ResolvedSchedule | RejectedSchedule {
  if (post.scheduled_for) {
    if (!hasExplicitTimezone(post.scheduled_for)) {
      return { ok: false, message: `scheduled_for must include an explicit timezone for ${post.id}: ${post.scheduled_for}` };
    }
    const date = new Date(post.scheduled_for);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, message: `Invalid scheduled_for timestamp for ${post.id}: ${post.scheduled_for}` };
    }
    if (date.getTime() <= Date.now()) {
      return { ok: false, message: `scheduled_for must be in the future for ${post.id}: ${date.toISOString()}` };
    }
    return { ok: true, mode: "customScheduled", dueAt: date.toISOString() };
  }

  return { ok: true, mode: publishMode === "now" ? "shareNow" : "addToQueue" };
}

function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

function acceptedBufferMessage(schedule: ResolvedSchedule): string {
  if (schedule.mode === "shareNow") return "Buffer publish request accepted.";
  if (schedule.mode === "customScheduled") return `Buffer scheduled request accepted for ${schedule.dueAt}.`;
  return "Buffer queue request accepted.";
}

function summarizeBufferFailure(response: { status: number; body: Record<string, unknown> }): string {
  const record = asRecord(response.body);
  const data = asRecord(record.data);
  const createPost = asRecord(data.createPost);
  const message = createPost.message;
  if (typeof message === "string" && message.trim()) return message.trim();

  const errors = Array.isArray(record.errors) ? record.errors : [];
  const errorMessages = errors
    .map((error) => asRecord(error).message)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (errorMessages.length > 0) return errorMessages.join("; ");

  return `HTTP ${response.status}`;
}

function summarizeGraphqlFailure(response: GraphqlResponse, operation: "post" | "editPost"): string {
  const record = asRecord(response.body);
  const data = asRecord(record.data);
  const operationPayload = asRecord(data[operation]);
  const message = operationPayload.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const messages = errors.map((error) => asRecord(error).message).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return messages.length > 0 ? messages.join("; ") : `HTTP ${response.status}`;
}

function extractBufferUrl(body: unknown): string | undefined {
  const record = asRecord(body);
  const data = asRecord(record.data);
  const createPost = asRecord(data.createPost);
  const post = asRecord(createPost.post);
  return typeof post.externalLink === "string" ? post.externalLink : undefined;
}

function extractBufferPostId(body: unknown): string | undefined {
  const record = asRecord(body);
  const data = asRecord(record.data);
  const createPost = asRecord(data.createPost);
  const post = asRecord(createPost.post);
  return typeof post.id === "string" ? post.id : undefined;
}

function parseIds(value: string | undefined): string[] {
  return String(value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function buildAssets(post: GeneratedPost, includeDimensions = false): Record<string, unknown>[] {
  if (!isExternalUrl(post.image_url)) return [];
  return [{
    image: {
      url: post.image_url,
      metadata: {
        altText: post.alt_text,
        ...(includeDimensions ? { dimensions: post.visual_qa?.dimensions ?? { width: FINAL_IMAGE_WIDTH, height: FINAL_IMAGE_HEIGHT } } : {})
      }
    }
  }];
}

function extractPost(body: unknown, operation: "post" | "editPost"): BufferPostSnapshot {
  const data = asRecord(asRecord(body).data);
  const operationPayload = asRecord(data[operation]);
  const post = operation === "editPost" ? asRecord(operationPayload.post) : operationPayload;
  const assets = Array.isArray(post.assets) ? post.assets : [];
  return {
    id: typeof post.id === "string" ? post.id : "",
    status: typeof post.status === "string" ? post.status : "",
    dueAt: typeof post.dueAt === "string" ? post.dueAt : "",
    text: typeof post.text === "string" ? post.text : "",
    assetSources: assets.map((asset) => asRecord(asset).source).filter((value): value is string => typeof value === "string")
  };
}

function extractImageUrl(assets: Record<string, unknown>[]): string | undefined {
  const first = asRecord(assets[0]);
  const image = asRecord(first.image);
  return typeof image.url === "string" ? image.url : undefined;
}

function sameInstant(left: string, right: string): boolean {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
