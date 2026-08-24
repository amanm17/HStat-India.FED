# HStat.India

HStat.India is a static trade-data dashboard designed around a strict rule:

> The public dashboard reads only validated stored snapshots. It never queries UN Comtrade or DGCIS at page-load time.

## Launch architecture

1. **Acquire**
   - UN Comtrade: global HS-6 and India trade.
   - DGCIS / TradeStat: India ITC(HS)-8, ingested from official CSV/XLSX exports.
2. **Process**
   - Normalize rows.
   - Compute global imports, India exports/imports, ranks, shares, trade balance, partners, HHI and historical series.
3. **Validate**
   - Schema checks.
   - Duplicate checks.
   - Arithmetic reconciliation.
   - Reporter-coverage tests.
   - India value reconciliation.
   - Partner-value reconciliation.
4. **Publish**
   - A staging snapshot is promoted only after all critical QA checks pass.
   - Only `current` and `previous` snapshots are retained.
5. **Serve**
   - React/Vite static frontend.
   - GitHub repository.
   - Cloudflare Pages.

## Data principles

- Global comparisons use **HS 2022 / H6 at 6 digits**.
- India national detail uses **ITC(HS) 8-digit** from DGCIS / TradeStat.
- Global totals/ranks/shares are not displayed for a year that fails coverage validation.
- Missing data remains missing. No placeholder or synthetic trade values are used.
- Every product JSON records source, refresh date, classification and QA status.

## Quick start

```bash
cp .env.example .env
# add COMTRADE_API_KEY to .env

./scripts/bootstrap.sh
./scripts/refresh-monthly.sh
npm run dev
```

Deploy only after both commands pass:

```bash
python pipeline/validate_snapshot.py public/data/snapshots/current
npm run build
```

## DGCIS / TradeStat

Place an officially exported CSV/XLSX file in:

```text
data/dgcis/incoming/
```

Then run:

```bash
python pipeline/import_dgcis.py
```

The monthly refresh automatically uses the latest normalized DGCIS dataset if one exists.

## Cloudflare Pages

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

The site is static. The Comtrade API key is not required in Cloudflare.
