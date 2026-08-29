"""
Quality gate for a staging snapshot.

Nothing is promoted to `current` unless this exits clean. Failures block;
warnings are recorded and surfaced in the dashboard's QA panel.

The checks fall into four groups:

  contract    every code in the definition has a node, and every node
              matches its filename and declared level
  arithmetic  balances, net = gross - removed, shares within [0, 1],
              rankings sorted and sequential
  publication no headline, rank or share may exist for a period whose
              reporter coverage did not pass
  plausibility mirror gaps, adjustment coverage and partner reconciliation,
              reported as warnings rather than blocks
"""

from __future__ import annotations

from pathlib import Path
import argparse
import json
import re

from definition import (
    hs6_universe,
    lineage_for,
    load_scope,
    parent_universe,
    retired_codes,
)


def close(a, b, tolerance=1.0) -> bool:
    """Snapshot values are whole dollars; a dollar of drift is rounding."""
    if a is None or b is None:
        return False

    return abs(a - b) <= max(tolerance, max(abs(a), abs(b)) * 1e-9)


class Report:
    def __init__(self):
        self.failures: list[dict] = []
        self.warnings: list[dict] = []

    def fail(self, code, period, message):
        self.failures.append(
            {"code": code, "period": period, "message": message}
        )

    def warn(self, code, period, message):
        self.warnings.append(
            {"code": code, "period": period, "message": message}
        )


def check_ranked_table(report, code, period, label, rows):
    if not rows:
        return

    for index in range(len(rows) - 1):
        if (rows[index]["value"] or 0) < (rows[index + 1]["value"] or 0):
            report.fail(code, period, f"{label} not sorted descending")
            break

    ranks = [row.get("rank") for row in rows]

    if ranks != list(range(1, len(rows) + 1)):
        report.fail(code, period, f"{label} ranks not sequential")

    total_share = sum(row.get("share") or 0 for row in rows)

    if total_share > 1.001:
        report.fail(
            code,
            period,
            f"{label} shares sum to {total_share:.3f}",
        )


def check_partner_set(report, code, period, label, partner_set):
    if not partner_set:
        return

    coverage = partner_set.get("coverage")

    hhi = partner_set.get("hhi")

    top3 = partner_set.get("top3Share")

    rows = partner_set.get("rows", [])

    if coverage is not None and not 0 <= coverage <= 1.20:
        report.fail(code, period, f"{label} coverage impossible: {coverage}")

    if hhi is not None and not 0 <= hhi <= 1:
        report.fail(code, period, f"{label} HHI out of bounds: {hhi}")

    if top3 is not None and not 0 <= top3 <= 1.05:
        report.fail(code, period, f"{label} top-3 share out of bounds: {top3}")

    for index in range(len(rows) - 1):
        if (rows[index]["value"] or 0) < (rows[index + 1]["value"] or 0):
            report.fail(code, period, f"{label} rows not sorted descending")
            break


def check_period(report, code, period, record, mirror_bounds):
    india = record.get("india", {})

    glob = record.get("global", {})

    observed = glob.get("observed", {})

    # --- India arithmetic ------------------------------------------------

    imports = india.get("imports")
    exports = india.get("exports")
    balance = india.get("balance")

    for name, value in [("imports", imports), ("exports", exports)]:
        if value is not None and value < 0:
            report.fail(code, period, f"negative India {name}")

    if imports is not None and exports is not None:
        if not close(balance, exports - imports):
            report.fail(code, period, "India balance arithmetic mismatch")

    # --- Netting arithmetic ---------------------------------------------

    gross_imports = observed.get("grossImports")
    removed = observed.get("reImportsRemoved")
    net_imports = observed.get("netImports")

    if gross_imports is not None and net_imports is not None:
        if not close(net_imports, gross_imports - (removed or 0)):
            report.fail(
                code,
                period,
                "net imports do not equal gross imports less re-imports",
            )

        if net_imports < 0:
            report.fail(code, period, "negative net global imports")

        if removed is not None and removed < 0:
            report.fail(code, period, "negative re-imports removed")

    gross_exports = observed.get("grossExports")
    removed_x = observed.get("reExportsRemoved")
    net_exports = observed.get("netExports")

    if gross_exports is not None and net_exports is not None:
        if not close(net_exports, gross_exports - (removed_x or 0)):
            report.fail(
                code,
                period,
                "net exports do not equal gross exports less re-exports",
            )

    adjustment = observed.get("adjustmentCoverage")

    if adjustment is not None and not 0 <= adjustment <= 1.0001:
        report.fail(
            code,
            period,
            f"re-import adjustment coverage out of bounds: {adjustment}",
        )

    # --- Publication rules ----------------------------------------------

    status = glob.get("coverage", {}).get("status")

    trade = glob.get("trade")

    rank = glob.get("indiaRank")

    share = glob.get("indiaShare")

    top = glob.get("topEconomies", [])

    if status != "VALID":
        if trade is not None or rank is not None or share is not None or top:
            report.fail(
                code,
                period,
                f"headline metrics exposed with coverage status {status}",
            )
    else:
        if trade is None or trade <= 0:
            report.fail(
                code,
                period,
                "VALID coverage without a positive global trade figure",
            )

        if not close(trade, net_imports):
            report.fail(
                code,
                period,
                "published global trade does not equal net global imports",
            )

    if share is not None and not 0 <= share <= 1:
        report.fail(code, period, f"India share out of bounds: {share}")

    if rank is not None and rank < 1:
        report.fail(code, period, f"India rank out of bounds: {rank}")

    check_ranked_table(report, code, period, "top economies", top)

    check_ranked_table(
        report,
        code,
        period,
        "top exporters",
        glob.get("topExporters", []),
    )

    check_partner_set(report, code, period, "suppliers", india.get("suppliers"))

    check_partner_set(
        report,
        code,
        period,
        "destinations",
        india.get("destinations"),
    )

    # --- Plausibility (warnings only) -----------------------------------

    ratio = glob.get("mirror", {}).get("ratio")

    if ratio is not None:
        low, high = mirror_bounds

        if not low <= ratio <= high:
            report.warn(
                code,
                period,
                f"import/export mirror ratio {ratio:.3f} outside "
                f"[{low}, {high}]",
            )

    if status == "VALID" and adjustment is not None and adjustment < 0.25:
        report.warn(
            code,
            period,
            f"only {adjustment:.0%} of the world total came from reporters "
            "that file re-imports separately",
        )


FY_KEY = re.compile(r"^(19|20)\d{2}-\d{2}$")


def check_tariff_lines(report, code, node, rates):
    """
    Tariff lines are financial years and everything else is calendar years.
    The failure this guards against is not a wrong number, it is a right
    number filed under the wrong period - which no amount of reading the page
    would reveal.
    """
    annual = node.get("annual", {})

    for period in annual:
        if not (period.isdigit() and len(period) == 4):
            report.fail(
                code, period, "annual key is not a four-digit calendar year"
            )

        if "hs8" in (annual[period].get("india") or {}):
            report.fail(
                code,
                period,
                "tariff-line detail found inside the calendar-year block; "
                "DGCIS financial years must never be filed under a Comtrade "
                "calendar year",
            )

    block = node.get("tariffLines")

    if not block:
        report.fail(code, None, "node has no tariffLines block")
        return

    if block.get("basis") != "FY":
        report.fail(code, None, "tariffLines basis is not FY")

    for period, entry in (block.get("financialYears") or {}).items():
        if not FY_KEY.match(period):
            report.fail(
                code,
                period,
                "tariff-line period is not a financial year label (2024-25)",
            )
            continue

        meta = entry.get("meta") or {}
        rows = entry.get("rows") or []

        if not rows:
            report.fail(code, period, "financial year present with no rows")
            continue

        if meta.get("lines") != len(rows):
            report.fail(code, period, "tariff-line count does not match rows")

        # A rupee figure may only exist where a sourced rate exists for that
        # exact financial year. This is the guard that stops a rate quietly
        # being carried forward from a neighbouring year.
        has_inr = any(row.get("importsInr") is not None for row in rows) or any(
            row.get("exportsInr") is not None for row in rows
        )

        native_inr = "inr" in (meta.get("native") or [])

        rate = (rates.get("FY") or {}).get(period)

        if has_inr and not native_inr and rate is None:
            report.fail(
                code,
                period,
                "derived rupee values published with no sourced rate for that "
                "financial year",
            )

        if meta.get("rate") is not None and rate is None:
            report.fail(
                code,
                period,
                "financial year carries a rate that is not in the published "
                "rate table",
            )

        for row in rows:
            hs8 = str(row.get("hs8", ""))

            if not (hs8.isdigit() and len(hs8) == 8):
                report.fail(code, period, f"tariff line {hs8!r} is not 8 digits")
                continue

            if node.get("level") == 6 and not hs8.startswith(code):
                report.fail(
                    code,
                    period,
                    f"tariff line {hs8} does not sit beneath this code",
                )

            imports = row.get("imports")
            exports = row.get("exports")
            balance = row.get("balance")

            if (
                imports is not None
                and exports is not None
                and balance is not None
                and not close(balance, exports - imports)
            ):
                report.fail(
                    code, period, f"tariff line {hs8} balance does not reconcile"
                )

        status = (meta.get("reconciliation") or {}).get("status")

        if status == "out-of-band":
            report.warn(
                code,
                period,
                "tariff-line total is far from the Comtrade six-digit figure "
                f"(ratio {meta['reconciliation'].get('ratio')}); check the "
                "value column units",
            )

        if meta.get("complete") is False:
            report.warn(
                code,
                period,
                f"part year ({meta.get('monthsCovered')} of 12 months)",
            )


def check_definition_share(report, code, node):
    """
    A heading's tracked lines are a subset of the heading, so their sum cannot
    exceed it. If it does, either the parent was pulled for a different period
    than its members or a member is not actually inside this heading - both
    invisible on the page, both worth stopping for.
    """
    share = node.get("definitionShare")

    if share is None:
        if node.get("level") != 6:
            report.fail(code, None, "parent node has no definitionShare block")

        return

    if node.get("level") == 6:
        report.fail(code, None, "HS-6 node carries a definitionShare block")
        return

    official = share.get("officialLines")

    defined = share.get("definedLines")

    if official is not None and defined is not None and defined > official:
        report.fail(
            code,
            None,
            f"{defined} tracked lines in a heading the classification says "
            f"holds {official}",
        )

    for period, entry in (share.get("years") or {}).items():
        for label, key in (
            ("global trade", "globalShare"),
            ("India imports", "indiaImportShare"),
        ):
            value = entry.get(key)

            if value is None:
                continue

            if value < 0:
                report.fail(code, period, f"negative {label} coverage share")

            elif value > 1.02:
                report.warn(
                    code,
                    period,
                    f"tracked lines sum to {value:.2f} of the heading's "
                    f"{label}; a subset cannot exceed its heading",
                )


def check_node(report, path: Path, expected_level: int, mirror_bounds, rates):
    node = json.loads(path.read_text())

    code = node.get("code")

    if code != path.stem:
        report.fail(path.stem, None, "node code does not match filename")
        return node

    if node.get("level") != expected_level:
        report.fail(code, None, "node level does not match its directory")

    if node.get("schemaVersion") != "2.0.0":
        report.fail(
            code,
            None,
            f"unexpected schemaVersion {node.get('schemaVersion')}",
        )

    annual = node.get("annual", {})

    if not annual:
        report.fail(code, None, "node has no annual records")
        return node

    for period, record in annual.items():
        check_period(report, code, period, record, mirror_bounds)

    for period, record in node.get("monthly", {}).items():
        if not (len(period) == 6 and period.isdigit()):
            report.fail(code, period, "malformed monthly period key")
            continue

        month = int(period[4:])

        if not 1 <= month <= 12:
            report.fail(code, period, "monthly period has an invalid month")

        check_period(report, code, period, record, mirror_bounds)

    benchmark = node.get("globalTrade")

    if benchmark:
        year = str(benchmark.get("year"))

        if year not in annual:
            report.fail(
                code,
                year,
                "global trade benchmark year missing from annual data",
            )
        else:
            record = annual[year]["global"]

            if record.get("coverage", {}).get("status") != "VALID":
                report.fail(
                    code,
                    year,
                    "benchmark points at a period that did not pass coverage",
                )

            if not close(benchmark.get("value"), record.get("trade")):
                report.fail(
                    code,
                    year,
                    "benchmark value does not match the annual figure",
                )

        check_ranked_table(
            report,
            code,
            year,
            "benchmark top economies",
            benchmark.get("topEconomies", []),
        )

    check_tariff_lines(report, code, node, rates)

    check_definition_share(report, code, node)

    return node


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("snapshot")

    parser.add_argument(
        "--allow-missing",
        type=int,
        default=0,
        help="Tolerate this many definition codes with no node file.",
    )

    args = parser.parse_args()

    root = Path(args.snapshot)

    scope = load_scope()

    mirror_bounds = tuple(scope["globalTrade"]["mirrorWarnRatio"])

    report = Report()

    catalogue_path = root / "catalogue.json"

    if not catalogue_path.exists():
        raise SystemExit("FAIL: catalogue.json missing")

    catalogue = json.loads(catalogue_path.read_text())

    if not catalogue:
        raise SystemExit("FAIL: empty catalogue")

    manifest = json.loads((root / "manifest.json").read_text())

    currency = manifest.get("currency") or {}

    rates = currency.get("rates") or {}

    if currency.get("base") != "USD":
        report.fail(None, None, "snapshot currency base is not USD")

    for basis, entries in rates.items():
        if basis not in {"CY", "FY", "MONTH"}:
            report.fail(None, None, f"unknown rate basis {basis!r}")
            continue

        for period, entry in entries.items():
            if not entry.get("source"):
                report.fail(
                    None,
                    period,
                    f"{basis} rate published with no source; an unsourced rate "
                    "cannot back a published rupee figure",
                )

            if not entry.get("rate") or entry["rate"] <= 0:
                report.fail(None, period, f"{basis} rate is not positive")

    expected_hs6 = set(hs6_universe())

    parents = parent_universe()

    found_hs6: set[str] = set()

    for entry in catalogue:
        code = entry["code"]

        level = entry["level"]

        path = (
            root / "products" / f"{code}.json"
            if level == 6
            else root / "parents" / str(level) / f"{code}.json"
        )

        if not path.exists():
            report.fail(code, None, "node file missing")
            continue

        check_node(report, path, level, mirror_bounds, rates)

        if level == 6:
            found_hs6.add(code)

    missing = sorted(expected_hs6 - found_hs6)

    if len(missing) > args.allow_missing:
        report.fail(
            None,
            None,
            f"{len(missing)} definition codes have no node: "
            + ", ".join(missing[:10]),
        )
    elif missing:
        report.warn(
            None,
            None,
            f"{len(missing)} definition codes have no node (allowed)",
        )

    for level, codes in parents.items():
        for code in codes:
            path = root / "parents" / level / f"{code}.json"

            if not path.exists():
                report.fail(code, None, f"HS-{level} parent node missing")

    # HS 2022 is the base: a retired predecessor may inform the history but
    # must never be published as a product in its own right.
    for code in sorted(retired_codes()):
        if (root / "products" / f"{code}.json").exists():
            report.fail(
                code,
                None,
                "retired code published as a product; HS 2022 is the base",
            )

        if code in found_hs6:
            report.fail(code, None, "retired code present in the catalogue")

    # A split must never be silently apportioned onto its successors.
    for code, entries in lineage_for().items():
        path = root / "products" / f"{code}.json"

        if not path.exists():
            continue

        node = json.loads(path.read_text())

        lineage = node.get("lineage") or {}

        splittable = any(
            entry["relation"] in {"split", "merge"}
            for entry in lineage.get("predecessors", [])
        )

        if splittable and lineage.get("spliced"):
            report.fail(
                code,
                None,
                "a split or merged predecessor was spliced onto the series; "
                "its total cannot be apportioned without inventing a share",
            )

        del entries

    published = sum(
        1 for entry in catalogue if entry.get("globalTrade") is not None
    )

    summary = {
        "nodes": len(catalogue),
        "hs6": len(found_hs6),
        "withPublishedGlobalTrade": published,
        "failures": report.failures,
        "warnings": report.warnings,
    }

    (root / "qa.json").write_text(json.dumps(summary, indent=2))

    print(
        f"QA: {len(catalogue)} nodes | {len(found_hs6)} HS-6 | "
        f"{published} with a published global trade figure | "
        f"{len(report.failures)} failures | {len(report.warnings)} warnings"
    )

    if report.failures:
        for failure in report.failures[:20]:
            print("FAIL", failure)

        raise SystemExit(2)


if __name__ == "__main__":
    main()
