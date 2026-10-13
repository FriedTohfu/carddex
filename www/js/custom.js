// Cards you add yourself (for cards missing from the online database,
// e.g. some Simplified Chinese exclusives). They behave like any other card.
import * as db from './db.js';
import { state, emit, rebuildDex, uid, changeOwned } from './store.js';
import { remember } from './sync.js';
import { fingerprint } from './fp.js';

export const CARD_W = 490, CARD_H = 686;

/** Crops a photo to the card shape. rect = {x,y,w,h} in source pixels, or null to centre-crop. */
export function cropCard(src, rect = null) {
  const sw = src.width || src.videoWidth, sh = src.height || src.videoHeight;
  if (!rect) {
    const aspect = 63 / 88;
    let w = sw, h = sw / aspect;
    if (h > sh) { h = sh; w = sh * aspect; }
    rect = { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
  }
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const g = c.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, CARD_W, CARD_H);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, CARD_W, CARD_H);
  return c;
}

export function canvasToBlob(canvas) {
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
}

function orderFor(setKey, localId) {
  const cards = state.cardsBySet.get(setKey) || [];
  const n = parseInt(localId, 10);
  if (Number.isFinite(n)) {
    const after = cards.find((c) => parseInt(c.localId, 10) > n);
    if (after) return after.order - 0.5 + Math.random() * 0.01;
  }
  return (cards.length ? cards[cards.length - 1].order : 0) + 1;
}

async function ensureSet(lang, setKey, newSetName, official) {
  if (setKey) return state.sets.get(setKey);
  const id = `custom-set-${uid()}`;
  const set = {
    key: `${lang}:${id}`, lang, id, name: newSetName || 'My extra cards', custom: true,
    serie: 'Added by you', releaseDate: new Date().toISOString().slice(0, 10),
    total: 0, official: official || 0, logo: '', symbol: '', syncedAt: Date.now(),
  };
  await db.put('sets', set);
  state.sets.set(set.key, set);
  state.cardsBySet.set(set.key, []);
  return set;
}

function placeInSet(card) {
  const arr = (state.cardsBySet.get(card.setKey) || []).filter((c) => c.key !== card.key);
  arr.push(card);
  arr.sort((a, b) => a.order - b.order);
  state.cardsBySet.set(card.setKey, arr);
}

async function savePhoto(key, canvas) {
  const blob = await canvasToBlob(canvas);
  const fp = fingerprint(canvas);
  await db.put('images', blob, key);
  await db.put('fps', fp, key);
  remember(key, fp);
  const { forgetImage } = await import('./ui.js');
  forgetImage(key);
}

/** data: {lang, name, number, setKey | newSetName, photo (canvas, already card-shaped), owned} */
export async function addCustomCard(data) {
  const [num, of] = String(data.number || '').split('/').map((x) => x.trim());
  const set = await ensureSet(data.lang, data.setKey, data.newSetName, of ? parseInt(of, 10) : 0);
  const id = `custom-${uid()}`;
  const card = {
    key: `${set.lang}:${id}`, lang: set.lang, id, localId: num || '?', name: data.name.trim(),
    image: '', setKey: set.key, order: orderFor(set.key, num), custom: true, addedAt: Date.now(),
  };
  await db.put('cards', card);
  state.cards.set(card.key, card);
  placeInSet(card);
  await bumpSetTotal(set);
  if (data.photo) await savePhoto(card.key, data.photo);
  rebuildDex();
  emit('catalog'); emit('images');
  if (data.owned) await changeOwned(card.key, 'normal', 1);
  return card;
}

export async function updateCustomCard(key, data) {
  const card = state.cards.get(key);
  if (!card?.custom) return;
  const [num] = String(data.number ?? card.localId).split('/').map((x) => x.trim());
  if (data.name) card.name = data.name.trim();
  if (num && num !== card.localId) { card.localId = num; card.order = orderFor(card.setKey, num); }
  await db.put('cards', card);
  placeInSet(card);
  if (data.photo) await savePhoto(key, data.photo);
  rebuildDex();
  emit('catalog'); emit('images');
}

export async function deleteCustomCard(key) {
  const card = state.cards.get(key);
  if (!card?.custom) return;
  await db.del('cards', key);
  await db.delMany('images', [key]);
  await db.delMany('fps', [key]);
  await db.del('owned', key);
  state.cards.delete(key);
  state.owned.delete(key);
  state.imageKeys.delete(key);
  state.cardsBySet.set(card.setKey, (state.cardsBySet.get(card.setKey) || []).filter((c) => c.key !== key));
  for (const w of state.wishlists.values()) if (w.cards.includes(key)) { w.cards = w.cards.filter((k) => k !== key); await db.put('wishlists', w); }
  for (const b of state.binders.values()) if (b.pages.some((p) => p.includes(key))) { b.pages = b.pages.map((p) => p.map((k) => (k === key ? null : k))); await db.put('binders', b); }
  const set = state.sets.get(card.setKey);
  if (set?.custom && !(state.cardsBySet.get(set.key) || []).length) {
    await db.del('sets', set.key); state.sets.delete(set.key); state.cardsBySet.delete(set.key);
  } else if (set) await bumpSetTotal(set);
  rebuildDex();
  emit('catalog'); emit('owned'); emit('wishlists'); emit('binders'); emit('images');
}

async function bumpSetTotal(set) {
  if (!set.custom) return;
  set.total = (state.cardsBySet.get(set.key) || []).length;
  await db.put('sets', set);
}

// ---------- Backup support ----------
async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function exportCustom() {
  const cards = [...state.cards.values()].filter((c) => c.custom);
  const setKeys = new Set(cards.map((c) => c.setKey));
  const sets = [...state.sets.values()].filter((s) => s.custom && setKeys.has(s.key));
  const photos = {};
  for (const c of cards) {
    const b = await db.get('images', c.key);
    if (b) photos[c.key] = await blobToB64(b);
  }
  return { cards, sets, photos };
}

export async function importCustom(data) {
  if (!data) return;
  for (const s of data.sets || []) { await db.put('sets', s); state.sets.set(s.key, s); if (!state.cardsBySet.has(s.key)) state.cardsBySet.set(s.key, []); }
  for (const c of data.cards || []) {
    await db.put('cards', c);
    state.cards.set(c.key, c);
    placeInSet(c);
    const b64 = data.photos?.[c.key];
    if (b64) {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([arr], { type: 'image/jpeg' }));
      const c2 = cropCard(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height });
      await savePhoto(c.key, c2);
    }
  }
  rebuildDex();
  emit('catalog');
}
