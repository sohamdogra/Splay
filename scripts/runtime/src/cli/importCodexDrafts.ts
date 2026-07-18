import { readFile } from "node:fs/promises";
import { loadEnv } from "../config/loadEnv.ts";
import type { BrandProfile, EditorialContext, GeneratedPost, ImageCopy, LinkedInMentionEntity, Platform, PostIntent, PostPack, SourceContext } from "../types/index.ts";
import { normalizeLinkedInMentionEntity } from "../linkedin/mentions.ts";
import { checkImageCopy, checkPostDraft } from "../editorial/editorialGate.ts";
import { fitDraftToPlatform, validatePlatformPost } from "../postText.ts";
import { evaluatePlatformStrategy } from "../strategy/platformStrategy.ts";
import { sensitivityWarnings, scorePost } from "../agents/postScoringAgent.ts";
import { defaultBrandProfile, savePostPack } from "../storage/postStore.ts";
import { renderPreview } from "../render/previewRenderer.ts";
import { normalizeEditorialContext } from "../editorial/evidencePacket.ts";
import { buildPostIntent, defaultContentProgram } from "../editorial/contentProgram.ts";
import { EDITORIAL_SPEC_VERSION } from "../editorial/editorialSpec.ts";
import { runEditorialTournament } from "../editorial/editorialTournament.ts";

type CodexDraftFile = {
  generated_at?: string;
  brand?: Partial<BrandProfile>;
  discovered_themes?: string[];
  posts?: CodexDraftPost[];
};

type CodexDraftPost = {
  id?: string;
  platform?: Platform;
  topic?: string;
  post_text?: string;
  text?: string;
  hashtags?: string[];
  source_context?: Partial<SourceContext>;
  scheduled_for?: string | null;
  image_prompt?: string;
  alt_text?: string;
  image_copy?: Partial<ImageCopy>;
  image_headline?: string;
  image_support?: string;
  linkedin_mentions?: unknown;
  editorial_context?: Partial<EditorialContext>;
  post_intent?: Partial<PostIntent>;
};

loadEnv();

const inputPath = readArg("--input");
if (!inputPath) {
  console.error("Usage: import-drafts --input <codex-drafts.json>");
  process.exit(1);
}

const input = JSON.parse(await readFile(inputPath, "utf8")) as CodexDraftFile;
const brand = { ...defaultBrandProfile(), ...(input.brand ?? {}) };
const createdAt = input.generated_at ?? new Date().toISOString();
const sourcePosts = Array.isArray(input.posts) ? input.posts : [];
if (sourcePosts.length === 0) {
  console.error("No posts found in Codex draft input.");
  process.exit(1);
}

const skipEditorialGate = process.argv.includes("--skip-editorial-gate");
const built = sourcePosts.map((draft, index) => buildPost(draft, createdAt, index));
const gateFailures = built.filter((item) => item.editorialErrors.length > 0);
if (gateFailures.length > 0 && !skipEditorialGate) {
  console.error("Editorial gate rejected the draft import. Fix the copy and re-import:");
  for (const failure of gateFailures) {
    console.error(`\n${failure.post.id} (${failure.post.platform}):`);
    for (const error of failure.editorialErrors) console.error(`  - ${error}`);
  }
  console.error("\nSee references/editorial.md for the rewrite rules. Use --skip-editorial-gate only for a deliberate, explained exception.");
  process.exit(1);
}

const posts = built.map(({ post, editorialErrors }) =>
  editorialErrors.length > 0
    ? { ...post, warnings: [...post.warnings, ...editorialErrors.map((error) => `Editorial gate bypassed: ${error}`)] }
    : post
);
const pack: PostPack = {
  generated_at: createdAt,
  brand,
  discovered_themes: input.discovered_themes ?? unique(posts.map((post) => post.topic)),
  posts,
  publish_logs: [],
  editorial_spec_version: EDITORIAL_SPEC_VERSION,
  content_program: defaultContentProgram()
};

await savePostPack(pack);
const previewPath = await renderPreview(pack);
console.log(`Imported ${posts.length} Codex-authored draft(s).`);
console.log(`Preview: ${previewPath}`);

function buildPost(input: CodexDraftPost, createdAt: string, index: number): { post: GeneratedPost; editorialErrors: string[] } {
  const platform = normalizePlatform(input.platform);
  const topic = clean(input.topic) || "Splay social post";
  const sourceContext = normalizeSourceContext(input.source_context, topic);
  const normalizedEditorial = normalizeEditorialContext(input.editorial_context, { topic, sourceContext });
  const postIntent = normalizePostIntent(input.post_intent, topic, index);
  const fitted = fitDraftToPlatform(platform, {
    text: clean(input.post_text ?? input.text),
    hashtags: Array.isArray(input.hashtags) ? input.hashtags.map(String) : []
  });
  const strategy = evaluatePlatformStrategy(platform, fitted.text, fitted.hashtags);
  const platformValidation = validatePlatformPost(platform, fitted.text, fitted.hashtags);
  const imageCopy = normalizeImageCopy(input);
  const postGate = checkPostDraft({ platform, topic, postText: fitted.text, hashtags: fitted.hashtags });
  const imageGate = imageCopy
    ? checkImageCopy(imageCopy)
    : { errors: ["image_copy { headline, support } is required so final artwork uses editorially gated text."], warnings: [] };
  const tournament = runEditorialTournament({
    platform,
    topic,
    sourceContext,
    editorialContext: normalizedEditorial.context,
    postIntent,
    candidates: [{
      text: fitted.text,
      hashtags: fitted.hashtags,
      angle: postIntent.content_pillar === "product_proof" ? "product_proof" : postIntent.product_role === "none" ? "boundary_condition" : "operator_observation"
    }],
    evidenceSupplied: normalizedEditorial.supplied
  });
  const warnings = [
    ...sensitivityWarnings(`${fitted.text} ${sourceContext.summary}`),
    ...strategy.warnings,
    ...(platformValidation.ok || !platformValidation.message ? [] : [platformValidation.message]),
    ...postGate.warnings,
    ...imageGate.warnings,
    ...tournament.evaluation.compliance.warnings
  ];

  const post: GeneratedPost = {
    id: clean(input.id) || `codex-${slug(topic)}-${platform}-${postTimeId(createdAt)}-${index + 1}`,
    source_context: sourceContext,
    platform,
    topic,
    generation_model: "codex-chat",
    prompt_version: "app-import-v2-editorial-tournament",
    hook_type: inferHookType(fitted.text),
    format_type: inferFormatType(fitted.text),
    cta_type: inferCtaType(fitted.text),
    post_text: fitted.text,
    image_prompt: clean(input.image_prompt),
    image_url: "",
    image_provider: "placeholder",
    canva_design_url: null,
    alt_text: clean(input.alt_text),
    image_copy: imageCopy,
    linkedin_mentions: normalizeLinkedInMentions(input.linkedin_mentions),
    hashtags: fitted.hashtags,
    status: "draft",
    created_at: createdAt,
    scheduled_for: input.scheduled_for ?? null,
    quality_score: scorePost(platform, fitted.text, fitted.hashtags, warnings),
    warnings: unique(warnings),
    editorial_spec_version: EDITORIAL_SPEC_VERSION,
    editorial_context: normalizedEditorial.context,
    post_intent: postIntent,
    content_fingerprint: tournament.fingerprint,
    editorial_evaluation: tournament.evaluation,
    editorial_candidates: tournament.summaries,
    review_history: [],
    visual_treatment: chooseVisualTreatment(postIntent, normalizedEditorial.context)
  };

  return { post, editorialErrors: unique([...tournament.evaluation.compliance.errors, ...imageGate.errors]) };
}

function normalizePostIntent(value: Partial<PostIntent> | undefined, topic: string, index: number): PostIntent {
  const fallback = buildPostIntent(undefined, topic, index);
  return {
    audience_segment: clean(value?.audience_segment) || fallback.audience_segment,
    content_pillar: isContentPillar(value?.content_pillar) ? value.content_pillar : fallback.content_pillar,
    objective: isObjective(value?.objective) ? value.objective : fallback.objective,
    desired_reader_response: clean(value?.desired_reader_response) || fallback.desired_reader_response,
    product_role: isProductRole(value?.product_role) ? value.product_role : fallback.product_role
  };
}

function chooseVisualTreatment(intent: PostIntent, context: EditorialContext): GeneratedPost["visual_treatment"] {
  if (intent.content_pillar === "market_point_of_view" && intent.product_role === "none") return "text_only";
  if (intent.content_pillar === "product_proof") return "product_proof";
  if (context.evidence.some((item) => item.source_type === "customer" || item.source_type === "product")) return "evidence_artifact";
  if (/step|handoff|follow-up|workflow/i.test(context.observed_behavior)) return "workflow_explainer";
  return "editorial_thesis";
}

function isContentPillar(value: unknown): value is PostIntent["content_pillar"] {
  return ["workflow_observation", "product_proof", "operator_insight", "founder_lesson", "market_point_of_view"].includes(String(value));
}

function isObjective(value: unknown): value is PostIntent["objective"] {
  return ["authority", "education", "product_understanding", "conversation"].includes(String(value));
}

function isProductRole(value: unknown): value is PostIntent["product_role"] {
  return ["none", "supporting", "central"].includes(String(value));
}

function normalizeLinkedInMentions(value: unknown): LinkedInMentionEntity[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("linkedin_mentions must be an array of verified LinkedIn entities.");
  return value.map((entry) => normalizeLinkedInMentionEntity(entry));
}

function normalizeImageCopy(input: CodexDraftPost): ImageCopy | null {
  const headline = clean(input.image_copy?.headline ?? input.image_headline);
  const support = clean(input.image_copy?.support ?? input.image_support);
  if (!headline && !support) return null;
  return { headline, support };
}

function normalizePlatform(value: unknown): Platform {
  if (value === "x" || value === "linkedin") return value;
  throw new Error(`Invalid platform in Codex draft input: ${String(value)}`);
}

function normalizeSourceContext(value: Partial<SourceContext> | undefined, topic: string): SourceContext {
  return {
    summary: clean(value?.summary) || topic,
    gbrain_references: Array.isArray(value?.gbrain_references) ? value.gbrain_references.map(String) : [],
    why_now: clean(value?.why_now)
  };
}

function inferHookType(text: string): string {
  const first = text.split(/\n/).find(Boolean) ?? "";
  if (first.includes("?")) return "question";
  if (/^most|^the|^we\b/i.test(first)) return "point-of-view";
  return "observation";
}

function inferFormatType(text: string): string {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.some((line) => /^\d+\.|^- /.test(line.trim()))) return "list";
  if (lines.length <= 3) return "short-form";
  return "founder-note";
}

function inferCtaType(text: string): string {
  if (/\b(comment|reply|dm|reach out)\b/i.test(text)) return "explicit";
  if (/\?$/.test(text.trim())) return "question";
  return "soft";
}

function postTimeId(createdAt: string): string {
  return createdAt.replace(/[^0-9]/g, "").slice(0, 17);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "post";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
