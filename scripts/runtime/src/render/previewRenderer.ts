import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOutputDir } from "../config/runtimeMode.ts";
import { prepareLinkedInPublishContent, type LinkedInPublishContent } from "../linkedin/mentions.ts";
import { countCharacters, formatPostText, X_CHARACTER_LIMIT } from "../postText.ts";
import type { GeneratedPost, PostPack } from "../types/index.ts";

export async function renderPreview(pack: PostPack, outputDir = getOutputDir()): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "latest-preview.html");
  const publishContent = new Map(await Promise.all(pack.posts.map(async (post) => [post.id, await prepareLinkedInPublishContent(post)] as const)));
  await writeFile(filePath, buildHtml(pack, publishContent), "utf8");
  return filePath;
}

function buildHtml(pack: PostPack, publishContent: Map<string, LinkedInPublishContent>): string {
  const grouped = groupByTopic(pack.posts);
  const logsByPost = new Map(pack.publish_logs.map((log) => [log.post_id, log]));
  const approvedCount = pack.posts.filter((post) => post.status === "approved").length;
  const visualCount = new Set(pack.posts.map((post) => post.image_url).filter(Boolean)).size;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Splay Social Review</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #f9fafb;
      --muted: #d3d6d9;
      --subtle: #9ca3af;
      --line: #3a424e;
      --paper: #1f2937;
      --panel: #374151;
      --panel-soft: rgba(37, 42, 49, 0.72);
      --field: #0e1726;
      --accent: #0f5eff;
      --accent-soft: #ffd699;
      --info: #9dd8ff;
      --warn: #ffd699;
      --bad: #ff9f9f;
      --good: #7dd7a5;
      --page-width: 1180px;
      --page-shell-width: calc(var(--page-width) + 48px);
      --page-gutter: 24px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        linear-gradient(rgba(211, 214, 217, 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(211, 214, 217, 0.035) 1px, transparent 1px),
        radial-gradient(circle at 18% 0%, rgba(207, 151, 66, 0.18), transparent 34%),
        radial-gradient(circle at 78% 18%, rgba(211, 214, 217, 0.09), transparent 28%),
        linear-gradient(180deg, #0b1018 0%, var(--paper) 32%, #0b1018 100%);
      background-size: 48px 48px, 48px 48px, auto, auto, auto;
      color: var(--ink);
      font-family: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    header {
      position: relative;
      overflow: hidden;
      padding: 24px var(--page-gutter) 30px;
      border-bottom: 1px solid var(--line);
      background:
        linear-gradient(180deg, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.58)),
        linear-gradient(135deg, #0e1726 0%, #1f2937 55%, #374151 100%);
    }
    header::before {
      content: "";
      position: absolute;
      inset: 106px -4vw auto;
      height: 210px;
      background: #f9fafb;
      clip-path: polygon(0 56%, 9% 44%, 16% 51%, 25% 34%, 34% 44%, 44% 20%, 55% 34%, 63% 18%, 76% 31%, 88% 21%, 100% 36%, 100% 100%, 0 100%);
      opacity: 0.08;
    }
    header::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at 12% 22%, rgba(207, 151, 66, 0.18), transparent 31%);
    }
    .header-row {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      max-width: var(--page-width);
      margin: 0 auto;
    }
    .brand-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 48px;
      padding: 7px 16px 7px 10px;
      border: 1px solid rgba(211, 214, 217, 0.35);
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.18);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
      backdrop-filter: blur(10px);
    }
    .brand-mark {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      color: #ffffff;
    }
    .brand-name {
      font-weight: 700;
      color: var(--ink);
      letter-spacing: 0.04em;
    }
    .brand-divider {
      width: 1px;
      height: 24px;
      background: rgba(211, 214, 217, 0.5);
    }
    .nav-label {
      color: var(--muted);
      font-size: 13px;
      font-weight: 650;
    }
    .hero {
      position: relative;
      z-index: 1;
      max-width: var(--page-width);
      margin: 54px auto 0;
      padding-bottom: 6px;
    }
    main {
      position: relative;
      max-width: var(--page-shell-width);
      margin: 0 auto;
      padding: 32px var(--page-gutter) 64px;
    }
    h1, h2 {
      font-family: Brawler, Georgia, "Times New Roman", serif;
      font-weight: 400;
      letter-spacing: 0;
    }
    h1 {
      max-width: 760px;
      margin: 8px 0 10px;
      font-size: clamp(38px, 7vw, 74px);
      line-height: 1.04;
      text-shadow: 0 16px 32px rgba(0, 0, 0, 0.34);
    }
    h2 { margin: 0; font-size: 27px; line-height: 1.2; }
    h3 { margin: 0 0 12px; font-size: 17px; letter-spacing: 0; }
    p { margin: 0; }
    a { color: var(--accent-soft); }
    strong { color: var(--ink); }
    .eyebrow {
      color: var(--accent-soft);
      font-size: 13px;
      font-weight: 650;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .meta { color: var(--muted); font-size: 14px; }
    .hero .meta { max-width: 720px; color: #e6e7ea; font-size: 16px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      max-width: 560px;
      margin-top: 26px;
    }
    .stat {
      border: 1px solid rgba(211, 214, 217, 0.22);
      border-radius: 8px;
      padding: 14px 16px;
      background: rgba(37, 42, 49, 0.72);
      box-shadow: 0 16px 28px rgba(0, 0, 0, 0.18);
    }
    .stat strong {
      display: block;
      font-family: Brawler, Georgia, "Times New Roman", serif;
      font-size: 28px;
      font-weight: 400;
      line-height: 1;
    }
    .stat span {
      display: block;
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .themes {
      position: relative;
      z-index: 1;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      max-width: var(--page-width);
      margin: 28px auto 0;
    }
    .theme, .pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(37, 42, 49, 0.78);
      color: var(--muted);
      font-size: 13px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 14px;
    }
    .header-actions { margin-top: 4px; justify-content: flex-end; }
    .command {
      display: inline-flex;
      max-width: 100%;
      padding: 7px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: rgba(14, 23, 38, 0.72);
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .idea {
      padding: 30px 0;
      border-bottom: 1px solid var(--line);
    }
    .idea-head {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 20px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    .creative-review {
      display: grid;
      grid-template-columns: minmax(300px, 420px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .creative-review .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.18);
    }
    .card-body { padding: 18px; }
    .image {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      display: block;
      background: var(--field);
      border-bottom: 1px solid var(--line);
    }
    .platform {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .visual-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 14px;
    }
    .draft {
      white-space: pre-wrap;
      font-size: 15px;
      color: #f3f6fa;
      padding: 14px;
      background: rgba(14, 23, 38, 0.68);
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow-wrap: anywhere;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
      color: var(--muted);
      font-size: 13px;
    }
    .full { grid-column: 1 / -1; }
    .score {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
      gap: 8px;
      margin-top: 14px;
    }
    .score div {
      padding: 8px;
      background: rgba(14, 23, 38, 0.72);
      border: 1px solid var(--line);
      border-radius: 6px;
      text-align: center;
      font-size: 12px;
    }
    .score strong { display: block; color: var(--ink); font-size: 16px; }
    .status-draft { color: var(--subtle); }
    .status-rejected { color: var(--bad); }
    .status-approved { color: var(--accent-soft); }
    .status-staged { color: var(--good); }
    .status-posted { color: var(--good); }
    .status-failed { color: var(--bad); }
    .warning {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid rgba(255, 214, 153, 0.52);
      border-radius: 6px;
      background: rgba(207, 151, 66, 0.14);
      color: var(--warn);
      font-size: 13px;
    }
    .note {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid rgba(157, 216, 255, 0.38);
      border-radius: 6px;
      background: rgba(157, 216, 255, 0.1);
      color: var(--info);
      font-size: 13px;
    }
    @media (max-width: 820px) {
      :root { --page-gutter: 16px; }
      header { padding-top: 20px; padding-bottom: 24px; }
      .header-row { flex-direction: column; }
      .header-actions { justify-content: flex-start; }
      .hero { margin-top: 34px; }
      .stats { grid-template-columns: 1fr; }
      main { padding-top: 22px; padding-bottom: 44px; }
      .creative-review { grid-template-columns: 1fr; }
      .cards, .grid { grid-template-columns: 1fr; }
      .idea-head { flex-direction: column; }
      .score { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-row">
      <div class="brand-pill" aria-label="Splay social review">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
            <path d="M16 3.5l2.5 4.1 4.7-1.1.7 4.8 4.4 2-3.5 3.4 2 4.4-4.8.7-1.1 4.7-4.1-2.5-4.1 2.5-1.1-4.7-4.8-.7 2-4.4-3.5-3.4 4.4-2 .7-4.8 4.7 1.1L16 3.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <circle cx="16" cy="16" r="4.6" stroke="currentColor" stroke-width="2"/>
          </svg>
        </span>
        <span class="brand-name">SPLAY</span>
        <span class="brand-divider" aria-hidden="true"></span>
        <span class="nav-label">Social Review</span>
      </div>
      <div class="actions header-actions">
        <span class="pill">Application review</span>
      </div>
    </div>
    <div class="hero">
      <p class="eyebrow">By bankers, for bankers</p>
      <h1>Review the social post pipeline</h1>
      <p class="meta">Generated ${escapeHtml(formatDate(pack.generated_at))} for ${escapeHtml(pack.brand.name)}. Compare the visual, approve platform copy, and keep the final pass grounded in the configured brand voice.</p>
      <div class="stats" aria-label="Generation summary">
        <div class="stat"><strong>${grouped.size}</strong><span>ideas</span></div>
        <div class="stat"><strong>${visualCount}</strong><span>visuals</span></div>
        <div class="stat"><strong>${approvedCount}/${pack.posts.length}</strong><span>approved</span></div>
      </div>
    </div>
    <div class="themes">${pack.discovered_themes.map((theme) => `<span class="theme">${escapeHtml(theme)}</span>`).join("")}</div>
  </header>
  <main>
    ${[...grouped.entries()].map(([topic, posts]) => renderIdea(topic, posts, logsByPost, publishContent)).join("")}
  </main>
</body>
</html>`;
}

function renderIdea(
  topic: string,
  posts: GeneratedPost[],
  logsByPost: Map<string, unknown>,
  publishContent: Map<string, LinkedInPublishContent>
): string {
  const context = posts[0]?.source_context;
  const visualPost = posts.find((post) => post.image_url);
  return `<section class="idea">
    <div class="idea-head">
      <div>
        <h2>${escapeHtml(topic)}</h2>
        <p class="meta">${escapeHtml(context?.why_now ?? "")}</p>
      </div>
      <span class="pill">1 visual + ${posts.length} copy options</span>
    </div>
    <div class="creative-review">
      ${visualPost ? renderSharedVisual(visualPost) : ""}
      <div class="cards">${posts.map((post) => renderPost(post, logsByPost.get(post.id), publishContent.get(post.id), false)).join("")}</div>
    </div>
  </section>`;
}

function renderSharedVisual(post: GeneratedPost): string {
  return `<article class="card visual-card">
    <img class="image" src="${escapeHtml(post.image_url)}" alt="${escapeHtml(post.alt_text)}">
    ${post.animation_background_url ? `<video class="image" controls muted loop playsinline src="${escapeHtml(post.animation_background_url)}"></video>` : ""}
    <div class="card-body">
      <div class="platform">
        <h3>Shared visual</h3>
        <span class="pill">${escapeHtml(post.image_provider)}</span>
      </div>
      ${renderVisualMetadata(post)}
      <p class="meta">Used by the platform copy options for this idea.</p>
      ${post.image_notes?.length ? `<div class="note">${post.image_notes.map(escapeHtml).join("<br>")}</div>` : ""}
      ${post.animation_notes?.length ? `<div class="note">${post.animation_notes.map(escapeHtml).join("<br>")}</div>` : ""}
      <div class="grid">
        <p class="full"><strong>Alt text</strong><br>${escapeHtml(post.alt_text)}</p>
        <p class="full"><strong>Image prompt</strong><br>${escapeHtml(post.image_prompt)}</p>
      </div>
    </div>
  </article>`;
}

function renderPost(post: GeneratedPost, publishLog: unknown, publishContent?: LinkedInPublishContent, includeImage = true): string {
  const log = publishLog as { message?: string; published_url?: string } | undefined;
  const exactPublishedText = publishContent?.text ?? formatPostText(post.post_text, post.hashtags);
  const publishedLength = countCharacters(exactPublishedText);
  const lengthLabel = post.platform === "x" ? `${publishedLength}/${X_CHARACTER_LIMIT} chars` : `${publishedLength} chars`;
  return `<article class="card" data-post-id="${escapeHtml(post.id)}" data-status="${escapeHtml(post.status)}">
    ${includeImage && post.image_url ? `<img class="image" src="${escapeHtml(post.image_url)}" alt="${escapeHtml(post.alt_text)}">` : ""}
    <div class="card-body">
      <div class="platform">
        <h3>${post.platform === "linkedin" ? "LinkedIn" : "X"}</h3>
        <span class="pill status-${post.status}">${escapeHtml(post.status)}</span>
      </div>
      ${includeImage ? renderVisualMetadata(post) : ""}
      <div class="draft">${escapeHtml(exactPublishedText)}</div>
      <div class="actions">${renderPostActions(post)}</div>
      ${post.warnings.length > 0 ? `<div class="warning">${post.warnings.map(escapeHtml).join("<br>")}</div>` : ""}
      ${post.image_notes?.length ? `<div class="note">${post.image_notes.map(escapeHtml).join("<br>")}</div>` : ""}
      ${renderEvaluation(post)}
      <div class="grid">
        ${post.post_intent ? `<p><strong>Editorial intent</strong><br>${escapeHtml(post.post_intent.content_pillar.replace(/_/g, " "))}<br>${escapeHtml(post.post_intent.objective)} · product ${escapeHtml(post.post_intent.product_role)}</p>` : ""}
        ${post.content_fingerprint ? `<p><strong>Conceptual fingerprint</strong><br>${escapeHtml(post.content_fingerprint.pain)}<br>${escapeHtml(post.content_fingerprint.thesis)}<br>${escapeHtml(post.content_fingerprint.product_capability)}</p>` : ""}
        <p><strong>Hashtags</strong><br>${post.hashtags.length ? post.hashtags.map((tag) => `#${escapeHtml(tag.replace(/^#/, ""))}`).join(" ") : "None"}</p>
        <p><strong>Published length</strong><br>${escapeHtml(lengthLabel)}</p>
        ${post.platform === "linkedin" ? `<p><strong>LinkedIn mentions</strong><br>${publishContent?.annotations.length ?? 0} verified annotation(s)</p>` : ""}
        ${includeImage ? `<p><strong>Alt text</strong><br>${escapeHtml(post.alt_text)}</p>` : ""}
        <p><strong>Image provider</strong><br>${escapeHtml(post.image_provider)}${post.canva_design_url ? `<br><a href="${escapeHtml(post.canva_design_url)}">${escapeHtml(post.canva_design_url)}</a>` : ""}</p>
        ${includeImage ? `<p class="full"><strong>Image prompt</strong><br>${escapeHtml(post.image_prompt)}</p>` : ""}
        <p class="full"><strong>Source context</strong><br>${escapeHtml(post.source_context.summary)}</p>
        ${renderEvidence(post)}
        ${renderCandidates(post)}
        ${post.review_history?.length ? `<p class="full"><strong>Review history</strong><br>${post.review_history.map((event) => `${escapeHtml(event.decision)} · ${escapeHtml(event.reason.replace(/_/g, " "))}${event.note ? ` · ${escapeHtml(event.note)}` : ""}`).join("<br>")}</p>` : ""}
        <p class="full"><strong>Company brain sources</strong><br>${post.source_context.gbrain_references.map(escapeHtml).join("<br>") || "No sources available"}</p>
        ${log ? `<p class="full"><strong>Stage result</strong><br>${escapeHtml(log.message ?? "")}${log.published_url ? ` - <a href="${escapeHtml(log.published_url)}">${escapeHtml(log.published_url)}</a>` : ""}</p>` : ""}
      </div>
    </div>
  </article>`;
}

function renderVisualMetadata(post: GeneratedPost): string {
  if (!post.visual) return "";
  return `<div class="visual-meta" aria-label="Visual template metadata">
    <span class="pill">${escapeHtml(post.visual.template_family.replace(/-/g, " "))}</span>
    <span class="pill">${escapeHtml(post.visual.density)}</span>
    <span class="pill">${escapeHtml(post.visual.motif.replace(/-/g, " "))}</span>
  </div>`;
}

function renderEvaluation(post: GeneratedPost): string {
  const evaluation = post.editorial_evaluation;
  if (!evaluation) {
    return `<div class="score">
      <div><strong>${post.quality_score.hook}</strong>Hook lint</div>
      <div><strong>${post.quality_score.clarity}</strong>Clarity lint</div>
      <div><strong>${post.quality_score.brand_fit}</strong>Brand lint</div>
      <div><strong>${post.quality_score.platform_fit}</strong>Platform lint</div>
      <div><strong>${post.quality_score.overall}</strong>Overall lint</div>
    </div>`;
  }
  const editorial = evaluation.editorial_review;
  return `<div class="score">
    <div><strong>${evaluation.compliance.passed ? "PASS" : "FAIL"}</strong>Compliance</div>
    <div><strong>${editorial.source_fidelity}</strong>Evidence</div>
    <div><strong>${editorial.insight_strength}</strong>Insight</div>
    <div><strong>${editorial.specificity}</strong>Specificity</div>
    <div><strong>${editorial.novelty}</strong>Novelty</div>
    <div><strong>${editorial.voice}</strong>Voice</div>
    <div><strong>${editorial.promotion_balance}</strong>Promotion</div>
    <div><strong>${editorial.verdict.toUpperCase()}</strong>Verdict</div>
  </div><div class="note">${editorial.rationale.map(escapeHtml).join("<br>")}</div>`;
}

function renderEvidence(post: GeneratedPost): string {
  const context = post.editorial_context;
  if (!context) return "";
  return `<p class="full"><strong>Evidence packet</strong><br>
    Claim: ${escapeHtml(context.public_safe_claim)}<br>
    Actor/object: ${escapeHtml(context.actor)} · ${escapeHtml(context.concrete_object)}<br>
    Confidence: ${escapeHtml(context.confidence)} · sensitivity: ${escapeHtml(context.sensitivity)}<br>
    ${context.evidence.map((item) => `${escapeHtml(item.source_slug)} — ${escapeHtml(item.excerpt)}`).join("<br>")}
  </p>`;
}

function renderCandidates(post: GeneratedPost): string {
  if (!post.editorial_candidates?.length) return "";
  return `<p class="full"><strong>Editorial tournament</strong><br>${post.editorial_candidates.map((candidate) => `${candidate.selected ? "✓" : "·"} ${escapeHtml(candidate.angle.replace(/_/g, " "))} · ${candidate.score} · ${escapeHtml(candidate.verdict)}<br>${escapeHtml(candidate.hook)}`).join("<br>")}</p>`;
}

function renderPostActions(post: GeneratedPost): string {
  if (post.status === "draft") {
    return `<span class="command">decide --id ${escapeHtml(post.id)} --decision approve --reason strong_insight</span>`;
  }
  if (post.status === "approved") {
    return `<span class="pill status-approved">Ready to queue</span>`;
  }
  if (post.status === "posted") {
    return `<span class="pill status-posted">Posted</span>`;
  }
  if (post.status === "staged") {
    return `<span class="pill status-staged">Staged</span>`;
  }
  if (post.status === "rejected") {
    return `<span class="pill status-rejected">Rejected with feedback</span>`;
  }
  return `<span class="pill status-failed">Failed</span>`;
}

function groupByTopic(posts: GeneratedPost[]): Map<string, GeneratedPost[]> {
  const grouped = new Map<string, GeneratedPost[]>();
  for (const post of posts) {
    grouped.set(post.topic, [...(grouped.get(post.topic) ?? []), post]);
  }
  return grouped;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
