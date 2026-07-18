import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { GeneratedPost } from "../types/index.ts";
import { FINAL_IMAGE_HEIGHT, FINAL_IMAGE_WIDTH } from "../visual/finalImageContract.ts";

// Hosts the local image for a post in Convex File Storage and returns the post with
// `image_url` rewritten to a public URL Buffer can fetch.
//
// Buffer requires a public https URL and rejects SVG. Current generated packs upload the
// QA-passed local PNG directly; legacy .svg packs are rasterized through headless Chromium.
//
// Buffer fetches media when a queued post actually publishes (potentially days later).
// Convex storage.getUrl() returns a bearer URL that remains publicly fetchable until the
// stored file is deleted, so it is suitable for Buffer's delayed fetch model.

type ConvexStorageConfig = {
  url: string;
  ingestToken: string;
};

export type HostedImage = {
  post: GeneratedPost;
  storageId?: string;
};

type ConvexMutationClient = {
  mutation(reference: unknown, args: Record<string, unknown>): Promise<unknown>;
};

export type HostImageOptions = {
  client?: ConvexMutationClient;
  fetch?: typeof fetch;
};

function readConfig(): ConvexStorageConfig | null {
  const url = process.env.CONVEX_URL?.trim();
  const ingestToken = process.env.CONVEX_INGEST_TOKEN?.trim();
  if (!url || !ingestToken) return null;

  return { url, ingestToken };
}

export function isImageHostConfigured(): boolean {
  return readConfig() !== null;
}

function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

// Resolve the post's image_url (e.g. "images/foo.svg") to an absolute local path.
function resolveLocalPath(imageUrl: string): string {
  if (path.isAbsolute(imageUrl)) return imageUrl;
  return path.resolve(getOutputDir(), imageUrl);
}

// Rasterize an SVG file to a PNG buffer using headless Chromium so the output matches
// the HTML preview exactly (fonts, gradients, text layout).
async function rasterizeSvgToPng(absSvgPath: string): Promise<Buffer> {
  const svg = await readFile(absSvgPath, "utf8");
  const { width, height } = parseSvgSize(svg);

  // Lazy import so projects that never host images don't pay puppeteer's startup cost.
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Render at native 1x (e.g. 1200x675). 2x doubles dimensions and pushes the PNG past
    // X/Twitter's ~5 MB image limit; native size is the resolution feeds display anyway.
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    // Load the file directly so any relative/embedded asset references resolve.
    await page.goto(pathToFileURL(absSvgPath).href, { waitUntil: "networkidle0" });
    const png = (await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width, height }
    })) as Buffer;
    return png;
  } finally {
    await browser.close();
  }
}

function parseSvgSize(svg: string): { width: number; height: number } {
  const width = Number(svg.match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1]);
  const height = Number(svg.match(/\bheight="(\d+(?:\.\d+)?)"/)?.[1]);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  // Fall back to the current social-card contract if the SVG omits explicit dimensions.
  return { width: FINAL_IMAGE_WIDTH, height: FINAL_IMAGE_HEIGHT };
}

function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

// Upload the post's local image to Convex and return the post with image_url pointing at
// the URL from storage.getUrl(). Posts with an external URL, or no image, pass through.
export async function hostImageIfLocal(post: GeneratedPost, options: HostImageOptions = {}): Promise<HostedImage> {
  const config = readConfig();
  if (!config) return { post };
  if (!post.image_url || isExternalUrl(post.image_url)) return { post };

  const absPath = resolveLocalPath(post.image_url);
  const sourceExt = path.extname(absPath).toLowerCase();

  let body: Buffer;
  let sourceName: string;
  let contentType: string;
  if (sourceExt === ".svg") {
    body = await rasterizeSvgToPng(absPath);
    sourceName = `${path.basename(absPath, sourceExt)}.png`;
    contentType = "image/png";
  } else {
    body = await readFile(absPath);
    sourceName = path.basename(absPath);
    contentType = contentTypeFor(sourceExt);
  }

  if (!contentType.startsWith("image/")) throw new Error(`Unsupported media type for Convex upload: ${sourceExt || "unknown"}.`);

  const client = options.client ?? new ConvexHttpClient(config.url);
  const uploadUrl = await client.mutation(anyApi.media.generateUploadUrl, {
    ingestToken: config.ingestToken
  });
  if (typeof uploadUrl !== "string" || !/^https?:\/\//i.test(uploadUrl)) {
    throw new Error("Convex did not return a valid upload URL.");
  }

  const fetchImpl = options.fetch ?? fetch;
  const uploadResponse = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(body)
  });
  if (!uploadResponse.ok) {
    const detail = (await uploadResponse.text()).trim().slice(0, 500);
    throw new Error(`Convex upload failed (${uploadResponse.status})${detail ? `: ${detail}` : "."}`);
  }

  const uploadResult = await uploadResponse.json() as { storageId?: unknown };
  if (typeof uploadResult.storageId !== "string" || !uploadResult.storageId) {
    throw new Error("Convex upload response did not include a storageId.");
  }

  const finalized = await client.mutation(anyApi.media.finalizeUpload, {
    ingestToken: config.ingestToken,
    storageId: uploadResult.storageId,
    postId: post.id,
    contentType,
    sourceName
  }) as { storageId?: unknown; url?: unknown };
  if (typeof finalized.url !== "string" || !/^https:\/\//i.test(finalized.url)) {
    throw new Error("Convex did not return a public HTTPS media URL.");
  }

  return {
    post: { ...post, image_url: finalized.url },
    storageId: typeof finalized.storageId === "string" ? finalized.storageId : uploadResult.storageId
  };
}
