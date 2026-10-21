// Search tab: find any card by name or number, filter by language and set.
import { h, nav, chips, cardGrid, empty, debounce, chooseDialog, sheet, icon, langBadge, progressiveList } from '../ui.js';
import { state, allSetsSorted, qty } from '../store.js';
import { LANGS } from '../api.js';
import { normalizeName } from '../dex.js';
import { openCard } from './card.js';
import { rarityRank } from '../rarity.js';
import { setRow, openSet } from './sets.js';

/** Core search used by the Search tab and the card picker. */
export function searchCards({ q = '', lang = 'all', setKey = null, owned = 'all', sort = 'newest', by = 'card' }) {
  let cards;
  if (setKey) cards = [...(state.cardsBySet.get(setKey) || [])];
  else {
    cards = [];
    for (const c of state.cards.values()) if (state.settings.langs.includes(c.lang)) cards.push(c);
  }
  if (lang !== 'all') cards = cards.filter((c) => c.lang === lang);
  q = q.trim();
  if (q && by === 'artist') {
    // Artist search: every card whose illustrator matches all the words typed
    const words = normalizeName(q).split(' ').filter(Boolean);
    cards = cards.filter((c) => { const a = c.det?.illustrator; if (!a) return false; const n = normalizeName(a); return words.every((w) => n.includes(w)); });
  } else if (q) {
    // Understands a card number anywhere in the search, with or without a name:
    // "Mewtwo 164/162", "164/162 mewtwo", "mewtwo 164", "#25", "TG05/TG30", "001/SV-P"
    const stripZ = (x) => String(x ?? '').trim().toLowerCase().replace(/^0+(?=[0-9])/, '');
    let num = null, of = null, rest = q;
    const withTotal = q.match(/(?:^|\s)#?\s*([a-z]{0,6}\d+[a-z]?)\s*\/\s*([a-z0-9-]+)(?=\s|$)/i);
    if (withTotal) { num = withTotal[1]; of = withTotal[2]; rest = q.replace(withTotal[0], ' '); }
    else {
      const alone = q.match(/(?:^|\s)#?([a-z]{0,6}\d+[a-z]?)(?=\s|$)/i);
      if (alone) { num = alone[1]; rest = q.replace(alone[0], ' '); }
    }
    const words = normalizeName(rest).split(' ').filter(Boolean);
    if (num) {
      const id = stripZ(num);
      cards = cards.filter((c) => {
        if (stripZ(c.localId) !== id) return false;
        if (!of) return true;
        const set = state.sets.get(c.setKey);
        const totals = [set?.official, set?.total, String(c.number || '').split('/')[1]];
        return totals.some((t) => t != null && t !== '' && stripZ(t) === stripZ(of));
      });
    }
    if (words.length) cards = cards.filter((c) => { const n = normalizeName(c.name + (c.nameEn ? ' ' + c.nameEn : '') + (c.nameJa ? ' ' + c.nameJa : '')); return words.every((w) => n.includes(w)); });
  }
  if (owned === 'owned') cards = cards.filter((c) => qty(c.key));
  if (owned === 'missing') cards = cards.filter((c) => !qty(c.key));
  const rd = (c) => state.sets.get(c.setKey)?.releaseDate || '';
  const sorts = {
    newest: (a, b) => rd(b).localeCompare(rd(a)) || a.order - b.order,
    oldest: (a, b) => rd(a).localeCompare(rd(b)) || a.order - b.order,
    name: (a, b) => a.name.localeCompare(b.name) || rd(b).localeCompare(rd(a)),
    number: (a, b) => (parseInt(a.localId, 10) || 0) - (parseInt(b.localId, 10) || 0),
    rarity: (a, b) => rarityRank(b) - rarityRank(a) || rd(b).localeCompare(rd(a)) || a.order - b.order,
  };
  if (!setKey || sort !== 'newest') cards.sort(sorts[sort] || sorts.newest);
  return cards;
}

const S = { q: '', lang: 'all', setKey: null, owned: 'all', sort: 'newest', by: 'card' };

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
      const hint = () => (S.by === 'artist' ? 'Artist, e.g. Mitsuhiro Arita' : 'Name or number, e.g. Mewtwo 164/162');
      const input = h('input', { class: 'input search', type: 'search', placeholder: hint(), value: S.q, enterkeyhint: 'search' });
      input.addEventListener('input', debounce(() => { S.q = input.value; draw(); }, 220));
      const setBtn = h('button', { class: 'chip' + (S.setKey ? ' on' : ''), onclick: pickSet });
      const langOpts = [{ value: 'all', label: 'All languages' }, ...state.settings.langs.map((l) => ({ value: l, label: `${LANGS[l].flag} ${LANGS[l].short}` }))];
      const pinned = h('div', { class: 'dex-search pinned' }, input);
      body.append(pinned,
        h('div', { class: 'toolbar' }, chips([{ value: 'card', label: '🃏 Cards' }, { value: 'artist', label: '🎨 Artist' }], S.by, (v) => {
          S.by = v; input.placeholder = hint(); draw();
        })),
        h('div', { class: 'toolbar' }, chips(langOpts, S.lang, (v) => {
          S.lang = v;
          if (S.setKey && v !== 'all' && state.sets.get(S.setKey)?.lang !== v) S.setKey = null;
          draw();
        })),
        h('div', { class: 'toolbar' }, setBtn,
          chips([{ value: 'all', label: 'All' }, { value: 'owned', label: 'Owned' }, { value: 'missing', label: 'Missing' }], S.owned, (v) => { S.owned = v; draw(); }),
          h('select', { class: 'input mini', 'aria-label': 'Sort', onchange: (e) => { S.sort = e.target.value; draw(); } },
            [['newest', 'Newest sets'], ['oldest', 'Oldest sets'], ['rarity', 'Rarity'], ['name', 'Name'], ['number', 'Number']].map(([v, l]) => h('option', { value: v, selected: S.sort === v }, l)))),
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
          results.append(h('h3', { class: 'section-title' }, `Browse ${sets.length.toLocaleString()} sets`),
            progressiveList(h('div', { class: 'set-list' }), sets, (s) => setRow(s, () => openSet(s.key, 'search'))));
          return;
        }
        const cards = searchCards(S);
        const keys = cards.map((c) => c.key);
        results.append(h('div', { class: 'muted small count' }, `${cards.length.toLocaleString()} cards`),
          cardGrid(cards, { dimMissing: !!state.settings.searchDimMissing, showSet: !S.setKey, onClick: (c) => openCard(c.key, keys),
            empty: empty('No cards found', 'Try another spelling, language or set. If the card isn’t in the database (some Chinese exclusives aren’t), you can add it yourself.',
              h('button', { class: 'btn primary', onclick: () => import('./addcard.js').then((m) => m.openAddCard({ name: S.q.trim(), lang: S.lang !== 'all' ? S.lang : undefined, setKey: S.setKey })) }, '＋ Add it yourself')) }));
      }

      async function pickSet() {
        if (S.setKey) { S.lastSet = S.setKey; S.setKey = null; draw(); return; }
        const key = await pickSetDialog(S.lang, S.lastSet);
        if (key) { S.setKey = key; S.lastSet = key; draw(); }
      }
    },
  };
}

/** Searchable list of sets. Resolves with a set key. */
export function pickSetDialog(lang = 'all', current = null) {
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
          const at = !q && current ? sets.findIndex((s) => s.key === current) : -1;
          // Render far enough to include the set you had open, then scroll to it
          progressiveList(list, sets, (s) => {
            const row = setRow(s, () => { result = s.key; close(); });
            if (s.key === current) row.classList.add('current-set');
            return row;
          }, Math.max(150, at + 30));
          if (at >= 0) requestAnimationFrame(() => list.querySelector('.current-set')?.scrollIntoView({ block: 'center' }));
        };
        input.addEventListener('input', debounce(draw, 150));
        b.append(h('div', { class: 'dex-search pinned' }, input), list);
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
          cardGrid(cards, { dimMissing: false, showSet: !P.setKey, onClick: async (c) => { const keep = await onPick(c); if (!multi && keep !== true) close(); } }));
      }
      draw();
      setTimeout(() => input.focus(), 300);
    },
  });
}

export function initSearch() { nav.setRoot('search', searchRoot()); }

/** Opens Search with a query, e.g. every card by an artist. */
export function searchFor(q, by = 'card') {
  Object.assign(S, { q, by, lang: 'all', setKey: null, owned: 'all' });
  nav.setRoot('search', searchRoot());
  nav.switchTab('search');
}
