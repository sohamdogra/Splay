import assert from "node:assert/strict";
import test from "node:test";
import { fitDraftToPlatform, formatPostText, validatePlatformPost } from "./postText.ts";

test("preserves intentional paragraph breaks in X posts", () => {
  const fitted = fitDraftToPlatform("x", {
    text: "The buyer replied Thursday.\n\nThe tracker still says awaiting response.",
    hashtags: []
  });

  assert.equal(fitted.text, "The buyer replied Thursday.\n\nThe tracker still says awaiting response.");
});

test("adds readable paragraph breaks to dense X posts", () => {
  const fitted = fitDraftToPlatform("x", {
    text: "The CRM says one thing. The inbox says another. That is how buyer lists go stale: the sponsor replied, the call note changed, the follow-up is still sitting in someone's head. Arvya turns the thread into the update before the tracker goes stale.",
    hashtags: []
  });

  assert.match(fitted.text, /The CRM says one thing\. The inbox says another\.\n\nThat is how buyer lists go stale/);
  assert.equal(validatePlatformPost("x", fitted.text, fitted.hashtags).ok, true);
});

test("keeps X posts under the character limit when paragraph breaks cost too much", () => {
  const fitted = fitDraftToPlatform("x", {
    text: "The buyer replied Thursday. The tracker still says awaiting response. The VP has the note, the analyst has the follow-up, and the partner has the approval. Arvya keeps those updates tied to the thread so the list stops going stale before Monday morning.",
    hashtags: ["PrivateEquity", "InvestmentBanking"]
  });

  const validation = validatePlatformPost("x", fitted.text, fitted.hashtags);
  assert.equal(validation.ok, true);
  assert.ok(validation.count <= 280);
  assert.ok(fitted.hashtags.length <= 1);
});

test("publishes preserved X paragraphs through final Buffer text formatting", () => {
  const text = "The CRM says one thing.\n\nThe inbox says another.";
  assert.equal(formatPostText(text, ["PrivateEquity"]), "The CRM says one thing.\n\nThe inbox says another.\n\n#PrivateEquity");
});
