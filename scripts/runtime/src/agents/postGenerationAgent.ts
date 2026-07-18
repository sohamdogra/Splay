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
  selectDiverseVariant,
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
};

const PROMPT_VERSION = "editorial-tournament-v4";
const ROBOTIC_SOCIAL_PHRASES = INTERNAL_JARGON_PHRASES;

export async function generatePostsForIdea(
  idea: TopicIdea,
  brand: BrandProfile,
  options: GeneratePostsOptions = {}
): Promise<GeneratedPost[]> {
  const creativeSeed = options.creativeSeed ?? creativeRunSeed();
  const [linkedin, x] = await Promise.all([
    generateDraft("linkedin", idea, brand, options.recentPosts ?? [], creativeSeed),
    generateDraft("x", idea, brand, options.recentPosts ?? [], creativeSeed)
  ]);

  const createdAt = new Date().toISOString();
  return [
    buildPost("linkedin", linkedin, idea, createdAt),
    buildPost("x", x, idea, createdAt)
  ].map(withGeneratedImageCopy);
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

  const angleBriefs = buildAngleBriefs({ ...idea, editorial_context: editorialContext, post_intent: postIntent });
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
    kind: "gbrain_context",
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

function localDraft(
  platform: Platform,
  idea: TopicIdea,
  brand: BrandProfile,
  recentPosts: RecentPostReference[] = [],
  creativeSeed = creativeRunSeed()
): Draft {
  if (platform === "linkedin") {
    const topicCandidates = linkedinTopicCandidates(idea, brand);
    const baseCandidates = topicCandidates.length > 0
      ? [...topicCandidates, ...creativeLinkedinLocalDraftCandidates(idea, brand)]
      : linkedinLocalDraftCandidates(idea, brand);
    const candidates = isCreativeMode() && topicCandidates.length === 0
      ? [...baseCandidates, ...creativeLinkedinLocalDraftCandidates(idea, brand)]
      : baseCandidates;
    const selectionSeed = isCreativeMode() ? `${idea.id}:${platform}:${creativeSeed}` : `${idea.id}:${platform}`;
    const text = selectDiverseVariant(selectionSeed, candidates, recentPosts);
    const draft = fitDraftToPlatform(platform, {
      text,
      hashtags: linkedinFallbackHashtags(`${idea.topic} ${idea.angle} ${idea.source_context.summary} ${text}`)
    });
    const assessment = assessPostDiversity(draft.text, recentPosts);
    return { ...draft, warnings: assessment.warnings };
  }

  const topicCandidates = xTopicCandidates(idea);
  const baseCandidates = topicCandidates.length > 0
    ? [...topicCandidates, ...creativeXLocalDraftCandidates(idea)]
    : xLocalDraftCandidates(idea);
  const candidates = isCreativeMode() && topicCandidates.length === 0
    ? [...baseCandidates, ...creativeXLocalDraftCandidates(idea)]
    : baseCandidates;
  const selectionSeed = isCreativeMode() ? `${idea.id}:${platform}:${creativeSeed}` : `${idea.id}:${platform}`;
  const text = selectDiverseVariant(selectionSeed, candidates, recentPosts);
  const draft = fitDraftToPlatform(platform, {
    text,
    hashtags: []
  });
  const assessment = assessPostDiversity(draft.text, recentPosts);
  return { ...draft, warnings: assessment.warnings };
}

function localCandidateTexts(
  platform: Platform,
  idea: TopicIdea,
  brand: BrandProfile,
  creativeSeed: string
): string[] {
  if (platform === "linkedin") {
    const topicCandidates = linkedinTopicCandidates(idea, brand);
    const baseCandidates = topicCandidates.length > 0 ? topicCandidates : linkedinLocalDraftCandidates(idea, brand);
    const candidates = isCreativeMode() && topicCandidates.length === 0
      ? [...baseCandidates, ...creativeLinkedinLocalDraftCandidates(idea, brand)]
      : baseCandidates;
    return rotateCandidates(candidates, `${idea.id}:${platform}:${creativeSeed}`);
  }
  const topicCandidates = xTopicCandidates(idea);
  const baseCandidates = topicCandidates.length > 0 ? topicCandidates : xLocalDraftCandidates(idea);
  const candidates = isCreativeMode() && topicCandidates.length === 0
    ? [...baseCandidates, ...creativeXLocalDraftCandidates(idea)]
    : baseCandidates;
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

function linkedinLocalDraftCandidates(idea: TopicIdea, brand: BrandProfile): string[] {
  const fragments = sourceFragments(idea.source_context.summary);
  const primary = cleanSourcePhrase(fragments[0] ?? idea.angle);
  const secondary = cleanSourcePhrase(fragments[1] ?? "the team has to rebuild trust before it can move");
  const tertiary = cleanSourcePhrase(fragments[2] ?? "the next owner has to rebuild the story");
  const angle = cleanAngle(idea.angle);
  const specific = linkedinTopicCandidates(idea, brand);
  if (specific.length > 0) return specific;

  return [
    [
      "We keep seeing the same failure mode in deal work.",
      "",
      ensurePeriod(sentenceCase(primary)),
      "",
      "That is not a reason to add another status meeting.",
      "",
      "It is a reason to keep the handoff rules, follow-ups, and decisions close to the work itself.",
      "",
      "The bar is simple: the next owner should know what changed, why it changed, and what needs attention first.",
      "",
      `${brand.name} is building for that kind of handoff.`
    ].join("\n"),
    [
      "Most workflow software gets blamed for adoption.",
      "",
      "The deeper issue is usually work duplication.",
      "",
      `If ${lowercaseFirst(secondary)}, the team has to rebuild trust before it can move.`,
      "",
      `That is why ${lowercaseFirst(idea.topic)} matters: not because it sounds efficient, but because the next person inherits the judgment behind the task.`
    ].join("\n"),
    [
      "The product question we care about is boring in the best way:",
      "",
      "Can the next owner pick up the work without asking three people what happened?",
      "",
      `The clue in the notes was specific: ${ensurePeriod(primary)}`,
      "",
      "That is the difference between a workflow that looks organized and one the team can actually run."
    ].join("\n"),
    [
      "A clean view can make messy work look solved.",
      "",
      "It still cannot decide who owns the next move.",
      "",
      `That matters here because ${ensurePeriod(lowercaseFirst(primary))}`,
      "",
      "The teams that move fastest are not the ones with the prettiest view. They are the ones that keep decisions, risks, and follow-ups attached to the work."
    ].join("\n"),
    [
      "The handoff is where a lot of software promises break.",
      "",
      `By the time work moves from one owner to the next, the important parts are often outside the tool: ${ensurePeriod(lowercaseFirst(secondary))}`,
      "",
      `That is the gap ${brand.name} is focused on.`,
      "",
      "Not more places to update. Less rebuilding."
    ].join("\n"),
    [
      "Before adding another workflow layer, ask a smaller question:",
      "",
      "What does the team already repeat by hand?",
      "",
      `In the notes, the answer was specific: ${ensurePeriod(primary)}`,
      "",
      "That repeated judgment is the thing to capture. Improve that first; automate second."
    ].join("\n"),
    [
      "A useful workflow should carry the story with it.",
      "",
      "Who decided.",
      "What changed.",
      "What is still open.",
      "What happens next.",
      "",
      "That sounds basic until the work crosses from diligence to execution, or from founder memory to team process.",
      "",
      `Our view: ${sentenceCase(angle)}`
    ].join("\n"),
    [
      "A lot of workflow software treats the task as the product.",
      "",
      `The real product is the judgment around the task: ${ensurePeriod(lowercaseFirst(primary))}`,
      "",
      "If that judgment stays in someone's head, every handoff becomes a rebuild.",
      "",
      "The better workflow keeps the judgment with the work."
    ].join("\n")
  ];
}

function creativeLinkedinLocalDraftCandidates(idea: TopicIdea, brand: BrandProfile): string[] {
  const fragments = sourceFragments(idea.source_context.summary);
  const primary = cleanSourcePhrase(fragments[0] ?? idea.angle);
  const secondary = cleanSourcePhrase(fragments[1] ?? "the next owner has to rebuild the story");
  const topic = lowercaseFirst(idea.topic);

  return [
    [
      "The expensive part is usually not the task.",
      "",
      "It is the missing story around the task.",
      "",
      ensurePeriod(sentenceCase(primary)),
      "",
      "When that story disappears, the next owner does not inherit momentum. They inherit a research project.",
      "",
      `${brand.name}'s bet is simple: the workflow should carry the judgment, not just the checkbox.`
    ].join("\n"),
    [
      "A lot of teams do not need more process.",
      "",
      "They need the process they already trust to stop vanishing between owners.",
      "",
      `That is the useful read on ${topic}: ${ensurePeriod(lowercaseFirst(secondary))}`,
      "",
      "The best system is not the loudest one. It is the one that keeps the next move obvious when the work changes hands."
    ].join("\n"),
    [
      "There is a quiet moment where deal work starts to decay.",
      "",
      "Not when the analysis is wrong.",
      "When the reason behind the work is separated from the work itself.",
      "",
      `The source note points to it directly: ${ensurePeriod(primary)}`,
      "",
      "That is the moment worth designing around."
    ].join("\n"),
    [
      "The best workflow test is not whether the screen looks organized.",
      "",
      "It is whether a smart person can enter halfway through and still understand the why.",
      "",
      `That matters here because ${ensurePeriod(lowercaseFirst(primary))}`,
      "",
      "If the why has to be rebuilt in a meeting, the system did not really carry the work."
    ].join("\n")
  ];
}

function xLocalDraftCandidates(idea: TopicIdea): string[] {
  const fragments = sourceFragments(idea.source_context.summary);
  const primary = cleanSourcePhrase(fragments[0] ?? idea.angle);
  const secondary = cleanSourcePhrase(fragments[1] ?? "the next owner has to rebuild the story");
  const tertiary = cleanSourcePhrase(fragments[2] ?? "the decision trail is hard to trust");
  const take = xTakeaway(idea, primary);
  const specific = xTopicCandidates(idea);
  if (specific.length > 0) return specific;

  return [
    take,
    `${sentenceCase(primary)}. The test is whether the next owner can move without rebuilding the story.`,
    `${idea.topic} is not just a speed problem. If ${lowercaseFirst(secondary)}, the workflow still depends on memory.`,
    `A better test for ${lowercaseFirst(idea.topic)}: can the next owner see what changed, why it matters, and what to do next?`,
    `${sentenceCase(tertiary)}. Without that, the next owner is just rebuilding the work.`
  ];
}

function creativeXLocalDraftCandidates(idea: TopicIdea): string[] {
  const fragments = sourceFragments(idea.source_context.summary);
  const primary = cleanSourcePhrase(fragments[0] ?? idea.angle);
  const secondary = cleanSourcePhrase(fragments[1] ?? "the next owner has to rebuild the story");

  return [
    `The task is rarely the whole work. The missing part is the judgment around it: ${lowercaseFirst(truncateSentence(primary, 116))}.`,
    `A workflow fails when the next owner inherits status without the story behind it.`,
    `If ${lowercaseFirst(truncateSentence(secondary, 126))}, speed just moves confusion faster.`,
    `The best operating system for deal work is the one that keeps the why attached to the next move.`,
    `Fresh test: can someone join halfway through the work and still understand what changed, why it matters, and who owns the next move?`
  ];
}

function linkedinTopicCandidates(idea: TopicIdea, brand: BrandProfile): string[] {
  const haystack = `${idea.topic} ${idea.source_context.summary}`.toLowerCase();
  const topic = idea.topic.toLowerCase();

  if (/\bdashboards?\b/.test(haystack) && /\b(?:accountability|ownership|assign|follow-through)\b/.test(haystack)) {
    return [
      [
        "Dashboards are useful.",
        "",
        "They are not accountability.",
        "",
        "A dashboard can show that work exists. It cannot decide who owns the next move.",
        "",
        "The company notes were blunt: dashboards help visibility, but they do not create clear ownership or repeatable follow-through by themselves.",
        "",
        "That is the line Splay cares about: visibility should lead to action, not another place to look."
      ].join("\n"),
      [
        "The dashboard is usually where teams look after work has already drifted.",
        "",
        "That is the problem.",
        "",
        "If ownership is unclear, a cleaner view just makes the gap easier to see.",
        "",
        "The workflow needs to carry the next owner, the open risk, and the follow-up, not just the status."
      ].join("\n"),
      [
        "Dashboard-first tools can feel useful and still disappoint.",
        "",
        "They make work visible.",
        "",
        "They do not make work owned.",
        "",
        "For deal teams, that distinction matters because execution breaks in the gap between \"we can see it\" and \"someone is accountable for moving it.\""
      ].join("\n")
    ];
  }

  if (/\boperating cadence|deal cadence|rebuilt by hand|handoff rules|status rituals\b/.test(topic)) {
    return [
      [
        "Deal cadence should not have to be rebuilt every week.",
        "",
        "But that is what happens when the real operating system lives in spreadsheets, chats, and memory.",
        "",
        "The model is not the hard part. The handoff rules, diligence follow-ups, and status rituals around it are.",
        "",
        "That is the work Splay wants to keep attached to the workflow."
      ].join("\n"),
      [
        "The quiet cost in deal work is not always the analysis.",
        "",
        "It is the rebuild.",
        "",
        "When cadence lives across spreadsheets, chats, and memory, every handoff asks the next owner to reconstruct how the work is supposed to move.",
        "",
        "A better system should carry the rules with the work."
      ].join("\n"),
      [
        "A lot of deal cadence is invisible until it breaks.",
        "",
        "Who follows up.",
        "Which status ritual matters.",
        "What the next owner should do first.",
        "",
        "Those details decide whether work moves smoothly or gets rebuilt by hand again."
      ].join("\n")
    ];
  }

  if (/\bagents?\b/.test(haystack) && /\bprocess memory\b/.test(haystack)) {
    return [
      [
        "AI agents are the wrong starting line for deal work.",
        "",
        "The starting line is process memory.",
        "",
        "Who decides. What signals matter. Which exceptions change the answer.",
        "",
        "Without that, an agent is just acting on a thin version of the work.",
        "",
        `${brand.name}'s view: map how the firm makes decisions first; automate after.`
      ].join("\n"),
      [
        "The hard part is not getting AI to take an action.",
        "",
        "The hard part is giving it the right memory of the work.",
        "",
        "In deal environments, that means documenting how a specific firm makes decisions before asking software to move on its behalf.",
        "",
        "Process memory first. Agents second."
      ].join("\n"),
      [
        "Generic agents are tempting because they make automation feel immediate.",
        "",
        "Deal work is less forgiving.",
        "",
        "If the system does not know how the firm decides, who owns exceptions, and what context the next person needs, speed just moves the ambiguity faster.",
        "",
        "Start with process memory."
      ].join("\n")
    ];
  }

  if (/\btemplates?|recurring deal motions?\b/.test(haystack)) {
    return [
      [
        "Templates are not valuable because they save a blank page.",
        "",
        "They are valuable because they make repeated work inspectable.",
        "",
        "If a deal motion can be inspected, it can be improved. If it can be improved, it can be assigned with more confidence.",
        "",
        "That is a better automation starting point than a generic prompt."
      ].join("\n"),
      [
        "Reusable deal motions only work if the team can see what is inside them.",
        "",
        "What gets inspected.",
        "What gets improved.",
        "Who owns the next move.",
        "",
        "That is where templates become operating leverage instead of another folder of examples."
      ].join("\n"),
      [
        "The useful part of a workflow template is not the template.",
        "",
        "It is the conversation it makes possible:",
        "",
        "Is this how we actually run the motion?",
        "What should change?",
        "Who owns the next step?",
        "",
        "That is the work to capture before automation."
      ].join("\n")
    ];
  }

  if (/\bpost-close|after close|diligence\b/.test(haystack) && /\bowner context|execution|risks?\b/.test(haystack)) {
    return [
      [
        "The close is a bad place for context to disappear.",
        "",
        "Diligence creates decisions, risks, and owner context. Post-close teams need those details in a form they can actually use.",
        "",
        "When that context falls out of the workflow, execution starts with a reconstruction project instead of action.",
        "",
        "The handoff should carry the why."
      ].join("\n"),
      [
        "Post-close execution often starts with a context gap.",
        "",
        "The deal team captured the decisions. The operating team inherits the work. Somewhere between those two moments, the why gets thinner.",
        "",
        "A better handoff should make decisions, risks, and owner context usable without another round of translation."
      ].join("\n"),
      [
        "Diligence context is only useful after close if the operating team can use it.",
        "",
        "Not as a pile of notes.",
        "",
        "As decisions, risks, and owner context attached to the work that now has to happen.",
        "",
        "That is the handoff Splay is building toward."
      ].join("\n")
    ];
  }

  if (/\banother workflow tool|another destination\b/.test(haystack)) {
    return [
      [
        "The objection is not always \"another tool.\"",
        "",
        "It is: please do not make my team update one more place.",
        "",
        "Good workflow software meets the work where it already happens. It captures the repeated motion without asking the team to babysit a new system.",
        "",
        "That is the product bar: less duplicate work, not more features."
      ].join("\n"),
      [
        "A new system loses trust when it asks teams to leave the workflow they already trust.",
        "",
        "The better answer is to capture the work already happening: the decisions, handoffs, and follow-ups the team depends on today.",
        "",
        "Do that well, and the workflow feels less like a new habit and more like the way the team already works."
      ].join("\n"),
      [
        "Most teams do not need another place to update.",
        "",
        "They need repeated work to become easier to reuse, inspect, and trust.",
        "",
        "That is the difference between software the team has to remember and software that fits the way the team already works."
      ].join("\n")
    ];
  }

  return [];
}

function xTopicCandidates(idea: TopicIdea): string[] {
  const haystack = `${idea.topic} ${idea.source_context.summary}`.toLowerCase();
  const topic = idea.topic.toLowerCase();

  if (/\bdashboards?\b/.test(haystack) && /\b(?:accountability|ownership|assign|follow-through)\b/.test(haystack)) {
    return [
      "Dashboards are useful. They are not accountability. If no one owns the next move, a cleaner view just makes the gap easier to see.",
      "A dashboard can show work exists. It cannot make work owned.",
      "Visibility should lead to action. Otherwise the dashboard is just another place to look."
    ];
  }

  if (/\boperating cadence|deal cadence|rebuilt by hand|handoff rules|status rituals\b/.test(topic)) {
    return [
      "Deal cadence should not live in spreadsheets, chats, and memory. If the handoff rules disappear, every new owner starts by rebuilding the work.",
      "The model is not always the hard part. The handoff rules, follow-ups, and status rituals around it are what keep deal work moving.",
      "If deal cadence lives in chats and memory, the next owner starts from scratch."
    ];
  }

  if (/\bagents?\b/.test(haystack) && /\bprocess memory\b/.test(haystack)) {
    return [
      "AI agents are not the starting line for deal work. Process memory is: how the firm decides, where handoffs happen, and what the next owner can trust.",
      "Process memory first. Agents second. Otherwise automation just moves ambiguity faster.",
      "Before asking AI to act, document how the firm actually makes decisions."
    ];
  }

  if (/\btemplates?|recurring deal motions?\b/.test(haystack)) {
    return [
      "Workflow templates matter when they make repeated deal work inspectable. Inspect first, improve next, automate last.",
      "A useful template is not a prettier blank page. It is a way to inspect, improve, and assign repeated work.",
      "Reusable deal motions only work when the team can see what should change and who owns the next move."
    ];
  }

  if (/\bpost-close|after close|diligence\b/.test(haystack) && /\bowner context|execution|risks?\b/.test(haystack)) {
    return [
      "The close is a bad place for context to disappear. Post-close teams still need the decisions, risks, and owner context behind the deal.",
      "Diligence context should not become a pile of notes after close. It should carry the why into the work that comes next.",
      "Post-close handoffs break when the operating team inherits tasks without the decisions and risks behind them."
    ];
  }

  if (/\banother workflow tool|another destination\b/.test(haystack)) {
    return [
      "The objection is not another tool. It is another place to update. Better software meets the workflow where it already lives.",
      "A new workflow system earns trust when it removes duplicate updates, not when it asks teams to maintain one more place.",
      "Most teams do not need another place to update. They need existing work to become easier to reuse, inspect, and trust."
    ];
  }

  return [];
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

function truncateSentence(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed.replace(/[.!?]+$/, "");
  const clipped = trimmed.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : clipped.length).trim()}...`;
}

function cleanSourcePhrase(value: string): string {
  return value
    .replace(/^(the memo argues that|operators described|prospects worry that|internal discussion noted that|the product team shipped|deal teams keep)\s+/i, "")
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

function cleanAngle(value: string): string {
  return cleanSourcePhrase(value)
    .replace(/^make the case that\s+/i, "")
    .replace(/^explain why\s+/i, "")
    .replace(/^connect\s+/i, "")
    .replace(/^answer the objection that\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function xTakeaway(idea: TopicIdea, primary: string): string {
  const haystack = `${idea.topic} ${idea.source_context.summary}`.toLowerCase();
  const topic = idea.topic.toLowerCase();
  if (/\bdashboards?\b/.test(haystack) && /\baccountability|ownership|assign\b/.test(haystack)) {
    return "Dashboards can show the work. They still do not create ownership.";
  }
  if (/\boperating cadence|deal cadence|rebuilt by hand|handoff rules|status rituals\b/.test(topic)) {
    return "If deal cadence lives in chats and memory, the next owner starts from scratch.";
  }
  if (/\bagents?\b/.test(haystack) && /\bprocess memory\b/.test(haystack)) {
    return "AI agents are not the starting line. Process memory is.";
  }
  if (/\bpost-close|after close|diligence\b/.test(haystack)) {
    return "The close is not where context should disappear. The operating team still needs the why.";
  }
  if (/\btemplates?|recurring deal motions?\b/.test(haystack)) {
    return "Templates matter when they make repeated work easier to inspect, improve, and assign.";
  }
  if (/\banother workflow tool|another destination\b/.test(haystack)) {
    return "The objection is rarely another tool. It is another place to work.";
  }
  if (/\boperating cadence|handoff rules|status rituals\b/.test(haystack)) {
    return "If deal cadence lives in chats and memory, the next owner starts from scratch.";
  }
  return `${sentenceCase(primary)}. The handoff is the real product test.`;
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
  const lower = corpus.toLowerCase();
  const audience = /\b(bank|banker|investment banking|capital markets)\b/.test(lower)
    ? "InvestmentBanking"
    : /\b(private equity|sponsor|portfolio compan)\b/.test(lower)
      ? "PrivateEquity"
      : "DealTeams";
  const workflow = /\b(call|meeting|calendar|brief|prep|agenda)\b/.test(lower)
    ? "DealWorkflow"
    : /\b(inbox|crm|tracker|follow-up|handoff|owner)\b/.test(lower)
      ? "DealOps"
      : "DealWorkflow";
  const topic = /\b(ai|artificial intelligence|agent|automation)\b/.test(lower)
    ? "ArtificialIntelligence"
    : /\b(m&a|merger|acquisition|buyer|deal)\b/.test(lower)
      ? "MergersAndAcquisitions"
      : "DealTechnology";

  return Array.from(new Set([audience, workflow, topic]));
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
