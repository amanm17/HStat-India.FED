from pathlib import Path
import argparse
import comtradeapicall
from common import ROOT, api_key, require_trade_frame, filter_classic, utc_now, write_json

def call_final(key, period, reporter, cmds, flow, partner):
    return comtradeapicall.getFinalData(
        key,typeCode='C',freqCode='A',clCode='HS',period=period,reporterCode=reporter,
        cmdCode=cmds,flowCode=flow,partnerCode=partner,partner2Code=None,customsCode=None,motCode=None,
        maxRecords=250000,format_output='JSON',aggregateBy=None,breakdownMode='classic',countOnly=None,includeDesc=True)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--start-year',type=int,required=True); p.add_argument('--end-year',type=int,required=True); p.add_argument('--out',required=True); a=p.parse_args()
    codes=[x.strip() for x in (ROOT/'config'/'hs6_universe.txt').read_text().splitlines() if x.strip()]
    if not codes: raise RuntimeError('HS universe empty; run build_hs_library.py first')
    key=api_key(); periods=','.join(str(y) for y in range(a.start_year,a.end_year+1)); cmds=','.join(codes); out=Path(a.out); out.mkdir(parents=True,exist_ok=True)
    jobs=[('india_imports','699','M',None),('india_exports','699','X',None),('global_imports',None,'M','0'),('global_exports',None,'X','0')]
    manifest={'pulledAt':utc_now(),'classification':'H6','periods':periods,'products':len(codes),'files':{}}
    for label,reporter,flow,partner in jobs:
        print(f'Fetching {label}...')
        df=filter_classic(require_trade_frame(call_final(key,periods,reporter,cmds,flow,partner),label))
        if len(df)>=250000: raise RuntimeError(f'{label}: response reached 250,000 rows; split query before use')
        path=out/f'{label}.parquet'; df.to_parquet(path,index=False)
        manifest['files'][label]={'path':str(path),'rows':len(df)}; print(f'  {len(df):,} rows')
    write_json(out/'manifest.json',manifest); print(f'Raw batch stored: {out}')
if __name__=='__main__': main()
