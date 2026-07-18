import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiConfig } from "./config.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    message: string,
    code = "request_error"
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.", "unsupported_media_type");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > apiConfig.bodyLimitBytes) {
      throw new HttpError(413, "Request body is too large.", "payload_too_large");
    }
    chunks.push(buffer);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON body must be an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid JSON body.", "invalid_json");
  }
}

export function requireApiAuth(request: IncomingMessage): void {
  if (!apiConfig.apiToken) return;
  const authorization = String(request.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!safeEqual(supplied, apiConfig.apiToken)) {
    throw new HttpError(401, "A valid bearer token is required.", "unauthorized");
  }
}

export function enforceAllowedOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin && !apiConfig.allowedOrigins.has(origin)) {
    throw new HttpError(403, "Origin is not allowed.", "origin_forbidden");
  }
}

export function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
  requestId?: string
): void {
  response.writeHead(status, {
    ...responseHeaders(request, requestId),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

export async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  requestId?: string
): Promise<void> {
  try {
    const bytes = await readFile(filePath);
    response.writeHead(200, {
      ...responseHeaders(request, requestId),
      "content-type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    response.end(bytes);
  } catch {
    throw new HttpError(404, "File not found.", "not_found");
  }
}

export function sendNoContent(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(204, responseHeaders(request));
  response.end();
}

function responseHeaders(request: IncomingMessage, requestId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  const origin = request.headers.origin;
  if (origin && apiConfig.allowedOrigins.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  if (requestId) headers["x-request-id"] = requestId;
  return headers;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
