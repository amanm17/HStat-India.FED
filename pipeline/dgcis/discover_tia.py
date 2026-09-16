from pathlib import Path
from playwright.sync_api import sync_playwright
import json

URL = "https://trade-analytics.commerce.gov.in/public/de"
OUT = Path("data/dgcis/tia_network_log.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

events = []

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=False,
        slow_mo=100,
    )

    context = browser.new_context(
        accept_downloads=True,
        viewport={"width": 1600, "height": 1000},
    )

    page = context.new_page()

    def record_request(req):
        if req.resource_type not in ("xhr", "fetch", "document"):
            return

        events.append({
            "type": "request",
            "resource_type": req.resource_type,
            "method": req.method,
            "url": req.url,
            "post_data": req.post_data,
        })

    def record_response(resp):
        req = resp.request

        if req.resource_type not in ("xhr", "fetch", "document"):
            return

        events.append({
            "type": "response",
            "resource_type": req.resource_type,
            "status": resp.status,
            "url": resp.url,
            "content_type": resp.headers.get("content-type"),
        })

    page.on("request", record_request)
    page.on("response", record_response)

    print("Opening TIA portal...")
    page.goto(URL, wait_until="domcontentloaded", timeout=120000)

    print("""
IMPORTANT:

In the browser, actually complete ONE data query.

Suggested:
  Year type     : Calendar
  Year          : 2024
  Trade flow    : Import
  Commodity     : HS
  HS level      : HS8
  HS code       : choose ONE code
  Country       : World / All if available
  Measure       : Value

Then:
  1. Click the actual Search / Submit / View Data button.
  2. WAIT until the results table is visible.
  3. If there is an Excel export button, click it once.
  4. Return to Terminal.
  5. Press ENTER.

Do not press ENTER until the result table has appeared.
""")

    input("Press ENTER only after results are visible... ")

    OUT.write_text(
        json.dumps(events, indent=2),
        encoding="utf-8",
    )

    print(f"\nSaved {len(events)} events to:")
    print(OUT.resolve())

    browser.close()
