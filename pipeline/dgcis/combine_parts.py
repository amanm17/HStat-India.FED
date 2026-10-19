#!/usr/bin/env python3
"""
Join several DGCIS portal downloads of ONE flow into the single file the rest
of the pipeline reads.

    python3 pipeline/dgcis/combine_parts.py --flow exports PART [PART ...]
        -> data/dgcis/incoming/DGCIS_DATA_exports.csv

Why: a wide HS-8 scope (hs_index/hs8_scope.json) may be more than one portal
query returns, so the chapters are split across queries. Each download ends
with its own TOTAL footer; the joined file gets one footer that is the sum of
theirs, so validate_hs8.py can still check the parts against the whole.

Refuses, and writes nothing, when the parts do not line up: different value
columns (different period ranges), the same HS-8 in two parts, or a part with
no TOTAL footer. A single part is copied through unchanged.

Accepts .csv, .csv.gz and .zip (the first .csv inside).
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INCOMING = ROOT / "data" / "dgcis" / "incoming"

VALUE = re.compile(r".+-\d{4}_(INR_Cr|USD_Mn)$")


def read_text(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".zip"):
        with zipfile.ZipFile(path) as archive:
            inner = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if not inner:
                raise SystemExit(f"{path.name}: no .csv inside")
            return archive.read(inner[0]).decode("utf-8-sig")
    if name.endswith(".gz"):
        return gzip.decompress(path.read_bytes()).decode("utf-8-sig")
    return path.read_text(encoding="utf-8-sig")


def number(text: str) -> float | None:
    text = (text or "").replace(",", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def combine(parts: list[Path], target: Path) -> str:
    texts = [read_text(part) for part in parts]

    if len(texts) == 1:
        target.write_text(texts[0], encoding="utf-8")
        return f"1 part copied to {target.relative_to(ROOT)}"

    header = None
    body: list[list[str]] = []
    footers: list[list[str]] = []
    seen: dict[str, str] = {}

    for part, text in zip(parts, texts):
        rows = list(csv.reader(io.StringIO(text)))
        if not rows:
            raise SystemExit(f"{part.name}: empty")

        if header is None:
            header = rows[0]
        elif rows[0] != header:
            raise SystemExit(
                f"{part.name}: columns differ from {parts[0].name} - the parts must "
                "cover the same period range and measures"
            )

        code_at = header.index("HS Code")
        country_at = header.index("Country Name")
        part_footer = []

        for row in rows[1:]:
            if not any(cell.strip() for cell in row):
                continue
            if row[country_at].strip().upper() == "TOTAL":
                part_footer.append(row)
                continue
            code = re.sub(r"\D", "", row[code_at])
            if code in seen:
                raise SystemExit(f"HS-8 {code} is in both {seen[code]} and {part.name}")
            seen[code] = part.name
            body.append(row)

        if len(part_footer) != 1:
            raise SystemExit(f"{part.name}: expected one TOTAL row, found {len(part_footer)}")
        footers.append(part_footer[0])

    footer = list(footers[0])
    for at, column in enumerate(header):
        if VALUE.match(column):
            values = [number(f[at]) for f in footers]
            present = [v for v in values if v is not None]
            footer[at] = f"{sum(present):.6f}".rstrip("0").rstrip(".") if present else ""

    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(body)
        writer.writerow(footer)

    return f"{len(parts)} parts, {len(body)} HS-8 rows -> {target.relative_to(ROOT)}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flow", required=True, choices=("exports", "imports"))
    parser.add_argument("parts", nargs="+", type=Path)
    args = parser.parse_args()

    INCOMING.mkdir(parents=True, exist_ok=True)
    target = INCOMING / f"DGCIS_DATA_{args.flow}.csv"
    print(combine(sorted(args.parts), target))
    return 0


if __name__ == "__main__":
    sys.exit(main())
