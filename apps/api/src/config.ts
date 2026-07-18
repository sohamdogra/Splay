import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../../scripts/runtime/src/config/loadEnv.ts";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CORE_ROOT = path.join(PROJECT_ROOT, "scripts", "runtime");

loadEnv(path.join(PROJECT_ROOT, ".env.local"));
loadEnv(path.join(PROJECT_ROOT, ".env"));

setDefault("SOCIAL_AGENT_OUTPUT_DIR", path.join(PROJECT_ROOT, "output"));
setDefault("SOCIAL_AGENT_EDITORIAL_SPEC_PATH", path.join(PROJECT_ROOT, "references", "editorial-spec.json"));

export type ApiConfig = {
  host: string;
  port: number;
  allowedOrigins: Set<string>;
  apiToken?: string;
  bodyLimitBytes: number;
};

export const apiConfig: ApiConfig = {
  host: process.env.API_HOST?.trim() || "127.0.0.1",
  port: positiveInteger(process.env.API_PORT, 4173),
  allowedOrigins: new Set(csv(process.env.API_ALLOWED_ORIGINS || [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ].join(","))),
  apiToken: process.env.SPLAY_API_TOKEN?.trim() || undefined,
  bodyLimitBytes: positiveInteger(process.env.API_BODY_LIMIT_BYTES, 2 * 1024 * 1024)
};

export function assertSafeApiConfig(config = apiConfig): void {
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(config.host);
  if (!isLoopback && !config.apiToken) {
    throw new Error("SPLAY_API_TOKEN is required when API_HOST is not a loopback address.");
  }
}

export function publicRuntimeConfig(): Record<string, unknown> {
  const bufferProfiles = Boolean(
    process.env.BUFFER_LINKEDIN_PROFILE_IDS
    || process.env.BUFFER_X_PROFILE_IDS
    || process.env.BUFFER_PROFILE_IDS
  );
  const convexStorageConfigured = ["CONVEX_URL", "CONVEX_INGEST_TOKEN"]
    .every((key) => Boolean(process.env[key]));
  const tokenMartConfigured = Boolean(process.env.TOKENMART_API_KEY?.trim());

  return {
    service: "splay-api",
    version: "0.2.0",
    test_mode: process.env.SOCIAL_AGENT_TEST_MODE === "1",
    authentication: apiConfig.apiToken ? "bearer" : "local-only",
    generation: {
      brain: "project-local",
      text: process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.ANTHROPIC_API_KEY
          ? "anthropic"
          : tokenMartConfigured
            ? `tokenmart:${process.env.TOKENMART_TEXT_MODEL || "gpt-4.1-mini"}`
            : "local-template",
      image: process.env.SOCIAL_AGENT_IMAGE_MODE || "canva",
      media: {
        provider: "tokenmart",
        configured: tokenMartConfigured,
        text_model: process.env.TOKENMART_TEXT_MODEL || "gpt-4.1-mini",
        image_model: process.env.TOKENMART_IMAGE_MODEL || "dola-seedream-5-0-pro-260628",
        video_model: process.env.TOKENMART_VIDEO_MODEL || "dreamina-seedance-2-0-260128"
      }
    },
    publishing: {
      buffer_configured: Boolean(process.env.BUFFER_API_KEY && bufferProfiles),
      media_host: "convex",
      media_host_configured: convexStorageConfigured,
      mode: process.env.BUFFER_PUBLISH_MODE || "now"
    }
  };
}

function setDefault(key: string, value: string): void {
  if (!process.env[key]?.trim()) process.env[key] = value;
}

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
