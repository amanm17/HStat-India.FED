from pathlib import Path
import argparse,re
import pandas as pd
from common import ROOT,DGCIS_NORMALIZED,clean_code
ALIASES={
'code':['hs code','hscode','itc hs code','itc(hs) code','commodity code','itc hs'],
'description':['description','commodity','commodity description'],
'value':['value','trade value','value in us$','value in usd','value in million us$','value in million usd','value in rs. cr.','value in rs cr'],
'year':['year','financial year','period'],'country':['country','country name','partner','country/region'],
'quantity':['quantity','qty'],'unit':['unit','qty unit','quantity unit']}
def norm(s): return re.sub(r'\s+',' ',str(s).strip().lower())
def pick(cols,names):
    lookup={norm(c):c for c in cols}
    return next((lookup[norm(n)] for n in names if norm(n) in lookup),None)
def read_any(p): return pd.read_excel(p) if p.suffix.lower() in {'.xlsx','.xls'} else pd.read_csv(p)
def normalize_file(path,flow):
    df=read_any(path); cols={k:pick(df.columns,v) for k,v in ALIASES.items()}
    if not cols['code'] or not cols['value']: raise RuntimeError(f'{path.name}: cannot identify HS/value columns: {list(df.columns)}')
    out=pd.DataFrame(); out['hs8']=df[cols['code']].map(clean_code).str.zfill(8); out=out[out['hs8'].str.fullmatch(r'\d{8}',na=False)]; out['hs6']=out['hs8'].str[:6]
    out['description']=df[cols['description']].astype(str) if cols['description'] else ''
    out['value']=pd.to_numeric(df[cols['value']],errors='coerce'); out['year']=df[cols['year']].astype(str) if cols['year'] else ''; out['country']=df[cols['country']].astype(str) if cols['country'] else ''
    out['quantity']=pd.to_numeric(df[cols['quantity']],errors='coerce') if cols['quantity'] else pd.NA; out['unit']=df[cols['unit']].astype(str) if cols['unit'] else ''; out['flow']=flow; out['source_file']=path.name
    return out.dropna(subset=['value'])
def main():
    p=argparse.ArgumentParser(); p.add_argument('--incoming',default=str(ROOT/'data'/'dgcis'/'incoming')); a=p.parse_args(); inc=Path(a.incoming)
    files=sorted([x for x in inc.glob('*') if x.suffix.lower() in {'.csv','.xlsx','.xls'}])
    if not files: print('No DGCIS/TradeStat files found. Nothing changed.'); return
    frames=[]
    for f in files:
        n=f.name.lower(); flow='M' if 'import' in n else 'X' if 'export' in n else None
        if not flow: print(f'Skipping {f.name}: filename must contain import or export'); continue
        frames.append(normalize_file(f,flow))
    if not frames: raise RuntimeError('No DGCIS files normalized')
    out=pd.concat(frames,ignore_index=True); DGCIS_NORMALIZED.mkdir(parents=True,exist_ok=True); dest=DGCIS_NORMALIZED/'latest.parquet'; out.to_parquet(dest,index=False); print(f'Normalized DGCIS/TradeStat: {len(out):,} rows -> {dest}')
if __name__=='__main__': main()
