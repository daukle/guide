// Gathering what the site is built from: the org manifest, and every wiki page
// every repository in it carries.
//
// Nothing here is submoduled and nothing is listed by hand. A gitlink is a
// pinned SHA somebody has to maintain, and a hand-written list is wrong the day
// a repository is added.

const MANIFEST =
  "https://raw.githubusercontent.com/daukle/manifest/main/plugins.json";

function headers(token) {
  return {
    "user-agent": "daukle-guide",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function readManifest({ url = MANIFEST, token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: headers(token) });
  if (!response.ok) {
    throw new Error(`the manifest answered ${response.status}; the site would have no plugins`);
  }
  const manifest = await response.json();

  // raw.githubusercontent is CDN cached for a few minutes, so a build run
  // straight after a manifest push reads the PREVIOUS one. Checking the shape
  // turns that into "the manifest is older than this build expects" rather than
  // "no repository carries a wiki", which is what it looked like twice before
  // this check existed.
  const subjects = [manifest.core, ...(manifest.plugins || [])].filter(Boolean);
  if (subjects.length > 0 && subjects.every((s) => s.wikiPages === undefined)) {
    throw new Error(
      "the manifest carries no wikiPages field, so it predates this build. " +
      "raw.githubusercontent caches for a few minutes after a push; wait and retry.");
  }
  return manifest;
}

/**
 * Every wiki page of one repository, as { name, text }.
 *
 * @implNote the page NAMES come from the manifest rather than from a directory
 * listing, and that is what keeps this build off the GitHub API entirely. The
 * contents API is rate limited to 60 an hour unauthenticated and shared across
 * the whole runner IP pool, which this organization has already been bitten by;
 * raw.githubusercontent is not. The manifest is generated with a token, so the
 * one place that must list a directory is the one place that has one.
 *
 * A repository with no wiki/ yields an empty list rather than an error: a plugin
 * that has not written one is a gap in the site, not a reason to fail. How many
 * gaps are tolerable is build.mjs's call.
 */
export async function readWiki(repo, ref, names, options) {
  const pages = [];
  for (const name of names) {
    const response = await options.fetchImpl(
      `https://raw.githubusercontent.com/${repo}/${ref}/wiki/${name}`,
      { headers: headers(options.token) });
    if (!response.ok) continue;
    pages.push({ name, text: await response.text() });
  }
  return pages;
}

/**
 * The first prose sentence of an ABOUT.md, which is what an example calls
 * itself. Headings and bold-only lines are skipped: an ABOUT.md opens with a
 * title and often a bold claim, and neither is the description.
 */
export function summarise(about) {
  for (const block of about.split(/\n{2,}/)) {
    const line = block.trim();
    if (!line || line.startsWith("#") || line.startsWith("|") || line.startsWith("```")) continue;
    const plain = line.replace(/\*\*/g, "").replace(/\s+/g, " ");
    const sentence = plain.match(/^(.+?[.!?])(\s|$)/);
    return sentence ? sentence[1] : plain;
  }
  return "";
}

/**
 * The manifest's examples, as `{ name, files }` whichever shape it carries.
 *
 * @implNote the field was a list of names before the manifest learned to record
 * each example's files, and a published manifest is read by a site build that
 * may be older or newer than it. Normalising here is what lets the two change on
 * their own schedules instead of in one synchronised push.
 */
export function normaliseExamples(subject) {
  return (subject.examples || []).map(
    (example) => (typeof example === "string" ? { name: example, files: [] } : example));
}

/**
 * Which files the site shows inline, by extension.
 *
 * @implNote by extension and never by content: `daukle-wrapper-bootstrap` ships
 * a `daukle` shell script and a `daukle.ps1` beside a `.daukle/wrapper.toml`,
 * and an `expected/` tree may hold anything at all. A file with no language here
 * is listed by name with a link rather than guessed at.
 */
const LANGUAGES = {
  toml: "toml", lua: "lua", json: "json", c: "c", h: "c", cpp: "cpp", java: "java",
  mjs: "javascript", js: "javascript", sh: "sh", ps1: "powershell", md: "markdown",
  gradle: "groovy", txt: "", yml: "yaml", yaml: "yaml",
};

export function languageOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = base.slice(dot + 1).toLowerCase();
  return extension in LANGUAGES ? LANGUAGES[extension] : null;
}

async function readExampleFiles(root, files, options) {
  const out = [];
  for (const path of files) {
    // ABOUT.md is the page's own prose, shown above rather than as one of the
    // files it describes.
    if (path === "ABOUT.md") continue;
    const language = languageOf(path);
    if (language === null) {
      out.push({ path, language: null, text: null });
      continue;
    }
    const response = await options.fetchImpl(`${root}/${path}`,
      { headers: { "user-agent": "daukle-guide" } });
    out.push({ path, language, text: response.ok ? await response.text() : null });
  }
  return out;
}

async function readExamples(subject, options) {
  const out = [];
  for (const { name, files } of normaliseExamples(subject)) {
    // An example lives in the plugin's OWN repository so that plugin's CI
    // breaks when it stops working. This only indexes them; nothing is copied
    // here and nothing is re-run.
    // daukle/examples keeps its examples at the ROOT; everywhere else they are
    // under examples/. The manifest records the names either way.
    const prefix = subject.kind === "examples" ? "" : "examples/";
    const root = `https://raw.githubusercontent.com/${subject.repo}/${subject.defaultBranch}` +
                 `/${prefix}${name}`;
    const about = await options.fetchImpl(`${root}/ABOUT.md`,
      { headers: { "user-agent": "daukle-guide" } });
    const aboutText = about.ok ? await about.text() : "";
    out.push({
      name,
      repo: subject.repo,
      about: aboutText,
      contents: await readExampleFiles(root, files || [], options),
      url: `https://github.com/${subject.repo}/tree/${subject.defaultBranch}/${prefix}${name}`,
      summary: aboutText ? summarise(aboutText) : "",
    });
  }
  return out;
}

export async function gather({ token, fetchImpl = fetch, manifestUrl } = {}) {
  const manifest = await readManifest({ url: manifestUrl, token, fetchImpl });
  const options = { token, fetchImpl };

  // The examples repository is a subject too: it holds every CROSS-plugin example,
  // which by definition belongs to no single plugin.
  const subjects = [manifest.core, ...manifest.plugins, manifest.examples].filter(Boolean);
  const out = [];
  for (const subject of subjects) {
    out.push({
      ...subject,
      pages: await readWiki(subject.repo, subject.defaultBranch,
                            subject.wikiPages || [], options),
      exampleDetails: await readExamples(subject, options),
    });
  }
  return { manifest, subjects: out };
}
