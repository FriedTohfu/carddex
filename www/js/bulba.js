// Pictures for old Japanese cards (1996–2006) from Bulbapedia.
// TCGdex lists these sets but has no pictures for them. The phone asks
// Bulbapedia's API for each set's Japanese card list (same order as TCGdex)
// and each card page's picture, then remembers the result.
import * as db from './db.js';
import { fetchJSON, online } from './api.js';
import { state, emit } from './store.js';

const API = 'https://bulbapedia.bulbagarden.net/w/api.php';

// TCGdex set id → Bulbapedia page of the Japanese set
const PAGES = {
  PMCG1: 'Expansion Pack (TCG)', PMCG2: 'Pokémon Jungle (TCG)', PMCG3: 'Mystery of the Fossils (TCG)',
  PMCG4: 'Rocket Gang (TCG)', PMCG5: "Leaders' Stadium (TCG)", PMCG6: 'Challenge from the Darkness (TCG)',
  neo1: 'Gold, Silver, to a New World... (TCG)', neo2: 'Crossing the Ruins... (TCG)',
  neo3: 'Awakening Legends (TCG)', neo4: 'Darkness, and to Light... (TCG)',
  VS1: 'Pokémon VS (TCG)', web1: 'Pokémon Web (TCG)',
  E1: 'Base Expansion Pack (TCG)', E2: 'The Town on No Map (TCG)', E3: 'Wind from the Sea (TCG)',
  E4: 'Split Earth (TCG)', E5: 'Mysterious Mountains (TCG)',
  ADV1: 'ADV Expansion Pack (TCG)', ADV2: 'Miracle of the Desert (TCG)', ADV3: 'Rulers of the Heavens (TCG)',
  ADV4: 'Undone Seal (TCG)',
  PCG1: 'Flight of Legends (TCG)', PCG2: 'Clash of the Blue Sky (TCG)', PCG3: 'Rocket Gang Strikes Back (TCG)',
  PCG4: 'Golden Sky, Silvery Ocean (TCG)', PCG5: 'Mirage Forest (TCG)', PCG6: 'Holon Research Tower (TCG)',
  PCG7: 'Holon Phantom (TCG)', PCG8: 'Miracle Crystal (TCG)', PCG9: 'Offense and Defense of the Furthest Ends (TCG)',
  PCG10: 'World Champions Pack (TCG)',
};

const api = (params) => fetchJSON(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`, { timeout: 30000, retries: 1 });

/** Card-page titles in the set's Japanese list, in order. */
async function cardTitles(page, count) {
  const r = await api({ action: 'parse', page, prop: 'text', redirects: '1' });
  const html = r?.parse?.text;
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const want = page.replace(/ \(TCG\)$/, '').toLowerCase();
  const tables = [];
  for (const t of doc.querySelectorAll('table')) {
    const head = t.querySelector('tr')?.textContent || '';
    if (!/Card name/.test(head) || !/No\./.test(head)) continue;
    // its heading: the bold title at the top of the box around the list
    const box = t.parentElement?.closest('table');
    const title = (box?.querySelector('big b')?.textContent || '').trim().toLowerCase();
    const titles = [];
    for (const tr of t.querySelectorAll(':scope > tbody > tr, :scope > tr')) {
      const a = [...tr.querySelectorAll('a[href^="/wiki/"]')].find((x) => /_\([^)]*\)$/.test(decodeURIComponent(x.getAttribute('href'))) && !/\(TCG\)$|^\/wiki\/File:/.test(decodeURIComponent(x.getAttribute('href'))));
      if (a) titles.push(decodeURIComponent(a.getAttribute('href').slice(6)).replace(/_/g, ' '));
    }
    if (titles.length) tables.push({ title, titles });
  }
  const named = tables.filter((t) => t.title === want);
  const pick = (named.length ? named : tables).find((t) => t.titles.length === count)
    || (named[0] && Math.abs(named[0].titles.length - count) <= 2 ? named[0] : null);
  return pick?.titles || null;
}

const norm = (x) => String(x || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/'s\b/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

/** Follows Bulbapedia's renames/redirects for a title. */
function resolver(q) {
  const alias = new Map();
  for (const n of q.normalized || []) alias.set(n.from, n.to);
  for (const n of q.redirects || []) alias.set(n.from, n.to);
  return (t) => { let k = t; for (let n = 0; n < 4 && alias.has(k); n++) k = alias.get(k); return k; };
}

/** All results of a query, following "continue". */
async function queryAll(params) {
  const pages = new Map(), norms = [], redirs = [];
  let cont = {};
  for (let n = 0; n < 10; n++) {
    const r = await api({ action: 'query', ...params, ...cont });
    const q = r?.query || {};
    norms.push(...(q.normalized || [])); redirs.push(...(q.redirects || []));
    for (const p of q.pages || []) {
      const cur = pages.get(p.title) || { ...p, images: [] };
      cur.images = [...cur.images, ...(p.images || [])];
      if (p.imageinfo) cur.imageinfo = p.imageinfo;
      pages.set(p.title, cur);
    }
    if (!r?.continue) break;
    cont = r.continue;
  }
  return { pages, resolve: resolver({ normalized: norms, redirects: redirs }) };
}

/** The card scan on each card page (picked by Bulbapedia's naming: "Bulbasaur (Base Set 44)" → BulbasaurBaseSet44.jpg). */
async function pictures(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const part = titles.slice(i, i + 50);
    const { pages, resolve } = await queryAll({ titles: part.join('|'), redirects: '1', prop: 'images', imlimit: 'max' });
    const chosen = new Map(); // card title -> file title
    for (const t of part) {
      const page = pages.get(resolve(t));
      if (!page) continue;
      const m = page.title.match(/^(.*) \((.*)\)$/);
      const key = norm(page.title), name = norm(m?.[1]), inner = norm(m?.[2]);
      const files = page.images.map((x) => x.title).filter((f) => /\.(jpe?g|png)$/i.test(f));
      const stem = (f) => norm(f.replace(/^File:/, '').replace(/\.[^.]+$/, ''));
      const pick = files.find((f) => stem(f) === key)
        || files.find((f) => { const s2 = stem(f); return name && inner && s2.startsWith(name) && s2.endsWith(inner); });
      if (pick) chosen.set(t, pick);
    }
    const files = [...new Set(chosen.values())];
    if (!files.length) continue;
    const { pages: info, resolve: res2 } = await queryAll({ titles: files.join('|'), prop: 'imageinfo', iiprop: 'url', iiurlwidth: '320' });
    for (const [t, f] of chosen) {
      const ii = info.get(res2(f))?.imageinfo?.[0];
      if (ii?.url) out.set(t, [ii.url, ii.thumburl || ii.url]);
    }
  }
  return out;
}

function setCards(setKey) {
  return (state.cardsBySet.get(setKey) || []).filter((c) => !c.custom && !c.extra)
    .sort((a, b) => (parseInt(a.localId, 10) || 0) - (parseInt(b.localId, 10) || 0));
}

/** Puts saved Bulbapedia pictures onto cards (after a card-list refresh wipes them). */
async function applySaved(setKey, saved) {
  const changed = [];
  for (const c of setCards(setKey)) {
    const p = saved[c.localId];
    if (!p || (c.image && c.imgSrc !== 'bp')) continue;
    if (c.image !== p[0]) { c.image = p[0]; c.thumb = p[1]; c.imgSrc = 'bp'; changed.push(c); }
  }
  if (changed.length) await db.putMany('cards', changed);
  return changed.length;
}

let running = false;
/** Fills in pictures for every old Japanese set that has none. Quietly does nothing if Bulbapedia can't be reached. */
export async function fillVintagePictures() {
  if (running || !state.settings.langs.includes('ja') || state.syncInfo.ja?.source === 'pkmn.gg') return 0;
  running = true;
  let total = 0;
  try {
    for (const [id, page] of Object.entries(PAGES)) {
      const setKey = `ja:${id}`;
      const cards = setCards(setKey);
      if (!cards.length || cards.every((c) => c.image)) continue;
      const key = `bp:${id}`;
      const prev = await db.get('details', key);
      let saved = prev?.pics;
      const stale = !saved || (!Object.keys(saved).length && Date.now() - (prev.at || 0) > 7 * 864e5);
      if (stale && online()) {
        try {
          const titles = await cardTitles(page, cards.length);
          if (!titles) { await db.put('details', { pics: {}, at: Date.now() }, key); continue; }
          const pics = await pictures(titles);
          saved = {};
          const exact = titles.length === cards.length;
          cards.forEach((c, i) => {
            const t = titles[i], p = t && pics.get(t);
            if (!p) return;
            // Safety check: the Pokémon on the card must be the one in Bulbapedia's title
            const ids = state.cardDex.get(c.key) || [];
            const ok = ids.length ? ids.some((id) => norm(t).includes(norm(state.speciesById.get(id)?.en))) : exact;
            if (ok) saved[c.localId] = p;
          });
          await db.put('details', { pics: saved, at: Date.now() }, key);
        } catch { continue; } // Bulbapedia unavailable: try again next time
      }
      if (saved) total += await applySaved(setKey, saved);
    }
  } finally { running = false; }
  if (total) emit('catalog');
  return total;
}
