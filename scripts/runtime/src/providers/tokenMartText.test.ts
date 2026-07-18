import assert from "node:assert/strict";
import test from "node:test";
import { generateTokenMartJson } from "./tokenMartText.ts";

test("uses TokenMart's OpenAI-compatible chat endpoint for structured text", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  let authorization = "";
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    authorization = new Headers(init?.headers).get("authorization") || "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"text\":\"Generated post\"}" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const result = await generateTokenMartJson("Generate a post", {
    apiKey: "test-key",
    baseUrl: "https://models.test/",
    model: "gpt-4.1-mini",
    maxTokens: 900,
    temperature: 0.7,
    fetch: fakeFetch
  });

  assert.equal(result, "{\"text\":\"Generated post\"}");
  assert.equal(requestUrl, "https://models.test/v1/chat/completions");
  assert.equal(authorization, "Bearer test-key");
  assert.equal(requestBody.model, "gpt-4.1-mini");
  assert.equal(requestBody.max_tokens, 900);
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
});
