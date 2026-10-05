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

export async function gather({ token, fetchImpl = fetch, manifestUrl } = {}) {
  const manifest = await readManifest({ url: manifestUrl, token, fetchImpl });
  const options = { token, fetchImpl };

  const subjects = [manifest.core, ...manifest.plugins].filter(Boolean);
  const out = [];
  for (const subject of subjects) {
    out.push({
      ...subject,
      pages: await readWiki(subject.repo, subject.defaultBranch, options),
    });
  }
  return { manifest, subjects: out };
}
