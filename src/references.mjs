// Cross repository references, resolved against the manifest.
//
// A free form markdown link into another repository is a path nothing checks: it
// breaks silently when a page is renamed and surfaces as a 404 on the published
// site rather than as a red run. A [[...]] reference names a thing the manifest
// already knows, and an unresolvable one fails the build naming both ends, which
// is what makes a wiki easier to change rather than harder.

const REFERENCE = /\[\[([^\]]+)\]\]/g;

function indexOf(subjects) {
  const pagesBySubject = new Map();
  const examples = new Map();
  for (const subject of subjects) {
    pagesBySubject.set(subject.id, subject);
    for (const example of subject.exampleDetails || []) examples.set(example.name, subject);
  }
  return { pagesBySubject, examples };
}

function subjectHref(subject, base) {
  if (subject.kind === "core") return `${base}/core/`;
  if (subject.kind === "examples") return `${base}/examples/about/`;
  return `${base}/plugins/${subject.id}/`;
}

/**
 * Where one reference points, or null when nothing in the org answers to it.
 *
 * @returns {{href: string, label: string} | null}
 */
export function resolveReference(target, subjects, base) {
  const { pagesBySubject, examples } = indexOf(subjects);

  if (target.startsWith("example:")) {
    const name = target.slice("example:".length);
    return examples.has(name) ? { href: `${base}/examples/${name}/`, label: name } : null;
  }

  const slash = target.indexOf("/");
  if (slash === -1) {
    const subject = pagesBySubject.get(target);
    return subject ? { href: subjectHref(subject, base), label: subject.id } : null;
  }

  const subject = pagesBySubject.get(target.slice(0, slash));
  const page = target.slice(slash + 1);
  if (!subject) return null;
  if (!subject.pages.some((wikiPage) => wikiPage.name === `${page}.md`)) return null;
  if (page === "index") return { href: subjectHref(subject, base), label: subject.id };
  const prefix = subjectHref(subject, base);
  return { href: `${prefix}${page}/`, label: page };
}

/**
 * Replaces every reference in PROSE, collecting the ones nothing answers to.
 *
 * @implNote code is skipped, and that is not tidiness: `[[consumers]]` is TOML
 * array-of-tables syntax and appears in almost every manifest this org quotes,
 * so a scanner that reads fenced blocks reports a plugin called `consumers` that
 * nobody wrote. Inline code is skipped for the same reason, since prose about a
 * manifest names its tables in backticks.
 */
export function expandReferences(text, where, subjects, base) {
  const problems = [];
  const expand = (prose) => prose.replace(REFERENCE, (whole, target) => {
    const resolved = resolveReference(target.trim(), subjects, base);
    if (!resolved) {
      problems.push(`${where} points at [[${target.trim()}]], which nothing in this org answers to`);
      return whole;
    }
    return `[${resolved.label}](${resolved.href})`;
  });

  const out = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    out.push(inFence ? line : expandOutsideCode(line, expand));
  }
  return { text: out.join("\n"), problems };
}

function expandOutsideCode(line, expand) {
  // An odd number of backticks would mean a span running past the line, which
  // markdown does not allow, so the even-indexed pieces are the prose.
  return line.split("`")
    .map((piece, index) => (index % 2 === 0 ? expand(piece) : piece))
    .join("`");
}

export function expandEveryPage(subjects, base) {
  const problems = [];
  for (const subject of subjects) {
    for (const wikiPage of subject.pages) {
      const result = expandReferences(
        wikiPage.text, `${subject.repo} wiki/${wikiPage.name}`, subjects, base);
      wikiPage.text = result.text;
      problems.push(...result.problems);
    }
  }
  return problems;
}
