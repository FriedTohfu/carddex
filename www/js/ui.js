// Shared UI helpers: element builder, navigation, sheets, dialogs, images, card grids.
import * as db from './db.js';
import { state, qty, onChange } from './store.js';
import { cachedOrFetch } from './imgcache.js';
import { cardImg, archivedImg, assetUrl, online, LANGS, SPRITE } from './api.js';

// Let .append() skip null/false so optional pieces can be written inline
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  const orig = proto.append;
  proto.append = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false)); };
}

// ---------- Element builder ----------
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Icons (inline SVG) ----------
const P = {
  collection: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  dex: '<circle cx="12" cy="12" r="9"/><path d="M3 12h6m6 0h6"/><circle cx="12" cy="12" r="3"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  binder: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M5 7H3m2 5H3m2 5H3M10 3v18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  flash: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sort: '<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 13v7h14v-7"/>',
  wifi_off: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2-1.5M2 9a15 15 0 0 1 4.5-2.8M22 9a15 15 0 0 0-10-4"/><circle cx="12" cy="20" r="1"/>',
};
export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}
export function iconBtn(name, label, onclick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, 'aria-label': label, title: label, onclick }, icon(name));
}

// ---------- Back button handling ----------
const backHandlers = [];
export function pushBack(fn) { backHandlers.push(fn); return () => { const i = backHandlers.lastIndexOf(fn); if (i >= 0) backHandlers.splice(i, 1); }; }
export function handleBack() {
  const fn = backHandlers.pop();
  if (fn) { fn(); return true; }
  return nav.back();
}

// ---------- Navigation (each tab keeps its own stack of pages) ----------
export const nav = {
  tabs: {}, current: null, onTabChange: null,
  init(tabNames, root) {
    for (const t of tabNames) {
      const el = h('section', { class: 'tab-screen', 'data-tab': t, hidden: true });
      root.append(el);
      this.tabs[t] = { el, stack: [] };
    }
  },
  setRoot(tab, page) { this.tabs[tab].stack = []; this.tabs[tab].el.innerHTML = ''; this.push(tab, page, true); },
  push(tab, page, instant = false) {
    const t = this.tabs[tab];
    page.tab = tab;
    page.el = h('div', { class: 'page' + (instant ? '' : ' enter') });
    buildPage(page, t.stack.length > 0);
    t.stack.forEach((p) => p.el.classList.add('covered'));
    t.stack.push(page);
    t.el.append(page.el);
    if (!instant) requestAnimationFrame(() => requestAnimationFrame(() => page.el.classList.remove('enter')));
    if (this.current !== tab) this.switchTab(tab);
    return page;
  },
  pop(tab = this.current) {
    const t = this.tabs[tab];
    if (t.stack.length <= 1) return false;
    const page = t.stack.pop();
    page.destroy?.();
    page.el.classList.add('enter');
    setTimeout(() => page.el.remove(), 250);
    const top = t.stack[t.stack.length - 1];
    top.el.classList.remove('covered');
    if (top.dirty) refreshPage(top);
    return true;
  },
  back() {
    if (this.pop()) return true;
    if (this.current !== 'collection') { this.switchTab('collection'); return true; }
    return false;
  },
  switchTab(tab) {
    if (this.current === tab) { // tapping the active tab returns to its first page
      while (this.tabs[tab].stack.length > 1) this.pop(tab);
      this.top(tab)?.el.querySelector('.page-body')?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    this.current = tab;
    for (const [name, t] of Object.entries(this.tabs)) t.el.hidden = name !== tab;
    const top = this.top(tab);
    if (top?.dirty) refreshPage(top);
    this.onTabChange?.(tab);
  },
  top(tab = this.current) { const s = this.tabs[tab]?.stack; return s?.[s.length - 1]; },
  allPages() { return Object.values(this.tabs).flatMap((t) => t.stack); },
};

function buildPage(page, canBack) {
  const head = h('header', { class: 'page-head' + (page.large ? ' large' : '') },
    canBack ? iconBtn('back', 'Back', () => nav.pop(page.tab), 'back') : null,
    h('div', { class: 'titles' },
      h('h1', {}, page.title || ''),
      page.subtitle ? h('div', { class: 'subtitle' }, page.subtitle) : null),
    h('div', { class: 'actions' }, ...(page.actions || []).map((a) => iconBtn(a.icon, a.label, a.onClick))),
  );
  const body = h('div', { class: 'page-body' });
  page.head = head; page.body = body;
  page.el.append(head, body);
  page.render(body, page);
}

export function setTitle(page, title, subtitle) {
  page.title = title;
  page.head.querySelector('h1').textContent = title;
  let sub = page.head.querySelector('.subtitle');
  if (subtitle != null) {
    if (!sub) { sub = h('div', { class: 'subtitle' }); page.head.querySelector('.titles').append(sub); }
    sub.textContent = subtitle;
  }
}

export function refreshPage(page) {
  const st = page.body.scrollTop;
  page.dirty = false;
  page.destroy?.();
  page.body.innerHTML = '';
  page.render(page.body, page);
  page.body.scrollTop = st;
}

// Re-render pages that care about a change. Visible ones update now, hidden ones later.
onChange((what) => {
  if (what === 'owned') updateTiles();
  if (what === 'job') return;
  for (const p of nav.allPages()) {
    if (!p.watch?.includes(what)) continue;
    const visible = nav.top(p.tab) === p && nav.current === p.tab;
    if (visible) refreshPage(p); else p.dirty = true;
  }
});

// ---------- Toasts ----------
export function toast(msg, ms = 2400) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' }, msg);
  box.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Bottom sheets ----------
export function sheet({ title, content, full = false, onClose }) {
  const root = document.getElementById('sheets');
  const body = h('div', { class: 'sheet-body' });
  const box = h('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-label': title || 'Panel' },
    h('div', { class: 'sheet-grip' }),
    h('div', { class: 'sheet-head' }, h('h2', {}, title || ''), iconBtn('close', 'Close', () => close())),
    body);
  const wrap = h('div', { class: 'sheet-wrap' }, box);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  root.append(wrap);
  if (typeof content === 'function') content(body, { close }); else if (content) body.append(content);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const removeBack = pushBack(() => close(true));
  function close(fromBack) {
    if (closed) return;
    closed = true;
    if (!fromBack) removeBack();
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 250);
    onClose?.();
  }
  return { close, body, box, setTitle: (t) => (box.querySelector('h2').textContent = t) };
}

// ---------- Dialogs ----------
export function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const s = sheet({
      title: message,
      onClose: () => resolve(false),
      content: (b, { close }) => b.append(h('div', { class: 'row-btns' },
        h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { resolve(true); close(); } }, ok))),
    });
    return s;
  });
}

export function promptDialog(title, value = '', { placeholder = '', ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    sheet({
      title,
      onClose: () => resolve(result),
      content: (b, { close }) => {
        const input = h('input', { class: 'input', value, placeholder, maxlength: 60 });
        const submit = () => { const v = input.value.trim(); if (!v) return input.focus(); result = v; close(); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        b.append(input, h('div', { class: 'row-btns' },
          h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: submit }, ok)));
        setTimeout(() => { input.focus(); input.select(); }, 250);
      },
    });
  });
}

/** Pick one option from a list. options: [{value, label, sub, icon}] */
export function chooseDialog(title, options) {
  return new Promise((resolve) => {
    let result = null;
    sheet({
      title, onClose: () => resolve(result),
      content: (b, { close }) => {
        b.append(h('div', { class: 'choice-list' }, options.map((o) =>
          h('button', { class: 'choice' + (o.selected ? ' selected' : ''), onclick: () => { result = o.value; close(); } },
            o.icon ? h('span', { class: 'choice-icon' }, o.icon) : null,
            h('span', { class: 'choice-text' }, h('b', {}, o.label), o.sub ? h('small', {}, o.sub) : null),
            o.selected ? icon('check', 18) : null))));
      },
    });
  });
}

// ---------- Images ----------
const urls = new Map();
async function localURL(store, key) {
  const ck = store + '|' + key;
  if (urls.has(ck)) return urls.get(ck);
  const blob = await db.get(store, key);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(ck, u);
  return u;
}
export function forgetImage(key) {
  const ck = 'images|' + key;
  const u = urls.get(ck);
  if (u) { URL.revokeObjectURL(u); urls.delete(ck); }
}

export async function cardSrc(card, quality = 'low') {
  if (!card) return null;
  // No picture of its own: use its twin in another language (same artwork)
  if (!card.image && card.altKey && state.cards.get(card.altKey)?.image) return cardSrc(state.cards.get(card.altKey), quality);
  if (quality === 'high' && online() && card.image) return cardImg(card, 'high');
  if (state.imageKeys.has(card.key)) { const u = await localURL('images', card.key); if (u) return u; }
  if (!card.image) return null;
  // Bulbagarden pictures load directly (that site doesn't allow the app to save them)
  if (/bulbagarden/.test(card.image)) return online() ? cardImg(card, 'low') : null;
  return cachedOrFetch(card.key, cardImg(card, 'low'));
}
export async function spriteSrc(id) {
  return (await localURL('sprites', id)) || (online() ? SPRITE(id) : null);
}
export async function logoSrc(url) {
  if (!url) return null;
  const full = /^https:\/\/images\.weserv\.nl|\.(png|webp|jpe?g)$/i.test(url) ? url : assetUrl(url);
  const local = await localURL('logos', full);
  if (local) return local;
  if (!online()) return null;
  // Save it for offline next time (don't wait)
  import('./api.js').then(({ fetchBlob }) => fetchBlob(full)).then((b) => b && db.put('logos', b, full)).catch(() => {});
  return full;
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    const img = e.target;
    const load = img._load;
    if (load) load().then((src) => {
      if (src) { img.src = src; } else { img.style.display = 'none'; img.closest('.art')?.classList.add('noimg'); }
    });
  }
}, { rootMargin: '1200px 0px' });

export function lazyImg(loader, alt = '', cls = '') {
  const img = h('img', { alt, class: cls, decoding: 'async', draggable: false });
  img._load = loader;
  img.addEventListener('error', () => {
    // A big image failed (e.g. offline) — try the saved small one once
    if (img._fallback && !img._triedFallback) { img._triedFallback = true; img._fallback().then((u) => { if (u && u !== img.src) img.src = u; else img.style.display = 'none'; }); return; }
    img.style.display = 'none';
    img.closest('.art')?.classList.add('noimg');
  });
  img.addEventListener('load', () => img.closest('.art')?.classList.add('loaded'));
  io.observe(img);
  return img;
}

export function cardArt(card, quality = 'low') {
  // Big view: show the small picture straight away, then swap in the sharp one when it arrives
  const img = lazyImg(() => cardSrc(card, 'low'), card?.name || '');
  if (card?.src === 'chs') img._fallback = async () => card.image; // if the resizing service is down
  if (/bulbagarden/.test(card?.image || '')) img._fallback = async () => archivedImg(card.image);
  const shown = (!card?.image && card?.altKey && state.cards.get(card.altKey)) || card;
  if (quality === 'high' && shown?.image && online()) {
    const hi = new Image();
    hi.onload = () => { img.src = hi.src; img.style.display = ''; img.closest('.art')?.classList.add('loaded'); img.closest('.art')?.classList.remove('noimg'); };
    hi.src = cardImg(shown, 'high');
  }
  return h('div', { class: 'art' },
    img,
    h('div', { class: 'art-fallback' }, h('span', {}, card?.name || '?'), h('small', {}, card ? `#${card.localId}` : '')));
}

// ---------- Card tiles & grids ----------
export function langBadge(lang) {
  return h('span', { class: `lang lang-${lang}` }, LANGS[lang]?.short || lang);
}

export function cardTile(card, { onClick, dimMissing = true, showLang = true, showSet = false, versionsOf } = {}) {
  // versionsOf(card) → keys of the same card in other languages (shown as one tile)
  const keys = versionsOf?.(card) || [card.key];
  const q = keys.reduce((n, k) => n + qty(k), 0);
  const langs = [...new Set(keys.map((k) => state.cards.get(k)?.lang).filter(Boolean))];
  const tile = h('button', { class: 'tile' + (dimMissing && !q ? ' missing' : ''), 'data-key': card.key, 'data-keys': keys.length > 1 ? keys.join('|') : null, onclick: () => onClick?.(card) },
    cardArt(card),
    h('span', { class: 'qty', hidden: !q }, q > 1 ? `×${q}` : '✓'),
    h('span', { class: 'tile-meta' },
      h('span', { class: 'num' }, showSet ? (state.sets.get(card.setKey)?.name || '') : `#${card.localId}`),
      showLang ? h('span', { class: 'langs' }, langs.map((l) => langBadge(l))) : null));
  tile._dim = dimMissing;
  return tile;
}

export function updateTiles(root = document) {
  for (const t of root.querySelectorAll('.tile[data-key]')) {
    const q = (t.dataset.keys ? t.dataset.keys.split('|') : [t.dataset.key]).reduce((n, k) => n + qty(k), 0);
    const badge = t.querySelector('.qty');
    if (badge) { badge.hidden = !q; badge.textContent = q > 1 ? `×${q}` : '✓'; }
    t.classList.toggle('missing', t._dim && !q);
  }
}

/** Renders cards in chunks as you scroll, so huge lists stay fast. */
export function cardGrid(cards, opts = {}) {
  const grid = h('div', { class: 'grid' });
  const CHUNK = 60;
  let i = 0;
  const sentinel = h('div', { class: 'grid-sentinel' });
  const more = () => {
    const frag = document.createDocumentFragment();
    for (const end = Math.min(cards.length, i + CHUNK); i < end; i++) frag.append(cardTile(cards[i], opts));
    grid.append(frag);
    if (i >= cards.length) { obs.disconnect(); sentinel.remove(); }
  };
  const obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: '800px 0px' });
  const wrap = h('div', {}, grid, sentinel);
  more();
  if (i < cards.length) obs.observe(sentinel);
  if (!cards.length && opts.empty) wrap.append(opts.empty);
  return wrap;
}

// ---------- Misc ----------
export function progressBar(pct, cls = '') {
  return h('div', { class: 'progress ' + cls + (pct >= 1 ? ' complete' : '') }, h('div', { style: { width: `${Math.round(pct * 1000) / 10}%` } }));
}

export function chips(options, selected, onPick, { multi = false } = {}) {
  const row = h('div', { class: 'chips' });
  const draw = () => {
    row.innerHTML = '';
    for (const o of options) {
      const on = multi ? selected.includes(o.value) : selected === o.value;
      row.append(h('button', { class: 'chip' + (on ? ' on' : ''), onclick: () => {
        if (multi) selected = on ? selected.filter((v) => v !== o.value) : [...selected, o.value];
        else selected = o.value;
        draw(); onPick(selected);
      } }, o.label));
    }
  };
  draw();
  return row;
}

export function empty(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, h('div', { class: 'ball' })), h('h3', {}, title), text ? h('p', {}, text) : null, ...actions);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function setLabel(set) {
  return set ? set.name : 'Unknown set';
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

/** Shows a long list in chunks, adding more as you scroll near the end (no cut-off). */
export function progressiveList(container, items, render, step = 150) {
  let shown = 0;
  const sentinel = h('div', { class: 'list-sentinel', 'aria-hidden': 'true' });
  const more = () => {
    const next = items.slice(shown, shown + step);
    shown += next.length;
    sentinel.before(...next.map(render));
    if (shown >= items.length) { obs.disconnect(); sentinel.remove(); }
  };
  const obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: '800px 0px' });
  container.append(sentinel);
  more();
  if (shown < items.length) obs.observe(sentinel);
  return container;
}
