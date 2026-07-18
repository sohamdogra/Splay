import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import type { CompanyContextItem } from "../types/index.ts";

export type CreateCompanyContextInput = {
  title: string;
  kind: string;
  summary: string;
  source?: string;
  date?: string;
  tags: string[];
  public_safe: boolean;
};

const brainPath = () => path.join(getOutputDir(), "company-brain.json");

export async function listCompanyContext(): Promise<CompanyContextItem[]> {
  try {
    const parsed = JSON.parse(await readFile(brainPath(), "utf8")) as CompanyContextItem[];
    return parsed.sort((left, right) => right.created_at.localeCompare(left.created_at));
  } catch {
    return [];
  }
}

export async function listPublicCompanyContext(): Promise<CompanyContextItem[]> {
  return (await listCompanyContext()).filter((item) => item.public_safe);
}

export async function addCompanyContext(input: CreateCompanyContextInput): Promise<CompanyContextItem> {
  const now = new Date().toISOString();
  const item: CompanyContextItem = {
    id: randomUUID(),
    ...input,
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    created_at: now,
    updated_at: now
  };
  await writeCompanyContext([item, ...(await listCompanyContext())]);
  return item;
}

export async function removeCompanyContext(id: string): Promise<void> {
  const items = await listCompanyContext();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) throw new Error(`Company context not found: ${id}`);
  await writeCompanyContext(next);
}

async function writeCompanyContext(items: CompanyContextItem[]): Promise<void> {
  await mkdir(getOutputDir(), { recursive: true });
  await writeFile(brainPath(), `${JSON.stringify(items, null, 2)}\n`, "utf8");
}
