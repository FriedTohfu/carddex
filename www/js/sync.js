// Downloads card lists, Pokédex data and images to the phone.
import * as db from './db.js';
import { tcg, fetchJSON, fetchBlob, pool, POKEAPI, SPRITE, cardImageUrl, online } from './api.js';
import { state, emit, rebuildDex, setSpecies, dexOverrides } from './store.js';
import { fingerprintBlob } from './fp.js';

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

async function saveSet(lang, brief, full) {
  const key = `${lang}:${full.id}`;
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
  state.cardsBySet.set(key, cards);
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

// ---------- Card images (also used for scanning) ----------
export function cardsMissingImages(keys) {
  return keys.filter((k) => !state.imageKeys.has(k) && state.cards.get(k)?.image);
}

export async function downloadImages(keys, label = 'Downloading card images') {
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
      const card = state.cards.get(key);
      try {
        const blob = await fetchBlob(cardImageUrl(card.image, 'low'));
        if (blob && blob.size > 500) {
          let fp = null;
          try { fp = await fingerprintBlob(blob); } catch { /* image couldn't be read */ }
          imgs.push([key, blob]);
          if (fp) fps.push([key, fp]);
          state.imageKeys.add(key);
          if (fp) fpCache?.set(key, fp);
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
  for (const k of keys) { state.imageKeys.delete(k); fpCache?.delete(k); }
  emit('images');
}

// Fingerprints are loaded into memory the first time you scan.
let fpCache = null;
export async function loadFingerprints() {
  if (!fpCache) {
    const entries = await db.getAllEntries('fps');
    fpCache = new Map([...entries].filter(([, v]) => v));
  }
  return fpCache;
}

// ---------- Card details (rarity, illustrator, prices) ----------
const WEEK = 7 * 24 * 3600 * 1000;
export async function cardDetail(key) {
  const cached = await db.get('details', key);
  if (cached && (Date.now() - cached._at < WEEK || !online())) return cached;
  if (!online()) return cached || null;
  const card = state.cards.get(key);
  if (!card) return cached || null;
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
