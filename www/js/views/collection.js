// "My Collection" tab: stats, set progress, all owned cards.
import { h, nav, chips, cardGrid, empty, debounce, icon } from '../ui.js';
import { state, collectionStats, setProgress, allSetsSorted, qty } from '../store.js';
import { setRow, openSet } from './sets.js';
import { openCard } from './card.js';
import { LANGS } from '../api.js';
import { speciesName } from '../dex.js';
import * as db from '../db.js';
import { priceOf } from '../sync.js';

let mode = 'sets';      // sets | cards
let lang = 'all';
let showAll = false;
let sort = 'recent';
let query = '';
let serie = 'all';      // series filter (e.g. XY, Black & White)
let group = 'serie';    // My cards grouping: none | serie | set | lang | pokemon
const collapsed = new Set();

const serieOf = (setKey) => state.sets.get(setKey)?.serie || 'Other';

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
      const seriesRow = h('div', { class: 'toolbar' });
      // Series chips: only series you have cards from (or all, when showing every set)
      function drawSeries() {
        const keys = mode === 'sets' && showAll
          ? allSetsSorted().filter((st) => lang === 'all' || st.lang === lang).map((st) => st.key)
          : [...new Set([...state.owned.keys()].filter((k) => qty(k)).map((k) => state.cards.get(k)?.setKey).filter(Boolean))]
            .filter((k) => lang === 'all' || state.sets.get(k)?.lang === lang);
        const newest = new Map();
        for (const k of keys) {
          const sr = serieOf(k), d = state.sets.get(k)?.releaseDate || '';
          if (!newest.has(sr) || d > newest.get(sr)) newest.set(sr, d);
        }
        const list2 = [...newest].sort((a, b) => b[1].localeCompare(a[1])).map(([sr]) => sr);
        if (serie !== 'all' && !list2.includes(serie)) serie = 'all';
        seriesRow.innerHTML = '';
        seriesRow.hidden = list2.length < 2;
        seriesRow.append(chips([{ value: 'all', label: 'All series' }, ...list2.map((sr) => ({ value: sr, label: sr }))], serie, (v) => { serie = v; drawList(); }));
      }
      search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); drawList(); }, 150));

      body.append(
        h('div', { class: 'segmented' },
          h('button', { class: mode === 'sets' ? 'on' : '', onclick: () => { mode = 'sets'; rerender(); } }, 'Sets'),
          h('button', { class: mode === 'cards' ? 'on' : '', onclick: () => { mode = 'cards'; rerender(); } }, 'My cards')),
        h('div', { class: 'toolbar' }, chips(langs, lang, (v) => { lang = v; serie = 'all'; drawSeries(); drawList(); })),
        seriesRow,
        search,
        list);
      drawSeries();
      drawList();

      function rerender() { body.innerHTML = ''; collectionRoot().render.call(null, body); }

      function drawList() {
        list.innerHTML = '';
        if (mode === 'sets') {
          let sets = allSetsSorted().filter((s) => (lang === 'all' || s.lang === lang) && (serie === 'all' || serieOf(s.key) === serie));
          if (query) sets = sets.filter((s) => s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query));
          const started = sets.filter((s) => setProgress(s.key).owned > 0);
          const shown = showAll || query ? sets : started;
          if (!started.length && !showAll && !query) {
            list.append(empty('No cards yet', 'Scan a card with the camera button, or open a set and tap cards to add them.'));
          }
          const sorted = [...shown].sort((a, b) => (showAll || query) ? 0 : setProgress(b.key).pct - setProgress(a.key).pct);
          list.append(h('div', { class: 'set-list' }, sorted.slice(0, 400).map((s) => setRow(s, () => openSet(s.key, 'collection')))));
          if (!query) list.append(h('button', { class: 'btn ghost wide', onclick: () => { showAll = !showAll; drawSeries(); drawList(); } },
            showAll ? 'Show only sets I’ve started' : `Show all ${sets.length} sets`));
        } else {
          let cards = [...state.owned.keys()].filter((k) => qty(k)).map((k) => state.cards.get(k)).filter(Boolean);
          if (lang !== 'all') cards = cards.filter((c) => c.lang === lang);
          if (serie !== 'all') cards = cards.filter((c) => serieOf(c.setKey) === serie);
          if (query) cards = cards.filter((c) => c.name.toLowerCase().includes(query) || (state.sets.get(c.setKey)?.name || '').toLowerCase().includes(query));
          const rd = (c) => state.sets.get(c.setKey)?.releaseDate || '';
          const by = {
            recent: (a, b) => (state.owned.get(b.key).addedAt || 0) - (state.owned.get(a.key).addedAt || 0),
            name: (a, b) => a.name.localeCompare(b.name),
            set: (a, b) => rd(b).localeCompare(rd(a)) || a.order - b.order,
            number: (a, b) => (parseInt(a.localId, 10) || 0) - (parseInt(b.localId, 10) || 0),
            qty: (a, b) => qty(b.key) - qty(a.key),
          };
          cards.sort(by[sort]);
          list.append(h('div', { class: 'toolbar' },
            h('span', { class: 'muted small' }, `${cards.length} cards`),
            h('select', { class: 'input mini', 'aria-label': 'Group by', onchange: (e) => { group = e.target.value; drawList(); } },
              [['none', 'No groups'], ['serie', 'Group: series'], ['set', 'Group: set'], ['lang', 'Group: language'], ['pokemon', 'Group: Pokémon']].map(([v, l]) => h('option', { value: v, selected: group === v }, l))),
            h('select', { class: 'input mini', 'aria-label': 'Sort', style: { marginLeft: '0' }, onchange: (e) => { sort = e.target.value; drawList(); } },
              [['recent', 'Recently added'], ['set', 'By set'], ['number', 'By number'], ['name', 'By name'], ['qty', 'Most copies']].map(([v, l]) => h('option', { value: v, selected: sort === v }, l)))));
          const keys = cards.map((c) => c.key);
          if (!cards.length) { list.append(empty('Nothing here yet', 'Cards you add will show up here.')); return; }
          if (group === 'none') {
            list.append(cardGrid(cards, { dimMissing: false, showSet: true, onClick: (c) => openCard(c.key, keys) }));
            return;
          }
          // Build groups
          const groups = new Map();
          const add = (gk, label, order, c) => {
            if (!groups.has(gk)) groups.set(gk, { label, order, cards: [] });
            groups.get(gk).cards.push(c);
          };
          for (const c of cards) {
            const st = state.sets.get(c.setKey);
            if (group === 'serie') add(serieOf(c.setKey), serieOf(c.setKey), st?.releaseDate || '', c);
            else if (group === 'set') add(c.setKey, `${st?.name || 'Unknown set'}`, st?.releaseDate || '', c);
            else if (group === 'lang') add(c.lang, LANGS[c.lang]?.label || c.lang, String(Object.keys(LANGS).indexOf(c.lang)), c);
            else if (group === 'pokemon') {
              const ids = state.cardDex.get(c.key) || [];
              if (!ids.length) add('other', 'Trainers, energy & others', 'zzzz', c);
              for (const id of ids) {
                const sp = state.speciesById.get(id);
                add(`p${id}`, `#${id} ${sp ? speciesName(sp, 'en') : ''}`, String(id).padStart(5, '0'), c);
              }
            }
          }
          let arr = [...groups.entries()];
          for (const [, g] of arr) g.order = group === 'serie' || group === 'set' ? g.cards.reduce((m, c) => (rd(c) > m ? rd(c) : m), '') : g.order;
          arr.sort((a, b) => (group === 'serie' || group === 'set') ? b[1].order.localeCompare(a[1].order) : a[1].order.localeCompare(b[1].order));
          list.append(h('div', { class: 'group-tools' },
            h('button', { class: 'link small', onclick: () => { arr.forEach(([k]) => collapsed.add(group + k)); drawList(); } }, 'Collapse all'),
            h('button', { class: 'link small', onclick: () => { arr.forEach(([k]) => collapsed.delete(group + k)); drawList(); } }, 'Expand all')));
          for (const [gk, g] of arr) {
            const id = group + gk;
            const isOpen = !collapsed.has(id);
            const gkeys = g.cards.map((c) => c.key);
            const sec = h('section', { class: 'group' + (isOpen ? ' open' : '') },
              h('button', { class: 'group-head', onclick: () => { isOpen ? collapsed.add(id) : collapsed.delete(id); drawList(); } },
                h('span', { class: 'chev' }, isOpen ? '▾' : '▸'),
                h('b', {}, g.label),
                h('span', { class: 'muted small' }, `${g.cards.length}`)),
              isOpen ? cardGrid(g.cards, { dimMissing: false, showSet: group !== 'set', onClick: (c) => openCard(c.key, gkeys) }) : null);
            list.append(sec);
          }
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
