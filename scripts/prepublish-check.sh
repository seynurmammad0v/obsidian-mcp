#!/usr/bin/env bash
set -e

echo "==> Pre-publish checks..."

# 1. Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is dirty. Commit or stash changes before publishing."
  exit 1
fi

# 2. Ensure current branch is pushed
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "no-remote")

if [ "$REMOTE" = "no-remote" ]; then
  echo "ERROR: Current branch has no upstream. Push your branch first."
  exit 1
fi

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "ERROR: Local commits not pushed to remote. Run 'git push' first."
  exit 1
fi

echo "==> All pre-publish checks passed."
