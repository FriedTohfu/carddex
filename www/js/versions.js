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

// Without pictures we can still match on facts that don't change between
// languages: illustrator and HP (and the releases being close together).
const norm = (x) => String(x || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]/g, '');
function sameFacts(a, b, da, db, namesAgree) {
  if (!da || !db) return false;
  const ia = norm(da.illustrator), ib = norm(db.illustrator);
  if (!ia || ia !== ib) return false;
  if (da.hp && db.hp && +da.hp !== +db.hp) return false;
  // Without English names on both sides, HP has to be there to tell e.g. V from VMAX
  if (!namesAgree && !(da.hp && db.hp)) return false;
  const ra = state.sets.get(a.setKey)?.releaseDate, rb = state.sets.get(b.setKey)?.releaseDate;
  // Old Japanese sets often came out up to ~3 years before their English versions
  if (ra && rb && Math.abs(new Date(ra) - new Date(rb)) > 4 * 365 * 864e5) return false;
  return true;
}

/** The card's English name, if we know it (English cards, and Japanese cards that carry one). */
const englishName = (c) => norm(c.lang === 'en' ? c.name : c.nameEn);

/**
 * Groups cards that are the same card in different languages.
 * details: optional Map(cardKey -> {hp, illustrator}) used when a card has no picture.
 * Each group holds at most one card per language; the closest matches are linked first,
 * and cards whose English names differ (e.g. "Metagross V" / "Metagross VMAX") are never linked.
 * Returns [{ rep: card, keys: [cardKey…] }] keeping the input order of representatives.
 */
export async function groupVersions(cards, details = new Map()) {
  const fps = await loadFingerprints();
  const n = cards.length;
  const parent = cards.map((_, i) => i);
  const langs = cards.map((c) => new Set([c.lang]));
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const fp = cards.map((c) => fps.get(c.key) || null);
  const en = cards.map(englishName);
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (cards[i].lang === cards[j].lang) continue; // only link across languages
    const named = !!(en[i] && en[j]);
    if (named && en[i] !== en[j]) continue;
    if (fp[i] && fp[j]) {
      const d = artDistance(fp[i], fp[j]);
      if (d <= SAME_ART) pairs.push([d, i, j]);
    } else if (sameFacts(cards[i], cards[j], details.get(cards[i].key), details.get(cards[j].key), named)) {
      pairs.push([SAME_ART - 0.5, i, j]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of pairs) {
    const a = find(i), b = find(j);
    if (a === b) continue;
    if ([...langs[b]].some((l) => langs[a].has(l))) continue; // one card per language in a group
    parent[b] = a;
    for (const l of langs[b]) langs[a].add(l);
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
    // A version without a picture borrows one from its twin (same artwork)
    const donor = g.find((x) => x.image);
    for (const x of g) if (!x.image && donor) x.altKey = donor.key;
    out.push({ rep: g[0], keys: g.map((x) => x.key) });
  }
  return out;
}
