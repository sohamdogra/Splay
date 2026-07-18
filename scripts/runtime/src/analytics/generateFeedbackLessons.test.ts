import assert from "node:assert/strict";
import test from "node:test";
import { generateFeedbackLessonsFromPosts } from "./generateFeedbackLessons.ts";

test("generates high-confidence winner and loser lessons by group", () => {
  const windowStart = new Date("2026-06-01T00:00:00.000Z");
  const windowEnd = new Date("2026-06-30T00:00:00.000Z");
  const lessons = generateFeedbackLessonsFromPosts([
    ...posts("winner", "linkedin", "pain_point", [90, 89, 88, 87, 86, 85, 84, 83]),
    ...posts("loser", "linkedin", "generic_ai", [20, 21, 22, 23, 24, 25, 26, 27]),
    ...posts("baseline", "linkedin", "operator_story", [49, 50, 51, 52, 53, 54, 55, 56])
  ], { windowStart, windowEnd });

  assert.ok(lessons.some((lesson) => lesson.lessonType === "winner" && lesson.summary.includes("Pain Point")));
  assert.ok(lessons.some((lesson) => lesson.lessonType === "loser" && lesson.summary.includes("Generic Ai")));
  assert.ok(lessons.every((lesson) => lesson.evidence.sampleSize >= 8));
  assert.ok(lessons.every((lesson) => lesson.evidence.confidence === "high"));
});

test("omits low-confidence groups unless requested", () => {
  const windowStart = new Date("2026-06-01T00:00:00.000Z");
  const windowEnd = new Date("2026-06-30T00:00:00.000Z");
  const input = [
    ...posts("winner", "linkedin", "pain_point", [90, 88]),
    ...posts("baseline", "linkedin", "operator_story", [50, 52, 54])
  ];

  assert.equal(generateFeedbackLessonsFromPosts(input, { windowStart, windowEnd }).length, 0);
  assert.ok(generateFeedbackLessonsFromPosts(input, { windowStart, windowEnd, includeLowConfidence: true })
    .some((lesson) => lesson.evidence.confidence === "low"));
});

function posts(prefix: string, platform: string, hookType: string, scores: number[]) {
  return scores.map((score, index) => ({
    id: `${prefix}-${index}`,
    platform,
    topic: "deal workflow",
    hookType,
    formatType: "standard_post",
    ctaType: "question",
    hasMedia: index % 2 === 0,
    finalSuccessScore: score
  }));
}
