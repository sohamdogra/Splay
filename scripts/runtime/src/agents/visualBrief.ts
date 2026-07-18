import { INTERNAL_JARGON_PHRASES } from "../editorial/editorialGate.ts";
import type { GeneratedPost, VisualBrief, VisualContentMode, VisualEvidenceItem } from "../types/index.ts";
import { generateTokenMartJson, tokenMartTextConfigured } from "../providers/tokenMartText.ts";

type Candidate = Partial<Omit<VisualBrief, "validation_status">>;

const MAX_HEADLINE = 56;
const MAX_SUPPORTING = 72;
const MAX_ITEM = 38;
const MAX_HEADLINE_WORDS = 8;
const MAX_SUPPORTING_WORDS = 12;
const MAX_ITEM_WORDS = 5;
const MAX_SOURCE_CUE = 28;
const MAX_SOURCE_CUE_WORDS = 3;

type VisualCopy = {
  headline: string;
  supporting: string;
  items: VisualEvidenceItem[];
  contrast?: VisualBrief["contrast"];
  mode?: VisualContentMode;
};

export async function buildVisualBrief(post: GeneratedPost): Promise<VisualBrief> {
  const fallback = buildExtractiveBrief(post);
  if (process.env.SOCIAL_AGENT_USE_MOCK_LLM === "1" || (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !tokenMartTextConfigured())) {
    return fallback;
  }

  const candidate = await requestVisualBrief(post);
  return candidate ? validateVisualBriefCandidate(candidate, post) ?? fallback : fallback;
}

export function buildExtractiveBrief(post: GeneratedPost): VisualBrief {
  const corpus = visualSourceCorpus(post);
  const fragments = extractFragments(post.source_context.summary);
  const copy = buildVisualCopy(post, fragments);
  const evidence = copy.items;
  const contrast = copy.mode ? copy.contrast ?? null : extractContrast(post.topic, corpus);
  const workflowLanguage = /\b(workflow|handoff|follow-up|next|process|cadence|execution|owner)\b/i.test(corpus);
  const contentMode: VisualContentMode = copy.mode
    ? copy.mode
    : contrast
    ? "contrast"
    : evidence.length >= 3 && workflowLanguage
      ? "workflow"
      : evidence.length >= 3
        ? "principles"
        : post.source_context.gbrain_references.length > 0
          ? "evidence"
          : "thesis";

  return {
    content_mode: contentMode,
    headline: copy.headline,
    supporting_text: copy.supporting,
    points: contentMode === "principles" || contentMode === "relationship" ? evidence : [],
    steps: contentMode === "workflow" ? evidence : [],
    contrast,
    source_cue: post.source_context.gbrain_references.length > 0 ? "FROM THE WORK" : "SPLAY TAKE",
    validation_status: "extractive_fallback"
  };
}

export function validateVisualBriefCandidate(candidate: Candidate, post: GeneratedPost): VisualBrief | null {
  const corpus = visualSourceCorpus(post);
  const contentMode = candidate.content_mode;
  const headline = cleanVisualLine(candidate.headline);
  const supportingText = cleanVisualLine(candidate.supporting_text);
  if (!isContentMode(contentMode) || !withinVisualLimit(headline, MAX_HEADLINE, MAX_HEADLINE_WORDS) || !withinVisualLimit(supportingText, MAX_SUPPORTING, MAX_SUPPORTING_WORDS)) return null;
  if (hasRoboticPublicCopy(`${headline} ${supportingText}`)) return null;
  if (mirrorsPostCopy(headline, post) || mirrorsPostCopy(supportingText, post)) return null;
  if ([headline, supportingText].some((value) => hasUnsupportedNumbersOrProperNouns(value, corpus))) return null;

  const points = validateItems(candidate.points, corpus);
  const steps = validateItems(candidate.steps, corpus);
  const contrast = candidate.contrast
    ? {
        left: validateItem(candidate.contrast.left, corpus),
        right: validateItem(candidate.contrast.right, corpus)
      }
    : null;
  if (candidate.points?.length && !points) return null;
  if (candidate.steps?.length && !steps) return null;
  if (contrast && (!contrast.left || !contrast.right)) return null;

  const normalizedPoints = points ?? [];
  const normalizedSteps = steps ?? [];
  if (contentMode === "contrast" && !contrast) return null;
  if (contentMode === "principles" && normalizedPoints.length !== 3) return null;
  if (contentMode === "workflow" && normalizedSteps.length !== 3) return null;
  if (contentMode === "relationship" && normalizedPoints.length < 3) return null;

  return {
    content_mode: contentMode,
    headline,
    supporting_text: supportingText,
    points: normalizedPoints,
    steps: normalizedSteps,
    contrast: contrast ? { left: contrast.left!, right: contrast.right! } : null,
    source_cue: fitSourceCue(candidate.source_cue, post),
    validation_status: "validated"
  };
}

function validateItems(items: VisualEvidenceItem[] | undefined, corpus: string): VisualEvidenceItem[] | null {
  if (!items) return [];
  if (items.length > 3) return null;
  const validated = items.map((item) => validateItem(item, corpus));
  return validated.every(Boolean) ? validated as VisualEvidenceItem[] : null;
}

function validateItem(item: VisualEvidenceItem | undefined, corpus: string): VisualEvidenceItem | null {
  const text = cleanVisualLine(item?.text);
  const sourceExcerpt = clean(item?.source_excerpt);
  if (!withinVisualLimit(text, MAX_ITEM, MAX_ITEM_WORDS) || !sourceExcerpt) return null;
  if (hasRoboticPublicCopy(text)) return null;
  if (!normalize(corpus).includes(normalize(sourceExcerpt))) return null;
  if (hasUnsupportedNumbersOrProperNouns(text, corpus)) return null;
  if (meaningfulOverlap(text, sourceExcerpt) < 0.25) return null;
  return { text, source_excerpt: sourceExcerpt };
}

async function requestVisualBrief(post: GeneratedPost): Promise<Candidate | null> {
  const prompt = [
    "Create a structured visual brief for one institutional social graphic.",
    `Topic: ${post.topic}`,
    `Post opening to avoid repeating: ${firstPostLine(post.post_text)}`,
    `Source context: ${post.source_context.summary}`,
    "Use only claims supported by the topic or source context.",
    "Image-copy budget: headline 3-8 words, supporting_text 5-12 words, each point/step/contrast side <= 5 words, source_cue <= 3 words.",
    "Write visible image text like a startup social post: clear, human, concrete, and useful at a glance.",
    "The image should read as one tight visual argument: one concise claim, one proof/why-it-matters line, and short distinct detail tags.",
    `Never use internal labels or stiff phrases as visible copy: ${INTERNAL_JARGON_PHRASES.join(", ")}.`,
    "Do not fill text boxes with sentence fragments from unrelated parts of the source. Do not use ellipses.",
    "The visual headline and supporting_text must add a complementary thought; do not repeat the topic, post opening, or first source sentence verbatim.",
    "Every point, step, and contrast side must include source_excerpt copied exactly from the topic or source context.",
    "Return strict JSON with content_mode, headline, supporting_text, points, steps, contrast, and source_cue.",
    "content_mode must be thesis, contrast, evidence, principles, workflow, or relationship.",
    "Use exactly three items for principles, workflow, or relationship. Use empty arrays for unused fields.",
    "Do not add names, numbers, metrics, customer details, or product capabilities."
  ].join("\n");

  if (process.env.OPENAI_API_KEY) return callOpenAI(prompt);
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(prompt);
  if (tokenMartTextConfigured()) {
    const raw = await generateTokenMartJson(prompt, { maxTokens: 700 });
    return raw ? parseCandidate(raw) : null;
  }
  return null;
}

async function callOpenAI(prompt: string): Promise<Candidate | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini",
        input: prompt,
        text: { format: { type: "json_object" } }
      })
    });
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const raw = typeof body.output_text === "string"
      ? body.output_text
      : (Array.isArray(body.output) ? body.output : []).flatMap((item) => {
          const content = (item as Record<string, unknown>).content;
          return Array.isArray(content) ? content : [];
        }).map((part) => String((part as Record<string, unknown>).text ?? "")).join("");
    return parseCandidate(raw);
  } catch {
    return null;
  }
}

async function callAnthropic(prompt: string): Promise<Candidate | null> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": String(process.env.ANTHROPIC_API_KEY),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_TEXT_MODEL ?? "claude-3-5-sonnet-latest",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    const raw = (Array.isArray(body.content) ? body.content : [])
      .map((part) => String((part as Record<string, unknown>).text ?? ""))
      .join("");
    return parseCandidate(raw);
  } catch {
    return null;
  }
}

function parseCandidate(raw: string): Candidate | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) as Candidate : null;
  } catch {
    return null;
  }
}

function extractFragments(summary: string): string[] {
  const sentences = summary.split(/(?<=[.!?])\s+/).map((value) => value.replace(/[.!?]+$/, "").trim()).filter(Boolean);
  const clauses = sentences.flatMap((sentence) => sentence.split(/[,;:]\s+|\s+\b(?:but|while)\b\s+/i))
    .map((value) => value.trim())
    .filter((value) => value.length >= 18);
  return unique([...sentences, ...clauses]).slice(0, 6);
}

function buildVisualCopy(post: GeneratedPost, fragments: string[]): VisualCopy {
  const sourceFragments = fragments.length > 0 ? fragments : [post.topic];
  const headline = firstDistinctVisualLine([
    contrastHeadline(post.topic),
    sourceFragments[1],
    sourceFragments[2],
    sourceFragments[0],
    "Source context first"
  ], post, [], MAX_HEADLINE, MAX_HEADLINE_WORDS) ?? "Source context first";
  const supporting = firstDistinctVisualLine([
    ...sourceFragments,
    supportFromHeadline(headline),
    "Context before automation"
  ], post, [headline], MAX_SUPPORTING, MAX_SUPPORTING_WORDS) ?? "Context before automation";
  const items = buildEvidenceItems(sourceFragments, [headline, supporting]);

  return { headline, supporting, items };
}

function firstDistinctVisualLine(
  values: Array<string | null | undefined>,
  post: GeneratedPost,
  existing: string[],
  maxChars: number,
  maxWords: number
): string | null {
  for (const value of values) {
    for (const line of visualTextCandidates(value, maxChars, maxWords)) {
      if (!line || mirrorsPostCopy(line, post)) continue;
      if (existing.some((item) => !isDistinctVisualLine(line, item))) continue;
      return line;
    }
  }
  return null;
}

function buildEvidenceItems(fragments: string[], existing: string[]): VisualEvidenceItem[] {
  const items: VisualEvidenceItem[] = [];
  for (const fragment of fragments) {
    const text = visualTextCandidates(fragment, MAX_ITEM, MAX_ITEM_WORDS)
      .find((candidate) => existing.every((item) => isDistinctVisualLine(candidate, item)) && items.every((item) => isDistinctVisualLine(candidate, item.text)));
    if (!text) continue;
    items.push({ text, source_excerpt: fragment });
    if (items.length === 3) break;
  }

  const fallbackExcerpt = fragments[0] ?? "Source context";
  const fallbackTexts = ["Show the decision trail", "Keep open risks visible", "Name the next owner", "Keep the why close"];
  for (const fallback of fallbackTexts) {
    if (items.length === 3) break;
    if (existing.some((item) => !isDistinctVisualLine(fallback, item)) || items.some((item) => !isDistinctVisualLine(fallback, item.text))) continue;
    items.push({ text: fallback, source_excerpt: fallbackExcerpt });
  }

  return items;
}

function isDistinctVisualLine(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return true;
  if (normalizedLeft === normalizedRight) return false;
  return meaningfulOverlap(left, right) < 0.72 && meaningfulOverlap(right, left) < 0.72;
}

function contrastHeadline(topic: string): string | null {
  if (!/\b(?:do(?:es)? not|without|instead of|vs\.?|versus|beat|beats)\b/i.test(topic)) return null;
  return topic;
}

function supportFromHeadline(headline: string): string {
  if (/\bcontext\b/i.test(headline)) return "Keep the reason with the work";
  if (/\bmemory\b/i.test(headline)) return "Do not make teams rebuild the story";
  if (/\bownership\b/i.test(headline)) return "Visibility still needs a next move";
  if (/\bdashboard/i.test(headline)) return "The next move still needs an owner";
  if (/\btemplate/i.test(headline)) return "Make the repeat work easier to improve";
  return "Keep the why close to the work";
}

function fitSourceCue(value: unknown, post: GeneratedPost): string {
  const fallback = post.source_context.gbrain_references.length > 0 ? "FROM THE WORK" : "SPLAY TAKE";
  const cleaned = cleanVisualLine(value);
  if (!cleaned || hasRoboticPublicCopy(cleaned)) return fallback;
  return fitVisualText(cleaned, MAX_SOURCE_CUE, MAX_SOURCE_CUE_WORDS) || fallback;
}

function fitVisualText(value: unknown, maxChars: number, maxWords: number): string {
  return visualTextCandidates(value, maxChars, maxWords)[0] ?? "";
}

function visualTextCandidates(value: unknown, maxChars: number, maxWords: number): string[] {
  const cleaned = cleanVisualLine(value);
  if (!cleaned) return [];

  const rawCandidates = [
    phraseFromKnownShape(cleaned),
    withinVisualLimit(cleaned, maxChars, maxWords) ? cleaned : "",
    keywordPhrase(cleaned, maxWords, maxChars)
  ].filter((candidate): candidate is string => Boolean(candidate));

  return unique(rawCandidates.map((candidate) => {
    const phrase = withinVisualLimit(candidate, maxChars, maxWords)
      ? candidate
      : keywordPhrase(candidate, maxWords, maxChars);
    return sentenceCase(truncateWords(cleanVisualLine(phrase || candidate), maxWords, maxChars));
  }).filter(Boolean));
}

function phraseFromKnownShape(value: string): string | null {
  const instead = value.match(/(.+?)\s+instead of\s+(.+)/i);
  if (instead) return `${keyPhrase(instead[2], 3)} before ${keyPhrase(instead[1], 3)}`;

  const without = value.match(/(.+?)\s+without\s+(.+)/i);
  if (without) return `${keyPhrase(without[1], 3)} needs ${keyPhrase(without[2], 2)}`;

  const notPattern = value.match(/(.+?)\s+do(?:es)? not\s+(.+)/i);
  if (notPattern) {
    const left = stripDanglingPronouns(notPattern[1]);
    const right = replaceContrastPronouns(notPattern[2], left);
    return `${keyPhrase(left, 2)}, not ${keyPhrase(right, 2)}`;
  }

  const visible = value.match(/(?:make|makes|keep|keeps)\s+(.+?)\s+(visible|clear)/i);
  if (visible) return `${keyPhrase(visible[1], 3)} ${visible[2].toLowerCase()}`;

  const captured = value.match(/(?:capture|captures|captured)\s+(.+?)(?:\s+during|\s+into|\s+for|$)/i);
  if (captured) return `${keyPhrase(captured[1], 3)} captured`;

  const survives = value.match(/(.+?)\s+survive[s]?\s+(.+)/i);
  if (survives) {
    const subject = keyPhrase(survives[1], 3);
    return `${subject} ${/\bs$/i.test(subject) ? "survive" : "survives"}`;
  }

  return null;
}

function keywordPhrase(value: string, maxWords: number, maxChars: number): string {
  const key = keyPhrase(value, maxWords);
  if (withinVisualLimit(key, maxChars, maxWords)) return key;
  return truncateWords(key, maxWords, maxChars);
}

function keyPhrase(value: string, maxWords: number): string {
  const cleaned = simplifyVisualPhrase(value);
  const lower = cleaned.toLowerCase();
  const preferred = preferredTerms.find((term) => lower.includes(term));
  if (preferred) {
    if (/\bvisible\b/i.test(cleaned) && !/\bvisible\b/i.test(preferred)) return `${preferred} visible`;
    if (/\bclear\b/i.test(cleaned) && !/\bclear\b/i.test(preferred)) return `${preferred} clear`;
    if (/\bassign|assigned|ownership\b/i.test(cleaned) && /\bwork|follow-through\b/i.test(preferred)) return `${preferred} assigned`;
    if (/\bcaptur/i.test(cleaned) && !/\bcaptured\b/i.test(preferred)) return `${preferred} captured`;
    if (/\bsurvive|handoff\b/i.test(cleaned) && !/\bsurvive|handoff\b/i.test(preferred)) return `${preferred} survives`;
    if (/\brebuild/i.test(cleaned) && !/\brebuilt\b/i.test(preferred)) return `${preferred} rebuilt`;
    return preferred;
  }

  const words = normalize(cleaned)
    .split(" ")
    .filter((word) => word.length > 2 && !visualStopWords.has(word));
  return words.slice(0, maxWords).join(" ") || cleaned;
}

function truncateWords(value: string, maxWords: number, maxChars: number): string {
  const words = cleanVisualLine(value).split(/\s+/).filter(Boolean);
  const selected: string[] = [];
  for (const word of words) {
    const next = [...selected, word].join(" ");
    if (selected.length >= maxWords || next.length > maxChars) break;
    selected.push(word);
  }
  return cleanVisualLine(selected.join(" ") || words.slice(0, maxWords).join(" "));
}

function cleanVisualLine(value: unknown): string {
  return clean(value)
    .replace(/[.!?\u2026]+$/g, "")
    .replace(/\s*[,;:]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function withinVisualLimit(value: string, maxChars: number, maxWords: number): boolean {
  const cleaned = cleanVisualLine(value);
  return Boolean(cleaned) && cleaned.length <= maxChars && wordCount(cleaned) <= maxWords;
}

function wordCount(value: string): number {
  return cleanVisualLine(value).split(/\s+/).filter(Boolean).length;
}

function simplifyVisualPhrase(value: string): string {
  return cleanVisualLine(value)
    .replace(/^(the source says that|company notes show that|the update says that|the team reported that)\s+/i, "")
    .replace(/\bby themselves\b/gi, "")
    .replace(/\bitself\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDanglingPronouns(value: string): string {
  return cleanVisualLine(value).replace(/[,;:]?\s*(they|it|this|that)$/i, "");
}

function replaceContrastPronouns(value: string, left: string): string {
  const referent = /\bwork\b/i.test(left) ? "work"
    : /\bcontext\b/i.test(left) ? "context"
      : /\bworkflow\b/i.test(left) ? "workflow"
        : "it";
  return cleanVisualLine(value).replace(/\bit\b/gi, referent);
}

function extractContrast(topic: string, corpus: string): VisualBrief["contrast"] {
  if (/\bdashboards?\b/i.test(topic) && /\bassign|ownership|accountability|follow-through\b/i.test(corpus)) {
    return {
      left: { text: "Shows the work", source_excerpt: topic },
      right: { text: "Assigns the owner", source_excerpt: topic }
    };
  }

  const patterns = [
    /^(.*?)\s+do(?:es)? not\s+(.*)$/i,
    /^(.*?)\s+without\s+(.*)$/i,
    /^(.*?)\s+instead of\s+(.*)$/i,
    /^(.*?)\s+(?:vs\.?|versus)\s+(.*)$/i
  ];
  for (const pattern of patterns) {
    const match = topic.match(pattern);
    if (!match) continue;
    const left = stripDanglingPronouns(match[1]);
    const right = replaceContrastPronouns(match[2], left);
    return {
      left: { text: fitVisualText(left, MAX_ITEM, MAX_ITEM_WORDS), source_excerpt: topic },
      right: { text: fitVisualText(right, MAX_ITEM, MAX_ITEM_WORDS), source_excerpt: topic }
    };
  }
  return /\bnot\b/i.test(corpus) ? null : null;
}

function visualSourceCorpus(post: GeneratedPost): string {
  return `${post.topic}. ${post.source_context.summary}`.trim();
}

function mirrorsPostCopy(value: string, post: GeneratedPost): boolean {
  const normalized = normalize(value);
  const topic = normalize(post.topic);
  const opening = normalize(firstPostLine(post.post_text));
  if (!normalized) return true;
  if (normalized === topic || Boolean(opening && normalized === opening)) return true;
  return meaningfulOverlap(value, post.topic) >= 0.82
    || Boolean(opening && meaningfulOverlap(value, firstPostLine(post.post_text)) >= 0.82);
}

function firstPostLine(text: string): string {
  return text.split(/\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function hasUnsupportedNumbersOrProperNouns(value: string, corpus: string): boolean {
  const sourceNumbers = new Set(corpus.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []);
  if ((value.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).some((item) => !sourceNumbers.has(item))) return true;
  const sourceWords = new Set(corpus.match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) ?? []);
  return [...value.matchAll(/\b[A-Z][A-Za-z0-9-]{2,}\b/g)]
    .some((match) => {
      const item = match[0];
      if (sourceWords.has(item) || allowedCapitalized.has(item)) return false;
      if (isSentenceInitialCapital(value, match.index ?? 0) && !/^[A-Z0-9-]+$/.test(item)) return false;
      return true;
    });
}

function hasRoboticPublicCopy(value: string): boolean {
  const lower = value.toLowerCase();
  return roboticPublicPhrases.some((phrase) => lower.includes(phrase));
}

function isSentenceInitialCapital(value: string, index: number): boolean {
  const before = value.slice(0, index).trim();
  return before === "" || /[.!?]$/.test(before);
}

function meaningfulOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  return [...leftTokens].filter((token) => rightTokens.has(token)).length / leftTokens.size;
}

function tokens(value: string): string[] {
  return normalize(value).split(" ").filter((token) => token.length > 2 && !stopWords.has(token));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sentenceCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))]
    .map((lower) => values.find((value) => value.toLowerCase() === lower)!)
    .filter(Boolean);
}

function isContentMode(value: unknown): value is VisualContentMode {
  return ["thesis", "contrast", "evidence", "principles", "workflow", "relationship"].includes(String(value));
}

const preferredTerms = [
  "customer outcome",
  "product update",
  "company lesson",
  "market signal",
  "public source",
  "customer feedback",
  "next step"
];
const allowedCapitalized = new Set(["Splay", "AI", "CRM", "POV", "From", "Work", "Take", "Deal", "Context"]);
const roboticPublicPhrases = INTERNAL_JARGON_PHRASES;
const stopWords = new Set(["the", "and", "for", "that", "with", "from", "into", "this", "are", "not", "but"]);
const visualStopWords = new Set([
  ...stopWords,
  "about",
  "actually",
  "another",
  "around",
  "because",
  "before",
  "begins",
  "between",
  "broad",
  "clear",
  "described",
  "during",
  "easier",
  "every",
  "fails",
  "first",
  "generic",
  "itself",
  "keep",
  "make",
  "makes",
  "more",
  "same",
  "should",
  "specific",
  "team",
  "teams",
  "they",
  "through",
  "visible",
  "when",
  "while"
]);
