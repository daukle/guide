## What this is

The developer guide for daukle, **and the wiki site for the whole organization**. It is two things
in one repository because they share a build: four hand-written pages, each built on a project here
that actually runs, plus every plugin's own wiki page, collected from every repository in the org.

| page | what it answers | where it lives |
| --- | --- | --- |
| 1. Your first project | what daukle is, what a manifest says, what `sync` and `check` do | `daukle/daukle` |
| 2. Plugins, and how daukle gets them | where abilities come from, how they are pinned, how to write one | `daukle/daukle` |
| 3. The logic layer | `daukle.lua`, for what a static manifest cannot say | `daukle/daukle` |
| 4. Dependencies and compiling | provisioning a JDK, pinned classpaths, and resolving instead of transcribing | `daukle/daukle` |

Each is a file in that repository's `wiki/`, and this repository renders it. None of them is here.

## The site is built from the org, not from a list

`npm run docs` reads [`daukle/manifest`](https://github.com/daukle/manifest), which auto-detects
every public repository in the organization and classifies each one from its own `plugin.lua`. It
then fetches each repository's `wiki/` directory and renders one static site.

**Nothing is submoduled and nothing is listed here by hand.** A gitlink is a pinned SHA somebody
has to maintain, and a hand-written list is wrong the day a repository is added. A plugin that adds
a wiki page appears on the site at the next build without anyone touching this repository, which is
why the build also runs on a schedule rather than only on a push.

```sh
GITHUB_TOKEN=... npm run docs      # writes site/
```

**It refuses to publish a degraded site.** If more than `SITE_MAX_MISSING` repositories carry no
`wiki/`, the build fails rather than publishing: a site missing half its plugins looks exactly like
a site for an org half the size.

## This repository holds no content, and that is the whole point

**Every page is in the wiki of the repository it is about, and every example is in the repository
of the thing it demonstrates.** This repository is the build that renders them and nothing else:
no `pages/`, no `projects/`, no markdown of its own. It used to hold the four narrative pages
because the snippet check below only works where a page and the files it quotes sit together, and
that reason stopped applying once every repository gained a `wiki/`.

**The snippet check went with them, and nothing performs it yet.** A fenced block naming a file
was compared against that file byte for byte, which is what stops a snippet becoming a second
source of truth. That check belongs in the site builder now, because a page in one repository may
legitimately quote a file in another, and **until the builder does it a moved page's snippets are
verified when they move and not after.** That is the one thing this move gives up, and it is the
first thing the builder should take back.

**What remains here is the renderer and its tests**, which are the ten node tests under `test/`.
The shell harness that checked pages and projects was deleted rather than left: with no pages and
no projects it reported `pass: 0, fail: 0` and exited green, and a suite that asserts nothing is
the failure this organization is most careful about.

That a page lives in a repository rather than in GitHub's own wiki feature is a separate decision
and it stands: that wiki is a separate git repo CI does not reach, so every snippet in it would be
an unexercised claim.

## The renderer is a subset, deliberately

Markdown to HTML is a hand-written subset rather than a dependency, for the reason the rest of this
org gives everywhere else: a build that installs a package tree is a build whose output depends on
what npm resolved that morning. The subset is exactly what these pages use, and its suite pins the
cases that would otherwise rot silently, including that a fenced block stays literal and that
nothing it emits is an em-dash.

## Running it

```sh
npm test        # the renderer, which is the whole of what this repository can test
npm run docs    # build the site from the org manifest and every repository's wiki
```

There is no shell harness here any more, and no gate: the pages and the examples that needed a real
JDK went to the repositories that own them, and each is tested there.
