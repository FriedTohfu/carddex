"""
Shared helpers for the card-list builders (dextcg pages, set matching, TCGdex English).
Used by make_ja_dex.py, fix_series.py and add_ja_names.py.
"""
import difflib, gzip, html, json, os, re, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

UA = {'User-Agent': 'Mozilla/5.0 (CardDex personal collection app; github.com/FriedTohfu/carddex)', 'Accept-Encoding': 'gzip'}
DEX = 'https://dextcg.com'
MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'


def get(url, tries=4, as_json=False):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
                if b[:2] == b'\x1f\x8b':
                    b = gzip.decompress(b)
                return json.loads(b) if as_json else b.decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            time.sleep(3 + i * 5)
        except Exception:
            time.sleep(3 + i * 5)
    return None


def num_key(x):
    """'001' -> '1', 'TG01' -> 'TG1', 'SWSH165' -> 'SWSH165'."""
    x = str(x or '').strip().upper().split('/')[0]
    m = re.match(r'^([A-Z-]*?)0*(\d+)([A-Z]*)$', x)
    return f'{m.group(1)}{int(m.group(2))}{m.group(3)}' if m else x


def digits(x):
    m = re.search(r'\d+', str(x or '').split('/')[0])
    return int(m.group(0)) if m else str(x or '').upper()


def name_key(x):
    x = html.unescape(str(x or '')).lower().replace('&', 'and')
    x = re.sub(r'^(scarlet and violet|sword and shield|sun and moon|black and white|diamond and pearl|heartgold and soulsilver|mega evolution|xy|ex)\s*[:\-—–]\s*', '', x)
    return re.sub(r'[^a-z0-9]', '', x)


def day(s):
    try:
        return datetime.strptime(str(s)[:10], '%Y-%m-%d')
    except Exception:
        return None


STRICT = ('promo', 'energy', 'deck', 'kit', 'starter', 'mcdonald', 'trick or trade', 'futsal', 'box')


def flags(name):
    """Words that make a set a different product (promos, energies, decks...)."""
    n = str(name or '').lower()
    return frozenset(w for w in STRICT if w in n)


def match_set(name, date, candidates):
    """Best base set for a source set: same name, or similar name released within a few days."""
    nk, d = name_key(name), day(date)
    fl = flags(name)
    best, score = None, 0
    for c in candidates:
        ck = c['nk']
        if not ck or not nk or flags(c['name']) != fl:
            continue
        s = 1.0 if ck == nk else difflib.SequenceMatcher(None, nk, ck).ratio()
        if ck != nk and (ck in nk or nk in ck) and min(len(ck), len(nk)) >= 4:
            s = max(s, 0.85)
        cd = c['day']
        if d and cd:
            gap = abs((d - cd).days)
            if gap <= 3:
                s += 0.3
            elif gap > 60:
                s -= 0.5
        if s > score:
            best, score = c, s
    return best if score >= 0.95 else None


def tcgdex_en():
    briefs = get('https://api.tcgdex.net/v2/en/sets', as_json=True) or []
    print(f'TCGdex English: {len(briefs)} sets', flush=True)

    def one(b):
        return get(f"https://api.tcgdex.net/v2/en/sets/{urllib.parse.quote(b['id'])}", as_json=True)
    out = []
    with ThreadPoolExecutor(4) as ex:
        for full in ex.map(one, briefs):
            if not full or not full.get('cards'):
                continue
            out.append({
                'key': f"en:{full['id']}", 'name': full.get('name') or full['id'], 'nk': name_key(full.get('name')),
                'day': day(full.get('releaseDate')), 'nums': {num_key(c.get('localId')) for c in full['cards']},
                'cards': [(name_key(c.get('name')), digits(c.get('localId'))) for c in full['cards']],
                'ids': [(c['id'], str(c.get('localId') or '')) for c in full['cards']],
                'total': (full.get('cardCount') or {}).get('total') or len(full['cards']),
            })
    print(f'TCGdex English: {len(out)} sets with cards', flush=True)
    return out


def text_of(page):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', page, flags=re.S)
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)))


def meta(page, prop):
    m = re.search(r'<meta[^>]+(?:property|name)="' + re.escape(prop) + r'"[^>]+content="([^"]*)"', page) or \
        re.search(r'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + re.escape(prop) + r'"', page)
    return html.unescape(m.group(1)).strip() if m else ''


def candidates(info):
    """Card numbers a dextcg expansion should have, in its own numbering style."""
    n, sample = info['count'], info['sample']
    if not n or not sample:
        return []
    parts = [re.match(r'^([A-Za-z-]*)(\d+)$', s) for s in sample]
    if not all(parts):
        return []
    prefixes = {p.group(1) for p in parts}
    if len(prefixes) != 1:
        return []
    pre = prefixes.pop()
    width = max(len(p.group(2)) for p in parts) if any(p.group(2).startswith('0') for p in parts) else 0
    return [f'{pre}{str(i).zfill(width)}' for i in range(1, n + 1)]
