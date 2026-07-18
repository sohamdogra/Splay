import assert from "node:assert/strict";
import test from "node:test";
import { selectBestPassingCandidate, selectFirstPassingCandidate } from "./candidateSelector.ts";

test("selects the first QA-passing candidate in declared order", async () => {
  const attempted: number[] = [];
  const selected = await selectFirstPassingCandidate(
    [{ path: "first.png" }, { path: "second.png" }, { path: "third.png" }],
    async (candidate, index) => {
      attempted.push(index);
      if (index === 0) throw new Error("background_text_noise");
      return candidate.path;
    }
  );

  assert.equal(selected.result, "second.png");
  assert.deepEqual(attempted, [0, 1]);
  assert.deepEqual(selected.rejected, ["candidate 1: background_text_noise"]);
});

test("fails closed after every candidate is rejected", async () => {
  await assert.rejects(
    selectFirstPassingCandidate(
      [{ path: "first.png" }, { path: "second.png" }],
      async (_candidate, index) => {
        throw new Error(`failed-${index + 1}`);
      }
    ),
    /All generated background candidates failed visual QA.*failed-1.*failed-2/
  );
});

test("ranks every QA-passing candidate instead of accepting the first pass", async () => {
  const attempted: number[] = [];
  const selected = await selectBestPassingCandidate(
    [{ path: "first.png" }, { path: "second.png" }, { path: "third.png" }],
    async (candidate, index) => {
      attempted.push(index);
      return { path: candidate.path, quality: [4, 9, 7][index] };
    },
    (result) => result.quality
  );

  assert.deepEqual(attempted, [0, 1, 2]);
  assert.equal(selected.result.path, "second.png");
  assert.equal(selected.passingAlternatives, 2);
});
