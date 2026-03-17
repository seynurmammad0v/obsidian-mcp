#!/usr/bin/env bash
set -e

BUMP=${1:-patch}

echo "==> Starting release ($BUMP)..."

# 1. Ensure working tree is clean before bumping
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is dirty. Commit or stash changes first."
  exit 1
fi

# 2. Validate everything passes before we touch the version
echo "==> Running validation (lint + typecheck + tests)..."
npm run validate

# 3. Build to make sure dist/ is up to date
echo "==> Building..."
npm run build

# 4. Bump version (creates git commit + tag automatically)
echo "==> Bumping version ($BUMP)..."
npm version "$BUMP"

# 5. Push commit + tag to remote
echo "==> Pushing to git..."
git push && git push --tags

# 6. Publish to npm (prepublishOnly will pass since git is clean & pushed)
echo "==> Publishing to npm..."
npm publish --access public

echo "==> Release complete! Published $(node -p "require('./package.json').version")"
