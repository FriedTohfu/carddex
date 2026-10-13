// Works out which Pokémon appear on each card by matching card names
// against Pokémon names in that card's language (works fully offline).

const LANG_FIELDS = {
  'en': ['en'],
  'ja': ['ja', 'en'],
  'zh-tw': ['zhHant', 'zhHans', 'en'],
  'zh-cn': ['zhHans', 'zhHant', 'en'],
};

const LETTER = /[\p{L}\p{N}]/u;

export function normalizeName(s) {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+([♀♂])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTrie(entries) {
  const root = new Map();
  for (const [name, id] of entries) {
    if (!name) continue;
    let node = root;
    for (const ch of name) {
      let next = node.get(ch);
      if (!next) node.set(ch, (next = new Map()));
      node = next;
    }
    if (!node.has('$')) node.set('$', id);
  }
  return root;
}

function matchAll(trie, text, wordBounded) {
  const chars = [...text];
  const found = [];
  let i = 0;
  while (i < chars.length) {
    if (wordBounded && i > 0 && LETTER.test(chars[i - 1])) { i++; continue; }
    let node = trie, j = i, best = null;
    while (j < chars.length && node) {
      node = node.get(chars[j]);
      j++;
      if (node && node.has('$')) {
        if (!wordBounded || j === chars.length || !LETTER.test(chars[j])) best = { id: node.get('$'), end: j };
      }
    }
    if (best) {
      if (!found.includes(best.id)) found.push(best.id);
      i = best.end;
    } else i++;
  }
  return found;
}

const trieCache = new Map();
function trieFor(lang, species) {
  const cacheKey = lang + ':' + species.length;
  if (trieCache.has(cacheKey)) return trieCache.get(cacheKey);
  const fields = LANG_FIELDS[lang] || ['en'];
  const entries = [];
  for (const f of fields) for (const s of species) {
    const n = normalizeName(s[f]);
    if (n && n.length >= (f === 'en' ? 3 : 2)) entries.push([n, s.id]);
  }
  const trie = buildTrie(entries);
  trieCache.set(cacheKey, trie);
  return trie;
}

export function buildDexIndex(cards, species, overrides = new Map()) {
  const dexIndex = new Map();
  const cardDex = new Map();
  if (!species.length) return { dexIndex, cardDex };
  for (const c of cards) {
    let ids = overrides.get(c.key);
    if (!ids) {
      const trie = trieFor(c.lang, species);
      ids = matchAll(trie, normalizeName(c.name), c.lang === 'en');
    }
    if (!ids.length) continue;
    cardDex.set(c.key, ids);
    for (const id of ids) {
      let arr = dexIndex.get(id);
      if (!arr) dexIndex.set(id, (arr = []));
      arr.push(c.key);
    }
  }
  return { dexIndex, cardDex };
}

/** Display name of a Pokémon in the preferred language. */
export function speciesName(s, lang = 'en') {
  if (!s) return '';
  if (lang === 'ja') return s.ja || s.en;
  if (lang === 'zh-tw') return s.zhHant || s.zhHans || s.en;
  if (lang === 'zh-cn') return s.zhHans || s.zhHant || s.en;
  return s.en || s.slug;
}
