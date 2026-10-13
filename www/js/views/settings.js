// Settings: languages, downloads (card data, Pokédex, images), backup.
import { h, nav, sheet, toast, confirmDialog, chooseDialog, icon, chips, fmtDate } from '../ui.js';
import { state, saveSettings, exportBackup, importBackup, setCatalog, rebuildDex, emit } from '../store.js';
import { syncCatalog, syncSpecies, deleteImages, cardsMissingImages, keepOffline, updateScanData, scanDataInfo, job } from '../sync.js';
import { sizeText } from './offline.js';
import { LANGS, online } from '../api.js';
import * as db from '../db.js';


export function openSettings() {
  nav.push('collection', {
    title: 'Settings',
    watch: ['settings', 'catalog', 'images', 'species', 'sprites', 'scan'],
    render(body) {
      body.append(
        section('Card languages', 'Only these languages are downloaded and shown. Turning one off hides it and lets you delete its data.',
          h('div', { class: 'toggle-list' }, Object.entries(LANGS).map(([code, l]) => toggle(`${l.flag} ${l.label}`,
            state.settings.langs.includes(code), async (on) => {
              const langs = on ? [...state.settings.langs, code] : state.settings.langs.filter((x) => x !== code);
              if (!langs.length) return toast('Keep at least one language');
              await saveSettings({ langs: Object.keys(LANGS).filter((x) => langs.includes(x)) });
              if (!on && [...state.sets.values()].some((s) => s.lang === code) &&
                await confirmDialog(`Also delete downloaded ${l.label} cards and images to free up space? (Cards in your collection stay in your backup.)`, { ok: 'Delete data', danger: true })) {
                await removeLanguage(code);
              }
            })))),

        section('Card data', 'The list of every card. Update now and then to get new sets.',
          h('div', { class: 'data-rows' }, state.settings.langs.map((code) => {
            const info = state.syncInfo[code];
            const sets = [...state.sets.values()].filter((s) => s.lang === code).length;
            const cards = [...state.cards.values()].filter((c) => c.lang === code).length;
            return h('div', { class: 'data-row' },
              h('b', {}, `${LANGS[code].flag} ${LANGS[code].label}`),
              h('small', { class: 'muted' }, info?.unavailable ? 'Not available from the card database right now'
                : sets ? `${sets} sets · ${cards.toLocaleString()} cards · updated ${fmtDate(info?.at) || '—'}` : 'Not downloaded'));
          })),
          h('button', { class: 'btn primary wide', onclick: () => run(() => syncCatalog()) }, icon('download', 18), ' Update card data'),
          h('button', { class: 'btn ghost wide', onclick: () => run(() => syncCatalog(state.settings.langs, { force: true })) }, 'Re-download everything')),

        section('Pokédex', `${state.species.length ? state.species.length + ' Pokémon saved' : 'Not downloaded yet'}`,
          h('button', { class: 'btn wide', onclick: () => run(() => syncSpecies()) }, icon('download', 18), state.species.length ? ' Refresh Pokédex' : ' Download Pokédex')),

        imagesSection(),

        scanSection(),

        section('Collection', '',
          toggle('Count secret rares in set progress', state.settings.includeSecrets, (on) => saveSettings({ includeSecrets: on })),
          h('div', { class: 'field' }, h('span', {}, 'Theme'),
            chips([{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], state.settings.theme, (v) => saveSettings({ theme: v })))),

        section('Backup', 'Your collection, wishlists and binders live only on this phone. Make a backup now and then (and before uninstalling!).',
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', onclick: doExport }, icon('share', 18), ' Back up'),
            h('button', { class: 'btn', onclick: doImport }, icon('download', 18), ' Restore'))),

        storageSection(),

        section('About', '',
          h('p', { class: 'muted small' }, 'CardDex is a fan-made personal app and is not affiliated with Nintendo, The Pokémon Company or Game Freak. Card data and images: TCGdex (tcgdex.dev). Pokédex data and sprites: PokéAPI (pokeapi.co).')),
      );
    },
  });
}

function section(title, text, ...kids) {
  return h('section', { class: 'settings-section' }, h('h3', {}, title), text ? h('p', { class: 'muted small' }, text) : null, ...kids);
}

function toggle(label, on, onChange) {
  const input = h('input', { type: 'checkbox', checked: on, onchange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'toggle' }, h('span', {}, label), input, h('i'));
}

async function run(fn) {
  if (!online()) return toast('You are offline — connect to the internet first');
  if (job.running) return toast('A download is already running');
  try {
    const errs = await fn();
    if (Array.isArray(errs) && errs.length) toast(`Done, but ${errs.length} sets could not be downloaded. Try again later.`, 4000);
    else toast('Download complete ✓');
  } catch (e) { toast(e.message, 4000); }
}

function imagesSection() {
  const saved = [...state.imageKeys].filter((k) => state.cards.has(k));
  const ownedKeys = [...state.owned.keys()];
  const ownedMissing = cardsMissingImages(ownedKeys).length;
  return section('Offline cards', 'Card pictures load from the internet. Save the ones you want to see without internet — from any set, wishlist or binder (⋯ menu), or on a card’s page.',
    h('p', { class: 'small' }, h('b', {}, saved.length.toLocaleString()), ` cards saved on this phone (about ${sizeText(saved.length)}).`),
    toggle('Keep my collection’s cards offline automatically', state.settings.keepOwnedOffline, async (on) => {
      await saveSettings({ keepOwnedOffline: on });
      if (on) keepOffline(ownedKeys);
    }),
    ownedMissing && state.settings.keepOwnedOffline ? h('p', { class: 'muted small' }, `${ownedMissing} of your cards will be saved next time you’re online.`) : null,
    h('button', { class: 'btn ghost wide', onclick: async () => {
      const pick = await chooseDialog('Remove saved cards', [
        { value: 'notowned', label: 'Cards I don’t own', sub: 'Keeps your collection offline' },
        ...state.settings.langs.map((l) => ({ value: l, label: `All ${LANGS[l].label} cards` })),
        { value: 'all', label: 'Everything' },
      ]);
      if (!pick) return;
      const keys = [...state.imageKeys].filter((k) => pick === 'all' || (pick === 'notowned' ? !state.owned.has(k) : k.startsWith(pick + ':')));
      if (!keys.length) return toast('Nothing to remove');
      if (!(await confirmDialog(`Remove ${keys.length} saved cards? They’ll still show when you’re online.`, { ok: 'Remove', danger: true }))) return;
      await deleteImages(keys);
      toast(`Removed ${keys.length} cards`);
    } }, 'Remove saved cards…'));
}

function scanSection() {
  const info = h('div', { class: 'data-rows' }, h('p', { class: 'muted small' }, 'Checking…'));
  scanDataInfo().then((d) => {
    info.innerHTML = '';
    info.append(...state.settings.langs.map((l) => h('div', { class: 'data-row' },
      h('b', {}, `${LANGS[l].flag} ${LANGS[l].label}`),
      h('small', { class: 'muted' }, d[l] ? `Recognises ${d[l].count.toLocaleString()} cards · built ${fmtDate(d[l].built)}` : 'Not downloaded yet'))));
  });
  return section('Scanning', 'The scanner needs a small “scan data” file per language (about 2 MB). It downloads automatically the first time you scan while online, then scanning also works offline. New sets are added monthly.',
    info,
    h('button', { class: 'btn wide', onclick: () => run(async () => {
      const r = await updateScanData({ force: true });
      if (r.missing.length && !r.updated.length) throw new Error('Scan data isn’t available for your languages yet.');
      return [];
    }) }, icon('download', 18), ' Update scan data'),
    toggle('Go straight back to the camera after adding a card', state.settings.scanContinuous, (on) => saveSettings({ scanContinuous: on })));
}

function storageSection() {
  const out = h('p', { class: 'muted small' }, 'Checking storage…');
  (async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      out.textContent = est ? `Using about ${Math.round(est.usage / 1048576)} MB on this phone.${persisted ? ' Storage is protected from automatic clean-up.' : ''}` : '';
    } catch { out.textContent = ''; }
  })();
  return section('Storage', '', out);
}

async function removeLanguage(code) {
  const setKeys = [...state.sets.values()].filter((s) => s.lang === code).map((s) => s.key);
  const cardKeys = [...state.cards.values()].filter((c) => c.lang === code).map((c) => c.key);
  await deleteImages(cardKeys.filter((k) => state.imageKeys.has(k)));
  // Keep cards that are in your collection, wishlists or binders so nothing breaks
  const keep = new Set([...state.owned.keys(), ...[...state.wishlists.values()].flatMap((w) => w.cards), ...[...state.binders.values()].flatMap((b) => b.pages.flat())]);
  const drop = cardKeys.filter((k) => !keep.has(k));
  await db.delMany('cards', drop);
  const keepSets = new Set(cardKeys.filter((k) => keep.has(k)).map((k) => state.cards.get(k).setKey));
  await db.delMany('sets', setKeys.filter((k) => !keepSets.has(k)));
  setCatalog(await db.getAll('sets'), await db.getAll('cards'));
  delete state.syncInfo[code];
  await db.del('meta', `scan:${code}`);
  await db.put('meta', state.syncInfo, 'syncInfo');
  rebuildDex();
  emit('catalog');
  toast('Language data removed');
}

// ---------- First-run setup ----------
export function openSetup() {
  let langs = [...state.settings.langs];
  sheet({
    title: 'Get started', full: true,
    content: (b, { close }) => {
      b.append(
        h('p', {}, 'Pick the card languages you collect. CardDex downloads the full card list for them now. After that, everything works without internet.'),
        h('div', { class: 'toggle-list' }, Object.entries(LANGS).map(([code, l]) => toggle(`${l.flag} ${l.label}`, langs.includes(code), (on) => {
          langs = on ? [...langs, code] : langs.filter((x) => x !== code);
        }))),
        h('p', { class: 'muted small' }, 'The card list is a few MB. Card pictures load from the internet, and you can save any of them for offline later.'),
        h('button', { class: 'btn primary wide', onclick: async () => {
          if (!langs.length) return toast('Pick at least one language');
          if (!online()) return toast('Connect to the internet first');
          await saveSettings({ langs: Object.keys(LANGS).filter((x) => langs.includes(x)) });
          close();
          try { navigator.storage?.persist?.(); } catch { /* ignore */ }
          run(async () => {
            const e = await syncCatalog();
            if (!state.species.length) await syncSpecies();
            try { await updateScanData(); } catch { /* not built yet — the scanner retries later */ }
            return e;
          });
        } }, icon('download', 18), ' Download card data'));
    },
  });
}

// ---------- Share / backup ----------
function plugins() { return window.Capacitor?.Plugins || {}; }

export async function shareText(title, text) {
  const { Share } = plugins();
  try {
    if (Share) await Share.share({ title, text, dialogTitle: title });
    else if (navigator.share) await navigator.share({ title, text });
    else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  } catch { /* cancelled */ }
}

async function doExport() {
  const data = JSON.stringify(await exportBackup());
  const name = `carddex-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const { Filesystem, Share } = plugins();
  try {
    if (Filesystem && Share) {
      const r = await Filesystem.writeFile({ path: name, data, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: 'CardDex backup', url: r.uri, dialogTitle: 'Save your backup (e.g. Google Drive or email it to yourself)' });
    } else {
      const a = h('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: name });
      document.body.append(a); a.click(); a.remove();
    }
    await saveSettings({ lastBackup: Date.now() });
  } catch (e) {
    if (!/cancel/i.test(String(e?.message))) toast('Backup failed: ' + (e?.message || e));
  }
}

function doImport() {
  const input = h('input', { type: 'file', accept: 'application/json,.json,text/plain' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const mode = await chooseDialog('Restore backup', [
        { value: 'merge', label: 'Merge with what’s on this phone', sub: 'Keeps everything, adds the backup' },
        { value: 'replace', label: 'Replace everything', sub: 'Phone data is replaced by the backup' },
      ]);
      if (!mode) return;
      await importBackup(data, mode);
      toast(`Restored ${data.owned?.length || 0} cards, ${data.wishlists?.length || 0} wishlists, ${data.binders?.length || 0} binders`);
    } catch (e) { toast(e.message || 'Could not read that file', 4000); }
  });
  input.click();
}
