// Remembers card pictures you've looked at, so they show instantly next time
// (and offline). Oldest pictures are forgotten once the cache gets big.
import * as db from './db.js';
import { online } from './api.js';

const MAX_ITEMS = 5000;      // ~100 MB of small card pictures
const PARALLEL = 8;
let corsOK = null;           // can we read pictures directly? (null = not tested yet)
let count = null;
const queue = [];            // newest requests first, so what's on screen loads first
const inflight = new Map();
let active = 0;

export async function cachedURL(key) {
  const hit = await db.get('imgcache', key);
  return hit?.b ? URL.createObjectURL(hit.b) : null;
}

/** Returns a displayable URL for a picture: from the phone if cached, else downloads and caches it. */
export async function cachedOrFetch(key, url) {
  const local = await cachedURL(key);
  if (local) return local;
  if (!online() || !url) return null;
  if (corsOK === false) return url; // fall back to letting the image load normally
  if (inflight.has(key)) return inflight.get(key);
  const p = new Promise((resolve) => { queue.push({ key, url, resolve }); pump(); });
  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}

function pump() {
  while (active < PARALLEL && queue.length) {
    const job = queue.pop();
    active++;
    run(job).finally(() => { active--; pump(); });
  }
}

async function run({ key, url, resolve }) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) { resolve(res.status === 404 ? null : url); return; }
    const blob = await res.blob();
    corsOK = true;
    resolve(URL.createObjectURL(blob));
    await db.put('imgcache', { b: blob, t: Date.now() }, key);
    if (count == null) count = await db.count('imgcache');
    if (++count > MAX_ITEMS) prune();
  } catch (e) {
    // A TypeError while online usually means the server doesn't allow direct reads
    if (corsOK === null && e?.name === 'TypeError' && online()) corsOK = false;
    resolve(url);
  }
}

let pruning = false;
async function prune() {
  if (pruning) return;
  pruning = true;
  try {
    const all = await db.getAllEntries('imgcache');
    const old = [...all].sort((a, b) => (a[1]?.t || 0) - (b[1]?.t || 0)).slice(0, Math.ceil(MAX_ITEMS * 0.2)).map(([k]) => k);
    await db.delMany('imgcache', old);
    count = all.size - old.length;
  } finally { pruning = false; }
}

export async function clearCache() {
  await db.clear('imgcache');
  count = 0;
}

export async function cacheCount() {
  return db.count('imgcache');
}
