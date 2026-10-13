// App start-up: tabs, scan button, download progress bar, Android back button.
import { openDB } from './db.js';
import { state, loadAll, onChange } from './store.js';
import { h, icon, nav, handleBack, toast } from './ui.js';
import { job } from './sync.js';
import { initCollection } from './views/collection.js';
import { initSearch } from './views/search.js';
import { initPokedex } from './views/pokedex.js';
import { initWishlists } from './views/wishlists.js';
import { initBinders } from './views/binders.js';
import { openScanner } from './views/scan.js';
import { openSetup } from './views/settings.js';

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
  await openDB();
  await loadAll();
  applyTheme();

  const app = document.getElementById('app');
  const screens = h('main', { id: 'screens' });
  const bar = h('nav', { id: 'tabbar' }, TABS.map(([id, label, ic]) =>
    h('button', { class: 'tab', 'data-tab': id, onclick: () => nav.switchTab(id) }, icon(ic, 22), h('span', {}, label))));
  const fab = h('button', { id: 'scan-fab', 'aria-label': 'Scan a card', onclick: () => openScanner() }, icon('camera', 28));
  const jobBar = h('div', { id: 'jobbar', hidden: true },
    h('div', { class: 'job-text' }), h('div', { class: 'progress' }, h('div')),
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
  addEventListener('online', () => { offline.hidden = true; });
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
}

main().catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = `<div class="fatal"><h2>Something went wrong</h2><p>${String(e?.message || e)}</p></div>`;
});
