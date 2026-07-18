import { loadEnv } from "../config/loadEnv.ts";
import { getPrisma } from "../db/prisma.ts";

loadEnv();

if (!process.argv.includes("--confirm")) {
  console.error("Refusing to clear data without --confirm.");
  console.error("Usage: npm run db:clear-feedback -- --confirm");
  process.exit(1);
}

const prisma = await getPrisma() as any;

try {
  const [postScores, metricSnapshots, feedbackLessons, socialPosts] = await prisma.$transaction([
    prisma.postScore.deleteMany(),
    prisma.metricSnapshot.deleteMany(),
    prisma.feedbackLesson.deleteMany(),
    prisma.socialPost.deleteMany()
  ]);

  console.log("Cleared feedback-loop tables:");
  console.log(`- PostScore: ${postScores.count}`);
  console.log(`- MetricSnapshot: ${metricSnapshots.count}`);
  console.log(`- FeedbackLesson: ${feedbackLessons.count}`);
  console.log(`- SocialPost: ${socialPosts.count}`);
} finally {
  await prisma.$disconnect();
}
