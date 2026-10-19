// Pokédex tab: every Pokémon; tap one to see all its cards.
import { h, nav, chips, cardGrid, empty, debounce, lazyImg, spriteSrc, cardSrc, toast } from '../ui.js';
import { state, qty } from '../store.js';
import { LANGS, online } from '../api.js';
import { speciesName } from '../dex.js';
import { openCard } from './card.js';
import { groupVersions } from '../versions.js';
import { rarityRank } from '../rarity.js';
import { syncSpecies } from '../sync.js';

const GENS = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];
const D = { q: '', gen: 0, caught: 'all', nameLang: 'en' };

function ownedFor(id) {
  const keys = state.dexIndex.get(id) || [];
  let n = 0, latest = null, latestAt = -1;
  for (const k of keys) if (qty(k)) {
    n++;
    const at = state.owned.get(k)?.addedAt || 0;
    if (at > latestAt) { latestAt = at; latest = k; }
  }
  return { owned: n, total: keys.length, latest };
}

// The picture for a Pokédex entry: your most recently added card of it, or the sprite
function dexPicture(s, o) {
  const card = state.settings.dexShowCards && o.latest ? state.cards.get(o.latest) : null;
  if (card) return h('div', { class: 'sprite dex-card' }, lazyImg(() => cardSrc(card), card.name));
  return h('div', { class: 'sprite' }, lazyImg(() => spriteSrc(s.id), ''));
}

export function pokedexRoot() {
  return {
    title: 'Pokédex', large: true,
    watch: ['species', 'catalog', 'owned', 'settings', 'sprites'],
    render(body) {
      if (!state.species.length) {
        body.append(empty('Pokédex not downloaded', 'Connect to the internet and download the Pokédex (about 1,000 Pokémon with names and pictures).',
          h('button', { class: 'btn primary', onclick: async () => {
            if (!online()) return toast('You are offline');
            try { await syncSpecies(); } catch (e) { toast(e.message); }
          } }, 'Download Pokédex')));
        return;
      }
      const max = state.species.length;
      const gens = [{ value: 0, label: 'All' }, ...GENS.filter(([a]) => a <= max).map(([a], i) => ({ value: i + 1, label: `Gen ${i + 1}` }))];
      const input = h('input', { class: 'input search', type: 'search', placeholder: 'Name or number…', value: D.q });
      const grid = h('div', { class: 'dex-grid' });
      const count = h('div', { class: 'muted small count' });
      input.addEventListener('input', debounce(() => { D.q = input.value.trim().toLowerCase(); draw(); }, 150));
      // Search bar stays pinned at the top while you scroll
      const searchWrap = h('div', { class: 'dex-search' + (state.settings.dexStickySearch !== false ? ' pinned' : '') }, input);
      body.append(searchWrap,
        h('div', { class: 'toolbar' }, chips(gens, D.gen, (v) => { D.gen = v; draw(); })),
        h('div', { class: 'toolbar' },
          chips([{ value: 'all', label: 'All' }, { value: 'caught', label: 'Have cards' }, { value: 'missing', label: 'No cards yet' }], D.caught, (v) => { D.caught = v; draw(); }),
          chips(['en', 'ja', 'zh-tw', 'zh-cn'].map((l) => ({ value: l, label: LANGS[l].short })), D.nameLang, (v) => { D.nameLang = v; draw(); })),
        count, grid);
      draw();

      function draw() {
        grid.innerHTML = '';
        let list = state.species;
        if (D.gen) { const [a, b] = GENS[D.gen - 1]; list = list.filter((s) => s.id >= a && s.id <= b); }
        if (D.q) {
          const n = parseInt(D.q, 10);
          list = list.filter((s) => (n && s.id === n) || [s.en, s.ja, s.zhHant, s.zhHans, s.slug].some((x) => x && x.toLowerCase().includes(D.q)));
        }
        let caught = 0;
        const rows = list.map((s) => { const o = ownedFor(s.id); if (o.owned) caught++; return [s, o]; })
          .filter(([, o]) => D.caught === 'all' || (D.caught === 'caught' ? o.owned : !o.owned));
        count.textContent = `${caught} of ${list.length} Pokémon have at least one card in your collection`;
        const frag = document.createDocumentFragment();
        for (const [s, o] of rows) {
          frag.append(h('button', { class: 'dex-cell' + (o.owned ? ' caught' : ''), onclick: () => openPokemon(s.id) },
            h('span', { class: 'dex-no' }, `#${String(s.id).padStart(4, '0')}`),
            dexPicture(s, o),
            h('span', { class: 'dex-name' }, speciesName(s, D.nameLang)),
            h('span', { class: 'dex-own' }, o.total ? `${o.owned}/${o.total}` : '–')));
        }
        grid.append(frag);
        if (!rows.length) grid.append(h('p', { class: 'muted pad' }, 'No Pokémon match.'));
      }
    },
  };
}

export function openPokemon(id, tab = 'pokedex') {
  const s = state.speciesById.get(id);
  const F = { lang: 'all', setKey: null, owned: 'all', sort: 'newest' };
  nav.push(tab, {
    title: s ? speciesName(s, 'en') : `#${id}`,
    subtitle: `#${String(id).padStart(4, '0')}`,
    watch: ['catalog', 'settings'],
    render(body) {
      const all = (state.dexIndex.get(id) || []).map((k) => state.cards.get(k)).filter((c) => c && state.settings.langs.includes(c.lang));
      const res = h('div');
      const setBtn = h('button', { class: 'chip', onclick: async () => {
        if (F.setKey) F.setKey = null;
        else {
          // Only sets that contain this Pokémon
          const setKeys = [...new Set(all.filter((c) => F.lang === 'all' || c.lang === F.lang).map((c) => c.setKey))];
          const { chooseDialog } = await import('../ui.js');
          F.setKey = await chooseDialog('Set', setKeys.map((k) => state.sets.get(k)).filter(Boolean)
            .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
            .map((st) => ({ value: st.key, label: st.name, sub: `${LANGS[st.lang].short} · ${st.releaseDate?.slice(0, 4) || ''}` })));
        }
        draw();
      } });
      const ownedN = all.filter((c) => qty(c.key)).length;
      // Toggle: show each card once with its language versions inside (remembered)
      const combineBtn = h('button', { class: 'chip' + (state.settings.dexCombine !== false ? ' on' : ''), onclick: async () => {
        const { saveSettings } = await import('../store.js');
        saveSettings({ dexCombine: state.settings.dexCombine === false });
      } }, '🔗 Combine languages');
      // Toggle: grey out cards you don't own (remembered)
      const dimBtn = h('button', { class: 'chip' + (state.settings.dexDimMissing !== false ? ' on' : ''), onclick: async () => {
        const on = state.settings.dexDimMissing === false;
        dimBtn.classList.toggle('on', on);
        const { saveSettings } = await import('../store.js');
        state.settings.dexDimMissing = on;
        saveSettings({ dexDimMissing: on });
      } }, '◐ Grey out missing');
      const latestKey = ownedFor(id).latest;
      body.append(
        h('div', { class: 'mon-hero' },
          state.settings.dexShowCards && latestKey
            ? h('button', { class: 'sprite big dex-card', onclick: () => openCard(latestKey) }, lazyImg(() => cardSrc(state.cards.get(latestKey)), ''))
            : h('div', { class: 'sprite big' }, lazyImg(() => spriteSrc(id), '')),
          h('div', {},
            h('div', { class: 'mon-names' },
              s?.ja ? h('span', {}, '🇯🇵 ', s.ja) : null,
              s?.zhHant ? h('span', {}, '🇹🇼 ', s.zhHant) : null,
              s?.zhHans && s.zhHans !== s.zhHant ? h('span', {}, '🇨🇳 ', s.zhHans) : null),
            h('div', { class: 'big' }, h('b', {}, ownedN), ` / ${all.length} cards owned`))),
        h('div', { class: 'toolbar' },
          chips([{ value: 'all', label: 'All' }, ...state.settings.langs.map((l) => ({ value: l, label: `${LANGS[l].flag} ${LANGS[l].short}` }))], F.lang, (v) => { F.lang = v; F.setKey = null; draw(); })),
        h('div', { class: 'toolbar' }, setBtn,
          chips([{ value: 'all', label: 'All' }, { value: 'owned', label: 'Owned' }, { value: 'missing', label: 'Missing' }], F.owned, (v) => { F.owned = v; draw(); }),
          dimBtn, combineBtn,
          h('select', { class: 'input mini', 'aria-label': 'Sort', onchange: (e) => { F.sort = e.target.value; draw(); } },
            [['newest', 'Newest'], ['oldest', 'Oldest'], ['rarity', 'Rarity']].map(([v, l]) => h('option', { value: v, selected: F.sort === v }, l)))),
        res);
      draw();
      // HP + illustrator for each card (used to match languages when a card has no picture)
      let fetching = false;
      async function factsFor(cards) {
        const { cardDetail } = await import('../sync.js');
        const dbm = await import('../db.js');
        const out = new Map(), missing = [];
        for (const c of cards) {
          const d = c.det || await dbm.get('details', c.key);
          if (d) out.set(c.key, { hp: d.hp, illustrator: d.illustrator || d.illus });
          else missing.push(c);
        }
        // Look up the rest in the background, then redraw once
        if (missing.length && navigator.onLine && !fetching) {
          fetching = true;
          (async () => {
            const queue = missing.slice(0, 150);
            await Promise.all(Array.from({ length: 6 }, async () => {
              while (queue.length) { const c = queue.shift(); try { await cardDetail(c.key); } catch { /* skip */ } }
            }));
            if (res.isConnected) draw();
          })();
        }
        return out;
      }

      async function draw() {
        const set = F.setKey && state.sets.get(F.setKey);
        setBtn.textContent = set ? `📦 ${set.name} ✕` : '📦 Any set';
        setBtn.classList.toggle('on', !!set);
        let cards = all;
        if (F.lang !== 'all') cards = cards.filter((c) => c.lang === F.lang);
        if (F.setKey) cards = cards.filter((c) => c.setKey === F.setKey);
        const rd = (c) => state.sets.get(c.setKey)?.releaseDate || '';
        cards = [...cards].sort(F.sort === 'rarity' ? (a, b) => rarityRank(b) - rarityRank(a) || rd(b).localeCompare(rd(a))
          : F.sort === 'oldest' ? (a, b) => rd(a).localeCompare(rd(b)) : (a, b) => rd(b).localeCompare(rd(a)));
        // One tile per card, with its English/Japanese/Chinese versions inside
        const combine = state.settings.dexCombine !== false && F.lang === 'all';
        let groups = cards.map((c) => ({ rep: c, keys: [c.key] }));
        if (combine) groups = await groupVersions(cards, await factsFor(cards));
        const anyOwned = (g) => g.keys.some((k) => qty(k));
        if (F.owned === 'owned') groups = groups.filter(anyOwned);
        if (F.owned === 'missing') groups = groups.filter((g) => !anyOwned(g));
        const byRep = new Map(groups.map((g) => [g.rep.key, g.keys]));
        const reps = groups.map((g) => g.rep);
        const keys = reps.map((c) => c.key);
        const merged = cards.length - groups.length;
        res.innerHTML = '';
        res.append(h('div', { class: 'muted small count' }, `${groups.length} cards`, combine && merged > 0 ? ` (${merged} other-language versions combined — tap a card to pick the language)` : ''),
          cardGrid(reps, {
            dimMissing: state.settings.dexDimMissing !== false, showSet: true, peek: true,
            versionsOf: combine ? (c) => byRep.get(c.key) : null,
            onClick: (c) => openCard(c.key, keys, { versionsOf: (k) => byRep.get(k) || [k] }),
            empty: empty('No cards', state.sets.size ? 'No cards match these filters.' : 'Download card data in Settings first.'),
          }));
      }
    },
  });
}

export function initPokedex() { nav.setRoot('pokedex', pokedexRoot()); }
