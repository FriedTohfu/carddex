"""
Builds the Japanese card list from pkmn.gg (every Japanese set back to 1996,
with Japanese card scans). Reads the same pages a browser does (their robots.txt
allows it), politely: a couple of pages at a time.

Output: data/ja-pkmngg.json
  {built, sets: [{id, name, series, releaseDate, total, printed, logo, symbol}],
   cards: [[id, setId, number, numberDisplay, nameJa, nameEn, rarity, artist, type, thumb, large]]}
"""
import gzip, json, os, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'ja-pkmngg.json')
BASE = 'https://www.pkmn.gg'
UA = {'User-Agent': 'Mozilla/5.0 (CardDex personal collection app; github.com/FriedTohfu/carddex)', 'Accept-Encoding': 'gzip'}


def page_data(path, tries=4):
    """The JSON a pkmn.gg page is built from."""
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=60) as r:
                b = r.read()
                if b[:2] == b'\x1f\x8b':
                    b = gzip.decompress(b)
                m = re.search(rb'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>', b, re.S)
                return json.loads(m.group(1))['props']['pageProps'] if m else None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(3 + i * 5)
        except Exception:
            time.sleep(3 + i * 5)
    return None


def main():
    idx = page_data('/jp/series')
    series = [s['id'] for s in (idx or {}).get('serieses', [])]
    if not series:
        print('Could not read the series list — keeping the previous file'); sys.exit(0)
    print(f'{len(series)} series', flush=True)
    sets = []
    for sid in series:
        d = page_data(f'/jp/series/{sid}') or {}
        for s in d.get('sets', []):
            sets.append(s)
        time.sleep(0.5)
    print(f'{len(sets)} sets', flush=True)

    def read_set(s):
        d = page_data(f"/jp/series/{s['series']}/{s['slug']}")
        time.sleep(0.5)
        return s, (d or {}).get('cardData')

    out_sets, out_cards, failed = [], [], []
    with ThreadPoolExecutor(2) as ex:
        for n, (s, cards) in enumerate(ex.map(read_set, sets), 1):
            if cards is None:
                failed.append(s['slug']); continue
            out_sets.append({
                'id': s['id'], 'name': s.get('name') or s['id'], 'series': s.get('seriesDisplay') or s.get('series') or '',
                'releaseDate': (s.get('releaseDateValue') or s.get('releaseDate') or '')[:10],
                'total': s.get('total') or len(cards), 'printed': s.get('printedTotal') or 0,
                'logo': s.get('logo') or '', 'symbol': s.get('symbol') or '',
            })
            for c in cards:
                num = str(c.get('numberDisplay') or c.get('number') or '')
                tot = c.get('totalDisplay')
                out_cards.append([
                    c['id'], s['id'], str(c.get('number') or ''), f'{num}/{tot}' if tot else num,
                    (c.get('altName') or {}).get('JP') or '', c.get('name') or '',
                    re.sub(r'_JP$', '', c.get('rarity') or ''), c.get('artist') or '', c.get('cardType') or '',
                    c.get('thumbImageUrl') or '', c.get('largeImageUrl') or '',
                ])
            if n % 50 == 0:
                print(f'  {n}/{len(sets)} sets, {len(out_cards)} cards', flush=True)
    if failed:
        print(f'{len(failed)} sets could not be read: {failed[:20]}', flush=True)
    if len(out_cards) < 1000:
        print('Too few cards — keeping the previous file'); sys.exit(0)
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'built': built, 'source': 'pkmn.gg', 'sets': out_sets, 'cards': out_cards},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    ip = os.path.join(ROOT, 'data', 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    index['jaGG'] = {'built': built, 'count': len(out_cards), 'sets': len(out_sets), 'file': 'ja-pkmngg.json'}
    json.dump(index, open(ip, 'w'), indent=1)
    with_img = sum(1 for c in out_cards if c[9])
    print(f'Saved {len(out_sets)} sets, {len(out_cards)} cards ({with_img} with pictures)', flush=True)


if __name__ == '__main__':
    main()
