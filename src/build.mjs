import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gather } from "./fetch.mjs";
import { renderMarkdown, page, escapeHtml } from "./render.mjs";

// The site publishes at daukle.github.io/guide/, so every link is prefixed unless a
// local build overrides it.
const BASE = process.env.SITE_BASE ?? "/guide";
const OUT = process.env.SITE_OUT ?? "site";
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

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

function guidePages() {
  const dir = join(ROOT, "pages");
  return readdirSync(dir).filter((name) => name.endsWith(".md")).sort().map((name) => ({
    name,
    slug: name.replace(/^\d+-/, "").replace(/\.md$/, ""),
    text: readFileSync(join(dir, name), "utf8"),
  }));
}

function titleOf(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.*)$/m) || markdown.match(/^##\s+(.*)$/m);
  return heading ? heading[1].trim() : fallback;
}

export async function build({ token, fetchImpl, manifestUrl, out = OUT, base = BASE } = {}) {
  const { manifest, subjects } = await gather({ token, fetchImpl, manifestUrl });

  const missing = subjects.filter((subject) => subject.pages.length === 0);
  if (missing.length > MAX_MISSING) {
    throw new Error(
      `${missing.length} of ${subjects.length} repositories carry no wiki/ ` +
      `(${missing.map((s) => s.id).join(", ")}), which is more than SITE_MAX_MISSING=${MAX_MISSING}. ` +
      `Publishing would look like an org that small.`);
  }

  const pages = guidePages();
  const groups = [
    ["The guide", pages.map((p) => ({ href: `/guide/${p.slug}/`, label: titleOf(p.text, p.slug) }))],
    ["Plugins", subjects.filter((s) => s.kind !== "core").map((s) => ({
      href: `/plugins/${s.id}/`,
      label: s.id,
      note: s.kind,
    }))],
    ["Core", subjects.filter((s) => s.kind === "core").map((s) => ({
      href: `/core/`, label: s.id, note: s.release ? s.release.tag : "unreleased",
    }))],
  ];
  const nav = navigation(groups, base);

  let written = 0;
  for (const entry of pages) {
    const { html } = renderMarkdown(entry.text);
    write(join(out, "guide", entry.slug, "index.html"),
          page({ title: titleOf(entry.text, entry.slug), body: html, nav, base }));
    written += 1;
  }

  for (const subject of subjects) {
    const prefix = subject.kind === "core" ? ["core"] : ["plugins", subject.id];
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

  return { written: written + 1, subjects: subjects.length, missing: missing.map((s) => s.id) };
}

function subjectHeader(subject, base) {
  const release = subject.release
    ? `<code>${escapeHtml(subject.release.tag)}</code>`
    : "<em>unreleased</em>";
  const examples = (subject.examples || []).length
    ? ` &middot; ${subject.examples.length} example${subject.examples.length === 1 ? "" : "s"}`
    : "";
  return `<p class="meta"><span class="kind">${escapeHtml(subject.kind)}</span> &middot; ` +
         `<a href="https://github.com/${subject.repo}">${escapeHtml(subject.repo)}</a> &middot; ` +
         `${release}${examples}</p>`;
}

function indexBody(manifest, subjects, base) {
  const rows = subjects.filter((s) => s.kind !== "core").map((s) =>
    `<tr><td><a href="${base}/plugins/${s.id}/">${escapeHtml(s.id)}</a></td>` +
    `<td>${escapeHtml(s.kind)}</td>` +
    `<td>${s.release ? escapeHtml(s.release.tag) : "unreleased"}</td>` +
    `<td>${(s.examples || []).length || "none"}</td></tr>`).join("");
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
  console.log(`wrote ${result.written} pages for ${result.subjects} repositories`);
  if (result.missing.length) console.warn(`no wiki yet: ${result.missing.join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
