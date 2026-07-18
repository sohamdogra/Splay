import { useEffect, useState, type FormEvent } from "react";
import { Check, Palette, Type } from "lucide-react";
import type { BrandKit } from "./types";

export function BrandKitView({ brandKit, onSave }: { brandKit: BrandKit | null; onSave: (kit: BrandKit) => Promise<void> }) {
  const [kit, setKit] = useState<BrandKit | null>(brandKit);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
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

  return (
    <section>
      <div className="view-heading brand-heading"><div><h1>Brand kit</h1><p>Define the system every new campaign should sound and look like.</p></div><span className="version-pill">Version {kit.version}</span></div>
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
    </section>
  );
}

function BrandPreview({ kit }: { kit: BrandKit }) {
  const headingSize = kit.typography.scale === "compact" ? 30 : kit.typography.scale === "balanced" ? 38 : 46;
  return <aside className="brand-preview-wrap"><span className="eyebrow">Live preview</span><div className="brand-preview" style={{ background: kit.colors.background, color: kit.colors.text, borderColor: kit.colors.accent }}><div className="preview-brand">{kit.logo_url ? <img src={kit.logo_url} alt="" /> : <span style={{ background: kit.colors.primary }}>S</span>}<strong>{kit.name}</strong></div><div className="preview-rule" style={{ background: kit.colors.primary }} /><h2 style={{ fontFamily: kit.typography.heading_family, fontWeight: kit.typography.heading_weight, fontSize: headingSize }}>{kit.tagline}</h2><p style={{ fontFamily: kit.typography.body_family, fontWeight: kit.typography.body_weight }}>{kit.positioning}</p><div className="preview-pills"><span style={{ background: kit.colors.primary }}>Primary action</span><span style={{ color: kit.colors.secondary, borderColor: kit.colors.accent }}>Source cited</span></div><div className="preview-colors">{Object.values(kit.colors).map((color) => <i key={color} style={{ background: color }} />)}</div></div><p className="preview-note">Campaign copy uses the voice settings. The visual system is versioned with every generated post.</p></aside>;
}
