// Online data sources (only used when you have internet).
// Cards: TCGdex (free, open card database) — https://tcgdex.dev
// Pokédex names/sprites: PokéAPI — https://pokeapi.co
export const TCG = 'https://api.tcgdex.net/v2';
export const POKEAPI = 'https://pokeapi.co/api/v2';
// Scan data built by this app's own GitHub repository (see build/make_scan_data.py)
export const SCAN_DATA = 'https://raw.githubusercontent.com/FriedTohfu/carddex/main/data';
export const SPRITE = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

export const LANGS = {
  'en': { label: 'English', short: 'EN', flag: '🇬🇧' },
  'ja': { label: 'Japanese', short: 'JP', flag: '🇯🇵' },
  'zh-tw': { label: 'Chinese (Traditional)', short: '繁', flag: '🇹🇼' },
  'zh-cn': { label: 'Chinese (Simplified)', short: '简', flag: '🇨🇳' },
};

export async function fetchJSON(url, { timeout = 20000, retries = 2, method = 'GET', body } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal, method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/** Downloads a file as a Blob. Falls back to the phone's native downloader if the web request is blocked. */
export async function fetchBlob(url, timeout = 25000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch (e) {
    const FS = window.Capacitor?.Plugins?.Filesystem;
    if (!FS?.downloadFile) throw e;
    const path = 'dl-' + Math.random().toString(36).slice(2);
    await FS.downloadFile({ url, path, directory: 'CACHE' });
    const r = await FS.readFile({ path, directory: 'CACHE' });
    FS.deleteFile({ path, directory: 'CACHE' }).catch(() => {});
    const bin = atob(r.data);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: url.endsWith('.png') ? 'image/png' : 'image/webp' });
  }
}

export const tcg = {
  sets: (lang) => fetchJSON(`${TCG}/${lang}/sets`),
  set: (lang, id) => fetchJSON(`${TCG}/${lang}/sets/${encodeURIComponent(id)}`),
  card: (lang, id) => fetchJSON(`${TCG}/${lang}/cards/${encodeURIComponent(id)}`, { retries: 1 }),
};

export function cardImageUrl(image, quality = 'low') {
  return image ? `${image}/${quality}.webp` : null;
}
export function assetUrl(base) {
  return base ? `${base}.webp` : null;
}

export function online() {
  return navigator.onLine !== false;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` over items with limited parallelism. */
export async function pool(items, limit, fn, shouldStop = () => false) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && !shouldStop()) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}
