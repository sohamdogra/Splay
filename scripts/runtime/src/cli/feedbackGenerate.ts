import { generateAndStoreFeedbackLessons } from "../analytics/generateFeedbackLessons.ts";
import { loadEnv } from "../config/loadEnv.ts";
import { disconnectPrisma } from "../db/prisma.ts";

loadEnv();

try {
  const days = Number(readArg("--days") ?? "30");
  const includeLowConfidence = process.argv.includes("--include-low-confidence");
  const result = await generateAndStoreFeedbackLessons({ days, includeLowConfidence });
  console.log(`Created ${result.created} feedback lesson(s) for the last ${days} day(s).`);
} finally {
  await disconnectPrisma();
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
