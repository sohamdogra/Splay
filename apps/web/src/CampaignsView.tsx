import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronRight, Pause, Play, Sparkles } from "lucide-react";
import { toDateTimeLocal } from "./api";
import type { Campaign, CreateCampaignInput, Platform } from "./types";

function defaultStart(): string {
  const date = new Date();
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
  date.setHours(9, 0, 0, 0);
  return toDateTimeLocal(date.toISOString());
}

export function CampaignsView({ campaigns, busy, onCreate, onGenerate, onStatus, onReview }: {
  campaigns: Campaign[];
  busy: boolean;
  onCreate: (input: CreateCampaignInput) => Promise<void>;
  onGenerate: (id: string) => Promise<void>;
  onStatus: (id: string, status: Campaign["status"]) => Promise<void>;
  onReview: () => void;
}) {
  const [creating, setCreating] = useState(campaigns.length === 0);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [themes, setThemes] = useState("");
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({ linkedin: true, x: false });
  const [startAt, setStartAt] = useState(defaultStart);
  const [occurrences, setOccurrences] = useState(6);
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [creative, setCreative] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const totalPosts = useMemo(() => occurrences * (Number(platforms.linkedin) + Number(platforms.x)), [occurrences, platforms]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await onCreate({
        name,
        brief,
        themes: themes.split("\n").map((theme) => theme.trim()).filter(Boolean),
        platforms: (Object.keys(platforms) as Platform[]).filter((platform) => platforms[platform]),
        start_at: new Date(startAt).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        interval_weeks: intervalWeeks,
        occurrences,
        creative
      });
      setName("");
      setBrief("");
      setThemes("");
      setCreating(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create campaign.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section>
      <div className="view-heading campaign-heading">
        <div><h1>Campaigns</h1><p>Turn one direction into a reviewable weekly series, scheduled for Buffer.</p></div>
        <button className="primary-pill" onClick={() => setCreating((value) => !value)}>{creating ? "Close builder" : "New campaign"}</button>
      </div>

      {creating && (
        <form className="campaign-builder" onSubmit={submit}>
          <div className="builder-intro"><span className="eyebrow">Campaign direction</span><h2>What should this series own?</h2></div>
          <div className="form-grid">
            <label className="field full"><span>Campaign name</span><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Six weeks of customer stories" /></label>
            <label className="field full"><span>Core brief</span><textarea required maxLength={500} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Explain one useful company insight each week using approved source context." /></label>
            <label className="field full"><span>Weekly themes <small>one per line, recycled if needed</small></span><textarea className="short" value={themes} onChange={(event) => setThemes(event.target.value)} placeholder={"Customer outcomes\nProduct lessons\nFounder perspective"} /></label>
            <div className="field"><span>Platforms</span><div className="platform-selector">
              {(["linkedin", "x"] as Platform[]).map((platform) => <button type="button" key={platform} className={platforms[platform] ? "selected" : ""} onClick={() => setPlatforms((value) => ({ ...value, [platform]: !value[platform] }))}>{platform === "linkedin" ? "in  LinkedIn" : "𝕏  X"}</button>)}
            </div></div>
            <label className="field"><span>First post</span><input type="datetime-local" required value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
            <label className="field"><span>Cadence</span><select value={intervalWeeks} onChange={(event) => setIntervalWeeks(Number(event.target.value))}><option value={1}>Every week</option><option value={2}>Every 2 weeks</option><option value={3}>Every 3 weeks</option><option value={4}>Every 4 weeks</option></select></label>
            <label className="field"><span>Number of weeks</span><input type="number" min={2} max={52} value={occurrences} onChange={(event) => setOccurrences(Number(event.target.value))} /></label>
          </div>
          <div className="builder-footer">
            <label className="creative-check"><input type="checkbox" checked={creative} onChange={(event) => setCreative(event.target.checked)} /><span>✦ Creative visuals</span></label>
            <span className="campaign-summary">Creates {totalPosts} reviewable {totalPosts === 1 ? "draft" : "drafts"} with future schedule times.</span>
            <button className="primary-pill" disabled={pending || busy || !platforms.linkedin && !platforms.x}>{pending ? "Saving…" : "Create campaign"}</button>
          </div>
          {error && <div className="global-alert" role="alert">{error}</div>}
        </form>
      )}

      <div className="campaign-list">
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} busy={busy} onGenerate={onGenerate} onStatus={onStatus} onReview={onReview} />
        ))}
        {!creating && campaigns.length === 0 && <div className="empty-state">No campaigns yet. Build a weekly series to get started.</div>}
      </div>
    </section>
  );
}

function CampaignCard({ campaign, busy, onGenerate, onStatus, onReview }: {
  campaign: Campaign;
  busy: boolean;
  onGenerate: (id: string) => Promise<void>;
  onStatus: (id: string, status: Campaign["status"]) => Promise<void>;
  onReview: () => void;
}) {
  const [error, setError] = useState("");
  const act = async (operation: () => Promise<void>) => {
    setError("");
    try { await operation(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Campaign action failed."); }
  };
  return (
    <article className="campaign-card">
      <header>
        <div className="campaign-icon"><CalendarDays /></div>
        <div><h2>{campaign.name}</h2><p>{campaign.brief}</p></div>
        <span className={`campaign-status ${campaign.status}`}>{campaign.status}</span>
      </header>
      <div className="campaign-meta"><span>{campaign.occurrences} weeks</span><span>Every {campaign.interval_weeks === 1 ? "week" : `${campaign.interval_weeks} weeks`}</span><span>{campaign.platforms.map((platform) => platform === "linkedin" ? "LinkedIn" : "X").join(" + ")}</span><span>{campaign.timezone}</span><span>{campaign.generated_post_ids.length} drafts</span></div>
      <div className="slot-timeline">
        {campaign.slots.slice(0, 8).map((slot) => <div className="campaign-slot" key={slot.occurrence}><span>{slot.occurrence}</span><div><strong>{new Date(slot.scheduled_for).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong><small>{new Date(slot.scheduled_for).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {slot.theme}</small></div></div>)}
        {campaign.slots.length > 8 && <span className="more-slots">+{campaign.slots.length - 8}</span>}
      </div>
      <footer>
        {campaign.status === "draft" && <button className="primary-pill" disabled={busy} onClick={() => void act(() => onGenerate(campaign.id))}><Sparkles /> Generate weekly drafts</button>}
        {campaign.status === "generating" && <span className="generating-label"><span className="spinner" /> Building the weekly series…</span>}
        {(campaign.status === "active" || campaign.status === "paused") && <button className="outline-button" disabled={busy} onClick={() => void act(() => onStatus(campaign.id, campaign.status === "active" ? "paused" : "active"))}>{campaign.status === "active" ? <Pause /> : <Play />}{campaign.status === "active" ? "Pause" : "Resume"}</button>}
        {campaign.generated_post_ids.length > 0 && <button className="text-link" onClick={onReview}>Review campaign posts <ChevronRight /></button>}
      </footer>
      {(error || campaign.last_error) && <div className="global-alert" role="alert">{error || campaign.last_error}</div>}
    </article>
  );
}
