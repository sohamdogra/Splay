import type { BrainImportPayload, BrandKitInput, CreateCompanyContextInput } from "./types";

export const BRAIN_IMPORT_SCHEMA = "splay-brain-import/v1" as const;

export const CODING_AGENT_BRAIN_IMPORT_PROMPT = `You are preparing a Splay brand-and-brain import for the company represented by the files and documentation in the current project.

Inspect only relevant project files and sources the user explicitly supplied. Do not read .env files, credentials, tokens, private keys, browser data, unrelated home-directory files, or other workspaces. Never include a secret or personal credential in the output.

Create a file named splay-brain-import.json containing only valid JSON—no Markdown fences or commentary. Use this exact structure:

{
  "schema_version": "splay-brain-import/v1",
  "brand_kit": {
    "name": "Company name",
    "tagline": "Short company tagline",
    "audience": "Specific description of the people the company serves",
    "tone": "Clear description of the desired writing voice",
    "positioning": "What the company does, for whom, and why it is distinct",
    "avoid": ["Unsupported claims", "Phrases or tones the brand avoids"],
    "colors": {
      "primary": "#000000",
      "secondary": "#000000",
      "accent": "#000000",
      "background": "#FFFFFF",
      "text": "#000000"
    },
    "typography": {
      "heading_family": "Font family",
      "body_family": "Font family",
      "heading_weight": 600,
      "body_weight": 400,
      "scale": "balanced"
    },
    "logo_url": null
  },
  "context": [
    {
      "title": "Concise source title",
      "kind": "company",
      "summary": "A self-contained, source-grounded fact or observation that Splay may use when drafting content.",
      "source": "Public URL or project-relative source path",
      "date": "YYYY-MM-DD",
      "tags": ["descriptive", "tags"],
      "public_safe": false
    }
  ]
}

Rules:
- Use only evidence found in the supplied project or explicit sources. Do not invent claims, customers, metrics, pricing, product capabilities, colors, fonts, or company history.
- Keep each context summary concise, self-contained, and useful without reopening its source.
- Allowed context kinds are company, product, customer, founder, market, proof, or other.
- Set public_safe to true only when the material is already public and appropriate for public marketing. Otherwise use false.
- Do not include private customer names, personal data, credentials, unpublished financials, or confidential internal facts.
- Use six-digit hex colors. typography.scale must be compact, balanced, or editorial. Use a public HTTPS logo URL or null.
- Keep brand name under 80 characters, tagline under 160, brand prose under 500 characters per field, context titles under 160, context summaries under 4000, and at most 20 tags per record.
- Prefer several focused context records over one large document dump. Remove duplicates.
- If a value cannot be supported, use a conservative neutral value for required brand fields, null for logo_url, or omit the context record. Do not guess.`;

export class BrainImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainImportError";
  }
}

export function parseBrainImport(raw: string): BrainImportPayload {
  const text = raw.trim();
  if (!text) throw new BrainImportError("Paste agent output or drop a JSON file first.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate(text));
  } catch {
    throw new BrainImportError("The agent output is not valid JSON. Ask it to return only the import object without commentary.");
  }

  const root = record(parsed, "Import");
  if (root.schema_version !== BRAIN_IMPORT_SCHEMA) {
    throw new BrainImportError(`schema_version must be ${BRAIN_IMPORT_SCHEMA}.`);
  }
  const contexts = array(root.context, "context", 100).map((item, index) => contextItem(item, index));
  if (contexts.length === 0) throw new BrainImportError("context must contain at least one company-brain record.");

  return {
    schema_version: BRAIN_IMPORT_SCHEMA,
    brand_kit: brandKit(root.brand_kit),
    context: contexts
  };
}

function jsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function brandKit(value: unknown): BrandKitInput {
  const input = record(value, "brand_kit");
  const colors = record(input.colors, "brand_kit.colors");
  const typography = record(input.typography, "brand_kit.typography");
  const scale = stringValue(typography.scale, "brand_kit.typography.scale", 20);
  if (!["compact", "balanced", "editorial"].includes(scale)) {
    throw new BrainImportError("brand_kit.typography.scale must be compact, balanced, or editorial.");
  }
  return {
    name: stringValue(input.name, "brand_kit.name", 80),
    tagline: stringValue(input.tagline, "brand_kit.tagline", 160),
    audience: stringValue(input.audience, "brand_kit.audience", 500),
    tone: stringValue(input.tone, "brand_kit.tone", 500),
    positioning: stringValue(input.positioning, "brand_kit.positioning", 500),
    avoid: stringArray(input.avoid, "brand_kit.avoid", 20, 100),
    colors: {
      primary: color(colors.primary, "brand_kit.colors.primary"),
      secondary: color(colors.secondary, "brand_kit.colors.secondary"),
      accent: color(colors.accent, "brand_kit.colors.accent"),
      background: color(colors.background, "brand_kit.colors.background"),
      text: color(colors.text, "brand_kit.colors.text")
    },
    typography: {
      heading_family: stringValue(typography.heading_family, "brand_kit.typography.heading_family", 80),
      body_family: stringValue(typography.body_family, "brand_kit.typography.body_family", 80),
      heading_weight: integer(typography.heading_weight, "brand_kit.typography.heading_weight", 100, 900),
      body_weight: integer(typography.body_weight, "brand_kit.typography.body_weight", 100, 900),
      scale: scale as BrandKitInput["typography"]["scale"]
    },
    logo_url: nullableString(input.logo_url, "brand_kit.logo_url", 500)
  };
}

function contextItem(value: unknown, index: number): CreateCompanyContextInput {
  const field = `context[${index}]`;
  const input = record(value, field);
  const kind = stringValue(input.kind, `${field}.kind`, 80).toLowerCase();
  if (!["company", "product", "customer", "founder", "market", "proof", "other"].includes(kind)) {
    throw new BrainImportError(`${field}.kind must be company, product, customer, founder, market, proof, or other.`);
  }
  if (typeof input.public_safe !== "boolean") throw new BrainImportError(`${field}.public_safe must be true or false.`);
  const source = optionalString(input.source, `${field}.source`, 500);
  const date = optionalString(input.date, `${field}.date`, 100);
  if (date && Number.isNaN(new Date(date).getTime())) throw new BrainImportError(`${field}.date must be a valid date.`);
  return {
    title: stringValue(input.title, `${field}.title`, 160),
    kind,
    summary: stringValue(input.summary, `${field}.summary`, 4_000),
    ...(source ? { source } : {}),
    ...(date ? { date } : {}),
    tags: stringArray(input.tags, `${field}.tags`, 20, 80),
    public_safe: input.public_safe
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BrainImportError(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new BrainImportError(`${field} must be an array with at most ${maximum} items.`);
  return value;
}

function stringValue(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new BrainImportError(`${field} is required.`);
  const result = value.trim();
  if (result.length > maximum) throw new BrainImportError(`${field} must be at most ${maximum} characters.`);
  return result;
}

function optionalString(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return stringValue(value, field, maximum);
}

function nullableString(value: unknown, field: string, maximum: number): string | null {
  return value === null || value === "" || value === undefined ? null : stringValue(value, field, maximum);
}

function stringArray(value: unknown, field: string, maximumItems: number, maximumLength: number): string[] {
  const items = array(value, field, maximumItems);
  return [...new Set(items.map((item, index) => stringValue(item, `${field}[${index}]`, maximumLength)))];
}

function color(value: unknown, field: string): string {
  const result = stringValue(value, field, 20).toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new BrainImportError(`${field} must be a six-digit hex color.`);
  return result;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new BrainImportError(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}
