"""
Adds official Japanese card names to data/ja-dex.json (dextcg only lists English
names). Source: TCGdex's Japanese sets, matched by set code (jpn_sv10 = SV10)
and card number. Only fills names that are still empty.
"""
import json, os, re, sys, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_extra import get, num_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
PATH = os.path.join(DATA, 'ja-dex.json')
TCG = 'https://api.tcgdex.net/v2/ja'
code = lambda x: re.sub(r'[^a-z0-9]', '', str(x).lower())


def add_names(d):
    briefs = get(f'{TCG}/sets', as_json=True) or []
    by_code = {code(b['id']): b['id'] for b in briefs}
    print(f'TCGdex Japanese: {len(briefs)} sets', flush=True)
    sets = {}
    for c in d['cards']:
        if not c[4]:
            sets.setdefault(c[1], []).append(c)
    todo = [(sid, by_code.get(code(sid[4:] if sid.startswith('jpn_') else sid))) for sid in sets]
    todo = [(s, t) for s, t in todo if t]
    print(f'{len(sets)} sets need names, {len(todo)} found on TCGdex', flush=True)

    def one(st):
        return st, get(f'{TCG}/sets/{urllib.parse.quote(st[1])}', as_json=True)
    filled = 0
    with ThreadPoolExecutor(4) as ex:
        for (sid, _), full in ex.map(one, todo):
            names = {num_key(x.get('localId')): x.get('name') for x in (full or {}).get('cards', []) if x.get('name')}
            for c in sets[sid]:
                n = names.get(num_key(c[2]))
                if n and re.search(r'[぀-ヿ一-鿿]', n):
                    c[4] = n; filled += 1
    print(f'Japanese names added: {filled}; now {sum(1 for c in d["cards"] if c[4])} of {len(d["cards"])}', flush=True)
    return filled


if __name__ == '__main__':
    d = json.load(open(PATH, encoding='utf-8'))
    if add_names(d):
        d['built'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        json.dump(d, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        ip = os.path.join(DATA, 'index.json')
        index = json.load(open(ip))
        if index.get('jaGG', {}).get('file') == 'ja-dex.json':
            index['jaGG']['built'] = d['built']
            json.dump(index, open(ip, 'w'), indent=1)
