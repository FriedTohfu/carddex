"""
Builds the Japanese card list from the official Japanese card database
(www.pokemon-card.com), which is far more complete than other sources.

Runs on GitHub (see .github/workflows/scan-data.yml). Saves only card facts
(name, set code, number, rarity, illustrator) and the picture's address —
no pictures are copied. Later runs only look up cards that are new.

Output: data/ja-official.json
  {built, count, cards: [{id, name, set, setName, num, rarity, illus, hp, img}]}
"""
import html as htmllib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
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
    # Product the card comes in (used as the set name when nothing better is known)
    for li in re.findall(r'<li[^>]*>(.*?)</li>', page, flags=re.S):
        t = text_of(li)
        if 3 <= len(t) <= 60 and PRODUCT.search(t):
            out['setName'] = t
            break
    return out


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
    todo = [cid for cid in listed if cid not in old or not (old[cid].get('num') or old[cid].get('chk'))]
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

    # Older sets aren't on pokemon-card.com (its database starts around 2006), so add the
    # Japanese sets TCGdex knows about that the official list doesn't have.
    extra = []
    try:
        have_name_num = {}
        for c in old.values():
            if str(c.get('id', '')).startswith('td-'):
                continue
            n = str(c.get('num') or '').split('/')[0]
            if n.isdigit():
                have_name_num.setdefault((c.get('name'), int(n)), set()).add((c.get('set') or '').lower())
        for t in (json.loads(tl) if tl else []):
            code = str(t.get('id', ''))
            if not code or code.lower() in codes:
                continue
            full = get(f"{tcg}/ja/sets/{urllib.parse.quote(code)}")
            full = json.loads(full) if full else {}
            tcards = [c for c in full.get('cards', []) if c.get('image') and c.get('name')]
            if not tcards:
                continue
            # Same set under a different code? (most of its cards already exist in one official set)
            hits = {}
            for c in tcards:
                lid = str(c.get('localId') or '')
                for sc in have_name_num.get((c['name'], int(lid)), ()) if lid.isdigit() else ():
                    hits[sc] = hits.get(sc, 0) + 1
            if hits and max(hits.values()) >= 0.5 * len(tcards):
                continue
            official = (full.get('cardCount') or {}).get('official')
            sets_info[code.lower()] = {'name': full.get('name') or t.get('name') or code, 'releaseDate': full.get('releaseDate', ''),
                                       'serie': (full.get('serie') or {}).get('name', ''), 'src': 'tcgdex'}
            for c in tcards:
                lid = str(c.get('localId') or '')
                extra.append({'id': f"td-{code}-{lid}", 'name': c['name'], 'set': code, 'img': c['image'] + '/high.webp',
                              'num': f'{lid}/{official}' if lid and official and lid.isdigit() else lid, 'chk': 1,
                              'setName': sets_info[code.lower()]['name']})
    except Exception as e:
        print(f'Older sets skipped: {e}', flush=True)
        extra = []
    print(f'{len(extra)} older cards added from TCGdex', flush=True)

    cards = []
    for cid, c in listed.items():
        cards.append({**old.get(cid, {}), **c})
    cards.sort(key=lambda c: int(c['id']) if str(c['id']).isdigit() else 0)
    cards = extra + cards
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
