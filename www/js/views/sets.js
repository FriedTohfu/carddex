// A single set: progress, all cards, owned/missing filter, quick-add mode.
import { h, nav, cardGrid, progressBar, chips, toast, langBadge, lazyImg, logoSrc, fmtDate, icon, chooseDialog, promptDialog } from '../ui.js';
import { onChange, state, setProgress, setCardsForProgress, changeOwned, qty, createWishlist, saveWishlist, createBinder, saveBinder, wishlistsSorted } from '../store.js';
import { saveOffline, removeOffline, offlineSub } from './offline.js';
import { openCard } from './card.js';

export function setRow(set, onClick) {
  const p = setProgress(set.key);
  return h('button', { class: 'set-row', onclick: onClick },
    h('div', { class: 'set-logo' }, lazyImg(() => logoSrc(set.logo || set.symbol), '')),
    h('div', { class: 'set-main' },
      h('div', { class: 'set-name' }, h('span', {}, set.name), langBadge(set.lang)),
      h('div', { class: 'set-sub' }, [set.serie, fmtDate(set.releaseDate)].filter(Boolean).join(' · ')),
      progressBar(p.pct)),
    h('div', { class: 'set-count' }, h('b', {}, p.owned), h('small', {}, `/ ${p.total}`)));
}

export function openSet(setKey, tab = nav.current) {
  const set = state.sets.get(setKey);
  if (!set) return;
  let filter = 'all';
  let quick = false;
  const page = {
    title: set.name,
    subtitle: [set.serie, fmtDate(set.releaseDate)].filter(Boolean).join(' · '),
    watch: ['catalog', 'settings', 'images'],
    actions: [{ icon: 'more', label: 'Set options', onClick: () => options() }],
    render(body) {
      const p = setProgress(setKey);
      const all = state.cardsBySet.get(setKey) || [];
      const cards = all.filter((c) => filter === 'all' || (filter === 'owned' ? qty(c.key) : !qty(c.key)));
      const keys = cards.map((c) => c.key);
      const head = h('div', { class: 'set-hero' },
        h('div', { class: 'set-hero-logo' }, lazyImg(() => logoSrc(set.logo || set.symbol), set.name)),
        h('div', { class: 'set-hero-stats' },
          h('div', { class: 'big' }, h('b', { class: 'own-count' }, p.owned), ` / ${p.total}`),
          h('div', { class: 'muted small' }, h('span', { class: 'own-pct' }, `${Math.floor(p.pct * 100)}% complete`), set.official && set.total > set.official ? ` · ${set.official} + ${set.total - set.official} secret` : ''),
          progressBar(p.pct)));
      const quickBtn = h('button', { class: 'chip' + (quick ? ' on accent' : ''), onclick: () => { quick = !quick; quickBtn.classList.toggle('on', quick); quickBtn.classList.toggle('accent', quick); toast(quick ? 'Quick add on: tap a card to add one' : 'Quick add off'); } }, '⚡ Quick add');
      body.append(head,
        h('div', { class: 'toolbar' },
          chips([{ value: 'all', label: `All ${all.length}` }, { value: 'owned', label: `Owned ${p.owned}` }, { value: 'missing', label: 'Missing' }], filter, (v) => { filter = v; refresh(); }),
          quickBtn),
        cardGrid(cards, {
          showLang: false,
          onClick: (c) => {
            if (quick) {
              changeOwned(c.key, 'normal', 1);
              toast(`${c.name} ×${qty(c.key)}`, 1200);
            } else openCard(c.key, keys);
          },
          empty: h('p', { class: 'muted center pad' }, filter === 'missing' ? '🎉 Set complete!' : 'No cards here yet.'),
        }));
      // Keep the counter live while quick-adding
      page._off?.();
      page._off = onChange((w) => { if (w === 'owned') page._upd?.(); });
      page._upd = () => {
        const q = setProgress(setKey);
        const el = body.querySelector('.own-count'); if (el) el.textContent = q.owned;
        const oc = [...body.querySelectorAll('.chip')].find((c) => c.textContent.startsWith('Owned')); if (oc) oc.textContent = `Owned ${q.owned}`;
        const pc = body.querySelector('.own-pct'); if (pc) pc.textContent = `${Math.floor(q.pct * 100)}% complete`;
        const bar = body.querySelector('.set-hero .progress > div'); if (bar) bar.style.width = `${q.pct * 100}%`;
      };
      function refresh() { const st = body.scrollTop; body.innerHTML = ''; page.render(body); body.scrollTop = st; }
    },
  };
  page.destroy = () => { page._off?.(); page._off = null; };
  nav.push(tab, page);

  function allKeys() { return (state.cardsBySet.get(setKey) || []).map((c) => c.key); }

  async function options() {
    const pick = await chooseDialog(set.name, [
      { value: 'wish', label: 'Add missing cards to a wishlist', icon: '❤️' },
      { value: 'binder', label: 'Make a binder for this set', icon: '📒' },
      { value: 'img', label: 'Save this set for offline', icon: '📥', sub: offlineSub(allKeys()) },
      { value: 'unimg', label: 'Remove this set from offline', icon: '🗑️' },
      { value: 'all', label: 'Mark every card as owned', icon: '✅' },
    ]);
    const cards = setCardsForProgress(setKey);
    if (pick === 'wish') {
      const lists = wishlistsSorted();
      const w = await chooseDialog('Which wishlist?', [...lists.map((l) => ({ value: l.id, label: `${l.emoji || '⭐'} ${l.name}` })), { value: '__new', label: '＋ New wishlist' }]);
      if (!w) return;
      const list = w === '__new' ? await createWishlist(`${set.name} missing`) : state.wishlists.get(w);
      const add = cards.filter((c) => !qty(c.key) && !list.cards.includes(c.key)).map((c) => c.key);
      list.cards = [...list.cards, ...add];
      await saveWishlist(list);
      toast(`Added ${add.length} cards to ${list.name}`);
    } else if (pick === 'binder') {
      const size = await chooseDialog('Pockets per page', [4, 9, 12].map((n) => ({ value: n, label: `${n}-pocket` })));
      if (!size) return;
      const name = await promptDialog('Binder name', set.name);
      if (!name) return;
      const all = state.cardsBySet.get(setKey) || [];
      const b = await createBinder(name, size, Math.max(1, Math.ceil(all.length / size)));
      all.forEach((c, i) => { b.pages[Math.floor(i / size)][i % size] = c.key; });
      await saveBinder(b);
      toast(`Binder “${name}” created with ${b.pages.length} pages`);
    } else if (pick === 'img') {
      saveOffline(allKeys(), set.name);
    } else if (pick === 'unimg') {
      removeOffline(allKeys(), set.name);
    } else if (pick === 'all') {
      const { confirmDialog } = await import('../ui.js');
      if (!(await confirmDialog(`Mark all ${cards.length} cards in ${set.name} as owned?`, { ok: 'Mark owned' }))) return;
      for (const c of cards) if (!qty(c.key)) await changeOwned(c.key, 'normal', 1);
      toast('Done!');
    }
  }
}
