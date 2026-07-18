import { useEffect, useMemo, useState } from "react";
import {
  addCompanyContext,
  ApiError,
  createCampaign,
  decidePost,
  generatePosts,
  generateCampaign,
  getBrandKit,
  getCampaigns,
  getCompanyContext,
  getHealth,
  getJob,
  getJobs,
  getPosts,
  hasApiToken,
  publishApproved,
  removeCompanyContext,
  saveBrandKit,
  schedulePost,
  setApiToken,
  updateCampaignStatus
} from "./api";
import { Composer, FilterPills, JobStrip, PostCard, Sidebar } from "./components";
import { CampaignsView } from "./CampaignsView";
import { BrandKitView } from "./BrandKitView";
import type { BrandKit, Campaign, CompanyContextItem, CreateCampaignInput, CreateCompanyContextInput, Decision, Filter, Health, Job, Platform, ReviewReason, SplayPost, View } from "./types";

const POLL_INTERVAL_MS = 1_200;

function humanizeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Enter your Splay API token in Settings to load private data.";
  if (error instanceof TypeError) return "The Splay API is offline. Start it on port 4173, then try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [posts, setPosts] = useState<SplayPost[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [brandKit, setBrandKitState] = useState<BrandKit | null>(null);
  const [companyContext, setCompanyContext] = useState<CompanyContextItem[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [idea, setIdea] = useState("");
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({ linkedin: true, x: true });
  const [creative, setCreative] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");

  const refreshPosts = async () => {
    const next = await getPosts();
    setPosts([...next].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
  };

  const loadPrivateData = async () => {
    const [nextPosts, jobs, nextCampaigns, nextBrandKit, nextCompanyContext] = await Promise.all([getPosts(), getJobs(), getCampaigns(), getBrandKit(), getCompanyContext()]);
    setPosts([...nextPosts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
    setCampaigns(nextCampaigns);
    setBrandKitState(nextBrandKit);
    setCompanyContext(nextCompanyContext);
    if (nextBrandKit.version < 1) setView("brand-kit");
    const current = jobs.find((job) => job.status === "queued" || job.status === "running");
    if (current) setActiveJob(current);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextHealth = await getHealth();
        if (cancelled) return;
        setHealth(nextHealth);
        await loadPrivateData();
      } catch (caught) {
        if (cancelled) return;
        setError(humanizeError(caught));
        if (caught instanceof ApiError && caught.status === 401) setView("settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeJob || !["queued", "running"].includes(activeJob.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const nextJob = await getJob(activeJob.id);
        setActiveJob(nextJob);
        if (!["queued", "running"].includes(nextJob.status)) {
          await refreshPosts();
          if (nextJob.kind === "campaign-generate") setCampaigns(await getCampaigns());
        }
      } catch (caught) {
        setError(humanizeError(caught));
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activeJob]);

  const updatePost = (nextPost: SplayPost) => {
    setPosts((current) => current.map((post) => post.id === nextPost.id ? nextPost : post));
  };

  const handleGenerate = async () => {
    setError("");
    try {
      const job = await generatePosts(idea, creative);
      setActiveJob(job);
      setIdea("");
    } catch (caught) {
      setError(humanizeError(caught));
    }
  };

  const handleDecision = async (id: string, decision: Decision, reason: ReviewReason, note?: string) => {
    updatePost(await decidePost(id, decision, reason, note));
  };

  const handleSchedule = async (id: string, value: string) => {
    updatePost(await schedulePost(id, value));
  };

  const handlePublish = async (id: string) => {
    const job = await publishApproved(id, "now");
    setActiveJob(job);
  };

  const handleCreateCampaign = async (input: CreateCampaignInput) => {
    const campaign = await createCampaign(input);
    setCampaigns((current) => [campaign, ...current]);
  };

  const handleGenerateCampaign = async (id: string) => {
    const job = await generateCampaign(id);
    setActiveJob(job);
    setCampaigns((current) => current.map((campaign) => campaign.id === id ? { ...campaign, status: "generating" } : campaign));
  };

  const handleCampaignStatus = async (id: string, status: Campaign["status"]) => {
    const next = await updateCampaignStatus(id, status);
    setCampaigns((current) => current.map((campaign) => campaign.id === id ? next : campaign));
  };

  const handleSaveBrandKit = async (kit: BrandKit) => {
    setBrandKitState(await saveBrandKit(kit));
  };

  const handleAddCompanyContext = async (input: CreateCompanyContextInput) => {
    const item = await addCompanyContext(input);
    setCompanyContext((current) => [item, ...current]);
  };

  const handleRemoveCompanyContext = async (id: string) => {
    await removeCompanyContext(id);
    setCompanyContext((current) => current.filter((item) => item.id !== id));
  };

  const saveToken = async () => {
    setApiToken(tokenDraft);
    setError("");
    setLoading(true);
    try {
      await loadPrivateData();
      setTokenDraft("");
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setLoading(false);
    }
  };

  const reviewPosts = useMemo(() => posts.filter((post) => ["draft", "approved", "staged"].includes(post.status)), [posts]);
  const counts = useMemo<Record<Filter, number>>(() => ({
    all: reviewPosts.length,
    draft: reviewPosts.filter((post) => post.status === "draft").length,
    approved: reviewPosts.filter((post) => post.status === "approved").length,
    staged: reviewPosts.filter((post) => post.status === "staged").length
  }), [reviewPosts]);
  const homePosts = posts.filter((post) => platforms[post.platform]);
  const queuePosts = filter === "all" ? reviewPosts : reviewPosts.filter((post) => post.status === filter);
  const scheduledPosts = posts.filter((post) => post.status === "staged" || (post.status === "approved" && post.scheduled_for));
  const hero = view === "home" && posts.length === 0;
  const busy = Boolean(activeJob && ["queued", "running"].includes(activeJob.status));

  const cards = (visiblePosts: SplayPost[]) => (
    <div className="post-list">
      {visiblePosts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onDecision={handleDecision}
          onSchedule={handleSchedule}
          onPublish={handlePublish}
        />
      ))}
    </div>
  );

  return (
    <div className="app-shell">
      <div className="ray-fan" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      <Sidebar view={view} health={health} onNavigate={setView} />

      <main className={`${hero ? "main-content hero" : "main-content"} view-${view}`}>
        {view === "home" && (
          <section className="home-view">
            {hero && (
              <div className="hero-heading">
                <img src="/assets/splay-logo.svg" alt="" />
                <h1>What should Splay post today?</h1>
              </div>
            )}
            <Composer
              idea={idea}
              platforms={platforms}
              creative={creative}
              busy={busy}
              onIdeaChange={setIdea}
              onTogglePlatform={(platform) => setPlatforms((current) => ({ ...current, [platform]: !current[platform] }))}
              onToggleCreative={() => setCreative((current) => !current)}
              onGenerate={handleGenerate}
            />
            {error && <div className="global-alert" role="alert">{error}</div>}
            {activeJob && <JobStrip job={activeJob} />}
            {!hero && (
              <>
                <div className="section-label">Generated</div>
                {homePosts.length ? cards(homePosts) : <EmptyState>Choose a platform above to see its generated posts.</EmptyState>}
              </>
            )}
          </section>
        )}

        {view === "queue" && (
          <section>
            <div className="view-heading">
              <h1>Review queue</h1>
              <FilterPills filter={filter} counts={counts} onChange={setFilter} />
            </div>
            {error && <div className="global-alert" role="alert">{error}</div>}
            {queuePosts.length ? cards(queuePosts) : <EmptyState>Nothing in review. Generate a draft from New post.</EmptyState>}
          </section>
        )}

        {view === "campaigns" && (
          <CampaignsView
            campaigns={campaigns}
            busy={busy}
            onCreate={handleCreateCampaign}
            onGenerate={handleGenerateCampaign}
            onStatus={handleCampaignStatus}
            onReview={() => { setFilter("all"); setView("queue"); }}
          />
        )}

        {view === "scheduled" && (
          <section>
            <div className="view-heading"><h1>Scheduled</h1></div>
            {scheduledPosts.length ? cards(scheduledPosts) : <EmptyState>Nothing scheduled or queued in Buffer yet.</EmptyState>}
          </section>
        )}

        {view === "analytics" && (
          <section>
            <div className="view-heading"><h1>Analytics</h1></div>
            <div className="info-card">
              <h2>Nothing collected yet</h2>
              <p>Once posts go live, Splay pulls Buffer engagement metrics, scores them, and turns the results into feedback lessons for the next generation run.</p>
              <div className="disabled-actions">
                <button disabled>Collect metrics</button>
                <button disabled>Generate lessons</button>
              </div>
            </div>
          </section>
        )}

        {view === "brand-kit" && <BrandKitView brandKit={brandKit} contextItems={companyContext} onSave={handleSaveBrandKit} onAddContext={handleAddCompanyContext} onRemoveContext={handleRemoveCompanyContext} />}

        {view === "settings" && (
          <section>
            <div className="view-heading"><h1>Settings</h1></div>
            <div className="info-card settings-card">
              <h2>Connections</h2>
              <ConnectionRow ready={Boolean(health?.ok)} name="Splay API" detail={health ? `http://127.0.0.1:4173 · v${health.version}` : "not connected"} />
              <ConnectionRow ready={Boolean(health?.publishing.buffer_configured)} name="Buffer" detail={health?.publishing.buffer_configured ? `configured · ${health.publishing.mode} mode` : "credentials not configured"} />
              <ConnectionRow ready={Boolean(health?.publishing.media_host_configured)} name="Convex media storage" detail={health?.publishing.media_host_configured ? "deployment linked · ingest token set" : "deployment or ingest token missing"} />
              {health?.authentication === "bearer" && (
                <div className="token-panel">
                  <label htmlFor="api-token">Splay API token</label>
                  <div>
                    <input id="api-token" type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder={hasApiToken() ? "Token saved for this tab" : "Paste local API token"} />
                    <button className="primary-pill small" onClick={saveToken} disabled={!tokenDraft || loading}>Save token</button>
                  </div>
                </div>
              )}
              {error && <div className="global-alert" role="alert">{error}</div>}
              <p className="settings-note">Publishing is fail-closed: it requires explicit confirmation plus valid Buffer and Convex configuration.</p>
            </div>
          </section>
        )}

        {loading && <div className="loading-overlay" role="status"><span className="spinner" /> Loading Splay…</div>}
      </main>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

function ConnectionRow({ ready, name, detail }: { ready: boolean; name: string; detail: string }) {
  return (
    <div className="connection-row">
      <span className={ready ? "status-dot ready" : "status-dot"} />
      <strong>{name}</strong>
      <code>{detail}</code>
    </div>
  );
}
