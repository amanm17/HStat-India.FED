#!/usr/bin/env bash
#
# One command: check, build, commit, push.
#
# Deployment is unchanged and deliberately so. Cloudflare builds this
# repository on every push to main and serves the result; nothing here
# deploys anything itself. What this script does is refuse to push code that
# would break that build, then push it.
#
#   ./scripts/ship.sh "commit message"
#
# The data is a separate question and always has been. Code reaches the site
# through this script; data reaches it through the Validated data refresh
# workflow, which is the only place with a Comtrade key. The script says so
# at the end rather than leaving you to remember.

set -euo pipefail

cd "$(dirname "$0")/.."

MESSAGE="${1:-HStat update}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# The repo carries its own virtualenv with pandas, pyarrow and
# comtradeapicall in it. The system python3 on this machine is Anaconda's
# base environment and does not necessarily have them, so prefer the venv
# and fall back only if it is missing.
if [ -x .venv/bin/python ]; then
  PY=".venv/bin/python"
else
  PY="python3"
fi

echo "Using interpreter: $PY ($($PY --version 2>&1))"

# The venv's python is a symlink into Anaconda. If Anaconda has moved or been
# removed the symlink dangles, the test above falls through to the system
# python3, and that one may not carry the packages the pipeline needs. Say so
# now, with the fix, rather than failing three lines later inside an import.
if ! "$PY" -c "import pandas, pyarrow, openpyxl" 2>/dev/null; then
  cat <<'MISSING'

  This interpreter cannot import pandas, pyarrow and openpyxl, which the
  pipeline needs. Either the repo virtualenv is broken or it is missing.

  Rebuild it:

      python3 -m venv .venv
      .venv/bin/pip install -r requirements.txt

  then run this script again.

MISSING
  exit 1
fi

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "1/4  Checking the committed snapshot"

# Two different questions, and only one of them should stop a code push.
#
#   Can this build ship?      schema agreement, fixture stamp. Hard gate.
#   Is the published data ok? QA. Reported, not blocking.
#
# The second is deliberate. A data fault is fixed by rebuilding the data, and
# rebuilding the data needs the fixed code pushed first, so gating the push on
# the data would make the fault unfixable. Promotion is gated where it belongs:
# refresh_monthly.py never publishes a snapshot that fails QA.

set +e
"$PY" pipeline/validate_snapshot.py public/data/snapshots/current
QA=$?
set -e

"$PY" pipeline/launch_sanity.py --build-only

if [ "$QA" != "0" ]; then
  echo
  echo "  The published snapshot has QA failures (above). The build is fine and"
  echo "  will ship; the data needs a rebuild. Run the refresh workflow at"
  echo "  depth 'reprocess' after this push - it costs no API calls."
fi

say "2/4  Building the frontend"

# Dependencies first, and not only for this machine's sake. Cloudflare
# installs from package-lock.json; if package.json has gained a dependency
# the lockfile has not, that build fails outright. Running install here keeps
# the two in step and commits the lockfile alongside the change that needed
# it.
npm install

# The same command Cloudflare runs. If it fails here it would have failed
# there, with the difference that here it has not been pushed yet.
npm run build

say "3/4  Committing"

# Working through the Claude desktop bridge leaves empty lock files in .git/
# that it can create but not remove. Git refuses to write the index while one
# exists, and the error it gives does not say that is why.
if [ -f .git/index.lock ] && [ ! -s .git/index.lock ]; then
  echo "Clearing an empty .git/index.lock left by the desktop bridge."
  rm -f .git/index.lock
fi

git add -A

if git diff --cached --quiet; then
  echo "Nothing to commit; the tree is already clean."
else
  git commit -m "$MESSAGE"
fi

say "4/4  Pushing to $BRANCH"

# The refresh workflow commits the published snapshot to this same branch, so
# the remote moves without me touching it. Rebase onto whatever it did before
# pushing, rather than meeting a rejected push and working out why.
git fetch origin "$BRANCH"

if ! git rebase "origin/$BRANCH"; then
  cat <<'CONFLICT'

  The rebase stopped on a conflict. Almost always this is
  public/data/snapshots, where a data refresh landed while I was working -
  and in that case the refresh's version is the right one:

      git checkout --theirs public/data/snapshots
      git add public/data/snapshots
      git rebase --continue

  Anything else, resolve it on its merits. `git rebase --abort` backs out.

CONFLICT
  exit 1
fi

git push origin "$BRANCH"

cat <<'NEXT'

Pushed. Cloudflare picks the commit up and rebuilds the site on its own;
give it a minute or two.

If you changed anything under pipeline/ or config/ that affects the numbers,
the site is now running new code over the old snapshot. Rebuild the data:

  Actions -> Validated data refresh -> Run workflow

    depth: reprocess   rebuilds the snapshot from the stored raw data.
                       No API calls, finishes in minutes. This is the one to
                       run after a processing or exchange-rate change.

    depth: light       re-pulls the revisable periods and rebuilds. ~90 calls.

    depth: full        re-pulls everything from 1996. ~590 calls, so give it
                       --max-calls 200 and let the 6th and 7th finish it.

Either way the workflow validates before it promotes and commits, so a bad
refresh leaves the live snapshot exactly where it is.
NEXT
