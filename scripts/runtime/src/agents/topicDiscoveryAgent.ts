import type { BrandProfile, GBrainContextItem, TopicIdea } from "../types/index.ts";
import { loadRecentPostReferences, type RecentPostReference } from "../ai/postDiversityGuard.ts";
import { buildEditorialContext, validateEditorialContext } from "../editorial/evidencePacket.ts";
import { buildPostIntent } from "../editorial/contentProgram.ts";

const DISCOVERY_QUERIES = [
  "recent company updates",
  "customer pain points",
  "sales call notes",
  "objections from prospects",
  "product launches",
  "founder notes",
  "strategy docs",
  "competitor mentions",
  "repeated themes from the past 7 to 30 days"
];

export async function discoverTopicIdeas(
  gbrain: {
    searchCompanyContext(query: string): Promise<GBrainContextItem[]>;
    getRecentUpdates(): Promise<GBrainContextItem[]>;
    getRecentCustomerInsights(): Promise<GBrainContextItem[]>;
    getRecentProductNotes(): Promise<GBrainContextItem[]>;
    getRecentSalesObjections(): Promise<GBrainContextItem[]>;
  },
  brand: BrandProfile
): Promise<{ ideas: TopicIdea[]; themes: string[] }> {
  const batches = await Promise.all([
    gbrain.getRecentUpdates(),
    gbrain.getRecentCustomerInsights(),
    gbrain.getRecentProductNotes(),
    gbrain.getRecentSalesObjections(),
    ...DISCOVERY_QUERIES.map((query) => gbrain.searchCompanyContext(query))
  ]);

  const items = uniqueById(batches.flat()).sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const themes = extractThemes(items);
  const recentPosts = await loadRecentPostReferences();
  const ideas = buildIdeas(items, themes, brand, recentPosts).slice(0, 5);

  return { ideas, themes };
}

export async function buildTopicFromManualInput(
  topic: string,
  contexts: GBrainContextItem[],
  brand: BrandProfile
): Promise<TopicIdea> {
  const supporting = contexts.slice(0, 4);
  const summary = supporting.length > 0
    ? supporting.map((item) => item.summary).join(" ")
    : `${brand.name} can speak credibly about ${topic} based on its positioning and operating point of view.`;

  return {
    id: `idea-${slugify(topic)}`,
    topic,
    angle: `A direct founder-led take on ${topic}`,
    score: 8,
    source_context: {
      summary: summarize(summary, 360),
      gbrain_references: supporting.flatMap((item) => item.references).slice(0, 8),
      why_now: supporting[0]?.date
        ? `Recent company-brain context from ${supporting[0].date} supports a timely post.`
        : "The topic was requested directly for draft generation."
    },
    editorial_context: buildEditorialContext(topic, supporting.length > 0 ? supporting : [{
      id: `manual-${slugify(topic)}`,
      title: topic,
      kind: "internal",
      summary,
      references: supporting.flatMap((item) => item.references),
      tags: []
    }]),
    post_intent: buildPostIntent(supporting[0], topic)
  };
}

function buildIdeas(
  items: GBrainContextItem[],
  themes: string[],
  brand: BrandProfile,
  recentPosts: RecentPostReference[] = []
): TopicIdea[] {
  const sourceDriven = items.map((item, index) => {
    const supporting = relatedSupportingItems(item, items);
    const references = supporting.flatMap((support) => support.references).slice(0, 8);
    const summary = supporting.map((support) => support.summary).join(" ");
    const topic = topicFromSourceItem(item);
    return {
      id: `idea-${slugify(`${item.id}-${topic}`)}`,
      topic,
      angle: angleFromSourceItem(item, brand),
      score: scoreIdea(topic, supporting, brand) + recencyScore(item, index) - recentPenalty(topic, references, recentPosts),
      source_context: {
        summary: summarize(summary || item.summary || themes.join(". "), 420),
        gbrain_references: references,
        why_now: item.date
          ? `Recent ${labelKind(item.kind)} from ${item.date} gives this post a specific source hook.`
          : `A ${labelKind(item.kind)} gives this post a specific source hook.`
      },
      editorial_context: buildEditorialContext(topic, supporting),
      post_intent: buildPostIntent(item, topic, index)
    };
  });

  return uniqueIdeas(sourceDriven)
    .filter((idea) => idea.source_context.summary.length > 0)
    .filter((idea) => !idea.editorial_context || validateEditorialContext(idea.editorial_context, idea.source_context).errors.length === 0)
    .sort((a, b) => b.score - a.score);
}

function relatedSupportingItems(seed: GBrainContextItem, items: GBrainContextItem[]): GBrainContextItem[] {
  const seedTags = new Set(seed.tags.map((tag) => tag.toLowerCase()));
  const related = items
    .filter((item) => item.id !== seed.id)
    .map((item) => {
      const tagOverlap = item.tags.filter((tag) => seedTags.has(tag.toLowerCase())).length;
      const kindOverlap = item.kind === seed.kind ? 1 : 0;
      return { item, score: tagOverlap * 2 + kindOverlap };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item)
    .slice(0, 2);
  return [seed, ...related];
}

function topicFromSourceItem(item: GBrainContextItem): string {
  const title = item.title
    .replace(/\s+/g, " ")
    .trim();
  return sentenceCase(title || firstSentence(item.summary) || item.kind.replace(/_/g, " "));
}

function angleFromSourceItem(item: GBrainContextItem, brand: BrandProfile): string {
  const summary = firstSentence(item.summary);
  const kind = labelKind(item.kind);
  if (summary) {
    return `Use the ${kind} as the proof point: ${summary}`;
  }
  return `Use a ${kind} to connect ${brand.positioning.toLowerCase()} to a concrete operating tension.`;
}

function recencyScore(item: GBrainContextItem, index: number): number {
  const dateBonus = item.date ? 1 : 0;
  return Math.max(0, 2 - index * 0.2) + dateBonus;
}

function recentPenalty(topic: string, references: string[], recentPosts: RecentPostReference[]): number {
  const normalizedTopic = normalize(topic);
  const recentTopicPenalty = recentPosts.some((post) => post.topic && topicSimilarity(normalizedTopic, normalize(post.topic)) >= 0.68) ? 3 : 0;
  const recentRefs = new Set(recentPosts.flatMap((post) => post.sourceReferences ?? []));
  const referencePenalty = references.some((reference) => recentRefs.has(reference)) ? 2 : 0;
  return recentTopicPenalty + referencePenalty;
}

function topicSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function uniqueIdeas(ideas: TopicIdea[]): TopicIdea[] {
  const seen = new Set<string>();
  return ideas.filter((idea) => {
    const key = normalize(idea.topic);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreSupportingItems(items: GBrainContextItem[], keywords: string[]): GBrainContextItem[] {
  return items
    .map((item) => {
      const haystack = `${item.kind} ${item.tags.join(" ")} ${item.title} ${item.summary}`.toLowerCase();
      const matches = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
      return { item, matches };
    })
    .filter(({ matches }) => matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .map(({ item }) => item)
    .slice(0, 4);
}

function scoreIdea(topic: string, supporting: GBrainContextItem[], brand: BrandProfile): number {
  let score = 5;
  score += Math.min(3, supporting.length);
  if (topic.toLowerCase().includes(brand.name.toLowerCase())) score += 1;
  if (brand.audience.trim()) score += 1;
  return Math.min(10, score);
}

function extractThemes(items: GBrainContextItem[]): string[] {
  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag]) => tag.replace(/_/g, " "));

  return tags;
}

function uniqueById(items: GBrainContextItem[]): GBrainContextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function summarize(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3).trim()}...`;
}

function firstSentence(value: string): string {
  return value.split(/(?<=[.!?])\s+/).map((part) => part.trim()).find(Boolean)?.replace(/[.!?]+$/, "") ?? "";
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : trimmed;
}

function labelKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function normalize(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
