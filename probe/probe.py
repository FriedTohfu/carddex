import json, urllib.request, urllib.parse, os, time
UA={'User-Agent':'CardDex/1.0 (personal collection app; github.com/FriedTohfu/carddex)'}
API='https://bulbapedia.bulbagarden.net/w/api.php'
os.makedirs('out',exist_ok=True)
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=40) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()[:500]
    except Exception as e: return 0, str(e).encode()
def wikitext(title):
    s,b=get(API+'?'+urllib.parse.urlencode({'action':'parse','page':title,'prop':'wikitext','format':'json','redirects':1}))
    name=title.replace('/','_').replace(' ','_')[:80]
    open(f'out/{name}.txt','wb').write(b); print(title,s,len(b),flush=True); time.sleep(1)
for t in ['Pokémon Trading Card Game','List of Japanese Pokémon Trading Card Game expansions','Expansion Pack (TCG)','Bulbasaur (Base Set 44)',
          'Vending Machine cards (TCG)','Intro Pack (TCG)','Japanese promotional cards (TCG)','Miscellaneous Promotional cards (TCG)','Mega Brave (TCG)','Beat of the Frontier (TCG)','Pokémon-e Starter Deck (TCG)','List of Japanese Pokémon Trading Card Game promotional cards']:
    wikitext(t)
s,b=get(API+'?action=query&list=search&srsearch=Bulbasaur+Expansion+Pack&format=json'); open('out/search.json','wb').write(b); print('search',s)
s,b=get('https://archives.bulbagarden.net/w/api.php?action=query&list=allimages&aiprefix=BulbasaurBaseSet&format=json'); open('out/archives.json','wb').write(b); print('archives api',s,b[:300])
s,b=get('https://archives.bulbagarden.net/media/upload/thumb/2/27/BulbasaurBaseSet44.jpg/200px-BulbasaurBaseSet44.jpg'); print('archive img',s,len(b))
s,b=get('https://api.tcgdex.net/v2/ja/sets/PMCG1'); open('out/tcgdex_pmcg1.json','wb').write(b); print('tcgdex',s,len(b))
