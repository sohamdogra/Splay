import { readFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import { formatPostText } from "../postText.ts";
import type { GeneratedPost, LinkedInMentionEntity } from "../types/index.ts";

export type LinkedInAnnotation = {
  id: string;
  link: string;
  entity: string;
  vanityName: string;
  localizedName: string;
  start: number;
  length: number;
};

export type LinkedInPublishContent = {
  text: string;
  metadata?: { linkedin: { annotations: LinkedInAnnotation[] } };
  annotations: LinkedInAnnotation[];
  mentionedEntities: string[];
};

export const ARVYA_LINKEDIN_ENTITY: LinkedInMentionEntity = {
  aliases: ["Arvya, Inc.", "Arvya"],
  id: "114174190",
  link: "https://www.linkedin.com/company/arvya-inc",
  entity: "urn:li:organization:114174190",
  vanityName: "arvya-inc",
  localizedName: "Arvya, Inc.",
  kind: "organization"
};

export async function prepareLinkedInPublishContent(post: GeneratedPost): Promise<LinkedInPublishContent> {
  const formatted = formatPostText(post.post_text, post.hashtags);
  if (post.platform !== "linkedin") return { text: formatted, annotations: [], mentionedEntities: [] };

  const registry = await loadLinkedInMentionRegistry(post.linkedin_mentions ?? []);
  const annotated = annotateLinkedInText(formatted, registry);
  return {
    ...annotated,
    ...(annotated.annotations.length > 0 ? { metadata: { linkedin: { annotations: annotated.annotations } } } : {})
  };
}

export function annotateLinkedInText(
  text: string,
  registry: LinkedInMentionEntity[]
): Pick<LinkedInPublishContent, "text" | "annotations" | "mentionedEntities"> {
  const matches = collectMatches(text, registry);
  if (matches.length === 0) return { text, annotations: [], mentionedEntities: [] };

  let cursor = 0;
  let output = "";
  const annotations: LinkedInAnnotation[] = [];
  const mentionedEntities = new Set<string>();

  for (const match of matches) {
    output += text.slice(cursor, match.start);
    const displayText = match.entity.kind === "organization" ? match.entity.localizedName : match.matchedText;
    const start = output.length;
    output += displayText;
    annotations.push({
      id: match.entity.id,
      link: match.entity.link,
      entity: match.entity.entity,
      vanityName: match.entity.vanityName,
      localizedName: match.entity.localizedName,
      start,
      length: displayText.length
    });
    mentionedEntities.add(match.entity.entity);
    cursor = match.end;
  }
  output += text.slice(cursor);

  return { text: output, annotations, mentionedEntities: [...mentionedEntities] };
}

export async function loadLinkedInMentionRegistry(postEntities: LinkedInMentionEntity[] = []): Promise<LinkedInMentionEntity[]> {
  const configuredPath = process.env.LINKEDIN_MENTION_REGISTRY_PATH?.trim();
  const registryPath = configuredPath || path.join(getOutputDir(), "linkedin-mentions.json");
  const fileEntities = await readRegistryFile(registryPath, Boolean(configuredPath));
  const merged = new Map<string, LinkedInMentionEntity>();
  for (const entity of [ARVYA_LINKEDIN_ENTITY, ...fileEntities, ...postEntities]) {
    const normalized = normalizeLinkedInMentionEntity(entity);
    merged.set(normalized.entity, normalized);
  }
  return [...merged.values()];
}

type MentionMatch = {
  start: number;
  end: number;
  matchedText: string;
  entity: LinkedInMentionEntity;
};

function collectMatches(text: string, registry: LinkedInMentionEntity[]): MentionMatch[] {
  const candidates: MentionMatch[] = [];
  for (const entity of registry) {
    const aliases = [...new Set(entity.aliases)].sort((left, right) => right.length - left.length);
    for (const alias of aliases) {
      let from = 0;
      while (from < text.length) {
        const start = text.indexOf(alias, from);
        if (start === -1) break;
        const end = start + alias.length;
        const consumedEnd = entity.kind === "organization" && entity.localizedName.endsWith(".") && text[end] === "." ? end + 1 : end;
        if (hasMentionBoundaries(text, start, end)) candidates.push({ start, end: consumedEnd, matchedText: text.slice(start, consumedEnd), entity });
        from = end;
      }
    }
  }

  candidates.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const selected: MentionMatch[] = [];
  let occupiedUntil = -1;
  for (const candidate of candidates) {
    if (candidate.start < occupiedUntil) continue;
    selected.push(candidate);
    occupiedUntil = candidate.end;
  }
  return selected;
}

function hasMentionBoundaries(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return !isMentionWord(before) && !isMentionWord(after) && before !== "#" && before !== "@";
}

function isMentionWord(value: string): boolean {
  return Boolean(value) && /[\p{L}\p{N}_]/u.test(value);
}

async function readRegistryFile(filePath: string, required: boolean): Promise<LinkedInMentionEntity[]> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const entries = Array.isArray(raw) ? raw : (raw as { entities?: unknown }).entities;
    if (!Array.isArray(entries)) throw new Error("registry must be an array or { entities: [] }");
    return entries.map((entry) => normalizeLinkedInMentionEntity(entry));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!required && code === "ENOENT") return [];
    throw new Error(`Invalid LinkedIn mention registry at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeLinkedInMentionEntity(value: unknown): LinkedInMentionEntity {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const entity = stringField(input.entity);
  const id = stringField(input.id) || entity.split(":").at(-1) || "";
  const localizedName = stringField(input.localizedName ?? input.localized_name);
  const vanityName = stringField(input.vanityName ?? input.vanity_name);
  const link = stringField(input.link);
  const aliases = Array.isArray(input.aliases) ? input.aliases.map(String).map((alias) => alias.trim()).filter(Boolean) : [];
  const kind = input.kind === "person" || entity.includes(":person:") ? "person" : "organization";
  const normalizedAliases = [...new Set([localizedName, ...aliases].filter(Boolean))];

  if (!id || !entity || !entity.endsWith(`:${id}`)) throw new Error("entity and id must identify the same LinkedIn entity");
  if (!/^urn:li:(?:organization|person):/i.test(entity)) throw new Error(`unsupported LinkedIn entity URN: ${entity}`);
  if (!/^https:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(link)) throw new Error(`invalid LinkedIn entity link: ${link}`);
  if (!localizedName || !vanityName || normalizedAliases.length === 0) throw new Error("localizedName, vanityName, and at least one alias are required");

  return { aliases: normalizedAliases, id, link, entity, vanityName, localizedName, kind };
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
