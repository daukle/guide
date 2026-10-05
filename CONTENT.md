## What this is

The developer guide for daukle, in four pages, each one built on a project in this repository
that actually runs.

| page | what it answers |
| --- | --- |
| [1. Your first project](pages/01-first-project.md) | what daukle is, what a manifest says, what `sync` and `check` do |
| [2. Plugins, and how daukle gets them](pages/02-plugins.md) | where abilities come from, how they are pinned, how to write one |
| [3. The logic layer](pages/03-logic-layer.md) | `daukle.lua`, for what a static manifest cannot say |
| [4. Dependencies and compiling](pages/04-dependencies-and-compiling.md) | provisioning a JDK, pinned classpaths, and resolving instead of transcribing |

## Why this is a repository and not a wiki

**Every fenced block on a page that names a file is checked against that file, byte for byte, in
CI.** A snippet copied into prose is a second source of truth, and a second source of truth
drifts. The suite fails with the diff when it does, which a wiki cannot do.

The suite asserts three things on three runners:

1. every page's quoted files match the real ones;
2. every project under `projects/` syncs twice and reports in sync;
3. every project is mentioned by a page, so neither can rot unnoticed.

A page that quotes nothing fails too: a page with no checked claim is a page nothing holds to
account.

## Running it

```sh
DAUKLE=/path/to/daukle test/run.sh                       # pages and syncs
DAUKLE=/path/to/daukle DAUKLE_GUIDE_E2E=1 test/run.sh    # and the toolchain tasks
```

The gate exists because `projects/compiling` provisions a real JDK. CI sets it on every runner.

## What is missing, deliberately named

**The resolve on page 4 is not exercised here.** `daukle/maven` has no release, so no project
here can name it by coordinate and a multi-file plugin cannot be pinned by one url. The resolver
is exercised by its own repository's suite. This is the first thing to fix once it is released.

**Nothing covers `daukle/gradle`**, which is unbuilt, or publishing a plugin.
