import { loadEnv } from "../config/loadEnv.ts";
import { collectBufferMetrics } from "../jobs/collectBufferMetrics.ts";
import { disconnectPrisma } from "../db/prisma.ts";

loadEnv();

try {
  const checkpointOnly = process.argv.includes("--checkpoints");
  const result = await collectBufferMetrics({ checkpointOnly });
  console.log(`Collected Buffer metrics for ${result.collected} post(s). Failures: ${result.failed}.`);
} finally {
  await disconnectPrisma();
}
