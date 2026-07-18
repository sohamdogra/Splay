import type { ApiEnvelope, BrandKit, Campaign, CompanyContextItem, CreateCampaignInput, CreateCompanyContextInput, Decision, Health, Job, MediaType, Platform, ReviewReason, SplayPost } from "./types";

const API_BASE = (import.meta.env.VITE_SPLAY_API_URL || "").replace(/\/$/, "");
let runtimeToken = sessionStorage.getItem("splay_api_token") || "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function setApiToken(token: string): void {
  runtimeToken = token.trim();
  if (runtimeToken) sessionStorage.setItem("splay_api_token", runtimeToken);
  else sessionStorage.removeItem("splay_api_token");
}

export function hasApiToken(): boolean {
  return Boolean(runtimeToken);
}

async function request<T>(path: string, init: RequestInit = {}, isPublic = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (!isPublic && runtimeToken) headers.set("Authorization", `Bearer ${runtimeToken}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.error;
    throw new ApiError(detail?.message || `Request failed (${response.status})`, response.status, detail?.code);
  }
  return payload as T;
}

export async function getHealth(): Promise<Health> {
  return request<Health>("/api/v1/health", {}, true);
}

export async function getPosts(): Promise<SplayPost[]> {
  const response = await request<ApiEnvelope<SplayPost[]>>("/api/v1/posts");
  return response.data;
}

export async function getJobs(): Promise<Job[]> {
  const response = await request<ApiEnvelope<Job[]>>("/api/v1/jobs");
  return response.data;
}

export async function getCampaigns(): Promise<Campaign[]> {
  const response = await request<ApiEnvelope<Campaign[]>>("/api/v1/campaigns");
  return response.data;
}

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const response = await request<ApiEnvelope<Campaign>>("/api/v1/campaigns", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function generateCampaign(id: string): Promise<Job> {
  const response = await request<ApiEnvelope<Job>>(`/api/v1/campaigns/${encodeURIComponent(id)}/generate`, { method: "POST" });
  return response.data;
}

export async function updateCampaignStatus(id: string, status: Campaign["status"]): Promise<Campaign> {
  const response = await request<ApiEnvelope<Campaign>>(`/api/v1/campaigns/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  return response.data;
}

export async function getBrandKit(): Promise<BrandKit> {
  const response = await request<ApiEnvelope<BrandKit>>("/api/v1/brand-kit");
  return response.data;
}

export async function saveBrandKit(kit: BrandKit): Promise<BrandKit> {
  const { version: _version, updated_at: _updatedAt, ...payload } = kit;
  const response = await request<ApiEnvelope<BrandKit>>("/api/v1/brand-kit", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return response.data;
}

export async function getCompanyContext(): Promise<CompanyContextItem[]> {
  const response = await request<ApiEnvelope<CompanyContextItem[]>>("/api/v1/brain/context");
  return response.data;
}

export async function addCompanyContext(input: CreateCompanyContextInput): Promise<CompanyContextItem> {
  const response = await request<ApiEnvelope<CompanyContextItem>>("/api/v1/brain/context", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return response.data;
}

export async function removeCompanyContext(id: string): Promise<void> {
  await request<unknown>(`/api/v1/brain/context/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getJob(id: string): Promise<Job> {
  const response = await request<ApiEnvelope<Job>>(`/api/v1/jobs/${encodeURIComponent(id)}`);
  return response.data;
}

export async function generatePosts(topic: string, creative: boolean, media: MediaType = "image", platforms: Platform[] = ["linkedin", "x"]): Promise<Job> {
  const trimmed = topic.trim();
  const body = trimmed
    ? { mode: "topic", topic: trimmed, creative, media, platforms }
    : { mode: "auto", creative, media, platforms };
  const response = await request<ApiEnvelope<Job>>("/api/v1/jobs/generate", {
    method: "POST",
    body: JSON.stringify(body)
  });
  return response.data;
}

export async function decidePost(id: string, decision: Decision, reason: ReviewReason, note?: string): Promise<SplayPost> {
  const response = await request<ApiEnvelope<SplayPost>>(`/api/v1/posts/${encodeURIComponent(id)}/decisions`, {
    method: "POST",
    body: JSON.stringify({ decision, reason, ...(note?.trim() ? { note: note.trim() } : {}) })
  });
  return response.data;
}

export async function schedulePost(id: string, localDateTime: string): Promise<SplayPost> {
  const scheduledFor = localDateTime ? new Date(localDateTime).toISOString() : null;
  const response = await request<ApiEnvelope<SplayPost>>(`/api/v1/posts/${encodeURIComponent(id)}/schedule`, {
    method: "PUT",
    body: JSON.stringify({ scheduled_for: scheduledFor })
  });
  return response.data;
}

export async function publishApproved(postId: string, mode: "now" | "queue" = "now"): Promise<Job> {
  const response = await request<ApiEnvelope<Job>>("/api/v1/jobs/publish-approved", {
    method: "POST",
    body: JSON.stringify({ confirm: true, post_id: postId, mode })
  });
  return response.data;
}

export function mediaUrl(path: string | null): string | null {
  if (!path || /^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
