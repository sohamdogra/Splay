import type { NormalizedMetrics } from "./normalizeMetrics.ts";

export type ScorePlatform = "linkedin" | "x" | "instagram" | string | null | undefined;

export type RateInputs = {
  metrics: NormalizedMetrics;
  platform?: ScorePlatform;
  formatType?: string | null;
  windowHours?: number | null;
};

export type HistoricalScoreInput = {
  platform?: string | null;
  formatType?: string | null;
  engagementRate?: number | null;
  commentRate?: number | null;
  shareRate?: number | null;
  saveRate?: number | null;
  clickRate?: number | null;
  followConversionRate?: number | null;
  finalSuccessScore?: number | null;
  windowHours?: number | null;
};

export type CalculatedPostScore = {
  denominatorSource: "impressions" | "reach" | null;
  engagementRate: number | null;
  commentRate: number | null;
  shareRate: number | null;
  saveRate: number | null;
  clickRate: number | null;
  followConversionRate: number | null;
  normalizedEngagementScore: number | null;
  normalizedCommentScore: number | null;
  normalizedShareScore: number | null;
  normalizedSaveScore: number | null;
  normalizedClickScore: number | null;
  normalizedFollowScore: number | null;
  percentileVsRecentPosts: number | null;
  percentileVsSamePlatform: number | null;
  percentileVsSameFormat: number | null;
  finalSuccessScore: number | null;
  label: "winner" | "neutral" | "loser" | "insufficient_data";
};

type ScoreMetricKey = "engagement" | "comment" | "share" | "save" | "click" | "follow";

const defaultWeights: Record<ScoreMetricKey, number> = {
  engagement: 0.30,
  comment: 0.20,
  share: 0.20,
  save: 0,
  click: 0.15,
  follow: 0.15
};

const platformWeights: Record<string, Record<ScoreMetricKey, number>> = {
  linkedin: {
    engagement: 0.25,
    comment: 0.30,
    share: 0.25,
    save: 0,
    click: 0.10,
    follow: 0.10
  },
  x: {
    engagement: 0.20,
    comment: 0.25,
    share: 0.25,
    save: 0,
    click: 0.20,
    follow: 0.10
  },
  twitter: {
    engagement: 0.20,
    comment: 0.25,
    share: 0.25,
    save: 0,
    click: 0.20,
    follow: 0.10
  },
  instagram: {
    engagement: 0.20,
    comment: 0.15,
    share: 0.25,
    save: 0.25,
    click: 0.05,
    follow: 0.10
  }
};

export function calculatePostScore(
  input: RateInputs,
  recentPosts: HistoricalScoreInput[] = []
): CalculatedPostScore {
  const comparablePosts = input.windowHours == null
    ? recentPosts
    : recentPosts.filter((post) => post.windowHours == null || post.windowHours === input.windowHours);
  const denominator = getDenominator(input.metrics);
  const counts = countEngagements(input.metrics);
  const rates = denominator.value === null
    ? nullRates(denominator.source)
    : {
        denominatorSource: denominator.source,
        engagementRate: divide(counts.engagements, denominator.value),
        commentRate: divide(input.metrics.comments, denominator.value),
        shareRate: divide((input.metrics.shares ?? 0) + (input.metrics.reposts ?? 0), denominator.value),
        saveRate: divide(input.metrics.saves, denominator.value),
        clickRate: divide(input.metrics.clicks, denominator.value),
        followConversionRate: divide(input.metrics.follows, denominator.value)
      };

  if (!hasEngagementData(input.metrics) || denominator.value === null) {
    return {
      ...rates,
      normalizedEngagementScore: null,
      normalizedCommentScore: null,
      normalizedShareScore: null,
      normalizedSaveScore: null,
      normalizedClickScore: null,
      normalizedFollowScore: null,
      percentileVsRecentPosts: null,
      percentileVsSamePlatform: null,
      percentileVsSameFormat: null,
      finalSuccessScore: null,
      label: "insufficient_data"
    };
  }

  const normalizedEngagementScore = percentileScore(rates.engagementRate, comparablePosts.map((post) => post.engagementRate));
  const normalizedCommentScore = percentileScore(rates.commentRate, comparablePosts.map((post) => post.commentRate));
  const normalizedShareScore = percentileScore(rates.shareRate, comparablePosts.map((post) => post.shareRate));
  const normalizedSaveScore = percentileScore(rates.saveRate, comparablePosts.map((post) => post.saveRate));
  const normalizedClickScore = percentileScore(rates.clickRate, comparablePosts.map((post) => post.clickRate));
  const normalizedFollowScore = percentileScore(rates.followConversionRate, comparablePosts.map((post) => post.followConversionRate));
  const weights = weightsFor(input.platform);
  const finalSuccessScore = weightedScore({
    engagement: normalizedEngagementScore,
    comment: normalizedCommentScore,
    share: normalizedShareScore,
    save: normalizedSaveScore,
    click: normalizedClickScore,
    follow: normalizedFollowScore
  }, weights);

  return {
    ...rates,
    normalizedEngagementScore,
    normalizedCommentScore,
    normalizedShareScore,
    normalizedSaveScore,
    normalizedClickScore,
    normalizedFollowScore,
    percentileVsRecentPosts: percentileScore(finalSuccessScore, comparablePosts.map((post) => post.finalSuccessScore)),
    percentileVsSamePlatform: percentileScore(finalSuccessScore, comparablePosts
      .filter((post) => sameText(post.platform, input.platform))
      .map((post) => post.finalSuccessScore)),
    percentileVsSameFormat: input.formatType
      ? percentileScore(finalSuccessScore, comparablePosts
          .filter((post) => sameText(post.formatType, input.formatType))
          .map((post) => post.finalSuccessScore))
      : null,
    finalSuccessScore,
    label: labelFor(finalSuccessScore)
  };
}

export function percentileScore(value: number | null | undefined, values: Array<number | null | undefined>): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const clean = values.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (clean.length < 3) return 50;
  const below = clean.filter((item) => item < value).length;
  const equal = clean.filter((item) => item === value).length;
  return clamp(((below + (equal * 0.5)) / clean.length) * 100, 0, 100);
}

function getDenominator(metrics: NormalizedMetrics): { source: "impressions" | "reach" | null; value: number | null } {
  if (typeof metrics.impressions === "number" && metrics.impressions > 0) {
    return { source: "impressions", value: metrics.impressions };
  }
  if (typeof metrics.reach === "number" && metrics.reach > 0) {
    return { source: "reach", value: metrics.reach };
  }
  return { source: null, value: null };
}

function countEngagements(metrics: NormalizedMetrics): { engagements: number } {
  return {
    engagements: (metrics.reactions ?? 0)
      + (metrics.comments ?? 0)
      + (metrics.shares ?? 0)
      + (metrics.reposts ?? 0)
      + (metrics.saves ?? 0)
  };
}

function nullRates(denominatorSource: "impressions" | "reach" | null) {
  return {
    denominatorSource,
    engagementRate: null,
    commentRate: null,
    shareRate: null,
    saveRate: null,
    clickRate: null,
    followConversionRate: null
  };
}

function divide(value: number | null | undefined, denominator: number): number | null {
  if (value === null || value === undefined || denominator <= 0) return null;
  return value / denominator;
}

function hasEngagementData(metrics: NormalizedMetrics): boolean {
  return [
    metrics.reactions,
    metrics.comments,
    metrics.shares,
    metrics.reposts,
    metrics.saves,
    metrics.clicks,
    metrics.follows
  ].some((value) => typeof value === "number");
}

function weightsFor(platform: ScorePlatform): Record<ScoreMetricKey, number> {
  const key = String(platform ?? "").toLowerCase();
  return platformWeights[key] ?? defaultWeights;
}

function weightedScore(scores: Record<ScoreMetricKey, number | null>, weights: Record<ScoreMetricKey, number>): number | null {
  let totalWeight = 0;
  let total = 0;
  for (const key of Object.keys(weights) as ScoreMetricKey[]) {
    const score = scores[key];
    if (score === null || !Number.isFinite(score) || weights[key] <= 0) continue;
    total += score * weights[key];
    totalWeight += weights[key];
  }
  return totalWeight > 0 ? total / totalWeight : null;
}

function labelFor(score: number | null): CalculatedPostScore["label"] {
  if (score === null) return "insufficient_data";
  if (score >= 75) return "winner";
  if (score < 35) return "loser";
  return "neutral";
}

function sameText(left: unknown, right: unknown): boolean {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
