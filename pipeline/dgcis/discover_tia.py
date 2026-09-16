#!/usr/bin/env python3
"""
Find out what the TIA portal actually does when you download data.

WHY THIS EXISTS IN THIS FORM

The first version of this script recorded request metadata only - method, URL,
resource type - and nothing else. One run produced eight events, all of them
the page loading its dropdowns, and taught us nothing about the query itself.
Worse, it did not record the download, which is the one event that matters.

Guessing filled the gap instead, and guessing has already cost this project
four rounds on a different portal's URL parameters. So this version records
everything a person would need to reconstruct the request by hand:

  - the POST body of every query, in full
  - response content types and status codes
  - JSON response bodies, truncated but not summarised
  - the download event: suggested filename, and where it came from
  - the page URL at the moment you pressed enter, in case the query is
    encoded in it

Requires Playwright, deliberately NOT in requirements.txt: this is run by a
person at a browser, never by CI.

    pip install playwright && playwright install chromium
    python3 pipeline/dgcis/discover_tia.py

WHAT TO DO WHEN IT OPENS

Run one real query, end to end, including the CAPTCHA and the download. Do not
stop at the results table - the download request is usually separate from the
query request, and it is the one worth having.

Then come back and press enter. The report names exactly which request was the
download and what it carried.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    raise SystemExit(
        "Playwright is not installed.\n"
        "    pip install playwright && playwright install chromium"
    )

ROOT = Path(__file__).resolve().parents[2]
URL = "https://trade-analytics.commerce.gov.in/public/de"
OUT = ROOT / "data" / "dgcis" / "tia_capture.json"
REPORT = ROOT / "data" / "dgcis" / "tia_capture.txt"
DOWNLOADS = ROOT / "data" / "dgcis" / "incoming"

# A JSON body is worth keeping; a 40 MB CSV body is not, and the download
# itself is saved to disk anyway.
MAX_BODY = 4000


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)

    events: list[dict] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(headless=False, slow_mo=60)

        context = browser.new_context(
            accept_downloads=True,
            viewport={"width": 1600, "height": 1000},
        )

        page = context.new_page()

        def on_request(request):
            if request.resource_type not in ("xhr", "fetch", "document"):
                return

            events.append({
                "kind": "request",
                "at": datetime.now(timezone.utc).isoformat(),
                "method": request.method,
                "url": request.url,
                # The whole point. A query the portal sends as a POST body is
                # invisible in the URL, and that is the common case.
                "postData": request.post_data,
                "headers": {
                    key: value
                    for key, value in request.headers.items()
                    if key.lower() in (
                        "content-type", "accept", "x-requested-with",
                    )
                },
            })

        def on_response(response):
            request = response.request

            if request.resource_type not in ("xhr", "fetch", "document"):
                return

            entry = {
                "kind": "response",
                "at": datetime.now(timezone.utc).isoformat(),
                "status": response.status,
                "url": response.url,
                "contentType": response.headers.get("content-type", ""),
                "contentDisposition": response.headers.get(
                    "content-disposition", ""
                ),
            }

            # A JSON body tells you the response shape; a file body does not,
            # and reading a large one here stalls the browser.
            if "json" in entry["contentType"].lower():
                try:
                    entry["body"] = response.text()[:MAX_BODY]
                except Exception as error:
                    entry["bodyError"] = str(error)

            events.append(entry)

        def on_download(download):
            target = DOWNLOADS / download.suggested_filename

            try:
                download.save_as(target)
                saved = str(target.relative_to(ROOT))
            except Exception as error:
                saved = f"(save failed: {error})"

            events.append({
                "kind": "download",
                "at": datetime.now(timezone.utc).isoformat(),
                "suggestedFilename": download.suggested_filename,
                "url": download.url,
                "savedTo": saved,
            })

            print(f"\n  captured download → {saved}")

        page.on("request", on_request)
        page.on("response", on_response)
        page.on("download", on_download)

        print("Opening the TIA data extraction portal…")
        page.goto(URL, wait_until="domcontentloaded", timeout=120000)

        print("""
────────────────────────────────────────────────────────────────
RUN ONE REAL QUERY, ALL THE WAY TO THE DOWNLOAD

Everything is being recorded. Solve the CAPTCHA yourself - nothing
here tries to.

Worth capturing while you are in there, one query each:

  1. Imports, one HS-8 code, World partner, a full year
  2. The same, but EXPORTS       - to learn the flow parameter
  3. The same, but a named COUNTRY rather than World
  4. The same, with QUANTITY included if the portal offers it

Each one teaches the pipeline a dimension it cannot otherwise
guess. One is useful; four is everything.

Press ENTER here only after the file has downloaded.
────────────────────────────────────────────────────────────────
""")

        input("ENTER when done… ")

        final_url = page.url

        browser.close()

    payload = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "finalPageUrl": final_url,
        "events": events,
    }

    OUT.write_text(json.dumps(payload, indent=2))

    # A readable summary beside the raw log, because the useful part is three
    # requests out of two hundred.
    lines: list[str] = []

    lines.append(f"TIA capture — {payload['capturedAt']}")
    lines.append(f"final page URL: {final_url}")
    lines.append("")

    downloads = [e for e in events if e["kind"] == "download"]
    posts = [
        e for e in events
        if e["kind"] == "request" and e["method"] == "POST" and e.get("postData")
    ]

    lines.append(f"downloads captured : {len(downloads)}")

    for item in downloads:
        lines.append(f"  {item['suggestedFilename']}  ←  {item['url']}")
        lines.append(f"    saved to {item['savedTo']}")

    lines.append("")
    lines.append(f"POST queries with a body: {len(posts)}")

    for item in posts:
        lines.append(f"  {item['url']}")
        lines.append(f"    content-type: {item['headers'].get('content-type','')}")
        lines.append(f"    body: {item['postData'][:600]}")
        lines.append("")

    gets = sorted({
        (e["url"].split("?")[0])
        for e in events
        if e["kind"] == "request" and e["method"] == "GET"
    })

    lines.append(f"distinct GET endpoints: {len(gets)}")

    for url in gets:
        sample = next(
            (e["url"] for e in events
             if e["kind"] == "request" and e["url"].startswith(url) and "?" in e["url"]),
            None,
        )
        lines.append(f"  {url}")

        if sample:
            query = parse_qs(urlsplit(sample).query)
            lines.append(f"    params: {json.dumps({k: v[0] for k, v in query.items()})}")

    REPORT.write_text("\n".join(lines))

    print(f"\nraw log  : {OUT.relative_to(ROOT)}  ({len(events)} events)")
    print(f"report   : {REPORT.relative_to(ROOT)}")
    print(f"downloads: {len(downloads)}   POST queries: {len(posts)}")

    if not downloads:
        print(
            "\nNo download was captured. The report still has the query "
            "requests, but the download request is the one that matters - "
            "worth another run that goes all the way through the export."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
