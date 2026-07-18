import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const outputDir = await mkdtemp(path.join(tmpdir(), "splay-company-brain-"));
process.env.SOCIAL_AGENT_OUTPUT_DIR = outputDir;

const { addCompanyContext, listCompanyContext, listPublicCompanyContext, removeCompanyContext } = await import("./companyBrainStore.ts");
const { CompanyBrainClient } = await import("../brain/companyBrainClient.ts");

test.after(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

test("uses only explicitly public-safe project context", async () => {
  const privateItem = await addCompanyContext({
    title: "Internal planning note",
    kind: "company",
    summary: "This record must never be sent to a generation provider.",
    tags: ["internal"],
    public_safe: false
  });
  await addCompanyContext({
    title: "Public launch note",
    kind: "product",
    summary: "The company launched a customer-facing reporting feature.",
    source: "https://example.com/launch",
    tags: ["launch"],
    public_safe: true
  });

  assert.equal((await listCompanyContext()).length, 2);
  assert.equal((await listPublicCompanyContext()).length, 1);
  const results = await new CompanyBrainClient().searchCompanyContext("reporting feature");
  assert.equal(results.length, 1);
  assert.equal(results[0].references[0], "https://example.com/launch");

  await removeCompanyContext(privateItem.id);
  assert.equal((await listCompanyContext()).length, 1);
});
