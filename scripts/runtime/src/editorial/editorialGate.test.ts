import assert from "node:assert/strict";
import test from "node:test";
import { checkImageCopy, checkPostDraft, findInternalJargon } from "./editorialGate.ts";

test("flags internal jargon phrases regardless of case and spacing", () => {
  assert.deepEqual(findInternalJargon("Workflow fit beats model IQ"), ["workflow fit", "model iq"]);
  assert.deepEqual(findInternalJargon("the workflow remembers everything"), []);
  assert.deepEqual(findInternalJargon("a deal-ops layer for bankers"), ["deal-ops layer"]);
  assert.deepEqual(findInternalJargon("This is source backed and real"), ["source-backed"]);
});

test("rejects post drafts built on internal abstractions", () => {
  const result = checkPostDraft({
    platform: "linkedin",
    topic: "Workflow fit beats model IQ",
    postText: "The product becomes valuable when the workflow itself becomes memory. Workflow fit matters more than model IQ.",
    hashtags: ["PrivateEquity", "InvestmentBanking", "DealOps"]
  });
  assert.ok(result.errors.length >= 2);
  assert.ok(result.errors.some((error) => error.includes("topic")));
  assert.ok(result.errors.some((error) => error.includes("post text")));
});

test("rejects Splay.io in post copy", () => {
  const result = checkPostDraft({
    platform: "x",
    topic: "Deal follow-ups",
    postText: "Try Splay.io today.",
    hashtags: []
  });
  assert.ok(result.errors.some((error) => error.includes("Splay.io")));
});

test("passes clean concrete post copy and warns only on length", () => {
  const short = checkPostDraft({
    platform: "linkedin",
    topic: "Stop rebuilding the buyer tracker",
    postText: "Every deal team rebuilds the same tracker.",
    hashtags: ["PrivateEquity", "InvestmentBanking", "DealOps"]
  });
  assert.deepEqual(short.errors, []);
  assert.equal(short.warnings.length, 1);
  assert.ok(short.warnings[0].includes("500-650"));

  const inRange = checkPostDraft({
    platform: "linkedin",
    topic: "Stop rebuilding the buyer tracker",
    postText: "x".repeat(560),
    hashtags: ["PrivateEquity", "InvestmentBanking", "DealOps"]
  });
  assert.deepEqual(inRange.errors, []);
  assert.deepEqual(inRange.warnings, []);
});

test("does not length-warn X drafts", () => {
  const result = checkPostDraft({
    platform: "x",
    topic: "Stop rebuilding the buyer tracker",
    postText: "Short and sharp.",
    hashtags: []
  });
  assert.deepEqual(result.warnings, []);
});

test("requires a targeted LinkedIn hashtag set", () => {
  const missing = checkPostDraft({
    platform: "linkedin",
    topic: "Stop rebuilding the buyer tracker",
    postText: "x".repeat(560),
    hashtags: []
  });
  assert.ok(missing.errors.some((error) => error.includes("3-4 relevant hashtags")));

  const targeted = checkPostDraft({
    platform: "linkedin",
    topic: "Stop rebuilding the buyer tracker",
    postText: "x".repeat(560),
    hashtags: ["PrivateEquity", "InvestmentBanking", "DealOps"]
  });
  assert.deepEqual(targeted.errors, []);

  const irrelevant = checkPostDraft({
    platform: "linkedin",
    topic: "Stop rebuilding the buyer tracker",
    postText: "x".repeat(560),
    hashtags: ["Travel", "Cooking", "Fitness"]
  });
  assert.ok(irrelevant.errors.some((error) => error.includes("not supported by this post")));
});

test("rejects an unrelated X discovery tag", () => {
  const result = checkPostDraft({
    platform: "x",
    topic: "Pre-call briefs for bankers",
    postText: "Splay prepares the brief when the meeting lands.",
    hashtags: ["Travel"]
  });
  assert.ok(result.errors.some((error) => error.includes("X hashtag is not supported")));

  const relevant = checkPostDraft({
    platform: "x",
    topic: "Pre-call briefs for bankers",
    postText: "Splay prepares the brief when the meeting lands so bankers can decide who should join.",
    hashtags: ["InvestmentBanking"]
  });
  assert.deepEqual(relevant.errors, []);
});

test("enforces image copy word budgets", () => {
  const tooShort = checkImageCopy({ headline: "Stop rebuilding", support: "One thread. One tracker. One next step." });
  assert.ok(tooShort.errors.some((error) => error.includes("3-8 words")));

  const tooLong = checkImageCopy({
    headline: "Stop rebuilding the tracker",
    support: "Deal follow-ups should never have to live inside one person's memory again ever"
  });
  assert.ok(tooLong.errors.some((error) => error.includes("5-12 words")));

  const good = checkImageCopy({
    headline: "Stop rebuilding the tracker",
    support: "One thread. One tracker. One next step."
  });
  assert.deepEqual(good.errors, []);
});

test("rejects jargon and missing fields in image copy", () => {
  const jargon = checkImageCopy({ headline: "Workflow memory beats dashboards", support: "Agents work when the workflow remembers" });
  assert.ok(jargon.errors.some((error) => error.includes("workflow memory")));

  const missing = checkImageCopy({});
  assert.equal(missing.errors.length, 2);
});
