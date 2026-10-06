// What every example declares, against what the org has actually published.
//
// Being behind is not wrong by itself, which is why two of the three conditions
// are a report rather than a failure. Naming a repository or a version that does
// not exist is a different thing and fails the build.

const COORDINATE = /coordinate\s*=\s*"([^"@]+)@([^"]+)"/g;
const RESOLVER_URL = /url\s*=\s*"https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\//g;

function satisfiedBy(range, tag) {
  // The ranges in this org are `^x.y.z`, `^x` or an exact version, and the only
  // question asked here is whether the latest release is NEWER than the floor.
  const floor = range.replace(/^[\^~]/, "").split(".").map(Number);
  const latest = tag.split(".").map(Number);
  for (let index = 0; index < Math.max(floor.length, latest.length); index += 1) {
    const want = floor[index] || 0;
    const have = latest[index] || 0;
    if (have > want) return "behind";
    if (have < want) return "ahead";
  }
  return "current";
}

/**
 * The freshness of every coordinate and commit pin an example declares.
 *
 * @returns {{reports: string[], problems: string[]}}
 */
export function checkFreshness(subjects, manifests) {
  const releases = new Map();
  for (const subject of subjects) {
    if (subject.release) releases.set(subject.repo, subject.release.tag);
  }
  const branchTips = new Map(
    subjects.filter((subject) => subject.tip).map((subject) => [subject.repo, subject.tip]));

  const reports = [];
  const problems = [];

  const grouped = new Map();
  const report = (where, message) => {
    if (!grouped.has(message)) grouped.set(message, []);
    grouped.get(message).push(where);
  };

  for (const { where, text } of manifests) {
    for (const [, repo, range] of text.matchAll(COORDINATE)) {
      if (!releases.has(repo)) {
        // A coordinate naming a repository with no release, or no repository at
        // all, cannot resolve for anybody who copies this example.
        problems.push(`${where} names ${repo}@${range}, which has no release in this org`);
        continue;
      }
      const tag = releases.get(repo);
      const verdict = satisfiedBy(range, tag);
      if (verdict === "ahead") {
        problems.push(`${where} needs ${repo}@${range}, but the newest release is ${tag}`);
      } else if (verdict === "behind") {
        report(where, `${repo}@${range} is asked for where ${tag} is published`);
      }
    }

    for (const [, repo, commit] of text.matchAll(RESOLVER_URL)) {
      const tip = branchTips.get(repo);
      if (tip && tip !== commit) {
        report(where, `${repo} is pinned at ${commit.slice(0, 7)}, ` +
                     `which is no longer the default branch tip`);
      }
    }
  }
  // Grouped, because one stale pin shared by fifteen examples is one fact. A
  // report nobody reads is the thing this exists to prevent, one layer up.
  for (const [message, where] of grouped) {
    reports.push(where.length === 1
      ? `${message}, in ${where[0]}`
      : `${message}, in ${where.length}: ${where.join(", ")}`);
  }
  return { reports, problems };
}
