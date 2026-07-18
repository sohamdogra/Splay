import assert from "node:assert/strict";
import test from "node:test";
import { campaignSlots } from "./campaignStore.ts";

test("campaign slots preserve the chosen UTC time across weekly occurrences", () => {
  const slots = campaignSlots({
    brief: "Source-backed weekly insight",
    themes: ["handoffs", "trackers"],
    start_at: "2026-08-03T16:30:00.000Z",
    timezone: "America/Los_Angeles",
    interval_weeks: 1,
    occurrences: 4
  });
  assert.deepEqual(slots.map((slot) => slot.theme), ["handoffs", "trackers", "handoffs", "trackers"]);
  assert.equal(slots[3].scheduled_for, "2026-08-24T16:30:00.000Z");
});

test("campaign slots preserve local wall time across daylight saving changes", () => {
  const slots = campaignSlots({
    brief: "Weekly campaign",
    themes: [],
    start_at: "2026-10-26T16:00:00.000Z",
    timezone: "America/Los_Angeles",
    interval_weeks: 1,
    occurrences: 2
  });
  assert.equal(slots[0].scheduled_for, "2026-10-26T16:00:00.000Z");
  assert.equal(slots[1].scheduled_for, "2026-11-02T17:00:00.000Z");
});
