import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  apiConfig,
  assertSafeApiConfig,
  CORE_ROOT,
  PROJECT_ROOT,
  publicRuntimeConfig
} from "./config.ts";
import {
  enforceAllowedOrigin,
  HttpError,
  readJson,
  requireApiAuth,
  sendFile,
  sendJson,
  sendNoContent
} from "./http.ts";
import { JobManager, type JobCommand } from "./jobs.ts";
import { getOutputDir, isTestMode } from "../../../scripts/runtime/src/config/runtimeMode.ts";
import { renderPreview } from "../../../scripts/runtime/src/render/previewRenderer.ts";
import {
  loadPostPack,
  recordReviewDecision,
  schedulePosts
} from "../../../scripts/runtime/src/storage/postStore.ts";
import {
  campaignSlots,
  createCampaign,
  getCampaign,
  listCampaigns,
  loadBrandKit,
  saveBrandKit,
  updateCampaign
} from "../../../scripts/runtime/src/storage/campaignStore.ts";
import type {
  BrandKit,
  Campaign,
  GeneratedPost,
  Platform,
  PostStatus,
  ReviewDecisionReason
} from "../../../scripts/runtime/src/types/index.ts";

const API_PREFIX = "/api/v1";
const DECISION_REASONS = new Set<ReviewDecisionReason>([
  "strong_insight",
  "strong_proof",
  "good_voice",
  "too_generic",
  "too_promotional",
  "repetitive",
  "unsupported",
  "wrong_audience",
  "different_angle",
  "visual_not_useful",
  "approved_without_note"
]);

type CreateServerOptions = {
  jobs?: JobManager;
};

export function createApiServer(options: CreateServerOptions = {}): Server {
  const jobs = options.jobs || new JobManager();
  let mutationTail: Promise<unknown> = Promise.resolve();

  const runMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutationTail.then(operation, operation);
    mutationTail = next.then(() => undefined, () => undefined);
    return next;
  };

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    try {
      enforceAllowedOrigin(request);
      if (request.method === "OPTIONS") return sendNoContent(request, response);
      if (!request.url) throw new HttpError(400, "Missing request URL.", "invalid_request");

      const url = new URL(request.url, `http://${apiConfig.host}:${apiConfig.port}`);
      const pathname = url.pathname;
      if (!isPublicPath(pathname)) requireApiAuth(request);

      if (request.method === "GET" && pathname === "/") {
        return sendJson(request, response, 200, {
          name: "Splay API",
          api: API_PREFIX,
          health: `${API_PREFIX}/health`,
          openapi: `${API_PREFIX}/openapi.json`
        }, requestId);
      }

      if (request.method === "GET" && pathname === `${API_PREFIX}/health`) {
        return sendJson(request, response, 200, {
          ok: true,
          ...publicRuntimeConfig()
        }, requestId);
      }

      if (request.method === "GET" && pathname === `${API_PREFIX}/openapi.json`) {
        return sendFile(request, response, path.join(PROJECT_ROOT, "apps", "api", "openapi.json"), requestId);
      }

      if (request.method === "GET" && pathname === `${API_PREFIX}/posts`) {
        const pack = await loadPostPack();
        const platform = optionalPlatform(url.searchParams.get("platform"));
        const status = optionalStatus(url.searchParams.get("status"));
        const posts = pack.posts.filter((post) => (
          (!platform || post.platform === platform) && (!status || post.status === status)
        ));
        return sendJson(request, response, 200, {
          data: posts.map(toApiPost),
          meta: {
            generated_at: pack.generated_at,
            discovered_themes: pack.discovered_themes,
            count: posts.length,
            total: pack.posts.length,
            statuses: countStatuses(pack.posts)
          }
        }, requestId);
      }

      const postMatch = pathname.match(new RegExp(`^${API_PREFIX}/posts/([^/]+)$`));
      if (request.method === "GET" && postMatch) {
        const id = decodeURIComponent(postMatch[1]);
        const pack = await loadPostPack();
        const post = pack.posts.find((candidate) => candidate.id === id);
        if (!post) throw new HttpError(404, `Post not found: ${id}`, "not_found");
        return sendJson(request, response, 200, { data: toApiPost(post) }, requestId);
      }

      const decisionMatch = pathname.match(new RegExp(`^${API_PREFIX}/posts/([^/]+)/decisions$`));
      if (request.method === "POST" && decisionMatch) {
        refuseWhileJobIsActive(jobs);
        const id = decodeURIComponent(decisionMatch[1]);
        const body = await readJson(request);
        const decision = requiredDecision(body.decision);
        const reason = requiredReason(body.reason);
        const note = optionalString(body.note, "note", 2_000);
        const pack = await runMutation(async () => {
          try {
            const updated = await recordReviewDecision(id, decision, reason, note);
            await renderPreview(updated);
            return updated;
          } catch (error) {
            throw coreMutationError(error);
          }
        });
        const post = pack.posts.find((candidate) => candidate.id === id);
        return sendJson(request, response, 200, { data: post ? toApiPost(post) : null }, requestId);
      }

      const scheduleMatch = pathname.match(new RegExp(`^${API_PREFIX}/posts/([^/]+)/schedule$`));
      if (request.method === "PUT" && scheduleMatch) {
        refuseWhileJobIsActive(jobs);
        const id = decodeURIComponent(scheduleMatch[1]);
        const body = await readJson(request);
        const scheduledFor = nullableString(body.scheduled_for, "scheduled_for", 100);
        const result = await runMutation(async () => {
          try {
            const updated = await schedulePosts({ id }, scheduledFor);
            await renderPreview(updated.pack);
            return updated;
          } catch (error) {
            throw coreMutationError(error);
          }
        });
        return sendJson(request, response, 200, { data: toApiPost(result.updated[0]) }, requestId);
      }

      if (request.method === "GET" && pathname === `${API_PREFIX}/campaigns`) {
        const campaigns = await listCampaigns();
        return sendJson(request, response, 200, { data: campaigns.map(toApiCampaign) }, requestId);
      }

      if (request.method === "POST" && pathname === `${API_PREFIX}/campaigns`) {
        refuseWhileJobIsActive(jobs);
        const body = await readJson(request);
        const campaign = await runMutation(() => createCampaign({
          name: requiredString(body.name, "name", 100),
          brief: requiredString(body.brief, "brief", 500),
          themes: requiredStringArray(body.themes, "themes", 12, 120),
          platforms: requiredPlatforms(body.platforms),
          start_at: requiredFutureDate(body.start_at, "start_at"),
          timezone: requiredTimezone(body.timezone),
          interval_weeks: optionalInteger(body.interval_weeks, "interval_weeks", 1, 4) ?? 1,
          occurrences: optionalInteger(body.occurrences, "occurrences", 2, 52) ?? 6,
          creative: optionalBoolean(body.creative, "creative") ?? false
        }));
        return sendJson(request, response, 201, { data: toApiCampaign(campaign) }, requestId);
      }

      const campaignMatch = pathname.match(new RegExp(`^${API_PREFIX}/campaigns/([^/]+)$`));
      if (request.method === "GET" && campaignMatch) {
        const campaign = await getCampaign(decodeURIComponent(campaignMatch[1]));
        if (!campaign) throw new HttpError(404, "Campaign not found.", "not_found");
        return sendJson(request, response, 200, { data: toApiCampaign(campaign) }, requestId);
      }

      if (request.method === "PATCH" && campaignMatch) {
        refuseWhileJobIsActive(jobs);
        const id = decodeURIComponent(campaignMatch[1]);
        const body = await readJson(request);
        const status = requiredEnum(body.status, "status", ["draft", "active", "paused", "completed"] as const);
        const campaign = await runMutation(() => updateCampaign(id, { status }));
        return sendJson(request, response, 200, { data: toApiCampaign(campaign) }, requestId);
      }

      const campaignGenerateMatch = pathname.match(new RegExp(`^${API_PREFIX}/campaigns/([^/]+)/generate$`));
      if (request.method === "POST" && campaignGenerateMatch) {
        refuseWhileJobIsActive(jobs);
        const id = decodeURIComponent(campaignGenerateMatch[1]);
        const campaign = await getCampaign(id);
        if (!campaign) throw new HttpError(404, "Campaign not found.", "not_found");
        if (new Date(campaign.start_at).getTime() <= Date.now()) {
          throw new HttpError(422, "Campaign start time must still be in the future.", "campaign_start_elapsed");
        }
        const script = path.join(CORE_ROOT, "src", "cli", "generateCampaign.ts");
        const job = jobs.enqueue({
          kind: "campaign-generate",
          command: process.execPath,
          args: ["--experimental-strip-types", script, "--campaign", campaign.id],
          cwd: PROJECT_ROOT,
          env: campaign.creative ? {
            SOCIAL_AGENT_CREATIVE_MODE: "1",
            SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST: "1",
            SOCIAL_AGENT_CREATIVE_IMAGE_MODE: "gpt-canva"
          } : undefined,
          metadata: { campaign_id: campaign.id, occurrences: campaign.occurrences }
        });
        await updateCampaign(campaign.id, { status: "generating" });
        return sendJson(request, response, 202, { data: job }, requestId);
      }

      if (request.method === "GET" && pathname === `${API_PREFIX}/brand-kit`) {
        return sendJson(request, response, 200, { data: await loadBrandKit() }, requestId);
      }

      if (request.method === "PUT" && pathname === `${API_PREFIX}/brand-kit`) {
        refuseWhileJobIsActive(jobs);
        const body = await readJson(request);
        const kit = await runMutation(() => saveBrandKit(parseBrandKit(body)));
        return sendJson(request, response, 200, { data: kit }, requestId);
      }

      if (request.method === "GET" && pathname === `${API_PREFIX}/jobs`) {
        return sendJson(request, response, 200, { data: jobs.list() }, requestId);
      }

      const jobMatch = pathname.match(new RegExp(`^${API_PREFIX}/jobs/([^/]+)$`));
      if (request.method === "GET" && jobMatch) {
        const job = jobs.get(decodeURIComponent(jobMatch[1]));
        if (!job) throw new HttpError(404, "Job not found.", "not_found");
        return sendJson(request, response, 200, { data: job }, requestId);
      }

      if (request.method === "POST" && pathname === `${API_PREFIX}/jobs/generate`) {
        const body = await readJson(request);
        const mode = body.mode === undefined ? "auto" : requiredEnum(body.mode, "mode", ["auto", "topic"] as const);
        const creative = optionalBoolean(body.creative, "creative") || false;
        const topic = mode === "topic" ? requiredString(body.topic, "topic", 500) : undefined;
        const script = path.join(CORE_ROOT, "src", "cli", mode === "auto" ? "generateAuto.ts" : "generate.ts");
        const command: JobCommand = {
          kind: "generate",
          command: process.execPath,
          args: ["--experimental-strip-types", script, ...(topic ? ["--topic", topic] : [])],
          cwd: PROJECT_ROOT,
          env: creative ? {
            SOCIAL_AGENT_CREATIVE_MODE: "1",
            SOCIAL_AGENT_UNIQUE_IMAGES_PER_POST: "1",
            SOCIAL_AGENT_CREATIVE_IMAGE_MODE: "gpt-canva"
          } : undefined,
          metadata: { mode, creative, ...(topic ? { topic } : {}) }
        };
        const job = jobs.enqueue(command);
        return sendJson(request, response, 202, { data: job }, requestId);
      }

      if (request.method === "POST" && pathname === `${API_PREFIX}/jobs/publish-approved`) {
        const body = await readJson(request);
        if (body.confirm !== true) {
          throw new HttpError(400, "Set confirm to true to queue approved posts.", "confirmation_required");
        }
        await assertPublishingReady();
        const job = jobs.enqueue(coreCommand("publish-approved", "publishApproved.ts"));
        return sendJson(request, response, 202, { data: job }, requestId);
      }

      if (request.method === "POST" && pathname === `${API_PREFIX}/jobs/metrics-collect`) {
        const job = jobs.enqueue(coreCommand("metrics-collect", "metricsCollect.ts"));
        return sendJson(request, response, 202, { data: job }, requestId);
      }

      if (request.method === "POST" && pathname === `${API_PREFIX}/jobs/metrics-score`) {
        const job = jobs.enqueue(coreCommand("metrics-score", "metricsScore.ts"));
        return sendJson(request, response, 202, { data: job }, requestId);
      }

      if (request.method === "POST" && pathname === `${API_PREFIX}/jobs/feedback-generate`) {
        const job = jobs.enqueue(coreCommand("feedback-generate", "feedbackGenerate.ts"));
        return sendJson(request, response, 202, { data: job }, requestId);
      }

      if (request.method === "GET" && pathname === "/preview") {
        return sendFile(request, response, path.join(getOutputDir(), "latest-preview.html"), requestId);
      }

      if (request.method === "GET" && pathname.startsWith("/media/")) {
        return sendFile(request, response, safeMediaPath(pathname), requestId);
      }

      throw new HttpError(404, "Route not found.", "not_found");
    } catch (error) {
      const normalized = normalizeError(error);
      if (!response.headersSent) {
        sendJson(request, response, normalized.status, {
          error: {
            code: normalized.code,
            message: normalized.message,
            request_id: requestId
          }
        }, requestId);
      } else {
        response.end();
      }
    }
  });

  server.once("close", () => void jobs.close());
  return server;
}

export async function startApiServer(): Promise<Server> {
  assertSafeApiConfig();
  const server = createApiServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiConfig.port, apiConfig.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`Splay API listening at http://${apiConfig.host}:${apiConfig.port}`);
  return server;
}

function coreCommand(kind: JobCommand["kind"], scriptName: string): JobCommand {
  return {
    kind,
    command: process.execPath,
    args: ["--experimental-strip-types", path.join(CORE_ROOT, "src", "cli", scriptName)],
    cwd: PROJECT_ROOT
  };
}

async function assertPublishingReady(): Promise<void> {
  const pack = await loadPostPack();
  const activeCampaignIds = new Set((await listCampaigns()).filter((campaign) => campaign.status === "active").map((campaign) => campaign.id));
  const approved = pack.posts.filter((post) => post.status === "approved" && (!post.campaign_id || activeCampaignIds.has(post.campaign_id)));
  if (approved.length === 0) throw new HttpError(409, "There are no approved posts to queue.", "nothing_to_publish");
  if (isTestMode()) return;

  const hasProfiles = Boolean(
    process.env.BUFFER_LINKEDIN_PROFILE_IDS
    || process.env.BUFFER_X_PROFILE_IDS
    || process.env.BUFFER_PROFILE_IDS
  );
  if (!process.env.BUFFER_API_KEY || !hasProfiles) {
    throw new HttpError(503, "Buffer credentials and profile IDs are required.", "publishing_not_configured");
  }

  const needsHosting = approved.some((post) => post.image_url && !/^https?:\/\//i.test(post.image_url));
  const hasConvexStorage = ["CONVEX_URL", "CONVEX_INGEST_TOKEN"]
    .every((key) => Boolean(process.env[key]));
  if (needsHosting && !hasConvexStorage) {
    throw new HttpError(503, "Convex storage must be configured for approved posts with local media.", "media_host_not_configured");
  }
}

function refuseWhileJobIsActive(jobs: JobManager): void {
  if (jobs.isBusy()) {
    throw new HttpError(409, "A background job is active. Retry after it finishes.", "job_in_progress");
  }
}

function toApiPost(post: GeneratedPost): Record<string, unknown> {
  return {
    ...post,
    media_url: mediaUrl(post.image_url),
    links: {
      self: `${API_PREFIX}/posts/${encodeURIComponent(post.id)}`,
      decision: `${API_PREFIX}/posts/${encodeURIComponent(post.id)}/decisions`,
      schedule: `${API_PREFIX}/posts/${encodeURIComponent(post.id)}/schedule`
    }
  };
}

function toApiCampaign(campaign: Campaign): Record<string, unknown> {
  return {
    ...campaign,
    slots: campaignSlots(campaign),
    links: {
      self: `${API_PREFIX}/campaigns/${encodeURIComponent(campaign.id)}`,
      generate: `${API_PREFIX}/campaigns/${encodeURIComponent(campaign.id)}/generate`
    }
  };
}

function mediaUrl(imageUrl: string): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const outputDir = path.resolve(getOutputDir());
  const normalized = imageUrl.replace(/\\/g, "/");
  const candidates = path.isAbsolute(imageUrl)
    ? [path.resolve(imageUrl)]
    : [
        path.resolve(PROJECT_ROOT, imageUrl),
        path.resolve(outputDir, normalized.replace(/^output\/(?:test\/)?/, "")),
        path.resolve(outputDir, imageUrl)
      ];
  const filePath = candidates.find((candidate) => isInside(outputDir, candidate));
  if (!filePath) return null;
  return `/media/${path.relative(outputDir, filePath).split(path.sep).map(encodeURIComponent).join("/")}`;
}

function safeMediaPath(pathname: string): string {
  const relative = decodeURIComponent(pathname.slice("/media/".length));
  const outputDir = path.resolve(getOutputDir());
  const filePath = path.resolve(outputDir, relative);
  if (!isInside(outputDir, filePath)) {
    throw new HttpError(400, "Invalid media path.", "invalid_path");
  }
  return filePath;
}

function isInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function countStatuses(posts: GeneratedPost[]): Record<string, number> {
  return posts.reduce<Record<string, number>>((counts, post) => {
    counts[post.status] = (counts[post.status] || 0) + 1;
    return counts;
  }, {});
}

function optionalPlatform(value: string | null): Platform | undefined {
  if (value === null || value === "") return undefined;
  if (value === "linkedin" || value === "x") return value;
  throw new HttpError(400, "platform must be linkedin or x.", "invalid_filter");
}

function optionalStatus(value: string | null): PostStatus | undefined {
  if (value === null || value === "") return undefined;
  const statuses: PostStatus[] = ["draft", "approved", "rejected", "staged", "posted", "failed"];
  if (statuses.includes(value as PostStatus)) return value as PostStatus;
  throw new HttpError(400, `status must be one of: ${statuses.join(", ")}.`, "invalid_filter");
}

function requiredDecision(value: unknown): "approve" | "revise" | "reject" {
  if (value === "approve" || value === "revise" || value === "reject") return value;
  throw new HttpError(400, "decision must be approve, revise, or reject.", "invalid_decision");
}

function requiredReason(value: unknown): ReviewDecisionReason {
  if (typeof value === "string" && DECISION_REASONS.has(value as ReviewDecisionReason)) {
    return value as ReviewDecisionReason;
  }
  throw new HttpError(400, `reason must be one of: ${[...DECISION_REASONS].join(", ")}.`, "invalid_reason");
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} is required.`, "invalid_request");
  }
  if (value.trim().length > maxLength) {
    throw new HttpError(400, `${field} must be at most ${maxLength} characters.`, "invalid_request");
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field, maxLength);
}

function nullableString(value: unknown, field: string, maxLength: number): string | null {
  if (value === null) return null;
  return requiredString(value, field, maxLength);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new HttpError(400, `${field} must be a boolean.`, "invalid_request");
}

function optionalInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new HttpError(400, `${field} must be an integer from ${minimum} to ${maximum}.`, "invalid_request");
  }
  return Number(value);
}

function requiredStringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new HttpError(400, `${field} must be an array with at most ${maxItems} items.`, "invalid_request");
  }
  return value.map((item, index) => requiredString(item, `${field}[${index}]`, maxLength));
}

function requiredPlatforms(value: unknown): Platform[] {
  const platforms = requiredStringArray(value, "platforms", 2, 20);
  if (platforms.length === 0 || platforms.some((platform) => platform !== "linkedin" && platform !== "x")) {
    throw new HttpError(400, "platforms must contain linkedin, x, or both.", "invalid_request");
  }
  return [...new Set(platforms)] as Platform[];
}

function requiredFutureDate(value: unknown, field: string): string {
  const text = requiredString(value, field, 100);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    throw new HttpError(400, `${field} must include an explicit timezone.`, "invalid_request");
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new HttpError(400, `${field} must be a valid future date.`, "invalid_request");
  }
  return date.toISOString();
}

function requiredTimezone(value: unknown): string {
  const timezone = requiredString(value, "timezone", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new HttpError(400, "timezone must be a valid IANA timezone.", "invalid_request");
  }
}

function parseBrandKit(body: Record<string, unknown>): Omit<BrandKit, "version" | "updated_at"> {
  const colors = asRecord(body.colors, "colors");
  const typography = asRecord(body.typography, "typography");
  return {
    name: requiredString(body.name, "name", 80),
    tagline: requiredString(body.tagline, "tagline", 160),
    audience: requiredString(body.audience, "audience", 500),
    tone: requiredString(body.tone, "tone", 500),
    positioning: requiredString(body.positioning, "positioning", 500),
    avoid: requiredStringArray(body.avoid, "avoid", 20, 100),
    colors: {
      primary: requiredColor(colors.primary, "colors.primary"),
      secondary: requiredColor(colors.secondary, "colors.secondary"),
      accent: requiredColor(colors.accent, "colors.accent"),
      background: requiredColor(colors.background, "colors.background"),
      text: requiredColor(colors.text, "colors.text")
    },
    typography: {
      heading_family: requiredString(typography.heading_family, "typography.heading_family", 80),
      body_family: requiredString(typography.body_family, "typography.body_family", 80),
      heading_weight: optionalInteger(typography.heading_weight, "typography.heading_weight", 100, 900) ?? 400,
      body_weight: optionalInteger(typography.body_weight, "typography.body_weight", 100, 900) ?? 400,
      scale: requiredEnum(typography.scale, "typography.scale", ["compact", "balanced", "editorial"] as const)
    },
    logo_url: body.logo_url === null || body.logo_url === "" ? null : requiredString(body.logo_url, "logo_url", 500)
  };
}

function requiredColor(value: unknown, field: string): string {
  const color = requiredString(value, field, 20);
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new HttpError(400, `${field} must be a six-digit hex color.`, "invalid_request");
  return color.toUpperCase();
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object.`, "invalid_request");
  }
  return value as Record<string, unknown>;
}

function requiredEnum<const T extends readonly string[]>(value: unknown, field: string, values: T): T[number] {
  if (typeof value === "string" && values.includes(value)) return value as T[number];
  throw new HttpError(400, `${field} must be one of: ${values.join(", ")}.`, "invalid_request");
}

function coreMutationError(error: unknown): HttpError {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|no posts matched/i.test(message)) return new HttpError(404, message, "not_found");
  return new HttpError(422, message, "mutation_rejected");
}

function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  console.error(error);
  return new HttpError(500, "Unexpected server error.", "internal_error");
}

function isPublicPath(pathname: string): boolean {
  return pathname === "/"
    || pathname === `${API_PREFIX}/health`
    || pathname === `${API_PREFIX}/openapi.json`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startApiServer();
  const shutdown = (signal: string): void => {
    console.log(`Received ${signal}; shutting down.`);
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
