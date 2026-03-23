#!/usr/bin/env bash
# Run the code review guide against any PR in this repository.
# Usage: bash instruction.sh <PR_NUMBER>
#
# Creates a temporary git worktree for the PR branch so the current branch
# is never modified. Changed .sol and .ts files are split into chunks and
# reviewed in parallel by independent Claude subagents (read-only).
#
# Compatible with bash 3.2+ (macOS default).

set -e

PR_NUMBER=${1:?Usage: bash instruction.sh <PR_NUMBER>}

# How many files each subagent reviews at once. Tune to balance context size
# vs parallelism — lower = more agents, each with less context.
CHUNK_SIZE=12

REPO_ROOT=$(git rev-parse --show-toplevel)

# ── Validate guide files exist on the current branch ─────────────────────────
for guide_file in REVIEW_GUIDE.md ADDITIONAL_CONTEXT.md; do
  if [ ! -f "$REPO_ROOT/$guide_file" ]; then
    echo "ERROR: $guide_file not found in $REPO_ROOT. Run this script from the branch that contains it." >&2
    exit 1
  fi
done

# ── Create a worktree for the PR branch ──────────────────────────────────────
WORKTREE=$(mktemp -d)
RESULT_TMP=$(mktemp -d)
FILES_TMP=$(mktemp)
trap 'git worktree remove --force "$WORKTREE" 2>/dev/null; rm -rf "$RESULT_TMP" "$FILES_TMP"' EXIT

echo "Fetching PR #${PR_NUMBER}..."
git fetch origin "pull/${PR_NUMBER}/head:pr-${PR_NUMBER}" --force 2>/dev/null \
  || git fetch origin "pull/${PR_NUMBER}/head" --force 2>/dev/null

BASE_BRANCH=$(gh pr view "$PR_NUMBER" --repo matter-labs/era-contracts --json baseRefName -q .baseRefName)
echo "Base branch: ${BASE_BRANCH}"

git worktree add "$WORKTREE" "pr-${PR_NUMBER}" 2>/dev/null \
  || git worktree add "$WORKTREE" FETCH_HEAD

# Copy guide files into the worktree so subagents can read them
cp "$REPO_ROOT/REVIEW_GUIDE.md" "$WORKTREE/"
cp "$REPO_ROOT/ADDITIONAL_CONTEXT.md" "$WORKTREE/"

# ── Collect changed files (into a temp file to avoid process substitution) ───
echo "Collecting changed files..."
git -C "$WORKTREE" diff --name-only "origin/${BASE_BRANCH}...HEAD" \
  | grep -E '\.(sol|ts)$' \
  | while IFS= read -r f; do
      [ -f "$WORKTREE/$f" ] && echo "$f"
    done \
  > "$FILES_TMP"

# Read the temp file into an array (plain redirection — works on bash 3.2)
ALL_FILES=()
while IFS= read -r f; do
  ALL_FILES+=("$f")
done < "$FILES_TMP"

if [ ${#ALL_FILES[@]} -eq 0 ]; then
  echo "No .sol or .ts files changed in this PR."
  exit 1
fi

echo "Found ${#ALL_FILES[@]} file(s) to review, chunk size ${CHUNK_SIZE}."

# ── Spawn one subagent per chunk ──────────────────────────────────────────────
CHUNK_NUM=0
PIDS=()
TOTAL=${#ALL_FILES[@]}
i=0

while [ "$i" -lt "$TOTAL" ]; do
  # Slice ALL_FILES[i .. i+CHUNK_SIZE-1] without bash 4 array slicing
  CHUNK=()
  j=0
  while [ "$j" -lt "$CHUNK_SIZE" ] && [ "$(( i + j ))" -lt "$TOTAL" ]; do
    CHUNK+=("${ALL_FILES[$(( i + j ))]}")
    j=$(( j + 1 ))
  done

  FILE_LIST=$(printf "   - %s\n" "${CHUNK[@]}")
  OUT="$RESULT_TMP/chunk_${CHUNK_NUM}.txt"

  # Run each subagent from inside the worktree so relative file paths resolve
  (
    cd "$WORKTREE"
    claude --tools "Read,Glob,Grep" -p \
"You are a code reviewer. Please do the following:
1. Read REVIEW_GUIDE.md in the current directory
2. Read ADDITIONAL_CONTEXT.md in the current directory
3. Read each of these files that were changed in the PR:
${FILE_LIST}
4. Apply the review guide to each file and report ALL issues you find.
   For each issue: cite the file and line number, state which review
   guideline it violates, and explain why it is a problem.
5. Do NOT report non-issues. Only report actual violations of the guidelines.
6. Do NOT include general suggestions unless they match a specific section
   of the review guide."
  ) > "$OUT" 2>&1 &

  PIDS+=($!)
  CHUNK_NUM=$(( CHUNK_NUM + 1 ))
  i=$(( i + CHUNK_SIZE ))
done

echo "Launched ${CHUNK_NUM} subagent(s). Waiting for results..."

# ── Wait for all subagents ────────────────────────────────────────────────────
FAILED=0
idx=0
while [ "$idx" -lt "${#PIDS[@]}" ]; do
  if ! wait "${PIDS[$idx]}"; then
    echo "WARNING: subagent $idx exited with an error." >&2
    FAILED=$(( FAILED + 1 ))
  fi
  idx=$(( idx + 1 ))
done

# ── Print results in chunk order ─────────────────────────────────────────────
echo ""
echo "========================================"
echo " REVIEW RESULTS (${CHUNK_NUM} subagent(s))"
echo "========================================"
echo ""

idx=0
while [ "$idx" -lt "$CHUNK_NUM" ]; do
  OUT="$RESULT_TMP/chunk_${idx}.txt"
  if [ -f "$OUT" ]; then
    echo "-- Chunk $(( idx + 1 ))/${CHUNK_NUM} --"
    cat "$OUT"
    echo ""
  fi
  idx=$(( idx + 1 ))
done

if [ "$FAILED" -gt 0 ]; then
  echo "WARNING: $FAILED subagent(s) failed." >&2
  exit 1
fi
