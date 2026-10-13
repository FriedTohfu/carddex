// Card prices: recent SOLD prices from eBay (all cards) and Mercari Japan
// (Japanese cards), plus the card database's own market price when it has one.
// eBay and Mercari don't offer free public access to sold data, so we read
// their public search results on demand. If a site changes, that source just
// shows "unavailable" — the "Open" link always lets you look yourself.
import * as db from './db.js';
import { state, emit } from './store.js';
import { speciesName } from './dex.js';
import { online } from './api.js';
import { priceOf } from './sync.js';

export const CURRENCIES = {
  AUD: { sym: 'A$', label: 'Australian dollar' },
  USD: { sym: 'US$', label: 'US dollar' },
  EUR: { sym: '€', label: 'Euro' },
  GBP: { sym: '£', label: 'British pound' },
  JPY: { sym: '¥', label: 'Japanese yen' },
  CNY: { sym: 'CN¥', label: 'Chinese yuan' },
  CAD: { sym: 'C$', label: 'Canadian dollar' },
  NZD: { sym: 'NZ$', label: 'New Zealand dollar' },
};

export function currency() { return state.settings.currency || 'AUD'; }

// ---------- exchange rates (free, updated daily) ----------
let rates = null;
export async function getRates() {
  if (rates) return rates;
  const cached = await db.get('meta', 'fxRates');
  if (cached && (Date.now() - cached.at < 24 * 3600e3 || !online())) return (rates = cached.rates);
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const d = await r.json();
    if (d?.rates?.AUD) {
      await db.put('meta', { at: Date.now(), rates: d.rates }, 'fxRates');
      return (rates = d.rates);
    }
  } catch { /* offline */ }
  return (rates = cached?.rates || null);
}

export function convert(amount, from, to, r) {
  if (amount == null || from === to) return amount;
  if (!r?.[from] || !r?.[to]) return null;
  return (amount / r[from]) * r[to];
}

export function fmt(amount, cur = currency()) {
  if (amount == null || !isFinite(amount)) return '—';
  const sym = CURRENCIES[cur]?.sym || cur + ' ';
  const digits = cur === 'JPY' || amount >= 1000 ? 0 : 2;
  return sym + amount.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ---------- web requests from the phone (no browser restrictions) ----------
async function httpGet(url, headers = {}) {
  const H = window.Capacitor?.Plugins?.CapacitorHttp;
  if (H?.get) {
    const r = await H.get({ url, headers, responseType: 'text', connectTimeout: 15000, readTimeout: 20000 });
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
async function httpPost(url, body, headers = {}) {
  const H = window.Capacitor?.Plugins?.CapacitorHttp;
  if (H?.post) {
    const r = await H.post({ url, headers, data: body, responseType: 'json', connectTimeout: 15000, readTimeout: 20000 });
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- what to search for ----------
const SUFFIX = /\b(ex|EX|GX|V|VMAX|VSTAR|V-UNION|LV\.X|BREAK|Prism|δ|☆|Radiant|Shining|TAG TEAM)\b/g;

export function cardNumber(card) {
  const set = state.sets.get(card.setKey);
  if (card.number) return card.number;               // e.g. Chinese "094/208"
  const n = String(card.localId || '');
  return set?.official && /^\d+$/.test(n) ? `${n}/${String(set.official).padStart(n.length, '0')}` : n;
}

function englishName(card) {
  if (card.lang === 'en') return card.name;
  const ids = state.cardDex.get(card.key) || [];
  if (!ids.length) return '';
  const names = ids.map((id) => speciesName(state.speciesById.get(id), 'en')).filter(Boolean);
  const extra = (card.name.match(SUFFIX) || []).join(' ');
  return [names.join(' & '), extra].filter(Boolean).join(' ');
}

export function searchQuery(card, site = 'ebay') {
  const num = cardNumber(card);
  if (site === 'mercari') return `${card.name} ${num}`.trim();
  const lang = card.lang === 'ja' ? 'Japanese' : card.lang.startsWith('zh') ? 'Chinese' : '';
  return [englishName(card) || card.name, num, lang].filter(Boolean).join(' ');
}

const JUNK = /\b(psa|bgs|cgc|ace|graded|slab|lot|bundle|proxy|custom|orica|digital|code card|online code|jumbo|oversized|playmat|sleeve|binder|empty|art card|metal)\b|まとめ|セット|オリパ|鑑定|PSA|プロキシ|コード/i;

function numberMatches(title, card) {
  const n = String(card.localId || '').replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(n)) return true;
  return new RegExp(`(^|[^0-9])0*${n}\\s*/`).test(title) || new RegExp(`#\\s*0*${n}([^0-9]|$)`).test(title);
}

function stats(prices) {
  const v = prices.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  const kept = v.length >= 5 ? v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr) : v;
  const mid = kept[Math.floor(kept.length / 2)];
  const median = kept.length % 2 ? mid : (kept[kept.length / 2 - 1] + kept[kept.length / 2]) / 2;
  return { median, low: kept[0], high: kept[kept.length - 1], count: kept.length };
}

// ---------- eBay sold listings ----------
const EBAY_SITES = {
  AUD: ['www.ebay.com.au', 'AUD'], GBP: ['www.ebay.co.uk', 'GBP'], EUR: ['www.ebay.de', 'EUR'],
  CAD: ['www.ebay.ca', 'CAD'], USD: ['www.ebay.com', 'USD'],
};
export function ebayUrl(card) {
  const [host] = EBAY_SITES[currency()] || EBAY_SITES.USD;
  return `https://${host}/sch/i.html?_nkw=${encodeURIComponent(searchQuery(card))}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
}

function parsePrice(text) {
  if (!text || /\bto\b|bis|à/i.test(text)) return null; // price ranges (multi-variation listings)
  const m = text.replace(/\s/g, '').match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[1];
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else s = s.replace(/,/g, '');
  const v = parseFloat(s);
  return isFinite(v) ? v : null;
}

async function ebaySold(card) {
  const [host, cur] = EBAY_SITES[currency()] || EBAY_SITES.USD;
  const url = ebayUrl(card);
  const html = await httpGet(url, { 'User-Agent': navigator.userAgent, 'Accept-Language': 'en' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = doc.querySelectorAll('li.s-item, li.s-card, ul.srp-results > li');
  const prices = [];
  for (const el of items) {
    const title = (el.querySelector('.s-item__title, .s-card__title, [role="heading"]')?.textContent || '').trim();
    if (!title || /shop on ebay/i.test(title)) continue;
    if (JUNK.test(title) || !numberMatches(title, card)) continue;
    const p = parsePrice(el.querySelector('.s-item__price, .s-card__price, .s-card__attribute-row span')?.textContent);
    if (p != null) prices.push(p);
    if (prices.length >= 30) break;
  }
  return { source: 'eBay sold', site: host, currency: cur, url, ...(stats(prices) || { count: 0 }) };
}

// ---------- Mercari Japan sold listings (Japanese cards) ----------
export function mercariUrl(card) {
  return `https://jp.mercari.com/search?keyword=${encodeURIComponent(searchQuery(card, 'mercari'))}&status=sold_out&order=desc&sort=created_time`;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));
let mercariKey = null;
async function dpop(url, method) {
  // Mercari's web app signs each search with a throwaway key ("DPoP"); we do the same.
  if (!mercariKey) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    mercariKey = { pair, jwk: { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y }, uuid: crypto.randomUUID() };
  }
  const head = b64urlStr(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: mercariKey.jwk }));
  const body = b64urlStr(JSON.stringify({ iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(), htu: url, htm: method, uuid: mercariKey.uuid }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, mercariKey.pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function mercariSold(card) {
  const api = 'https://api.mercari.jp/v2/entities:search';
  const keyword = searchQuery(card, 'mercari');
  const body = {
    userId: '', pageSize: 60, pageToken: '', searchSessionId: crypto.randomUUID().replace(/-/g, ''),
    indexRouting: 'INDEX_ROUTING_UNSPECIFIED', thumbnailTypes: [],
    searchCondition: {
      keyword, excludeKeyword: '', sort: 'SORT_CREATED_TIME', order: 'ORDER_DESC', status: ['STATUS_SOLD_OUT'],
      sizeId: [], categoryId: [], brandId: [], sellerId: [], priceMin: 0, priceMax: 0, itemConditionId: [],
      shippingPayerId: [], shippingFromArea: [], shippingMethod: [], colorId: [], hasCoupon: false, attributes: [], itemTypes: [], skuIds: [],
    },
    defaultDatasets: ['DATASET_TYPE_MERCARI', 'DATASET_TYPE_BEYOND'], serviceFrom: 'suruga',
    withItemBrand: true, withItemSize: false, withItemPromotions: true, withItemSizes: true, withShopname: false,
  };
  const data = await httpPost(api, body, {
    DPoP: await dpop(api, 'POST'), 'X-Platform': 'web', 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json',
  });
  const prices = [];
  for (const it of data?.items || []) {
    const title = it.name || '';
    if (JUNK.test(title) || !numberMatches(title, card)) continue;
    const p = +it.price;
    if (p > 0) prices.push(p);
    if (prices.length >= 30) break;
  }
  return { source: 'Mercari sold', site: 'jp.mercari.com', currency: 'JPY', url: mercariUrl(card), ...(stats(prices) || { count: 0 }) };
}

// ---------- putting it together ----------
const KEEP_MS = 3 * 24 * 3600e3;

export async function cachedPrices(key) {
  return db.get('details', `price:${key}`);
}

/** Looks up sold prices for a card. Returns {at, results: [...]}. */
export async function checkPrices(card, { force = false } = {}) {
  const cached = await cachedPrices(card.key);
  if (!force && cached && Date.now() - cached.at < KEEP_MS) return cached;
  if (!online()) return cached || null;
  const jobs = [ebaySold(card)];
  if (card.lang === 'ja') jobs.push(mercariSold(card));
  const settled = await Promise.allSettled(jobs);
  const results = settled.map((s, i) => s.status === 'fulfilled' ? s.value : {
    source: i === 0 ? 'eBay sold' : 'Mercari sold', unavailable: true,
    url: i === 0 ? ebayUrl(card) : mercariUrl(card), count: 0,
  });
  const out = { at: Date.now(), results };
  await db.put('details', out, `price:${card.key}`);
  emit('prices');
  return out;
}

/** Best single value for a card in the chosen currency (for collection totals). */
export async function valueOf(key, r) {
  const cur = currency();
  const p = await cachedPrices(key);
  const sold = p?.results?.find((x) => x.count > 0 && x.median != null);
  if (sold) return convert(sold.median, sold.currency, cur, r);
  const d = await db.get('details', key);
  const m = priceOf(d);
  if (m) return convert(m.value, m.currency === '€' ? 'EUR' : 'USD', cur, r);
  return null;
}
