"""
Builds the list of older Japanese cards (1996 – 2006: Base Set era through PCG,
including decks, vending sheets and promos) that the official Japanese site
doesn't have.

Source: Bulbapedia's set lists, read through the Internet Archive's copies
(Bulbapedia itself blocks GitHub's servers). Each card's own page gives its
picture and Japanese name.

Also saves Bulbapedia's full list of Japanese sets (names, dates) so the
official-site sets get proper names and release dates.

Output: data/ja-vintage.json, data/ja-setlist.json
Later runs only look up pages they haven't read yet.
"""
import gzip, html as htmllib, json, os, re, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'ja-vintage.json')
SETLIST = os.path.join(ROOT, 'data', 'ja-setlist.json')
WIKI = 'https://bulbapedia.bulbagarden.net'
ARCHIVE = 'https://web.archive.org/web/2026id_/'
LIST_PAGE = '/wiki/List_of_Japanese_Pok%C3%A9mon_Trading_Card_Game_expansions'
MAX_MIN = float(os.environ.get('VINTAGE_MAX_MINUTES', '80'))
UA = {'User-Agent': 'Mozilla/5.0 (CardDex personal collection app; github.com/FriedTohfu/carddex)'}
START = time.time()
# Japanese eras the official site doesn't cover (it starts with Diamond & Pearl, Dec 2006)
OLD_ERAS = ['Original Era', 'Neo Era', 'neo Era', 'VS Era', 'Web Era', 'web Era', 'e-Card Era', 'ADV Era', 'PCG Era']
OFFICIAL_FROM = '2006-12-01'
MONTHS = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July',
                                           'August', 'September', 'October', 'November', 'December'])}
DATE_RE = re.compile(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})?,?\s*(\d{4})')


def out_of_time():
    return (time.time() - START) / 60 > MAX_MIN


def fetch(path, tries=4):
    url = ARCHIVE + WIKI + path
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
                if b[:2] == b'\x1f\x8b':
                    b = gzip.decompress(b)
                return b.decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(4 + i * 6)
        except Exception:
            time.sleep(4 + i * 6)
    return None


def text(x):
    t = htmllib.unescape(re.sub(r'<[^>]+>', ' ', x)).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def iso(m):
    if not m:
        return ''
    month, day, year = MONTHS[m.group(1)], int(m.group(2) or 1), int(m.group(3))
    return f'{year:04d}-{month:02d}-{day:02d}'


def slug(path):
    p = urllib.parse.unquote(path.split('/wiki/')[-1])
    p = re.sub(r'_\(TCG\)$', '', p)
    return re.sub(r'[^0-9A-Za-z]+', '-', p).strip('-')[:60] or 'set'


# ---------- Bulbapedia's list of Japanese sets ----------
def parse_setlist(page):
    """Rows of the main/subset/promo tables: Japanese name, English name, card count, date, page."""
    start = page.find('id="Main_Sets"')
    end = page.find('id="See_also"')
    seg = page[start:end] if start > 0 and end > start else page
    sets = []
    era, part = '', 'Main Sets'  # the list starts inside the Main Sets heading
    for m in re.finditer(r'<h([23])[^>]*>(.*?)</h\1>|<tr[^>]*>(.*?)</tr>', seg, re.S):
        if m.group(2) is not None:
            label = text(m.group(2))
            if m.group(1) == '2':
                part, era = label, ''
            else:
                era = label
            continue
        row = m.group(3)
        if '<th' in row and 'Japanese name' in row:
            continue
        links = [l for l in re.findall(r'href="(/wiki/[^"#]+)"', row) if 'File:' not in l]
        tds = [text(x) for x in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        jp = next((t for t in tds if re.search(r'[぀-ヿ一-鿿]', t)), '')
        jp = re.sub(r'\s+[A-Za-z][^\u3040-\u30ff\u4e00-\u9fff]*$', '', jp)  # drop the English translation after it
        date = iso(DATE_RE.search(text(row)))
        if not links or not date:
            continue
        # English (translated) name: the link text of the set's own page
        a = re.search(r'<a href="' + re.escape(links[0]) + r'"[^>]*>(.*?)</a>', row, re.S)
        en = text(a.group(1)) if a else slug(links[0]).replace('-', ' ')
        no = tds[0] if tds and tds[0].isdigit() else ''
        sets.append({'jp': jp, 'en': en, 'date': date, 'page': links[0], 'era': era, 'part': part, 'no': no})
    return sets


def parse_navbox(page):
    """Japanese releases (decks, gift sets, promos…) listed under each era in the page's navigation box."""
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S)
    out, english, era = [], set(), None
    for r in rows:
        th = re.findall(r'<th[^>]*>(.*?)</th>', r, re.S)
        if th:
            label = text(th[0])
            era = label if label.endswith('Era') else ('EN' if label.endswith('Series') else None)
            continue
        links = [(text(n), l) for l, n in re.findall(r'<a href="(/wiki/[^"#]+)"[^>]*>(.*?)</a>', r, re.S) if 'File:' not in l]
        if era == 'EN':
            english.update(n for n, _ in links)
        elif era in OLD_ERAS:
            out += [{'name': n, 'page': l, 'era': era.replace(' Era', '')} for n, l in links if n]
    return out, english


# ---------- A set's own page ----------
def release_date(page):
    s = text(page[:150000])
    i = s.find('Release date')
    if i < 0:
        return ''
    chunk = s[i:i + 300]
    j = chunk.find('Japanese:')
    return iso(DATE_RE.search(chunk[j:] if j >= 0 else chunk))


def set_tables(page):
    """Every card-list table on the page: (title, [rows])."""
    tables = []
    for m in re.finditer(r'<table[^>]*>', page):
        st = m.start()
        head = page[st:st + 6000]
        if 'Card name' not in head or 'No.' not in head:
            continue
        # Title: the big bold heading just above the list
        before = page[max(0, st - 4000):st]
        tm = re.findall(r'<big><b>(.*?)</b></big>', before, re.S)
        title = text(tm[-1]) if tm else ''
        # Rows until the table closes (nested tables are only in the heading)
        body_end = page.find('</table>', page.find('Card name', st))
        body = page[st:body_end if body_end > 0 else st + 200000]
        rows = []
        for r in re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S):
            cells = re.findall(r'<t([dh])[^>]*>(.*?)</t[dh]>', r, re.S)
            if len(cells) < 3 or all(k == 'h' for k, _ in cells):
                continue
            card = None
            for k, c in cells:
                a = re.search(r'<a href="(/wiki/[^"#]+_\([^"#]*\))"[^>]*>(.*?)</a>', c, re.S)
                if a and 'File:' not in a.group(1) and '(TCG)' not in a.group(1):
                    card = (a.group(1), text(a.group(2)))
                    break
            if not card:
                continue
            num = text(cells[0][1])
            num = '' if num in ('—', '-', '–', '') else num
            rar = ''
            for k, c in cells:
                ra = re.search(r'<a href="/wiki/Rarity"[^>]*title="([^"]+)"', c)
                if ra:
                    rar = ra.group(1)
            rows.append({'page': card[0], 'en': card[1], 'num': num, 'rarity': rar})
        if rows:
            tables.append((title, rows))
    # Nested tables repeat the same list: keep one copy (the one with its heading)
    best = {}
    for title, rows in tables:
        k = tuple(r['page'] for r in rows)
        if k not in best or (title and not best[k][0]):
            best[k] = (title, rows)
    order = []
    for title, rows in tables:
        k = tuple(r['page'] for r in rows)
        if best.get(k) and best[k] not in order:
            order.append(best[k])
    return order


# ---------- A card's own page ----------
def card_facts(page):
    out = {}
    m = re.search(r'<span lang="ja"><b>(.*?)</b></span>', page, re.S)
    if m:
        out['jname'] = text(m.group(1))
    for im in re.finditer(r'<a href="/wiki/File:([^"]+)" class="mw-file-description"><img src="([^"]+)"[^>]*width="(\d+)"', page):
        if int(im.group(3)) >= 120:
            src = im.group(2)
            full = re.sub(r'/thumb(/[0-9a-f]/[0-9a-f]{2}/[^/]+)/[^/]+$', r'\1', src)
            out['img'] = full
            break
    hp = re.search(r'<b>HP</b>\s*(\d{2,3})|HP\s*(?:<[^>]+>\s*)*(\d{2,3})', page)
    if hp:
        out['hp'] = int(hp.group(1) or hp.group(2))
    return out


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cache = {}
    if os.path.exists(OUT):
        try:
            cache = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            cache = {}
    set_pages = cache.get('setPages', {})    # page -> {date, canonical, tables}
    card_pages = cache.get('cardPages', {})  # page -> {jname, img, hp, illus}

    lp = fetch(LIST_PAGE)
    if not lp:
        print('Could not read the set list — keeping the previous files')
        return
    setlist = parse_setlist(lp)
    releases, english = parse_navbox(lp)
    json.dump({'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'sets': setlist},
              open(SETLIST, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(setlist)} sets in the list, {len(releases)} older Japanese releases', flush=True)
    # Older promo/vending series from the list that the navigation box may not name
    known = {r['page'] for r in releases}
    for s in setlist:
        if s['date'] < OFFICIAL_FROM and s['page'] not in known:
            releases.append({'name': s['en'], 'page': s['page'], 'era': ''})
            known.add(s['page'])
    dates = {s['page']: s['date'] for s in setlist}

    # 1. Set pages
    todo = [r['page'] for r in releases if r['page'] not in set_pages]
    print(f'{len(todo)} set pages to read', flush=True)
    def read_set(p):
        pg = fetch(p)
        if not pg:
            return p, None
        can = re.search(r'<link rel="canonical" href="[^"]*(/wiki/[^"]+)"', pg)
        return p, {'date': release_date(pg), 'canonical': can.group(1) if can else p, 'tables': set_tables(pg)}
    with ThreadPoolExecutor(3) as ex:
        for p, info in ex.map(read_set, todo):
            if info:
                set_pages[p] = info
    print(f'{sum(1 for r in releases if r["page"] in set_pages)} of {len(releases)} set pages read', flush=True)

    # 2. Turn pages into sets (one per card table; a shared English/Japanese page gives only its Japanese list)
    sets, seen = [], set()
    for r in releases:
        info = set_pages.get(r['page'])
        if not info or not info['tables']:
            continue
        tables = info['tables']
        named = [t for t in tables if t[0].lower() == r['name'].lower()]
        if named:
            picked = named
        else:
            picked = [t for t in tables if t[0] not in english] or (tables if len(tables) == 1 else [])
        for title, rows in picked:
            key = (info['canonical'], title)
            if key in seen:
                continue
            seen.add(key)
            name = r['name']
            if len(picked) > 1 and title and title.lower() != r['name'].lower():
                base = r['name'] if info['canonical'] == r['page'] else urllib.parse.unquote(info['canonical'].split('/wiki/')[-1]).replace('_(TCG)', '').replace('_', ' ')
                name = title if base.lower() in title.lower() else f"{base}: {title}"
            # Release date: Bulbapedia's list row for this page (matching the series name when a page has several)
            same = [x for x in setlist if x['page'] in (r['page'], info['canonical'])]
            row = next((x for x in same if title and title.lower() in x['en'].lower()), same[0] if same else None)
            date = (row or {}).get('date') or dates.get(r['page']) or info.get('date') or ''
            if date and date >= OFFICIAL_FROM:
                continue
            code = 'bp-' + slug(r['page']) + ('' if len(picked) == 1 else '-' + re.sub(r'[^0-9A-Za-z]+', '-', title).strip('-')[:30])
            sets.append({'code': code, 'name': name, 'releaseDate': date, 'serie': r['era'], 'rows': rows})
    print(f'{len(sets)} older sets, {sum(len(s["rows"]) for s in sets)} cards', flush=True)

    # 3. Card pages (picture + Japanese name), shared by reprints
    need = sorted({row['page'] for s in sets for row in s['rows'] if row['page'] not in card_pages})
    print(f'{len(need)} card pages to read', flush=True)
    done = 0
    def read_card(p):
        pg = fetch(p, tries=3)
        return p, (card_facts(pg) if pg else None)
    with ThreadPoolExecutor(4) as ex:
        for i in range(0, len(need), 60):
            if out_of_time():
                print('Time limit reached — the next run continues from here', flush=True)
                break
            for p, facts in ex.map(read_card, need[i:i + 60]):
                if facts is not None:
                    card_pages[p] = facts
                done += 1
            print(f'  card pages {done}/{len(need)}', flush=True)

    # 4. Cards
    cards = []
    for s in sets:
        for i, row in enumerate(s['rows']):
            f = card_pages.get(row['page'], {})
            num = row['num']
            cards.append({
                'id': f"{s['code']}-{i + 1:03d}", 'name': f.get('jname') or row['en'], 'en': row['en'],
                'set': s['code'], 'num': num, 'rarity': row['rarity'], 'img': f.get('img', ''),
                'hp': f.get('hp'), 'illus': f.get('illus'), 'chk': 1,
            })
    with_img = sum(1 for c in cards if c['img'])
    out = {
        'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'sets': [{k: v for k, v in s.items() if k != 'rows'} | {'total': len(s['rows'])} for s in sets],
        'cards': cards, 'setPages': set_pages, 'cardPages': card_pages,
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'Saved {len(sets)} older sets, {len(cards)} cards ({with_img} with pictures)', flush=True)


if __name__ == '__main__':
    main()
