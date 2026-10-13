// Tiny IndexedDB wrapper. All app data lives on the phone.
const DB_NAME = 'carddex';
const DB_VERSION = 1;
export const STORES = {
  meta: 'meta',        // key -> any (settings, sync info)
  sets: 'sets',        // key "lang:setId"
  cards: 'cards',      // key "lang:cardId"
  images: 'images',    // key "lang:cardId" -> Blob (small image)
  fps: 'fps',          // key "lang:cardId" -> Uint8Array fingerprint for scanning
  owned: 'owned',      // key "lang:cardId"
  wishlists: 'wishlists',
  binders: 'binders',
  details: 'details',  // key "lang:cardId" -> full card info (rarity, prices…)
  species: 'species',  // key dex number
  sprites: 'sprites',  // key dex number -> Blob
  logos: 'logos',      // key url -> Blob (set logos / symbols)
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        if (name === 'wishlists' || name === 'binders') db.createObjectStore(name, { keyPath: 'id' });
        else if (name === 'sets' || name === 'cards' || name === 'owned') db.createObjectStore(name, { keyPath: 'key' });
        else if (name === 'species') db.createObjectStore(name, { keyPath: 'id' });
        else db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}
export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
export async function getAllKeys(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAllKeys());
}
/** Returns Map(key -> value) for a key/value store. */
export async function getAllEntries(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = new Map();
    const req = db.transaction(store).objectStore(store).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out.set(c.key, c.value); c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}
export async function put(store, value, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
  return done(tx);
}
/** items: array of values (keyPath stores) or [key, value] pairs (plain stores). */
export async function putMany(store, items, pairs = false) {
  if (!items.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const it of items) pairs ? os.put(it[1], it[0]) : os.put(it);
  return done(tx);
}
export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}
export async function delMany(store, keys) {
  if (!keys.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  return done(tx);
}
export async function clear(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}
export async function count(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).count());
}
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
