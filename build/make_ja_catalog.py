"""
Builds the Japanese card list from the official Japanese card database
(www.pokemon-card.com), which is far more complete than other sources.

Runs on GitHub (see .github/workflows/scan-data.yml). Saves only card facts
(name, set code, number, rarity, illustrator) and the picture's address —
no pictures are copied. Later runs only look up cards that are new.

Output: data/ja-official.json
  {built, count, cards: [{id, name, set, setName, num, rarity, illus, hp, img}]}
"""
import html as htmllib, json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'ja-official.json')
BASE = os.environ.get('JA_BASE', 'https://www.pokemon-card.com')
LIST = BASE + '/card-search/resultAPI.php?keyword=&se_ta=&regulation_sidebar_form=all&pg=&illust=&sm_and_keyword=true&page={page}'
DETAIL = BASE + '/card-search/details.php/card/{id}/regu/all'
MAX_MIN = float(os.environ.get('JA_MAX_MINUTES', '120'))
UA = {'User-Agent': 'Mozilla/5.0 (CardDex personal collection app)', 'Accept-Language': 'ja,en;q=0.8'}
START = time.time()


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 + i * 3)
        except Exception:
            time.sleep(2 + i * 3)
    return None


def text_of(fragment):
    t = re.sub(r'<[^>]+>', ' ', fragment)
    t = htmllib.unescape(t).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t).strip()


PRODUCT = re.compile(r'(パック|デッキ|セット|ボックス|BOX|プロモ|コレクション|スターター|スペシャル|ギフト)')


def parse_detail(page):
    """Pulls the card number, rarity, illustrator, HP and product name out of a card page."""
    out = {}
    # Number like "001 / 103" or "123 / SV-P", just after the set/regulation logo
    i = page.find('regulation_logo')
    if i >= 0:
        i = page.rfind('<', 0, i)  # start at the beginning of that image tag
    for chunk in ([page[i:i + 1500]] if i >= 0 else []) + [page]:
        m = re.search(r'(\d{1,3})\s*/\s*([0-9]{1,3}|[A-Za-z0-9][A-Za-z0-9\-]{1,9})(?![0-9A-Za-z])', text_of(chunk))
        if m:
            out['num'] = f'{m.group(1)}/{m.group(2)}'
            break
    m = re.search(r'ic_rare_([a-z0-9_]+)\.(?:gif|png|svg)', page)
    if m:
        out['rarity'] = m.group(1).replace('_', ' ').upper()
    illus = [urllib.parse.unquote(x) for x in re.findall(r'[?&]illust=([^"&]+)', page)]
    illus = [x for x in illus if x and x != 'all']
    if illus:
        out['illus'] = illus[0]
    m = re.search(r'HP\s*(?:<[^>]+>\s*)*(\d{2,3})', page)
    if m:
        out['hp'] = int(m.group(1))
    # Products the card comes in (e.g. 拡張パック「メガブレイブ」), listed under the card
    products = []
    for href, name in re.findall(r'class="List_item"><a href="([^"]*)"[^>]*>(.*?)</a>', page, flags=re.S):
        t = text_of(name)
        if t and not href.startswith('http') and '購入' not in t:
            products.append(t)
    if products:
        out['setName'] = products[0]
    m = re.search(r'<h4>No\.(\d{1,4})', page)
    if m:
        out['dex'] = int(m.group(1))
    out['v'] = 2
    return out


def jnorm(x):
    x = unicodedata.normalize('NFKC', x or '').lower()
    return re.sub(r'[\s「」『』・•:：!！?？\-–—~〜"\'.,]', '', x)


GENERIC = {jnorm(x) for x in ['拡張パック', '基本拡張パック', '強化拡張パック', 'スターターデッキ', 'スタートデッキ', 'プロモカード', 'コレクションパック', 'ハイクラスパック']}


def inner_name(product):
    m = re.search(r'「(.+?)」', product or '')
    return m.group(1) if m else (product or '')


ERA_OF = {'DP': 'DP Era', 'DPt': 'DPt Era', 'L': 'LEGEND Era', 'BW': 'BW Era', 'XY': 'XY Era'}


def by_era_number(code, rows):
    """Official codes like DPt3-B or L1-Bhg: era, set number in that era, booster, and which half."""
    m = re.match(r'^(DPt|DP|L|BW|XY)(\d+)(?:-B(\w*))?$', code)
    if not m:
        return None
    era, no, half = ERA_OF[m.group(1)], m.group(2), (m.group(3) or '').lower()
    if era == 'XY Era' and int(no) >= 8:  # XY8 – XY11 are listed as XY BREAK sets 1 – 4
        era, no = 'XY BREAK Era', str(int(no) - 7)
    row = next((r for r in rows if r.get('part') == 'Main Sets' and r.get('era') == era and r.get('no') == no), None)
    if not row:
        return None
    ens = [x.strip() for x in row['en'].split('•')]
    jps = [x.strip() for x in re.split(r'[•・]', row['jp'])] if '•' in row['jp'] else [row['jp']]
    if half and len(ens) > 1:
        for i, en in enumerate(ens):
            words = re.findall(r"[A-Za-z][\w'-]*", en.split(':')[-1])
            if any(half == w.lower() or half == ''.join(ch for ch in w if ch.isupper()).lower() for w in words):
                return {'en': en, 'jp': jps[i] if len(jps) == len(ens) else row['jp'], 'date': row['date']}
    return {'en': row['en'], 'jp': row['jp'], 'date': row['date']}


def promo_lists(cards):
    """Cards numbered as promos (e.g. 123/SM-P) go into that era's promo list, whatever product they came in."""
    size = Counter(c.get('set') for c in cards if c.get('set'))
    by_norm = {}
    for x, _ in size.most_common()[::-1]:  # the biggest list wins when two codes mean the same (XYP / XY-P)
        by_norm[x.replace('-', '').lower()] = x
    moved = Counter()
    for c in cards:
        same = by_norm.get(str(c.get('set') or '').replace('-', '').lower())
        if c.get('set') and same and same != c['set']:  # e.g. XY-P is the same list as XYP
            moved[f"{c['set']} -> {same}"] += 1
            c['set'] = same
        den = str(c.get('num') or '').split('/')[-1] if '/' in str(c.get('num') or '') else ''
        if not re.fullmatch(r'[A-Za-z]{1,4}-?P', den) or den.upper() == 'P':
            continue
        target = by_norm.get(den.replace('-', '').lower()) or den
        if c.get('set') != target:
            moved[f"{c.get('set') or '(none)'} -> {target}"] += 1
            c['product'] = c.get('set')
            c['set'] = target
    if moved:
        print('Promo cards moved into their promo lists: ' + ', '.join(f'{k} ({n})' for k, n in moved.most_common()), flush=True)


def name_sets(cards, sets_info, tcg_sets=None):
    """Gives each official set code an English name, Japanese name and release date."""
    sl = os.path.join(ROOT, 'data', 'ja-setlist.json')
    rows = json.load(open(sl, encoding='utf-8')).get('sets', []) if os.path.exists(sl) else []
    by_jp, by_code = {}, {}
    for r in rows:
        jps = [x.strip() for x in re.split(r'[•・]', r['jp']) if x.strip()] if '•' in r['jp'] else [r['jp']]
        ens = [x.strip() for x in r['en'].split('•')]
        for i, j in enumerate(jps):
            if jnorm(j):
                by_jp[jnorm(j)] = {'en': ens[i] if len(ens) == len(jps) else r['en'], 'jp': j, 'date': r['date']}
        m = re.match(r'([A-Za-z]+(?:-[A-Za-z]+)?)\s+Promotional', r['en'])
        if m:
            by_code[m.group(1).replace('-', '').lower()] = {'en': r['en'], 'jp': '', 'date': r['date']}
        if not jnorm(r['jp']):  # names written in English letters, e.g. "Pokémon GO"
            by_jp.setdefault(jnorm(r['en']), {'en': r['en'], 'jp': r['en'], 'date': r['date']})
    products = {}
    for c in cards:
        if c.get('setName') and c.get('set'):
            products.setdefault(c['set'], Counter())[c['setName']] += 1
    codes = {c.get('set') for c in cards if c.get('set')}
    # Which TCGdex set has the same cards (same Japanese name and number)?
    overlap_name = {}
    if tcg_sets:
        index = {}
        for tid, t in tcg_sets.items():
            for key in t['cards']:
                index.setdefault(key, set()).add(tid)
        per_code = {}
        for c in cards:
            n = str(c.get('num') or '').split('/')[0]
            if c.get('set') and n.isdigit():
                per_code.setdefault(c['set'], []).append((jnorm(c.get('name')), int(n)))
        for code, keys in per_code.items():
            votes = Counter(t for k in keys for t in index.get(k, ()))
            if votes:
                tid, nv = votes.most_common(1)[0]
                if nv >= max(3, 0.5 * len(keys)):
                    overlap_name[code] = tcg_sets[tid]['name']
    named = 0
    for code in codes:
        cur = sets_info.get(code.lower(), {})
        prod = products.get(code, Counter()).most_common(1)
        prod = prod[0][0] if prod else ''
        cands = [inner_name(prod), cur.get('name', ''), overlap_name.get(code, ''), prod]
        hit = by_code.get(code.replace('-', '').lower()) if re.search(r'-?P$', code) else None
        hit = hit or by_era_number(code, rows)
        for cand in ([] if hit else cands):
            n = jnorm(cand)
            if n and n in by_jp:
                hit = by_jp[n]; break
        if not hit:
            # A known set name inside a longer product name (not for generic names like 拡張パック)
            for cand in cands[:3]:
                n = jnorm(cand)
                best = max((k for k in by_jp if len(k) >= 4 and k not in GENERIC and k in n), key=len, default=None) if n else None
                if best:
                    hit = by_jp[best]; break
        info = dict(cur)
        if hit:
            info['name'] = hit['en']
            info['nameJa'] = hit['jp'] or inner_name(prod)
            info['releaseDate'] = hit['date'] or cur.get('releaseDate', '')
            named += 1
        else:
            info['name'] = cur.get('name') or overlap_name.get(code) or inner_name(prod) or code
            if prod:
                info['nameJa'] = inner_name(prod)
        sets_info[code.lower()] = info
    print(f'{named} of {len(codes)} official sets matched to Bulbapedia names and dates', flush=True)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    old = {}
    if os.path.exists(OUT):
        try:
            old = {c['id']: c for c in json.load(open(OUT, encoding='utf-8'))['cards']}
        except Exception:
            old = {}

    first = json.loads(get(LIST.format(page=1)) or '{}')
    pages = int(first.get('maxPage') or 0)
    if not pages:
        print('Card list unavailable — keeping the previous file'); return
    print(f'{first.get("hitCnt")} cards on {pages} pages', flush=True)

    listed = {}
    def page_cards(p):
        d = first if p == 1 else json.loads(get(LIST.format(page=p)) or '{}')
        return d.get('cardList') or []
    with ThreadPoolExecutor(4) as ex:
        for cards in ex.map(page_cards, range(1, pages + 1)):
            for c in cards:
                img = c.get('cardThumbFile') or ''
                m = re.search(r'/card_images/[^/]+/([^/]+)/', img)
                listed[c['cardID']] = {
                    'id': c['cardID'], 'name': htmllib.unescape(c.get('cardNameViewText') or c.get('cardNameAltText') or ''),
                    'set': m.group(1) if m else '', 'img': img,
                }
    print(f'{len(listed)} cards listed', flush=True)

    # Cards never read (or whose page failed last time). 'chk' = page read fine, it just has no number.
    todo = [cid for cid in listed if cid not in old or old[cid].get('v', 1) < 2 or not (old[cid].get('num') or old[cid].get('chk'))]
    # Newest cards first, so if time runs out the most-wanted ones are done
    todo.sort(key=lambda c: -int(c) if str(c).isdigit() else 0)
    print(f'{len(todo)} cards need details', flush=True)
    done = 0
    parsed_num = 0
    failed = []
    def detail(cid, tries=2):
        page = get(DETAIL.format(id=cid), tries=tries)
        if not page:
            return cid, None
        info = parse_detail(page)
        if not info.get('num'):
            info['chk'] = 1
        return cid, info
    def run(ids, workers, tries):
        nonlocal done, parsed_num
        with ThreadPoolExecutor(workers) as ex:
            for i in range(0, len(ids), 120):
                if (time.time() - START) / 60 > MAX_MIN:
                    print('Time limit reached — the next run continues from here', flush=True)
                    return False
                for cid, info in ex.map(lambda c: detail(c, tries), ids[i:i + 120]):
                    if info is None:
                        failed.append(cid)
                        continue
                    old[cid] = {**old.get(cid, {}), **listed[cid], **info}
                    done += 1
                    parsed_num += 1 if info.get('num') else 0
                print(f'  details {done}/{len(todo)} (numbers found: {parsed_num}, failed: {len(failed)})', flush=True)
        return True
    if run(todo, 6, 2):
        # Pages that failed (usually the site slowing us down): try again, gently
        for attempt in range(3):
            if not failed:
                break
            retry, failed[:] = list(failed), []
            print(f'Retrying {len(retry)} pages that failed (pass {attempt + 1})', flush=True)
            time.sleep(30)
            if not run(retry, 2, 4):
                break
    print(f'{len(failed)} card pages still unread', flush=True)

    # Set names and release dates (from TCGdex, where set codes match)
    sets_info = {}
    try:
        prev_sets = json.load(open(OUT, encoding='utf-8')).get('sets', {}) if os.path.exists(OUT) else {}
    except Exception:
        prev_sets = {}
    tcg = os.environ.get('TCG_BASE', 'https://api.tcgdex.net/v2')
    tl = get(f'{tcg}/ja/sets')
    codes = {(c.get('set') or '').lower() for c in listed.values()}
    for t in (json.loads(tl) if tl else []):
        code = str(t.get('id', '')).lower()
        if code not in codes:
            continue
        if code in prev_sets and prev_sets[code].get('releaseDate'):
            sets_info[code] = prev_sets[code]
            continue
        full = get(f"{tcg}/ja/sets/{urllib.parse.quote(t['id'])}")
        full = json.loads(full) if full else {}
        sets_info[code] = {'name': full.get('name') or t.get('name'), 'releaseDate': full.get('releaseDate', ''),
                           'serie': (full.get('serie') or {}).get('name', '')}
    print(f'{len(sets_info)} sets matched with release dates', flush=True)

    # Proper set names and release dates from Bulbapedia's list of Japanese sets
    cards = []
    for cid, c in listed.items():
        cards.append({**old.get(cid, {}), **c})
    cards.sort(key=lambda c: int(c['id']) if str(c['id']).isdigit() else 0)
    tcg_sets = {}
    def tcg_set(t):
        full = get(f"{tcg}/ja/sets/{urllib.parse.quote(str(t['id']))}")
        full = json.loads(full) if full else {}
        keys = {(jnorm(c.get('name')), int(c['localId'])) for c in full.get('cards', []) if str(c.get('localId', '')).isdigit()}
        return str(t['id']), {'name': full.get('name') or t.get('name', ''), 'cards': keys}
    try:
        with ThreadPoolExecutor(6) as ex:
            for tid, info in ex.map(tcg_set, json.loads(tl) if tl else []):
                if info['cards']:
                    tcg_sets[tid] = info
    except Exception as e:
        print(f'TCGdex set lists skipped: {e}', flush=True)
    promo_lists(cards)
    name_sets(cards, sets_info, tcg_sets)

    # Older cards (1996 – 2006) the official site doesn't have, from build/make_ja_vintage.py
    vp = os.path.join(ROOT, 'data', 'ja-vintage.json')
    if os.path.exists(vp):
        try:
            v = json.load(open(vp, encoding='utf-8'))
            for st in v.get('sets', []):
                sets_info[st['code'].lower()] = {'name': st['name'], 'releaseDate': st.get('releaseDate', ''),
                                                 'serie': st.get('serie', ''), 'src': 'bulbapedia'}
            old_cards = [c for c in v.get('cards', []) if c.get('set')]
            cards = [{k: val for k, val in c.items() if val not in (None, '')} for c in old_cards] + cards
            print(f"{len(old_cards)} older cards added ({sum(1 for c in old_cards if c.get('img'))} with pictures)", flush=True)
        except Exception as e:
            print(f'Older cards skipped: {e}', flush=True)
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'built': built, 'count': len(cards), 'source': BASE, 'sets': sets_info, 'cards': cards}, f, ensure_ascii=False, separators=(',', ':'))
    # Let the app know there's a new list
    ip = os.path.join(ROOT, 'data', 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    index['jaCatalog'] = {'built': built, 'count': len(cards), 'file': 'ja-official.json'}
    json.dump(index, open(ip, 'w'), indent=1)
    with_num = sum(1 for c in cards if c.get('num'))
    print(f'Saved {len(cards)} cards ({with_num} with numbers)', flush=True)


if __name__ == '__main__':
    main()
