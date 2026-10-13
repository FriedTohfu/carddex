// Form for adding (or editing) a card that isn't in the online database.
import { h, sheet, toast, icon, chips, promptDialog, confirmDialog } from '../ui.js';
import { state } from '../store.js';
import { LANGS } from '../api.js';
import { addCustomCard, updateCustomCard, deleteCustomCard, cropCard } from '../custom.js';
import { pickSetDialog } from './search.js';

/**
 * opts: {photo: canvas (card-shaped) | null, lang, setKey, name, number, editKey, onDone(card)}
 */
export function openAddCard(opts = {}) {
  const editing = opts.editKey ? state.cards.get(opts.editKey) : null;
  let photo = opts.photo || null;
  let lang = editing?.lang || opts.lang || (state.settings.langs.includes('zh-cn') ? 'zh-cn' : state.settings.langs[0]);
  let setKey = editing?.setKey || opts.setKey || null;
  let newSetName = null;
  let owned = true;

  const s = sheet({
    title: editing ? 'Edit your card' : 'Add a card yourself', full: true,
    content: (b, { close }) => {
      const preview = h('div', { class: 'add-photo' });
      const drawPreview = async () => {
        preview.innerHTML = '';
        if (photo) {
          const img = h('img', { alt: 'Card photo' });
          img.src = photo.toDataURL('image/jpeg', 0.8);
          preview.append(img);
        } else if (editing && state.imageKeys.has(editing.key)) {
          const { cardSrc } = await import('../ui.js');
          const img = h('img', { alt: 'Card photo' });
          cardSrc(editing).then((u) => u && (img.src = u));
          preview.append(img);
        } else {
          preview.append(h('div', { class: 'add-photo-empty' }, icon('camera', 30), h('small', {}, 'Add a photo so you (and the scanner) can recognise it')));
        }
      };
      const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => loadPhoto(e.target) });
      const gal = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => loadPhoto(e.target) });
      async function loadPhoto(input) {
        const f = input.files?.[0]; input.value = '';
        if (!f) return;
        try {
          const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(f));
          photo = cropCard(bmp);
          bmp.close?.();
          drawPreview();
        } catch { toast('Couldn’t open that photo'); }
      }

      const name = h('input', { class: 'input', placeholder: 'Card name, e.g. 皮卡丘 or Pikachu', value: editing?.name || opts.name || '', maxlength: 80 });
      const number = h('input', { class: 'input', placeholder: 'Number, e.g. 025/151', value: editing?.localId || opts.number || '', maxlength: 20 });
      const setBtn = h('button', { class: 'btn wide set-pick', disabled: !!editing, onclick: chooseSet });
      const langRow = h('div');
      const drawSet = () => {
        const set = setKey && state.sets.get(setKey);
        setBtn.textContent = set ? `📦 ${set.name}` : newSetName ? `📦 ${newSetName} (new set)` : '📦 Choose a set…';
      };
      const drawLangs = () => {
        langRow.innerHTML = '';
        langRow.append(chips(Object.keys(LANGS).filter((l) => state.settings.langs.includes(l) || l === lang).map((l) => ({ value: l, label: `${LANGS[l].flag} ${LANGS[l].short}` })), lang, (v) => {
          if (editing) return;
          lang = v;
          if (setKey && state.sets.get(setKey)?.lang !== v) setKey = null;
          drawSet();
        }));
      };
      async function chooseSet() {
        const { chooseDialog } = await import('../ui.js');
        const how = await chooseDialog('Which set?', [
          { value: 'pick', label: 'An existing set', sub: `${LANGS[lang].label} sets already in the app`, icon: '📦' },
          { value: 'new', label: 'A new set', sub: 'For sets that aren’t listed at all', icon: '＋' },
        ]);
        if (how === 'pick') { const k = await pickSetDialog(lang); if (k) { setKey = k; newSetName = null; } }
        else if (how === 'new') { const n = await promptDialog('New set name', '', { placeholder: 'e.g. 宝可梦卡牌 151', ok: 'Use' }); if (n) { newSetName = n; setKey = null; } }
        drawSet();
      }
      const ownToggle = h('label', { class: 'toggle' }, h('span', {}, 'I own this card'),
        h('input', { type: 'checkbox', checked: owned, onchange: (e) => { owned = e.target.checked; } }), h('i'));

      drawPreview(); drawSet(); drawLangs();
      b.append(
        h('div', { class: 'add-top' }, preview,
          h('div', { class: 'add-photo-btns' },
            h('button', { class: 'btn', onclick: () => cam.click() }, icon('camera', 18), ' Take photo'),
            h('button', { class: 'btn', onclick: () => gal.click() }, icon('image', 18), ' From gallery'))),
        cam, gal,
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('div', { class: 'field' }, h('span', {}, 'Language'), langRow),
        h('div', { class: 'field' }, h('span', {}, 'Set'), setBtn),
        h('label', { class: 'field' }, h('span', {}, 'Card number'), number),
        editing ? null : ownToggle,
        h('button', { class: 'btn primary wide', onclick: save }, editing ? 'Save changes' : 'Add card'),
        editing ? h('button', { class: 'btn ghost wide danger-text', onclick: remove }, 'Delete this card') : null,
        h('p', { class: 'muted small' }, 'Cards you add are only on this phone and are included in your backups.'));

      async function save() {
        if (!name.value.trim()) { toast('Give the card a name'); return name.focus(); }
        if (!editing && !setKey && !newSetName) { toast('Choose a set (or make a new one)'); return chooseSet(); }
        try {
          if (editing) {
            await updateCustomCard(editing.key, { name: name.value, number: number.value, photo });
            toast('Saved');
            close();
            opts.onDone?.(state.cards.get(editing.key));
          } else {
            const card = await addCustomCard({ lang, name: name.value, number: number.value, setKey, newSetName, photo, owned });
            toast(`Added ${card.name}${owned ? ' to your collection' : ''}`);
            close();
            opts.onDone?.(card);
          }
        } catch (e) { toast('Couldn’t save: ' + (e?.message || e)); }
      }
      async function remove() {
        if (!(await confirmDialog(`Delete “${editing.name}”? It’s removed from your collection, wishlists and binders.`, { ok: 'Delete', danger: true }))) return;
        await deleteCustomCard(editing.key);
        toast('Deleted');
        close();
        opts.onDone?.(null);
      }
    },
  });
  return s;
}
