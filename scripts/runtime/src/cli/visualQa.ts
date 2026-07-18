import { readFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { PostPack, VisualQaReport } from "../types/index.ts";

const outputDir = getOutputDir();
const [pack, reports] = await Promise.all([
  readPostPack(outputDir),
  readVisualQaReports(outputDir)
]);

const reportsByPost = new Map(reports.map((report) => [report.post_id, report]));
const failures: string[] = [];

for (const report of reports) {
  if (!report.ok) {
    failures.push(`${report.post_id}: ${report.checks.filter((check) => !check.ok).map((check) => check.name).join(", ")}`);
  }
}

for (const post of pack.posts) {
  if (!post.image_url || /^https?:\/\//i.test(post.image_url) || path.extname(post.image_url).toLowerCase() !== ".png") continue;
  const report = post.visual_qa ?? reportsByPost.get(post.id);
  if (!report?.ok) {
    failures.push(`${post.id}: missing passing QA report for ${post.image_url}`);
    continue;
  }
  if (path.basename(report.png_path) !== path.basename(post.image_url)) {
    failures.push(`${post.id}: QA report points at ${report.png_path}, but post uses ${post.image_url}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Visual QA failed:\n${failures.join("\n")}`);
}

console.log(`Visual QA passed for ${reports.length} rendered visual${reports.length === 1 ? "" : "s"}.`);

async function readPostPack(dir: string): Promise<PostPack> {
  const raw = await readFile(path.join(dir, "post-pack.json"), "utf8");
  return JSON.parse(raw) as PostPack;
}

async function readVisualQaReports(dir: string): Promise<VisualQaReport[]> {
  const raw = await readFile(path.join(dir, "visual-qa.json"), "utf8");
  return JSON.parse(raw) as VisualQaReport[];
}
