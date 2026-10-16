"""
Fills the gaps in our card lists:
  English  = TCGdex (what the app downloads)  + pkmn.gg English list + dextcg.com
  Japanese = pkmn.gg Japanese list            + dextcg.com
dextcg.com's robots.txt allows crawling; pages are read politely (2 at a time).

Inputs : data/en-pkmngg.json, data/ja-pkmngg.json (from make_ja_pkmngg.py)
Output : data/extra.json
  {built, sets: [{key, lang, name, serie, releaseDate, total}],
   cards: [[setKey, localId, number, name, rarity, artist, thumb, large]]}
         data/gaps.txt  (per-set report: what we had, what was added, what is still missing)
"""
import difflib, gzip, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
UA = {'User-Agent': 'Mozilla/5.0 (CardDex personal collection app; github.com/FriedTohfu/carddex)', 'Accept-Encoding': 'gzip'}
DEX = 'https://dextcg.com'
MAX_PROBES = int(os.environ.get('MAX_PROBES', '20000'))
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


# ---------- our base lists ----------
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
                'total': (full.get('cardCount') or {}).get('total') or len(full['cards']),
            })
    print(f'TCGdex English: {len(out)} sets with cards', flush=True)
    return out


def gg(lang):
    path = os.path.join(DATA, 'ja-pkmngg.json' if lang == 'ja' else 'en-pkmngg.json')
    if not os.path.exists(path):
        return [], {}
    d = json.load(open(path, encoding='utf-8'))
    cards = {}
    for c in d['cards']:
        cards.setdefault(c[1], []).append(c)
    sets = [{
        'id': s['id'], 'key': f"ja:gg-{s['id']}", 'name': s['name'], 'nk': name_key(s['name']), 'day': day(s.get('releaseDate')),
        'release': s.get('releaseDate') or '', 'serie': s.get('series') or '', 'total': s.get('total') or 0,
        'nums': {num_key(c[2]) for c in cards.get(s['id'], [])},
    } for s in d['sets']]
    return sets, cards


# ---------- dextcg.com ----------
def text_of(page):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', page, flags=re.S)
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)))


def meta(page, prop):
    m = re.search(r'<meta[^>]+(?:property|name)="' + re.escape(prop) + r'"[^>]+content="([^"]*)"', page) or \
        re.search(r'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + re.escape(prop) + r'"', page)
    return html.unescape(m.group(1)).strip() if m else ''


def dex_expansions():
    ids = []
    for src in (get(f'{DEX}/sitemap.xml') or '', get(f'{DEX}/expansions') or ''):
        for e in re.findall(r'dextcg\.com/expansions/([A-Za-z0-9_.-]+)|href="/expansions/([A-Za-z0-9_.-]+)"', src):
            i = e[0] or e[1]
            if i and i not in ids:
                ids.append(i)
    return ids


def dex_expansion(eid):
    page = get(f'{DEX}/expansions/{eid}')
    if not page:
        return None
    t = text_of(page)
    count = re.search(r'Number of Cards\s*(\d+)', t) or re.search(r'See all\s*(\d+)\s*cards', t, re.I) or re.search(r'(\d+)\s*Cards', t)
    date = re.search(r'(' + MONTHS + r')\s+(\d{1,2}),\s+(\d{4})', t)
    title = meta(page, 'og:title') or (re.search(r'<title>(.*?)</title>', page, re.S) or [None, ''])[1]
    title = html.unescape(title)
    for _ in range(3):
        title = re.sub(r'\s*[|\-–—]\s*(Expansions?|Dex|DexTCG|Pok[eé]mon TCG)\s*$', '', title).strip()
    sample = []
    for cid in re.findall(r'/cards/([A-Za-z0-9_.%-]+)', page):
        cid = urllib.parse.unquote(cid)
        if cid.startswith(eid + '-'):
            n = cid[len(eid) + 1:]
            if n not in sample:
                sample.append(n)
    release = ''
    if date:
        release = datetime.strptime(f'{date.group(1)} {date.group(2)} {date.group(3)}', '%B %d %Y').strftime('%Y-%m-%d')
    return {'id': eid, 'name': title or eid, 'release': release, 'count': int(count.group(1)) if count else 0, 'sample': sample}


def dex_card(eid, num):
    page = get(f'{DEX}/cards/{eid}-{urllib.parse.quote(num)}', tries=2)
    if not page:
        return None
    title = meta(page, 'og:title')
    desc = meta(page, 'description') or meta(page, 'og:description')
    name = re.sub(r'\s+-\s+[^-]+$', '', title).strip() if ' - ' in title else title
    if not name:
        return None
    rarity = (re.search(r'card [^,]+,\s*([^,]+?),\s*illustrated', desc) or [None, ''])[1]
    artist = (re.search(r'illustrated by (.+?)\.?$', desc) or [None, ''])[1]
    img = re.search(r'https://static\.dextcg\.com/cards/[^"\'\s)]+?\.(?:png|jpg|webp)', page)
    img = html.unescape(img.group(0)) if img else ''
    thumb = f'{DEX}/cdn-cgi/image/w=300,q=80,f=auto/{img}' if img else ''
    large = f'{DEX}/cdn-cgi/image/w=800,q=85,f=auto/{img}' if img else ''
    return [name, rarity, artist, thumb, large]


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


# ---------- main ----------
def main():
    out_sets, out_cards, report = [], [], []
    have = {}  # setKey -> numbers we already have (base + added)

    en_base = tcgdex_en()
    if not en_base:
        print('TCGdex unavailable — stopping'); sys.exit(1)
    ja_base, _ = gg('ja')
    for s in en_base + ja_base:
        have[s['key']] = set(s['nums'])
    added = {}

    def add(setKey, local, number, name, rarity, artist, thumb, large):
        k = num_key(local)
        if k in have.setdefault(setKey, set()):
            return False
        have[setKey].add(k)
        out_cards.append([setKey, str(local), number or str(local), name, rarity or '', artist or '', thumb or '', large or ''])
        added[setKey] = added.get(setKey, 0) + 1
        return True

    # 1) English: pkmn.gg's English list
    en_gg, en_gg_cards = gg('en')
    for s in en_gg:
        m = match_set(s['name'], s['release'], en_base)
        cards = en_gg_cards.get(s['id'], [])
        if not cards:
            continue
        if m:
            key = m['key']
        else:
            key = f"en:x-{s['id']}"
            out_sets.append({'key': key, 'lang': 'en', 'name': s['name'], 'serie': s['serie'], 'releaseDate': s['release'], 'total': len(cards)})
            en_base.append({'key': key, 'name': s['name'], 'nk': name_key(s['name']), 'day': s['day'], 'nums': set(), 'total': len(cards)})
            report.append(f'NEW SET en  {s["name"]} ({s["release"]}) from pkmn.gg: {len(cards)} cards')
        for c in cards:
            add(key, c[2], c[3], c[5] or c[4], c[6], c[7] if c[7] and c[7].lower() != 'n/a' else '', c[9], c[10])
    print(f'pkmn.gg English: {len(out_cards)} cards added', flush=True)

    # 2) dextcg.com, both languages
    ids = dex_expansions()
    print(f'dextcg: {len(ids)} expansions', flush=True)
    with ThreadPoolExecutor(2) as ex:
        infos = [i for i in ex.map(dex_expansion, ids) if i]
    print(f'dextcg: read {len(infos)} expansion pages; sample {infos[:2]}', flush=True)
    probes = 0
    jobs = []
    for info in infos:
        eid = info['id']
        if eid.startswith('scn_') or eid.startswith('jpn_'):
            continue  # Japanese now comes whole from dextcg (make_ja_dex.py)
        lang = 'ja' if eid.startswith('jpn_') else 'en'
        base = ja_base if lang == 'ja' else en_base
        m = match_set(info['name'], info['release'], base)
        want = candidates(info)
        if not want:
            report.append(f'SKIP {lang} {info["name"]} [{eid}]: unknown numbering ({info["count"]} cards, sample {info["sample"][:3]})')
            continue
        if m:
            key = m['key']
        else:
            key = f'{lang}:x-dex-{eid}'
            out_sets.append({'key': key, 'lang': lang, 'name': info['name'], 'serie': '', 'releaseDate': info['release'], 'total': info['count']})
            base.append({'key': key, 'name': info['name'], 'nk': name_key(info['name']), 'day': day(info['release']), 'nums': set(), 'total': info['count']})
            report.append(f'NEW SET {lang} {info["name"]} ({info["release"]}) from dextcg: {info["count"]} cards')
        missing = [n for n in want if num_key(n) not in have.get(key, set())]
        if len(missing) > 300 and m:
            report.append(f'SKIP {lang} {info["name"]} [{eid}] -> {key}: {len(missing)} missing looks like a numbering mismatch')
            continue
        for n in missing:
            jobs.append((key, eid, n))
    jobs = jobs[:MAX_PROBES]
    print(f'dextcg: {len(jobs)} card pages to read', flush=True)

    def probe(j):
        time.sleep(0.25)
        return j, dex_card(j[1], j[2])
    with ThreadPoolExecutor(2) as ex:
        for i, ((key, eid, n), got) in enumerate(ex.map(probe, jobs), 1):
            probes += 1
            if got:
                name, rarity, artist, thumb, large = got
                add(key, n, n, name, rarity, artist, thumb, large)
            if i % 500 == 0:
                print(f'  {i}/{len(jobs)} card pages, {len(out_cards)} cards added', flush=True)

    # report
    names = {s['key']: s['name'] for s in en_base + ja_base}
    for k, n in sorted(added.items(), key=lambda x: -x[1]):
        report.append(f'ADDED {n:4d}  {k}  {names.get(k, "")}')
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    json.dump({'built': built, 'sets': out_sets, 'cards': out_cards},
              open(os.path.join(DATA, 'extra.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    open(os.path.join(DATA, 'gaps.txt'), 'w', encoding='utf-8').write('\n'.join(report) + '\n')
    ip = os.path.join(DATA, 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    index['extra'] = {'built': built, 'count': len(out_cards), 'sets': len(out_sets), 'file': 'extra.json'}
    json.dump(index, open(ip, 'w'), indent=1)
    en_n = sum(1 for c in out_cards if c[0].startswith('en:'))
    print(f'Saved {len(out_cards)} extra cards ({en_n} English, {len(out_cards) - en_n} Japanese), {len(out_sets)} new sets, {probes} dextcg card pages read', flush=True)


if __name__ == '__main__':
    main()
