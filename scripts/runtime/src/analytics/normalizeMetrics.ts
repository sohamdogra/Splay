export type BufferMetric = {
  type?: string | null;
  name?: string | null;
  value?: number | string | null;
  unit?: string | null;
};

export type NormalizedMetrics = {
  impressions: number | null;
  reach: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
  clicks: number | null;
  views: number | null;
  follows: number | null;
};

export const METRIC_KEYS = [
  "impressions",
  "reach",
  "reactions",
  "comments",
  "shares",
  "reposts",
  "saves",
  "clicks",
  "views",
  "follows"
] as const;

const emptyMetrics: NormalizedMetrics = {
  impressions: null,
  reach: null,
  reactions: null,
  comments: null,
  shares: null,
  reposts: null,
  saves: null,
  clicks: null,
  views: null,
  follows: null
};

const aliases: Record<string, keyof NormalizedMetrics> = {
  impression: "impressions",
  impressions: "impressions",
  reach: "reach",
  reaction: "reactions",
  reactions: "reactions",
  like: "reactions",
  likes: "reactions",
  favorite: "reactions",
  favorites: "reactions",
  comment: "comments",
  comments: "comments",
  reply: "comments",
  replies: "comments",
  share: "shares",
  shares: "shares",
  repost: "reposts",
  reposts: "reposts",
  retweet: "reposts",
  retweets: "reposts",
  save: "saves",
  saves: "saves",
  click: "clicks",
  clicks: "clicks",
  link_click: "clicks",
  link_clicks: "clicks",
  view: "views",
  views: "views",
  video_view: "views",
  video_views: "views",
  follow: "follows",
  follows: "follows",
  follower: "follows",
  followers: "follows"
};

export function normalizeMetrics(metrics: BufferMetric[] | null | undefined): NormalizedMetrics {
  const normalized = { ...emptyMetrics };
  if (!Array.isArray(metrics)) return normalized;

  for (const metric of metrics) {
    const key = metricKey(metric);
    if (!key) continue;
    const value = numericValue(metric.value);
    if (value === null) continue;
    normalized[key] = (normalized[key] ?? 0) + value;
  }

  return normalized;
}

function metricKey(metric: BufferMetric): keyof NormalizedMetrics | null {
  const candidates = [metric.type, metric.name]
    .map((value) => normalizeMetricName(value))
    .filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && aliases[candidate]) return aliases[candidate];
  }
  return null;
}

function normalizeMetricName(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

function numericValue(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
