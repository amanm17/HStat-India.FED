#!/usr/bin/env python3
"""
One command for the monthly DGCIS refresh.

    python3 pipeline/dgcis/refresh_dgcis.py

It opens the TIA portal, waits while you set the query and solve the CAPTCHA,
catches the download, and then runs the rest by itself: validate, process
(with the flow guard), build the frontend files, and report what moved since
last month.

WHY A PERSON IS STILL IN THE MIDDLE

The portal is CAPTCHA-gated. That gate is there on purpose and is not worked
around here - no solver, no token replay, no headless impersonation. The
browser is visible, you drive the part that needs a human, and the script does
the twenty minutes of careful work on either side of it.

TWO FLOWS, TWO DOWNLOADS

India's exports at the tariff line and India's imports at the tariff line are
separate queries, and the extract does not record which one it is. So each
download is taken under a flow you name, saved under a filename that says so,
and checked against Comtrade before it is allowed through. This is the one
place in the pipeline where a human assertion becomes data, which is exactly
why it is the place with the guard.

    --flow exports          just the one
    --skip-download         use whatever is already in data/dgcis/incoming/
    --no-diff               skip the month-on-month report
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

INCOMING = ROOT / "data" / "dgcis" / "incoming"
RAW = ROOT / "data" / "dgcis" / "raw"
PUBLIC = ROOT / "public" / "data" / "dgcis"

FLOWS = ("exports", "imports")

PORTAL = "https://trade-analytics.commerce.gov.in/public/de?pg=de"


def run(step: str, argv: list[str]) -> None:
    """A step that must succeed, with its output shown as it happens."""
    print(f"\n{'─' * 66}\n{step}\n{'─' * 66}", flush=True)

    result = subprocess.run([sys.executable, *argv], cwd=ROOT)

    if result.returncode != 0:
        raise SystemExit(
            f"\n{step} failed (exit {result.returncode}). "
            "Nothing further has been run, and the published files are "
            "untouched."
        )


def snapshot_published() -> dict:
    """
    What is on disk now, before the rebuild replaces it.

    Taken from the published index rather than the processed CSVs, because
    that is what the dashboard is actually serving today, and "what changed"
    means what changed for a reader.
    """
    index = PUBLIC / "hs8-index.json"
    manifest = PUBLIC / "manifest.json"

    if not index.exists():
        return {}

    payload = json.loads(index.read_text())

    return {
        "lines": {
            line["hs8"]: {
                flow: (line["flows"].get(flow) or {}).get("last12UsdMillion")
                for flow in FLOWS
            }
            for line in payload.get("lines", [])
        },
        "manifest": json.loads(manifest.read_text()) if manifest.exists() else {},
    }


def report_diff(before: dict) -> None:
    index = PUBLIC / "hs8-index.json"
    manifest = PUBLIC / "manifest.json"

    if not index.exists():
        return

    after = json.loads(index.read_text())
    now = json.loads(manifest.read_text()) if manifest.exists() else {}

    print(f"\n{'─' * 66}\nWhat changed\n{'─' * 66}")

    if not before:
        print("Nothing was published here before; this is the first build.")
        print(f"  {len(after.get('lines', []))} tariff lines, "
              f"{now.get('firstPeriod')} → {now.get('lastPeriod')}")
        return

    was = before["manifest"]

    if was.get("lastPeriod") != now.get("lastPeriod"):
        print(f"  latest month  : {was.get('lastPeriod')} → {now.get('lastPeriod')}")
    else:
        # Worth saying out loud. A refresh that brings back the same last
        # month usually means the query was run on the wrong period, and a
        # silent no-op is how that goes unnoticed for a month.
        print(f"  latest month  : {now.get('lastPeriod')} — UNCHANGED since the "
              f"last build. Check the period range on the portal query.")

    if was.get("flows") != now.get("flows"):
        print(f"  flows         : {was.get('flows')} → {now.get('flows')}")

    old_lines = before["lines"]
    new_lines = {
        line["hs8"]: {
            flow: (line["flows"].get(flow) or {}).get("last12UsdMillion")
            for flow in FLOWS
        }
        for line in after.get("lines", [])
    }

    added = sorted(set(new_lines) - set(old_lines))
    dropped = sorted(set(old_lines) - set(new_lines))

    print(f"  tariff lines  : {len(old_lines)} → {len(new_lines)}"
          f"{f'   +{len(added)}' if added else ''}"
          f"{f'   -{len(dropped)}' if dropped else ''}")

    if added:
        print(f"    new     : {', '.join(added[:12])}"
              f"{' …' if len(added) > 12 else ''}")

    if dropped:
        # Not a warning to skip past: a line the portal stopped returning is
        # either a schedule change or a narrower query than last month.
        print(f"    MISSING : {', '.join(dropped[:12])}"
              f"{' …' if len(dropped) > 12 else ''}")

    for flow in FLOWS:
        moves = []

        for hs8, values in new_lines.items():
            new = values.get(flow)
            old = (old_lines.get(hs8) or {}).get(flow)

            if new is None or old is None or old <= 0:
                continue

            moves.append((new - old, (new - old) / old, hs8, old, new))

        if not moves:
            continue

        # Rounding noise is not movement. Listing eight lines that each moved
        # by 0.0 reads as a report of change where there was none.
        moves = [item for item in moves if abs(item[0]) >= 0.05]

        if not moves:
            print(f"\n  12-month totals, {flow}: no line moved by more than "
                  f"0.05 USD mn.")
            continue

        moves.sort(key=lambda item: -abs(item[0]))

        print(f"\n  biggest 12-month movers, {flow} (USD mn)")

        for change, ratio, hs8, old, new in moves[:8]:
            print(f"    {hs8}  {old:12,.1f} → {new:12,.1f}   "
                  f"{'+' if change >= 0 else ''}{change:,.1f}  "
                  f"({'+' if ratio >= 0 else ''}{ratio * 100:.1f}%)")


def capture(flow: str) -> Path:
    """
    Drive one download, with the human doing the part only a human can.

    Playwright is imported here rather than at the top so that
    --skip-download works on a machine that has never installed it.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit(
            "Playwright is needed to open the portal, and is deliberately not "
            "in requirements.txt - this script is run by a person at a "
            "browser, never by CI.\n\n"
            "    pip install playwright && playwright install chromium\n\n"
            "Or download by hand and re-run with --skip-download."
        )

    target = INCOMING / f"DGCIS_DATA_{flow}.csv"

    with sync_playwright() as play:
        browser = play.chromium.launch(headless=False, slow_mo=120)
        context = browser.new_context(
            accept_downloads=True, viewport={"width": 1600, "height": 1000}
        )
        page = context.new_page()

        print(f"\nOpening the TIA Data Extraction portal for {flow.upper()}…")
        page.goto(PORTAL, wait_until="networkidle", timeout=120_000)

        print(f"""
{'=' * 66}
DOWNLOAD {flow.upper()}
{'=' * 66}

In the browser window:

  Trade flow   : {'Export' if flow == 'exports' else 'Import'}   <- this one matters most
  HS level     : HS8
  Country      : World
  Measure      : Value
  Period       : the full range you want, ending with the newest month

Solve the CAPTCHA, submit, and wait until the results table is on screen.

The flow you picked in the browser must be {flow.upper()}. The file will not
say, and the guard downstream will refuse the run if it disagrees - which is
the point, but it is faster to get it right here.
{'=' * 66}""")

        input(f"\nPress ENTER when the {flow} results are on screen… ")

        print("\nNow click the portal's download button. Waiting for it…")

        try:
            with page.expect_download(timeout=180_000) as info:
                pass

            download = info.value
            download.save_as(str(target))

            stamp = datetime.now().strftime("%Y%m%dT%H%M%SZ")
            archive = RAW / f"{stamp}_{flow}_DGCIS_DATA.csv"
            shutil.copy2(target, archive)

            print(f"\nSaved   : {target.relative_to(ROOT)}")
            print(f"Archived: {archive.relative_to(ROOT)}")

        except Exception as exc:
            print(f"\nThe download was not caught automatically: {exc}")
            print(f"""
If the browser saved it to your Downloads folder, move it to:

    {target.relative_to(ROOT)}

then re-run with --skip-download.""")
            input("\nPress ENTER to close the browser… ")
            browser.close()
            raise SystemExit("stopping: no file captured")

        input("\nPress ENTER to close the browser… ")
        browser.close()

    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flow", choices=FLOWS, action="append", default=None)
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--no-diff", action="store_true")
    args = parser.parse_args()

    flows = args.flow or list(FLOWS)

    INCOMING.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    if args.skip_download:
        missing = [
            flow for flow in flows
            if not (INCOMING / f"DGCIS_DATA_{flow}.csv").exists()
        ]

        if missing:
            raise SystemExit(
                "--skip-download, but these are not in "
                f"{INCOMING.relative_to(ROOT)}: "
                + ", ".join(f"DGCIS_DATA_{flow}.csv" for flow in missing)
            )

    before = snapshot_published()

    for flow in flows:
        if not args.skip_download:
            capture(flow)

        run(f"Validating the {flow} extract",
            [str(HERE / "validate_hs8.py"), "--flow", flow])

        run(f"Processing the {flow} extract",
            [str(HERE / "process_tia_hs8.py"), "--flow", flow])

    # Built once, after every flow is in, so a two-flow refresh never leaves
    # the published files holding one new flow and one old one.
    run("Building the frontend files", [str(HERE / "build_frontend_hs8.py")])

    if not args.no_diff:
        report_diff(before)

    print(f"""
{'─' * 66}
Done. {PUBLIC.relative_to(ROOT)} is rebuilt.

Check it locally before shipping:

    npm run build && npm run preview

then commit and push - the deploy runs from main.
{'─' * 66}""")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
