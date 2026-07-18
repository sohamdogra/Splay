import assert from "node:assert/strict";
import test from "node:test";
import { getOutputDir, isTestMode } from "./runtimeMode.ts";
import { getPrisma, isDatabaseConfigured } from "../db/prisma.ts";

test("test mode isolates output and disables database access", async () => {
  const previousTestMode = process.env.SOCIAL_AGENT_TEST_MODE;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  process.env.SOCIAL_AGENT_TEST_MODE = "1";
  process.env.DATABASE_URL = "postgresql://example.invalid/database";

  try {
    assert.equal(isTestMode(), true);
    assert.equal(getOutputDir(), "output/test");
    assert.equal(isDatabaseConfigured(), false);
    await assert.rejects(getPrisma(), /Database access is disabled/);
  } finally {
    restoreEnv("SOCIAL_AGENT_TEST_MODE", previousTestMode);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
  }
});

test("production mode retains the standard output directory", () => {
  const previousTestMode = process.env.SOCIAL_AGENT_TEST_MODE;
  const previousOutputDir = process.env.SOCIAL_AGENT_OUTPUT_DIR;

  delete process.env.SOCIAL_AGENT_TEST_MODE;
  delete process.env.SOCIAL_AGENT_OUTPUT_DIR;

  try {
    assert.equal(isTestMode(), false);
    assert.equal(getOutputDir(), "output");
  } finally {
    restoreEnv("SOCIAL_AGENT_TEST_MODE", previousTestMode);
    restoreEnv("SOCIAL_AGENT_OUTPUT_DIR", previousOutputDir);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
