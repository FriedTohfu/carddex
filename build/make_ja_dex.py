"""
Japanese (default) or English card list rebuilt from scratch from dextcg.com's public pages.
Usage: python make_ja_dex.py [ja|en]
TCG Pocket (digital-only) sets are left out.
(robots.txt allows crawling; read politely, 2 pages at a time).

Every Japanese expansion (ids starting jpn_) and every card page in it.
Resumable: cards already read are kept, so a run that runs out of time
carries on next run (only sets released in the last 120 days are re-read).

Output: data/ja-dex.json, same shape the app already reads for Japanese:
  {built, source, sets: [{id, name, series, releaseDate, total, printed, logo, symbol}],
   cards: [[id, setId, number, numberDisplay, nameJa, nameEn, rarity, artist, type, thumb, large]],
   remap: {oldCardId: newCardId}}   # moves your cards from the old pkmn.gg list
and index.json key jaGG pointing at it.
"""
import html, json, os, re, sys, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_extra import (DEX, MONTHS, candidates, day, digits, get, match_set, meta, name_key,  # noqa: E402
                        num_key, tcgdex_en, text_of)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
LANG = (sys.argv[1] if len(sys.argv) > 1 else 'ja').lower()
if LANG not in ('ja', 'en'):
    sys.exit('language must be ja or en')
OUT = os.path.join(DATA, f'{LANG}-dex.json')
OLD = os.path.join(DATA, 'ja-pkmngg.json')
INDEX_KEY = 'jaGG' if LANG == 'ja' else 'enDex'
POCKET = re.compile(r'pocket|genetic apex|mythical island|space-time smackdown|triumphant light|shining revelry|celestial guardians|extradimensional crisis|eevee grove|wisdom of sea and sky|secluded springs|deluxe pack|mega rising|crimson blaze|promo-a\b|promo-b\b', re.I)
MAX_MINUTES = float(os.environ.get('MAX_MINUTES', '300'))
START = time.time()


def expansion_index():
    """[(id, series)] for every Japanese expansion, series from the /expansions page headings."""
    out, seen = [], set()
    page = get(f'{DEX}/expansions') or ''
    series = ''
    for m in re.finditer(r'<h[1-4][^>]*>(.*?)</h[1-4]>|href="/expansions/([A-Za-z0-9_.-]+)"', page, re.S):
        if m.group(1) is not None:
            t = html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip()
            if t and len(t) < 60:
                series = t
        elif m.group(2) and m.group(2) not in seen:
            seen.add(m.group(2)); out.append((m.group(2), series))
    for e in re.findall(r'dextcg\.com/expansions/([A-Za-z0-9_.-]+)', get(f'{DEX}/sitemap.xml') or ''):
        if e not in seen:
            seen.add(e); out.append((e, ''))
    if LANG == 'ja':
        return [(e, s) for e, s in out if e.startswith('jpn_')]
    return [(e, s) for e, s in out if not re.match(r'(jpn|scn|chn|kor|tcgp)_', e) and 'pocket' not in s.lower()]


def expansion(eid):
    page = get(f'{DEX}/expansions/{eid}')
    if not page:
        return None
    t = text_of(page)
    count = re.search(r'Number of Cards\s*(\d+)', t) or re.search(r'See all\s*(\d+)\s*cards', t, re.I) or re.search(r'(\d+)\s*Cards', t)
    date = re.search(r'(' + MONTHS + r')\s+(\d{1,2}),\s+(\d{4})', t)
    title = html.unescape(meta(page, 'og:title') or (re.search(r'<title>(.*?)</title>', page, re.S) or [None, ''])[1])
    for _ in range(3):
        title = re.sub(r'\s*[|\-–—]\s*(Expansions?|Dex|DexTCG|Pok[eé]mon TCG)\s*$', '', title).strip()
    sample = []
    for cid in re.findall(r'/cards/([A-Za-z0-9_.%-]+)', page):
        cid = urllib.parse.unquote(cid)
        if cid.startswith(eid + '-'):
            n = cid[len(eid) + 1:]
            if n not in sample:
                sample.append(n)
    logo = re.search(r'https://static\.dextcg\.com/content/sets/[^"\'\s)]*logo[^"\'\s)]*', page)
    symbol = re.search(r'https://static\.dextcg\.com/content/sets/[^"\'\s)]*symbol[^"\'\s)]*', page)
    release = ''
    if date:
        release = datetime.strptime(f'{date.group(1)} {date.group(2)} {date.group(3)}', '%B %d %Y').strftime('%Y-%m-%d')
    return {'id': eid, 'name': title or eid, 'release': release, 'count': int(count.group(1)) if count else 0, 'sample': sample,
            'logo': html.unescape(logo.group(0)) if logo else '', 'symbol': html.unescape(symbol.group(0)) if symbol else ''}


def card(eid, num):
    page = get(f'{DEX}/cards/{eid}-{urllib.parse.quote(num)}', tries=2)
    if not page:
        return None
    title, desc = meta(page, 'og:title'), meta(page, 'description') or meta(page, 'og:description')
    name = title.split(' - ')[0].strip()  # og:title is "<card> - <set name>"; set names can contain '-'
    if not name:
        return None
    rarity = (re.search(r'card [^,]+,\s*([^,]+?),\s*illustrated', desc) or [None, ''])[1]
    artist = (re.search(r'illustrated by (.+?)(?:\.\s+Check\b.*)?\.?$', desc) or [None, ''])[1].strip()
    if rarity.lower() == 'no rarity':
        rarity = ''
    t = text_of(page)
    kind = 'Trainer' if re.search(r'Trainer Type', t) else 'Energy' if re.search(r'\bEnergy$', name) else 'Pokémon'
    img = re.search(r'https://static\.dextcg\.com/cards/[^"\'\s)]+?\.(?:png|jpg|webp)', page)
    img = html.unescape(img.group(0)) if img else ''
    thumb = f'{DEX}/cdn-cgi/image/w=300,q=80,f=auto/{img}' if img else ''
    large = f'{DEX}/cdn-cgi/image/w=800,q=85,f=auto/{img}' if img else ''
    return [f'{eid}-{num}', eid, num, num, '', name, rarity, artist, kind, thumb, large]


def save(sets, cards, remap, final=False, setmap=None):
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    json.dump({'built': built, 'source': 'dextcg', 'complete': final, 'sets': sets, 'cards': cards,
               'remap': remap, 'setmap': setmap or {}},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    if final:
        ip = os.path.join(DATA, 'index.json')
        index = json.load(open(ip)) if os.path.exists(ip) else {}
        index[INDEX_KEY] = {'built': built, 'count': len(cards), 'sets': len(sets), 'file': os.path.basename(OUT), 'source': 'dextcg'}
        json.dump(index, open(ip, 'w'), indent=1)


def main():
    prev = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    prev_cards = {c[0]: c for c in prev.get('cards', [])}
    recent = (datetime.now() - timedelta(days=120)).strftime('%Y-%m-%d')

    idx = expansion_index()
    print(f'{len(idx)} {LANG} expansions', flush=True)
    if len(idx) < 50:
        print('Too few expansions found — stopping'); sys.exit(1)
    with ThreadPoolExecutor(2) as ex:
        infos = list(ex.map(lambda e: (expansion(e[0]), e[1]), idx))
    sets, jobs, cards = [], [], []
    for info, series in infos:
        if not info:
            continue
        if POCKET.search(info['name']) or POCKET.search(series):
            print('  skipping TCG Pocket set', info['id'], info['name'], flush=True)
            continue
        sets.append({'id': info['id'], 'name': info['name'], 'series': series, 'releaseDate': info['release'],
                     'total': info['count'], 'printed': 0, 'logo': info['logo'], 'symbol': info['symbol']})
        nums = candidates(info)
        if not nums:  # odd numbering: what the page shows, plus plain numbers
            nums = list(dict.fromkeys(info['sample'] + [str(i) for i in range(1, info['count'] + 1)]))
        else:
            nums = list(dict.fromkeys(nums + info['sample']))
        fresh = info['release'] >= recent
        for n in nums:
            old = prev_cards.get(f"{info['id']}-{n}")
            if old and not fresh:
                cards.append(old)
            else:
                jobs.append((info['id'], n))
    print(f'{len(sets)} sets, {len(cards)} cards kept from last run, {len(jobs)} card pages to read', flush=True)
    print('sample set:', sets[:2], flush=True)

    if os.environ.get('QUICK'):
        jobs = [j for k, j in enumerate(jobs) if k % max(1, len(jobs) // 40) == 0][:40]
        got = [card(*j) for j in jobs]
        for g in got[:8]:
            print('  card:', g, flush=True)
        print(f'QUICK: {sum(1 for g in got if g)}/{len(got)} card pages read, {sum(1 for g in got if g and g[9])} with pictures', flush=True)
        return
    remap, setmap = {}, {}
    out_of_time = False

    def read(j):
        if (time.time() - START) / 60 > MAX_MINUTES:
            return j, 'stop'
        time.sleep(0.15)
        return j, card(*j)
    with ThreadPoolExecutor(2) as ex:
        for i, (j, got) in enumerate(ex.map(read, jobs), 1):
            if got == 'stop':
                out_of_time = True
                continue
            if got:
                cards.append(got)
            elif prev_cards.get(f'{j[0]}-{j[1]}'):
                cards.append(prev_cards[f'{j[0]}-{j[1]}'])
            if i % 1000 == 0:
                print(f'  {i}/{len(jobs)} pages, {len(cards)} cards', flush=True)
                save(sets, cards, remap)

    # English: move your cards from TCGdex (and the gap-fill sets) to the new list
    if LANG == 'en':
        base = [{'key': s['id'], 'name': s['name'], 'nk': name_key(s['name']), 'day': day(s['releaseDate'])} for s in sets]
        by_set_num = {(c[1], num_key(c[2])): c[0] for c in cards}
        by_set_dig = {}
        for c in cards:
            by_set_dig.setdefault((c[1], digits(c[2])), c[0])
        olds = [(t['key'][3:], t['name'], t['day'].strftime('%Y-%m-%d') if t['day'] else '', t.get('ids', [])) for t in tcgdex_en()]
        xp = os.path.join(DATA, 'extra.json')
        if os.path.exists(xp):
            for st in json.load(open(xp, encoding='utf-8')).get('sets', []):
                if st['key'].startswith('en:x-') and not st['key'].startswith('en:x-dex-'):
                    olds.append((st['key'][3:], st['name'], st.get('releaseDate', ''), []))
        for sid, name, rel, ids in olds:
            m = match_set(name, rel, base)
            if not m:
                continue
            setmap[sid] = m['key']
            for cid, local in ids:
                nid = by_set_num.get((m['key'], num_key(local))) or by_set_dig.get((m['key'], digits(local)))
                if nid:
                    remap[cid] = nid
        print(f'{len(setmap)}/{len(olds)} old sets matched, {len(remap)} old cards mapped', flush=True)

    # Japanese: move your cards from the old pkmn.gg list: same set (name + date) and number
    if LANG == 'ja' and os.path.exists(OLD):
        old = json.load(open(OLD, encoding='utf-8'))
        base = [{'key': s['id'], 'name': s['name'], 'nk': name_key(s['name']), 'day': day(s['releaseDate'])} for s in sets]
        by_set_num = {(c[1], num_key(c[2])): c[0] for c in cards}
        for s in old['sets']:
            m = match_set(s['name'], s.get('releaseDate'), base)
            if m:
                setmap[s['id']] = m['key']
                mine = next((x for x in sets if x['id'] == m['key']), None)
                if mine and not mine['series']:
                    mine['series'] = s.get('series') or ''
        for c in old['cards']:
            new_set = setmap.get(c[1])
            nid = by_set_num.get((new_set, num_key(c[2]))) if new_set else None
            if nid:
                remap[c[0]] = nid
        print(f'{len(setmap)}/{len(old["sets"])} old sets matched, {len(remap)} old cards mapped', flush=True)

    used = {c[1] for c in cards}
    sets = [s for s in sets if s['id'] in used]
    save(sets, cards, remap, final=not out_of_time, setmap=setmap)
    pics = sum(1 for c in cards if c[9])
    print(f'Saved {len(sets)} sets, {len(cards)} cards ({pics} with pictures){" — not finished, carries on next run" if out_of_time else ""}', flush=True)


if __name__ == '__main__':
    main()
