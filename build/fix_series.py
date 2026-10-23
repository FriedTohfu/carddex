"""
Sets the series (era) of every set in data/en-dex.json and data/ja-dex.json.
1) the matching pkmn.gg set's series (same name / release date), else
2) the era the set was released in.
"""
import json, os, sys
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_extra import day, match_set, name_key  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
ERAS = {
    'en': [('1999-01-01', 'Base'), ('2000-08-14', 'Gym'), ('2000-12-16', 'Neo'), ('2002-05-24', 'Legendary Collection'),
           ('2002-09-15', 'e-Card'), ('2003-06-18', 'EX'), ('2007-05-23', 'Diamond & Pearl'), ('2009-11-04', 'Platinum'),
           ('2010-02-10', 'HeartGold & SoulSilver'), ('2011-04-25', 'Black & White'), ('2013-11-08', 'XY'),
           ('2017-02-03', 'Sun & Moon'), ('2020-02-07', 'Sword & Shield'), ('2023-03-31', 'Scarlet & Violet'),
           ('2025-09-26', 'Mega Evolution')],
    'ja': [('1996-01-01', 'Original'), ('1998-06-01', 'Gym'), ('1999-11-01', 'Neo'), ('2001-06-01', 'VS / web'),
           ('2001-12-01', 'e-Card'), ('2003-07-18', 'ADV'), ('2004-11-19', 'PCG'), ('2006-09-30', 'Diamond & Pearl'),
           ('2008-07-01', 'Platinum'), ('2009-07-10', 'LEGEND'), ('2010-12-03', 'Black & White'), ('2013-07-12', 'XY'),
           ('2016-12-09', 'Sun & Moon'), ('2019-12-06', 'Sword & Shield'), ('2022-11-01', 'Scarlet & Violet'),
           ('2025-08-01', 'Mega Evolution')],
}
NICE = {'Other': None, 'Web': 'VS / web', 'VS': 'VS / web', 'E-Card': 'e-Card'}


def era(lang, date):
    name = None
    for start, n in ERAS[lang]:
        if date and date >= start:
            name = n
    return name or 'Other'


def fix(lang):
    path = os.path.join(DATA, f'{lang}-dex.json')
    gg_path = os.path.join(DATA, 'ja-pkmngg.json' if lang == 'ja' else 'en-pkmngg.json')
    d = json.load(open(path, encoding='utf-8'))
    gg = json.load(open(gg_path, encoding='utf-8'))['sets'] if os.path.exists(gg_path) else []
    base = [{'key': s['id'], 'name': s['name'], 'nk': name_key(s['name']), 'day': day(s.get('releaseDate')), 'series': s.get('series') or '', 'printed': s.get('printed') or 0} for s in gg]
    changed = 0
    for s in d['sets']:
        m = match_set(s['name'], s.get('releaseDate'), base)
        if m and m.get('printed') and not s.get('printed'):
            s['printed'] = m['printed']; changed += 1   # e.g. the "/162" in 164/162
        ser = m['series'] if m and m['series'] else ''
        ser = NICE.get(ser, ser) if ser in NICE else ser
        if not ser:
            ser = era(lang, s.get('releaseDate') or '')
        if s.get('series') != ser:
            s['series'] = ser; changed += 1
    d['built'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    ip = os.path.join(DATA, 'index.json')
    index = json.load(open(ip))
    key = 'jaGG' if lang == 'ja' else 'enDex'
    if index.get(key, {}).get('file') == f'{lang}-dex.json':
        index[key]['built'] = d['built']; json.dump(index, open(ip, 'w'), indent=1)
    return changed, d


if __name__ == '__main__':
    for lang in sys.argv[1:] or ['en', 'ja']:
        n, d = fix(lang)
        from collections import Counter
        print(lang, f'{n} sets changed;', Counter(s['series'] for s in d['sets']).most_common())
