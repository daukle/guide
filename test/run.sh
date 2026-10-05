#!/bin/sh
# The guide's suite, and it asserts two different things.
#
# 1. Every project under projects/ actually builds. A guide page describing a
#    project that does not work is worse than no page.
# 2. Every fenced block in a page that claims to come from a file MATCHES that
#    file, byte for byte. This is the half that matters: a snippet copied into
#    prose is a second source of truth, and the whole reason this repository
#    exists rather than a wiki is that a wiki cannot check this.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work="$root/test/.work"

daukle=${DAUKLE:-}
if [ -z "$daukle" ]; then
  for candidate in \
    "$root/.daukle/build/daukle" \
    "$root/.daukle/build/daukle.exe" \
    "$root/.daukle/build/Release/daukle.exe" \
    "$root/.daukle/build/Debug/daukle.exe"
  do
    [ -x "$candidate" ] && daukle=$candidate && break
  done
fi
if [ -z "$daukle" ] || [ ! -x "$daukle" ]; then
  echo "no daukle binary: set DAUKLE, or check out daukle/daukle into .daukle and build it" >&2
  exit 1
fi

# One cache for the run: several projects provision the same things, and
# isolating them would download each once per project per runner.
cache="$work/.cache"

# A project with a task.txt provisions a real toolchain, so by default those
# run on Linux only and one download per CI run is the trade.
run_tasks=0
case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux) run_tasks=1 ;;
esac
[ "${DAUKLE_GUIDE_E2E:-}" = "1" ] && run_tasks=1

passed=0
failed=0
skipped=0

fail() { echo "FAIL $1: $2" >&2; failed=$((failed + 1)); }
pass() { echo "ok   $1: $2"; passed=$((passed + 1)); }
skip() { echo "skip $1: $2"; skipped=$((skipped + 1)); }

# --- 1. every page's quoted files are the real ones -------------------------
#
# A fence opens with an info string naming its source:
#     ```toml file=projects/first-project/daukle.toml
# and its body must equal that file exactly. A fence with no file= is prose
# (a shell transcript, an error message) and is not checked.
check_page() {
  page=$1
  name=$(basename "$page")
  quoted=0
  mismatched=""
  missing=""

  # Split the page on fences in awk rather than in the shell: a shell loop over
  # lines mangles backslashes and leading whitespace, both of which appear in
  # these files.
  awk -v out="$work/fences" '
    /^```/ {
      if (inside) { inside = 0; close(target); next }
      inside = 1
      source = ""
      if (match($0, /file=[^ `]+/)) source = substr($0, RSTART + 5, RLENGTH - 5)
      if (source == "") { target = "/dev/null"; next }
      count++
      target = out "/" count ".body"
      print source > (out "/" count ".source")
      close(out "/" count ".source")
      next
    }
    inside && target != "/dev/null" { print > target }
  ' "$page"

  for source_file in "$work/fences"/*.source; do
    [ -f "$source_file" ] || continue
    quoted=$((quoted + 1))
    source=$(cat "$source_file")
    body="${source_file%.source}.body"
    if [ ! -f "$root/$source" ]; then
      missing="$source"
      break
    fi
    if ! diff -u "$root/$source" "$body" > "$work/fences/diff.txt" 2>&1; then
      mismatched="$source"
      break
    fi
  done

  if [ -n "$missing" ]; then
    fail "$name" "quotes $missing, which does not exist"
    return
  fi
  if [ -n "$mismatched" ]; then
    echo "--- $name quotes $mismatched and the two differ ---" >&2
    cat "$work/fences/diff.txt" >&2
    fail "$name" "its quote of $mismatched is stale"
    return
  fi
  if [ "$quoted" -eq 0 ]; then
    fail "$name" "quotes no file, so nothing here is checked against anything"
    return
  fi
  pass "$name" "$quoted quoted file(s) match"
}

rm -rf "$work"
mkdir -p "$work/fences"
for page in "$root"/pages/*.md; do
  [ -f "$page" ] || continue
  rm -rf "$work/fences"
  mkdir -p "$work/fences"
  check_page "$page"
done

# --- 2. every project builds ------------------------------------------------
for manifest in "$root"/projects/*/daukle.toml; do
  [ -f "$manifest" ] || continue
  name=$(basename "$(dirname "$manifest")")
  staged="$work/$name"
  rm -rf "$staged"
  mkdir -p "$work"
  cp -R "$root/projects/$name" "$staged"

  if ! (cd "$staged" && DAUKLE_CACHE_DIR="$cache" "$daukle" sync >"$staged/.sync1.log" 2>&1); then
    fail "$name" "first sync failed: $(tail -n 1 "$staged/.sync1.log")"
    continue
  fi
  # Twice, then check: a fresh clone of a generating toolchain is legitimately
  # out of sync, so check is the assertion that ONE sync was enough.
  if ! (cd "$staged" && DAUKLE_CACHE_DIR="$cache" "$daukle" sync >"$staged/.sync2.log" 2>&1); then
    fail "$name" "second sync failed: $(tail -n 1 "$staged/.sync2.log")"
    continue
  fi
  if ! (cd "$staged" && DAUKLE_CACHE_DIR="$cache" "$daukle" check >"$staged/.check.log" 2>&1); then
    fail "$name" "not in sync after syncing twice: $(tail -n 1 "$staged/.check.log")"
    continue
  fi
  pass "$name" "synced twice and in sync"

  if [ -f "$root/projects/$name/expected/package.json" ]; then
    if ! cmp -s "$root/projects/$name/expected/package.json" "$staged/package.json"; then
      fail "$name" "package.json does not match expected/"
      continue
    fi
    pass "$name" "matched expected/"
  fi

  [ -f "$root/projects/$name/task.txt" ] || continue
  task=$(cat "$root/projects/$name/task.txt")
  if [ "$run_tasks" -ne 1 ]; then
    skip "$name" "task $task, which provisions a toolchain; set DAUKLE_GUIDE_E2E=1"
    continue
  fi
  if ! (cd "$staged" && DAUKLE_CACHE_DIR="$cache" "$daukle" $task >"$staged/.task.log" 2>&1); then
    fail "$name" "task $task failed: $(tail -n 1 "$staged/.task.log")"
    continue
  fi
  if [ -f "$root/projects/$name/expect-output.txt" ]; then
    clause=$(cat "$root/projects/$name/expect-output.txt")
    if ! grep -q "$clause" "$staged/.task.log"; then
      fail "$name" "task $task printed no \"$clause\""
      continue
    fi
  fi
  pass "$name" "ran $task"
done

# --- 3. every project is reached by a page ----------------------------------
#
# Without this a project can rot unmentioned and a page can describe a project
# that was renamed, and both look green.
for manifest in "$root"/projects/*/daukle.toml; do
  [ -f "$manifest" ] || continue
  name=$(basename "$(dirname "$manifest")")
  if ! grep -rqF "projects/$name/" "$root"/pages/*.md; then
    fail "$name" "no page mentions it"
    continue
  fi
  pass "$name" "a page quotes it"
done

echo "pass: $passed, fail: $failed, skip: $skipped"
[ "$failed" -eq 0 ]
