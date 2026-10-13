import urllib.request, os, json, gzip
os.makedirs('out3', exist_ok=True)
UA={'User-Agent':'Mozilla/5.0 (CardDex personal collection app)'}
st={}
def get(name,url,save=True):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=60) as r:
            b=r.read(); s=r.status; ct=r.headers.get('Content-Type','')
    except urllib.error.HTTPError as e: b=e.read()[:2000]; s=e.code; ct=''
    except Exception as e: b=str(e).encode(); s=0; ct=''
    if b[:2]==b'\x1f\x8b':
        b=gzip.decompress(b)
    st[name]=[s,len(b),ct,b[:150].decode('utf-8','replace')]
    if save: open(f'out3/{name}','wb').write(b)
B='https://www.pokemon-card.com'
for cid in ['47734','41682','23055','27761','36718','31553','43322']:
    get(f'detail_{cid}.html', f'{B}/card-search/details.php/card/{cid}/regu/all')
get('search_index.html', f'{B}/card-search/index.php?mode=statuslist')
get('resultAPI.json', f'{B}/card-search/resultAPI.php?keyword=&se_ta=&regulation_sidebar_form=all&pg=&illust=&sm_and_keyword=true&page=1')
get('products.html', f'{B}/products/')
get('arch_img_direct', 'https://archives.bulbagarden.net/media/upload/6/6e/TCG2_A01_Bulbasaur.png')
get('wb_card.html', 'https://web.archive.org/web/2025id_/https://bulbapedia.bulbagarden.net/wiki/Bulbasaur_(Expansion_Pack)')
get('wb_vending.html', 'https://web.archive.org/web/2025id_/https://bulbapedia.bulbagarden.net/wiki/Vending_Machine_cards_(TCG)')
get('wb_cdx.txt', 'https://web.archive.org/cdx/search/cdx?url=archives.bulbagarden.net/media/upload/*&filter=urlkey:.*expansionpack.*&limit=50')
get('pokellector', 'https://jp.pokellector.com/sets', save=False)
get('tcgcollector', 'https://www.tcgcollector.com/sets/jp', save=False)
json.dump(st, open('out3/status.json','w'), indent=1, ensure_ascii=False)
