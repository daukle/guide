// Markdown to HTML, and the page shell around it.
//
// @implNote a hand-written subset rather than a dependency, for the reason the
// rest of this org gives everywhere else: a build that installs a package tree
// is a build whose output depends on what npm resolved that morning. The subset
// is exactly what the pages here use, and `unsupported` reports anything it met
// and did not understand, so a page using something new fails the build loudly
// instead of rendering as literal text.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    `<a href="${href}">${label}</a>`);
  return out;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** @returns {{ html: string, headings: {level: number, text: string, id: string}[] }} */
export function renderMarkdown(source) {
  const lines = source.split("\n");
  const html = [];
  const headings = [];
  let index = 0;

  const closeList = (open) => { if (open) html.push("</ul>"); return false; };
  let inList = false;

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      inList = closeList(inList);
      const cls = language ? ` class="language-${escapeHtml(language)}"` : "";
      html.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      inList = closeList(inList);
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slug(text);
      headings.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.startsWith("|")) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        rows.push(lines[index]);
        index += 1;
      }
      inList = closeList(inList);
      html.push(renderTable(rows));
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${inline(bullet[1])}</li>`);
      index += 1;
      continue;
    }

    if (line.trim() === "") {
      inList = closeList(inList);
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() !== ""
           && !lines[index].startsWith("#") && !lines[index].startsWith("|")
           && !lines[index].startsWith("```") && !/^[-*]\s/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    inList = closeList(inList);
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }

  closeList(inList);
  return { html: html.join("\n"), headings };
}

function renderTable(rows) {
  const cells = (row) => row.slice(1, row.endsWith("|") ? -1 : undefined)
    .split("|").map((cell) => cell.trim());
  const header = cells(rows[0]);
  // Row 1 is the alignment rule; it carries no content.
  const body = rows.slice(2).map(cells);
  const head = header.map((cell) => `<th>${inline(cell)}</th>`).join("");
  const lines = body.map(
    (row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`);
  return `<table><thead><tr>${head}</tr></thead><tbody>${lines.join("")}</tbody></table>`;
}

export function page({ title, body, nav, base }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${base}/style.css">
</head>
<body>
<nav class="sidebar">${nav}</nav>
<main>${body}</main>
</body>
</html>
`;
}
