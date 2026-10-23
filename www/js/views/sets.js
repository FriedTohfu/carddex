// A single set: progress, all cards, owned/missing filter, quick-add mode.
import { h, nav, cardGrid, progressBar, chips, toast, langBadge, lazyImg, logoSrc, fmtDate, icon, chooseDialog, promptDialog } from '../ui.js';
import { onChange, state, setProgress, setCardsForProgress, changeOwned, qty, createWishlist, saveWishlist, createBinder, saveBinder, wishlistsSorted, ownedForProgress, needsReverse } from '../store.js';
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
  let picking = false;
  const picked = new Set();
  const page = {
    title: set.name,
    subtitle: [set.serie, fmtDate(set.releaseDate)].filter(Boolean).join(' · '),
    watch: ['catalog', 'settings', 'images'],
    actions: [{ icon: 'more', label: 'Set options', onClick: () => options() }],
    render(body) {
      const p = setProgress(setKey);
      const all = state.cardsBySet.get(setKey) || [];
      const done = (c) => ownedForProgress(c, set);
      const cards = all.filter((c) => filter === 'all' || (filter === 'owned' ? done(c) : !done(c)));
      const keys = cards.map((c) => c.key);
      const head = h('div', { class: 'set-hero' },
        h('div', { class: 'set-hero-logo' }, lazyImg(() => logoSrc(set.logo || set.symbol), set.name)),
        h('div', { class: 'set-hero-stats' },
          h('div', { class: 'big' }, h('b', { class: 'own-count' }, p.owned), ` / ${p.total}`),
          h('div', { class: 'muted small' }, h('span', { class: 'own-pct' }, `${Math.floor(p.pct * 100)}% complete`), set.official && set.total > set.official ? ` · ${set.official} + ${set.total - set.official} secret` : ''),
          progressBar(p.pct)));
      const quickBtn = h('button', { class: 'chip' + (quick ? ' on accent' : ''), onclick: () => { quick = !quick; if (quick) { picking = false; picked.clear(); } refresh(); toast(quick ? 'Quick add on: tap a card to add one' : 'Quick add off'); } }, '⚡ Quick add');
      const pickBtn = h('button', { class: 'chip' + (picking ? ' on accent' : ''), onclick: () => { picking = !picking; picked.clear(); if (picking) quick = false; refresh(); } }, picking ? '☑ Selecting…' : '☑ Select');
      // Bar for the cards you've picked
      const bar = h('div', { class: 'select-bar', hidden: !picking });
      const drawBar = () => {
        bar.innerHTML = '';
        bar.append(
          h('button', { class: 'btn primary', disabled: !picked.size, onclick: async () => {
            const n = picked.size;
            for (const k of picked) await changeOwned(k, 'normal', 1);
            picked.clear(); picking = false; refresh();
            toast(`Added ${n} cards ✓`);
          } }, `Add ${picked.size || ''} to collection`),
          h('button', { class: 'btn', disabled: !picked.size, onclick: async () => {
            const lists = wishlistsSorted();
            const w = await chooseDialog('Which wishlist?', [...lists.map((l) => ({ value: l.id, label: `${l.emoji || '⭐'} ${l.name}` })), { value: '__new', label: '＋ New wishlist' }]);
            if (!w) return;
            const list = w === '__new' ? await createWishlist(`${set.name} picks`) : state.wishlists.get(w);
            const add = [...picked].filter((k) => !list.cards.includes(k));
            list.cards = [...list.cards, ...add];
            await saveWishlist(list);
            toast(`Added ${add.length} to ${list.name}`);
            picked.clear(); picking = false; refresh();
          } }, '♡ Wishlist'));
      };
      drawBar();
      body.append(head,
        h('div', { class: 'toolbar' },
          chips([{ value: 'all', label: `All ${all.length}` }, { value: 'owned', label: `Owned ${p.owned}` }, { value: 'missing', label: 'Missing' }], filter, (v) => { filter = v; refresh(); }),
          quickBtn, pickBtn),
        cardGrid(cards, {
          showLang: false, dimMissing: state.settings.setDimMissing !== false,
          onClick: (c) => {
            if (picking) {
              picked.has(c.key) ? picked.delete(c.key) : picked.add(c.key);
              body.querySelector(`.tile[data-key="${CSS.escape(c.key)}"]`)?.classList.toggle('picked', picked.has(c.key));
              drawBar();
              return;
            }
            if (quick) {
              changeOwned(c.key, 'normal', 1);
              toast(`${c.name} ×${qty(c.key)}`, 1200);
            } else openCard(c.key, keys);
          },
          empty: h('p', { class: 'muted center pad' }, filter === 'missing' ? '🎉 Set complete!' : 'No cards here yet.'),
        }), bar);
      for (const k of picked) body.querySelector(`.tile[data-key="${CSS.escape(k)}"]`)?.classList.add('picked');
      if (state.settings.masterSet && all.some((c) => needsReverse(c, set))) {
        head.append(h('div', { class: 'muted small' }, 'Master set: Commons, Uncommons and Rares need a reverse holo too'));
      }
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
      { value: 'addcard', label: 'Add a missing card to this set', icon: '＋', sub: 'For cards the database doesn’t have' },
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
    } else if (pick === 'addcard') {
      import('./addcard.js').then((m) => m.openAddCard({ lang: set.lang, setKey }));
    } else if (pick === 'all') {
      const { confirmDialog } = await import('../ui.js');
      if (!(await confirmDialog(`Mark all ${cards.length} cards in ${set.name} as owned?`, { ok: 'Mark owned' }))) return;
      for (const c of cards) if (!qty(c.key)) await changeOwned(c.key, 'normal', 1);
      toast('Done!');
    }
  }
}
