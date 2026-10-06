import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gather } from "./fetch.mjs";
import { renderMarkdown, page, escapeHtml } from "./render.mjs";
import { checkSnippets } from "./snippets.mjs";

// The site publishes at daukle.github.io/guide/, so every link is prefixed unless a
// local build overrides it.
const BASE = process.env.SITE_BASE ?? "/guide";
const OUT = process.env.SITE_OUT ?? "site";

// How many subjects may have no wiki before the build refuses. A site that
// silently publishes with half its plugins missing looks exactly like a site
// for an org with half as many plugins, which is the failure mode the slimefun
// wiki's --max-skipped exists for and the one worth copying.
const MAX_MISSING = Number(process.env.SITE_MAX_MISSING ?? 2);

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function navigation(groups, base) {
  const parts = ['<a class="brand" href="' + base + '/">daukle</a>'];
  for (const [heading, links] of groups) {
    parts.push(`<h2>${escapeHtml(heading)}</h2><ul>`);
    for (const { href, label, note } of links) {
      const suffix = note ? ` <span class="note">${escapeHtml(note)}</span>` : "";
      parts.push(`<li><a href="${base}${href}">${escapeHtml(label)}</a>${suffix}</li>`);
    }
    parts.push("</ul>");
  }
  return parts.join("");
}

/**
 * The narrative pages, which are core's wiki pages other than its index.
 *
 * @implNote this repository holds no content, so there is nothing to read off
 * disk: every page on the site comes from some repository's `wiki/`. Reading a
 * local `pages/` is what broke the site build for three runs after those four
 * pages moved into `daukle/daukle/wiki/`, with the renderer suite still green
 * because nothing in it called build().
 */
function narrativePages(subjects) {
  const core = subjects.find((subject) => subject.kind === "core");
  if (!core) return [];
  return core.pages
    .filter((wikiPage) => wikiPage.name !== "index.md")
    .map((wikiPage) => ({
      slug: wikiPage.name.replace(/\.md$/, ""),
      text: wikiPage.text,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function titleOf(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.*)$/m) || markdown.match(/^##\s+(.*)$/m);
  return heading ? heading[1].trim() : fallback;
}

export async function build({ token, fetchImpl, manifestUrl, out = OUT, base = BASE } = {}) {
  const { manifest, subjects } = await gather({ token, fetchImpl, manifestUrl });

  const snippets = await checkSnippets(subjects, { fetchImpl: fetchImpl ?? fetch });
  if (snippets.problems.length) {
    throw new Error(
      [`${snippets.problems.length} of ${snippets.checked} quoted snippets are wrong:`,
       ...snippets.problems.map((problem) => `  ${problem}`)].join("\n"));
  }

  const missing = subjects.filter((subject) => subject.pages.length === 0);
  if (missing.length > MAX_MISSING) {
    throw new Error(
      `${missing.length} of ${subjects.length} repositories carry no wiki/ ` +
      `(${missing.map((s) => s.id).join(", ")}), which is more than SITE_MAX_MISSING=${MAX_MISSING}. ` +
      `Publishing would look like an org that small.`);
  }

  const pages = narrativePages(subjects);
  if (pages.length === 0) {
    throw new Error(
      "core carries no wiki page but its index, so the site would publish with an empty " +
      "guide section and look like a tool nobody documented.");
  }

  const exampleCount = subjects.reduce(
    (total, subject) => total + (subject.exampleDetails || []).length, 0);
  const groups = [
    ["The guide", pages.map((p) => ({ href: `/core/${p.slug}/`, label: titleOf(p.text, p.slug) }))],
    ["Plugins", subjects.filter((s) => !["core", "examples"].includes(s.kind)).map((s) => ({
      href: `/plugins/${s.id}/`,
      label: s.id,
      note: s.kind,
    }))],
    ["Core", subjects.filter((s) => s.kind === "core").map((s) => ({
      href: `/core/`, label: s.id, note: s.release ? s.release.tag : "unreleased",
    }))],
    ["Everything else", [{ href: "/examples/", label: "Examples", note: String(exampleCount) }]],
  ];
  const nav = navigation(groups, base);

  let written = 0;
  for (const subject of subjects) {
    const prefix = subject.kind === "core" ? ["core"]
      : subject.kind === "examples" ? ["examples", "about"]
      : ["plugins", subject.id];
    for (const wikiPage of subject.pages) {
      const isIndex = wikiPage.name === "index.md";
      const slug = wikiPage.name.replace(/\.md$/, "");
      const { html } = renderMarkdown(wikiPage.text);
      const header = subjectHeader(subject, base);
      const target = isIndex ? [...prefix, "index.html"] : [...prefix, slug, "index.html"];
      write(join(out, ...target),
            page({ title: `${subject.id}: ${titleOf(wikiPage.text, slug)}`,
                   body: header + html, nav, base }));
      written += 1;
    }
  }

  for (const subject of subjects) {
    for (const example of subject.exampleDetails || []) {
      write(join(out, "examples", example.name, "index.html"), page({
        title: example.name,
        body: exampleBody(example, subject, base),
        nav,
        base,
      }));
      written += 1;
    }
  }

  write(join(out, "examples", "index.html"), page({
    title: "Examples",
    body: examplesBody(subjects, base),
    nav,
    base,
  }));
  written += 1;

  write(join(out, "index.html"), page({
    title: "daukle",
    body: indexBody(manifest, subjects, base),
    nav,
    base,
  }));
  write(join(out, "style.css"), STYLE);
  // GitHub Pages runs Jekyll unless told not to, and Jekyll silently drops any
  // directory beginning with an underscore.
  write(join(out, ".nojekyll"), "");

  return { written: written + 1, subjects: subjects.length, missing: missing.map((s) => s.id),
           snippets: snippets.checked };
}

function subjectHeader(subject, base) {
  const release = subject.release
    ? `<code>${escapeHtml(subject.release.tag)}</code>`
    : "<em>unreleased</em>";
  const count = (subject.exampleDetails || []).length;
  const examples = count ? ` &middot; ${count} example${count === 1 ? "" : "s"}` : "";
  return `<p class="meta"><span class="kind">${escapeHtml(subject.kind)}</span> &middot; ` +
         `<a href="https://github.com/${subject.repo}">${escapeHtml(subject.repo)}</a> &middot; ` +
         `${release}${examples}</p>`;
}

/**
 * Every example in the organization, grouped by the repository that owns it.
 *
 * @implNote this is an INDEX and not a copy. An example lives in its plugin's
 * own repository so that plugin's CI breaks when the example stops working,
 * which is the whole property a central copy would give up.
 */
function examplesBody(subjects, base) {
  const sections = subjects
    .filter((subject) => (subject.exampleDetails || []).length > 0)
    .map((subject) => {
      const rows = subject.exampleDetails.map((example) =>
        `<tr><td><a href="${base}/examples/${example.name}/">` +
        `${escapeHtml(example.name)}</a></td>` +
        `<td>${escapeHtml(example.summary)}</td></tr>`).join("");
      const heading = subject.kind === "core" ? subject.id
        : `<a href="${base}/plugins/${subject.id}/">${escapeHtml(subject.id)}</a>`;
      return `<h2>${heading}</h2>` +
             `<table><thead><tr><th>example</th><th>what it shows</th></tr></thead>` +
             `<tbody>${rows}</tbody></table>`;
    });

  const without = subjects.filter((subject) => (subject.exampleDetails || []).length === 0)
    .map((subject) => subject.id);
  const note = without.length
    ? `<p class="meta">No example, deliberately: ${escapeHtml(without.join(", "))}. ` +
      `A plugin that registers nothing, that is demonstrated by every example using it, or ` +
      `that produces something another toolchain consumes has nothing runnable to show on ` +
      `its own.</p>`
    : "";

  return `<h1>Examples</h1>
<p>Every example in the organization. Each one lives in the repository of the thing it
demonstrates, with no exception, so that repository's own CI breaks when the example stops
working, and each carries an ABOUT.md with a <strong>what this cannot show</strong> section.</p>
${sections.join("")}
${note}`;
}

/**
 * One example, whole: its ABOUT.md and every file beneath it.
 *
 * @implNote the file list comes from the manifest, never from the GitHub
 * contents API. That API is 60 requests an hour shared across the whole runner
 * IP pool and this organization has been bitten by it; raw.githubusercontent,
 * which serves the contents, is not rate limited.
 */
function exampleBody(example, subject, base) {
  const { html } = renderMarkdown(example.about || `# ${example.name}`);
  const shown = example.contents.filter((file) => file.text !== null);
  const listed = example.contents.filter((file) => file.text === null);

  const blocks = shown.map((file) => {
    const cls = file.language ? ` class="language-${escapeHtml(file.language)}"` : "";
    return `<h3 id="${escapeHtml(file.path)}">${escapeHtml(file.path)}</h3>` +
           `<pre><code${cls}>${escapeHtml(file.text)}</code></pre>`;
  }).join("");

  const rest = listed.length
    ? `<p class="meta">Not shown here: ${listed.map((file) =>
        `<a href="${example.url}/${file.path}">${escapeHtml(file.path)}</a>`).join(", ")}.</p>`
    : "";

  const owner = subject.kind === "core" || subject.kind === "examples"
    ? escapeHtml(subject.id)
    : `<a href="${base}/plugins/${subject.id}/">${escapeHtml(subject.id)}</a>`;

  return `<p class="meta">example &middot; ${owner} &middot; ` +
         `<a href="${example.url}">${escapeHtml(subject.repo)}</a></p>
${html}
<h2>Every file in it</h2>
${blocks}
${rest}`;
}

function indexBody(manifest, subjects, base) {
  const rows = subjects.filter((s) => !["core", "examples"].includes(s.kind)).map((s) =>
    `<tr><td><a href="${base}/plugins/${s.id}/">${escapeHtml(s.id)}</a></td>` +
    `<td>${escapeHtml(s.kind)}</td>` +
    `<td>${s.release ? escapeHtml(s.release.tag) : "unreleased"}</td>` +
    `<td>${(s.exampleDetails || []).length || "none"}</td></tr>`).join("");
  const generated = manifest.generatedAt
    ? `<p class="meta">Manifest generated ${escapeHtml(manifest.generatedAt)}.</p>` : "";
  return `<h1>daukle</h1>
<p>A build tool that is only a plugin API. Every ability arrives through a plugin, and this site is
built from every plugin repository in the organization rather than from a list anybody maintains.</p>
<h2>Plugins</h2>
<table><thead><tr><th>plugin</th><th>kind</th><th>release</th><th>examples</th></tr></thead>
<tbody>${rows}</tbody></table>
${generated}`;
}

const STYLE = `:root { --fg:#1b1b1f; --bg:#fff; --muted:#5a5a66; --line:#e3e3e8; --accent:#2f5bd0; }
@media (prefers-color-scheme: dark) {
  :root { --fg:#e6e6ea; --bg:#17171b; --muted:#9a9aa6; --line:#2d2d34; --accent:#89a9f5; }
}
* { box-sizing: border-box; }
body { margin:0; display:flex; min-height:100vh; background:var(--bg); color:var(--fg);
  font:16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.sidebar { width:16rem; flex:0 0 16rem; padding:1.5rem 1rem; border-right:1px solid var(--line); }
.sidebar .brand { font-weight:700; font-size:1.15rem; text-decoration:none; color:var(--fg); }
.sidebar h2 { font-size:.72rem; text-transform:uppercase; letter-spacing:.07em;
  color:var(--muted); margin:1.6rem 0 .4rem; }
.sidebar ul { list-style:none; margin:0; padding:0; }
.sidebar li { margin:.2rem 0; }
.sidebar a { color:var(--accent); text-decoration:none; }
.sidebar a:hover { text-decoration:underline; }
.note { color:var(--muted); font-size:.75rem; }
main { flex:1; padding:2rem clamp(1rem, 4vw, 3rem); max-width:52rem; }
h1,h2,h3,h4 { line-height:1.25; }
code { background:color-mix(in srgb, var(--fg) 8%, transparent); padding:.1em .35em;
  border-radius:4px; font-size:.9em; }
pre { background:color-mix(in srgb, var(--fg) 6%, transparent); padding:1rem;
  border-radius:8px; overflow-x:auto; }
pre code { background:none; padding:0; }
table { border-collapse:collapse; width:100%; margin:1rem 0; }
th,td { border:1px solid var(--line); padding:.45rem .6rem; text-align:left; vertical-align:top; }
.meta { color:var(--muted); font-size:.88rem; }
.kind { text-transform:uppercase; letter-spacing:.06em; font-size:.75rem; }
a { color:var(--accent); }
@media (max-width:720px) { body { flex-direction:column; }
  .sidebar { width:auto; flex:none; border-right:none; border-bottom:1px solid var(--line); } }
`;

async function main() {
  const result = await build({ token: process.env.GITHUB_TOKEN });
  console.log(`wrote ${result.written} pages for ${result.subjects} repositories, ` +
              `and compared ${result.snippets} quoted snippets`);
  if (result.missing.length) console.warn(`no wiki yet: ${result.missing.join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
