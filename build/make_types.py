"""
Pokémon types for the Pokédex filter (Ghost, Fire, ...), from PokeAPI's published data.
Output: data/types.json  {built, types: {"<species id>": ["ghost", "poison"], ...}}
Uses each species' default form (e.g. Charizard = fire/flying).
"""
import csv, io, json, os, sys, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/'
NAMES = {1: 'normal', 2: 'fighting', 3: 'flying', 4: 'poison', 5: 'ground', 6: 'rock', 7: 'bug', 8: 'ghost', 9: 'steel',
         10: 'fire', 11: 'water', 12: 'grass', 13: 'electric', 14: 'psychic', 15: 'ice', 16: 'dragon', 17: 'dark', 18: 'fairy'}


def table(name):
    with urllib.request.urlopen(RAW + name, timeout=60) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode('utf-8'))))


def main():
    pokemon = table('pokemon.csv')
    default = {int(p['id']): int(p['species_id']) for p in pokemon if p.get('is_default') == '1'}
    types = {}
    for row in sorted(table('pokemon_types.csv'), key=lambda r: (int(r['pokemon_id']), int(r['slot']))):
        sp = default.get(int(row['pokemon_id']))
        t = NAMES.get(int(row['type_id']))
        if sp and t:
            types.setdefault(str(sp), []).append(t)
    if len(types) < 1000:
        sys.exit(f'Only {len(types)} Pokémon with types — keeping the previous file')
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    out = os.path.join(ROOT, 'data', 'types.json')
    json.dump({'built': built, 'types': types}, open(out, 'w'), separators=(',', ':'))
    ip = os.path.join(ROOT, 'data', 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    index['types'] = {'built': built, 'count': len(types), 'file': 'types.json'}
    json.dump(index, open(ip, 'w'), indent=1)
    print(f'Saved types for {len(types)} Pokémon, e.g. #6 {types.get("6")}, #94 {types.get("94")}')


if __name__ == '__main__':
    main()
