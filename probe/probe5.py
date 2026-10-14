import json, urllib.request, re, os, html, time
os.makedirs('out5', exist_ok=True)
UA={'User-Agent':'Mozilla/5.0 (CardDex personal collection app)'}
pick=json.load(open('pick.json'))
out={}
for code, ids in pick.items():
    names=[]
    for cid in ids:
        try:
            with urllib.request.urlopen(urllib.request.Request(f'https://www.pokemon-card.com/card-search/details.php/card/{cid}/regu/all',headers=UA),timeout=40) as r: t=r.read().decode('utf-8','replace')
        except Exception as e: names.append('ERR'); continue
        names += [html.unescape(re.sub('<[^>]+>','',n)).strip() for h,n in re.findall(r'class="List_item"><a href="([^"]*)"[^>]*>(.*?)</a>', t, re.S) if not h.startswith('http')]
        time.sleep(0.3)
    out[code]=names
json.dump(out,open('out5/res.json','w'),ensure_ascii=False,indent=1)
