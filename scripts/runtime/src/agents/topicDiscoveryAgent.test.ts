import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicFromManualInput, parseManualPostRequest } from "./topicDiscoveryAgent.ts";

const brand = {
  name: "Splay",
  audience: "founders",
  tone: "direct",
  positioning: "Clear company storytelling.",
  avoid: ["generic hype"]
};

test("separates a composer instruction from its subject and supporting facts", () => {
  const request = parseManualPostRequest("Can you make a post about churnary.ai Churnary is an AI-powered customer retention platform that flags churn risk early.");

  assert.equal(request.topic, "Churnary.ai");
  assert.equal(request.brief, "Churnary is an AI-powered customer retention platform that flags churn risk early.");
  assert.doesNotMatch(`${request.topic} ${request.brief}`, /can you make a post/i);
});

test("keeps long multiline composer context intact", () => {
  const details = Array.from({ length: 120 }, (_, index) => `Evidence line ${index + 1}: customers need the full launch context.`).join("\n");
  const request = parseManualPostRequest(`Post about launch readiness is important.\n${details}`);

  assert.equal(request.topic, "Launch readiness");
  assert.match(request.brief, /Evidence line 120/);
  assert.ok(request.brief.includes("\n"));
});

test("manual ideas never place the composer instruction in generated context", async () => {
  const idea = await buildTopicFromManualInput("Please write a post on churnary.ai Churnary helps teams spot customer churn before renewal.", [], brand);

  assert.equal(idea.topic, "Churnary.ai");
  assert.match(idea.source_context.summary, /^Churnary helps teams/);
  assert.doesNotMatch(JSON.stringify(idea), /please write a post/i);
});
