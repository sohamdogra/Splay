import { listPublicCompanyContext } from "../storage/companyBrainStore.ts";
import type { CompanyContextItem, GBrainContextItem } from "../types/index.ts";

export class CompanyBrainClient {
  async searchCompanyContext(query: string): Promise<GBrainContextItem[]> {
    const items = await this.items();
    const terms = normalizeTerms(query);
    if (terms.length === 0) return items;
    return items.filter((item) => {
      const haystack = `${item.title} ${item.kind} ${item.summary} ${item.tags.join(" ")}`.toLowerCase();
      return terms.some((term) => haystack.includes(term));
    });
  }

  async getRecentUpdates(): Promise<GBrainContextItem[]> {
    return this.items();
  }

  async getRecentCustomerInsights(): Promise<GBrainContextItem[]> {
    return this.byKind(["customer", "case_study", "testimonial"]);
  }

  async getRecentProductNotes(): Promise<GBrainContextItem[]> {
    return this.byKind(["product", "feature", "release"]);
  }

  async getRecentSalesObjections(): Promise<GBrainContextItem[]> {
    return this.byKind(["sales", "objection", "faq"]);
  }

  private async byKind(kinds: string[]): Promise<GBrainContextItem[]> {
    return (await this.items()).filter((item) => kinds.some((kind) => item.kind.toLowerCase().includes(kind)));
  }

  private async items(): Promise<GBrainContextItem[]> {
    return (await listPublicCompanyContext()).map(toRuntimeContext);
  }
}

function toRuntimeContext(item: CompanyContextItem): GBrainContextItem {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    summary: item.summary,
    date: item.date,
    references: [item.source || `brain/${item.id}`],
    tags: item.tags,
    sensitivity: ["public"]
  };
}

function normalizeTerms(query: string): string[] {
  return query.toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 2 && !["recent", "from", "the", "and", "for", "with", "company"].includes(term));
}
