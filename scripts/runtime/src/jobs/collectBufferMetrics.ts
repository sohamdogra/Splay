import { calculatePostScore, type HistoricalScoreInput } from "../analytics/calculatePostScore.ts";
import { normalizeMetrics } from "../analytics/normalizeMetrics.ts";
import { getPrisma } from "../db/prisma.ts";
import { BufferClient, type BufferPostWithMetrics } from "../integrations/buffer/bufferClient.ts";
import { EDITORIAL_SPEC } from "../editorial/editorialSpec.ts";

type CollectOptions = {
  checkpointOnly?: boolean;
};

const collectableStatuses = ["sent", "published", "scheduled", "posted", "staged"];
const checkpoints = EDITORIAL_SPEC.review.metric_windows_hours;

export async function collectBufferMetrics(options: CollectOptions = {}): Promise<{ collected: number; failed: number }> {
  const prisma = await getPrisma();
  const socialPost = prisma.socialPost as any;
  const posts = await socialPost.findMany({
    where: {
      bufferPostId: { not: null },
      status: { in: collectableStatuses }
    },
    include: {
      metricSnapshots: {
        select: { windowHours: true },
        orderBy: { collectedAt: "desc" }
      }
    }
  });
  const client = new BufferClient();
  let collected = 0;
  let failed = 0;

  for (const post of posts) {
    if (options.checkpointOnly && !isCheckpointEligible(post)) continue;
    try {
      await collectForPost(client, post);
      collected += 1;
    } catch (error) {
      failed += 1;
      console.error(`Metric collection failed for ${post.id} (${post.bufferPostId}): ${error instanceof Error ? error.message : error}`);
    }
  }

  return { collected, failed };
}

async function collectForPost(client: BufferClient, post: any): Promise<void> {
  const prisma = await getPrisma();
  const metricSnapshot = prisma.metricSnapshot as any;
  const metricsPost = await client.getPostMetrics(post.bufferPostId);
  const normalized = normalizeMetrics(metricsPost.metrics);
  const collectedAt = new Date();
  const snapshot = await metricSnapshot.create({
    data: {
      socialPostId: post.id,
      bufferPostId: metricsPost.id,
      collectedAt,
      metricsUpdatedAt: parseDate(metricsPost.metricsUpdatedAt),
      windowHours: windowHoursFor(post, collectedAt),
      rawMetrics: buildRawMetrics(metricsPost),
      ...normalized
    }
  });
  await scoreSnapshot(post, snapshot);
}

export async function scoreLatestMetricSnapshots(): Promise<{ scored: number; skipped: number }> {
  const prisma = await getPrisma();
  const socialPost = prisma.socialPost as any;
  const posts = await socialPost.findMany({
    where: { bufferPostId: { not: null } },
    include: {
      metricSnapshots: {
        orderBy: { collectedAt: "desc" },
        take: 1
      }
    }
  });
  let scored = 0;
  let skipped = 0;

  for (const post of posts) {
    const snapshot = post.metricSnapshots[0];
    if (!snapshot) {
      skipped += 1;
      continue;
    }
    await scoreSnapshot(post, snapshot);
    scored += 1;
  }

  return { scored, skipped };
}

async function scoreSnapshot(post: any, snapshot: any): Promise<void> {
  const prisma = await getPrisma();
  const postScore = prisma.postScore as any;
  const history = await loadRecentScoreHistory(post);
  const score = calculatePostScore({
    metrics: {
      impressions: snapshot.impressions,
      reach: snapshot.reach,
      reactions: snapshot.reactions,
      comments: snapshot.comments,
      shares: snapshot.shares,
      reposts: snapshot.reposts,
      saves: snapshot.saves,
      clicks: snapshot.clicks,
      views: snapshot.views,
      follows: snapshot.follows
    },
    platform: post.platform,
    formatType: post.formatType,
    windowHours: snapshot.windowHours
  }, history);

  await postScore.create({
    data: {
      socialPostId: post.id,
      metricSnapshotId: snapshot.id,
      ...score
    }
  });
}

async function loadRecentScoreHistory(post: any): Promise<HistoricalScoreInput[]> {
  const prisma = await getPrisma();
  const postScore = prisma.postScore as any;
  const metricSnapshot = prisma.metricSnapshot as any;
  const rows = await postScore.findMany({
    where: {
      socialPostId: { not: post.id },
      finalSuccessScore: { not: null },
      socialPost: post.platform ? { platform: post.platform } : undefined
    },
    orderBy: { calculatedAt: "desc" },
    take: 50,
    include: { socialPost: true }
  });
  const snapshotIds = rows.map((row: any) => row.metricSnapshotId).filter(Boolean);
  const snapshots = snapshotIds.length > 0
    ? await metricSnapshot.findMany({ where: { id: { in: snapshotIds } }, select: { id: true, windowHours: true } })
    : [];
  const windows = new Map(snapshots.map((snapshot: any) => [snapshot.id, snapshot.windowHours]));
  return rows.map((row: any) => ({
    platform: row.socialPost?.platform,
    formatType: row.socialPost?.formatType,
    engagementRate: row.engagementRate,
    commentRate: row.commentRate,
    shareRate: row.shareRate,
    saveRate: row.saveRate,
    clickRate: row.clickRate,
    followConversionRate: row.followConversionRate,
    finalSuccessScore: row.finalSuccessScore,
    windowHours: windows.get(row.metricSnapshotId) ?? null
  }));
}

function isCheckpointEligible(post: any): boolean {
  const base = post.sentAt ?? post.scheduledAt;
  if (!(base instanceof Date)) return false;
  const ageHours = (Date.now() - base.getTime()) / 36e5;
  const collectedWindows = new Set((post.metricSnapshots ?? []).map((snapshot: any) => snapshot.windowHours).filter(Boolean));
  return checkpoints.some((checkpoint) => ageHours >= checkpoint && !collectedWindows.has(checkpoint));
}

function windowHoursFor(post: any, collectedAt: Date): number | null {
  const base = post.sentAt ?? post.scheduledAt;
  if (!(base instanceof Date)) return null;
  const elapsed = (collectedAt.getTime() - base.getTime()) / 36e5;
  const dueCheckpoint = checkpoints.findLast((checkpoint) => elapsed >= checkpoint);
  return dueCheckpoint ?? Math.max(0, Math.round(elapsed));
}

function buildRawMetrics(post: BufferPostWithMetrics): Record<string, unknown> {
  return {
    bufferPostId: post.id,
    text: post.text,
    channelId: post.channelId,
    dueAt: post.dueAt,
    metricsUpdatedAt: post.metricsUpdatedAt,
    metrics: post.metrics
  };
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
