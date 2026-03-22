#!/usr/bin/env bash
# Run the code review guide against any PR in this repository.
# Usage: bash instruction.sh <PR_NUMBER>
#
# The script checks out the PR branch, collects the list of changed
# Solidity and TypeScript files, and asks Claude to review them against
# REVIEW_GUIDE.md and ADDITIONAL_CONTEXT.md.

set -e

PR_NUMBER=${1:?Usage: bash instruction.sh <PR_NUMBER>}

echo "Checking out PR #${PR_NUMBER}..."
gh pr checkout "$PR_NUMBER" --repo matter-labs/era-contracts

# Get the base branch of the PR
BASE_BRANCH=$(gh pr view "$PR_NUMBER" --repo matter-labs/era-contracts --json baseRefName -q .baseRefName)
echo "Base branch: ${BASE_BRANCH}"

echo "Collecting changed files..."
CHANGED_FILES=$(git diff --name-only "origin/${BASE_BRANCH}...HEAD" \
  | grep -E '\.(sol|ts)$' \
  | while read -r f; do [ -f "$f" ] && echo "   - $f"; done)

if [ -z "$CHANGED_FILES" ]; then
  echo "No .sol or .ts files changed in this PR."
  exit 1
fi

echo "Files to review:"
echo "$CHANGED_FILES"
echo ""

claude --dangerously-skip-permissions -p "You are a code reviewer. Please do the following:
1. Read REVIEW_GUIDE.md in the current directory
2. Read ADDITIONAL_CONTEXT.md in the current directory
3. Read each of these files that were changed in the PR:
${CHANGED_FILES}
4. Apply the review guide to each file and report ALL issues you find. For each issue: cite the file and line number, state which review guideline it violates, and explain why it is a problem.
5. Do NOT report non-issues. Only report actual violations of the guidelines.
6. Do NOT include general suggestions for improvements unless they match a specific section of the review guide."
