export type Platform = "linkedin" | "x";
export type MediaType = "image" | "video";
export type PostStatus = "draft" | "approved" | "rejected" | "staged" | "posted" | "failed";
export type View = "home" | "campaigns" | "queue" | "scheduled" | "brand-kit" | "analytics" | "settings";
export type Filter = "all" | "draft" | "approved" | "staged" | "posted";
export type Decision = "approve" | "revise" | "reject";

export type ReviewReason =
  | "strong_insight"
  | "strong_proof"
  | "good_voice"
  | "approved_without_note"
  | "too_generic"
  | "unsupported"
  | "different_angle"
  | "visual_not_useful"
  | "too_promotional"
  | "wrong_audience"
  | "repetitive";

export interface ReviewEvent {
  decision: Decision;
  reason: string;
  note?: string;
  decided_at: string;
}

export interface SplayPost {
  id: string;
  platform: Platform;
  topic: string;
  post_text: string;
  hashtags: string[];
  status: PostStatus;
  created_at: string;
  scheduled_for: string | null;
  media_url: string | null;
  animation_media_url?: string | null;
  alt_text: string;
  format_type?: string;
  image_provider?: string;
  warnings?: string[];
  source_context: {
    summary: string;
    gbrain_references: string[];
    why_now: string;
  };
  review_history?: ReviewEvent[];
  editorial_evaluation?: {
    compliance: { passed: boolean; errors: string[]; warnings?: string[] };
    editorial_review: { verdict: "publish" | "revise" | "reject"; rationale?: string[] };
  };
  campaign_id?: string;
  campaign_occurrence?: number;
  brand_kit_version?: number;
}

export interface Job {
  id: string;
  kind: "generate" | "campaign-generate" | "animate-background" | "publish-approved" | "metrics-collect" | "metrics-score" | "feedback-generate";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  metadata?: Record<string, unknown>;
  created_at: string;
  output: string;
  error?: string;
}

export interface CampaignSlot {
  occurrence: number;
  scheduled_for: string;
  theme: string;
}

export interface Campaign {
  id: string;
  name: string;
  brief: string;
  themes: string[];
  platforms: Platform[];
  start_at: string;
  timezone: string;
  interval_weeks: number;
  occurrences: number;
  creative: boolean;
  status: "draft" | "generating" | "active" | "paused" | "completed";
  generated_post_ids: string[];
  created_at: string;
  updated_at: string;
  last_error?: string;
  slots: CampaignSlot[];
}

export interface BrandKit {
  version: number;
  updated_at: string;
  name: string;
  tagline: string;
  audience: string;
  tone: string;
  positioning: string;
  avoid: string[];
  colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  typography: {
    heading_family: string;
    body_family: string;
    heading_weight: number;
    body_weight: number;
    scale: "compact" | "balanced" | "editorial";
  };
  logo_url: string | null;
}

export interface CompanyContextItem {
  id: string;
  title: string;
  kind: string;
  summary: string;
  source?: string;
  date?: string;
  tags: string[];
  public_safe: boolean;
  created_at: string;
  updated_at: string;
}

export type CreateCompanyContextInput = Pick<CompanyContextItem, "title" | "kind" | "summary" | "tags" | "public_safe"> & {
  source?: string;
  date?: string;
};

export type CreateCampaignInput = Pick<Campaign, "name" | "brief" | "themes" | "platforms" | "start_at" | "timezone" | "interval_weeks" | "occurrences" | "creative">;

export interface Health {
  ok: boolean;
  service: string;
  version: string;
  authentication: "bearer" | "local-only";
  generation: {
    brain: string;
    text: string;
    image: string;
    media?: {
      provider: string;
      configured: boolean;
      text_model?: string;
      image_model: string;
      video_model: string;
    };
  };
  publishing: {
    buffer_configured: boolean;
    media_host: string;
    media_host_configured: boolean;
    mode: string;
  };
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}
