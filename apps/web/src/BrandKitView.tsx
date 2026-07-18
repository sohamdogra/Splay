import { useEffect, useState, type FormEvent } from "react";
import { Check, Database, Palette, Trash2, Type } from "lucide-react";
import type { BrandKit, CompanyContextItem, CreateCompanyContextInput } from "./types";

export function BrandKitView({ brandKit, contextItems = [], onSave, onAddContext, onRemoveContext }: {
  brandKit: BrandKit | null;
  contextItems?: CompanyContextItem[];
  onSave: (kit: BrandKit) => Promise<void>;
  onAddContext?: (input: CreateCompanyContextInput) => Promise<void>;
  onRemoveContext?: (id: string) => Promise<void>;
}) {
  const [kit, setKit] = useState<BrandKit | null>(brandKit);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [contextTitle, setContextTitle] = useState("");
  const [contextKind, setContextKind] = useState("company");
  const [contextSummary, setContextSummary] = useState("");
  const [contextSource, setContextSource] = useState("");
  const [contextTags, setContextTags] = useState("");
  const [contextDate, setContextDate] = useState("");
  const [contextPublicSafe, setContextPublicSafe] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  useEffect(() => setKit(brandKit), [brandKit]);
  if (!kit) return <div className="loading-overlay"><span className="spinner" /> Loading brand kit…</div>;

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setSaved(false); setError("");
    try { await onSave(kit); setSaved(true); window.setTimeout(() => setSaved(false), 1800); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save brand kit."); }
    finally { setSaving(false); }
  };
  const setColor = (key: keyof BrandKit["colors"], value: string) => setKit({ ...kit, colors: { ...kit.colors, [key]: value } });
  const setType = <K extends keyof BrandKit["typography"]>(key: K, value: BrandKit["typography"][K]) => setKit({ ...kit, typography: { ...kit.typography, [key]: value } });
  const addContext = async (event: FormEvent) => {
    event.preventDefault();
    if (!onAddContext) return;
    setContextSaving(true); setError("");
    try {
      await onAddContext({
        title: contextTitle,
        kind: contextKind,
        summary: contextSummary,
        source: contextSource || undefined,
        date: contextDate || undefined,
        tags: contextTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        public_safe: contextPublicSafe
      });
      setContextTitle(""); setContextSummary(""); setContextSource(""); setContextTags(""); setContextDate(""); setContextPublicSafe(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add company context.");
    } finally {
      setContextSaving(false);
    }
  };

  return (
    <section>
      <div className="view-heading brand-heading"><div><h1>Brand & brain</h1><p>Set the identity and source context every generation run can use.</p></div><span className="version-pill">Version {kit.version}</span></div>
      <form className="brand-studio" onSubmit={save}>
        <div className="brand-controls">
          <div className="control-section"><div className="control-title"><Palette /><div><h2>Identity</h2><p>Core brand language and palette</p></div></div>
            <div className="form-grid">
              <label className="field"><span>Brand name</span><input required value={kit.name} onChange={(e) => setKit({ ...kit, name: e.target.value })} /></label>
              <label className="field"><span>Logo URL <small>optional</small></span><input value={kit.logo_url || ""} onChange={(e) => setKit({ ...kit, logo_url: e.target.value || null })} placeholder="https://…" /></label>
              <label className="field full"><span>Tagline</span><input required value={kit.tagline} onChange={(e) => setKit({ ...kit, tagline: e.target.value })} /></label>
            </div>
            <div className="color-grid">{(Object.keys(kit.colors) as Array<keyof BrandKit["colors"]>).map((key) => <label key={key}><span className="color-swatch" style={{ background: kit.colors[key] }}><input type="color" value={kit.colors[key]} onChange={(e) => setColor(key, e.target.value)} /></span><span>{key}<code>{kit.colors[key]}</code></span></label>)}</div>
          </div>
          <div className="control-section"><div className="control-title"><Type /><div><h2>Typography</h2><p>Families, weight, and editorial scale</p></div></div>
            <div className="form-grid">
              <label className="field"><span>Heading family</span><input required value={kit.typography.heading_family} onChange={(e) => setType("heading_family", e.target.value)} /></label>
              <label className="field"><span>Body family</span><input required value={kit.typography.body_family} onChange={(e) => setType("body_family", e.target.value)} /></label>
              <label className="field"><span>Heading weight</span><select value={kit.typography.heading_weight} onChange={(e) => setType("heading_weight", Number(e.target.value))}>{[300,400,500,600,700,800].map((weight) => <option key={weight}>{weight}</option>)}</select></label>
              <label className="field"><span>Body weight</span><select value={kit.typography.body_weight} onChange={(e) => setType("body_weight", Number(e.target.value))}>{[300,400,500,600,700].map((weight) => <option key={weight}>{weight}</option>)}</select></label>
              <label className="field full"><span>Type scale</span><div className="scale-picker">{(["compact", "balanced", "editorial"] as const).map((scale) => <button type="button" className={kit.typography.scale === scale ? "selected" : ""} key={scale} onClick={() => setType("scale", scale)}>{scale}</button>)}</div></label>
            </div>
          </div>
          <div className="control-section"><div className="control-title"><div className="voice-mark">“</div><div><h2>Voice</h2><p>What campaign generation should follow</p></div></div>
            <div className="form-grid"><label className="field full"><span>Audience</span><textarea className="short" required value={kit.audience} onChange={(e) => setKit({ ...kit, audience: e.target.value })} /></label><label className="field full"><span>Tone</span><textarea className="short" required value={kit.tone} onChange={(e) => setKit({ ...kit, tone: e.target.value })} /></label><label className="field full"><span>Positioning</span><textarea className="short" required value={kit.positioning} onChange={(e) => setKit({ ...kit, positioning: e.target.value })} /></label><label className="field full"><span>Avoid <small>one per line</small></span><textarea className="short" value={kit.avoid.join("\n")} onChange={(e) => setKit({ ...kit, avoid: e.target.value.split("\n").filter(Boolean) })} /></label></div>
          </div>
          <div className="studio-save"><span>Saved versions are used by new one-off and campaign generation.</span><button className="primary-pill" disabled={saving}>{saved ? <><Check /> Saved</> : saving ? "Saving…" : "Save brand kit"}</button></div>
          {error && <div className="global-alert">{error}</div>}
        </div>
        <BrandPreview kit={kit} />
      </form>
      <div className="brain-studio">
        <div className="control-title"><Database /><div><h2>Company brain</h2><p>Paste company facts, product notes, customer lessons, and approved source material.</p></div></div>
        <p className="brain-safety-note">Only records explicitly marked public-safe are available to generation. Stored-only records remain visible here but are excluded from prompts.</p>
        <form className="brain-ingest-form" onSubmit={addContext}>
          <div className="form-grid">
            <label className="field"><span>Title</span><input required maxLength={160} value={contextTitle} onChange={(event) => setContextTitle(event.target.value)} placeholder="Product launch note" /></label>
            <label className="field"><span>Type</span><select value={contextKind} onChange={(event) => setContextKind(event.target.value)}><option value="company">Company</option><option value="product">Product</option><option value="customer">Customer</option><option value="founder">Founder</option><option value="market">Market</option><option value="proof">Proof point</option><option value="other">Other</option></select></label>
            <label className="field full"><span>Context</span><textarea required maxLength={4000} value={contextSummary} onChange={(event) => setContextSummary(event.target.value)} placeholder="Paste a concise, self-contained fact or observation. Do not add material from another company's private systems." /></label>
            <label className="field"><span>Source <small>optional</small></span><input maxLength={500} value={contextSource} onChange={(event) => setContextSource(event.target.value)} placeholder="Public URL or internal reference" /></label>
            <label className="field"><span>Date <small>optional</small></span><input type="date" value={contextDate} onChange={(event) => setContextDate(event.target.value)} /></label>
            <label className="field full"><span>Tags <small>comma separated</small></span><input value={contextTags} onChange={(event) => setContextTags(event.target.value)} placeholder="launch, customer, workflow" /></label>
          </div>
          <div className="brain-ingest-footer">
            <label className="creative-check"><input type="checkbox" checked={contextPublicSafe} onChange={(event) => setContextPublicSafe(event.target.checked)} /><span>Approved for public content</span></label>
            <button className="primary-pill" disabled={!onAddContext || contextSaving}>{contextSaving ? "Adding…" : "Add context"}</button>
          </div>
        </form>
        <div className="brain-context-list">
          {contextItems.map((item) => <article className="brain-context-item" key={item.id}>
            <div><span className={item.public_safe ? "context-status public" : "context-status"}>{item.public_safe ? "Public-safe" : "Stored only"}</span><h3>{item.title}</h3><p>{item.summary}</p><small>{[item.kind, item.source, item.date ? new Date(item.date).toLocaleDateString() : "", ...item.tags].filter(Boolean).join(" · ")}</small></div>
            {onRemoveContext && <button type="button" className="icon-button" aria-label={`Delete ${item.title}`} onClick={() => void onRemoveContext(item.id)}><Trash2 /></button>}
          </article>)}
          {contextItems.length === 0 && <div className="empty-state">No company context yet. Add your own source material before using auto generation.</div>}
        </div>
        {error && <div className="global-alert">{error}</div>}
      </div>
    </section>
  );
}

function BrandPreview({ kit }: { kit: BrandKit }) {
  const headingSize = kit.typography.scale === "compact" ? 30 : kit.typography.scale === "balanced" ? 38 : 46;
  return <aside className="brand-preview-wrap"><span className="eyebrow">Live preview</span><div className="brand-preview" style={{ background: kit.colors.background, color: kit.colors.text, borderColor: kit.colors.accent }}><div className="preview-brand">{kit.logo_url ? <img src={kit.logo_url} alt="" /> : <span style={{ background: kit.colors.primary }}>S</span>}<strong>{kit.name}</strong></div><div className="preview-rule" style={{ background: kit.colors.primary }} /><h2 style={{ fontFamily: kit.typography.heading_family, fontWeight: kit.typography.heading_weight, fontSize: headingSize }}>{kit.tagline}</h2><p style={{ fontFamily: kit.typography.body_family, fontWeight: kit.typography.body_weight }}>{kit.positioning}</p><div className="preview-pills"><span style={{ background: kit.colors.primary }}>Primary action</span><span style={{ color: kit.colors.secondary, borderColor: kit.colors.accent }}>Source cited</span></div><div className="preview-colors">{Object.values(kit.colors).map((color) => <i key={color} style={{ background: color }} />)}</div></div><p className="preview-note">Campaign copy uses the voice settings. The visual system is versioned with every generated post.</p></aside>;
}
