#!/usr/bin/env bash
set -u

cd "/Users/amanmishra/Documents/Personal Project/HStat_India_Fresh/HStat.India-fresh-v1" || exit 2

echo "======================================================================"
echo "HSTAT.INDIA — DEPLOYMENT TARGET CHECK"
echo "======================================================================"

echo
echo "1. GIT REPOSITORY"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1
then
  echo "Git repository: YES"

  echo
  echo "Branch:"
  git branch --show-current || true

  echo
  echo "Remote:"
  git remote -v || true

  echo
  echo "Latest commit:"
  git log -1 --oneline || true

  echo
  echo "Working tree:"
  git status --short || true
else
  echo "Git repository: NO"
fi


echo
echo "2. GITHUB CLI"

if command -v gh >/dev/null 2>&1
then
  echo "gh installed: YES"
  gh auth status 2>&1 || true
else
  echo "gh installed: NO"
fi


echo
echo "3. CLOUDFLARE AUTH"

npx wrangler whoami 2>&1 || true


echo
echo "4. CLOUDFLARE PAGES PROJECTS"

npx wrangler pages project list 2>&1 || true


echo
echo "5. CLOUDFLARE CONFIG FILES"

find . \
  -maxdepth 2 \
  \( \
    -name "wrangler.toml" \
    -o -name "wrangler.json" \
    -o -name "wrangler.jsonc" \
    -o -name "_headers" \
    -o -name "_redirects" \
  \) \
  -print \
  2>/dev/null || true


echo
echo "6. FINAL RELEASE ARTIFACT"

if [[ -f dist/index.html ]]
then
  echo "dist/index.html: PRESENT"
else
  echo "dist/index.html: MISSING"
fi

echo
echo "======================================================================"
echo "D2A COMPLETE"
echo "======================================================================"
