// App start-up: tabs, scan button, download progress bar, Android back button.
import { openDB } from './db.js';
import { state, loadAll, onChange } from './store.js';
import { h, icon, nav, handleBack, toast } from './ui.js';
import { job, keepOffline, autoUpdateCardData } from './sync.js';
import { initCollection } from './views/collection.js';
import { initSearch } from './views/search.js';
import { initPokedex } from './views/pokedex.js';
import { initWishlists } from './views/wishlists.js';
import { initBinders } from './views/binders.js';
import { openScanner } from './views/scan.js';
import { openSetup } from './views/settings.js';
import * as ota from './ota.js';

const TABS = [
  ['collection', 'Collection', 'collection'],
  ['search', 'Search', 'search'],
  ['pokedex', 'Pokédex', 'dex'],
  ['wishlists', 'Wishlists', 'heart'],
  ['binders', 'Binders', 'binder'],
];

function applyTheme() {
  const t = state.settings.theme;
  document.documentElement.dataset.theme = t === 'auto' ? '' : t;
  if (t === 'auto') delete document.documentElement.dataset.theme;
}

async function main() {
  // A downloaded update is waiting? Switch to it (the page reloads straight away)
  if (await ota.boot()) return;
  await openDB();
  await loadAll();
  applyTheme();

  const app = document.getElementById('app');
  const screens = h('main', { id: 'screens' });
  const bar = h('nav', { id: 'tabbar' }, TABS.map(([id, label, ic]) =>
    h('button', { class: 'tab', 'data-tab': id, onclick: () => nav.switchTab(id) }, icon(ic, 22), h('span', {}, label))));
  const fab = h('button', { id: 'scan-fab', 'aria-label': 'Scan a card', onclick: () => openScanner() }, icon('camera', 28));
  const jobBar = h('div', { id: 'jobbar', hidden: true },
    h('div', { class: 'job-text-row' }, h('span', { class: 'mini-ball spin' }), h('span', { class: 'job-text' })), h('div', { class: 'progress' }, h('div')),
    h('button', { class: 'link', onclick: () => { job.stop = true; toast('Stopping…'); } }, 'Stop'));
  const offline = h('div', { id: 'offline', hidden: navigator.onLine !== false }, icon('wifi_off', 14), ' Offline — everything saved on your phone still works');
  app.append(offline, screens, jobBar, fab, bar);

  nav.init(TABS.map((t) => t[0]), screens);
  nav.onTabChange = (tab) => {
    for (const b of bar.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === tab);
  };
  initCollection(); initSearch(); initPokedex(); initWishlists(); initBinders();
  nav.switchTab('collection');

  onChange((what) => {
    if (what === 'settings') applyTheme();
    if (what === 'job') {
      jobBar.hidden = !job.running || !job.label;
      jobBar.querySelector('.job-text').textContent = job.total ? `${job.label} · ${job.done}/${job.total}` : job.label;
      jobBar.querySelector('.progress > div').style.width = job.total ? `${(job.done / job.total) * 100}%` : '15%';
    }
  });
  // Quietly keep pictures of cards you own on the phone
  let keepTimer = null;
  const keepOwned = () => {
    if (!state.settings.keepOwnedOffline) return;
    clearTimeout(keepTimer);
    keepTimer = setTimeout(() => keepOffline([...state.owned.keys()]), 1500);
  };
  onChange((what) => { if (what === 'owned') keepOwned(); });
  keepOwned();
  addEventListener('online', () => { offline.hidden = true; keepOwned(); });
  addEventListener('offline', () => { offline.hidden = false; });

  // Android back button
  const App = window.Capacitor?.Plugins?.App;
  if (App?.addListener) {
    App.addListener('backButton', () => { if (!handleBack()) App.minimizeApp?.() ?? App.exitApp(); });
  } else {
    addEventListener('keydown', (e) => { if (e.key === 'Escape') handleBack(); });
  }

  if (!state.sets.size) openSetup();
  else if (state.owned.size >= 25 && (!state.settings.lastBackup || Date.now() - state.settings.lastBackup > 30 * 864e5)) {
    setTimeout(() => toast('Tip: make a backup in Settings → Backup', 3500), 1500);
  }
  document.body.classList.add('ready');
  hideBoot();
  // Automatic updates: note that this version started fine, then look for a newer one
  ota.markGood();
  // Check once when the app starts (and when you tap "Check now" in Settings)
  setTimeout(() => ota.checkForUpdate(), 4000);
  // Newer scan data (also used to match the same card across languages): only changed files download
  setTimeout(() => import('./sync.js').then((m) => m.updateScanData()).catch(() => {}), 12000);
  // Pictures for old Japanese cards, from Bulbapedia (saved after the first time)
  setTimeout(() => import('./bulba.js').then((m) => m.fillVintagePictures()).catch(() => {}), 9000);
  // After an update: what changed
  setTimeout(() => import('./whatsnew.js').then((m) => m.maybeShowWhatsNew()).catch(() => {}), 1800);
  // New card lists (e.g. the official Japanese list) arrive without having to tap "Update card data"
  setTimeout(async () => {
    try { if (await autoUpdateCardData()) toast('Japanese cards updated'); } catch { /* try again next start-up */ }
  }, 2500);
}

// Keep the spinning Poké Ball up for at least a moment so start-up feels smooth
const BOOT_MIN_MS = 1400;
function hideBoot() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  const wait = Math.max(0, BOOT_MIN_MS - performance.now());
  setTimeout(() => { boot.classList.add('hide'); setTimeout(() => boot.remove(), 400); }, wait);
}

main().catch((e) => {
  console.error(e);
  document.getElementById('boot')?.remove();
  document.getElementById('app').innerHTML = `<div class="fatal"><h2>Something went wrong</h2><p>${String(e?.message || e)}</p></div>`;
});
