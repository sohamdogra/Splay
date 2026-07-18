import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrainImportView } from "./BrainImportView";
import { BRAIN_IMPORT_SCHEMA } from "./brainImport";

const payload = {
  schema_version: BRAIN_IMPORT_SCHEMA,
  brand_kit: {
    name: "Acme",
    tagline: "Better handoffs",
    audience: "Operations teams",
    tone: "Clear and practical",
    positioning: "Acme keeps operating context attached to work.",
    avoid: ["Hype"],
    colors: { primary: "#123456", secondary: "#234567", accent: "#345678", background: "#FFFFFF", text: "#111827" },
    typography: { heading_family: "Inter", body_family: "Inter", heading_weight: 600, body_weight: 400, scale: "balanced" as const },
    logo_url: null
  },
  context: [{ title: "Public product page", kind: "product", summary: "Acme keeps context attached to active work.", source: "https://example.com/product", tags: ["workflow"], public_safe: true }]
};

afterEach(() => cleanup());

describe("Quick brain import", () => {
  it("previews dropped agent output and imports it after review", async () => {
    const onImport = vi.fn(async () => ({
      brandKit: { ...payload.brand_kit, version: 1, updated_at: "2026-07-18T00:00:00.000Z" },
      imported: [{ ...payload.context[0], id: "context-1", created_at: "2026-07-18T00:00:00.000Z", updated_at: "2026-07-18T00:00:00.000Z" }]
    }));
    const user = userEvent.setup();
    render(<BrainImportView onImport={onImport} />);

    const file = new File([JSON.stringify(payload)], "splay-brain-import.json", { type: "application/json" });
    fireEvent.drop(screen.getByTestId("brain-import-dropzone"), { dataTransfer: { files: [file] } });

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText(/1 imported record is marked/)).toBeInTheDocument();
    const importButton = screen.getByRole("button", { name: "Import brand & brain" });
    expect(importButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I reviewed the brand fields/ }));
    await user.click(importButton);

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(payload));
    expect(await screen.findByText(/Imported Acme and 1 company-brain record/)).toBeInTheDocument();
  });

  it("validates pasted JSON before offering import", async () => {
    const user = userEvent.setup();
    render(<BrainImportView onImport={vi.fn()} />);
    await user.type(screen.getByLabelText("Paste brain import JSON"), "not json");
    await user.click(screen.getByRole("button", { name: "Validate and review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not valid JSON");
  });
});
