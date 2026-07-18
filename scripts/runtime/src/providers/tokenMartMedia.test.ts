import assert from "node:assert/strict";
import test from "node:test";
import { TokenMartApiError, TokenMartMediaClient } from "./tokenMartMedia.ts";

test("generates a watermark-free Seedream background through TokenMart", async () => {
  let requestUrl = "";
  let requestHeaders: HeadersInit | undefined;
  let requestBody: Record<string, unknown> = {};
  const client = new TokenMartMediaClient({
    apiKey: "test-tokenmart-key",
    maxRetries: 0,
    fetch: async (input, init) => {
      requestUrl = String(input);
      requestHeaders = init?.headers;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        model: "dola-seedream-5-0-pro-260628",
        data: [{ b64_json: Buffer.from("png-bytes").toString("base64"), output_format: "png" }]
      });
    }
  });

  const result = await client.generateBackground({ prompt: "Background only. No text." });

  assert.equal(requestUrl, "https://model.service-inference.ai/v1/images/generations");
  assert.equal(new Headers(requestHeaders).get("authorization"), "Bearer test-tokenmart-key");
  assert.deepEqual(requestBody, {
    model: "dola-seedream-5-0-pro-260628",
    prompt: "Background only. No text.",
    size: "1280x720",
    output_format: "png",
    response_format: "b64_json",
    watermark: false
  });
  assert.equal(Buffer.from(result.bytes).toString("utf8"), "png-bytes");
  assert.equal(result.contentType, "image/png");
});

test("does not retry TokenMart billing and model-access failures", async (context) => {
  for (const failure of [
    { status: 402, code: "ERR_BILLING_002", message: "Organization is not activated." },
    { status: 403, code: "ERR_MODEL_001", message: "Model is not permitted for this key." },
    { status: 404, code: "ERR_MODEL_002", message: "Unknown model ID." }
  ]) {
    await context.test(`${failure.status} ${failure.code}`, async () => {
      let calls = 0;
      const client = new TokenMartMediaClient({
        apiKey: "test-tokenmart-key",
        maxRetries: 4,
        sleep: async () => undefined,
        fetch: async () => {
          calls += 1;
          return jsonResponse({ error: { code: failure.code, message: failure.message } }, failure.status);
        }
      });

      await assert.rejects(
        client.generateBackground({ prompt: "Background only." }),
        (error: unknown) => error instanceof TokenMartApiError
          && error.status === failure.status
          && error.code === failure.code
          && error.retryable === false
      );
      assert.equal(calls, 1);
    });
  }
});

test("submits and polls a Seedance background animation task", async () => {
  const requests: Array<{ url: string; method: string; body?: Record<string, unknown>; authorization: string | null }> = [];
  let poll = 0;
  const client = new TokenMartMediaClient({
    apiKey: "test-tokenmart-key",
    maxRetries: 0,
    sleep: async () => undefined,
    fetch: async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        method: init?.method || "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
        authorization: headers.get("authorization")
      });
      if (url.endsWith("/v1/video/generate")) return jsonResponse({ id: "task-123", status: "queued" });
      if (url.endsWith("/v1/video/tasks/task-123")) {
        poll += 1;
        return poll === 1
          ? jsonResponse({ id: "task-123", status: "running" })
          : jsonResponse({ id: "task-123", status: "succeeded", outputs: ["/v1/video/files/task-123"] });
      }
      if (url.endsWith("/v1/video/files/task-123")) {
        return new Response(Buffer.from("mp4-bytes"), { status: 200, headers: { "content-type": "video/mp4" } });
      }
      return jsonResponse({ error: { message: "unexpected request" } }, 500);
    }
  });

  const task = await client.createAnimation({
    prompt: "Slow abstract wave motion. No text or logos.",
    imageUrl: "https://media.example.com/background.png"
  });
  const complete = await client.waitForAnimation(task, { pollIntervalMs: 1, timeoutMs: 1_000 });
  const video = await client.downloadVideo(complete.videoUrl);

  assert.equal(task.id, "task-123");
  assert.equal(complete.videoUrl, "https://model.service-inference.ai/v1/video/files/task-123");
  assert.equal(Buffer.from(video).toString("utf8"), "mp4-bytes");
  assert.deepEqual(requests[0].body, {
    model: "dreamina-seedance-2-0-260128",
    content: [
      { type: "text", text: "Slow abstract wave motion. No text or logos." },
      { type: "image_url", image_url: { url: "https://media.example.com/background.png" }, role: "first_frame" }
    ],
    resolution: "720p",
    ratio: "16:9",
    duration: 5,
    generate_audio: false,
    watermark: false
  });
  assert.ok(requests.every((request) => request.authorization === "Bearer test-tokenmart-key"));
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
