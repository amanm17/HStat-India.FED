"""
Publish the exchange-rate table as a static asset the dashboard can load.

Conversion happens in the browser: a figure is stored once, in US dollars,
and multiplied by its own period's average rate when the reader asks for
rupees. Nothing is stored twice.

The rates themselves used to reach the page only inside the published
snapshot, which meant a new rate could not appear until the whole data
pipeline had been re-run - a rebuild costing hours to change a number that
came from a CSV in this repository. This writes the same table to
public/data/fx-rates.json so it ships with the frontend.

The snapshot stays authoritative where it has an opinion: the dashboard
prefers a rate carried in the snapshot manifest and falls back to this file.
Both are generated from config/fx_inr_usd.csv, so they cannot disagree about
a period they both cover.

    python scripts/build_fx_asset.py
"""

from __future__ import annotations

from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "pipeline"))

import fx  # noqa: E402


def main() -> int:
    table = fx.load()

    published = table.published()

    out = ROOT / "public" / "data" / "fx-rates.json"

    out.parent.mkdir(parents=True, exist_ok=True)

    out.write_text(
        json.dumps(
            {
                "base": "USD",
                "quote": "INR",
                "convention": (
                    "One published period average per row, cited per row. "
                    "Calendar years from the World Bank WDI series "
                    "PA.NUS.FCRF (IMF International Financial Statistics); "
                    "months from FRED EXINUS (US Federal Reserve H.10); "
                    "financial years from Economic Survey Statistical "
                    "Appendix Table 5.4."
                ),
                "generatedFrom": "config/fx_inr_usd.csv",
                "rates": published,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )

    counts = {basis: len(entries) for basis, entries in published.items()}

    print(f"Wrote {out.relative_to(ROOT)}: {counts}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
