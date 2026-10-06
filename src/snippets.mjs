// Every fenced block on a wiki page that names a file is compared against that
// file, byte for byte, and a difference fails the build.
//
// This was the guide's strongest property while the pages and the files sat in
// one repository. They no longer do: core's pages quote files in daukle/npm and
// daukle/java, so a fence may name a repository and the comparison crosses one.

const FENCE = /^```[A-Za-z0-9+-]*\s+file=(\S+)\s*$/;

/**
 * Every `file=` fence of one page, as { spec, repo, path, body, line }.
 *
 * @implNote a bare path means the page's own repository, so a page written
 * inside one repository stays simple and only a cross-repository quote pays for
 * itself. The colon discriminates because a slash appears in both halves.
 */
export function fencesOf(text, ownerRepo) {
  const lines = text.split("\n");
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const opener = lines[index].match(FENCE);
    if (!opener) {
      index += 1;
      continue;
    }
    const spec = opener[1];
    const body = [];
    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor].startsWith("```")) {
      body.push(lines[cursor]);
      cursor += 1;
    }
    const colon = spec.indexOf(":");
    out.push({
      spec,
      repo: colon === -1 ? ownerRepo : spec.slice(0, colon),
      path: colon === -1 ? spec : spec.slice(colon + 1),
      body: body.join("\n"),
      line: index + 1,
    });
    index = cursor + 1;
  }
  return out;
}

async function readFile(repo, ref, path, options) {
  const response = await options.fetchImpl(
    `https://raw.githubusercontent.com/${repo}/${ref}/${path}`,
    { headers: { "user-agent": "daukle-guide" } });
  // A 404 is a missing file, not an empty one. Treating it as empty is how a
  // fence quoting nothing would pass.
  if (!response.ok) return null;
  return response.text();
}

/**
 * Compares every quoted fence in the organization against the file it names.
 *
 * @returns {Promise<{checked: number, problems: string[]}>}
 */
export async function checkSnippets(subjects, options) {
  const problems = [];
  let checked = 0;

  for (const subject of subjects) {
    for (const page of subject.pages) {
      for (const fence of fencesOf(page.text, subject.repo)) {
        const where = `${subject.repo} wiki/${page.name}:${fence.line}`;
        const owner = subjects.find((candidate) => candidate.repo === fence.repo);
        if (!owner) {
          problems.push(`${where} quotes ${fence.spec}, and ${fence.repo} is not in this org`);
          continue;
        }
        const text = await readFile(fence.repo, owner.defaultBranch, fence.path, options);
        checked += 1;
        if (text === null) {
          problems.push(`${where} quotes ${fence.spec}, which does not exist`);
          continue;
        }
        // The file ends in a newline and the fence cannot, so the file's is
        // dropped rather than the fence's: trimming both would let a block that
        // really is missing its last line pass.
        if (text.replace(/\n$/, "") !== fence.body) {
          problems.push(`${where} no longer matches ${fence.spec}`);
        }
      }
    }
  }
  return { checked, problems };
}
