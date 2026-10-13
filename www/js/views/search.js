// Search tab: find any card by name or number, filter by language and set.
import { h, nav, chips, cardGrid, empty, debounce, chooseDialog, sheet, icon, langBadge } from '../ui.js';
import { state, allSetsSorted, qty } from '../store.js';
import { LANGS } from '../api.js';
import { normalizeName } from '../dex.js';
import { openCard } from './card.js';
import { setRow, openSet } from './sets.js';

/** Core search used by the Search tab and the card picker. */
export function searchCards({ q = '', lang = 'all', setKey = null, owned = 'all', sort = 'newest' }) {
  let cards;
  if (setKey) cards = [...(state.cardsBySet.get(setKey) || [])];
  else {
    cards = [];
    for (const c of state.cards.values()) if (state.settings.langs.includes(c.lang)) cards.push(c);
  }
  if (lang !== 'all') cards = cards.filter((c) => c.lang === lang);
  q = q.trim();
  if (q) {
    const num = q.match(/^#?\s*([a-z]*\d+[a-z]*)\s*(?:\/\s*(\d+))?$/i);
    if (num) {
      const id = num[1].toLowerCase().replace(/^0+(?=\d)/, '');
      const of = num[2] ? +num[2] : null;
      cards = cards.filter((c) => String(c.localId).toLowerCase().replace(/^0+(?=\d)/, '') === id &&
        (!of || state.sets.get(c.setKey)?.official === of));
    } else {
      const nq = normalizeName(q);
      const words = nq.split(' ');
      cards = cards.filter((c) => { const n = normalizeName(c.name); return words.every((w) => n.includes(w)); });
    }
  }
  if (owned === 'owned') cards = cards.filter((c) => qty(c.key));
  if (owned === 'missing') cards = cards.filter((c) => !qty(c.key));
  const rd = (c) => state.sets.get(c.setKey)?.releaseDate || '';
  const sorts = {
    newest: (a, b) => rd(b).localeCompare(rd(a)) || a.order - b.order,
    oldest: (a, b) => rd(a).localeCompare(rd(b)) || a.order - b.order,
    name: (a, b) => a.name.localeCompare(b.name) || rd(b).localeCompare(rd(a)),
    number: (a, b) => (parseInt(a.localId, 10) || 0) - (parseInt(b.localId, 10) || 0),
  };
  if (!setKey || sort !== 'newest') cards.sort(sorts[sort] || sorts.newest);
  return cards;
}

const S = { q: '', lang: 'all', setKey: null, owned: 'all', sort: 'newest' };

export function searchRoot() {
  return {
    title: 'Search', large: true,
    actions: [{ icon: 'plus', label: 'Add a missing card yourself', onClick: () => import('./addcard.js').then((m) => m.openAddCard({ name: S.q.trim(), lang: S.lang !== 'all' ? S.lang : undefined, setKey: S.setKey })) }],
    watch: ['catalog', 'settings'],
    render(body) {
      if (!state.sets.size) {
        body.append(empty('No card data yet', 'Download the card list first.',
          h('button', { class: 'btn primary', onclick: () => import('./settings.js').then((m) => m.openSetup()) }, 'Download card data')));
        return;
      }
      const results = h('div');
      const input = h('input', { class: 'input search', type: 'search', placeholder: 'Name or number, e.g. Pikachu or 25/102', value: S.q, enterkeyhint: 'search' });
      input.addEventListener('input', debounce(() => { S.q = input.value; draw(); }, 220));
      const setBtn = h('button', { class: 'chip' + (S.setKey ? ' on' : ''), onclick: pickSet });
      const langOpts = [{ value: 'all', label: 'All languages' }, ...state.settings.langs.map((l) => ({ value: l, label: `${LANGS[l].flag} ${LANGS[l].short}` }))];
      body.append(input,
        h('div', { class: 'toolbar' }, chips(langOpts, S.lang, (v) => {
          S.lang = v;
          if (S.setKey && v !== 'all' && state.sets.get(S.setKey)?.lang !== v) S.setKey = null;
          draw();
        })),
        h('div', { class: 'toolbar' }, setBtn,
          chips([{ value: 'all', label: 'All' }, { value: 'owned', label: 'Owned' }, { value: 'missing', label: 'Missing' }], S.owned, (v) => { S.owned = v; draw(); }),
          h('select', { class: 'input mini', 'aria-label': 'Sort', onchange: (e) => { S.sort = e.target.value; draw(); } },
            [['newest', 'Newest sets'], ['oldest', 'Oldest sets'], ['name', 'Name'], ['number', 'Number']].map(([v, l]) => h('option', { value: v, selected: S.sort === v }, l)))),
        results);
      draw();

      function draw() {
        const set = S.setKey && state.sets.get(S.setKey);
        setBtn.textContent = set ? `📦 ${set.name} ✕` : '📦 Any set';
        setBtn.classList.toggle('on', !!set);
        results.innerHTML = '';
        if (!S.q.trim() && !S.setKey && S.owned === 'all') {
          // Browse sets when nothing is typed
          const sets = allSetsSorted().filter((s) => S.lang === 'all' || s.lang === S.lang);
          results.append(h('h3', { class: 'section-title' }, `Browse ${sets.length} sets`),
            h('div', { class: 'set-list' }, sets.slice(0, 300).map((s) => setRow(s, () => openSet(s.key, 'search')))),
            sets.length > 300 ? h('p', { class: 'muted center small' }, 'Pick a language or search to see more sets.') : null);
          return;
        }
        const cards = searchCards(S);
        const keys = cards.map((c) => c.key);
        results.append(h('div', { class: 'muted small count' }, `${cards.length.toLocaleString()} cards`),
          cardGrid(cards, { showSet: !S.setKey, onClick: (c) => openCard(c.key, keys),
            empty: empty('No cards found', 'Try another spelling, language or set. If the card isn’t in the database (some Chinese exclusives aren’t), you can add it yourself.',
              h('button', { class: 'btn primary', onclick: () => import('./addcard.js').then((m) => m.openAddCard({ name: S.q.trim(), lang: S.lang !== 'all' ? S.lang : undefined, setKey: S.setKey })) }, '＋ Add it yourself')) }));
      }

      async function pickSet() {
        if (S.setKey) { S.setKey = null; draw(); return; }
        const key = await pickSetDialog(S.lang);
        if (key) { S.setKey = key; draw(); }
      }
    },
  };
}

/** Searchable list of sets. Resolves with a set key. */
export function pickSetDialog(lang = 'all') {
  return new Promise((resolve) => {
    let result = null;
    sheet({
      title: 'Choose a set', full: true, onClose: () => resolve(result),
      content: (b, { close }) => {
        const input = h('input', { class: 'input search', type: 'search', placeholder: 'Set name…' });
        const list = h('div', { class: 'set-list' });
        const draw = () => {
          const q = input.value.trim().toLowerCase();
          const sets = allSetsSorted().filter((s) => (lang === 'all' || s.lang === lang) && (!q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)));
          list.innerHTML = '';
          list.append(...sets.slice(0, 250).map((s) => setRow(s, () => { result = s.key; close(); })));
        };
        input.addEventListener('input', debounce(draw, 150));
        b.append(input, list);
        draw();
      },
    });
  });
}

/** Card picker sheet used by wishlists and binders. onPick(card) — return false to keep the picker open. */
export function openPicker({ title = 'Choose a card', onPick, multi = false, ownedOnlyDefault = false }) {
  const P = { q: '', lang: 'all', setKey: null, owned: ownedOnlyDefault ? 'owned' : 'all', sort: 'newest' };
  return sheet({
    title, full: true,
    content: (b, { close }) => {
      const input = h('input', { class: 'input search', type: 'search', placeholder: 'Name or number…', enterkeyhint: 'search' });
      const setBtn = h('button', { class: 'chip', onclick: async () => {
        if (P.setKey) P.setKey = null; else P.setKey = await pickSetDialog(P.lang);
        draw();
      } });
      const res = h('div');
      input.addEventListener('input', debounce(() => { P.q = input.value; draw(); }, 220));
      b.append(input,
        h('div', { class: 'toolbar' },
          chips([{ value: 'all', label: 'All' }, ...state.settings.langs.map((l) => ({ value: l, label: LANGS[l].short }))], P.lang, (v) => { P.lang = v; draw(); }),
          setBtn,
          chips([{ value: 'all', label: 'Any' }, { value: 'owned', label: 'Owned' }], P.owned, (v) => { P.owned = v; draw(); })),
        res);
      function draw() {
        const set = P.setKey && state.sets.get(P.setKey);
        setBtn.textContent = set ? `📦 ${set.name} ✕` : '📦 Any set';
        setBtn.classList.toggle('on', !!set);
        res.innerHTML = '';
        if (!P.q.trim() && !P.setKey && P.owned === 'all') {
          res.append(h('p', { class: 'muted center pad' }, 'Type a name or pick a set.'));
          return;
        }
        const cards = searchCards(P);
        res.append(h('div', { class: 'muted small count' }, `${cards.length} cards${multi ? ' · tap to add, tap again to add more' : ''}`),
          cardGrid(cards, { showSet: !P.setKey, onClick: async (c) => { const keep = await onPick(c); if (!multi && keep !== true) close(); } }));
      }
      draw();
      setTimeout(() => input.focus(), 300);
    },
  });
}

export function initSearch() { nav.setRoot('search', searchRoot()); }
