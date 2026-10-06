import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.mjs";

// The renderer suite is pure and never called build(), so when the four narrative
// pages moved into daukle/daukle/wiki/ the build kept reading a local pages/ and
// the site failed on three consecutive runs while every test stayed green. These
// cases exist so that a page source moving again is a red test rather than a red
// deploy.

const MANIFEST_URL = "https://manifest.invalid/plugins.json";

function subject(id, kind, { wikiPages = ["index.md"], examples = [] } = {}) {
  return {
    id,
    repo: `daukle/${id}`,
    kind,
    defaultBranch: "main",
    wikiPages,
    examples,
    release: { tag: "1.0.0", publishedAt: "2026-10-01T00:00:00Z" },
  };
}

function manifestFixture({ coreWikiPages } = {}) {
  return {
    generatedAt: "2026-10-06T00:00:00Z",
    core: { ...subject("daukle", "core", { wikiPages: coreWikiPages ?? [
      "index.md", "01-first-project.md", "02-plugins.md",
    ] }), examples: ["daukle-local-plugin"] },
    plugins: [subject("java", "toolchain", { examples: ["java-hello-jar"] })],
    examples: null,
  };
}

function stubFetch(manifest, files) {
  return async (url) => {
    if (url === MANIFEST_URL) {
      return { ok: true, status: 200, json: async () => manifest };
    }
    const path = url.replace("https://raw.githubusercontent.com/", "");
    if (path in files) return { ok: true, status: 200, text: async () => files[path] };
    return { ok: false, status: 404, text: async () => "" };
  };
}

const FILES = {
  "daukle/daukle/main/wiki/index.md": "# daukle\n\nThe binary.\n",
  "daukle/daukle/main/wiki/01-first-project.md": "# 1. Your first project\n\nBuild one.\n",
  "daukle/daukle/main/wiki/02-plugins.md": "# 2. Plugins\n\nWhere they come from.\n",
  "daukle/daukle/main/examples/daukle-local-plugin/ABOUT.md":
    "# daukle-local-plugin\n\nA plugin that lives in the project.\n",
  "daukle/java/main/wiki/index.md": "# java\n\nThe toolchain.\n",
  "daukle/java/main/examples/java-hello-jar/ABOUT.md":
    "# java-hello-jar\n\nCompiles and jars a program.\n",
};

async function buildInto(manifest, files = FILES) {
  const out = mkdtempSync(join(tmpdir(), "daukle-guide-"));
  const result = await build({
    fetchImpl: stubFetch(manifest, files),
    manifestUrl: MANIFEST_URL,
    out,
    base: "/guide",
  });
  return { out, result, read: (...parts) => readFileSync(join(out, ...parts), "utf8") };
}

test("the narrative pages come from core's wiki and nothing is read off disk", async () => {
  const { read } = await buildInto(manifestFixture());
  const first = read("core", "01-first-project", "index.html");
  assert.match(first, /<h1 id="1-your-first-project">1\. Your first project<\/h1>/);
  assert.match(first, /<title>daukle: 1\. Your first project<\/title>/);
});

test("the guide navigation links core's narrative pages, in order, and not its index", async () => {
  const { read } = await buildInto(manifestFixture());
  const nav = read("index.html").split("<main>")[0];
  const guide = nav.split("<h2>The guide</h2>")[1].split("<h2>")[0];
  assert.match(guide, /href="\/guide\/core\/01-first-project\/">1\. Your first project</);
  assert.match(guide, /href="\/guide\/core\/02-plugins\/">2\. Plugins</);
  assert.ok(guide.indexOf("01-first-project") < guide.indexOf("02-plugins"));
  assert.doesNotMatch(guide, /core\/index\//);
});

test("a core carrying only an index refuses rather than publishing an empty guide", async () => {
  await assert.rejects(
    buildInto(manifestFixture({ coreWikiPages: ["index.md"] })),
    /core carries no wiki page but its index/);
});

test("the examples index names every example and the repository that owns it", async () => {
  const { read } = await buildInto(manifestFixture());
  const examples = read("examples", "index.html");
  assert.match(examples, /daukle-local-plugin/);
  assert.match(examples, /java-hello-jar/);
  assert.match(examples, /A plugin that lives in the project\./);
  assert.match(examples, /the repository of the thing it\ndemonstrates/);
});

test("an examples list of plain names reads the same as one carrying files", async () => {
  // The manifest and this build are published separately, so a site build meets
  // whichever shape the manifest it fetched happens to carry.
  const names = manifestFixture();
  const withFiles = manifestFixture();
  withFiles.core.examples = [{ name: "daukle-local-plugin", files: ["ABOUT.md", "daukle.toml"] }];
  withFiles.plugins[0].examples = [{ name: "java-hello-jar", files: ["ABOUT.md"] }];

  const [a, b] = await Promise.all([buildInto(names), buildInto(withFiles)]);
  assert.equal(a.read("examples", "index.html"), b.read("examples", "index.html"));
  assert.equal(a.read("index.html"), b.read("index.html"));
});

test("nothing the build writes points readers at daukle\\/examples", async () => {
  // Every example now lives in the repository of the thing it demonstrates, so a
  // page still routing readers to the old central repository is a lie the moment
  // that repository is deleted.
  const { read } = await buildInto(manifestFixture());
  for (const page of ["index.html", join("examples", "index.html")]) {
    assert.doesNotMatch(read(page), /github\.com\/daukle\/examples/);
  }
});
