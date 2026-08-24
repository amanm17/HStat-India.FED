#!/usr/bin/env bash
set -euo pipefail

LIVE="https://hstat-india.pages.dev"
WORK="/tmp/hstat-live-audit"

rm -rf "$WORK"
mkdir -p "$WORK/live"

echo "======================================================================"
echo "HSTAT.INDIA — LIVE BUILD VS LOCAL VS GIT AUDIT"
echo "======================================================================"

echo
echo "1. CURRENT GIT STATE"
echo "---------------------------------------------------------------------"

git status --short
echo

echo "HEAD:"
git log -1 --oneline --decorate

echo
echo "REMOTE:"
git remote -v


echo
echo "2. LIVE INDEX"
echo "---------------------------------------------------------------------"

curl -fL \
  --retry 5 \
  --retry-all-errors \
  -A "Mozilla/5.0" \
  "$LIVE/" \
  -o "$WORK/live/index.html"

echo "LIVE index.html downloaded."

grep -oE \
  'assets/[^"]+\.(js|css)' \
  "$WORK/live/index.html" \
  | sort -u \
  > "$WORK/assets.txt"

cat "$WORK/assets.txt"


echo
echo "3. DOWNLOAD LIVE BUILD ASSETS"
echo "---------------------------------------------------------------------"

while IFS= read -r asset
do
  mkdir -p \
    "$WORK/live/$(dirname "$asset")"

  curl -fL \
    --retry 5 \
    --retry-all-errors \
    -A "Mozilla/5.0" \
    "$LIVE/$asset" \
    -o "$WORK/live/$asset"

  echo "FETCHED $asset"
done < "$WORK/assets.txt"


echo
echo "4. COMPARE LIVE BUILD WITH LOCAL DIST"
echo "---------------------------------------------------------------------"

FAIL=0

compare_file() {
  REL="$1"

  if [[ ! -f "dist/$REL" ]]; then
    echo "MISSING LOCAL: dist/$REL"
    FAIL=1
    return
  fi

  LIVE_HASH="$(
    shasum -a 256 "$WORK/live/$REL" |
    awk '{print $1}'
  )"

  LOCAL_HASH="$(
    shasum -a 256 "dist/$REL" |
    awk '{print $1}'
  )"

  if [[ "$LIVE_HASH" == "$LOCAL_HASH" ]]; then
    echo "MATCH  $REL"
  else
    echo "DIFF   $REL"
    echo "       LIVE : $LIVE_HASH"
    echo "       LOCAL: $LOCAL_HASH"
    FAIL=1
  fi
}

compare_file "index.html"

while IFS= read -r asset
do
  compare_file "$asset"
done < "$WORK/assets.txt"


echo
echo "5. COMPARE CRITICAL LIVE DATA"
echo "---------------------------------------------------------------------"

for rel in \
  "data/hs-library.json" \
  "data/snapshots/current/parents/2/84.json" \
  "data/snapshots/current/parents/4/8542.json" \
  "data/snapshots/current/products/847130.json"
do
  mkdir -p \
    "$WORK/live/$(dirname "$rel")"

  curl -fL \
    --retry 5 \
    --retry-all-errors \
    -A "Mozilla/5.0" \
    "$LIVE/$rel" \
    -o "$WORK/live/$rel"

  if [[ ! -f "public/$rel" ]]; then
    echo "MISSING LOCAL PUBLIC: public/$rel"
    FAIL=1
    continue
  fi

  L="$(
    shasum -a 256 \
      "$WORK/live/$rel" |
    awk '{print $1}'
  )"

  P="$(
    shasum -a 256 \
      "public/$rel" |
    awk '{print $1}'
  )"

  if [[ "$L" == "$P" ]]; then
    echo "MATCH  $rel"
  else
    echo "DIFF   $rel"
    FAIL=1
  fi
done


echo
echo "6. FILES DIFFERENT FROM GIT HEAD"
echo "---------------------------------------------------------------------"

git diff --name-status HEAD || true

echo
echo "7. UNTRACKED FILES"
echo "---------------------------------------------------------------------"

git ls-files \
  --others \
  --exclude-standard \
  | sort


echo
echo "8. IGNORED FILES RELEVANT TO BUILD"
echo "---------------------------------------------------------------------"

git status \
  --ignored \
  --short \
  src \
  public \
  package.json \
  package-lock.json \
  vite.config.ts \
  vite.config.js \
  config \
  pipeline \
  scripts \
  2>/dev/null || true


echo
echo "9. TRACKED SOURCE INVENTORY"
echo "---------------------------------------------------------------------"

printf "src files tracked: "
git ls-files src | wc -l

printf "public files tracked: "
git ls-files public | wc -l

printf "pipeline files tracked: "
git ls-files pipeline | wc -l

printf "config files tracked: "
git ls-files config | wc -l


echo
echo "======================================================================"

if [[ "$FAIL" == "0" ]]; then
  echo "LOCAL DIST MATCHES LIVE DEPLOYMENT"
else
  echo "WARNING — LOCAL AND LIVE ARE NOT IDENTICAL"
fi

echo "======================================================================"
