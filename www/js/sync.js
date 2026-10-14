// Downloads card lists, Pokédex data and images to the phone.
import * as db from './db.js';
import { tcg, fetchJSON, fetchBlob, pool, POKEAPI, SPRITE, SCAN_DATA, CHS_BASE, cardImg, online } from './api.js';
import { state, emit, rebuildDex, setSpecies, dexOverrides } from './store.js';
import { fingerprintBlob, FP_VERSION, FP_LEN } from './fp.js';

export const job = { running: false, label: '', done: 0, total: 0, stop: false };
function report(label, done, total) {
  Object.assign(job, { label, done, total });
  emit('job');
}

// ---------- Card lists ----------
export async function syncCatalog(langs = state.settings.langs, { force = false } = {}) {
  if (job.running) return;
  if (!online()) throw new Error('You are offline. Connect to the internet to update card data.');
  job.running = true; job.stop = false;
  const errors = [];
  try {
    for (const lang of langs) {
      if (lang === 'zh-cn') {
        try { await syncChs({ force }); } catch (e) { errors.push(`zh-cn: ${e.message}`); }
        continue;
      }
      report(`Checking ${lang.toUpperCase()} sets…`, 0, 0);
      let list;
      try { list = await tcg.sets(lang); } catch (e) { errors.push(`${lang}: ${e.message}`); continue; }
      if (!Array.isArray(list) || !list.length) {
        state.syncInfo[lang] = { at: Date.now(), sets: 0, cards: 0, unavailable: true };
        continue;
      }
      const soon = Date.now() - 1000 * 60 * 60 * 24 * 150;
      const todo = list.filter((s) => {
        const cur = state.sets.get(`${lang}:${s.id}`);
        if (force || !cur) return true;
        const have = (state.cardsBySet.get(cur.key) || []).length;
        const expected = s.cardCount?.total ?? cur.total;
        if (expected && have < expected) return true;
        return cur.releaseDate && new Date(cur.releaseDate).getTime() > soon;
      });
      let n = 0;
      await pool(todo, 5, async (brief) => {
        try {
          const full = await tcg.set(lang, brief.id);
          if (full) await saveSet(lang, brief, full);
        } catch (e) { errors.push(`${lang}/${brief.id}: ${e.message}`); }
        report(`Downloading ${lang.toUpperCase()} card lists`, ++n, todo.length);
      }, () => job.stop);
      if (lang === 'ja' && !job.stop) await dropOfficialJa();
      const cards = [...state.cards.values()].filter((c) => c.lang === lang).length;
      state.syncInfo[lang] = { at: Date.now(), sets: list.length, cards };
      await db.put('meta', state.syncInfo, 'syncInfo');
    }
    if (!state.species.length && !job.stop) await syncSpecies(true);
    rebuildDex();
    emit('catalog');
  } finally {
    job.running = false;
    report('', 0, 0);
  }
  return errors;
}

// ---------- Simplified Chinese (PTCG-CHS-Datasets) ----------
function denominator(nums) {
  const count = new Map();
  for (const n of nums) {
    const m = /\/\s*(\d+)\s*$/.exec(n || '');
    if (m) count.set(+m[1], (count.get(+m[1]) || 0) + 1);
  }
  let best = 0, c = 0;
  for (const [k, v] of count) if (v > c) { best = k; c = v; }
  return best;
}

async function syncChs({ force = false } = {}) {
  const lang = 'zh-cn';
  report('Checking Simplified Chinese cards…', 0, 0);
  let sha = null;
  try { sha = (await fetchJSON('https://api.github.com/repos/duanxr/PTCG-CHS-Datasets/commits/main', { retries: 0, timeout: 15000 }))?.sha || null; } catch { /* check skipped */ }
  const info = state.syncInfo[lang];
  const have = [...state.sets.values()].some((s) => s.src === 'chs');
  if (!force && have && info?.sha && sha === info.sha) return;
  report('Downloading Simplified Chinese card list (about 25 MB)…', 0, 0);
  const d = await fetchJSON(`${CHS_BASE}/ptcg_chs_infos.json`, { timeout: 300000, retries: 1 });
  if (!d?.collections) throw new Error('Simplified Chinese card list unavailable');
  const sets = [], cards = [];
  for (const col of d.collections) {
    const setKey = `${lang}:chs-${col.id}`;
    const list = col.cards || [];
    sets.push({
      key: setKey, lang, id: `chs-${col.id}`, src: 'chs', code: col.commodityCode || '',
      name: String(col.name || col.commodityCode || col.id).trim(),
      serie: col.seriesText || '', releaseDate: col.salesDate || '',
      total: list.length, official: denominator(list.map((c) => c.details?.collectionNumber)),
      logo: col.image ? `https://images.weserv.nl/?url=${encodeURIComponent(`${CHS_BASE}/${col.image}`.replace(/^https?:\/\//, ''))}&w=240&output=webp` : '',
      symbol: '', syncedAt: Date.now(),
    });
    list.forEach((cd, i) => {
      const det = cd.details || {};
      const num = String(det.collectionNumber || '').trim();
      cards.push({
        key: `${lang}:chs-${cd.id}`, lang, id: `chs-${cd.id}`, src: 'chs',
        localId: (num.split('/')[0] || '').trim() || String(i + 1), number: num,
        name: String(cd.name || det.cardName || '').trim(),
        image: cd.image ? `${CHS_BASE}/${cd.image}` : '', setKey, order: i,
        det: {
          rarity: det.rarityText, illustrator: (det.illustratorName || []).join(', '), hp: det.hp,
          category: det.cardTypeText, regulationMark: det.regulationMarkText, number: num,
        },
      });
    });
  }
  // Replace older Simplified Chinese data (keeping anything in your collection, lists or binders)
  const keep = new Set([...state.owned.keys(), ...[...state.wishlists.values()].flatMap((w) => w.cards), ...[...state.binders.values()].flatMap((b) => b.pages.flat())]);
  const newKeys = new Set(cards.map((c) => c.key));
  const oldCards = [...state.cards.values()].filter((c) => c.lang === lang && !c.custom && !newKeys.has(c.key) && !keep.has(c.key));
  await db.delMany('cards', oldCards.map((c) => c.key));
  for (const c of oldCards) state.cards.delete(c.key);
  const keptSets = new Set([...state.cards.values()].filter((c) => c.lang === lang).map((c) => c.setKey));
  const newSetKeys = new Set(sets.map((s) => s.key));
  const oldSets = [...state.sets.values()].filter((s) => s.lang === lang && !s.custom && !newSetKeys.has(s.key) && !keptSets.has(s.key));
  await db.delMany('sets', oldSets.map((s) => s.key));
  for (const s of oldSets) { state.sets.delete(s.key); state.cardsBySet.delete(s.key); }
  // Save
  await db.putMany('sets', sets);
  for (let i = 0; i < cards.length; i += 2000) {
    await db.putMany('cards', cards.slice(i, i + 2000));
    report('Saving Simplified Chinese cards', Math.min(cards.length, i + 2000), cards.length);
  }
  for (const s of sets) state.sets.set(s.key, s);
  for (const c of cards) state.cards.set(c.key, c);
  for (const s of sets) {
    const mine = (state.cardsBySet.get(s.key) || []).filter((c) => c.custom);
    state.cardsBySet.set(s.key, [...cards.filter((c) => c.setKey === s.key), ...mine].sort((a, b) => a.order - b.order));
  }
  // drop empty leftovers from the old source
  for (const [k, arr] of state.cardsBySet) if (state.sets.get(k)?.lang === lang) state.cardsBySet.set(k, arr.filter((c) => state.cards.has(c.key)));
  state.syncInfo[lang] = { at: Date.now(), sets: sets.length, cards: cards.length, sha, source: 'PTCG-CHS-Datasets' };
  await db.put('meta', state.syncInfo, 'syncInfo');
}

async function dropEmptySet(key) {
  const st = state.sets.get(key);
  if (!st || st.custom || (state.cardsBySet.get(key) || []).length) return false;
  await db.del('sets', key);
  state.sets.delete(key); state.cardsBySet.delete(key);
  return true;
}

/** At start-up: tidy up empty placeholder sets, and phones that still have the old official-site Japanese list switch back to TCGdex. */
export async function autoUpdateCardData() {
  let tidied = false;
  for (const key of [...state.sets.keys()]) if (await dropEmptySet(key)) tidied = true;
  if (tidied) emit('catalog');
  if (job.running || !online() || !state.sets.size || !state.settings.langs.includes('ja')) return false;
  if (![...state.sets.values()].some((st) => st.src === 'pcj')) return false;
  const errors = await syncCatalog(['ja']);
  return !errors?.length;
}

/** Removes the official-site Japanese list, moving your cards to the matching TCGdex cards (same set code and number). */
async function dropOfficialJa() {
  const lang = 'ja';
  const pcjSets = [...state.sets.values()].filter((st) => st.lang === lang && st.src === 'pcj');
  if (!pcjSets.length) return;
  const tByCodeNum = new Map();
  for (const c of state.cards.values()) {
    if (c.lang !== lang || c.src === 'pcj' || c.custom) continue;
    const id = state.sets.get(c.setKey)?.id?.toLowerCase();
    if (id) tByCodeNum.set(`${id}|${parseInt(c.localId, 10)}`, c.key);
  }
  const remap = new Map();
  for (const c of state.cards.values()) {
    if (c.lang !== lang || c.src !== 'pcj') continue;
    const code = (state.sets.get(c.setKey)?.code || '').toLowerCase();
    const k = tByCodeNum.get(`${code}|${parseInt(c.localId, 10)}`);
    if (k) remap.set(c.key, k);
  }
  await remapKeys(remap);
  const keep = new Set([...state.owned.keys(), ...[...state.wishlists.values()].flatMap((w) => w.cards), ...[...state.binders.values()].flatMap((b) => b.pages.flat())]);
  const old = [...state.cards.values()].filter((c) => c.lang === lang && c.src === 'pcj' && !keep.has(c.key));
  await db.delMany('cards', old.map((c) => c.key));
  for (const c of old) state.cards.delete(c.key);
  const used = new Set([...state.cards.values()].filter((c) => c.src === 'pcj').map((c) => c.setKey));
  const gone = pcjSets.filter((st) => !used.has(st.key));
  await db.delMany('sets', gone.map((st) => st.key));
  for (const st of gone) { state.sets.delete(st.key); state.cardsBySet.delete(st.key); }
  for (const [k, arr] of state.cardsBySet) if (state.sets.get(k)?.lang === lang) state.cardsBySet.set(k, arr.filter((c) => state.cards.has(c.key)));
}

// ---------- Japanese (official card list, built by build/make_ja_catalog.py) ----------
async function syncJa({ force = false } = {}) {
  const lang = 'ja';
  report('Checking Japanese cards…', 0, 0);
  const index = await fetchJSON(`${SCAN_DATA}/index.json?t=${Date.now()}`, { retries: 1 }).catch(() => null);
  const info = index?.jaCatalog;
  if (!info) return false; // not built yet
  const have = [...state.sets.values()].some((s) => s.src === 'pcj');
  if (!force && have && state.syncInfo[lang]?.built === info.built) return true;
  report('Downloading Japanese card list…', 0, 0);
  const d = await fetchJSON(`${SCAN_DATA}/${info.file || 'ja-official.json'}?b=${encodeURIComponent(info.built)}`, { timeout: 180000, retries: 1 });
  if (!d?.cards?.length) return false;
  // Set names and release dates from TCGdex where the set codes match
  let tsets = [];
  try { tsets = (await tcg.sets(lang)) || []; } catch { /* names fall back to the product name */ }
  const tByCode = new Map(tsets.map((t) => [String(t.id).toLowerCase(), t]));
  const oldJaSets = new Map([...state.sets.values()].filter((st) => st.lang === lang && st.src !== 'pcj').map((st) => [st.id.toLowerCase(), st]));
  const groups = new Map();
  for (const c of d.cards) {
    const code = c.set || 'other';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(c);
  }
  const sets = [], cards = [];
  for (const [code, list] of groups) {
    const setKey = `${lang}:pcj-${code}`;
    const t = tByCode.get(code.toLowerCase()), old = oldJaSets.get(code.toLowerCase());
    const meta = d.sets?.[code.toLowerCase()] || {};
    list.sort((a, b) => (parseInt(a.num, 10) || 9999) - (parseInt(b.num, 10) || 9999) || (+a.id - +b.id));
    sets.push({
      key: setKey, lang, id: `pcj-${code}`, code, src: 'pcj',
      name: meta.name || t?.name || old?.name || list.find((c) => c.setName)?.setName || code,
      nameJa: meta.nameJa || '',
      serie: meta.serie || old?.serie || '', releaseDate: meta.releaseDate || old?.releaseDate || '',
      rank: Math.max(...list.map((c) => +c.id || 0)),
      total: list.length, official: denominator(list.map((c) => c.num)),
      logo: t?.logo || old?.logo || '', symbol: t?.symbol || old?.symbol || '', syncedAt: Date.now(),
    });
    list.forEach((c, i) => {
      const num = String(c.num || '');
      cards.push({
        key: `${lang}:pcj-${c.id}`, lang, id: `pcj-${c.id}`, src: 'pcj',
        localId: num.split('/')[0] || '', number: num, name: c.name || '', nameEn: c.en || undefined,
        image: !c.img ? '' : /^https?:/.test(c.img) ? c.img : `https://www.pokemon-card.com${c.img}`, setKey, order: i,
        det: { rarity: c.rarity, illustrator: c.illus, hp: c.hp, number: num, category: c.hp ? 'Pokemon' : undefined },
      });
    });
  }
  // Sets without a known date: borrow the date of the nearest older set (card IDs go up over time)
  const dated = sets.filter((st) => st.releaseDate).sort((a, b) => a.rank - b.rank);
  for (const st of sets) {
    if (st.releaseDate || !dated.length) continue;
    let best = dated[0];
    for (const x of dated) if (x.rank <= st.rank) best = x;
    st.releaseDate = best.releaseDate;
  }
  // Move your cards from the old Japanese source to the matching official ones
  const byCodeNum = new Map(cards.map((c) => [`${c.setKey.slice(7).toLowerCase()}|${parseInt(c.localId, 10)}`, c.key]));
  const remap = new Map();
  for (const c of state.cards.values()) {
    if (c.lang !== lang || c.src === 'pcj' || c.custom) continue;
    const setId = state.sets.get(c.setKey)?.id?.toLowerCase();
    const k = byCodeNum.get(`${setId}|${parseInt(c.localId, 10)}`);
    if (k) remap.set(c.key, k);
  }
  await remapKeys(remap);
  // Full reset: replace all older Japanese data (keeping anything still in your collection, lists or binders)
  const keep = new Set([...state.owned.keys(), ...[...state.wishlists.values()].flatMap((w) => w.cards), ...[...state.binders.values()].flatMap((b) => b.pages.flat())]);
  const newKeys = new Set(cards.map((c) => c.key)), newSets = new Set(sets.map((st) => st.key));
  const oldCards = [...state.cards.values()].filter((c) => c.lang === lang && !c.custom && !newKeys.has(c.key) && !keep.has(c.key));
  await db.delMany('cards', oldCards.map((c) => c.key));
  for (const c of oldCards) state.cards.delete(c.key);
  const usedSets = new Set([...state.cards.values()].filter((c) => c.lang === lang).map((c) => c.setKey));
  const oldSets = [...state.sets.values()].filter((st) => st.lang === lang && !st.custom && !newSets.has(st.key) && !usedSets.has(st.key));
  await db.delMany('sets', oldSets.map((st) => st.key));
  for (const st of oldSets) { state.sets.delete(st.key); state.cardsBySet.delete(st.key); }
  await db.putMany('sets', sets);
  for (let i = 0; i < cards.length; i += 2000) {
    await db.putMany('cards', cards.slice(i, i + 2000));
    report('Saving Japanese cards', Math.min(cards.length, i + 2000), cards.length);
  }
  for (const st of sets) state.sets.set(st.key, st);
  for (const c of cards) state.cards.set(c.key, c);
  for (const st of sets) {
    const mine = (state.cardsBySet.get(st.key) || []).filter((c) => c.custom);
    state.cardsBySet.set(st.key, [...cards.filter((c) => c.setKey === st.key), ...mine].sort((a, b) => a.order - b.order));
  }
  for (const [k, arr] of state.cardsBySet) if (state.sets.get(k)?.lang === lang) state.cardsBySet.set(k, arr.filter((c) => state.cards.has(c.key)));
  state.syncInfo[lang] = { at: Date.now(), sets: sets.length, cards: cards.length, built: info.built, source: 'pokemon-card.com' };
  await db.put('meta', state.syncInfo, 'syncInfo');
  return true;
}

/** Moves collection, wishlist and binder entries from old card keys to new ones. */
async function remapKeys(remap) {
  if (!remap.size) return;
  for (const [from, to] of remap) {
    const o = state.owned.get(from);
    if (!o) continue;
    const cur = state.owned.get(to);
    const merged = cur ? { ...cur, counts: { ...cur.counts } } : { ...o, key: to, counts: {} };
    for (const [v, n] of Object.entries(o.counts || {})) merged.counts[v] = (merged.counts[v] || 0) + n;
    merged.key = to;
    state.owned.delete(from); state.owned.set(to, merged);
    await db.del('owned', from); await db.put('owned', merged);
  }
  for (const w of state.wishlists.values()) {
    if (!w.cards.some((k) => remap.has(k))) continue;
    w.cards = [...new Set(w.cards.map((k) => remap.get(k) || k))];
    await db.put('wishlists', w);
  }
  for (const b of state.binders.values()) {
    if (!b.pages.some((p) => p.some((k) => remap.has(k)))) continue;
    b.pages = b.pages.map((p) => p.map((k) => (k && remap.get(k)) || k));
    await db.put('binders', b);
  }
}

async function saveSet(lang, brief, full) {
  const key = `${lang}:${full.id}`;
  // TCGdex lists some placeholder sets with no cards yet (e.g. Chinese codes under Japanese): skip them
  if (!(full.cards || []).length) { await dropEmptySet(key); return; }
  const set = {
    key, lang, id: full.id, name: full.name || brief.name || full.id,
    serie: full.serie?.name || '', serieId: full.serie?.id || '',
    releaseDate: full.releaseDate || '',
    total: full.cardCount?.total ?? brief.cardCount?.total ?? (full.cards?.length || 0),
    official: full.cardCount?.official ?? brief.cardCount?.official ?? 0,
    logo: full.logo || brief.logo || '', symbol: full.symbol || brief.symbol || '',
    syncedAt: Date.now(),
  };
  const cards = (full.cards || []).map((c, i) => ({
    key: `${lang}:${c.id}`, lang, id: c.id, localId: String(c.localId ?? ''),
    name: c.name || '', image: c.image || '', setKey: key, order: i,
  }));
  await db.put('sets', set);
  await db.putMany('cards', cards);
  state.sets.set(key, set);
  for (const c of cards) state.cards.set(c.key, c);
  // Keep any cards you added yourself to this set
  const mine = (state.cardsBySet.get(key) || []).filter((c) => c.custom);
  state.cardsBySet.set(key, [...cards, ...mine].sort((a, b) => a.order - b.order));
}

// ---------- Pokédex ----------
const LANG_MAP = { en: 'en', 'ja-Hrkt': 'ja', ja: 'ja', 'zh-Hant': 'zhHant', 'zh-Hans': 'zhHans' };
const pretty = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function speciesRecord(id, slug, names) {
  const rec = { id, slug, en: pretty(slug) };
  for (const n of names) {
    const f = LANG_MAP[n.lang];
    if (!f) continue;
    if (f === 'ja' && rec.ja && n.lang === 'ja') continue; // prefer katakana (ja-Hrkt)
    rec[f] = n.name;
  }
  return rec;
}

async function speciesViaGraphQL() {
  const tries = [
    ['https://graphql.pokeapi.co/v1beta2', 'query { s: pokemonspecies(order_by:{id:asc}) { id name n: pokemonspeciesnames { name language { name } } } }'],
    ['https://beta.pokeapi.co/graphql/v1beta', 'query { s: pokemon_v2_pokemonspecies(order_by:{id:asc}) { id name n: pokemon_v2_pokemonspeciesnames { name language: pokemon_v2_language { name } } } }'],
  ];
  for (const [url, query] of tries) {
    try {
      const r = await fetchJSON(url, { method: 'POST', body: { query }, retries: 0, timeout: 30000 });
      const list = r?.data?.s;
      if (Array.isArray(list) && list.length > 800) {
        return list.map((s) => speciesRecord(s.id, s.name, (s.n || []).map((x) => ({ name: x.name, lang: x.language?.name }))));
      }
    } catch { /* try next */ }
  }
  return null;
}

export async function syncSpecies(nested = false) {
  if (!online()) throw new Error('You are offline.');
  if (!nested) { if (job.running) return; job.running = true; job.stop = false; }
  try {
    report('Downloading Pokédex…', 0, 0);
    let list = await speciesViaGraphQL();
    if (!list) {
      const idx = await fetchJSON(`${POKEAPI}/pokemon-species?limit=2000`);
      const items = (idx?.results || []).map((r) => ({ slug: r.name, id: +r.url.split('/').filter(Boolean).pop() }));
      // Save English list straight away so the Pokédex works while names load
      list = items.map((i) => ({ id: i.id, slug: i.slug, en: pretty(i.slug) }));
      await db.putMany('species', list); setSpecies(list); emit('species');
      let n = 0;
      await pool(items, 10, async (it) => {
        try {
          const d = await fetchJSON(`${POKEAPI}/pokemon-species/${it.id}`, { retries: 1 });
          const rec = speciesRecord(it.id, it.slug, (d?.names || []).map((x) => ({ name: x.name, lang: x.language?.name })));
          const i = list.findIndex((x) => x.id === it.id);
          list[i] = rec;
        } catch { /* keep English */ }
        report('Downloading Pokédex names', ++n, items.length);
      }, () => job.stop);
    }
    await db.putMany('species', list);
    setSpecies(list);
    rebuildDex();
    emit('species');
    // Small sprites for offline use
    const have = new Set(await db.getAllKeys('sprites'));
    const need = list.filter((s) => !have.has(s.id));
    let n = 0, batch = [];
    await pool(need, 8, async (s) => {
      try { const b = await fetchBlob(SPRITE(s.id)); if (b) batch.push([s.id, b]); } catch { /* ignore */ }
      if (batch.length >= 40) { const b = batch; batch = []; await db.putMany('sprites', b, true); }
      report('Downloading Pokémon pictures', ++n, need.length);
    }, () => job.stop);
    await db.putMany('sprites', batch, true);
    emit('sprites');
  } finally {
    if (!nested) { job.running = false; report('', 0, 0); }
  }
}

// ---------- Card images saved for offline use ----------
export function cardsMissingImages(keys) {
  return keys.filter((k) => !state.imageKeys.has(k) && state.cards.get(k)?.image);
}

/** Downloads one card's small image and keeps it on the phone. */
async function fetchOne(key) {
  const card = state.cards.get(key);
  if (!card?.image) return null;
  // Reuse the picture if you've already viewed it
  const cached = await db.get('imgcache', key);
  const blob = cached?.b || await fetchBlob(cardImg(card, 'low'));
  if (!blob || blob.size <= 500) return null;
  let fp = null;
  try { fp = await fingerprintBlob(blob); } catch { /* image couldn't be read */ }
  return { blob, fp };
}

export function remember(key, fp) {
  state.imageKeys.add(key);
  if (fp) { localFps?.set(key, fp); merged = null; }
}

// Quiet background saving (e.g. cards you add to your collection). No progress bar.
const quiet = { queue: new Set(), running: false };
export function keepOffline(keys) {
  for (const k of cardsMissingImages(keys)) quiet.queue.add(k);
  runQuiet();
}
async function runQuiet() {
  if (quiet.running || !online()) return;
  quiet.running = true;
  let saved = 0;
  try {
    while (quiet.queue.size && online()) {
      const batch = [...quiet.queue].slice(0, 4);
      batch.forEach((k) => quiet.queue.delete(k));
      await Promise.all(batch.map(async (key) => {
        if (state.imageKeys.has(key)) return;
        try {
          const r = await fetchOne(key);
          if (!r) return;
          await db.put('images', r.blob, key);
          if (r.fp) await db.put('fps', r.fp, key);
          remember(key, r.fp);
          saved++;
        } catch { /* try again another time */ }
      }));
    }
  } finally {
    quiet.running = false;
    if (saved) emit('images');
  }
}

/** Saves a group of cards for offline use, with a progress bar. */
export async function downloadImages(keys, label = 'Saving cards for offline') {
  if (job.running) throw new Error('Another download is already running.');
  if (!online()) throw new Error('You are offline.');
  const todo = cardsMissingImages(keys);
  if (!todo.length) return { done: 0, failed: 0 };
  job.running = true; job.stop = false;
  let done = 0, failed = 0, imgs = [], fps = [];
  const flush = async () => {
    const a = imgs, b = fps; imgs = []; fps = [];
    await db.putMany('images', a, true);
    await db.putMany('fps', b, true);
  };
  try {
    await pool(todo, 6, async (key) => {
      try {
        const r = await fetchOne(key);
        if (r) {
          imgs.push([key, r.blob]);
          if (r.fp) fps.push([key, r.fp]);
          remember(key, r.fp);
        } else failed++;
      } catch { failed++; }
      done++;
      if (imgs.length >= 30) await flush();
      report(label, done, todo.length);
    }, () => job.stop);
    await flush();
  } finally {
    job.running = false;
    report('', 0, 0);
    emit('images');
  }
  return { done, failed };
}

export async function deleteImages(keys) {
  await db.delMany('images', keys);
  await db.delMany('fps', keys);
  for (const k of keys) { state.imageKeys.delete(k); localFps?.delete(k); }
  merged = null;
  emit('images');
}

// ---------- Scan data ----------
// The scanner compares your photo with a "fingerprint" of every card.
// Fingerprints for all cards are made on GitHub once a month (see
// build/make_scan_data.py) and downloaded as one small file per language.
// Cards you saved offline also have their own fingerprints.
let localFps = null;   // from images saved on the phone
let remoteFps = null;  // from the downloaded scan data
let merged = null;

export async function loadFingerprints() {
  if (!localFps) {
    const entries = await db.getAllEntries('fps');
    localFps = new Map([...entries].filter(([, v]) => v));
  }
  if (!remoteFps) {
    remoteFps = new Map();
    for (const lang of state.settings.langs) {
      const rec = await db.get('meta', `scan:${lang}`);
      if (!rec || rec.v !== FP_VERSION) continue;
      const n = rec.size || FP_LEN;
      rec.keys.forEach((id, i) => remoteFps.set(`${lang}:${id}`, rec.fp.subarray(i * n, (i + 1) * n)));
    }
  }
  if (!merged) merged = new Map([...remoteFps, ...localFps]);
  return merged;
}

export async function scanDataInfo() {
  const out = {};
  for (const lang of state.settings.langs) {
    const rec = await db.get('meta', `scan:${lang}`);
    out[lang] = rec && rec.v === FP_VERSION ? { count: rec.keys.length, built: rec.built } : null;
  }
  return out;
}

const SCAN_CHECK_EVERY = 7 * 24 * 3600 * 1000;
/** True when scan data has never been fetched or hasn't been checked for a week. */
export async function scanDataStale() {
  const last = await db.get('meta', 'scanCheck');
  return !last || Date.now() - last > SCAN_CHECK_EVERY;
}

/**
 * Downloads scan data for your languages (only files that changed).
 * Returns {updated: [...langs], missing: [...langs]}.
 */
export async function updateScanData({ force = false } = {}) {
  if (!online()) throw new Error('Connect to the internet to get scan data.');
  const index = await fetchJSON(`${SCAN_DATA}/index.json?t=${Date.now()}`, { retries: 1 });
  if (!index) throw new Error('Scan data isn’t ready yet. GitHub builds it after you upload the app, which can take an hour the first time.');
  const updated = [], missing = [];
  for (const lang of state.settings.langs) {
    const e = index[lang];
    if (!e || e.v !== FP_VERSION) { missing.push(lang); continue; }
    const cur = await db.get('meta', `scan:${lang}`);
    if (!force && cur && cur.v === e.v && cur.built === e.built) continue;
    report(`Getting scan data (${lang.toUpperCase()}, ~${Math.max(1, Math.round((e.bytes || 0) / 1048576))} MB)`, 0, 0);
    try {
      const d = await fetchJSON(`${SCAN_DATA}/${e.file}?b=${encodeURIComponent(e.built)}`, { timeout: 120000, retries: 1 });
      if (!d?.keys || !d.fp) { missing.push(lang); continue; }
      const bin = atob(d.fp);
      const fp = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) fp[i] = bin.charCodeAt(i);
      await db.put('meta', { v: d.v, built: d.built, keys: d.keys, fp, size: d.keys.length ? fp.length / d.keys.length : FP_LEN }, `scan:${lang}`);
      updated.push(lang);
    } catch { missing.push(lang); }
  }
  report('', 0, 0);
  await db.put('meta', Date.now(), 'scanCheck');
  remoteFps = null; merged = null;
  emit('scan');
  return { updated, missing };
}

// ---------- Card details (rarity, illustrator, prices) ----------
const WEEK = 7 * 24 * 3600 * 1000;
export async function cardDetail(key) {
  const cached = await db.get('details', key);
  if (cached && (Date.now() - cached._at < WEEK || !online())) return cached;
  if (!online()) return cached || null;
  const card = state.cards.get(key);
  if (card?.src === 'chs' || card?.src === 'pcj') return { ...card.det };
  if (!card || card.custom) return cached || null;
  try {
    const d = await tcg.card(card.lang, card.id);
    if (!d) return cached || null;
    const keep = {
      _at: Date.now(), rarity: d.rarity, illustrator: d.illustrator, category: d.category,
      hp: d.hp, types: d.types, stage: d.stage, dexId: d.dexId, variants: d.variants,
      regulationMark: d.regulationMark, pricing: d.pricing || null,
    };
    await db.put('details', keep, key);
    if (d.dexId?.length) {
      const before = state.cardDex.get(key) || [];
      dexOverrides.set(key, d.dexId);
      if (before.join() !== d.dexId.join()) rebuildDex();
    }
    return keep;
  } catch {
    return cached || null;
  }
}

/** Best guess at a card's market value in its currency, from cached details. */
export function priceOf(detail) {
  const p = detail?.pricing;
  if (!p) return null;
  const cm = p.cardmarket;
  if (cm && (cm.trend || cm.avg)) return { value: cm.trend || cm.avg, currency: '€', source: 'Cardmarket' };
  const tp = p.tcgplayer;
  if (tp) {
    for (const v of ['holofoil', 'normal', 'reverse-holofoil', '1st-edition-holofoil', 'unlimited-holofoil']) {
      const m = tp[v]?.marketPrice || tp[v]?.midPrice;
      if (m) return { value: m, currency: 'US$', source: 'TCGplayer' };
    }
  }
  return null;
}
