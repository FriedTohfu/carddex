import json, urllib.request, os
os.makedirs('out5', exist_ok=True)
UA={'User-Agent':'Mozilla/5.0 (CardDex personal collection app)'}
out={}
for u in ['https://www.jpn-cards.com/v2/set/','https://www.jpn-cards.com/v2/set','https://jpn-cards.com/v2/set/','https://www.jpn-cards.com/v2/sets/','https://www.jpn-cards.com/set/','https://www.jpn-cards.com/sets','https://www.jpn-cards.com/','https://www.jpn-cards.com/v2/card/?set_code=s10D','https://www.jpn-cards.com/card/?set_code=s10D']:
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60) as r: out[u]=[r.status, r.read()[:400].decode('utf-8','replace')]
    except urllib.error.HTTPError as e: out[u]=[e.code, e.read()[:200].decode('utf-8','replace')]
    except Exception as e: out[u]=[0,str(e)[:200]]
json.dump(out,open('out5/res.json','w'),ensure_ascii=False,indent=1)
