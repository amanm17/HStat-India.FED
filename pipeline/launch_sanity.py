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
        "--build-only",
        action="store_true",
        help=(
            "Check only what decides whether this build can ship: schema "
            "agreement and the fixture stamp. Existing QA failures in the "
            "published snapshot are reported but do not block. Used by "
            "scripts/ship.sh, because a data fault is fixed by rebuilding "
            "the data, and rebuilding the data needs the code pushed first. "
            "Promotion is gated separately, in refresh_monthly.py, which "
            "never publishes a snapshot that fails QA."
        ),
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
        failures = qa.get("failures", [])

        if failures and args.build_only:
            check.note(
                f"QA failures in the published snapshot: {len(failures)} "
                "(not blocking this build - rebuild the data to clear them)"
            )

            for failure in failures[:5]:
                check.note(f"  {failure.get('period') or '-'}: {failure.get('message')}")
        else:
            check.require(
                not failures,
                f"snapshot carries {len(failures)} QA failures",
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

    six = [entry for entry in catalogue if entry.get("level") == 6]

    # Codes the nomenclature has dropped are counted separately. Mixing them
    # into one ratio said "411/418 products have a figure", which reads as
    # seven broken products. Seven of them are retired classifications whose
    # series ended where the HS ended it, and a figure for them would have to
    # be invented.
    retired = [entry for entry in six if entry.get("status") == "retired"]
    active = [entry for entry in six if entry.get("status") != "retired"]

    # Does this snapshot know about retirement at all?
    #
    # Code reaches the site before data does - Cloudflare builds on push, and
    # the snapshot is only rebuilt afterwards by the refresh workflow. So
    # between the two there is a window where this build is running against a
    # snapshot that predates it and carries no `status` on any entry. In that
    # window the checks below would fire on all seven retired codes and block
    # the very push that makes the rebuild possible.
    #
    # Same rule as the QA-failures gate above: a data fault is fixed by
    # rebuilding the data, so it is reported, not blocking. The moment the
    # refresh runs, `status` appears and these become hard failures again.
    classified = any("status" in entry for entry in six)

    published = [entry for entry in active if entry.get("globalTrade") is not None]

    check.require(
        published,
        "no product has a published global trade figure; the dashboard "
        "would open empty",
    )

    check.note(
        f"active products with a published global trade figure: "
        f"{len(published)}/{len(active)}"
    )

    if classified:
        check.note(
            f"retired classifications carried as historical: {len(retired)} "
            f"(no current figure by design)"
        )
    else:
        check.note(
            "this snapshot predates the retired-code change and carries no "
            "classification status; rebuild the data to apply it"
        )

    # --- every code must be identifiable, and identifiable as ITSELF -----
    #
    # 418 codes once shared 248 labels: "Cables" covered eight, "Battery Pack"
    # seven, "Lamps" ten. A reader could not tell which line a card belonged
    # to, and neither could a reviewer checking one against the official text.

    # Same rule as the retirement checks above and the QA gate before them:
    # code reaches the site on push and the snapshot is rebuilt afterwards, so
    # in between this build runs against a snapshot that predates it. Firing
    # here would block the push that makes the rebuild possible.
    named = any("displayName" in entry for entry in six)

    nameless = [
        entry["code"]
        for entry in six
        if not (entry.get("displayName") or "").strip()
    ]

    if nameless and not named:
        check.note(
            f"{len(nameless)} products have no display name - expected until "
            f"the data is rebuilt"
        )
    else:
        check.require(
            not nameless,
            f"{len(nameless)} products have no display name: "
            f"{', '.join(nameless[:10])}",
        )

    undescribed = [
        entry["code"]
        for entry in six
        if not (entry.get("description") or "").strip()
    ]

    check.require(
        not undescribed,
        f"{len(undescribed)} products have no official description: "
        f"{', '.join(undescribed[:10])}",
    )

    by_name: dict[str, list[str]] = {}

    for entry in six:
        key = (entry.get("displayName") or "").strip().lower()

        if key:
            by_name.setdefault(key, []).append(entry["code"])

    shared = {name: codes for name, codes in by_name.items() if len(codes) > 1}

    check.require(
        not shared,
        f"{len(shared)} display names are carried by more than one product: "
        + "; ".join(
            f"{name!r} -> {', '.join(codes)}"
            for name, codes in list(shared.items())[:5]
        ),
    )

    overlong = [
        (entry["code"], entry["displayName"])
        for entry in six
        if len((entry.get("displayName") or "").split()) > 4
    ]

    check.require(
        not overlong,
        f"{len(overlong)} display names run past four words: "
        + "; ".join(f"{code} {name!r}" for code, name in overlong[:5]),
    )

    if named:
        check.note(
            f"display names: {len(by_name)} distinct across {len(six)} products"
        )
    else:
        check.note(
            "this snapshot predates the display-name change; rebuild the data "
            "to apply it"
        )

    # --- India's figure must be India's ----------------------------------
    #
    # The homepage tile used to show the world total under a heading about
    # India's rank. India's value is the exact numerator its share was divided
    # from, so the two must reconcile - if they ever stop, something is
    # multiplying share by world again.

    india_checked = india_bad = 0

    for entry in six:
        value = entry.get("indiaTradeValue")
        world = entry.get("globalTrade")
        share = entry.get("indiaShare")

        if value is None or not world or share is None:
            continue

        india_checked += 1

        if value > world:
            check.problems.append(
                f"{entry['code']}: India's value exceeds the world total "
                f"({value} > {world})"
            )
            india_bad += 1
            continue

        implied = value / world

        if abs(implied - share) > 0.002:
            check.problems.append(
                f"{entry['code']}: India's value does not reconcile with the "
                f"published share ({implied:.4f} vs {share:.4f})"
            )
            india_bad += 1

    check.note(
        f"India values reconciled against published share: "
        f"{india_checked - india_bad}/{india_checked}"
    )

    # The point of the split: a genuinely broken product must not be able to
    # hide in the retired bucket, and a retired one must not be able to hide
    # in the active count.
    undeclared = [
        entry["code"]
        for entry in active
        if entry.get("globalTrade") is None
    ]

    message = (
        f"{len(undeclared)} active products have no global trade figure and "
        f"are not declared retired in config/hs_lineage.csv: "
        f"{', '.join(undeclared[:10])}"
    )

    if undeclared and not classified:
        check.note(f"{message} - expected until the data is rebuilt")
    else:
        check.require(not undeclared, message)

    for entry in retired if classified else []:
        code = entry["code"]

        if entry.get("globalTrade") is not None:
            check.problems.append(
                f"{code}: declared retired but still carries a current "
                f"global trade figure"
            )

        if not entry.get("retiredIn"):
            check.problems.append(f"{code}: retired without a revision year")

        last = entry.get("lastPublishedYear")
        valid_to = entry.get("validTo")

        if last is not None and valid_to is not None and last > valid_to:
            check.problems.append(
                f"{code}: last published year {last} is after the code stopped "
                f"being valid in {valid_to}; a residual filing has been "
                f"treated as a world total"
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
