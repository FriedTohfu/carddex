// Card details panel: image, info, how many you own, wishlists, binders.
import { h, sheet, icon, cardArt, cardSrc, langBadge, toast, chooseDialog, nav, fmtDate } from '../ui.js';
import { state, qty, changeOwned, updateOwnedMeta, VARIANTS, CONDITIONS, wishlistsSorted, saveWishlist, createWishlist, bindersSorted, saveBinder, onChange } from '../store.js';
import { cardDetail, priceOf } from '../sync.js';
import { LANGS } from '../api.js';
import { speciesName } from '../dex.js';
import { saveOffline, removeOffline } from './offline.js';

/** Opens a card. `list` (optional) lets you step to the previous/next card. */
export function openCard(key, list = null) {
  let idx = list ? list.indexOf(key) : -1;
  let unsub = null;
  const s = sheet({
    title: '', full: true,
    onClose: () => unsub?.(),
  });
  render(s.body);

  function go(d) {
    if (!list) return;
    const n = idx + d;
    if (n < 0 || n >= list.length) return;
    idx = n; key = list[idx];
    render(s.body);
    s.body.scrollTop = 0;
  }

  function render(body) {
    unsub?.();
    body.innerHTML = '';
    const card = state.cards.get(key);
    if (!card) { body.append(h('p', {}, 'Card not found.')); return; }
    const set = state.sets.get(card.setKey);
    s.setTitle(card.name);

    // Swipe left/right to change card
    let sx = null;
    const imgWrap = h('div', { class: 'detail-img', onclick: () => zoom(card) }, cardArt(card, 'high'));
    imgWrap.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    imgWrap.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    });

    const stepper = list ? h('div', { class: 'stepper' },
      h('button', { class: 'icon-btn', disabled: idx <= 0, 'aria-label': 'Previous card', onclick: () => go(-1) }, icon('back')),
      h('span', {}, `${idx + 1} / ${list.length}`),
      h('button', { class: 'icon-btn flip', disabled: idx >= list.length - 1, 'aria-label': 'Next card', onclick: () => go(1) }, icon('back'))) : null;

    const info = h('div', { class: 'detail-info' },
      h('div', { class: 'detail-sub' }, langBadge(card.lang), ' ', LANGS[card.lang]?.label || card.lang),
      h('button', { class: 'link', onclick: () => { s.close(); import('./sets.js').then((m) => m.openSet(card.setKey, nav.current)); } },
        set ? `${set.name}` : 'Unknown set'),
      h('div', { class: 'muted' }, `#${card.localId}${set?.official ? ' / ' + set.official : ''}`, set?.releaseDate ? ` · ${fmtDate(set.releaseDate)}` : ''),
    );
    const extra = h('div', { class: 'detail-extra' }, h('div', { class: 'muted small' }, 'Loading details…'));

    body.append(h('div', { class: 'detail' }, imgWrap, stepper, info, extra, ownedSection(card), listsSection(card), dexSection(card)));

    cardDetail(key).then((d) => {
      extra.innerHTML = '';
      if (!d) { extra.append(h('div', { class: 'muted small' }, navigator.onLine ? '' : 'More details appear when you are online.')); return; }
      const rows = [
        ['Rarity', d.rarity], ['Type', d.category], ['HP', d.hp], ['Illustrator', d.illustrator], ['Regulation', d.regulationMark],
      ].filter((r) => r[1]);
      const price = priceOf(d);
      if (price) rows.push(['Market price', `${price.currency}${price.value.toFixed(2)} (${price.source})`]);
      extra.append(h('dl', { class: 'facts' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])));
    });

    unsub = onChange((w) => { if (w === 'owned' || w === 'wishlists' || w === 'binders' || w === 'images') refreshSections(); });
    function refreshSections() {
      const d = body.querySelector('.detail');
      if (!d) return;
      d.querySelector('.owned-box')?.replaceWith(ownedSection(card));
      d.querySelector('.lists-box')?.replaceWith(listsSection(card));
    }
  }

  function ownedSection(card) {
    const o = state.owned.get(card.key);
    const total = qty(card.key);
    const box = h('div', { class: 'box owned-box' + (total ? ' is-owned' : '') },
      h('div', { class: 'box-title' }, total ? h('span', { class: 'pill good' }, icon('check', 14), ` In collection ×${total}`) : h('span', { class: 'pill' }, 'Not in collection')));
    if (!total) {
      box.append(h('button', { class: 'btn primary wide', onclick: () => { changeOwned(card.key, 'normal', 1); toast(`Added ${card.name}`); } }, icon('plus', 18), ' Add to collection'));
    }
    const rows = h('div', { class: 'variants' });
    for (const [v, label] of VARIANTS) {
      const n = o?.counts?.[v] || 0;
      if (!total && v !== 'normal') continue;
      rows.append(h('div', { class: 'variant-row' },
        h('span', {}, label),
        h('div', { class: 'counter' },
          h('button', { class: 'icon-btn', 'aria-label': `Remove one ${label}`, disabled: !n, onclick: () => changeOwned(card.key, v, -1) }, icon('minus', 18)),
          h('b', {}, n),
          h('button', { class: 'icon-btn', 'aria-label': `Add one ${label}`, onclick: () => changeOwned(card.key, v, 1) }, icon('plus', 18)))));
    }
    if (total) {
      box.append(rows);
      const cond = h('select', { class: 'input', onchange: (e) => updateOwnedMeta(card.key, { condition: e.target.value }) },
        CONDITIONS.map((c) => h('option', { value: c, selected: o.condition === c }, c)));
      const notes = h('textarea', { class: 'input', rows: 2, placeholder: 'Notes (graded, where you got it, price paid…)', onchange: (e) => updateOwnedMeta(card.key, { notes: e.target.value }) });
      notes.value = o.notes || '';
      box.append(h('label', { class: 'field' }, h('span', {}, 'Condition'), cond), h('label', { class: 'field' }, h('span', {}, 'Notes'), notes));
      if (o.addedAt) box.append(h('div', { class: 'muted small' }, `Added ${new Date(o.addedAt).toLocaleDateString()}`));
    }
    return box;
  }

  function listsSection(card) {
    const inLists = wishlistsSorted().filter((w) => w.cards.includes(card.key));
    const inBinders = bindersSorted().filter((b) => b.pages.some((p) => p.includes(card.key)));
    return h('div', { class: 'box lists-box' },
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => toggleWishlist(card) }, icon('heart', 18), ' Wishlist'),
        h('button', { class: 'btn', onclick: () => addToBinder(card) }, icon('binder', 18), ' Binder')),
      inLists.length ? h('div', { class: 'tags' }, inLists.map((w) => h('span', { class: 'tag' }, `${w.emoji || '⭐'} ${w.name}`))) : null,
      inBinders.length ? h('div', { class: 'tags' }, inBinders.map((b) => h('span', { class: 'tag', style: { borderColor: b.color } }, `📒 ${b.name}`))) : null,
      !card.image ? null : state.imageKeys.has(card.key)
        ? h('div', { class: 'offline-line' }, h('span', { class: 'good-text small' }, '✓ Saved on this phone (shows offline)'),
          qty(card.key) ? null : h('button', { class: 'link small', onclick: () => removeOffline([card.key], card.name) }, 'Remove'))
        : h('div', { class: 'offline-line' }, h('span', { class: 'muted small' }, 'Shows when you’re online'),
          h('button', { class: 'link small', onclick: () => saveOffline([card.key], card.name) }, '📥 Save for offline')));
  }

  function dexSection(card) {
    const ids = state.cardDex.get(card.key) || [];
    if (!ids.length) return null;
    return h('div', { class: 'box' }, h('div', { class: 'box-title' }, 'Pokémon on this card'),
      h('div', { class: 'tags' }, ids.map((id) => {
        const sp = state.speciesById.get(id);
        return h('button', { class: 'tag tap', onclick: () => { s.close(); import('./pokedex.js').then((m) => m.openPokemon(id)); } },
          `#${id} ${speciesName(sp, 'en')}`);
      })));
  }
  return s;
}

export async function toggleWishlist(card) {
  const lists = wishlistsSorted();
  const opts = lists.map((w) => ({ value: w.id, label: `${w.emoji || '⭐'} ${w.name}`, sub: w.cards.includes(card.key) ? 'Tap to remove' : `${w.cards.length} cards`, selected: w.cards.includes(card.key) }));
  opts.push({ value: '__new', label: '＋ New wishlist' });
  const pick = await chooseDialog('Wishlist', opts);
  if (!pick) return;
  let w;
  if (pick === '__new') {
    const { promptDialog } = await import('../ui.js');
    const name = await promptDialog('New wishlist name', '', { placeholder: 'e.g. Pikachu chase cards' });
    if (!name) return;
    w = await createWishlist(name);
  } else w = state.wishlists.get(pick);
  if (w.cards.includes(card.key)) { w.cards = w.cards.filter((k) => k !== card.key); toast(`Removed from ${w.name}`); }
  else { w.cards = [...w.cards, card.key]; toast(`Added to ${w.name}`); }
  await saveWishlist(w);
}

export async function addToBinder(card) {
  const binders = bindersSorted();
  if (!binders.length) { toast('Create a binder first (Binders tab)'); return; }
  const pick = await chooseDialog('Add to binder', binders.map((b) => ({ value: b.id, label: b.name, sub: `${b.size}-pocket · ${b.pages.length} pages` })));
  if (!pick) return;
  const b = state.binders.get(pick);
  for (let p = 0; p < b.pages.length; p++) {
    const i = b.pages[p].indexOf(null);
    if (i >= 0) { b.pages[p][i] = card.key; await saveBinder(b); toast(`Placed on page ${p + 1} of ${b.name}`); return; }
  }
  b.pages.push(Array(b.size).fill(null));
  b.pages[b.pages.length - 1][0] = card.key;
  await saveBinder(b);
  toast(`Added a new page to ${b.name}`);
}

function zoom(card) {
  const img = h('img', { class: 'zoom-img', alt: card.name });
  cardSrc(card, 'high').then((u) => { if (u) img.src = u; });
  img.addEventListener('error', () => cardSrc(card, 'low').then((u) => u && (img.src = u)), { once: true });
  sheet({ title: card.name, full: true, content: h('div', { class: 'zoom' }, img) });
}
