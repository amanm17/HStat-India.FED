from pathlib import Path
import argparse,json
import pandas as pd
from common import ROOT,PUBLIC,DGCIS_NORMALIZED,require_trade_frame,filter_classic,assert_unique,write_json,utc_now

def hs_slice(df,hs,year): return df[(df['cmdCode']==hs)&(df['refYear']==year)].copy()
def world_row(df,hs,year):
    z=hs_slice(df,hs,year); z=z[z['partnerCode'].isin(['0'])]; assert_unique(z,['reporterCode','cmdCode','refYear','flowCode'],f'{hs}/{year} India world')
    return None if z.empty else z.iloc[0]
def partner_rows(df,hs,year):
    z=hs_slice(df,hs,year); z=z[~z['partnerCode'].isin(['0',''])]; assert_unique(z,['partnerCode','cmdCode','refYear','flowCode'],f'{hs}/{year} India partners'); return z.sort_values('primaryValue',ascending=False)
def reporter_rows(df,hs,year):
    z=hs_slice(df,hs,year); z=z[z['partnerCode'].isin(['0'])]; assert_unique(z,['reporterCode','cmdCode','refYear','flowCode'],f'{hs}/{year} global reporters'); return z.sort_values('primaryValue',ascending=False).reset_index(drop=True)
def coverage(cur,prev):
    if cur.empty or prev.empty: return False,{'reason':'missing reporter frame'}
    pc=prev['reporterCode'].nunique(); cc=cur['reporterCode'].nunique(); present=set(cur['reporterCode'].astype(str)); top20=prev.head(20)
    top1=str(prev.iloc[0]['reporterCode']) in present; top10=sum(str(c) in present for c in prev.head(10)['reporterCode']); denom=float(top20['primaryValue'].sum()); num=float(top20[top20['reporterCode'].astype(str).isin(present)]['primaryValue'].sum()); vc=num/denom if denom else 0; cr=cc/pc if pc else 0
    ok=bool(top1 and top10>=9 and vc>=.975 and cr>=.85)
    return ok,{'reporters':cc,'priorReporters':pc,'reporterCountRatio':cr,'priorTop10Present':top10,'priorTop20ValueCoverage':vc,'priorTop1Present':top1}
def ranking(frame,india='699'):
    if frame.empty:return None
    total=float(frame['primaryValue'].sum()); rows=[]
    for i,(_,r) in enumerate(frame.iterrows(),1): rows.append({'rank':i,'code':str(r['reporterCode']),'name':str(r.get('reporterDesc',r['reporterCode'])),'value':float(r['primaryValue']),'share':float(r['primaryValue']/total) if total else None})
    ind=next((x for x in rows if x['code']==india),None); return {'total':total,'india':ind,'top10':rows[:10],'reporterCount':len(rows)}
def partners(frame,total):
    if frame.empty or total is None or total<=0:return {'rows':[],'coverage':None,'hhi':None,'top3Share':None}
    s=float(frame['primaryValue'].sum()); cov=s/total; rows=[{'code':str(r['partnerCode']),'name':str(r.get('partnerDesc',r['partnerCode'])),'value':float(r['primaryValue']),'share':float(r['primaryValue']/total)} for _,r in frame.head(15).iterrows()]
    shares=(frame['primaryValue']/total).fillna(0); hhi=float((shares**2).sum()) if .95<=cov<=1.05 else None; top3=float(shares.head(3).sum()) if .95<=cov<=1.05 else None
    return {'rows':rows,'coverage':cov,'hhi':hhi,'top3Share':top3}
def dgcis_for(hs,year):
    p=DGCIS_NORMALIZED/'latest.parquet'
    if not p.exists():return []
    df=pd.read_parquet(p); z=df[df['hs6'].astype(str)==hs].copy()
    if 'year' in z:
        yz=z[z['year'].astype(str).str.contains(str(year),regex=False)]
        if not yz.empty:z=yz
    if z.empty:return []
    out=z.groupby(['hs8','description','flow'],dropna=False)['value'].sum().reset_index(); piv=out.pivot_table(index=['hs8','description'],columns='flow',values='value',aggfunc='sum',fill_value=0).reset_index(); rows=[]
    for _,r in piv.iterrows():
        im=float(r.get('M',0)); ex=float(r.get('X',0)); rows.append({'hs8':r['hs8'],'description':r['description'],'imports':im,'exports':ex,'balance':ex-im})
    return sorted(rows,key=lambda x:x['imports']+x['exports'],reverse=True)
def main():
    p=argparse.ArgumentParser(); p.add_argument('--raw-dir',required=True); p.add_argument('--out',required=True); p.add_argument('--start-year',type=int,required=True); p.add_argument('--end-year',type=int,required=True); a=p.parse_args(); raw=Path(a.raw_dir); out=Path(a.out); (out/'products').mkdir(parents=True,exist_ok=True)
    frames={n:filter_classic(require_trade_frame(pd.read_parquet(raw/f'{n}.parquet'),n)) for n in ['india_imports','india_exports','global_imports','global_exports']}
    codes=[x.strip() for x in (ROOT/'config'/'hs6_universe.txt').read_text().splitlines() if x.strip()]; library=json.loads((PUBLIC/'hs-library.json').read_text()); desc={x['code']:x['description'] for x in library}; catalogue=[]
    for hs in codes:
        annual={}
        for y in range(a.start_year,a.end_year+1):
            wm=world_row(frames['india_imports'],hs,y); wx=world_row(frames['india_exports'],hs,y); im=float(wm['primaryValue']) if wm is not None else None; ex=float(wx['primaryValue']) if wx is not None else None
            sup=partners(partner_rows(frames['india_imports'],hs,y),im); dst=partners(partner_rows(frames['india_exports'],hs,y),ex)
            gi=reporter_rows(frames['global_imports'],hs,y); gx=reporter_rows(frames['global_exports'],hs,y); gip=reporter_rows(frames['global_imports'],hs,y-1) if y>a.start_year else pd.DataFrame(); gxp=reporter_rows(frames['global_exports'],hs,y-1) if y>a.start_year else pd.DataFrame()
            gi_ok,gi_cov=coverage(gi,gip) if y>a.start_year else (False,{'reason':'baseline year'}); gx_ok,gx_cov=coverage(gx,gxp) if y>a.start_year else (False,{'reason':'baseline year'}); ri=ranking(gi) if gi_ok else None; rx=ranking(gx) if gx_ok else None
            if rx and ex is not None and rx['india']:
                d=abs(rx['india']['value']-ex)
                if d>max(1_000_000,abs(ex)*.01): rx=None; gx_ok=False; gx_cov['reconciliation']=f'India export mismatch {d}'
            if ri and im is not None and ri['india']:
                d=abs(ri['india']['value']-im)
                if d>max(1_000_000,abs(im)*.01): ri=None; gi_ok=False; gi_cov['reconciliation']=f'India import mismatch {d}'
            annual[str(y)]={'india':{'imports':im,'exports':ex,'balance':ex-im if im is not None and ex is not None else None,'suppliers':sup,'destinations':dst,'hs8':dgcis_for(hs,y)},'global':{'imports':ri['total'] if ri else None,'exports':rx['total'] if rx else None,'importRankIndia':ri['india']['rank'] if ri and ri['india'] else None,'importShareIndia':ri['india']['share'] if ri and ri['india'] else None,'exportRankIndia':rx['india']['rank'] if rx and rx['india'] else None,'exportShareIndia':rx['india']['share'] if rx and rx['india'] else None,'topImporters':ri['top10'] if ri else [],'topExporters':rx['top10'] if rx else [],'importCoverage':{'valid':gi_ok,**gi_cov},'exportCoverage':{'valid':gx_ok,**gx_cov}}}
        product={'schemaVersion':'1.0.0','hs6':hs,'description':desc.get(hs,''),'classification':'HS 2022 (H6)','refreshedAt':utc_now(),'years':list(range(a.start_year,a.end_year+1)),'annual':annual,'sources':{'global':'UN Comtrade','indiaHs6':'UN Comtrade','indiaHs8':'DGCIS / TradeStat official export when supplied'}}; write_json(out/'products'/f'{hs}.json',product); catalogue.append({'hs6':hs,'description':product['description'],'years':product['years']})
    write_json(out/'catalogue.json',catalogue); write_json(out/'hs-library.json',library); write_json(out/'manifest.json',{'schemaVersion':'1.0.0','refreshedAt':utc_now(),'classification':'HS 2022 (H6)','startYear':a.start_year,'endYear':a.end_year,'products':len(catalogue)}); print(f'Staging snapshot: {len(catalogue)} products -> {out}')
if __name__=='__main__':main()
