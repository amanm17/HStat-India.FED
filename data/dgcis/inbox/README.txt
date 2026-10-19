DGCIS HS-8 inbox

Put the two DGCIS portal downloads here, commit and push:

    DGCIS_DATA_exports.csv
    DGCIS_DATA_imports.csv

.zip or .csv.gz is fine (recommended: the wide scope makes each file several
MB). If the portal needs the chapters split across queries, name the parts
DGCIS_DATA_exports_1.csv, DGCIS_DATA_exports_2.csv and so on; they are joined.

What to select in the portal:  python3 pipeline/dgcis/refresh_dgcis.py --scope

The "DGCIS HS-8 refresh" workflow validates both flows, checks each against
Comtrade, rebuilds public/data/dgcis, commits it and empties this folder. It
waits until both flows are here. A failed check publishes nothing.
