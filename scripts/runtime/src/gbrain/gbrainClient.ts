import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { GBrainContextItem } from "../types/index.ts";

type JsonRpcResult = {
  result?: unknown;
  error?: unknown;
};

const DEFAULT_CONTEXT_FILE = "src/data/mockGbrainContext.json";

export class GBrainClient {
  private readonly contextFile: string;
  private readonly httpUrl?: string;
  private readonly mcpBridgePath?: string;

  constructor(options: { contextFile?: string; httpUrl?: string } = {}) {
    this.contextFile = options.contextFile ?? process.env.GBRAIN_CONTEXT_FILE ?? DEFAULT_CONTEXT_FILE;
    this.httpUrl = options.httpUrl ?? process.env.GBRAIN_MCP_HTTP_URL;
    this.mcpBridgePath = process.env.GBRAIN_MCP_BRIDGE_PATH ?? path.join(os.homedir(), ".gbrain", "mcp-bridge-gh.py");
  }

  async searchCompanyContext(query: string): Promise<GBrainContextItem[]> {
    const method = process.env.GBRAIN_MCP_SEARCH_METHOD ?? "searchCompanyContext";
    const remote = await this.tryRemote(method, { query });
    if (remote.length > 0) return remote;

    const mcp = await this.tryMcpSearch(query);
    if (mcp.length > 0) return mcp;

    const terms = normalizeTerms(query);
    const items = await this.loadLocalContext();
    return items.filter((item) => {
      const haystack = `${item.title} ${item.kind} ${item.summary} ${item.tags.join(" ")}`.toLowerCase();
      return terms.some((term) => haystack.includes(term));
    });
  }

  async getRecentUpdates(): Promise<GBrainContextItem[]> {
    const mcp = await this.tryMcpRecentPages();
    if (mcp.length > 0) return mcp;

    return this.getByMethodOrTags(
      process.env.GBRAIN_MCP_RECENT_UPDATES_METHOD ?? "getRecentUpdates",
      ["product_update", "strategy_doc", "founder_notes"],
      ["recent company updates", "product launches", "strategy docs", "founder notes"]
    );
  }

  async getRecentCustomerInsights(): Promise<GBrainContextItem[]> {
    return this.getByMethodOrTags(
      process.env.GBRAIN_MCP_CUSTOMER_INSIGHTS_METHOD ?? "getRecentCustomerInsights",
      ["customer_insight"],
      ["customer pain points", "customer conversations"]
    );
  }

  async getRecentProductNotes(): Promise<GBrainContextItem[]> {
    return this.getByMethodOrTags(
      process.env.GBRAIN_MCP_PRODUCT_NOTES_METHOD ?? "getRecentProductNotes",
      ["product_update"],
      ["product launches", "product notes"]
    );
  }

  async getRecentSalesObjections(): Promise<GBrainContextItem[]> {
    return this.getByMethodOrTags(
      process.env.GBRAIN_MCP_SALES_OBJECTIONS_METHOD ?? "getRecentSalesObjections",
      ["sales_objection"],
      ["sales call notes", "objections from prospects"]
    );
  }

  private async getByMethodOrTags(method: string, kinds: string[], searches: string[]): Promise<GBrainContextItem[]> {
    const remote = await this.tryRemote(method, {});
    if (remote.length > 0) return remote;

    const local = await this.loadLocalContext();
    const direct = local.filter((item) => kinds.includes(item.kind));
    const searched = (await Promise.all(searches.map((query) => this.searchCompanyContext(query)))).flat();
    return uniqueById([...direct, ...searched]).sort(sortRecentFirst);
  }

  private async loadLocalContext(): Promise<GBrainContextItem[]> {
    const fullPath = path.isAbsolute(this.contextFile) ? this.contextFile : path.join(process.cwd(), this.contextFile);
    const raw = await readFile(fullPath, "utf8");
    return JSON.parse(raw) as GBrainContextItem[];
  }

  private async tryRemote(method: string, params: Record<string, unknown>): Promise<GBrainContextItem[]> {
    if (!this.httpUrl || process.env.GBRAIN_USE_MOCK === "1") return [];

    try {
      const response = await fetch(this.httpUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
      });
      if (!response.ok) return [];

      const body = (await response.json()) as JsonRpcResult;
      if (body.error || !body.result) return [];

      const result = Array.isArray(body.result) ? body.result : [body.result];
      return result.map(coerceContextItem).filter(Boolean) as GBrainContextItem[];
    } catch {
      return [];
    }
  }

  private async tryMcpSearch(query: string): Promise<GBrainContextItem[]> {
    if (process.env.GBRAIN_USE_MOCK === "1" || !this.mcpBridgePath) return [];

    const queryResult = await this.callMcpTool("query", {
      query,
      limit: 8,
      adaptive_return: false,
      source_id: "__all__"
    });
    const queryItems = parseMcpItems(queryResult).map(coerceContextItem).filter(Boolean) as GBrainContextItem[];
    if (queryItems.length > 0) return queryItems;

    const searchResult = await this.callMcpTool("search", { query, limit: 8 });
    return parseMcpItems(searchResult).map(coerceContextItem).filter(Boolean) as GBrainContextItem[];
  }

  private async tryMcpRecentPages(): Promise<GBrainContextItem[]> {
    if (process.env.GBRAIN_USE_MOCK === "1" || !this.mcpBridgePath) return [];

    const batches = await Promise.all([
      this.callMcpTool("list_pages", { type: "strategy", limit: 4, sort: "updated_desc" }),
      this.callMcpTool("list_pages", { type: "analysis", limit: 4, sort: "updated_desc" }),
      this.callMcpTool("list_pages", { limit: 8, sort: "updated_desc" })
    ]);
    const pageRefs = uniqueMcpRefs(batches.flatMap(parseMcpItems))
      .filter((item) => !String(item.slug ?? "").startsWith("email/"))
      .slice(0, 8);

    const pageBodies = await Promise.all(pageRefs.map((item) => this.callMcpTool("get_page", { slug: String(item.slug) })));
    const pages = pageBodies.flatMap(parseMcpItems).map(coerceContextItem).filter(Boolean) as GBrainContextItem[];
    return pages.length > 0
      ? pages
      : pageRefs.map(coerceContextItem).filter(Boolean) as GBrainContextItem[];
  }

  private async callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.mcpBridgePath) return [];

    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "splay", version: "0.1.0" }
      }
    };
    const call = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args }
    };

    try {
      const stdout = await runMcpBridge(this.mcpBridgePath, `${JSON.stringify(initialize)}\n${JSON.stringify(call)}\n`);
      const responses = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const response = responses.find((item) => item.id === 2);
      const content = ((response?.result as Record<string, unknown> | undefined)?.content as unknown[]) ?? [];
      const text = (content[0] as Record<string, unknown> | undefined)?.text;
      if (typeof text !== "string") return [];
      return JSON.parse(text);
    } catch {
      return [];
    }
  }
}

function runMcpBridge(bridgePath: string, input: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/python3", [bridgePath], {
      stdio: ["pipe", "pipe", "ignore"],
      env: process.env
    });
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve("");
    }, Number(process.env.GBRAIN_MCP_TIMEOUT_MS ?? 20000));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timeout);
      resolve(stdout);
    });
    child.stdin.end(input);
  });
}

function normalizeTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 2 && !["recent", "from", "the", "and", "for"].includes(term));
}

function uniqueById(items: GBrainContextItem[]): GBrainContextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function sortRecentFirst(a: GBrainContextItem, b: GBrainContextItem): number {
  return String(b.date ?? "").localeCompare(String(a.date ?? ""));
}

function coerceContextItem(value: unknown): GBrainContextItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = String(record.title ?? record.name ?? record.slug ?? "Untitled GBrain item");
  const rawSummary = String(record.summary ?? record.chunk_text ?? record.compiled_truth ?? record.content ?? record.text ?? title);
  const summary = publicSafeSummary(rawSummary, title, String(record.type ?? record.kind ?? "gbrain_context"));
  if (!summary) return null;
  const slug = String(record.slug ?? record.reference ?? title);

  return {
    id: String(record.id ?? record.page_id ?? slug),
    title,
    kind: String(record.kind ?? record.type ?? "gbrain_context"),
    summary,
    date: record.date ? String(record.date) : String(record.effective_date ?? record.updated_at ?? record.created_at ?? "") || undefined,
    references: Array.isArray(record.references) ? record.references.map(String) : [slug],
    tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
    sensitivity: Array.isArray(record.sensitivity) ? record.sensitivity.map(String) : undefined
  };
}

function parseMcpItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return [value];
  return [];
}

function uniqueMcpRefs(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.slug ?? item.id ?? item.title ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarize(value: string, limit: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 3).trim()}...`;
}

function publicSafeSummary(value: string, title: string, kind: string): string {
  const cleaned = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\|[^|\n]+(\|[^|\n]+)+\|/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[phone redacted]")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned === title) {
    return `Recent ${kind} context: ${title}. Details are summarized for social planning; raw internal content is withheld.`;
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.length > 24 && !sentence.toLowerCase().includes("transcript"))
    .slice(0, 2)
    .join(" ");
  const base = sentences || cleaned;
  return summarize(`Recent ${kind} context: ${base}`, 520);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
}
