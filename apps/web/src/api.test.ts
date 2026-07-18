import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCampaign, decidePost, generateCampaign, generatePosts, publishApproved, schedulePost, setApiToken } from "./api";

function response(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  } as Response;
}

describe("Splay API client", () => {
  beforeEach(() => {
    setApiToken("");
    vi.unstubAllGlobals();
  });

  it("builds topic generation requests from composer text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "job-1" } }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await generatePosts("  source-backed diligence  ", true, "video");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/jobs/generate", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ mode: "topic", topic: "source-backed diligence", creative: true, media: "video", platforms: ["linkedin", "x"] })
    }));
  });

  it("sends only the selected generation platform", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "job-1" } }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await generatePosts("retention signals", false, "image", ["linkedin"]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ mode: "topic", topic: "retention signals", creative: false, media: "image", platforms: ["linkedin"] }));
  });

  it("sends bearer auth and backend-compatible review reasons", async () => {
    setApiToken("local-secret");
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "post-1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await decidePost("post-1", "revise", "unsupported");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer local-secret");
    expect(init.body).toBe(JSON.stringify({ decision: "revise", reason: "unsupported" }));
  });

  it("converts local schedule values to the API's ISO timestamp", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "post-1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await schedulePost("post-1", "2026-07-20T09:30");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ scheduled_for: new Date("2026-07-20T09:30").toISOString() }));
  });

  it("publishes only the selected approved post immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "job-publish", kind: "publish-approved" } }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await publishApproved("post-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/jobs/publish-approved", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ confirm: true, post_id: "post-1", mode: "now" })
    }));
  });

  it("creates and generates a weekly campaign through dedicated endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: { id: "campaign-1" } }, 201))
      .mockResolvedValueOnce(response({ data: { id: "job-2", kind: "campaign-generate" } }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const startAt = new Date(Date.now() + 86_400_000).toISOString();

    await createCampaign({ name: "Weekly proof", brief: "Show one source-backed workflow each week", themes: ["handoffs"], platforms: ["linkedin"], start_at: startAt, timezone: "America/Los_Angeles", interval_weeks: 1, occurrences: 6, creative: false });
    await generateCampaign("campaign-1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/campaigns");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/campaigns/campaign-1/generate");
  });
});
