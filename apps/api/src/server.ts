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
import type {
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
  const approved = pack.posts.filter((post) => post.status === "approved");
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
