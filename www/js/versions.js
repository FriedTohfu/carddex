// Finds the same card printed in different languages (English, Japanese,
// Chinese…). They share the artwork, so we compare the artwork part of each
// card's scan fingerprint. Card numbers and sets can differ between languages.
import { loadFingerprints } from './sync.js';
import { state } from './store.js';

const POP = new Uint8Array(256).map((_, i) => { let c = 0, n = i; while (n) { c += n & 1; n >>= 1; } return c; });

function artDistance(a, b) {
  let ham = 0;
  for (let i = 8; i < 16; i++) ham += POP[a[i] ^ b[i]];      // artwork shape
  let col = 0;
  for (let i = 16; i < 52; i++) col += Math.abs(a[i] - b[i]); // artwork colours
  return ham + (col / 36) * 0.25;
}

export const SAME_ART = 16;

/** Language order for picking which version represents a group. */
export function langOrder() {
  const pref = state.settings.preferLang || 'en';
  return [pref, ...['en', 'ja', 'zh-cn', 'zh-tw'].filter((l) => l !== pref)];
}

/**
 * Groups cards that are the same card in different languages.
 * Returns [{ rep: card, keys: [cardKey…] }] keeping the input order of representatives.
 */
export async function groupVersions(cards) {
  const fps = await loadFingerprints();
  const n = cards.length;
  const parent = cards.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const fp = cards.map((c) => fps.get(c.key) || null);
  for (let i = 0; i < n; i++) {
    if (!fp[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (!fp[j] || cards[i].lang === cards[j].lang) continue; // only link across languages
      if (artDistance(fp[i], fp[j]) <= SAME_ART) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  cards.forEach((c, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(c);
  });
  const order = langOrder();
  const out = [];
  const seen = new Set();
  for (const c of cards) {
    const g = groups.get(find(cards.indexOf(c)));
    if (seen.has(g)) continue;
    seen.add(g);
    g.sort((a, b) => order.indexOf(a.lang) - order.indexOf(b.lang));
    out.push({ rep: g[0], keys: g.map((x) => x.key) });
  }
  return out;
}
