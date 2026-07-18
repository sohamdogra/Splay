import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowUp,
  BarChart3,
  CalendarRange,
  Clock3,
  ListFilter,
  Plus,
  Palette,
  SlidersHorizontal
} from "lucide-react";
import { mediaUrl, toDateTimeLocal } from "./api";
import type { Decision, Filter, Health, Job, Platform, ReviewReason, SplayPost, View } from "./types";

const navItems: Array<{ view: View; label: string; icon: ReactNode }> = [
  { view: "home", label: "New post", icon: <Plus /> },
  { view: "campaigns", label: "Campaigns", icon: <CalendarRange /> },
  { view: "queue", label: "Review queue", icon: <ListFilter /> },
  { view: "scheduled", label: "Scheduled", icon: <Clock3 /> },
  { view: "brand-kit", label: "Brand & brain", icon: <Palette /> },
  { view: "analytics", label: "Analytics", icon: <BarChart3 /> },
  { view: "settings", label: "Settings", icon: <SlidersHorizontal /> }
];

export function Sidebar({ view, health, onNavigate }: {
  view: View;
  health: Health | null;
  onNavigate: (view: View) => void;
}) {
  const ready = Boolean(health?.ok);
  const providers = health
    ? `Buffer ${health.publishing.buffer_configured ? "ready" : "offline"} · Convex ${health.publishing.media_host_configured ? "ready" : "offline"}`
    : "Connecting to local API";

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand-lockup">
        <img src="/assets/splay-logo.svg" alt="" />
        <span className="sidebar-label wordmark">SPLAY</span>
      </div>
      <nav>
        {navItems.map((item) => (
          <button
            type="button"
            key={item.view}
            className={view === item.view ? "nav-item active" : "nav-item"}
            onClick={() => onNavigate(item.view)}
            aria-current={view === item.view ? "page" : undefined}
            title={item.label}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="connection-status" title={providers}>
        <span className={ready ? "status-dot ready" : "status-dot"} />
        <span className="sidebar-label">{ready ? `API ready · ${providers}` : providers}</span>
      </div>
    </aside>
  );
}

export function Composer({
  idea,
  platforms,
  creative,
  busy,
  onIdeaChange,
  onTogglePlatform,
  onToggleCreative,
  onGenerate
}: {
  idea: string;
  platforms: Record<Platform, boolean>;
  creative: boolean;
  busy: boolean;
  onIdeaChange: (value: string) => void;
  onTogglePlatform: (platform: Platform) => void;
  onToggleCreative: () => void;
  onGenerate: () => void;
}) {
  const canSend = (platforms.linkedin || platforms.x) && !busy;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) onGenerate();
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="post-idea">Post idea</label>
      <textarea
        id="post-idea"
        value={idea}
        onChange={(event) => onIdeaChange(event.target.value)}
        placeholder="Describe the idea you want posted — or leave blank to use your company brain…"
        maxLength={500}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) onGenerate();
        }}
      />
      <div className="composer-actions">
        <div className="composer-pills" aria-label="Post preferences">
          <button
            type="button"
            className={platforms.linkedin ? "toggle-pill selected" : "toggle-pill"}
            onClick={() => onTogglePlatform("linkedin")}
            aria-pressed={platforms.linkedin}
            aria-label="LinkedIn"
            title="LinkedIn"
          ><span className="platform-glyph" aria-hidden="true">in</span></button>
          <button
            type="button"
            className={platforms.x ? "toggle-pill selected" : "toggle-pill"}
            onClick={() => onTogglePlatform("x")}
            aria-pressed={platforms.x}
            aria-label="X"
            title="X"
          ><span className="platform-glyph" aria-hidden="true">𝕏</span></button>
          <button
            type="button"
            className={creative ? "toggle-pill creative selected" : "toggle-pill creative"}
            onClick={onToggleCreative}
            aria-pressed={creative}
          >✦ Creative</button>
        </div>
        <span className="mode-hint">{idea.trim() ? "Topic mode" : "Auto · company brain"}</span>
        <button className="send-button" type="submit" disabled={!canSend} aria-label="Generate posts">
          {busy ? <span className="spinner light" /> : <ArrowUp />}
        </button>
      </div>
    </form>
  );
}

export function JobStrip({ job }: { job: Job }) {
  const publishingNow = job.metadata?.mode === "now";
  const generationLabels: Record<Job["status"], string> = {
    queued: "Job queued — jobs run one at a time",
    running: "Generating — editorial tournament, compliance gates, compositor & visual QA",
    succeeded: "Drafts ready — review below",
    failed: job.error || "Generation failed",
    cancelled: "Job cancelled"
  };
  const publishingLabels: Record<Job["status"], string> = {
    queued: "Publishing job queued",
    running: publishingNow ? "Uploading media and publishing through Buffer…" : "Uploading media and scheduling through Buffer…",
    succeeded: publishingNow ? "Posted — Buffer accepted the immediate publish" : "Scheduled in Buffer",
    failed: job.error || "Publishing failed",
    cancelled: "Publishing cancelled"
  };
  const campaignLabels: Record<Job["status"], string> = {
    queued: "Campaign queued — weekly drafts run as one protected job",
    running: "Building campaign — generating and scheduling each weekly post",
    succeeded: "Campaign drafts ready — review before queueing in Buffer",
    failed: job.error || "Campaign generation failed",
    cancelled: "Campaign generation cancelled"
  };
  const label = job.kind === "publish-approved"
    ? publishingLabels[job.status]
    : job.kind === "campaign-generate"
      ? campaignLabels[job.status]
      : generationLabels[job.status];
  const active = job.status === "queued" || job.status === "running";

  return (
    <div className={job.status === "failed" ? "job-strip error" : "job-strip"} role="status">
      {active ? <span className="spinner" /> : <span className={`job-result ${job.status}`} />}
      <span>{label}</span>
      <code>job {job.id.slice(0, 8)} · {job.status}</code>
    </div>
  );
}

const statusPresentation: Record<SplayPost["status"], { label: string; className: string }> = {
  draft: { label: "Draft", className: "draft" },
  approved: { label: "Approved", className: "approved" },
  rejected: { label: "Rejected", className: "rejected" },
  staged: { label: "Queued in Buffer", className: "staged" },
  posted: { label: "Posted", className: "approved" },
  failed: { label: "Failed", className: "rejected" }
};

const reasonOptions: Record<"revise" | "reject", Array<{ label: string; reason: ReviewReason }>> = {
  revise: [
    { label: "too generic", reason: "too_generic" },
    { label: "weak evidence", reason: "unsupported" },
    { label: "different angle", reason: "different_angle" },
    { label: "visual not useful", reason: "visual_not_useful" }
  ],
  reject: [
    { label: "too promotional", reason: "too_promotional" },
    { label: "wrong audience", reason: "wrong_audience" },
    { label: "repetitive", reason: "repetitive" }
  ]
};

function sourceLabel(post: SplayPost): string {
  const reference = post.source_context?.gbrain_references?.[0];
  if (!reference) return post.topic ? "Topic · manual" : "Company brain";
  const filename = reference.split(/[\\/]/).pop() || reference;
  return `Company brain · ${filename}`;
}

export function PostCard({ post, onDecision, onSchedule, onPublish }: {
  post: SplayPost;
  onDecision: (id: string, decision: Decision, reason: ReviewReason, note?: string) => Promise<void>;
  onSchedule: (id: string, value: string) => Promise<void>;
  onPublish: (id: string) => Promise<void>;
}) {
  const [reasonFor, setReasonFor] = useState<"revise" | "reject" | null>(null);
  const [approvalOverride, setApprovalOverride] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [scheduleValue, setScheduleValue] = useState(toDateTimeLocal(post.scheduled_for));
  useEffect(() => setScheduleValue(toDateTimeLocal(post.scheduled_for)), [post.scheduled_for]);

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await operation();
      setReasonFor(null);
      setApprovalOverride(false);
      setApprovalNote("");
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  const lastReview = post.review_history?.at(-1);
  const reviewNote = lastReview && lastReview.decision !== "approve"
    ? (lastReview.note || `${lastReview.decision === "revise" ? "Revision requested" : "Rejected"} · ${lastReview.reason.replaceAll("_", " ")}`)
    : "";
  const status = statusPresentation[post.status];
  const image = mediaUrl(post.media_url);
  const isVideo = post.format_type?.toLowerCase().includes("video");
  const editorialVerdict = post.editorial_evaluation?.editorial_review.verdict;
  const compliancePassed = post.editorial_evaluation?.compliance.passed !== false;

  const startApproval = () => {
    setError("");
    if (!compliancePassed) {
      setError(`This draft cannot be approved because compliance failed: ${post.editorial_evaluation?.compliance.errors.join(" · ") || "review the compliance errors"}.`);
      return;
    }
    if (editorialVerdict === "reject") {
      setError("This draft cannot be approved because the editorial verdict is reject. Revise or regenerate it first.");
      return;
    }
    if (editorialVerdict === "revise") {
      setApprovalOverride(true);
      return;
    }
    void run(() => onDecision(post.id, "approve", "strong_insight"));
  };

  return (
    <article className="post-card" aria-label={`${post.platform === "linkedin" ? "LinkedIn" : "X"} ${status.label} post`}>
      <header className="post-header">
        <span className="platform-badge">{post.platform === "linkedin" ? "in" : "𝕏"}</span>
        <strong>{post.platform === "linkedin" ? "LinkedIn" : "X"}</strong>
        <code>{sourceLabel(post)}</code>
        <span className={`status-pill ${status.className}`}>{status.label}</span>
      </header>

      <div className="post-body">
        <div className="post-copy">
          <p>{post.post_text}</p>
          {post.hashtags?.length > 0 && <div className="hashtags">{post.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ")}</div>}
          {reviewNote && <div className="revision-note">{reviewNote}</div>}
          {error && <div className="revision-note" role="alert">{error}</div>}
        </div>
        <div className="media-slot">
          {image ? <img src={image} alt={post.alt_text || "Generated post artwork"} /> : <span>No media preview</span>}
          {isVideo && <span className="play-badge" aria-label="Video">▶</span>}
        </div>
      </div>

      {post.status === "draft" && !reasonFor && !approvalOverride && (
        <div className="card-actions">
          <button className="action-button approve" disabled={pending} onClick={startApproval}>Approve</button>
          <button className="action-button" disabled={pending} onClick={() => setReasonFor("revise")}>Revise</button>
          <button className="action-button reject" disabled={pending} onClick={() => setReasonFor("reject")}>Reject</button>
        </div>
      )}

      {approvalOverride && (
        <div className="approval-override">
          <div>
            <strong>Approve with an editorial override</strong>
            <span>This draft was marked revise. Explain specifically why it is still ready to publish.</span>
          </div>
          <label>
            <span className="sr-only">Approval override explanation</span>
            <textarea
              value={approvalNote}
              maxLength={2000}
              autoFocus
              onChange={(event) => setApprovalNote(event.target.value)}
              placeholder="The insight is specific and supported by the source; the generic wording is acceptable because…"
            />
          </label>
          <div className="override-actions">
            <button className="action-button approve" disabled={pending || approvalNote.trim().length < 10} onClick={() => void run(() => onDecision(post.id, "approve", "strong_insight", approvalNote))}>Approve override</button>
            <button className="text-button" disabled={pending} onClick={() => { setApprovalOverride(false); setApprovalNote(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {reasonFor && (
        <div className="reason-row">
          <span>Why {reasonFor}?</span>
          {reasonOptions[reasonFor].map((option) => (
            <button key={option.reason} disabled={pending} onClick={() => run(() => onDecision(post.id, reasonFor, option.reason))}>{option.label}</button>
          ))}
          <button className="text-button" onClick={() => setReasonFor(null)}>Cancel</button>
        </div>
      )}

      {post.status === "approved" && !confirming && (
        <div className="approved-actions">
          <button className="primary-pill" disabled={pending} onClick={() => setConfirming(true)}>Post to {post.platform === "linkedin" ? "LinkedIn" : "X"}</button>
          <label>
            <span className="sr-only">Schedule post</span>
            <input
              type="datetime-local"
              value={scheduleValue}
              disabled={pending}
              onChange={(event) => {
                const value = event.target.value;
                setScheduleValue(value);
                void run(() => onSchedule(post.id, value));
              }}
            />
          </label>
          <span className="schedule-help">Empty = publish immediately; choose a time to schedule</span>
        </div>
      )}

      {confirming && (
        <div className="confirm-row">
          <span>{scheduleValue ? `Buffer will schedule this post for ${new Date(post.scheduled_for || "").toLocaleString()}.` : "Buffer will publish this post immediately. Confirm?"}</span>
          <button className="primary-pill small" disabled={pending} onClick={() => run(() => onPublish(post.id))}>Confirm</button>
          <button className="outline-button" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
    </article>
  );
}

export function FilterPills({ filter, counts, onChange }: {
  filter: Filter;
  counts: Record<Filter, number>;
  onChange: (filter: Filter) => void;
}) {
  const filters: Array<[Filter, string]> = [["all", "All"], ["draft", "Drafts"], ["approved", "Approved"], ["staged", "Staged"]];
  return (
    <div className="filter-pills" aria-label="Filter posts">
      {filters.map(([key, label]) => (
        <button key={key} className={filter === key ? "selected" : ""} onClick={() => onChange(key)}>{label} · {counts[key]}</button>
      ))}
    </div>
  );
}
