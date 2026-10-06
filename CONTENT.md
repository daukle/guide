## What this is

The developer guide for daukle, **and the wiki site for the whole organization**. It is two things
in one repository because they share a build: four hand-written pages, each built on a project here
that actually runs, plus every plugin's own wiki page, collected from every repository in the org.

| page | what it answers |
| --- | --- |
| [1. Your first project](pages/01-first-project.md) | what daukle is, what a manifest says, what `sync` and `check` do |
| [2. Plugins, and how daukle gets them](pages/02-plugins.md) | where abilities come from, how they are pinned, how to write one |
| [3. The logic layer](pages/03-logic-layer.md) | `daukle.lua`, for what a static manifest cannot say |
| [4. Dependencies and compiling](pages/04-dependencies-and-compiling.md) | provisioning a JDK, pinned classpaths, and resolving instead of transcribing |

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

## Why the pages are leaving, and where they are going

**They ARE in a wiki now: the wiki of the repository each one is about.** This repository used to
hold them because the snippet check below only works where the pages and the files they quote sit
together, and that reason stopped applying once every repository gained a `wiki/`. Two of the four
have moved into `daukle/daukle/wiki/` beside the examples they quote; the remaining two move with
their examples, into `daukle/java` and `daukle/npm`. When the last one goes this repository holds no
content at all and is only the build that renders the organization.

**Every fenced block on a page that names a file is checked against that file, byte for byte, in
CI.** A snippet copied into prose is a second source of truth, and a second source of truth drifts.
The suite fails with the diff when it does. **That check does not yet follow a page into another
repository**, which is the one thing this move gives up for now: it is the site builder's job, and
until it exists a moved page's snippets are verified when they move and not after.

That a page lives in a repository rather than in GitHub's own wiki feature is a separate decision
and it stands: that wiki is a separate git repo CI does not reach, so every snippet in it would be
an unexercised claim.

The suite asserts three things on three runners:

1. every page's quoted files match the real ones;
2. every project under `projects/` syncs twice and reports in sync;
3. every project is mentioned by a page, so neither can rot unnoticed.

A page that quotes nothing fails too: a page with no checked claim is a page nothing holds to
account.

## The renderer is a subset, deliberately

Markdown to HTML is a hand-written subset rather than a dependency, for the reason the rest of this
org gives everywhere else: a build that installs a package tree is a build whose output depends on
what npm resolved that morning. The subset is exactly what these pages use, and its suite pins the
cases that would otherwise rot silently, including that a fenced block stays literal and that
nothing it emits is an em-dash.

## Running it

```sh
npm test                                                 # the renderer
DAUKLE=/path/to/daukle test/run.sh                       # pages and syncs
DAUKLE=/path/to/daukle DAUKLE_GUIDE_E2E=1 test/run.sh    # and the toolchain tasks
```

The gate exists because `projects/compiling` provisions a real JDK. CI sets it on every runner.
