import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const health = {
  ok: true,
  service: "splay-api",
  version: "0.2.0",
  authentication: "local-only",
  generation: { brain: "project-local", text: "local-template", image: "canva" },
  publishing: { buffer_configured: false, media_host: "convex", media_host_configured: false, mode: "queue" }
};

const draft = {
  id: "post-1",
  platform: "linkedin",
  topic: "Source-backed diligence",
  post_text: "Deal context should survive the close.",
  hashtags: ["DealExecution", "AI"],
  status: "draft",
  created_at: "2026-07-18T16:00:00.000Z",
  scheduled_for: null,
  media_url: null,
  alt_text: "",
  source_context: { summary: "", gbrain_references: ["buyer-tracker-thread.eml"], why_now: "" },
  review_history: []
};

function response(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  } as Response;
}

describe("Splay frontend", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("loads real API-shaped posts and approves a draft", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return response(health);
      if (url.endsWith("/api/v1/jobs")) return response({ data: [] });
      if (url.endsWith("/api/v1/campaigns")) return response({ data: [] });
      if (url.endsWith("/api/v1/brain/context")) return response({ data: [] });
      if (url.endsWith("/api/v1/brand-kit")) return response({ data: {
        version: 1, updated_at: "2026-07-18T00:00:00.000Z", name: "Splay", tagline: "Deal context that survives the close.",
        audience: "deal teams", tone: "direct", positioning: "Reviewable next steps.", avoid: [], logo_url: null,
        colors: { primary: "#0F5EFF", secondary: "#0A3DB8", accent: "#DCE7FF", background: "#FBFCFE", text: "#1F2937" },
        typography: { heading_family: "Brawler", body_family: "Instrument Sans", heading_weight: 400, body_weight: 400, scale: "editorial" }
      } });
      if (url.endsWith("/api/v1/posts") && (!init?.method || init.method === "GET")) return response({ data: [draft] });
      if (url.endsWith("/api/v1/posts/post-1/decisions")) {
        return response({ data: { ...draft, status: "approved", review_history: [{ decision: "approve", reason: "strong_insight", decided_at: "2026-07-18T16:01:00.000Z" }] } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Review queue" }));
    expect(await screen.findByText("Deal context should survive the close.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByText("Approved")).toBeInTheDocument());
    const decisionCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/decisions"));
    expect(decisionCall?.[1]?.body).toBe(JSON.stringify({ decision: "approve", reason: "strong_insight" }));
  });
});
