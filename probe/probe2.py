import asyncio, json, os, urllib.request, urllib.parse
from playwright.async_api import async_playwright
os.makedirs('out2', exist_ok=True)
UA={'User-Agent':'Mozilla/5.0 (CardDex personal collection app)'}
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=60) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()[:300]
    except Exception as e: return 0, str(e).encode()
# Internet Archive copies
for name, u in [('wb_list','https://web.archive.org/web/2025id_/https://bulbapedia.bulbagarden.net/wiki/List_of_Japanese_Pok%C3%A9mon_Trading_Card_Game_expansions'),
                ('wb_exp','https://web.archive.org/web/2025id_/https://bulbapedia.bulbagarden.net/wiki/Expansion_Pack_(TCG)'),
                ('wb_img','https://web.archive.org/web/2025id_/https://archives.bulbagarden.net/media/upload/2/27/BulbasaurBaseSet44.jpg'),
                ('wb_avail','https://archive.org/wayback/available?url=bulbapedia.bulbagarden.net/wiki/Expansion_Pack_(TCG)')]:
    s,b=get(u); open(f'out2/{name}.bin','wb').write(b); print(name,s,len(b),b[:120],flush=True)
async def main():
    async with async_playwright() as p:
        for headless in (True, False):
            try:
                br = await p.chromium.launch(headless=headless, args=['--disable-blink-features=AutomationControlled'])
            except Exception as e:
                print('launch fail', headless, e); continue
            pg = await br.new_page()
            await pg.goto('https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=Expansion_Pack_(TCG)&prop=wikitext&format=json', timeout=60000)
            for i in range(20):
                t = await pg.content()
                if 'Just a moment' not in t: break
                await pg.wait_for_timeout(1500)
            t = await pg.content()
            print('playwright headless=',headless, 'blocked' if 'Just a moment' in t else 'OK', len(t), flush=True)
            open(f'out2/pw_{headless}.html','w').write(t)
            await br.close()
asyncio.run(main())
for name,u in [('pokellector','https://jp.pokellector.com/sets'),('tcgcollector','https://www.tcgcollector.com/sets/jp'),('pkmncards','https://pkmncards.com/')]:
    s,b=get(u); print(name,s,len(b),flush=True)
