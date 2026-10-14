import json, urllib.request, os
os.makedirs('out5', exist_ok=True)
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'CardDex'}),timeout=60) as r: return json.loads(r.read())
    except Exception as e: return {'err': str(e)}
out={}
lst=get('https://api.tcgdex.net/v2/ja/sets')
out['n_sets']=len(lst) if isinstance(lst,list) else lst
ids=[s['id'] for s in lst] if isinstance(lst,list) else []
out['vintage_in_list']=[i for i in ids if i.startswith(('PMCG','neo','VS','web','E','PCG','ADV'))]
for sid in ['PMCG1','neo1','PCG1','E1','SV2a']:
    d=get(f'https://api.tcgdex.net/v2/ja/sets/{sid}')
    out[sid]={'name':d.get('name'),'releaseDate':d.get('releaseDate'),'cardCount':d.get('cardCount'),'ncards':len(d.get('cards') or []),'first':(d.get('cards') or [None])[0],'err':d.get('err')}
json.dump(out,open('out5/res.json','w'),ensure_ascii=False,indent=1)
