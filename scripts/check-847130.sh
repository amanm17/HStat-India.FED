#!/usr/bin/env bash
set -euo pipefail
python - <<'PY'
import json
from pathlib import Path
p=Path('public/data/snapshots/current/products/847130.json')
x=json.loads(p.read_text())
print('HS 847130',x['description'])
for y,a in x['annual'].items():
 print(y,'India exports',a['india']['exports'],'India imports',a['india']['imports'],'Global imports',a['global']['imports'],'Import coverage',a['global']['importCoverage']['valid'],'India export rank',a['global']['exportRankIndia'],'India export share',a['global']['exportShareIndia'])
PY
