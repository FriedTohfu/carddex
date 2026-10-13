// "My Collection" tab: stats, set progress, all owned cards.
import { h, nav, chips, cardGrid, empty, debounce, icon } from '../ui.js';
import { state, collectionStats, setProgress, allSetsSorted, qty } from '../store.js';
import { setRow, openSet } from './sets.js';
import { openCard } from './card.js';
import { LANGS } from '../api.js';
import * as db from '../db.js';
import { priceOf } from '../sync.js';

let mode = 'sets';      // sets | cards
let lang = 'all';
let showAll = false;
let sort = 'recent';
let query = '';

export function collectionRoot() {
  return {
    title: 'My Collection', large: true,
    watch: ['catalog', 'owned', 'settings'],
    actions: [{ icon: 'gear', label: 'Settings', onClick: () => import('./settings.js').then((m) => m.openSettings()) }],
    render(body) {
      if (!state.sets.size) {
        body.append(empty('Welcome to CardDex!', 'First, download the card list while you have internet. After that, the app works offline.',
          h('button', { class: 'btn primary', onclick: () => import('./settings.js').then((m) => m.openSetup()) }, icon('download', 18), ' Download card data')));
        return;
      }
      const st = collectionStats();
      const value = h('div', { class: 'stat' }, h('b', {}, '—'), h('small', {}, 'Est. value'));
      body.append(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, st.unique.toLocaleString()), h('small', {}, 'Unique cards')),
        h('div', { class: 'stat' }, h('b', {}, st.total.toLocaleString()), h('small', {}, 'Total copies')),
        h('div', { class: 'stat' }, h('b', {}, st.sets), h('small', {}, 'Sets started')),
        value));
      estimateValue().then((v) => { value.querySelector('b').textContent = v || '—'; });

      const langs = [{ value: 'all', label: 'All' }, ...state.settings.langs.map((l) => ({ value: l, label: LANGS[l].short }))];
      const search = h('input', { class: 'input search', type: 'search', placeholder: mode === 'sets' ? 'Find a set…' : 'Find a card…', value: query });
      const list = h('div');
      search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); drawList(); }, 150));

      body.append(
        h('div', { class: 'segmented' },
          h('button', { class: mode === 'sets' ? 'on' : '', onclick: () => { mode = 'sets'; rerender(); } }, 'Sets'),
          h('button', { class: mode === 'cards' ? 'on' : '', onclick: () => { mode = 'cards'; rerender(); } }, 'My cards')),
        h('div', { class: 'toolbar' }, chips(langs, lang, (v) => { lang = v; drawList(); })),
        search,
        list);
      drawList();

      function rerender() { body.innerHTML = ''; collectionRoot().render.call(null, body); }

      function drawList() {
        list.innerHTML = '';
        if (mode === 'sets') {
          let sets = allSetsSorted().filter((s) => lang === 'all' || s.lang === lang);
          if (query) sets = sets.filter((s) => s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query));
          const started = sets.filter((s) => setProgress(s.key).owned > 0);
          const shown = showAll || query ? sets : started;
          if (!started.length && !showAll && !query) {
            list.append(empty('No cards yet', 'Scan a card with the camera button, or open a set and tap cards to add them.'));
          }
          const sorted = [...shown].sort((a, b) => (showAll || query) ? 0 : setProgress(b.key).pct - setProgress(a.key).pct);
          list.append(h('div', { class: 'set-list' }, sorted.slice(0, 400).map((s) => setRow(s, () => openSet(s.key, 'collection')))));
          if (!query) list.append(h('button', { class: 'btn ghost wide', onclick: () => { showAll = !showAll; drawList(); } },
            showAll ? 'Show only sets I’ve started' : `Show all ${sets.length} sets`));
        } else {
          let cards = [...state.owned.keys()].filter((k) => qty(k)).map((k) => state.cards.get(k)).filter(Boolean);
          if (lang !== 'all') cards = cards.filter((c) => c.lang === lang);
          if (query) cards = cards.filter((c) => c.name.toLowerCase().includes(query));
          const by = {
            recent: (a, b) => (state.owned.get(b.key).addedAt || 0) - (state.owned.get(a.key).addedAt || 0),
            name: (a, b) => a.name.localeCompare(b.name),
            set: (a, b) => (state.sets.get(b.setKey)?.releaseDate || '').localeCompare(state.sets.get(a.setKey)?.releaseDate || '') || a.order - b.order,
            qty: (a, b) => qty(b.key) - qty(a.key),
          };
          cards.sort(by[sort]);
          list.append(h('div', { class: 'toolbar' },
            h('span', { class: 'muted small' }, `${cards.length} cards`),
            h('select', { class: 'input mini', onchange: (e) => { sort = e.target.value; drawList(); } },
              [['recent', 'Recently added'], ['set', 'By set'], ['name', 'By name'], ['qty', 'Most copies']].map(([v, l]) => h('option', { value: v, selected: sort === v }, l)))));
          const keys = cards.map((c) => c.key);
          list.append(cardGrid(cards, { dimMissing: false, showSet: true, onClick: (c) => openCard(c.key, keys),
            empty: empty('Nothing here yet', 'Cards you add will show up here.') }));
        }
      }
    },
  };
}

async function estimateValue() {
  let eur = 0, usd = 0, n = 0;
  for (const [k] of state.owned) {
    const q = qty(k); if (!q) continue;
    const d = await db.get('details', k);
    const p = priceOf(d);
    if (!p) continue;
    n++;
    if (p.currency === '€') eur += p.value * q; else usd += p.value * q;
  }
  if (!n) return null;
  return [eur ? `€${Math.round(eur).toLocaleString()}` : '', usd ? `US$${Math.round(usd).toLocaleString()}` : ''].filter(Boolean).join(' + ');
}

export function initCollection() {
  nav.setRoot('collection', collectionRoot());
}
