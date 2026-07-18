import { describe, expect, it } from "vitest";
import { BRAIN_IMPORT_SCHEMA, CODING_AGENT_BRAIN_IMPORT_PROMPT, parseBrainImport } from "./brainImport";

const validImport = {
  schema_version: BRAIN_IMPORT_SCHEMA,
  brand_kit: {
    name: "Acme",
    tagline: "Better handoffs",
    audience: "Operations teams",
    tone: "Clear and practical",
    positioning: "Acme keeps operating context attached to work.",
    avoid: ["Hype"],
    colors: { primary: "#123456", secondary: "#234567", accent: "#345678", background: "#FFFFFF", text: "#111827" },
    typography: { heading_family: "Inter", body_family: "Inter", heading_weight: 600, body_weight: 400, scale: "balanced" },
    logo_url: null
  },
  context: [{
    title: "Product overview",
    kind: "product",
    summary: "Acme keeps operating context attached to active work.",
    source: "README.md",
    date: "2026-07-18",
    tags: ["workflow", "workflow"],
    public_safe: false
  }]
};

describe("brain import contract", () => {
  it("parses fenced agent output and normalizes values", () => {
    const result = parseBrainImport(`Here is the file:\n\n\`\`\`json\n${JSON.stringify(validImport)}\n\`\`\``);
    expect(result.brand_kit.colors.primary).toBe("#123456");
    expect(result.context[0].tags).toEqual(["workflow"]);
    expect(result.context[0].public_safe).toBe(false);
  });

  it("rejects unsupported schemas and unsafe malformed flags", () => {
    expect(() => parseBrainImport(JSON.stringify({ ...validImport, schema_version: "v2" }))).toThrow(/schema_version/);
    expect(() => parseBrainImport(JSON.stringify({ ...validImport, context: [{ ...validImport.context[0], public_safe: "yes" }] }))).toThrow(/public_safe/);
  });

  it("gives coding agents the exact contract and secret-handling rule", () => {
    expect(CODING_AGENT_BRAIN_IMPORT_PROMPT).toContain(BRAIN_IMPORT_SCHEMA);
    expect(CODING_AGENT_BRAIN_IMPORT_PROMPT).toContain("Do not read .env files");
    expect(CODING_AGENT_BRAIN_IMPORT_PROMPT).toContain("splay-brain-import.json");
  });
});
