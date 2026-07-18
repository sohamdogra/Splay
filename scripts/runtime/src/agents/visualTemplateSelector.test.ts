import assert from "node:assert/strict";
import test from "node:test";
import type { VisualBrief, VisualDensity } from "../types/index.ts";
import { historyEntry, selectVisualMetadata, type VisualHistoryEntry } from "./visualTemplateSelector.ts";

test("keeps the campaign dark while varying families and converging on the adaptive density mix", () => {
  const history: VisualHistoryEntry[] = [];
  for (let index = 0; index < 100; index += 1) {
    const visual = selectVisualMetadata(completeBrief(), `post-${index}`, history, index % 17 === 0 ? "/approved.png" : null);
    if (history.length > 0) assert.notEqual(visual.template_family, history.at(-1)?.template_family);
    assert.equal(visual.palette, "charcoal");
    history.push(historyEntry(`post-${index}`, new Date(2026, 0, index + 1).toISOString(), visual));
  }

  const counts = history.reduce<Record<VisualDensity, number>>((result, entry) => {
    result[entry.density] += 1;
    return result;
  }, { simple: 0, structured: 0, complex: 0 });
  assert.ok(Math.abs(counts.simple / 100 - 0.3) <= 0.06, JSON.stringify(counts));
  assert.ok(Math.abs(counts.structured / 100 - 0.5) <= 0.06, JSON.stringify(counts));
  assert.ok(Math.abs(counts.complex / 100 - 0.2) <= 0.06, JSON.stringify(counts));
  assert.ok(new Set(history.map((entry) => entry.template_family)).size >= 3);
});

test("falls back to simple and evidence families when a brief lacks structured content", () => {
  const brief = { ...completeBrief(), content_mode: "thesis" as const, points: [], steps: [], contrast: null };
  const selected = Array.from({ length: 12 }, (_, index) => index).reduce<VisualHistoryEntry[]>((history, index) => {
    const visual = selectVisualMetadata(brief, `thin-${index}`, history);
    assert.ok(["dark-editorial-thesis", "source-evidence-card"].includes(visual.template_family));
    assert.equal(visual.palette, "charcoal");
    return [...history, historyEntry(`thin-${index}`, new Date().toISOString(), visual)];
  }, []);
  assert.equal(selected.length, 12);
});

function completeBrief(): VisualBrief {
  const items = [
    { text: "Capture the decision trail", source_excerpt: "Capture the decision trail" },
    { text: "Keep open risks visible", source_excerpt: "Keep open risks visible" },
    { text: "Carry context into execution", source_excerpt: "Carry context into execution" }
  ];
  return {
    content_mode: "workflow",
    headline: "Deal context should survive the handoff",
    supporting_text: "Keep the why close to the work.",
    points: items,
    steps: items,
    contrast: {
      left: items[0],
      right: items[1]
    },
    source_cue: "FROM THE WORK",
    validation_status: "validated"
  };
}
