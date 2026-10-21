// Binders tab: 4, 9 or 12-pocket binder layouts you fill with cards.
import { h, nav, empty, sheet, promptDialog, confirmDialog, chooseDialog, toast, icon, setTitle, cardArt, lazyImg, cardSrc, chips, showPeek } from '../ui.js';
import { state, bindersSorted, createBinder, saveBinder, deleteBinder, LAYOUTS, qty, changeOwned } from '../store.js';
import { openCard } from './card.js';
import { openPicker, pickSetDialog } from './search.js';
import { saveOffline, offlineSub } from './offline.js';

const COLORS = ['#d63a3a', '#2f6fdf', '#2c9b5a', '#f2b531', '#7b4fd6', '#1f2430', '#e46fa1', '#e07b2c'];

export function bindersRoot() {
  return {
    title: 'Binders', large: true,
    watch: ['binders', 'owned', 'catalog'],
    actions: [{ icon: 'plus', label: 'New binder', onClick: newBinder }],
    render(body) {
      const list = bindersSorted();
      if (!list.length) {
        body.append(empty('No binders yet', 'Plan your binder pages: pick 4, 9 or 12 pockets per page and fill them with cards.',
          h('button', { class: 'btn primary', onclick: newBinder }, icon('plus', 18), ' New binder')));
        return;
      }
      body.append(h('div', { class: 'binder-shelf' }, list.map((b) => {
        const slots = b.pages.flat();
        const filled = slots.filter(Boolean);
        const owned = filled.filter((k) => qty(k)).length;
        const cover = filled.slice(0, 1).map((k) => state.cards.get(k)).filter(Boolean)[0];
        return h('button', { class: 'binder-cover', style: { '--bc': b.color }, onclick: () => openBinder(b.id) },
          h('div', { class: 'binder-spine' }),
          h('div', { class: 'binder-window' }, cover ? lazyImg(() => cardSrc(cover), '') : h('div', { class: 'ball' })),
          h('div', { class: 'binder-label' }, h('b', {}, b.name),
            h('small', {}, `${b.size}-pocket · ${b.pages.length} pages`),
            h('small', {}, `${filled.length}/${slots.length} filled · ${owned} owned`)));
      })));
    },
  };
}

function newBinder() {
  let size = 9, pages = 10, color = COLORS[state.binders.size % COLORS.length], fromSet = null;
  sheet({
    title: 'New binder', full: true,
    content: (b, { close }) => {
      const name = h('input', { class: 'input', placeholder: 'Binder name', maxlength: 40, value: `Binder ${state.binders.size + 1}` });
      const sizeRow = h('div', { class: 'size-pick' });
      const drawSizes = () => {
        sizeRow.innerHTML = '';
        for (const n of [4, 9, 12]) {
          const { cols, rows } = LAYOUTS[n];
          sizeRow.append(h('button', { class: 'size-opt' + (size === n ? ' on' : ''), onclick: () => { size = n; drawSizes(); updatePages(); } },
            h('div', { class: 'mini-grid', style: { gridTemplateColumns: `repeat(${cols},1fr)` } }, Array.from({ length: cols * rows }, () => h('i'))),
            h('span', {}, `${n}-pocket`)));
        }
      };
      const pagesVal = h('b', {}, pages);
      const updatePages = () => {
        if (fromSet) pages = Math.max(1, Math.ceil((state.cardsBySet.get(fromSet) || []).length / size));
        pagesVal.textContent = pages;
      };
      const colorRow = h('div', { class: 'swatches' });
      const drawColors = () => {
        colorRow.innerHTML = '';
        for (const c of COLORS) colorRow.append(h('button', { class: 'swatch' + (c === color ? ' on' : ''), style: { background: c }, 'aria-label': 'Colour', onclick: () => { color = c; drawColors(); } }));
      };
      const setBtn = h('button', { class: 'btn wide', onclick: async () => {
        if (fromSet) { fromSet = null; setBtn.textContent = '📦 Fill from a set (optional)'; return; }
        const k = await pickSetDialog();
        if (!k) return;
        fromSet = k;
        const s = state.sets.get(k);
        setBtn.textContent = `📦 ${s.name} ✕`;
        if (name.value.startsWith('Binder ')) name.value = s.name;
        updatePages();
      } }, '📦 Fill from a set (optional)');
      drawSizes(); drawColors();
      b.append(
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('div', { class: 'field' }, h('span', {}, 'Pockets per page'), sizeRow),
        h('div', { class: 'field' }, h('span', {}, 'Pages'), h('div', { class: 'counter' },
          h('button', { class: 'icon-btn', 'aria-label': 'Fewer pages', onclick: () => { pages = Math.max(1, pages - 1); fromSet = fromSet; pagesVal.textContent = pages; } }, icon('minus', 18)),
          pagesVal,
          h('button', { class: 'icon-btn', 'aria-label': 'More pages', onclick: () => { pages = Math.min(200, pages + 1); pagesVal.textContent = pages; } }, icon('plus', 18)))),
        h('div', { class: 'field' }, h('span', {}, 'Colour'), colorRow),
        setBtn,
        h('button', { class: 'btn primary wide', onclick: async () => {
          const bd = await createBinder(name.value.trim() || 'Binder', size, pages, color);
          if (fromSet) {
            const cards = state.cardsBySet.get(fromSet) || [];
            cards.forEach((c, i) => {
              const p = Math.floor(i / size);
              while (bd.pages.length <= p) bd.pages.push(Array(size).fill(null));
              bd.pages[p][i % size] = c.key;
            });
            await saveBinder(bd);
          }
          close();
          openBinder(bd.id);
        } }, 'Create binder'));
    },
  });
}

export function openBinder(id) {
  let pageNo = 0;
  let moving = null; // {p, i}
  const page = nav.push('binders', {
    title: state.binders.get(id)?.name || 'Binder',
    watch: ['binders', 'catalog'],
    actions: [
      { icon: 'grid', label: 'All pages', onClick: () => overview() },
      { icon: 'more', label: 'Binder options', onClick: () => options() },
    ],
    render(body, pg) {
      const b = state.binders.get(id);
      if (!b) { body.append(empty('Binder deleted', '')); return; }
      if (pg?.head) setTitle(pg, b.name);
      pageNo = Math.min(pageNo, b.pages.length - 1);
      const { cols } = LAYOUTS[b.size];
      const slots = b.pages[pageNo];
      const all = b.pages.flat();
      const filled = all.filter(Boolean);
      const owned = filled.filter((k) => qty(k)).length;

      const grid = h('div', { class: `binder-page cols-${cols}`, style: { '--bc': b.color } });
      slots.forEach((key, i) => {
        const card = key && state.cards.get(key);
        const isMoving = moving && moving.p === pageNo && moving.i === i;
        grid.append(h('button', {
          class: 'pocket' + (card ? '' : ' empty') + (card && !qty(key) ? ' unowned' : '') + (isMoving ? ' moving' : ''),
          'aria-label': card ? card.name : 'Empty pocket', 'data-slot': String(i),
          onclick: () => { if (justDragged) return; tapSlot(i); },
        }, card ? cardArt(card) : h('span', { class: 'plus' }, '+'),
          card && !qty(key) ? h('span', { class: 'need' }, 'Need') : null));
      });
      // Press and hold a card, then drag it onto another pocket (or onto ‹ › to move it to another page)
      enableDrag(grid, body);
      // Swipe between pages
      let sx = null;
      grid.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
      grid.addEventListener('touchend', (e) => {
        if (sx == null || dragging) { sx = null; return; }
        const dx = e.changedTouches[0].clientX - sx; sx = null;
        if (Math.abs(dx) > 60) turn(dx < 0 ? 1 : -1);
      });

      body.append(
        moving ? h('div', { class: 'banner' }, 'Tap a pocket to move the card there (any page). ', h('button', { class: 'link', onclick: () => { moving = null; redraw(); } }, 'Cancel')) : null,
        h('div', { class: 'binder-nav' },
          h('button', { class: 'icon-btn', 'aria-label': 'Previous page', 'data-drop': 'prev', disabled: pageNo === 0, onclick: () => turn(-1) }, icon('back')),
          h('div', { class: 'center' }, h('b', {}, `Page ${pageNo + 1}`), h('small', { class: 'muted' }, ` of ${b.pages.length}`)),
          h('button', { class: 'icon-btn flip', 'aria-label': 'Next page', 'data-drop': 'next', onclick: () => turn(1) }, icon('back'))),
        grid,
        h('div', { class: 'binder-foot' },
          h('span', { class: 'muted small' }, `${filled.length}/${all.length} pockets filled · ${owned} owned · ${filled.length - owned} needed`),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', onclick: () => fillPage() }, icon('plus', 18), ' Fill this page'),
            h('button', { class: 'btn', onclick: async () => { b.pages.splice(pageNo + 1, 0, Array(b.size).fill(null)); pageNo++; await saveBinder(b); } }, '＋ Page'))));

      function redraw() { const st = body.scrollTop; body.innerHTML = ''; pg.render(body, pg); body.scrollTop = st; }
      pg._redraw = redraw;
    },
  });

  // ---------- drag and drop ----------
  let dragging = false, justDragged = false;
  function enableDrag(grid, body) {
    let hold = null, start = null;
    grid.addEventListener('pointerdown', (e) => {
      const pocket = e.target.closest('.pocket');
      if (!pocket || pocket.classList.contains('empty') || moving) return;
      start = { x: e.clientX, y: e.clientY, pocket };
      clearTimeout(hold);
      hold = setTimeout(() => begin(start, e.clientX, e.clientY), 300);
    });
    grid.addEventListener('pointermove', (e) => {
      if (!dragging && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { clearTimeout(hold); start = null; }
    });
    const cancelHold = () => { if (!dragging) { clearTimeout(hold); start = null; } };
    grid.addEventListener('pointerup', cancelHold);
    grid.addEventListener('pointercancel', cancelHold);
    grid.addEventListener('contextmenu', (e) => e.preventDefault());
    grid.addEventListener('dragstart', (e) => e.preventDefault()); // no built-in image dragging

    function begin(st, x, y) {
      if (!st) return;
      dragging = true;
      const from = +st.pocket.dataset.slot;
      const r = st.pocket.getBoundingClientRect();
      const ghost = h('div', { class: 'drag-ghost', style: { width: `${r.width}px`, height: `${r.height}px` } }, st.pocket.querySelector('.art')?.cloneNode(true));
      document.body.append(ghost);
      st.pocket.classList.add('drag-src');
      navigator.vibrate?.(15);
      let target = null;
      const place = (px, py) => {
        ghost.style.left = `${px}px`; ghost.style.top = `${py}px`;
        const under = document.elementFromPoint(px, py);
        const t = under?.closest('.pocket[data-slot], [data-drop]');
        const ok = t && (t.dataset.drop ? true : grid.contains(t));
        if (target && target !== t) target.classList.remove('drop-target');
        target = ok ? t : null;
        target?.classList.add('drop-target');
      };
      place(x, y);
      let ended = false;
      // Holding still shows the card big; moving drags it (and closes the big view)
      let closePeek = null, moved = false;
      const peekCard = state.cards.get(state.binders.get(id)?.pages[pageNo]?.[from]);
      const peekTimer = setTimeout(() => { if (!moved && !ended && peekCard) { closePeek = showPeek(peekCard); ghost.style.visibility = 'hidden'; } }, 250);
      const move = (e) => {
        if (e.cancelable) e.preventDefault();
        const p = e.touches ? e.touches[0] : e;
        if (!p) return;
        if (!moved && Math.hypot(p.clientX - x, p.clientY - y) > 12) {
          moved = true; clearTimeout(peekTimer);
          if (closePeek) { closePeek(); closePeek = null; ghost.style.visibility = ''; }
        }
        place(p.clientX, p.clientY);
      };
      const end = async () => {
        if (ended) return;
        ended = true;
        clearTimeout(peekTimer);
        if (closePeek) { closePeek(); closePeek = null; }
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        ghost.remove();
        st.pocket.classList.remove('drag-src');
        target?.classList.remove('drop-target');
        dragging = false; start = null;
        justDragged = true; setTimeout(() => { justDragged = false; }, 350);
        if (!target) return;
        const b = state.binders.get(id);
        if (target.dataset.drop) {
          // Move to the previous/next page's first empty pocket
          const to = pageNo + (target.dataset.drop === 'next' ? 1 : -1);
          if (to < 0) return;
          const key = b.pages[pageNo][from];
          while (b.pages.length <= to) b.pages.push(Array(b.size).fill(null));
          let j = b.pages[to].indexOf(null);
          // No space there: swap with that page's first pocket
          if (j < 0) { j = 0; b.pages[pageNo][from] = b.pages[to][0]; } else b.pages[pageNo][from] = null;
          b.pages[to][j] = key;
          await saveBinder(b);
          toast(`Moved to page ${to + 1}`, 1400);
          return;
        }
        const j = +target.dataset.slot;
        if (j === from) return;
        const p = b.pages[pageNo];
        [p[from], p[j]] = [p[j], p[from]];
        await saveBinder(b);
      };
      // Phones send touch events, mice send pointer events; listen to both
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', end);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', end);
      document.addEventListener('touchcancel', end);
    }
  }
  function turn(d) {
    const b = state.binders.get(id);
    const n = pageNo + d;
    if (n < 0 || n >= b.pages.length) return;
    pageNo = n;
    page._redraw();
  }

  async function tapSlot(i) {
    const b = state.binders.get(id);
    if (moving) {
      const from = b.pages[moving.p][moving.i];
      b.pages[moving.p][moving.i] = b.pages[pageNo][i];
      b.pages[pageNo][i] = from;
      moving = null;
      await saveBinder(b);
      return;
    }
    const key = b.pages[pageNo][i];
    if (!key) return fillFrom(pageNo, i);
    const card = state.cards.get(key);
    const pick = await chooseDialog(card?.name || 'Pocket', [
      { value: 'view', label: 'View card', icon: '🔍' },
      { value: 'move', label: 'Move / swap', icon: '↔️' },
      { value: 'replace', label: 'Replace with another card', icon: '🔄' },
      !qty(key) ? { value: 'own', label: 'I got this card!', icon: '✅' } : null,
      { value: 'remove', label: 'Empty this pocket', icon: '🗑️' },
    ].filter(Boolean));
    if (pick === 'view') openCard(key, b.pages.flat().filter(Boolean));
    else if (pick === 'move') { moving = { p: pageNo, i }; page._redraw(); }
    else if (pick === 'replace') openPicker({ title: 'Replace card', onPick: async (c) => { b.pages[pageNo][i] = c.key; await saveBinder(b); } });
    else if (pick === 'own') { await changeOwned(key, 'normal', 1); toast(`Added ${card.name} to your collection`); }
    else if (pick === 'remove') { b.pages[pageNo][i] = null; await saveBinder(b); }
  }

  function fillPage() {
    const b = state.binders.get(id);
    const i = b.pages[pageNo].indexOf(null);
    if (i < 0) return toast('This page is full');
    fillFrom(pageNo, i);
  }

  /** Picker that keeps filling the next empty pocket, page after page. */
  function fillFrom(p, i) {
    let cur = { p, i };
    openPicker({
      title: 'Fill pockets', multi: true,
      onPick: async (c) => {
        const b = state.binders.get(id);
        if (!cur) { toast('Binder is full — add a page'); return true; }
        b.pages[cur.p][cur.i] = c.key;
        await saveBinder(b);
        toast(`Page ${cur.p + 1}, pocket ${cur.i + 1}: ${c.name}`, 1200);
        cur = nextEmpty(b, cur.p, cur.i);
        if (cur && cur.p !== pageNo) { pageNo = cur.p; }
        return true;
      },
    });
  }

  function nextEmpty(b, p, i) {
    for (let pp = p; pp < b.pages.length; pp++) {
      for (let ii = pp === p ? i + 1 : 0; ii < b.size; ii++) if (!b.pages[pp][ii]) return { p: pp, i: ii };
    }
    return null;
  }

  function overview() {
    const b = state.binders.get(id);
    const { cols } = LAYOUTS[b.size];
    sheet({
      title: `${b.name} — all pages`, full: true,
      content: (body, { close }) => body.append(h('div', { class: 'overview' }, b.pages.map((slots, p) =>
        h('button', { class: 'ov-page' + (p === pageNo ? ' on' : ''), onclick: () => { pageNo = p; close(); page._redraw(); } },
          h('div', { class: `ov-grid cols-${cols}` }, slots.map((k) => h('i', { class: k ? (qty(k) ? 'own' : 'need') : '' }))),
          h('small', {}, `Page ${p + 1}`))))),
    });
  }

  async function options() {
    const b = state.binders.get(id);
    const pick = await chooseDialog(b.name, [
      { value: 'rename', label: 'Rename', icon: '✏️' },
      { value: 'color', label: 'Change colour', icon: '🎨' },
      { value: 'size', label: `Change pockets (now ${b.size})`, icon: '🔢', sub: 'Cards flow onto the new layout in order' },
      { value: 'fillset', label: 'Fill empty pockets from a set', icon: '📦' },
      { value: 'need', label: 'Add needed cards to a wishlist', icon: '❤️' },
      { value: 'offline', label: 'Save this binder for offline', icon: '📥', sub: offlineSub(b.pages.flat().filter(Boolean)) },
      { value: 'delpage', label: `Delete page ${pageNo + 1}`, icon: '📄' },
      { value: 'delete', label: 'Delete binder', icon: '🗑️' },
    ]);
    if (pick === 'rename') {
      const n = await promptDialog('Rename binder', b.name);
      if (n) { b.name = n; await saveBinder(b); }
    } else if (pick === 'color') {
      const c = await chooseDialog('Colour', COLORS.map((x) => ({ value: x, label: '', icon: h('span', { class: 'swatch on', style: { background: x } }), selected: x === b.color })));
      if (c) { b.color = c; await saveBinder(b); }
    } else if (pick === 'size') {
      const n = await chooseDialog('Pockets per page', [4, 9, 12].map((x) => ({ value: x, label: `${x}-pocket`, selected: x === b.size })));
      if (!n || n === b.size) return;
      // Keep every pocket (including gaps) in order, re-cut into new pages
      const flat = b.pages.flat();
      while (flat.length && flat[flat.length - 1] == null) flat.pop();
      const count = Math.max(1, Math.ceil(flat.length / n));
      b.pages = Array.from({ length: count }, (_, p) => Array.from({ length: n }, (_, i) => flat[p * n + i] ?? null));
      b.size = n; pageNo = 0;
      await saveBinder(b);
    } else if (pick === 'fillset') {
      const k = await pickSetDialog();
      if (!k) return;
      const cards = (state.cardsBySet.get(k) || []).map((c) => c.key).filter((key) => !b.pages.flat().includes(key));
      let cur = { p: 0, i: -1 }, n = 0;
      for (const key of cards) {
        cur = nextEmpty(b, cur.p, cur.i);
        if (!cur) { b.pages.push(Array(b.size).fill(null)); cur = { p: b.pages.length - 1, i: 0 }; }
        b.pages[cur.p][cur.i] = key; n++;
      }
      await saveBinder(b);
      toast(`Placed ${n} cards`);
    } else if (pick === 'need') {
      const { wishlistsSorted, createWishlist, saveWishlist } = await import('../store.js');
      const w = await chooseDialog('Which wishlist?', [...wishlistsSorted().map((l) => ({ value: l.id, label: `${l.emoji || '⭐'} ${l.name}` })), { value: '__new', label: '＋ New wishlist' }]);
      if (!w) return;
      const list = w === '__new' ? await createWishlist(`${b.name} needs`) : state.wishlists.get(w);
      const add = [...new Set(b.pages.flat().filter((k) => k && !qty(k) && !list.cards.includes(k)))];
      list.cards = [...list.cards, ...add];
      await saveWishlist(list);
      toast(`Added ${add.length} cards to ${list.name}`);
    } else if (pick === 'offline') {
      saveOffline([...new Set(b.pages.flat().filter(Boolean))], b.name);
    } else if (pick === 'delpage') {
      if (b.pages.length <= 1) return toast('A binder needs at least one page');
      if (!(await confirmDialog(`Delete page ${pageNo + 1}?`, { ok: 'Delete', danger: true }))) return;
      b.pages.splice(pageNo, 1);
      pageNo = Math.max(0, pageNo - 1);
      await saveBinder(b);
    } else if (pick === 'delete') {
      if (await confirmDialog(`Delete binder “${b.name}”? Your collection is not affected.`, { ok: 'Delete', danger: true })) {
        await deleteBinder(id);
        nav.pop('binders');
      }
    }
  }
}

export function initBinders() { nav.setRoot('binders', bindersRoot()); }
