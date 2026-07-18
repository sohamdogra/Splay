import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMetrics } from "./normalizeMetrics.ts";

test("normalizes Buffer metrics into stable internal keys", () => {
  const metrics = normalizeMetrics([
    { type: "impressions", name: "Impressions", value: 1000, unit: "count" },
    { type: "reactions", name: "Reactions", value: 12, unit: "count" },
    { type: "replies", name: "Replies", value: "3", unit: "count" },
    { type: "retweets", name: "Reposts", value: 2, unit: "count" },
    { type: "link_clicks", name: "Link clicks", value: "7", unit: "count" },
    { type: "network_specific_metric", name: "Watch time", value: 44, unit: "seconds" }
  ]);

  assert.deepEqual(metrics, {
    impressions: 1000,
    reach: null,
    reactions: 12,
    comments: 3,
    shares: null,
    reposts: 2,
    saves: null,
    clicks: 7,
    views: null,
    follows: null
  });
});

test("missing metrics remain unknown rather than zero", () => {
  assert.deepEqual(normalizeMetrics(null), {
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
  });
});
