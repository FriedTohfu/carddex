"""
Fills the gaps in TCGdex's Japanese cards with the official Japanese card list
(www.pokemon-card.com: every card since Diamond & Pearl, with pictures).

TCGdex stays the base: its sets, names and dates. This file only adds what
TCGdex is missing. Cards get TCGdex-style ids (<set>-<number>), so they go
into the matching TCGdex set, and if TCGdex adds the card later it simply
becomes the same card.

Inputs (paths as arguments):
  official.json  the official card list ({cards: [{id, name, set, img, num, rarity, hp, illus, setName}]})
  data-asia/     TCGdex's database folder (github.com/tcgdex/cards-database)
  setlist.json   Bulbapedia's list of Japanese sets (names + dates), used for
                 products TCGdex doesn't list at all
Output: data/ja-extra.json
  {built, base, sets: [{id, name, serie, releaseDate, official}],
   cards: [[id, setId, localId, number, name, img, rarity, hp, illustrator]]}
"""
import glob, json, os, re, sys, unicodedata
from collections import Counter
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'ja-extra.json')
IMG_PREFIX = '/assets/images/card_images/large/'
IMG_BASE = 'https://www.pokemon-card.com' + IMG_PREFIX


def jnorm(x):
    x = unicodedata.normalize('NFKC', x or '').lower()
    return re.sub(r'[\s「」『』・•:：!！?？\-–—~〜"\'.,]', '', x)


def inner_name(product):
    m = re.search(r'「(.+?)」', product or '')
    return m.group(1) if m else (product or '')


def code_norm(code):
    return (code or '').replace('-', '').lower()


# ---------- TCGdex's Japanese sets ----------
def read_ts_field(text, field):
    m = re.search(field + r":\s*(?:\{[^}]*?\bja:\s*)?['\"]([^'\"]+)['\"]", text, re.S)
    return m.group(1) if m else ''


def tcgdex_sets(asia):
    sets = {}
    series = {}
    for sf in glob.glob(os.path.join(asia, '*.ts')):
        series[os.path.basename(sf)[:-3]] = read_ts_field(open(sf, encoding='utf-8').read(), 'name')
    for sf in glob.glob(os.path.join(asia, '*', '*.ts')):
        sid = os.path.basename(sf)[:-3]
        t = open(sf, encoding='utf-8').read()
        name = read_ts_field(t, 'name')
        if not name:
            continue  # not a Japanese set
        date = read_ts_field(t, 'releaseDate')
        off = re.search(r'official:\s*(\d+)', t)
        serie = series.get(os.path.basename(os.path.dirname(sf)), '')
        cdir = os.path.join(os.path.dirname(sf), sid)
        cards = set()
        if os.path.isdir(cdir):
            for cf in glob.glob(os.path.join(cdir, '*.ts')):
                if re.search(r'\bja:', open(cf, encoding='utf-8').read()):
                    cards.add(os.path.basename(cf)[:-3])
        sets[sid] = {'id': sid, 'name': name, 'releaseDate': date, 'serie': serie,
                     'official': int(off.group(1)) if off else 0, 'cards': cards}
    return sets


# ---------- Names for products TCGdex doesn't list ----------
ERA_OF = {'DP': 'DP Era', 'DPt': 'DPt Era', 'L': 'LEGEND Era', 'BW': 'BW Era', 'XY': 'XY Era'}


def bulbapedia_name(code, product, rows):
    """Japanese name + date from Bulbapedia's list, by era/set number (DPt3-B) or product name."""
    m = re.match(r'^(DPt|DP|L|BW|XY)(\d+)(?:-B(\w*))?$', code)
    if m:
        era, no, half = ERA_OF[m.group(1)], m.group(2), (m.group(3) or '').lower()
        if era == 'XY Era' and int(no) >= 8:
            era, no = 'XY BREAK Era', str(int(no) - 7)
        row = next((r for r in rows if r.get('part') == 'Main Sets' and r.get('era') == era and r.get('no') == no), None)
        if row:
            ens = [x.strip() for x in row['en'].split('•')]
            jps = [x.strip() for x in re.split(r'[•・]', row['jp'])] if '•' in row['jp'] else [row['jp']]
            if half and len(ens) > 1 and len(jps) == len(ens):
                for i, en in enumerate(ens):
                    words = re.findall(r"[A-Za-z][\w'-]*", en.split(':')[-1])
                    if any(half == w.lower() or half == ''.join(ch for ch in w if ch.isupper()).lower() for w in words):
                        return jps[i], row['date']
            return row['jp'] or row['en'], row['date']
    n = jnorm(inner_name(product))
    if n:
        for r in rows:
            for j in re.split(r'[•・]', r['jp']):
                if jnorm(j) and jnorm(j) == n:
                    return j.strip(), r['date']
    return '', ''

# Decks and special sets whose card pages don't name the product (identified from their cards and dates).
# (name, release date or '' to keep the estimate)
KNOWN = {
    'WCP': ('ワールドチャンピオンズパック', '2007-07-05'),
    'EP08': ("エントリーパック'08", '2007-11-30'),
    'DPs-S': ('DP スターターデッキ', ''),
    'MPS08': ('映画公開記念 プレミアムシート', '2008-07-19'),
    'DPt-EPg': ('エントリーパックDPt (ナエトル)', '2008-10-01'),
    'DPt-EPd': ('エントリーパックDPt (ヒコザル)', '2008-10-01'),
    'DPt-EPp': ('エントリーパックDPt (ポッチャマ)', '2008-10-01'),
    'DPt-GBhi': ('ギフトボックスDPt (ヒコザル)', '2008-11-01'),
    'DPt-GBna': ('ギフトボックスDPt (ナエトル)', '2008-11-01'),
    'DPt-GBpo': ('ギフトボックスDPt (ポッチャマ)', '2008-11-01'),
    'DPt-GBpi': ('ギフトボックスDPt (ピカチュウ)', '2008-11-01'),
    'DPt2-Sg': ('SPデッキキット ゴウカザル四', '2008-12-26'),
    'DPt2-Se': ('SPデッキキット エルレイドGL', '2008-12-26'),
    'DPt3-Sg': ('SPデッキキット ガブリアスC', '2009-03-06'),
    'CPr': ('コレクションパック (ナエトル)', '2009-05-01'),
    'CPs': ('コレクションパック (ヒコザル)', '2009-05-01'),
    'CPm': ('コレクションパック (ポッチャマ)', '2009-05-01'),
    'DPt4-Slp': ('アルセウスLV.Xデッキ 雷・超', '2009-07-08'),
    'Ran': ('構築済みデッキ (フシギバナ)', ''),
    'DPt-MRP09': ('映画公開記念 ランダムパック', '2009-07-18'),
    'El': ('リーフィアVSメタグロス エキスパートデッキ (リーフィア)', '2009-11-13'),
    'Em': ('リーフィアVSメタグロス エキスパートデッキ (メタグロス)', '2009-11-13'),
    'Bd': ('バトルスターターデッキ (草)', '2009-10-09'),
    'Bb': ('バトルスターターデッキ (炎)', '2009-10-09'),
    'Bk': ('バトルスターターデッキ (水)', '2009-10-09'),
    'Br': ('バトルスターターデッキ (雷)', '2009-10-09'),
    'L2-Sb': ('構築済みスタンダードデッキ バンギラス', '2010-02-11'),
    'L2-Sh': ('構築済みスタンダードデッキ ハガネール', '2010-02-11'),
    'PW': ('ピカチュウワールドコレクション', '2010-07-08'),
    'CS1t': ('コレクションシート 旅立ちの仲間 (ツタージャ)', '2010-09-18'),
    'CS1p': ('コレクションシート 旅立ちの仲間 (ポカブ)', '2010-09-18'),
    'CS1m': ('コレクションシート 旅立ちの仲間 (ミジュマル)', '2010-09-18'),
    'BKv': ('バトル強化デッキ (クルミル)', ''),
    'BKt': ('バトル強化デッキ (バチュル)', ''),
    'BKc': ('バトル強化デッキ (ゾロア)', ''),
    'BTV': ('バトルテーマデッキ ビクティニ', ''),
    'BKR': ('バトル強化デッキ レシラムEX', ''),
    'BKZ': ('バトル強化デッキ ゼクロムEX', ''),
    'BGSt': ('バトルギフトセット トルネロスVSボルトロス (トルネロス)', ''),
    'BGSv': ('バトルギフトセット トルネロスVSボルトロス (ボルトロス)', ''),
    'HSPt': ('はじめてセット (ツタージャ)', ''),
    'HSPp': ('はじめてセット (ポカブ)', ''),
    'HSPm': ('はじめてセット (ミジュマル)', ''),
    'HSZt': ('はじめてセット 2012 (ツタージャ)', ''),
    'HSZp': ('はじめてセット 2012 (ポカブ)', ''),
    'HSZm': ('はじめてセット 2012 (ミジュマル)', ''),
    'SZD': ('バトル強化デッキ (ロズレイド)', ''),
    'GBR': ('バトル強化デッキ (ギャラドス)', ''),
    'KLD': ('バトル強化デッキ (ケルディオ)', ''),
    'PPD': ('デッキ (ダストダス)', ''),
    'PBG': ('デッキ (ギラティナ)', ''),
    'MDB': ('デッキ (エンブオー・レシラム)', ''),
    'WAK': ('デッキ (ビリジオン)', ''),
    'BKB': ('バトル強化デッキ (ブルンゲル)', ''),
    'BKW': ('バトル強化デッキ ファイヤーEX', ''),
    'KK': ('デッキ (キュレムEX)', ''),
    'MG': ('デッキ (モジャンボ)', ''),
    'BW10-B': ('EXバトルブースト', '2013-07-13'),
    'JP-Other': ('その他のカード', ''),
}


def main(official_path, asia, setlist_path):
    tsets = tcgdex_sets(asia)
    by_norm = {code_norm(s): s for s in tsets}
    rows = json.load(open(setlist_path, encoding='utf-8')).get('sets', []) if os.path.exists(setlist_path) else []
    off = [c for c in json.load(open(official_path, encoding='utf-8'))['cards']
           if not str(c['id']).startswith(('td-', 'bp-')) and c.get('img', '').startswith(IMG_PREFIX)]
    print(f'{len(tsets)} TCGdex Japanese sets, {len(off)} official cards')

    # Promo-numbered cards (e.g. 123/SM-P) go into that promo list
    sizes = Counter(c['set'] for c in off)
    for c in off:
        den = str(c.get('num') or '').split('/')[-1] if '/' in str(c.get('num') or '') else ''
        if re.fullmatch(r'[A-Za-z]{1,4}-?P', den) and den.upper() != 'P':
            c['set'] = den
    # Which TCGdex set each official code belongs to (same code, ignoring dashes and case)
    products = {}
    for c in off:
        if c.get('setName'):
            products.setdefault(c['set'], Counter())[c['setName']] += 1
    for c in off:
        if not c['set']:
            c['set'] = 'JP-Other'  # cards the official site lists without a set code
    # Codes that mean the same list (XY-P / XYP): use the biggest
    size = Counter(c['set'] for c in off)
    canon = {}
    for code, _ in size.most_common()[::-1]:
        canon[code_norm(code)] = code
    for c in off:
        c['set'] = canon[code_norm(c['set'])]
    set_of, new_sets = {}, {}
    for code in sorted({c['set'] for c in off}):
        t = by_norm.get(code_norm(code))
        if not t and re.match(r'^(.+\d)-B$', code):  # XY7-B is the XY7 booster
            t = by_norm.get(code_norm(code[:-2]))
        if t:
            set_of[code] = t
            if not tsets[t]['cards']:  # TCGdex placeholder with no cards: keep its name and date
                new_sets[t] = {k: tsets[t][k] for k in ('id', 'name', 'serie', 'releaseDate', 'official')}
            continue
        prod = (products.get(code) or Counter()).most_common(1)
        prod = prod[0][0] if prod else ''
        name, date = bulbapedia_name(code, prod, rows)
        if code in KNOWN:
            name, date = KNOWN[code][0], KNOWN[code][1] or date
        pm = re.fullmatch(r'([A-Za-z]{1,4})-?P', code)
        if pm:  # promo lists: Bulbapedia's "XY-P Promotional cards" row
            row = next((r for r in rows if code_norm(r['en'].split(' Promotional')[0]) == code_norm(code) and 'Promotional' in r['en']), None)
            if row:
                name, date = f"{row['en'].split(' Promotional')[0]} プロモ", row['date']
        set_of[code] = code
        new_sets[code] = {'id': code, 'name': name or inner_name(prod) or code, 'serie': '', 'releaseDate': date, 'official': 0}

    # Release dates for the rest: borrow the nearest older dated set (official card ids go up over time)
    rank = Counter()
    for c in off:
        i = int(c['id']) if str(c['id']).isdigit() else 0
        r = set_of[c['set']]
        rank[r] = min(rank[r], i) if rank[r] else i  # first card = when the set came out
    dated = sorted([(rank[s], tsets[s]['releaseDate']) for s in set(set_of.values()) if s in tsets and tsets[s]['releaseDate']] +
                   [(rank[s], v['releaseDate']) for s, v in new_sets.items() if v['releaseDate']])
    for s, v in new_sets.items():
        if not v['releaseDate'] and dated:
            best = dated[0][1]
            for r, d in dated:
                if r <= rank[s]:
                    best = d
            v['releaseDate'] = best

    cards, seen = [], set()
    have_tcg = 0
    for c in sorted(off, key=lambda c: int(c['id']) if str(c['id']).isdigit() else 0):
        sid = set_of[c['set']]
        num = str(c.get('num') or '')
        local = num.split('/')[0] if num else ''
        cid = f'{sid}-{local}' if local else f"{sid}-x{c['id']}"
        if cid in seen:
            continue
        seen.add(cid)
        if sid in tsets and local in tsets[sid]['cards']:
            have_tcg += 1  # TCGdex has it (the app only borrows the picture if TCGdex has none)
        cards.append([cid, sid, local, num, c.get('name', ''), c['img'][len(IMG_PREFIX):],
                      c.get('rarity') or '', c.get('hp') or 0, c.get('illus') or ''])
    for v in new_sets.values():
        v['official'] = v['official'] or sum(1 for x in cards if x[1] == v['id'])
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'built': built, 'base': IMG_BASE, 'sets': list(new_sets.values()), 'cards': cards},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    ip = os.path.join(ROOT, 'data', 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    index.pop('jaImages', None)
    index['jaExtra'] = {'built': built, 'count': len(cards), 'file': 'ja-extra.json'}
    json.dump(index, open(ip, 'w'), indent=1)
    filled = sum(1 for v in new_sets.values() if v['id'] in tsets)
    print(f'{len(cards)} cards ({have_tcg} already in TCGdex, {len(cards) - have_tcg} new); '
          f'{filled} empty TCGdex sets filled, {len(new_sets) - filled} products added as sets')


if __name__ == '__main__':
    main(*sys.argv[1:4])
