import { getPrisma, isDatabaseConfigured } from "../db/prisma.ts";

type ContextOptions = {
  days?: number;
  maxTokens?: number;
  includeLowConfidence?: boolean;
};

export async function buildSocialFeedbackContext(options: ContextOptions = {}): Promise<string> {
  if (!isDatabaseConfigured()) return "";
  const prisma = await getPrisma();
  const feedbackLesson = prisma.feedbackLesson as any;
  const days = options.days ?? 30;
  const maxTokens = options.maxTokens ?? 1500;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const lessons = await feedbackLesson.findMany({
    where: {
      createdAt: { gte: since },
      ...(options.includeLowConfidence ? {} : { evidence: { path: ["confidence"], equals: "high" } })
    },
    orderBy: { createdAt: "desc" },
    take: 40
  });
  if (lessons.length === 0) return "";

  const byPlatform = groupBy(lessons, (lesson: any) => lesson.platform ?? "General");
  const lines = [`SOCIAL FEEDBACK MEMORY - LAST ${days} DAYS`, ""];
  for (const [platform, platformLessons] of byPlatform) {
    lines.push(`${displayPlatform(platform)}:`);
    appendLessonSection(lines, "Winners", platformLessons.filter((lesson: any) => lesson.lessonType === "winner"));
    appendLessonSection(lines, "Losers", platformLessons.filter((lesson: any) => lesson.lessonType === "loser"));
    lines.push("Recommended next experiments:");
    lines.push(...recommendedExperiments(platformLessons).map((item) => `- ${item}`));
    lines.push("");
  }

  return trimToTokenBudget(lines.join("\n").trim(), maxTokens);
}

function appendLessonSection(lines: string[], title: string, lessons: any[]): void {
  if (lessons.length === 0) return;
  lines.push(`${title}:`);
  for (const lesson of lessons.slice(0, 5)) {
    lines.push(`- ${lesson.summary}`);
  }
}

function recommendedExperiments(lessons: any[]): string[] {
  const winners = lessons.filter((lesson) => lesson.lessonType === "winner").slice(0, 2);
  if (winners.length === 0) return ["Run one controlled test that changes only the hook, product role, or visual treatment while holding the evidence packet constant."];
  return winners.map((lesson) => `Hypothesis to test, not a rule: hold the evidence packet constant and create one controlled variant using ${String(lesson.summary).replace(/\.$/, "").toLowerCase()}.`);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function displayPlatform(platform: string): string {
  if (platform.toLowerCase() === "x") return "X/Twitter";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  const words = text.split(/\s+/);
  const approximateTokens = Math.ceil(words.length * 1.3);
  if (approximateTokens <= maxTokens) return text;
  const maxWords = Math.max(1, Math.floor(maxTokens / 1.3));
  return words.slice(0, maxWords).join(" ");
}
