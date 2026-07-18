import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrandKitView } from "./BrandKitView";
import { CampaignsView } from "./CampaignsView";
import { PostCard } from "./components";
import type { BrandKit, SplayPost } from "./types";

const brandKit: BrandKit = {
  version: 1,
  updated_at: "2026-07-18T00:00:00.000Z",
  name: "Splay",
  tagline: "Deal context that survives the close.",
  audience: "deal teams",
  tone: "direct, credible",
  positioning: "Reviewable deal context.",
  avoid: ["generic AI hype"],
  colors: { primary: "#0F5EFF", secondary: "#0A3DB8", accent: "#DCE7FF", background: "#FBFCFE", text: "#1F2937" },
  typography: { heading_family: "Brawler", body_family: "Instrument Sans", heading_weight: 400, body_weight: 400, scale: "editorial" },
  logo_url: null
};

describe("campaign and brand workflows", () => {
  it("builds a weekly campaign request", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CampaignsView campaigns={[]} busy={false} onCreate={onCreate} onGenerate={vi.fn()} onStatus={vi.fn()} onReview={vi.fn()} />);

    await user.type(screen.getByLabelText("Campaign name"), "Weekly source proof");
    await user.type(screen.getByLabelText("Core brief"), "Show how traceable context improves one workflow every week.");
    await user.click(screen.getByRole("button", { name: "Create campaign" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Weekly source proof", occurrences: 6, interval_weeks: 1, platforms: ["linkedin"] }));
  });

  it("saves edited brand typography and voice", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<BrandKitView brandKit={brandKit} onSave={onSave} />);

    const tagline = screen.getByLabelText("Tagline");
    await user.clear(tagline);
    await user.type(tagline, "Every claim stays connected to its source.");
    await user.click(screen.getByRole("button", { name: "Save brand kit" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ tagline: "Every claim stays connected to its source." }));
  });

  it("collects a specific explanation before overriding a revise verdict", async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const post: SplayPost = {
      id: "post-revise",
      platform: "x",
      topic: "Retention signals",
      post_text: "Customer retention starts with finding the signal before the churn event.",
      hashtags: [],
      status: "draft",
      created_at: "2026-07-18T00:00:00.000Z",
      scheduled_for: null,
      media_url: null,
      alt_text: "Retention signal illustration",
      source_context: { summary: "Retention source", gbrain_references: [], why_now: "Current campaign" },
      editorial_evaluation: {
        compliance: { passed: true, errors: [] },
        editorial_review: { verdict: "revise", rationale: ["too generic"] }
      }
    };

    render(<PostCard post={post} onDecision={onDecision} onSchedule={vi.fn()} onPublish={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));

    const note = screen.getByLabelText("Approval override explanation");
    await user.type(note, "The claim is specific and directly supported by the company source.");
    await user.click(screen.getByRole("button", { name: "Approve override" }));

    expect(onDecision).toHaveBeenCalledWith(
      "post-revise",
      "approve",
      "strong_insight",
      "The claim is specific and directly supported by the company source."
    );
  });

  it("confirms immediate publishing for only the selected post", async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const post: SplayPost = {
      id: "post-approved",
      platform: "x",
      topic: "Retention signals",
      post_text: "Spot the churn signal while there is still time to act.",
      hashtags: [],
      status: "approved",
      created_at: "2026-07-18T00:00:00.000Z",
      scheduled_for: null,
      media_url: null,
      alt_text: "Retention signal illustration",
      source_context: { summary: "Retention source", gbrain_references: [], why_now: "Current campaign" }
    };

    render(<PostCard post={post} onDecision={vi.fn()} onSchedule={vi.fn()} onPublish={onPublish} />);
    await user.click(screen.getByRole("button", { name: "Post to X" }));
    expect(screen.getByText("Buffer will publish this post immediately. Confirm?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onPublish).toHaveBeenCalledWith("post-approved");
  });
});
