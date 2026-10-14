import json, urllib.request, os, collections
os.makedirs('out5', exist_ok=True)
UA={'User-Agent':'Mozilla/5.0 (CardDex personal collection app)'}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()[:300]
    except Exception as e: return 0, str(e).encode()
out={}
s,b=get('https://www.jpn-cards.com/v2/set/'); out['sets_status']=s
sets=json.loads(b) if s==200 else []
out['nsets']=len(sets)
sets.sort(key=lambda x: str(x.get('date') or ''))
out['oldest']=[(x.get('name'),x.get('set_code'),x.get('date'),x.get('card_count'),x.get('id')) for x in sets[:60]]
out['total_cards']=sum(int(x.get('card_count') or 0) for x in sets)
json.dump(sets,open('out5/sets.json','w'),ensure_ascii=False)
for x in sets[:3]+[y for y in sets if 'Jungle' in str(y.get('name'))][:1]:
    s2,b2=get(f"https://www.jpn-cards.com/v2/card/?set_id={x['id']}")
    try: cards=json.loads(b2)
    except Exception: cards=[]
    if isinstance(cards,dict): cards=cards.get('data') or cards.get('cards') or []
    out[f"cards_{x.get('name')}"]=[s2,len(cards),[(c.get('name'),c.get('printedNumber'),c.get('hp'),c.get('artist'),c.get('imageUrl')) for c in cards[:4]]]
    hosts=collections.Counter(str(c.get('imageUrl','')).split('/')[2] if '//' in str(c.get('imageUrl','')) else 'none' for c in cards)
    out[f"hosts_{x.get('name')}"]=dict(hosts)
    if cards and cards[0].get('imageUrl'):
        s3,b3=get(cards[0]['imageUrl']); out[f"img_{x.get('name')}"]=[s3,len(b3)]
json.dump(out,open('out5/res.json','w'),ensure_ascii=False,indent=1)
