import { test } from "node:test";
import assert from "node:assert/strict";
import { fencesOf, checkSnippets } from "../src/snippets.mjs";

// The property Plan A gave up. It used to work because a page and the file it
// quoted sat in one repository; four pages now live in core and two of them
// quote files in daukle/npm and daukle/java.

const CORE = {
  repo: "daukle/daukle",
  defaultBranch: "main",
  pages: [{ name: "01-first-project.md", text: "" }],
};
const NPM = { repo: "daukle/npm", defaultBranch: "main", pages: [] };

function subjects(pageText) {
  return [{ ...CORE, pages: [{ name: "01-first-project.md", text: pageText }] }, NPM];
}

function stubFetch(files) {
  return async (url) => {
    const path = url.replace("https://raw.githubusercontent.com/", "");
    if (path in files) return { ok: true, status: 200, text: async () => files[path] };
    return { ok: false, status: 404, text: async () => "" };
  };
}

test("a bare path means the page's own repository", () => {
  const [fence] = fencesOf("```toml file=examples/a/daukle.toml\nx = 1\n```", "daukle/daukle");
  assert.equal(fence.repo, "daukle/daukle");
  assert.equal(fence.path, "examples/a/daukle.toml");
  assert.equal(fence.body, "x = 1");
});

test("a qualified path names another repository", () => {
  const [fence] = fencesOf("```toml file=daukle/npm:examples/a/daukle.toml\nx = 1\n```", "daukle/daukle");
  assert.equal(fence.repo, "daukle/npm");
  assert.equal(fence.path, "examples/a/daukle.toml");
});

test("a fence with no file= is prose and is not checked", () => {
  assert.deepEqual(fencesOf("```sh\ndaukle sync\n```", "daukle/daukle"), []);
});

test("a cross-repository quote that matches passes", async () => {
  const result = await checkSnippets(
    subjects("```toml file=daukle/npm:examples/a/daukle.toml\nx = 1\n```"),
    { fetchImpl: stubFetch({ "daukle/npm/main/examples/a/daukle.toml": "x = 1\n" }) });
  assert.deepEqual(result, { checked: 1, problems: [] });
});

test("a quote that drifted by one byte fails, naming both ends", async () => {
  const result = await checkSnippets(
    subjects("```toml file=daukle/npm:examples/a/daukle.toml\nx = 1\n```"),
    { fetchImpl: stubFetch({ "daukle/npm/main/examples/a/daukle.toml": "x = 2\n" }) });
  assert.equal(result.checked, 1);
  assert.deepEqual(result.problems, [
    "daukle/daukle wiki/01-first-project.md:1 no longer matches daukle/npm:examples/a/daukle.toml",
  ]);
});

test("a quoted file that 404s FAILS, and does not read as an empty file", async () => {
  // The shape that would let a fence quoting nothing pass. The old checker in
  // the guide's deleted harness distinguished missing from mismatched, and both
  // have to fail.
  const result = await checkSnippets(
    subjects("```toml file=daukle/npm:examples/gone/daukle.toml\nx = 1\n```"),
    { fetchImpl: stubFetch({}) });
  assert.deepEqual(result.problems, [
    "daukle/daukle wiki/01-first-project.md:1 quotes daukle/npm:examples/gone/daukle.toml, " +
    "which does not exist",
  ]);
});

test("an empty fence quoting an empty file still counts as checked", async () => {
  const result = await checkSnippets(
    subjects("```toml file=daukle/npm:empty\n```"),
    { fetchImpl: stubFetch({ "daukle/npm/main/empty": "" }) });
  assert.deepEqual(result, { checked: 1, problems: [] });
});

test("a quote naming a repository outside the org fails rather than being fetched", async () => {
  const result = await checkSnippets(
    subjects("```toml file=someone/else:a.toml\nx = 1\n```"),
    { fetchImpl: async () => assert.fail("nothing outside the org should be fetched") });
  assert.deepEqual(result.problems, [
    "daukle/daukle wiki/01-first-project.md:1 quotes someone/else:a.toml, " +
    "and someone/else is not in this org",
  ]);
});

test("a file's trailing newline is dropped but a missing last line is not forgiven", async () => {
  const short = await checkSnippets(
    subjects("```toml file=daukle/npm:a.toml\none\n```"),
    { fetchImpl: stubFetch({ "daukle/npm/main/a.toml": "one\ntwo\n" }) });
  assert.equal(short.problems.length, 1);

  const exact = await checkSnippets(
    subjects("```toml file=daukle/npm:a.toml\none\ntwo\n```"),
    { fetchImpl: stubFetch({ "daukle/npm/main/a.toml": "one\ntwo\n" }) });
  assert.deepEqual(exact.problems, []);
});

test("every fence on a page is checked, not only the first", async () => {
  const page = "```toml file=daukle/npm:a.toml\none\n```\n\nprose\n\n" +
               "```json file=daukle/npm:b.json\ntwo\n```";
  const result = await checkSnippets(subjects(page), {
    fetchImpl: stubFetch({ "daukle/npm/main/a.toml": "one\n", "daukle/npm/main/b.json": "WRONG\n" }),
  });
  assert.equal(result.checked, 2);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /b\.json/);
});
