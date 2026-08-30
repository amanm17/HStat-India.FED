# docs

Documents that explain the dashboard to people who do not run it.

| File | What it is |
| --- | --- |
| `HStat-India-Calculation-Reference.pdf` | The audit companion: every published figure with its formula, the snapshot field it is stored in, the source rows behind it, and the check that would block it. Section 12 is how to reproduce a figure from UN Comtrade without this code. |
| `calculation-reference-print.html` | Source for the reference. Edit this, not the PDF; render with `node docs/render-calc-pdf.js`. |
| `DEPLOY.md` | How to get 2.0 live: probe the key, run the cold build in CI over three days, merge when the snapshot is real. Read this before pushing anything to `main`. |
| `HStat-India-Methodology.pdf` | The methodology sheet, 7 pages A4. What the data is, how the single global trade figure is built, how re-imports and re-exports are removed, how India's tariff lines and the rupee view work, what a heading does not cover, and what keeps it current. |
| `methodology-print.html` | The source the PDF is rendered from. Edit this, not the PDF. |
| `render-methodology-pdf.js` | Renders `methodology-print.html` to the PDF. |

## Re-issuing the PDF

The sheet quotes figures that move with the build: the code counts in Question
1, the heading-coverage table in Question 6, and the call budgets in Question 7.
When those change, edit `methodology-print.html` and re-render. The coverage
numbers come from `config/hs_official_children.json` — regenerate that first
with `python scripts/build_official_children.py`.

```bash
npm i -D playwright                # once
node docs/render-methodology-pdf.js
```

Two things the render depends on:

**IBM Plex must be installed as a system font.** The print sheet resolves
`IBM Plex Serif` / `Sans` / `Mono` from the operating system rather than
fetching them, so the PDF builds identically offline and on a runner with no
egress. On Debian/Ubuntu that is `apt-get install fonts-ibm-plex`; on macOS,
install the family from the IBM Plex release. The script prints a font check
before rendering and will tell you if a family fell back — a silent fallback
is the failure worth catching, because the PDF still looks plausible.

**A page break per question is deliberate.** Each section is forced onto its
own page, and every table, figure and rule card carries `break-inside: avoid`.
If you add a paragraph and a section overflows, the overflow lands on a nearly
empty page rather than flowing; tighten the section or accept the break, but
check the rendered pages before circulating it.

The worked example in Question 3 is illustrative arithmetic, badged as such in
the document. It is not an observation and should not be updated to match real
figures — its job is to show the subtraction, and round numbers do that better.
