from pathlib import Path
from datetime import datetime
from playwright.sync_api import sync_playwright
import shutil

ROOT = Path(__file__).resolve().parents[2]

URL = "https://trade-analytics.commerce.gov.in/public/de"

INCOMING = ROOT / "data" / "dgcis" / "incoming"
RAW = ROOT / "data" / "dgcis" / "raw"

INCOMING.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)


def newest_download(folder: Path):
    files = [p for p in folder.iterdir() if p.is_file()]
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=False,
        slow_mo=150,
    )

    context = browser.new_context(
        accept_downloads=True,
        viewport={"width": 1600, "height": 1000},
    )

    page = context.new_page()

    print("Opening TIA Data Extraction portal...")
    page.goto(URL, wait_until="networkidle", timeout=120000)

    print("""
Requires Playwright, which is deliberately NOT in requirements.txt: this
script is run by a person at a browser, never by CI, and adding it would make
every CI run install a browser it never opens.

    pip install playwright && playwright install chromium

=========================================================
TIA HS8 DOWNLOAD
=========================================================

Please use the open browser to configure:

  Period basis : Calendar Year
  Flow         : Import
  HS level     : HS8
  Country      : World / All as required
  Measure      : Value

Select the required year/month range and the HS8 scope.

When the CAPTCHA appears:

  1. Solve it manually.
  2. Submit the query.
  3. Wait until the result table is visible.

DO NOT download yet.

Return to this Terminal once the table is visible.
=========================================================
""")

    input("Press ENTER after CAPTCHA is solved and results are visible... ")

    print("""
Now return to the browser and click the portal's Excel/Download button.

The script will watch for the download.
""")

    try:
        with page.expect_download(timeout=120000) as download_info:
            input("Press ENTER here immediately BEFORE clicking Download in the browser... ")

        download = download_info.value

        suggested = download.suggested_filename or "tia_hs8_download.xlsx"

        timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")

        incoming_path = INCOMING / suggested
        download.save_as(str(incoming_path))

        raw_name = f"{timestamp}_{suggested}"
        raw_path = RAW / raw_name

        shutil.copy2(incoming_path, raw_path)

        print("\nDownload captured successfully.")
        print("Incoming:", incoming_path)
        print("Archived raw:", raw_path)

    except Exception as exc:
        print("\nAutomatic download capture did not complete.")
        print(exc)
        print("""
If the browser downloaded the file into your normal Downloads folder,
move it manually into:

    data/dgcis/incoming/

Then continue with the processing step.
""")

    input("\nPress ENTER to close the browser...")
    browser.close()
