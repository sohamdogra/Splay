import assert from "node:assert/strict";
import test from "node:test";
import { calculatePostScore, percentileScore } from "./calculatePostScore.ts";

test("calculates derived rates from impressions", () => {
  const score = calculatePostScore({
    platform: "linkedin",
    metrics: {
      impressions: 100,
      reach: 200,
      reactions: 10,
      comments: 5,
      shares: 2,
      reposts: 1,
      saves: 4,
      clicks: 8,
      views: null,
      follows: 2
    }
  }, history());

  assert.equal(score.denominatorSource, "impressions");
  assert.equal(score.engagementRate, 0.22);
  assert.equal(score.commentRate, 0.05);
  assert.equal(score.shareRate, 0.03);
  assert.equal(score.saveRate, 0.04);
  assert.equal(score.clickRate, 0.08);
  assert.equal(score.followConversionRate, 0.02);
  assert.equal(score.label, "winner");
});

test("falls back to reach when impressions are unavailable", () => {
  const score = calculatePostScore({
    metrics: {
      impressions: null,
      reach: 50,
      reactions: 5,
      comments: 0,
      shares: 0,
      reposts: 0,
      saves: null,
      clicks: null,
      views: null,
      follows: null
    }
  }, history());

  assert.equal(score.denominatorSource, "reach");
  assert.equal(score.engagementRate, 0.1);
});

test("returns insufficient_data for missing or zero denominators", () => {
  const score = calculatePostScore({
    metrics: {
      impressions: 0,
      reach: null,
      reactions: 1,
      comments: null,
      shares: null,
      reposts: null,
      saves: null,
      clicks: null,
      views: null,
      follows: null
    }
  });

  assert.equal(score.engagementRate, null);
  assert.equal(score.finalSuccessScore, null);
  assert.equal(score.label, "insufficient_data");
});

test("percentile calculation handles ties and low sample sizes", () => {
  assert.equal(percentileScore(10, [1, 2]), 50);
  assert.equal(percentileScore(10, [5, 10, 20, 30]), 37.5);
});

test("labels loser and neutral scores", () => {
  const loser = calculatePostScore({
    metrics: metricSet(100, 1)
  }, history());
  const neutral = calculatePostScore({
    metrics: {
      impressions: 1000,
      reach: null,
      reactions: 25,
      comments: 20,
      shares: 12,
      reposts: 0,
      saves: 0,
      clicks: 30,
      views: null,
      follows: 6
    }
  }, history());

  assert.equal(loser.label, "loser");
  assert.equal(neutral.label, "neutral");
});

function history() {
  return [
    historical(0.02, 20),
    historical(0.04, 40),
    historical(0.06, 60),
    historical(0.08, 70),
    historical(0.10, 80)
  ];
}

function historical(rate: number, finalSuccessScore: number) {
  return {
    platform: "linkedin",
    formatType: "standard_post",
    engagementRate: rate,
    commentRate: rate / 3,
    shareRate: rate / 4,
    saveRate: rate / 5,
    clickRate: rate / 2,
    followConversionRate: rate / 10,
    finalSuccessScore
  };
}

function metricSet(impressions: number, reactions: number) {
  return {
    impressions,
    reach: null,
    reactions,
    comments: 0,
    shares: 0,
    reposts: 0,
    saves: 0,
    clicks: 0,
    views: null,
    follows: 0
  };
}
