// In-memory app state, loaded from the phone's database at startup.
import * as db from './db.js';
import { buildDexIndex } from './dex.js';

const DEFAULT_SETTINGS = {
  langs: ['en', 'ja', 'zh-cn'],
  theme: 'auto',            // auto | light | dark
  includeSecrets: true,     // count secret rares toward set progress
  keepOwnedOffline: true,   // save images of cards you own so they show offline
  dexShowCards: true,       // Pokédex shows your latest card of each Pokémon
  dexStickySearch: true,    // Pokédex search bar stays visible while scrolling down
  currency: 'AUD',          // currency for prices
  scanLangs: [],            // empty = all enabled languages
  scanContinuous: true,     // return to the camera after adding a card
};

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  sets: new Map(),
  cards: new Map(),
  cardsBySet: new Map(),
  owned: new Map(),
  wishlists: new Map(),
  binders: new Map(),
  species: [],          // [{id, en, ja, zhHant, zhHans}]
  speciesById: new Map(),
  dexIndex: new Map(),  // dexId -> [cardKey]
  cardDex: new Map(),   // cardKey -> [dexId]
  imageKeys: new Set(), // cards whose image is saved offline
  syncInfo: {},         // lang -> {at, sets, cards}
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

export async function loadAll() {
  const [settings, syncInfo, sets, cards, owned, wls, binders, species, imgKeys, details] = await Promise.all([
    db.get('meta', 'settings'), db.get('meta', 'syncInfo'),
    db.getAll('sets'), db.getAll('cards'), db.getAll('owned'),
    db.getAll('wishlists'), db.getAll('binders'), db.getAll('species'),
    db.getAllKeys('images'), db.getAllEntries('details'),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  // One-time change: Traditional Chinese is off unless you turn it back on
  if (!state.settings.zhTwOff) {
    state.settings.langs = state.settings.langs.filter((l) => l !== 'zh-tw');
    if (!state.settings.langs.length) state.settings.langs = ['en'];
    state.settings.zhTwOff = true;
    await db.put('meta', state.settings, 'settings');
  }
  state.syncInfo = syncInfo || {};
  state.recent = (await db.get('meta', 'recent').catch(() => null)) || [];
  const types = await db.get('meta', 'types').catch(() => null);
  state.speciesTypes = new Map(Object.entries(types?.types || {}).map(([k, v]) => [+k, v]));
  state.typesBuilt = types?.built || '';
  setCatalog(sets, cards);
  for (const o of owned) state.owned.set(o.key, o);
  for (const w of wls) state.wishlists.set(w.id, w);
  for (const b of binders) state.binders.set(b.id, b);
  setSpecies(species);
  state.imageKeys = new Set(imgKeys);
  // Exact Pokédex numbers we learned from detailed card info
  for (const [k, d] of details) if (d?.dexId?.length) dexOverrides.set(k, d.dexId);
  rebuildDex();
}

export const dexOverrides = new Map();

export function setCatalog(sets, cards) {
  state.sets = new Map(sets.map((s) => [s.key, s]));
  state.cards = new Map(cards.map((c) => [c.key, c]));
  state.cardsBySet = new Map();
  for (const c of cards) {
    let arr = state.cardsBySet.get(c.setKey);
    if (!arr) state.cardsBySet.set(c.setKey, (arr = []));
    arr.push(c);
  }
  for (const arr of state.cardsBySet.values()) arr.sort((a, b) => a.order - b.order);
}

export function setSpecies(list) {
  state.species = [...list].sort((a, b) => a.id - b.id);
  state.speciesById = new Map(state.species.map((s) => [s.id, s]));
}

export function rebuildDex() {
  const { dexIndex, cardDex } = buildDexIndex(state.cards.values(), state.species, dexOverrides);
  state.dexIndex = dexIndex;
  state.cardDex = cardDex;
}

export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await db.put('meta', state.settings, 'settings');
  emit('settings');
}

export function enabledLangs() {
  return state.settings.langs;
}

// ---------- Sets ----------
export function setsForLang(lang) {
  return [...state.sets.values()].filter((s) => s.lang === lang).sort(sortSets);
}
export function allSetsSorted() {
  return [...state.sets.values()].filter((s) => state.settings.langs.includes(s.lang)).sort(sortSets);
}
function sortSets(a, b) {
  return (b.releaseDate || '').localeCompare(a.releaseDate || '') || (b.rank || 0) - (a.rank || 0) || a.name.localeCompare(b.name);
}

function isSecret(card, set) {
  if (!set?.official) return false;
  const n = parseInt(card.localId, 10);
  return Number.isFinite(n) && String(n) === String(card.localId).replace(/^0+(?=\d)/, '') && n > set.official;
}

export function setCardsForProgress(setKey) {
  const cards = state.cardsBySet.get(setKey) || [];
  if (state.settings.includeSecrets) return cards;
  const set = state.sets.get(setKey);
  return cards.filter((c) => !isSecret(c, set));
}

/**
 * Master set: English sets from Legendary Collection (2002) on have a reverse holo of every
 * Common, Uncommon, Rare and Holo — in master set mode those need both copies to count.
 */
export function needsReverse(card, set = state.sets.get(card.setKey)) {
  if (!state.settings.masterSet || card.lang !== 'en' || !set) return false;
  if ((set.releaseDate || '') < '2002-05-24' || /promo|energ/i.test(set.name || '')) return false;
  const r = String(card.det?.rarity || '').toLowerCase();
  return /^(common|uncommon|rare|rare holo|holo rare)$/.test(r);
}
export function ownedForProgress(card, set) {
  const o = state.owned.get(card.key);
  if (!o || !qty(card.key)) return false;
  if (!needsReverse(card, set)) return true;
  const c = o.counts || {};
  return (c.reverse || 0) > 0 && ((c.normal || 0) + (c.holo || 0) + (c.firstEdition || 0)) > 0;
}

export function setProgress(setKey) {
  const cards = setCardsForProgress(setKey);
  const st = state.sets.get(setKey);
  let owned = 0;
  for (const c of cards) if (ownedForProgress(c, st)) owned++;
  const set = state.sets.get(setKey);
  const total = cards.length || (state.settings.includeSecrets ? set?.total : set?.official) || 0;
  return { owned, total, pct: total ? owned / total : 0 };
}

// ---------- Collection ----------
export const VARIANTS = [
  ['normal', 'Normal'], ['reverse', 'Reverse holo'], ['holo', 'Holo'], ['firstEdition', '1st Edition'],
];
export const CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

export function qty(key) {
  const o = state.owned.get(key);
  if (!o) return 0;
  return Object.values(o.counts || {}).reduce((a, b) => a + (b || 0), 0);
}
export function isOwned(key) { return qty(key) > 0; }

export async function changeOwned(key, variant = 'normal', delta = 1) {
  let o = state.owned.get(key);
  const now = Date.now();
  if (!o) o = { key, counts: {}, condition: 'Near Mint', notes: '', addedAt: now };
  o.counts = { ...o.counts, [variant]: Math.max(0, (o.counts?.[variant] || 0) + delta) };
  o.updatedAt = now;
  if (Object.values(o.counts).every((v) => !v)) {
    state.owned.delete(key);
    await db.del('owned', key);
  } else {
    state.owned.set(key, o);
    await db.put('owned', o);
  }
  // Remember recent additions (Collection → Recently added, with undo)
  if (delta > 0) {
    const r = (state.recent ||= []);
    r.unshift({ key, variant, at: now });
    r.length = Math.min(r.length, 30);
    db.put('meta', r, 'recent').catch(() => {});
  }
  // Optional: a card you now own comes off your wishlists
  if (delta > 0 && state.settings.wishAutoRemove) {
    for (const w of state.wishlists.values()) {
      if (w.cards.includes(key)) { w.cards = w.cards.filter((k) => k !== key); await saveWishlist(w); }
    }
  }
  emit('owned');
  return o;
}

export async function updateOwnedMeta(key, patch) {
  const o = state.owned.get(key);
  if (!o) return;
  Object.assign(o, patch, { updatedAt: Date.now() });
  await db.put('owned', o);
  emit('owned');
}

export function collectionStats() {
  let total = 0, unique = 0;
  for (const k of state.owned.keys()) { const q = qty(k); if (q) { unique++; total += q; } }
  const sets = new Set();
  for (const k of state.owned.keys()) { const c = state.cards.get(k); if (c) sets.add(c.setKey); }
  return { total, unique, sets: sets.size };
}

// ---------- Wishlists ----------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function saveWishlist(w) {
  w.updatedAt = Date.now();
  state.wishlists.set(w.id, w);
  await db.put('wishlists', w);
  emit('wishlists');
}
export async function createWishlist(name, emoji = '⭐') {
  const w = { id: uid(), name, emoji, cards: [], createdAt: Date.now() };
  await saveWishlist(w);
  return w;
}
export async function deleteWishlist(id) {
  state.wishlists.delete(id);
  await db.del('wishlists', id);
  emit('wishlists');
}
export function wishlistsSorted() {
  return [...state.wishlists.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
export function wishlistsContaining(key) {
  return wishlistsSorted().filter((w) => w.cards.includes(key));
}

// ---------- Binders ----------
export const LAYOUTS = { 4: { cols: 2, rows: 2 }, 9: { cols: 3, rows: 3 }, 12: { cols: 3, rows: 4 } };

export async function saveBinder(b) {
  b.updatedAt = Date.now();
  state.binders.set(b.id, b);
  await db.put('binders', b);
  emit('binders');
}
export async function createBinder(name, size, pages = 10, color = '#d63a3a') {
  const b = { id: uid(), name, size, color, pages: Array.from({ length: pages }, () => Array(size).fill(null)), createdAt: Date.now() };
  await saveBinder(b);
  return b;
}
export async function deleteBinder(id) {
  state.binders.delete(id);
  await db.del('binders', id);
  emit('binders');
}
export function bindersSorted() {
  return [...state.binders.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

// ---------- Backup ----------
export async function exportBackup() {
  return {
    app: 'CardDex', version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings,
    owned: [...state.owned.values()],
    wishlists: [...state.wishlists.values()],
    binders: [...state.binders.values()],
  };
}
export async function importBackup(data, mode = 'merge') {
  if (!data || data.app !== 'CardDex') throw new Error('This is not a CardDex backup file.');
  if (mode === 'replace') {
    await Promise.all([db.clear('owned'), db.clear('wishlists'), db.clear('binders')]);
    state.owned.clear(); state.wishlists.clear(); state.binders.clear();
  }
  for (const o of data.owned || []) {
    const cur = state.owned.get(o.key);
    if (cur && mode === 'merge') {
      for (const [v, n] of Object.entries(o.counts || {})) cur.counts[v] = Math.max(cur.counts[v] || 0, n);
    } else state.owned.set(o.key, o);
  }
  for (const w of data.wishlists || []) state.wishlists.set(w.id, w);
  for (const b of data.binders || []) state.binders.set(b.id, b);
  await db.putMany('owned', [...state.owned.values()]);
  await db.putMany('wishlists', [...state.wishlists.values()]);
  await db.putMany('binders', [...state.binders.values()]);
  if (data.settings) await saveSettings({ ...data.settings });
  emit('owned'); emit('wishlists'); emit('binders');
}
