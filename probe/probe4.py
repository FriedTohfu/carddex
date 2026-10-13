import urllib.request, time, json, os, gzip
UA={'User-Agent':'Mozilla/5.0 (CardDex personal collection app; github.com/FriedTohfu/carddex)'}
pages=['/wiki/Caterpie_(Expansion_Pack)','/wiki/Metapod_(Expansion_Pack)','/wiki/Weedle_(Expansion_Pack)','/wiki/Nidoran%E2%99%82_(Expansion_Pack)','/wiki/Koffing_(Expansion_Pack)','/wiki/Tangela_(Expansion_Pack)','/wiki/Ivysaur_(Expansion_Pack)','/wiki/Kakuna_(Expansion_Pack)','/wiki/Nidorino_(Expansion_Pack)','/wiki/Venusaur_(Expansion_Pack)',
 '/wiki/Challenge_from_the_Darkness_(TCG)','/wiki/Crossing_the_Ruins..._(TCG)','/wiki/Pok%C3%A9mon_Web_(TCG)','/wiki/Split_Earth_(TCG)','/wiki/Holon_Phantom_(TCG)']
os.makedirs('out4',exist_ok=True)
res=[]
for mode in ['https://web.archive.org/web/2026id_/https://bulbapedia.bulbagarden.net', 'https://web.archive.org/web/2id_/https://bulbapedia.bulbagarden.net']:
  for p in pages:
    t=time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(mode+p,headers=UA),timeout=40) as r: b=r.read(); s=r.status; u=r.geturl()
    except urllib.error.HTTPError as e: s=e.code; b=b''; u=''
    except Exception as e: s=str(e)[:60]; b=b''; u=''
    res.append([mode[-40:],p,s,round(time.time()-t,1),len(b),u[:90]])
    time.sleep(0.5)
# CDX check: is the page archived at all?
for p in pages[:5]:
    t=time.time()
    try:
        with urllib.request.urlopen('https://web.archive.org/cdx/search/cdx?url=bulbapedia.bulbagarden.net'+p+'&limit=3&output=json',timeout=40) as r: b=r.read().decode()
    except Exception as e: b=str(e)
    res.append(['cdx',p,b[:200],round(time.time()-t,1)])
# CommonCrawl index
try:
    with urllib.request.urlopen('https://index.commoncrawl.org/collinfo.json',timeout=40) as r: cols=json.loads(r.read())
    cid=cols[0]['id']
    q=f'https://index.commoncrawl.org/{cid}-index?url=bulbapedia.bulbagarden.net/wiki/Caterpie_(Expansion_Pack)&output=json'
    t=time.time()
    with urllib.request.urlopen(q,timeout=60) as r: b=r.read().decode()
    res.append(['cc',cid,b[:300],round(time.time()-t,1)])
except Exception as e: res.append(['cc','err',str(e)[:200]])
json.dump(res,open('out4/res.json','w'),indent=1)
