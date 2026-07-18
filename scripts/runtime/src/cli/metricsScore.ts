import { loadEnv } from "../config/loadEnv.ts";
import { disconnectPrisma } from "../db/prisma.ts";
import { scoreLatestMetricSnapshots } from "../jobs/collectBufferMetrics.ts";

loadEnv();

try {
  const result = await scoreLatestMetricSnapshots();
  console.log(`Scored ${result.scored} post(s). Skipped ${result.skipped} without snapshots.`);
} finally {
  await disconnectPrisma();
}
