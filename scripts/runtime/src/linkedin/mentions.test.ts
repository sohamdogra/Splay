import assert from "node:assert/strict";
import test from "node:test";
import { annotateLinkedInText, prepareLinkedInPublishContent } from "./mentions.ts";
import type { GeneratedPost, LinkedInMentionEntity } from "../types/index.ts";

const SPLAY_LINKEDIN_ENTITY: LinkedInMentionEntity = {
  aliases: ["Splay"],
  id: "splay-test-org",
  link: "https://www.linkedin.com/company/splay-test",
  entity: "urn:li:organization:splay-test-org",
  vanityName: "splay-test",
  localizedName: "Splay",
  kind: "organization"
};

test("mentions every Splay occurrence using the verified company identity", () => {
  const result = annotateLinkedInText("Splay reads the thread. Splay suggests the update.", [SPLAY_LINKEDIN_ENTITY]);

  assert.equal(result.text, "Splay reads the thread. Splay suggests the update.");
  assert.equal(result.annotations.length, 2);
  assert.deepEqual(result.annotations.map(({ start, length }) => ({ start, length })), [
    { start: 0, length: 5 },
    { start: 24, length: 5 }
  ]);
  assert.ok(result.annotations.every((annotation) => annotation.entity === SPLAY_LINKEDIN_ENTITY.entity));
});

test("supports verified people and UTF-16 annotation offsets", () => {
  const person: LinkedInMentionEntity = {
    aliases: ["Jane", "Jane Smith"],
    id: "abc123",
    link: "https://www.linkedin.com/in/jane-smith",
    entity: "urn:li:person:abc123",
    vanityName: "jane-smith",
    localizedName: "Jane Smith",
    kind: "person"
  };
  const result = annotateLinkedInText("🚀 Jane joined Splay.", [SPLAY_LINKEDIN_ENTITY, person]);

  assert.equal(result.text, "🚀 Jane joined Splay.");
  assert.equal(result.annotations[0].start, 3);
  assert.equal(result.annotations[0].length, 4);
  assert.equal(result.annotations[1].start, 15);
  assert.equal(result.annotations[1].length, 5);
});

test("keeps unresolved names as plain text", () => {
  const result = annotateLinkedInText("Alex joined the call.", [SPLAY_LINKEDIN_ENTITY]);
  assert.equal(result.text, "Alex joined the call.");
  assert.deepEqual(result.annotations, []);
});

test("builds Buffer LinkedIn metadata but leaves X unchanged", async () => {
  const linkedin = await prepareLinkedInPublishContent(makePost("linkedin"));
  const x = await prepareLinkedInPublishContent(makePost("x"));

  assert.match(linkedin.text, /^Splay keeps buyer trackers current/);
  assert.equal(linkedin.metadata?.linkedin.annotations.length, 1);
  assert.equal(x.text, "Splay keeps buyer trackers current.\n\n#InvestmentBanking");
  assert.equal(x.metadata, undefined);
});

function makePost(platform: GeneratedPost["platform"]): GeneratedPost {
  return {
    id: `mention-${platform}`,
    source_context: { summary: "", gbrain_references: [], why_now: "" },
    platform,
    topic: "Mentions",
    post_text: "Splay keeps buyer trackers current.",
    image_prompt: "",
    image_url: "",
    image_provider: "placeholder",
    canva_design_url: null,
    alt_text: "",
    hashtags: ["InvestmentBanking"],
    status: "draft",
    created_at: new Date().toISOString(),
    scheduled_for: null,
    quality_score: { hook: 1, clarity: 1, brand_fit: 1, platform_fit: 1, overall: 1 },
    warnings: [],
    linkedin_mentions: [SPLAY_LINKEDIN_ENTITY]
  };
}
