import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { GeneratedPost } from "../types/index.ts";
import { FINAL_IMAGE_HEIGHT, FINAL_IMAGE_WIDTH } from "../visual/finalImageContract.ts";

// Hosts the local image for a post on Cloudflare R2 (or any S3-compatible store) and
// returns the post with `image_url` rewritten to a URL Buffer can fetch.
//
// Buffer requires a public https URL and rejects SVG. Current generated packs upload the
// QA-passed local PNG directly; legacy .svg packs are rasterized through headless Chromium.
//
// Buffer fetches media when a queued post actually publishes (potentially days later),
// so the URL must stay valid until then. We therefore REQUIRE a stable, permanent public
// base URL (R2_PUBLIC_BASE_URL, e.g. the bucket's pub-*.r2.dev domain or a custom domain)
// and let an R2 lifecycle rule expire old objects. Presigned URLs expire and are
// unsuitable for queued posts, so hosting is treated as unconfigured without a public base
// URL — callers then fail closed rather than emitting a URL that dies before publish.

type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

export type HostedImage = {
  post: GeneratedPost;
  // Object key in the bucket (e.g. for diagnostics / lifecycle reasoning).
  hostedKey?: string;
};

let cachedClient: S3Client | null = null;

function readConfig(): R2Config | null {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  // A permanent public base URL is mandatory: without it we cannot guarantee the media
  // stays reachable until a queued post publishes.
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;

  return { endpoint, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export function isImageHostConfigured(): boolean {
  return readConfig() !== null;
}

function getClient(config: R2Config): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  return cachedClient;
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

function buildUrl(config: R2Config, key: string): string {
  return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
}

// Upload the post's local image to R2 and return the post with image_url pointing at a
// fetchable URL. Posts that already carry an external URL, or have no image, pass through.
export async function hostImageIfLocal(post: GeneratedPost): Promise<HostedImage> {
  const config = readConfig();
  if (!config) return { post };
  if (!post.image_url || isExternalUrl(post.image_url)) return { post };

  const absPath = resolveLocalPath(post.image_url);
  const sourceExt = path.extname(absPath).toLowerCase();

  let body: Buffer;
  let key: string;
  let contentType: string;
  if (sourceExt === ".svg") {
    body = await rasterizeSvgToPng(absPath);
    key = `posts/${randomUUID()}.png`;
    contentType = "image/png";
  } else {
    body = await readFile(absPath);
    key = `posts/${randomUUID()}${sourceExt}`;
    contentType = contentTypeFor(sourceExt);
  }

  const client = getClient(config);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));

  const url = buildUrl(config, key);
  return { post: { ...post, image_url: url }, hostedKey: key };
}
