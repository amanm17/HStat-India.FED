"""
Pre-deploy sanity check on the snapshot that is about to ship.

validate_snapshot.py proves a staging snapshot is internally consistent.
This runs against whatever is in `public/data/snapshots/current` at build
time and asks a narrower question: is this thing fit to put in front of a
user?

It is deliberately cheap and deliberately loud. A build should not go out
with an empty catalogue, a search index that has drifted from the sector
definition, or a headline figure of zero.
"""

from __future__ import annotations

from pathlib import Path
import argparse
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "pipeline"))

from definition import hs6_universe, parent_universe  # noqa: E402

APP_TSX = ROOT / "src" / "App.tsx"


def frontend_schema() -> str:
    """
    The snapshot version the built frontend will actually accept.

    Read from the frontend rather than repeated here, because the failure this
    guards against is the two drifting apart: a snapshot that passes a stale
    check in this file and then renders as a schema-mismatch screen for every
    visitor. If the constant cannot be found the deploy stops rather than
    guessing - an unreadable guard is not a guard.
    """
    if not APP_TSX.exists():
        raise SystemExit(
            f"Cannot read {APP_TSX.relative_to(ROOT)} to learn which snapshot "
            "version the frontend accepts."
        )

    match = re.search(
        r"^const SCHEMA\s*=\s*['\"]([^'\"]+)['\"]",
        APP_TSX.read_text(),
        re.MULTILINE,
    )

    if not match:
        raise SystemExit(
            f"No `const SCHEMA` in {APP_TSX.relative_to(ROOT)}. That constant "
            "is what decides whether the dashboard renders or shows a mismatch "
            "notice, so the deploy cannot be checked without it."
        )

    return match.group(1)


class Check:
    def __init__(self):
        self.problems: list[str] = []
        self.notes: list[str] = []

    def require(self, condition, message: str):
        if not condition:
            self.problems.append(message)

    def note(self, message: str):
        self.notes.append(message)


def read(path: Path):
    if not path.exists():
        return None

    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as error:
        raise SystemExit(f"{path} is not valid JSON: {error}")


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--snapshot",
        default=str(ROOT / "public" / "data" / "snapshots" / "current"),
    )

    parser.add_argument(
        "--library",
        default=str(ROOT / "public" / "data" / "hs-library.json"),
    )

    parser.add_argument(
        "--sample",
        type=int,
        default=25,
        help="How many node files to open and inspect.",
    )

    args = parser.parse_args()

    snapshot = Path(args.snapshot)

    check = Check()

    manifest = read(snapshot / "manifest.json")

    catalogue = read(snapshot / "catalogue.json")

    methodology = read(snapshot / "methodology.json")

    qa = read(snapshot / "qa.json")

    library = read(Path(args.library))

    check.require(manifest is not None, "manifest.json is missing")
    check.require(catalogue, "catalogue.json is missing or empty")
    check.require(methodology is not None, "methodology.json is missing")
    check.require(library, "hs-library.json is missing or empty")

    if check.problems:
        for problem in check.problems:
            print(f"FAIL {problem}")

        raise SystemExit(2)

    # A fixture snapshot is fabricated data wearing a real snapshot's clothes.
    # It is what makes offline development possible and it must never leave
    # the machine it was built on.
    check.require(
        not manifest.get("fixture"),
        "this snapshot was built from fabricated fixture data and must not be "
        "deployed. Run a real refresh, or `git checkout public/data/snapshots` "
        "to restore the last published one.",
    )

    expected = frontend_schema()

    check.require(
        manifest.get("schemaVersion") == expected,
        f"snapshot is schema {manifest.get('schemaVersion')} but this build of "
        f"the dashboard reads {expected}. Deploying would put a mismatch "
        "notice in front of every visitor, so nothing ships until the "
        "snapshot is rebuilt.",
    )

    check.note(f"schema           : {expected} (frontend and snapshot agree)")

    if qa is not None:
        check.require(
            not qa.get("failures"),
            f"snapshot carries {len(qa.get('failures', []))} QA failures",
        )

        check.note(f"QA warnings: {len(qa.get('warnings', []))}")

    # --- the definition and the shipped data must agree -------------------

    expected = set(hs6_universe())

    shipped = {
        entry["code"] for entry in catalogue if entry.get("level") == 6
    }

    missing = expected - shipped

    extra = shipped - expected

    check.require(
        not missing,
        f"{len(missing)} definition codes are absent from the catalogue: "
        + ", ".join(sorted(missing)[:8]),
    )

    check.require(
        not extra,
        f"{len(extra)} catalogue codes are not in the sector definition: "
        + ", ".join(sorted(extra)[:8]),
    )

    indexed = {entry["code"] for entry in library}

    check.require(
        expected <= indexed,
        "the search index is missing codes that the catalogue publishes",
    )

    for level, codes in parent_universe().items():
        absent = [
            code
            for code in codes
            if not (snapshot / "parents" / level / f"{code}.json").exists()
        ]

        check.require(
            not absent,
            f"{len(absent)} HS-{level} parent nodes are missing",
        )

    # --- a headline that a user would actually see ------------------------

    published = [
        entry
        for entry in catalogue
        if entry.get("level") == 6 and entry.get("globalTrade") is not None
    ]

    check.require(
        published,
        "no product has a published global trade figure; the dashboard "
        "would open empty",
    )

    check.note(
        f"products with a published global trade figure: "
        f"{len(published)}/{len(shipped)}"
    )

    for entry in published[: args.sample]:
        code = entry["code"]

        if entry["globalTrade"] <= 0:
            check.problems.append(f"{code}: global trade figure is not positive")

        share = entry.get("indiaShare")

        if share is not None and not 0 <= share <= 1:
            check.problems.append(f"{code}: India share out of bounds ({share})")

    sample = [entry["code"] for entry in catalogue[: args.sample]]

    for code in sample:
        level = next(
            entry["level"] for entry in catalogue if entry["code"] == code
        )

        path = (
            snapshot / "products" / f"{code}.json"
            if level == 6
            else snapshot / "parents" / str(level) / f"{code}.json"
        )

        node = read(path)

        if node is None:
            check.problems.append(f"{code}: node file missing")
            continue

        if not node.get("annual"):
            check.problems.append(f"{code}: node has no annual records")

    # --- report -----------------------------------------------------------

    print("HStat launch sanity")
    print(f"  snapshot        : {snapshot}")
    print(f"  refreshed       : {manifest.get('refreshedAt')}")
    print(f"  nodes           : {manifest.get('nodes')}")
    print(f"  HS-6 products   : {len(shipped)}")
    print(f"  search records  : {len(library)}")
    print(f"  monthly periods : {len(manifest.get('months', []))}")
    print(f"  global basis    : {manifest.get('globalTradeBasis')}")

    for note in check.notes:
        print(f"  {note}")

    if check.problems:
        print()

        for problem in check.problems:
            print(f"FAIL {problem}")

        raise SystemExit(2)

    print("\nSanity checks passed.")


if __name__ == "__main__":
    main()
