from pathlib import Path
import json
from collections import Counter

ROOT = Path(".")
SNAPSHOT = ROOT / "public" / "data" / "snapshots" / "current"
PRODUCTS = SNAPSHOT / "products"
SEARCH = ROOT / "public" / "data" / "hs-library.json"
UNIVERSE = ROOT / "config" / "hs6_universe.txt"

errors = []
warnings = []


def error(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


# ------------------------------------------------------------
# Universe
# ------------------------------------------------------------

codes = [
    x.strip()
    for x in UNIVERSE.read_text().splitlines()
    if x.strip()
]

if len(codes) != 56:
    error(f"Expected 56 configured HS-6 codes; found {len(codes)}")

if len(codes) != len(set(codes)):
    error("Duplicate HS-6 codes in config/hs6_universe.txt")

for code in codes:
    if not (code.isdigit() and len(code) == 6):
        error(f"Invalid configured HS-6 code: {code}")


# ------------------------------------------------------------
# Product files
# ------------------------------------------------------------

product_files = sorted(PRODUCTS.glob("*.json"))

if len(product_files) != 56:
    error(f"Expected 56 product JSON files; found {len(product_files)}")

product_codes = {
    p.stem
    for p in product_files
}

missing_products = (
    set(codes)
    - product_codes
)

extra_products = (
    product_codes
    - set(codes)
)

if missing_products:
    error(
        "Missing product files: "
        + " ".join(sorted(missing_products))
    )

if extra_products:
    warn(
        "Extra product files: "
        + " ".join(sorted(extra_products))
    )


# ------------------------------------------------------------
# Search index
# ------------------------------------------------------------

library = json.loads(
    SEARCH.read_text()
)

by_code = {
    x["code"]: x
    for x in library
}

loaded_search_codes = {
    x["code"]
    for x in library
    if (
        x.get("level") == 6
        and x.get("loaded") is True
    )
}

missing_search = (
    set(codes)
    - loaded_search_codes
)

if missing_search:
    error(
        "Configured HS codes not selectable in search: "
        + " ".join(sorted(missing_search))
    )

for code in codes:
    for parent in [
        code[:2],
        code[:4],
    ]:
        if parent not in by_code:
            error(
                f"Search hierarchy missing parent {parent} "
                f"for HS {code}"
            )


# ------------------------------------------------------------
# Product-level analytical QA
# ------------------------------------------------------------

latest_years = Counter()
import_benchmark_years = Counter()
export_benchmark_years = Counter()

for path in product_files:
    x = json.loads(
        path.read_text()
    )

    hs = x["hs6"]

    if hs != path.stem:
        error(
            f"{path.name}: hs6 field does not match filename"
        )

    years = x.get(
        "years",
        [],
    )

    if years != sorted(set(years)):
        error(
            f"{hs}: years are duplicated or out of order"
        )

    latest = x.get(
        "latestIndiaYear"
    )

    latest_years[
        latest
    ] += 1

    if latest not in years:
        error(
            f"{hs}: latestIndiaYear {latest} not in years"
        )

    annual = x.get(
        "annual",
        {}
    )

    for year in years:
        y = str(year)

        if y not in annual:
            error(
                f"{hs}: missing annual record for {year}"
            )
            continue

        r = annual[y]

        india = r["india"]
        glob = r["global"]

        im = india["imports"]
        ex = india["exports"]
        bal = india["balance"]

        if im is not None and im < 0:
            error(
                f"{hs}/{year}: negative India imports"
            )

        if ex is not None and ex < 0:
            error(
                f"{hs}/{year}: negative India exports"
            )

        if (
            im is not None
            and ex is not None
        ):
            expected = ex - im

            if (
                bal is None
                or abs(
                    bal - expected
                )
                > max(
                    1,
                    abs(expected) * 1e-9,
                )
            ):
                error(
                    f"{hs}/{year}: trade balance mismatch"
                )

        for flow in [
            "import",
            "export",
        ]:
            coverage = glob[
                f"{flow}Coverage"
            ]

            status = coverage.get(
                "status"
            )

            published = glob[
                "imports"
                if flow == "import"
                else "exports"
            ]

            observed = glob[
                "observedImports"
                if flow == "import"
                else "observedExports"
            ]

            rank = glob[
                f"{flow}RankIndia"
            ]

            share = glob[
                f"{flow}ShareIndia"
            ]

            if (
                observed is not None
                and observed < 0
            ):
                error(
                    f"{hs}/{year}: negative observed global {flow}s"
                )

            if status != "VALID":
                if any(
                    v is not None
                    for v in [
                        published,
                        rank,
                        share,
                    ]
                ):
                    error(
                        f"{hs}/{year}: publishable {flow} metrics "
                        f"exist despite {status} coverage"
                    )

            if status == "VALID":
                if (
                    published is None
                    or published <= 0
                ):
                    error(
                        f"{hs}/{year}: VALID {flow} coverage "
                        "without positive publishable value"
                    )

            if (
                share is not None
                and not (
                    0 <= share <= 1
                )
            ):
                error(
                    f"{hs}/{year}: invalid India {flow} share"
                )


    benchmarks = x.get(
        "benchmarks",
        {}
    )

    for flow, key in [
        (
            "import",
            "globalImports",
        ),
        (
            "export",
            "globalExports",
        ),
    ]:
        b = benchmarks.get(
            key
        )

        if not b:
            error(
                f"{hs}: no VALID global {flow} benchmark"
            )
            continue

        year = b["year"]

        if flow == "import":
            import_benchmark_years[
                year
            ] += 1
        else:
            export_benchmark_years[
                year
            ] += 1

        r = annual[
            str(year)
        ]["global"]

        coverage = r[
            f"{flow}Coverage"
        ]

        if (
            coverage.get(
                "status"
            )
            != "VALID"
        ):
            error(
                f"{hs}: benchmark {year} for {flow} "
                "does not point to VALID coverage"
            )

        annual_value = r[
            "imports"
            if flow == "import"
            else "exports"
        ]

        if (
            annual_value is None
            or abs(
                annual_value
                - b["value"]
            )
            > max(
                1,
                abs(b["value"])
                * 1e-9,
            )
        ):
            error(
                f"{hs}: benchmark {flow} value mismatch"
            )


print("=" * 72)
print("HStat.India launch sanity audit")
print("=" * 72)

print(
    "Configured HS-6:",
    len(codes),
)

print(
    "Product JSONs:",
    len(product_files),
)

print(
    "Selectable HS-6 in search:",
    len(loaded_search_codes),
)

print(
    "\nLatest India years:",
    dict(
        sorted(
            latest_years.items()
        )
    ),
)

print(
    "Global-import benchmark years:",
    dict(
        sorted(
            import_benchmark_years.items()
        )
    ),
)

print(
    "Global-export benchmark years:",
    dict(
        sorted(
            export_benchmark_years.items()
        )
    ),
)

print(
    "\nFailures:",
    len(errors),
)

print(
    "Warnings:",
    len(warnings),
)

for msg in errors[:50]:
    print(
        "FAIL:",
        msg,
    )

for msg in warnings[:50]:
    print(
        "WARN:",
        msg,
    )

if errors:
    raise SystemExit(2)

print(
    "\nPASS — launch data/search contract is internally consistent."
)
