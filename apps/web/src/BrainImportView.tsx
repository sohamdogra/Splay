import { useRef, useState, type DragEvent } from "react";
import { AlertTriangle, Bot, Check, Clipboard, FileJson, Upload } from "lucide-react";
import { BRAIN_IMPORT_SCHEMA, CODING_AGENT_BRAIN_IMPORT_PROMPT, parseBrainImport } from "./brainImport";
import type { BrainImportPayload, BrandKit, CompanyContextItem } from "./types";

const MAX_IMPORT_BYTES = 1_000_000;

export function BrainImportView({ onImport }: {
  onImport?: (payload: BrainImportPayload) => Promise<{ brandKit: BrandKit; imported: CompanyContextItem[] }>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<BrainImportPayload | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [importing, setImporting] = useState(false);

  const stage = (value: string, name = "Pasted agent output") => {
    setError("");
    setStatus("");
    try {
      const parsed = parseBrainImport(value);
      setRaw(value);
      setPreview(parsed);
      setFileName(name);
      setReviewed(false);
    } catch (caught) {
      setPreview(null);
      setReviewed(false);
      setError(caught instanceof Error ? caught.message : "Could not read the brain import.");
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setPreview(null);
      setError("The import file must be smaller than 1 MB.");
      return;
    }
    try {
      stage(await readFileText(file), file.name);
    } catch {
      setPreview(null);
      setError("The dropped file could not be read.");
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files[0]);
  };

  const copyPrompt = async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(CODING_AGENT_BRAIN_IMPORT_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError("Clipboard access was unavailable. Select and copy the prompt manually.");
    }
  };

  const importBrain = async () => {
    if (!preview || !onImport || !reviewed) return;
    setImporting(true);
    setError("");
    setStatus("");
    try {
      const result = await onImport(preview);
      setStatus(`Imported ${result.brandKit.name} and ${result.imported.length} company-brain record${result.imported.length === 1 ? "" : "s"}.`);
      setPreview(null);
      setRaw("");
      setFileName("");
      setReviewed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The brain import could not be completed.");
    } finally {
      setImporting(false);
    }
  };

  const publicSafeCount = preview?.context.filter((item) => item.public_safe).length ?? 0;

  return (
    <section className="brain-import-studio">
      <div className="control-title"><Bot /><div><h2>Quick brain import</h2><p>Turn a project or company folder into Splay’s exact setup format.</p></div></div>
      <div className="brain-import-grid">
        <div className="agent-prompt-card">
          <div className="brain-import-card-heading"><div><span>1</span><strong>Send this to a coding agent</strong></div><button type="button" className="secondary-pill small" onClick={() => void copyPrompt()}>{copied ? <><Check /> Copied</> : <><Clipboard /> Copy prompt</>}</button></div>
          <p>Run the prompt inside the company project or alongside the source material. The agent should return <code>splay-brain-import.json</code>.</p>
          <textarea aria-label="Coding agent brain import prompt" readOnly value={CODING_AGENT_BRAIN_IMPORT_PROMPT} />
        </div>

        <div className="agent-import-card">
          <div className="brain-import-card-heading"><div><span>2</span><strong>Drop the agent output here</strong></div><code>{BRAIN_IMPORT_SCHEMA}</code></div>
          <div
            className={`brain-dropzone${dragging ? " dragging" : ""}`}
            data-testid="brain-import-dropzone"
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <Upload />
            <strong>Drop JSON, text, or Markdown output</strong>
            <span>or click to choose a file · maximum 1 MB</span>
          </div>
          <input ref={fileInput} className="visually-hidden" type="file" accept=".json,.txt,.md,application/json,text/plain,text/markdown" aria-label="Choose brain import file" onChange={(event) => void readFile(event.target.files?.[0])} />
          <div className="brain-paste-divider"><span>or paste the response</span></div>
          <textarea className="brain-import-paste" aria-label="Paste brain import JSON" value={raw} onChange={(event) => { setRaw(event.target.value); setPreview(null); setStatus(""); }} placeholder={'{"schema_version":"splay-brain-import/v1", ...}'} />
          <button type="button" className="secondary-pill brain-review-button" disabled={!raw.trim()} onClick={() => stage(raw)}>Validate and review</button>
        </div>
      </div>

      {preview && (
        <div className="brain-import-preview" aria-live="polite">
          <div className="brain-import-preview-summary">
            <FileJson />
            <div><span>Ready to import · {fileName}</span><h3>{preview.brand_kit.name}</h3><p>{preview.brand_kit.tagline}</p></div>
            <div className="brain-import-counts"><strong>{preview.context.length}</strong><span>brain records</span><strong>{publicSafeCount}</strong><span>public-safe</span></div>
          </div>
          <div className="brain-import-records">
            {preview.context.slice(0, 4).map((item, index) => <span key={`${item.title}-${index}`}><i className={item.public_safe ? "public" : ""} />{item.title}</span>)}
            {preview.context.length > 4 && <span>+ {preview.context.length - 4} more</span>}
          </div>
          {publicSafeCount > 0 && <p className="brain-import-warning"><AlertTriangle /> {publicSafeCount} imported record{publicSafeCount === 1 ? " is" : "s are"} marked for public content. Confirm that the sources and summaries are safe before importing.</p>}
          <div className="brain-import-actions">
            <label className="creative-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the brand fields, sources, and public-safe choices</span></label>
            <button type="button" className="primary-pill" disabled={!onImport || !reviewed || importing} onClick={() => void importBrain()}>{importing ? "Importing…" : "Import brand & brain"}</button>
          </div>
        </div>
      )}
      {error && <div className="global-alert" role="alert">{error}</div>}
      {status && <div className="brain-import-success" role="status"><Check /> {status}</div>}
    </section>
  );
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
    reader.readAsText(file);
  });
}
