import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("src/cli/attachCodexImages.ts");

test("candidate-list attachment selects the first passing background", async () => {
  const outputDir = await setupOutput("arvya-candidate-list-");
  const grayPath = path.join(outputDir, "gray.svg");
  const goodPath = path.join(outputDir, "good.svg");
  const mapPath = path.join(outputDir, "map.json");
  await writeFile(grayPath, grayBackgroundSvg(), "utf8");
  await writeFile(goodPath, campaignBackgroundSvg(), "utf8");
  await writeFile(mapPath, JSON.stringify({
    "candidate-post": {
      candidates: [
        { path: grayPath, prompt: "gray candidate" },
        { path: goodPath, prompt: "approved candidate" }
      ]
    }
  }), "utf8");

  try {
    await execFileAsync(process.execPath, ["--experimental-strip-types", cliPath, "--map", mapPath], { env: testEnv(outputDir) });
    const pack = JSON.parse(await readFile(path.join(outputDir, "post-pack.json"), "utf8")) as {
      posts: Array<{ image_url: string; image_prompt: string; image_notes?: string[]; visual_qa?: { ok: boolean } }>;
    };
    assert.equal(pack.posts[0].visual_qa?.ok, true);
    assert.equal(pack.posts[0].image_prompt, "approved candidate");
    assert.match((pack.posts[0].image_notes ?? []).join(" "), /Rejected generated background candidate 1/);
    assert.match(pack.posts[0].image_url, /candidate-post\.png$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("all-fail candidate attachment leaves the post pack and prior image untouched", async () => {
  const outputDir = await setupOutput("arvya-candidate-rollback-");
  const grayPath = path.join(outputDir, "gray.svg");
  const mapPath = path.join(outputDir, "map.json");
  const packPath = path.join(outputDir, "post-pack.json");
  const imagePath = path.join(outputDir, "images", "candidate-post.png");
  await writeFile(grayPath, grayBackgroundSvg(), "utf8");
  await writeFile(mapPath, JSON.stringify({
    "candidate-post": { candidates: [{ path: grayPath }, { path: grayPath }] }
  }), "utf8");
  const beforePack = await readFile(packPath, "utf8");
  const beforeImage = await readFile(imagePath);

  try {
    await assert.rejects(
      execFileAsync(process.execPath, ["--experimental-strip-types", cliPath, "--map", mapPath], { env: testEnv(outputDir) }),
      /All generated background candidates failed visual QA/
    );
    assert.equal(await readFile(packPath, "utf8"), beforePack);
    assert.deepEqual(await readFile(imagePath), beforeImage);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

async function setupOutput(prefix: string): Promise<string> {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await Promise.all(["images", "canva-imports", "drafts"].map((dir) => mkdir(path.join(outputDir, dir), { recursive: true })));
  await writeFile(path.join(outputDir, "images", "candidate-post.png"), Buffer.from("prior-image"));
  await writeFile(path.join(outputDir, "post-pack.json"), `${JSON.stringify(makePack(), null, 2)}\n`, "utf8");
  return outputDir;
}

function testEnv(outputDir: string): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    SOCIAL_AGENT_OUTPUT_DIR: outputDir,
    DATABASE_URL: "",
    OPENAI_API_KEY: ""
  };
  delete env.SOCIAL_AGENT_TEST_MODE;
  return env;
}

function makePack() {
  return {
    generated_at: "2026-07-09T00:00:00.000Z",
    brand: { name: "Arvya", audience: "deal teams", tone: "direct", positioning: "", avoid: [] },
    discovered_themes: [],
    publish_logs: [],
    posts: [{
      id: "candidate-post",
      source_context: { summary: "Context", gbrain_references: [], why_now: "" },
      platform: "linkedin",
      topic: "Keep buyer trackers current",
      post_text: "A concrete test post.",
      image_prompt: "prior prompt",
      image_url: "images/candidate-post.png",
      image_provider: "codex-imagegen",
      canva_design_url: null,
      alt_text: "Prior image",
      hashtags: ["InvestmentBanking", "DealWorkflow", "DealTechnology"],
      status: "draft",
      created_at: "2026-07-09T00:00:00.000Z",
      scheduled_for: null,
      quality_score: { hook: 8, clarity: 8, brand_fit: 8, platform_fit: 8, overall: 8 },
      warnings: [],
      image_copy: { headline: "Keep trackers current", support: "Review email changes before Excel writeback" },
      visual: {
        template_family: "dark-editorial-thesis",
        density: "simple",
        palette: "charcoal",
        motif: "citation-rail",
        brief: {
          content_mode: "thesis",
          headline: "Keep trackers current",
          supporting_text: "Review email changes before Excel writeback",
          points: [],
          steps: [],
          contrast: null,
          source_cue: "",
          validation_status: "validated"
        }
      }
    }]
  };
}

function grayBackgroundSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#777777"/></svg>`;
}

function campaignBackgroundSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <rect width="1200" height="675" fill="#020D20"/>
    <rect x="900" y="160" width="250" height="110" rx="18" fill="#0B2946" stroke="#287AB0" stroke-width="3"/>
    <path d="M-80 545 C210 430 470 640 760 535 S1080 450 1280 510" fill="none" stroke="#35A9F2" stroke-width="18"/>
    <path d="M-100 600 C180 500 490 665 780 585 S1090 515 1290 560" fill="none" stroke="#D5A03E" stroke-width="9"/>
  </svg>`;
}
