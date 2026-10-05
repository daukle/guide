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
  return response.json();
}

async function listWikiPages(repo, ref, { token, fetchImpl }) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/contents/wiki?ref=${ref}`,
    { headers: { ...headers(token), accept: "application/vnd.github+json" } });
  if (!response.ok) return [];
  const entries = await response.json();
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
}

/**
 * Every wiki page of one repository, as { name, text }.
 *
 * A repository with no wiki/ answers with an empty list rather than an error:
 * a plugin that has not written one yet is a gap in the site, not a reason for
 * the build to fail. How many such gaps are tolerable is the caller's call,
 * which is what `maxMissing` in build.mjs is for.
 */
export async function readWiki(repo, ref, options) {
  const names = await listWikiPages(repo, ref, options);
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

async function readExamples(subject, options) {
  const out = [];
  for (const name of subject.examples || []) {
    // An example lives in the plugin's OWN repository so that plugin's CI
    // breaks when it stops working. This only indexes them; nothing is copied
    // here and nothing is re-run.
    // daukle/examples keeps its examples at the ROOT; everywhere else they are
    // under examples/. The manifest records the names either way.
    const prefix = subject.kind === "examples" ? "" : "examples/";
    const about = await options.fetchImpl(
      `https://raw.githubusercontent.com/${subject.repo}/${subject.defaultBranch}` +
      `/${prefix}${name}/ABOUT.md`,
      { headers: { "user-agent": "daukle-guide" } });
    out.push({
      name,
      url: `https://github.com/${subject.repo}/tree/${subject.defaultBranch}/${prefix}${name}`,
      summary: about.ok ? summarise(await about.text()) : "",
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
      pages: await readWiki(subject.repo, subject.defaultBranch, options),
      exampleDetails: await readExamples(subject, options),
    });
  }
  return { manifest, subjects: out };
}
