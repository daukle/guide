import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReference, expandReferences } from "../src/references.mjs";
import { checkFreshness } from "../src/freshness.mjs";

const SUBJECTS = [
  {
    id: "daukle", repo: "daukle/daukle", kind: "core", defaultBranch: "main",
    pages: [{ name: "index.md" }, { name: "01-first-project.md" }],
    exampleDetails: [{ name: "daukle-local-plugin" }],
    release: { tag: "0.3.0" },
  },
  {
    id: "gradle", repo: "daukle/gradle", kind: "toolchain", defaultBranch: "main",
    pages: [{ name: "index.md" }],
    exampleDetails: [{ name: "gradle-hello-no-build-file" }],
    release: { tag: "1.0.0" },
  },
  {
    id: "guide", repo: "daukle/guide", kind: "guide", defaultBranch: "main",
    pages: [], exampleDetails: [], release: null,
  },
];

const BASE = "/guide";

test("a bare subject resolves to that subject's page", () => {
  assert.deepEqual(resolveReference("gradle", SUBJECTS, BASE),
                   { href: "/guide/plugins/gradle/", label: "gradle" });
});

test("core resolves to /core/ rather than to /plugins/daukle/", () => {
  assert.deepEqual(resolveReference("daukle", SUBJECTS, BASE),
                   { href: "/guide/core/", label: "daukle" });
});

test("a named page resolves beneath its subject", () => {
  assert.deepEqual(resolveReference("daukle/01-first-project", SUBJECTS, BASE),
                   { href: "/guide/core/01-first-project/", label: "01-first-project" });
});

test("a subject's index is the subject's own page, not a child of it", () => {
  assert.deepEqual(resolveReference("gradle/index", SUBJECTS, BASE),
                   { href: "/guide/plugins/gradle/", label: "gradle" });
});

test("an example resolves to its rendered page", () => {
  assert.deepEqual(resolveReference("example:gradle-hello-no-build-file", SUBJECTS, BASE),
                   { href: "/guide/examples/gradle-hello-no-build-file/", label: "gradle-hello-no-build-file" });
});

test("a page the subject does not carry resolves to nothing", () => {
  assert.equal(resolveReference("gradle/02-advanced", SUBJECTS, BASE), null);
});

test("a subject and an example that do not exist resolve to nothing", () => {
  assert.equal(resolveReference("rust", SUBJECTS, BASE), null);
  assert.equal(resolveReference("example:rust-hello", SUBJECTS, BASE), null);
});

test("an unresolvable reference is a problem naming both ends, and is left intact", () => {
  const { text, problems } = expandReferences(
    "see [[rust]] for more", "daukle/daukle wiki/index.md", SUBJECTS, BASE);
  assert.equal(text, "see [[rust]] for more");
  assert.deepEqual(problems, [
    "daukle/daukle wiki/index.md points at [[rust]], which nothing in this org answers to",
  ]);
});

test("TOML array-of-tables inside a fence is not a reference", () => {
  // [[consumers]] is TOML, and it appears in almost every manifest this org
  // quotes. A scanner that reads fenced blocks reports a plugin nobody wrote.
  const page = "prose\n\n```toml\n[[consumers]]\nid = \"node\"\n```\n\nmore prose";
  const { text, problems } = expandReferences(page, "x", SUBJECTS, BASE);
  assert.deepEqual(problems, []);
  assert.equal(text, page);
});

test("a table name in inline code is not a reference either", () => {
  const { text, problems } = expandReferences(
    "the `[[consumers]]` table says where it goes", "x", SUBJECTS, BASE);
  assert.deepEqual(problems, []);
  assert.equal(text, "the `[[consumers]]` table says where it goes");
});

test("a real reference beside a fence is still expanded", () => {
  const { text, problems } = expandReferences(
    "see [[gradle]]\n\n```toml\n[[consumers]]\n```\n\nand [[gradle]] again",
    "x", SUBJECTS, BASE);
  assert.deepEqual(problems, []);
  assert.equal(text,
    "see [gradle](/guide/plugins/gradle/)\n\n```toml\n[[consumers]]\n```\n\n" +
    "and [gradle](/guide/plugins/gradle/) again");
});

test("every reference on a page is expanded, not only the first", () => {
  const { text, problems } = expandReferences(
    "[[gradle]] needs [[daukle/01-first-project]] and [[example:daukle-local-plugin]]",
    "x", SUBJECTS, BASE);
  assert.equal(text,
    "[gradle](/guide/plugins/gradle/) needs " +
    "[01-first-project](/guide/core/01-first-project/) and " +
    "[daukle-local-plugin](/guide/examples/daukle-local-plugin/)");
  assert.deepEqual(problems, []);
});

test("a coordinate behind the newest release is reported, not failed", () => {
  const { reports, problems } = checkFreshness(SUBJECTS, [
    { where: "gradle-hello", text: 'gradle = { coordinate = "daukle/gradle@^1.0.0" }' },
    { where: "old", text: 'core = { coordinate = "daukle/daukle@^0.1.0" }' },
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(reports, ["daukle/daukle@^0.1.0 is asked for where 0.3.0 is published, in old"]);
});

test("a coordinate no release can satisfy FAILS", () => {
  const { problems } = checkFreshness(SUBJECTS, [
    { where: "ahead", text: 'g = { coordinate = "daukle/gradle@^2.0.0" }' },
  ]);
  assert.deepEqual(problems, ["ahead needs daukle/gradle@^2.0.0, but the newest release is 1.0.0"]);
});

test("a coordinate naming a repository with no release FAILS", () => {
  const { problems } = checkFreshness(SUBJECTS, [
    { where: "nope", text: 'g = { coordinate = "daukle/rust@^1.0.0" }' },
  ]);
  assert.deepEqual(problems,
    ["nope names daukle/rust@^1.0.0, which has no release in this org"]);
});

test("a resolver pinned off the default branch tip is reported", () => {
  const withTip = SUBJECTS.map((s) =>
    (s.id === "daukle" ? { ...s, tip: "b".repeat(40) } : s));
  const { reports, problems } = checkFreshness(withTip, [
    { where: "ex", text: `url = "https://raw.githubusercontent.com/daukle/daukle/${"a".repeat(40)}/plugins/x.lua"` },
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(reports,
    ["daukle/daukle is pinned at aaaaaaa, which is no longer the default branch tip, in ex"]);
});

test("a resolver pinned AT the tip is not reported", () => {
  const withTip = SUBJECTS.map((s) =>
    (s.id === "daukle" ? { ...s, tip: "a".repeat(40) } : s));
  const { reports } = checkFreshness(withTip, [
    { where: "ex", text: `url = "https://raw.githubusercontent.com/daukle/daukle/${"a".repeat(40)}/plugins/x.lua"` },
  ]);
  assert.deepEqual(reports, []);
});

test("one stale pin shared by many examples is reported once, naming them", () => {
  const withTip = SUBJECTS.map((s) => (s.id === "daukle" ? { ...s, tip: "b".repeat(40) } : s));
  const url = `url = "https://raw.githubusercontent.com/daukle/daukle/${"a".repeat(40)}/plugins/x.lua"`;
  const { reports } = checkFreshness(withTip, [
    { where: "one", text: url }, { where: "two", text: url }, { where: "three", text: url },
  ]);
  assert.deepEqual(reports, [
    "daukle/daukle is pinned at aaaaaaa, which is no longer the default branch tip, in 3: one, two, three",
  ]);
});
