import { Buffer } from "node:buffer";

const DEFAULT_BASE_URL = "https://model.service-inference.ai";
const DEFAULT_IMAGE_MODEL = "dola-seedream-5-0-pro-260628";
const DEFAULT_VIDEO_MODEL = "dreamina-seedance-2-0-260128";

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

export type TokenMartClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: Sleep;
  maxRetries?: number;
  requestTimeoutMs?: number;
};

export type GenerateBackgroundInput = {
  prompt: string;
  model?: string;
  size?: string;
};

export type GeneratedBackground = {
  bytes: Uint8Array;
  contentType: string;
  model: string;
};

export type CreateAnimationInput = {
  prompt: string;
  imageUrl?: string;
  model?: string;
  resolution?: "480p" | "720p" | "1080p";
  ratio?: "16:9";
  duration?: number;
};

export type AnimationTask = {
  id: string;
  model: string;
  raw: Record<string, unknown>;
};

export type CompletedAnimation = AnimationTask & {
  status: string;
  videoUrl: string;
};

export class TokenMartApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(status: number, message: string, code?: string) {
    super(`TokenMart request failed (${status}${code ? ` ${code}` : ""}): ${message}`);
    this.status = status;
    this.code = code;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export class TokenMartMediaClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #sleep: Sleep;
  readonly #maxRetries: number;
  readonly #requestTimeoutMs: number;

  constructor(options: TokenMartClientOptions = {}) {
    this.#apiKey = options.apiKey?.trim() || process.env.TOKENMART_API_KEY?.trim() || "";
    this.#baseUrl = (options.baseUrl?.trim() || process.env.TOKENMART_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#maxRetries = options.maxRetries ?? integerEnv("TOKENMART_MAX_RETRIES", 2, 0, 5);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? integerEnv("TOKENMART_REQUEST_TIMEOUT_MS", 300_000, 1_000, 900_000);
  }

  async generateBackground(input: GenerateBackgroundInput): Promise<GeneratedBackground> {
    const model = input.model?.trim() || process.env.TOKENMART_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
    const size = input.size?.trim() || process.env.TOKENMART_IMAGE_SIZE?.trim() || "1280x720";
    const payload = await this.#requestJson("/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: requiredText(input.prompt, "prompt"),
        size,
        output_format: "png",
        response_format: "b64_json",
        watermark: false
      })
    });

    const image = firstRecord(payload.data);
    const base64 = stringValue(image.b64_json);
    if (base64) {
      return { bytes: Buffer.from(base64, "base64"), contentType: contentTypeFromOutput(image.output_format) || "image/png", model };
    }

    const imageUrl = stringValue(image.url);
    if (!imageUrl) throw new Error("TokenMart image response did not include data[0].b64_json or data[0].url.");
    const downloaded = await this.download(imageUrl, 30 * 1024 * 1024);
    return { ...downloaded, model };
  }

  async createAnimation(input: CreateAnimationInput): Promise<AnimationTask> {
    const model = input.model?.trim() || process.env.TOKENMART_VIDEO_MODEL?.trim() || DEFAULT_VIDEO_MODEL;
    const content: Array<Record<string, unknown>> = [{
      type: "text",
      text: requiredText(input.prompt, "prompt")
    }];
    if (input.imageUrl) {
      content.push({
        type: "image_url",
        image_url: { url: requireHttpsUrl(input.imageUrl, "imageUrl") },
        role: "first_frame"
      });
    }

    const payload = await this.#requestJson("/v1/video/generate", {
      method: "POST",
      body: JSON.stringify({
        model,
        content,
        resolution: input.resolution ?? "720p",
        ratio: input.ratio ?? "16:9",
        duration: input.duration ?? 5,
        generate_audio: false,
        watermark: false
      })
    });
    const id = taskId(payload);
    if (!id) throw new Error("TokenMart video response did not include a task ID.");
    return { id, model, raw: payload };
  }

  async waitForAnimation(
    task: AnimationTask,
    options: { pollIntervalMs?: number; timeoutMs?: number } = {}
  ): Promise<CompletedAnimation> {
    const pollIntervalMs = options.pollIntervalMs ?? integerEnv("TOKENMART_VIDEO_POLL_INTERVAL_MS", 5_000, 250, 30_000);
    const timeoutMs = options.timeoutMs ?? integerEnv("TOKENMART_VIDEO_TIMEOUT_MS", 600_000, 5_000, 3_600_000);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const payload = await this.#requestJson(`/v1/video/tasks/${encodeURIComponent(task.id)}`, { method: "GET" });
      const status = taskStatus(payload);
      const videoUrl = taskVideoUrl(payload);
      if (["succeeded", "completed", "success"].includes(status)) {
        if (!videoUrl) throw new Error(`TokenMart video task ${task.id} succeeded without an output URL.`);
        return { ...task, status, videoUrl: normalizeMediaUrl(videoUrl, this.#baseUrl), raw: payload };
      }
      if (["failed", "cancelled", "canceled", "rejected", "expired"].includes(status)) {
        throw new Error(`TokenMart video task ${task.id} ended with status ${status}${taskFailureMessage(payload) ? `: ${taskFailureMessage(payload)}` : "."}`);
      }
      await this.#sleep(pollIntervalMs);
    }

    throw new Error(`TokenMart video task ${task.id} did not finish within ${timeoutMs}ms.`);
  }

  async downloadVideo(videoUrl: string): Promise<Uint8Array> {
    const downloaded = await this.download(videoUrl, 250 * 1024 * 1024);
    if (downloaded.contentType && downloaded.contentType !== "application/octet-stream" && !downloaded.contentType.startsWith("video/")) {
      throw new Error(`TokenMart video download returned unexpected content type ${downloaded.contentType}.`);
    }
    return downloaded.bytes;
  }

  async download(mediaUrl: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
    const url = new URL(normalizeMediaUrl(mediaUrl, this.#baseUrl));
    if (url.protocol !== "https:") throw new Error("TokenMart media URL must use HTTPS.");
    const baseOrigin = new URL(this.#baseUrl).origin;
    const response = await this.#fetchWithTimeout(url, {
      method: "GET",
      headers: url.origin === baseOrigin ? { authorization: `Bearer ${this.#requiredApiKey()}` } : undefined
    });
    if (!response.ok) throw await apiError(response);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxBytes) throw new Error(`TokenMart media download exceeds the ${maxBytes}-byte limit.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`TokenMart media download exceeds the ${maxBytes}-byte limit.`);
    return {
      bytes,
      contentType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream"
    };
  }

  async #requestJson(pathname: string, init: RequestInit): Promise<Record<string, unknown>> {
    this.#requiredApiKey();
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        const response = await this.#fetchWithTimeout(`${this.#baseUrl}${pathname}`, {
          ...init,
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            "content-type": "application/json",
            ...init.headers
          }
        });
        if (response.ok) return asRecord(await response.json());
        const error = await apiError(response);
        if (!error.retryable || attempt === this.#maxRetries) throw error;
        lastError = error;
        await this.#sleep(retryDelay(response, attempt));
      } catch (error) {
        if (error instanceof TokenMartApiError) throw error;
        lastError = error;
        if (attempt === this.#maxRetries) break;
        await this.#sleep(500 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("TokenMart request failed.");
  }

  async #fetchWithTimeout(input: string | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    try {
      return await this.#fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  #requiredApiKey(): string {
    if (!this.#apiKey) throw new Error("TOKENMART_API_KEY is not configured.");
    return this.#apiKey;
  }
}

async function apiError(response: Response): Promise<TokenMartApiError> {
  const raw = await response.text();
  let message = raw.trim().slice(0, 1_000) || response.statusText || "Unknown error";
  let code: string | undefined;
  try {
    const payload = asRecord(JSON.parse(raw));
    const error = asRecord(payload.error);
    message = stringValue(error.message) || message;
    code = stringValue(error.code) || undefined;
  } catch {
    // Preserve the bounded plain-text response.
  }
  return new TokenMartApiError(response.status, message, code);
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1_000, 30_000)
    : 500 * 2 ** attempt;
}

function taskId(payload: Record<string, unknown>): string {
  const data = asRecord(payload.data);
  const task = asRecord(payload.task);
  return stringValue(payload.id) || stringValue(payload.task_id) || stringValue(data.id) || stringValue(data.task_id) || stringValue(task.id);
}

function taskStatus(payload: Record<string, unknown>): string {
  const data = asRecord(payload.data);
  const task = asRecord(payload.task);
  return (stringValue(payload.status) || stringValue(payload.state) || stringValue(data.status) || stringValue(data.state) || stringValue(task.status) || "unknown").toLowerCase();
}

function taskVideoUrl(payload: Record<string, unknown>): string {
  const data = asRecord(payload.data);
  const content = asRecord(payload.content);
  const dataContent = asRecord(data.content);
  const firstOutput = firstUnknown(payload.outputs) ?? firstUnknown(data.outputs);
  const output = asRecord(firstOutput);
  return stringValue(content.video_url)
    || stringValue(dataContent.video_url)
    || stringValue(payload.video_url)
    || stringValue(data.video_url)
    || (typeof firstOutput === "string" ? firstOutput : "")
    || stringValue(output.video_url)
    || stringValue(output.url);
}

function taskFailureMessage(payload: Record<string, unknown>): string {
  const data = asRecord(payload.data);
  const error = asRecord(payload.error);
  const dataError = asRecord(data.error);
  return stringValue(error.message) || stringValue(dataError.message) || stringValue(payload.message);
}

function normalizeMediaUrl(value: string, baseUrl: string): string {
  const url = new URL(value, `${baseUrl}/`);
  return requireHttpsUrl(url.toString(), "media URL");
}

function requireHttpsUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS.`);
  return url.toString();
}

function requiredText(value: string, field: string): string {
  if (!value?.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function firstRecord(value: unknown): Record<string, unknown> {
  const item = firstUnknown(value);
  if (!item || typeof item !== "object" || Array.isArray(item)) return {};
  return item as Record<string, unknown>;
}

function firstUnknown(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function contentTypeFromOutput(value: unknown): string | null {
  const format = stringValue(value).toLowerCase();
  if (format === "png") return "image/png";
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return null;
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
