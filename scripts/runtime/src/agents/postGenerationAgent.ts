import type { BrandProfile, EditorialContext, GeneratedPost, Platform, PostIntent, TopicIdea } from "../types/index.ts";
import { fitDraftToPlatform, validatePlatformPost } from "../postText.ts";
import { evaluatePlatformStrategy, platformStrategyPrompt } from "../strategy/platformStrategy.ts";
import { scorePost, sensitivityWarnings } from "./postScoringAgent.ts";
import { buildSocialFeedbackContext } from "../ai/buildSocialFeedbackContext.ts";
import { checkPostDraft, INTERNAL_JARGON_PHRASES } from "../editorial/editorialGate.ts";
import { buildExtractiveBrief } from "./visualBrief.ts";
import { creativeRunSeed, isCreativeMode, textTemperature } from "../config/creativeMode.ts";
import {
  assessPostDiversity,
  buildPostDiversityContext,
  type RecentPostReference
} from "../ai/postDiversityGuard.ts";
import { buildEditorialContext } from "../editorial/evidencePacket.ts";
import { buildPostIntent } from "../editorial/contentProgram.ts";
import { EDITORIAL_SPEC_VERSION } from "../editorial/editorialSpec.ts";
import {
  buildAngleBriefs,
  runEditorialTournament,
  type AngleBrief,
  type DraftCandidate
} from "../editorial/editorialTournament.ts";
import { generateTokenMartJson, tokenMartTextConfigured, tokenMartTextModel } from "../providers/tokenMartText.ts";

type Draft = {
  text: string;
  hashtags: string[];
  warnings?: string[];
  editorialEvaluation?: GeneratedPost["editorial_evaluation"];
  contentFingerprint?: GeneratedPost["content_fingerprint"];
  editorialCandidates?: GeneratedPost["editorial_candidates"];
  selectedAngle?: DraftCandidate["angle"];
};

type GeneratePostsOptions = {
  recentPosts?: RecentPostReference[];
  creativeSeed?: string;
  platforms?: Platform[];
};

const PROMPT_VERSION = "editorial-tournament-v4";
const ROBOTIC_SOCIAL_PHRASES = INTERNAL_JARGON_PHRASES;

export async function generatePostsForIdea(
  idea: TopicIdea,
  brand: BrandProfile,
  options: GeneratePostsOptions = {}
): Promise<GeneratedPost[]> {
  const creativeSeed = options.creativeSeed ?? creativeRunSeed();
  const platforms = options.platforms?.length ? [...new Set(options.platforms)] : ["linkedin", "x"] satisfies Platform[];
  const drafts = await Promise.all(platforms.map(async (platform) => ({
    platform,
    draft: await generateDraft(platform, idea, brand, options.recentPosts ?? [], creativeSeed)
  })));

  const createdAt = new Date().toISOString();
  return drafts.map(({ platform, draft }) => buildPost(platform, draft, idea, createdAt)).map(withGeneratedImageCopy);
}

function withGeneratedImageCopy(post: GeneratedPost): GeneratedPost {
  const brief = buildExtractiveBrief(post);
  return {
    ...post,
    image_copy: {
      headline: brief.headline,
      support: brief.supporting_text
    }
  };
}

export function postToRecentReference(post: GeneratedPost): RecentPostReference {
  return {
    id: post.id,
    platform: post.platform,
    topic: post.topic,
    text: post.post_text,
    createdAt: post.created_at,
    sourceReferences: post.source_context.gbrain_references,
    fingerprint: post.content_fingerprint,
    lifecycle: post.status === "posted" || post.status === "staged" ? "published" : post.status
  };
}

async function generateDraft(
  platform: Platform,
  idea: TopicIdea,
  brand: BrandProfile,
  recentPosts: RecentPostReference[],
  creativeSeed: string
): Promise<Draft> {
  const diversity = await buildPostDiversityContext(platform, idea.topic, recentPosts);
  const editorialContext = editorialContextFor(idea);
  const postIntent = idea.post_intent ?? buildPostIntent(undefined, idea.topic);

  if (process.env.SOCIAL_AGENT_USE_MOCK_LLM === "1") {
    return localTournamentDraft(platform, idea, brand, editorialContext, postIntent, diversity.recentPosts, creativeSeed);
  }

  const angleBriefs = buildAngleBriefs({ ...idea, editorial_context: editorialContext, post_intent: postIntent })
    .slice(0, textCandidateCount());
  const prompts = await Promise.all(angleBriefs.map((angle) => buildPrompt(platform, idea, brand, diversity.promptContext, creativeSeed, angle, editorialContext, postIntent)));
  const remoteResults = await Promise.all(prompts.map((prompt) => callTextModel(prompt, platform)));
  const candidates = remoteResults.flatMap((remote, index) => {
    const normalized = remote ? normalizeDraft(remote, platform) : null;
    if (!normalized) return [];
    const safe = enforceGeneratedHashtagGate(platform, normalized, idea);
    return [{
      text: safe.text,
      hashtags: safe.hashtags,
      angle: angleBriefs[index].angle,
      thesis: angleBriefs[index].thesis,
      readerTakeaway: angleBriefs[index].reader_takeaway
    } satisfies DraftCandidate];
  });

  if (candidates.length === 0) {
    return localTournamentDraft(platform, idea, brand, editorialContext, postIntent, diversity.recentPosts, creativeSeed);
  }

  return tournamentDraft(platform, idea, editorialContext, postIntent, candidates, diversity.recentPosts, Boolean(idea.editorial_context));
}

function textCandidateCount(): number {
  const parsed = Number(process.env.SOCIAL_AGENT_TEXT_CANDIDATES ?? "1");
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

function buildPost(platform: Platform, draft: Draft, idea: TopicIdea, createdAt: string): GeneratedPost {
  const safeDraft = enforceGeneratedHashtagGate(platform, draft, idea);
  const platformValidation = validatePlatformPost(platform, safeDraft.text, safeDraft.hashtags);
  const strategy = evaluatePlatformStrategy(platform, safeDraft.text, safeDraft.hashtags);
  const warnings = [
    ...sensitivityWarnings(`${safeDraft.text} ${idea.source_context.summary}`),
    ...strategy.warnings,
    ...(safeDraft.warnings ?? []),
    ...(platformValidation.ok || !platformValidation.message ? [] : [platformValidation.message])
  ];
  const quality = scorePost(platform, safeDraft.text, safeDraft.hashtags, warnings);
  const postIntent = selectedPostIntent(idea.post_intent ?? buildPostIntent(undefined, idea.topic), draft.selectedAngle);
  const editorialContext = editorialContextFor(idea);

  return {
    id: `${idea.id}-${platform}-${postTimeId(createdAt)}`,
    source_context: idea.source_context,
    platform,
    topic: idea.topic,
    generation_model: generationModelName(),
    prompt_version: PROMPT_VERSION,
    hook_type: inferHookType(safeDraft.text),
    format_type: inferFormatType(safeDraft.text),
    cta_type: inferCtaType(safeDraft.text),
    post_text: safeDraft.text,
    image_prompt: "",
    image_url: "",
    image_provider: "placeholder",
    canva_design_url: null,
    alt_text: "",
    hashtags: safeDraft.hashtags,
    status: "draft",
    created_at: createdAt,
    scheduled_for: null,
    quality_score: quality,
    warnings: [...new Set(warnings)],
    editorial_spec_version: EDITORIAL_SPEC_VERSION,
    editorial_context: editorialContext,
    post_intent: postIntent,
    content_fingerprint: draft.contentFingerprint,
    editorial_evaluation: draft.editorialEvaluation,
    editorial_candidates: draft.editorialCandidates,
    review_history: [],
    visual_treatment: chooseVisualTreatment(postIntent, editorialContext)
  };
}

function localTournamentDraft(
  platform: Platform,
  idea: TopicIdea,
  brand: BrandProfile,
  editorialContext: EditorialContext,
  postIntent: PostIntent,
  recentPosts: RecentPostReference[],
  creativeSeed: string
): Draft {
  const angleBriefs = buildAngleBriefs({ ...idea, editorial_context: editorialContext, post_intent: postIntent });
  const rawCandidates = localCandidateTexts(platform, idea, brand, creativeSeed);
  const candidates = rawCandidates.slice(0, Math.max(3, Math.min(6, rawCandidates.length))).map((text, index) => {
    const brief = angleBriefs[index % angleBriefs.length];
    const fitted = fitDraftToPlatform(platform, {
      text,
      hashtags: platform === "linkedin" ? linkedinFallbackHashtags(`${idea.topic} ${idea.angle} ${idea.source_context.summary} ${text}`) : []
    });
    return {
      text: fitted.text,
      hashtags: fitted.hashtags,
      angle: inferCandidateAngle(fitted.text, brief.angle),
      thesis: brief.thesis,
      readerTakeaway: brief.reader_takeaway
    } satisfies DraftCandidate;
  });
  return tournamentDraft(platform, idea, editorialContext, postIntent, candidates, recentPosts, Boolean(idea.editorial_context));
}

function inferCandidateAngle(text: string, fallback: DraftCandidate["angle"]): DraftCandidate["angle"] {
  const productIndex = text.toLowerCase().indexOf("splay");
  const productMentions = text.match(/\bSplay\b/gi)?.length ?? 0;
  if (productIndex >= 0 && (productMentions > 1 || productIndex < text.length * 0.55)) return "product_proof";
  if (/\b(not|but|instead|unless|only when|only if|test|before asking|the point)\b/i.test(text)) return "boundary_condition";
  return fallback === "product_proof" ? "operator_observation" : fallback;
}

function tournamentDraft(
  platform: Platform,
  idea: TopicIdea,
  editorialContext: EditorialContext,
  postIntent: PostIntent,
  candidates: DraftCandidate[],
  recentPosts: RecentPostReference[],
  evidenceSupplied: boolean
): Draft {
  const tournament = runEditorialTournament({
    platform,
    topic: idea.topic,
    sourceContext: idea.source_context,
    editorialContext,
    postIntent,
    candidates,
    recentPosts,
    evidenceSupplied
  });
  const lexical = assessPostDiversity(tournament.selected.text, recentPosts);
  return {
    text: tournament.selected.text,
    hashtags: tournament.selected.hashtags,
    warnings: [
      ...tournament.evaluation.compliance.errors.map((error) => `Editorial compliance error: ${error}`),
      ...tournament.evaluation.compliance.warnings,
      ...lexical.warnings,
      ...(tournament.evaluation.editorial_review.verdict === "publish" ? [] : [`Editorial verdict: ${tournament.evaluation.editorial_review.verdict}. Revise or reject before approval.`])
    ],
    editorialEvaluation: tournament.evaluation,
    contentFingerprint: tournament.fingerprint,
    editorialCandidates: tournament.summaries,
    selectedAngle: tournament.selected.angle
  };
}

function editorialContextFor(idea: TopicIdea): EditorialContext {
  if (idea.editorial_context) return idea.editorial_context;
  return buildEditorialContext(idea.topic, [{
    id: idea.source_context.gbrain_references[0] ?? idea.id,
    title: idea.topic,
    kind: "company_context",
    summary: idea.source_context.summary,
    references: idea.source_context.gbrain_references,
    tags: []
  }]);
}

function selectedPostIntent(intent: PostIntent, angle: DraftCandidate["angle"] | undefined): PostIntent {
  if (angle === "boundary_condition") return { ...intent, product_role: "none", objective: "authority" };
  if (angle === "product_proof") return { ...intent, product_role: "central", objective: "product_understanding" };
  return intent;
}

function chooseVisualTreatment(intent: PostIntent, context: EditorialContext): GeneratedPost["visual_treatment"] {
  if (intent.content_pillar === "market_point_of_view" && intent.product_role === "none") return "text_only";
  if (intent.content_pillar === "product_proof") return "product_proof";
  if (context.evidence.some((item) => item.source_type === "customer" || item.source_type === "product")) return "evidence_artifact";
  if (/step|handoff|follow-up|workflow/i.test(context.observed_behavior)) return "workflow_explainer";
  return "editorial_thesis";
}

function enforceGeneratedHashtagGate(platform: Platform, draft: Draft, idea: TopicIdea): Draft {
  const hashtagErrors = checkPostDraft({
    platform,
    topic: idea.topic,
    postText: draft.text,
    hashtags: draft.hashtags
  }).errors.filter((error) => /hashtag/i.test(error));
  if (hashtagErrors.length === 0) return draft;

  const hashtags = platform === "linkedin"
    ? linkedinFallbackHashtags(`${idea.topic} ${idea.angle} ${idea.source_context.summary} ${draft.text}`)
    : [];
  const fitted = fitDraftToPlatform(platform, { text: draft.text, hashtags });
  return {
    ...fitted,
    warnings: [...(draft.warnings ?? []), "Unsupported model hashtags were replaced with topic-aware discovery tags."]
  };
}

function postTimeId(createdAt: string): string {
  return createdAt.replace(/[^0-9]/g, "").slice(0, 17);
}

function localCandidateTexts(
  platform: Platform,
  idea: TopicIdea,
  brand: BrandProfile,
  creativeSeed: string
): string[] {
  const claim = cleanSourcePhrase(sourceFragments(idea.source_context.summary)[0] || idea.topic);
  const safeTopic = cleanSourcePhrase(idea.topic);
  const topic = sentenceCase(safeTopic);
  const candidates = platform === "linkedin" ? [
    [
      topic,
      "",
      ensurePeriod(claim),
      "",
      `For ${brand.name}, the useful question is what this means for ${brand.audience.toLowerCase()}.`,
      "",
      ensurePeriod(brand.positioning),
      "",
      "The point is to stay specific: use the source, make one supported claim, and leave the reader with a practical next step."
    ].join("\n"),
    [
      ensurePeriod(claim),
      "",
      `That is the concrete signal behind ${safeTopic.toLowerCase()}.`,
      "",
      "It is easy to turn a signal like this into a broad category claim. The stronger approach is narrower: explain what changed, who it matters to, and what the evidence can actually support.",
      "",
      `${brand.name} is approaching the topic with a ${brand.tone.toLowerCase()} voice.`
    ].join("\n"),
    [
      `One source can sharpen a company point of view: ${ensurePeriod(lowercaseFirst(claim))}`,
      "",
      "The source does not need extra claims added to it. It needs a clear interpretation and an honest boundary around what is known.",
      "",
      `That is the standard ${brand.name} is using for this topic.`
    ].join("\n")
  ] : [
    `${topic}. ${ensurePeriod(claim)} One supported source is more useful than a broad claim.`,
    `${ensurePeriod(claim)} That is the clearest signal behind ${safeTopic.toLowerCase()}.`,
    `${brand.name}'s take on ${safeTopic.toLowerCase()}: ${ensurePeriod(lowercaseFirst(claim))}`
  ];
  return rotateCandidates(candidates, `${idea.id}:${platform}:${creativeSeed}`);
}

function rotateCandidates(values: string[], seed: string): string[] {
  if (values.length <= 1) return values;
  let hash = 17;
  for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const start = Math.abs(hash) % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

async function buildPrompt(
  platform: Platform,
  idea: TopicIdea,
  brand: BrandProfile,
  diversityContext = "",
  creativeSeed = creativeRunSeed(),
  angleBrief?: AngleBrief,
  editorialContext: EditorialContext = editorialContextFor(idea),
  postIntent: PostIntent = idea.post_intent ?? buildPostIntent(undefined, idea.topic)
): Promise<string> {
  const platformInstructions = platform === "x"
    ? [
        "Write a single X post, not a thread.",
        "Keep the final published text at or below 280 characters total, including any hashtags.",
        "Use viewer-friendly spacing: prefer 2 short paragraphs separated by one blank line when the post has more than one beat.",
        "Use zero hashtags unless they materially improve the post and fit inside the 280-character limit."
      ]
    : [
        "Write one LinkedIn post.",
        "Return 3-4 relevant LinkedIn hashtags in the hashtags array, separate from the post body.",
        "Choose a targeted mix: audience or industry, workflow or use case, and the post's specific topic. Avoid generic or unrelated tags."
      ];

  const feedbackContext = await loadFeedbackContext();
  return [
    `Write one ${platform === "linkedin" ? "LinkedIn post" : "X post"} for ${brand.name}.`,
    feedbackContext ? `${feedbackContext}\nUse this feedback as guidance, not as a hard template.` : "",
    diversityContext,
    ...creativePromptInstructions(platform, creativeSeed),
    ...platformInstructions,
    ...platformStrategyPrompt(platform),
    `Audience: ${brand.audience}.`,
    `Tone: ${brand.tone}.`,
    `Positioning: ${brand.positioning}.`,
    `Avoid: ${brand.avoid.join(", ")}.`,
    `Topic: ${idea.topic}.`,
    `Angle: ${idea.angle}.`,
    `Post intent: ${postIntent.content_pillar}; objective: ${postIntent.objective}; audience segment: ${postIntent.audience_segment}; product role: ${angleBrief?.product_role ?? postIntent.product_role}.`,
    `Desired reader response: ${postIntent.desired_reader_response}`,
    `Central public-safe claim: ${editorialContext.public_safe_claim}.`,
    `Actor: ${editorialContext.actor}. Concrete object: ${editorialContext.concrete_object}. Observed behavior: ${editorialContext.observed_behavior}.`,
    `Evidence excerpts:\n${editorialContext.evidence.map((item) => `- ${item.source_slug}: ${item.excerpt}`).join("\n")}`,
    angleBrief ? `Candidate lane: ${angleBrief.angle}. Thesis: ${angleBrief.thesis}. Hook direction: ${angleBrief.hook_direction}. Reader takeaway: ${angleBrief.reader_takeaway}.` : "",
    "Use only facts and product capabilities present in the evidence packet. If the evidence cannot support the candidate lane, write the narrowest supported version.",
    "Do not collapse the platform versions into summaries of one another; this candidate must work as a standalone native post.",
    "Write like a sharp startup founder/operator post, not a consulting memo, analyst report, or internal strategy note.",
    `Do not use these public-copy phrases: ${ROBOTIC_SOCIAL_PHRASES.join(", ")}.`,
    "Use one concrete proof point or tension from the company context instead of broad workflow commentary.",
    "Favor plain language a founder would actually post: specific nouns, short sentences, and a real point of view.",
    "Do not reuse the topic as the opening sentence. Do not mirror the visual headline if one is obvious from the topic.",
    "Do not invent names, revenue numbers, metrics, partnerships, or confidential details.",
    "Return strict JSON with fields text, hashtags, angle, proof_point, reader_takeaway, and avoided_recent_pattern."
  ].filter(Boolean).join("\n");
}

function creativePromptInstructions(platform: Platform, creativeSeed: string): string[] {
  if (!isCreativeMode()) return [];
  return [
    "CREATIVE RERUN MODE",
    `Creative run seed: ${creativeSeed}. Use it as permission to make this pass feel meaningfully different from previous drafts.`,
    "Do not write a safer version of a familiar post. Find a sharper narrative lane, a less expected opening, or a concrete operator scene from the source context.",
    "Avoid repeating the same rhythm across platforms. The LinkedIn post can carry a fuller argument; the X post should feel like a distinct standalone thought.",
    platform === "linkedin"
      ? "For LinkedIn, prefer a memorable first line, one concrete tension, and a clean founder point of view over a tidy explainer."
      : "For X, compress the point until it reads like a fresh observation, not a summary of the LinkedIn post."
  ];
}

function sourceFragments(summary: string): string[] {
  const sentences = summary.split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/[.!?]+$/, "").trim())
    .filter((sentence) => sentence.length >= 18);
  const clauses = sentences.flatMap((sentence) => sentence.split(/[,;:]\s+|\s+\b(?:but|and|while|because)\b\s+/i))
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 18);
  return uniqueFragments([...sentences, ...clauses]).slice(0, 5);
}

function uniqueFragments(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : trimmed;
}

function lowercaseFirst(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toLowerCase()}${trimmed.slice(1)}` : trimmed;
}

function ensurePeriod(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function cleanSourcePhrase(value: string): string {
  return value
    .replace(/^(the source says that|company notes show that|the update says that|the team reported that)\s+/i, "")
    .replace(/\bsource[- ]backed\b/gi, "")
    .replace(/\bsource context\b/gi, "company notes")
    .replace(/\bworkflow memory\b/gi, "the history the team already has")
    .replace(/\bprocess memory\b/gi, "how the firm actually works")
    .replace(/\bworkflow fit\b/gi, "fitting the team's real workflow")
    .replace(/\bmodel iq\b/gi, "raw model smarts")
    .replace(/\bmodel intelligence\b/gi, "raw model smarts")
    .replace(/\bvisible artifact\b/gi, "visible output")
    .replace(/\boperating reality\b/gi, "what the team needs")
    .replace(/\boperating continuity\b/gi, "a cleaner handoff")
    .replace(/\buseful wedge\b/gi, "starting point")
    .replace(/\bnew systems create another destination\b/gi, "a new system becomes one more place to update")
    .replace(/\banother destination\b/gi, "one more place to update")
    .replace(/\bcodify existing work\b/gi, "capture work teams already do")
    .replace(/\badoption cost\b/gi, "duplicate work")
    .replace(/\baround it\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function callTextModel(prompt: string, platform: Platform): Promise<Draft | null> {
  if (process.env.ANTHROPIC_API_KEY) {
    const draft = await callAnthropic(prompt, platform);
    if (draft) return draft;
  }

  if (process.env.OPENAI_API_KEY) {
    const draft = await callOpenAI(prompt, platform);
    if (draft) return draft;
  }

  if (tokenMartTextConfigured()) {
    const raw = await generateTokenMartJson(prompt, {
      maxTokens: isCreativeMode() ? 1_100 : 900,
      temperature: textTemperature()
    });
    const draft = raw ? normalizeDraft(raw, platform) : null;
    if (draft) return draft;
  }

  return null;
}

async function callOpenAI(prompt: string, platform: Platform): Promise<Draft | null> {
  try {
    const requestBody: Record<string, unknown> = {
      model: process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini",
      input: prompt,
      text: { format: { type: "json_object" } }
    };
    const temperature = textTemperature();
    if (temperature !== undefined) requestBody.temperature = temperature;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) return null;
    const responseBody = await response.json() as Record<string, unknown>;
    return normalizeDraft(extractResponseText(responseBody), platform);
  } catch {
    return null;
  }
}

async function callAnthropic(prompt: string, platform: Platform): Promise<Draft | null> {
  try {
    const requestBody: Record<string, unknown> = {
      model: process.env.ANTHROPIC_TEXT_MODEL ?? "claude-3-5-sonnet-latest",
      max_tokens: isCreativeMode() ? 1100 : 900,
      messages: [{ role: "user", content: prompt }]
    };
    const temperature = textTemperature();
    if (temperature !== undefined) requestBody.temperature = temperature;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": String(process.env.ANTHROPIC_API_KEY),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) return null;
    const responseBody = await response.json() as Record<string, unknown>;
    return normalizeDraft(extractAnthropicText(responseBody), platform);
  } catch {
    return null;
  }
}

function normalizeDraft(value: unknown, platform: Platform): Draft | null {
  if (!value) return null;

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
    const text = String(parsed.text ?? parsed.post_text ?? "").trim();
    if (!text) return null;
    const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [];
    const fitted = fitDraftToPlatform(platform, { text, hashtags });
    return platform === "linkedin" && fitted.hashtags.length < 3
      ? fitDraftToPlatform(platform, { text: fitted.text, hashtags: [...fitted.hashtags, ...linkedinFallbackHashtags(text)] })
      : fitted;
  } catch {
    return null;
  }
}

function linkedinFallbackHashtags(corpus: string): string[] {
  const stopWords = new Set(["about", "after", "again", "because", "behind", "between", "company", "could", "every", "first", "from", "have", "into", "more", "should", "source", "their", "there", "these", "thing", "those", "topic", "using", "what", "when", "where", "which", "with", "would"]);
  const words = corpus.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [];
  return [...new Set(words.filter((word) => !stopWords.has(word)))]
    .slice(0, 4)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`);
}

function extractResponseText(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  return output.flatMap((item) => {
    const content = (item as Record<string, unknown>).content;
    return Array.isArray(content) ? content : [];
  }).map((part) => String((part as Record<string, unknown>).text ?? "")).join("");
}

function extractAnthropicText(body: Record<string, unknown>): string {
  const content = Array.isArray(body.content) ? body.content : [];
  return content.map((part) => String((part as Record<string, unknown>).text ?? "")).join("");
}

async function loadFeedbackContext(): Promise<string> {
  try {
    return await buildSocialFeedbackContext();
  } catch {
    return "";
  }
}

function generationModelName(): string {
  if (process.env.SOCIAL_AGENT_USE_MOCK_LLM === "1") return "mock-local";
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_TEXT_MODEL ?? "claude-3-5-sonnet-latest";
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini";
  if (tokenMartTextConfigured()) return `tokenmart:${tokenMartTextModel()}`;
  return "local-template";
}

function inferHookType(text: string): string {
  const firstLine = text.split(/\n/).find((line) => line.trim())?.trim() ?? "";
  if (firstLine.endsWith("?")) return "question";
  if (/\b(pain|hard part|lose|stuck|risk|problem)\b/i.test(firstLine)) return "pain_point";
  if (/\b\d+x|\d+%|\d+\b/.test(firstLine)) return "specific_claim";
  return "observation";
}

function inferFormatType(text: string): string {
  const lines = text.split(/\n/).filter((line) => line.trim());
  if (lines.length >= 8) return "long_form";
  if (text.length <= 280) return "short_form";
  return "standard_post";
}

function inferCtaType(text: string): string {
  const lastLine = text.split(/\n/).filter((line) => line.trim()).at(-1) ?? "";
  if (lastLine.trim().endsWith("?")) return "question";
  if (/\b(comment|reply|dm|tell me|share)\b/i.test(lastLine)) return "engagement";
  return "none";
}
