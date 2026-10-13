// Wishlists tab: as many named lists as you like.
import { h, nav, cardGrid, empty, promptDialog, confirmDialog, chooseDialog, toast, icon, setTitle, chips, lazyImg, cardSrc } from '../ui.js';
import { state, wishlistsSorted, createWishlist, deleteWishlist, saveWishlist, qty } from '../store.js';
import { openCard } from './card.js';
import { openPicker } from './search.js';

const EMOJIS = ['⭐', '❤️', '🔥', '⚡', '💧', '🌿', '🌙', '👑', '💎', '🎁', '🎯', '🐉'];

export function wishlistsRoot() {
  return {
    title: 'Wishlists', large: true,
    watch: ['wishlists', 'owned', 'catalog'],
    actions: [{ icon: 'plus', label: 'New wishlist', onClick: newList }],
    render(body) {
      const lists = wishlistsSorted();
      if (!lists.length) {
        body.append(empty('No wishlists yet', 'Make lists for chase cards, set completion, birthday ideas… anything.',
          h('button', { class: 'btn primary', onclick: newList }, icon('plus', 18), ' New wishlist')));
        return;
      }
      body.append(h('div', { class: 'wl-list' }, lists.map((w) => {
        const got = w.cards.filter((k) => qty(k)).length;
        const preview = w.cards.slice(0, 3).map((k) => state.cards.get(k)).filter(Boolean);
        return h('button', { class: 'wl-row', onclick: () => openWishlist(w.id) },
          h('div', { class: 'wl-emoji' }, w.emoji || '⭐'),
          h('div', { class: 'wl-main' }, h('b', {}, w.name),
            h('small', { class: 'muted' }, `${w.cards.length} card${w.cards.length === 1 ? '' : 's'}`, got ? ` · ${got} now owned 🎉` : '')),
          h('div', { class: 'wl-preview' }, preview.map((c) => h('div', { class: 'mini-card' }, lazyImg(() => cardSrc(c), '')))));
      })));
    },
  };
}

async function newList() {
  const name = await promptDialog('New wishlist', '', { placeholder: 'e.g. Charizard collection', ok: 'Create' });
  if (!name) return;
  const w = await createWishlist(name, EMOJIS[state.wishlists.size % EMOJIS.length]);
  openWishlist(w.id);
}

export function openWishlist(id) {
  let filter = 'all';
  nav.push('wishlists', {
    title: `${state.wishlists.get(id)?.emoji || '⭐'} ${state.wishlists.get(id)?.name || 'Wishlist'}`,
    watch: ['wishlists', 'catalog'],
    actions: [
      { icon: 'plus', label: 'Add cards', onClick: () => addCards() },
      { icon: 'more', label: 'Wishlist options', onClick: () => options() },
    ],
    render(body, pg) {
      const w = state.wishlists.get(id);
      if (!w) { body.append(empty('Wishlist deleted', '')); return; }
      if (pg?.head) setTitle(pg, `${w.emoji || '⭐'} ${w.name}`);
      const cards = w.cards.map((k) => state.cards.get(k)).filter(Boolean);
      const got = cards.filter((c) => qty(c.key)).length;
      const shown = cards.filter((c) => filter === 'all' || (filter === 'owned' ? qty(c.key) : !qty(c.key)));
      const keys = shown.map((c) => c.key);
      body.append(
        h('div', { class: 'toolbar' },
          chips([{ value: 'all', label: `All ${cards.length}` }, { value: 'need', label: `Still need ${cards.length - got}` }, { value: 'owned', label: `Got ${got}` }], filter, (v) => { filter = v; redraw(); })),
        cardGrid(shown, { showSet: true, onClick: (c) => openCard(c.key, keys),
          empty: empty('This list is empty', 'Add cards with the + button, or from any card’s page.',
            h('button', { class: 'btn primary', onclick: () => addCards() }, icon('plus', 18), ' Add cards')) }));
      function redraw() { body.innerHTML = ''; pg.render(body, pg); }
    },
  });

  function addCards() {
    openPicker({
      title: 'Add to wishlist', multi: true,
      onPick: async (c) => {
        const w = state.wishlists.get(id);
        if (w.cards.includes(c.key)) { toast('Already on this list'); return true; }
        w.cards = [...w.cards, c.key];
        await saveWishlist(w);
        toast(`Added ${c.name}`, 1200);
        return true;
      },
    });
  }

  async function options() {
    const w = state.wishlists.get(id);
    const pick = await chooseDialog(w.name, [
      { value: 'rename', label: 'Rename', icon: '✏️' },
      { value: 'emoji', label: 'Change icon', icon: w.emoji || '⭐' },
      { value: 'clean', label: 'Remove cards I now own', icon: '🧹' },
      { value: 'sort', label: 'Sort by set', icon: '↕️' },
      { value: 'dup', label: 'Duplicate list', icon: '📄' },
      { value: 'share', label: 'Share as text', icon: '📤' },
      { value: 'delete', label: 'Delete wishlist', icon: '🗑️' },
    ]);
    if (pick === 'rename') {
      const name = await promptDialog('Rename wishlist', w.name);
      if (name) { w.name = name; await saveWishlist(w); }
    } else if (pick === 'emoji') {
      const e = await chooseDialog('Icon', EMOJIS.map((x) => ({ value: x, label: x, selected: x === w.emoji })));
      if (e) { w.emoji = e; await saveWishlist(w); }
    } else if (pick === 'clean') {
      const before = w.cards.length;
      w.cards = w.cards.filter((k) => !qty(k));
      await saveWishlist(w);
      toast(`Removed ${before - w.cards.length} cards`);
    } else if (pick === 'sort') {
      const rd = (k) => state.sets.get(state.cards.get(k)?.setKey)?.releaseDate || '';
      w.cards = [...w.cards].sort((a, b) => rd(a).localeCompare(rd(b)) || (state.cards.get(a)?.order || 0) - (state.cards.get(b)?.order || 0));
      await saveWishlist(w);
    } else if (pick === 'dup') {
      const copy = await createWishlist(`${w.name} (copy)`, w.emoji);
      copy.cards = [...w.cards];
      await saveWishlist(copy);
      toast('List duplicated');
    } else if (pick === 'share') {
      const text = `${w.name}\n` + w.cards.map((k) => {
        const c = state.cards.get(k); const s = state.sets.get(c?.setKey);
        return c ? `• ${c.name} — ${s?.name || ''} #${c.localId}${qty(k) ? ' ✓' : ''}` : '';
      }).filter(Boolean).join('\n');
      const { shareText } = await import('./settings.js');
      shareText(w.name, text);
    } else if (pick === 'delete') {
      if (await confirmDialog(`Delete “${w.name}”?`, { ok: 'Delete', danger: true })) {
        await deleteWishlist(id);
        nav.pop('wishlists');
      }
    }
  }
}

export function initWishlists() { nav.setRoot('wishlists', wishlistsRoot()); }
