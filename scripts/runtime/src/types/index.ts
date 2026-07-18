export type Platform = "linkedin" | "x";
export type PostStatus = "draft" | "approved" | "rejected" | "staged" | "posted" | "failed";

export type BrandProfile = {
  name: string;
  audience: string;
  tone: string;
  positioning: string;
  avoid: string[];
};

export type GBrainContextItem = {
  id: string;
  title: string;
  kind: string;
  summary: string;
  date?: string;
  references: string[];
  tags: string[];
  sensitivity?: string[];
};

export type SourceContext = {
  summary: string;
  gbrain_references: string[];
  why_now: string;
};

export type EvidenceSourceType = "customer" | "product" | "founder" | "market" | "internal";
export type EvidenceConfidence = "direct" | "corroborated" | "inferred";
export type EvidenceSensitivity = "public" | "redacted" | "internal_only";

export type EvidenceItem = {
  source_slug: string;
  excerpt: string;
  source_type: EvidenceSourceType;
  observed_at?: string;
};

export type EditorialContext = {
  claim: string;
  actor: string;
  concrete_object: string;
  observed_behavior: string;
  audience_pain: string;
  evidence: EvidenceItem[];
  public_safe_claim: string;
  sensitivity: EvidenceSensitivity;
  confidence: EvidenceConfidence;
};

export type ContentPillar =
  | "workflow_observation"
  | "product_proof"
  | "operator_insight"
  | "founder_lesson"
  | "market_point_of_view";
export type PostObjective = "authority" | "education" | "product_understanding" | "conversation";
export type ProductRole = "none" | "supporting" | "central";

export type PostIntent = {
  audience_segment: string;
  content_pillar: ContentPillar;
  objective: PostObjective;
  desired_reader_response: string;
  product_role: ProductRole;
};

export type ContentFingerprint = {
  audience_segment: string;
  pain: string;
  job_to_be_done: string;
  system_or_artifact: string;
  thesis: string;
  proof_type: string;
  product_capability: string;
  hook_shape: string;
  narrative_shape: string;
  cta_shape: string;
};

export type ComplianceReview = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

export type EditorialReview = {
  source_fidelity: number;
  insight_strength: number;
  specificity: number;
  novelty: number;
  voice: number;
  promotion_balance: number;
  verdict: "publish" | "revise" | "reject";
  rationale: string[];
};

export type PlatformReview = {
  native_fit: number;
  readability: number;
  interaction_potential: number;
  rationale: string[];
};

export type EditorialEvaluation = {
  compliance: ComplianceReview;
  editorial_review: EditorialReview;
  platform_review: PlatformReview;
};

export type EditorialAngle = "operator_observation" | "boundary_condition" | "product_proof";

export type EditorialCandidateSummary = {
  id: string;
  angle: EditorialAngle;
  thesis: string;
  reader_takeaway: string;
  product_role: ProductRole;
  hook: string;
  text: string;
  hashtags: string[];
  score: number;
  verdict: EditorialReview["verdict"];
  selected: boolean;
  rationale: string[];
};

export type ReviewDecisionReason =
  | "strong_insight"
  | "strong_proof"
  | "good_voice"
  | "too_generic"
  | "too_promotional"
  | "repetitive"
  | "unsupported"
  | "wrong_audience"
  | "different_angle"
  | "visual_not_useful"
  | "approved_without_note";

export type ReviewEvent = {
  decision: "approve" | "revise" | "reject";
  reason: ReviewDecisionReason;
  note?: string;
  decided_at: string;
  text_snapshot: string;
};

export type VisualTreatment = "editorial_thesis" | "evidence_artifact" | "workflow_explainer" | "product_proof" | "text_only";

export type QualityScore = {
  hook: number;
  clarity: number;
  brand_fit: number;
  platform_fit: number;
  overall: number;
};

export type VisualDensity = "simple" | "structured" | "complex";
export type VisualContentMode = "thesis" | "contrast" | "evidence" | "principles" | "workflow" | "relationship";
export type VisualTemplateFamily =
  | "dark-editorial-thesis"
  | "light-minimal-thesis"
  | "split-contrast"
  | "source-evidence-card"
  | "three-point-principles"
  | "three-step-workflow"
  | "relationship-source-map"
  | "product-proof";
export type VisualPalette = "charcoal" | "mist" | "split";
export type VisualMotif =
  | "citation-rail"
  | "quiet-geometry"
  | "split-plane"
  | "document-fragments"
  | "numbered-stack"
  | "source-trail"
  | "node-map"
  | "product-frame";

export type VisualEvidenceItem = {
  text: string;
  source_excerpt: string;
};

export type VisualBrief = {
  content_mode: VisualContentMode;
  headline: string;
  supporting_text: string;
  points: VisualEvidenceItem[];
  steps: VisualEvidenceItem[];
  contrast: {
    left: VisualEvidenceItem;
    right: VisualEvidenceItem;
  } | null;
  source_cue: string;
  validation_status: "validated" | "extractive_fallback";
};

export type VisualMetadata = {
  template_family: VisualTemplateFamily;
  density: VisualDensity;
  palette: VisualPalette;
  motif: VisualMotif;
  brief: VisualBrief;
};

export type RenderContractTextLayer = {
  id: string;
  role: "label" | "headline" | "body";
  text: string;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  font_family: string;
  font_size: number;
  line_height: number;
  font_weight: number;
  color: string;
  align: "left" | "center";
  letter_spacing: number;
  fits: boolean;
};

export type RenderContract = {
  width: number;
  height: number;
  safe_area: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  template_family: VisualTemplateFamily;
  density: VisualDensity;
  palette: VisualPalette;
  motif: VisualMotif;
  background_image_path: string | null;
  signature: {
    x: number;
    y: number;
    logo_size: number;
    wordmark: string;
    color: string;
    font_family: string;
    font_size: number;
  };
  text_layers: RenderContractTextLayer[];
};

export type VisualQaCheck = {
  name: string;
  ok: boolean;
  message?: string;
  value?: string | number | boolean;
};

export type VisualQaReport = {
  post_id: string;
  ok: boolean;
  checked_at: string;
  png_path: string;
  svg_path: string;
  html_path: string;
  dimensions: {
    width: number;
    height: number;
  };
  pixel_diff: number;
  checks: VisualQaCheck[];
};

export type TopicIdea = {
  id: string;
  topic: string;
  angle: string;
  source_context: SourceContext;
  score: number;
  editorial_context?: EditorialContext;
  post_intent?: PostIntent;
};

export type ImageCopy = {
  headline: string;
  support: string;
};

export type LinkedInMentionEntity = {
  aliases: string[];
  id: string;
  link: string;
  entity: string;
  vanityName: string;
  localizedName: string;
  kind: "organization" | "person";
};

export type GeneratedPost = {
  id: string;
  source_context: SourceContext;
  platform: Platform;
  topic: string;
  generation_model?: string;
  prompt_version?: string;
  hook_type?: string;
  format_type?: string;
  cta_type?: string;
  post_text: string;
  image_prompt: string;
  image_url: string;
  image_provider: "canva" | "gpt-canva" | "placeholder" | "codex-imagegen";
  canva_design_url: string | null;
  alt_text: string;
  hashtags: string[];
  status: PostStatus;
  created_at: string;
  scheduled_for: string | null;
  quality_score: QualityScore;
  warnings: string[];
  image_notes?: string[];
  image_copy?: ImageCopy | null;
  linkedin_mentions?: LinkedInMentionEntity[];
  approved_visual_asset?: string | null;
  visual?: VisualMetadata;
  visual_qa?: VisualQaReport;
  editorial_spec_version?: string;
  editorial_context?: EditorialContext;
  post_intent?: PostIntent;
  content_fingerprint?: ContentFingerprint;
  editorial_evaluation?: EditorialEvaluation;
  editorial_candidates?: EditorialCandidateSummary[];
  review_history?: ReviewEvent[];
  visual_treatment?: VisualTreatment;
};

export type CanvaImageRequest = {
  post_id: string;
  platform: Platform;
  design_type: "facebook_post" | "instagram_post" | "twitter_post";
  title: string;
  canva_query: string;
  visual_style: string[];
  reference_asset_paths: string[];
  background_image_path: string | null;
  canva_import_html: string | null;
  text_layers: {
    wordmark: string;
    headline: string;
    body: string;
  };
  visual?: VisualMetadata;
  alt_text: string;
  local_preview: string;
  local_preview_png: string;
  local_preview_svg: string;
  render_contract: RenderContract;
  qa: VisualQaReport;
};

export type PublishResult = {
  post_id: string;
  ok: boolean;
  publisher: string;
  target_status?: PostStatus;
  buffer_post_ids?: string[];
  published_url?: string;
  message: string;
  payload?: unknown;
  published_at: string;
};

export type PostPack = {
  generated_at: string;
  brand: BrandProfile;
  discovered_themes: string[];
  posts: GeneratedPost[];
  publish_logs: PublishResult[];
  editorial_spec_version?: string;
  content_program?: Record<ContentPillar, number>;
};
