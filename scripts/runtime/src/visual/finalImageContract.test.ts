import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFinalImageContract } from "./finalImageContract.ts";

test("accepts 16:9 dark-blue wave artwork", () => {
  const result = evaluateFinalImageContract(
    { width: 1200, height: 675 },
    "Create a dark navy-blue Splay social card with layered flowing waves and one restrained cobalt accent."
  );
  assert.equal(result.ok, true);
});

test("rejects extra-tall or off-theme artwork", () => {
  const tall = evaluateFinalImageContract(
    { width: 1003, height: 1003 },
    "Create a dark navy-blue Splay social card with layered flowing waves."
  );
  assert.equal(tall.dimensionsOk, false);
  assert.equal(tall.aspectRatioOk, false);
  assert.equal(tall.ok, false);

  const grayGold = evaluateFinalImageContract(
    { width: 1200, height: 675 },
    "Create a gray and gold editorial card with clean geometry."
  );
  assert.equal(grayGold.stylePromptOk, false);
  assert.equal(grayGold.ok, false);

  const merelyProportional = evaluateFinalImageContract(
    { width: 1600, height: 900 },
    "Create a dark navy-blue Splay social card with layered flowing waves."
  );
  assert.equal(merelyProportional.aspectRatioOk, true);
  assert.equal(merelyProportional.dimensionsOk, false);
  assert.equal(merelyProportional.ok, false);
});
