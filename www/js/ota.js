// Automatic ("over-the-air") updates.
// The app's screens and logic (everything in www/) are downloaded from your
// GitHub repository when they change and saved on the phone. Every launch
// starts the installed version, which immediately switches to the newest
// downloaded one (hidden behind the loading screen). Changes to the Android
// shell itself (rare) still need a new APK — the app shows a banner for those.
//
// Safety: if a downloaded version fails to start twice, it's skipped and the
// installed version is used until a newer one arrives.
import { toast, h } from './ui.js';
import { online } from './api.js';

export const REPO = 'FriedTohfu/carddex';
const API = `https://api.github.com/repos/${REPO}`;
const RAW = (sha, path) => `https://raw.githubusercontent.com/${REPO}/${sha}/${path}`;
export const RELEASES = `https://github.com/${REPO}/releases/latest`;

const P = () => window.Capacitor?.Plugins || {};
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function supported() {
  const { WebView, Filesystem } = P();
  return !!(WebView?.setServerBasePath && WebView?.getServerBasePath && Filesystem?.writeFile && window.Capacitor?.isNativePlatform?.());
}

/** Installed APK's "native level" (middle number of its version, e.g. 1.1.42 → 1). */
export async function nativeInfo() {
  try {
    const info = await P().App?.getInfo?.();
    const [, api] = String(info?.version || '1.0.0').split('.').map((x) => parseInt(x, 10) || 0);
    return { version: info?.version || '?', api, build: +info?.build || 0 };
  } catch { return { version: '?', api: 0, build: 0 }; }
}

let runningSha = null; // null = installed version
async function detectRunning() {
  try {
    const { path } = await P().WebView.getServerBasePath();
    const m = /\/ota\/([0-9a-f]{7,40})\/?$/.exec(path || '');
    runningSha = m ? m[1] : null;
  } catch { runningSha = null; }
  return runningSha;
}


/** The newest update in the running version's "What's new" list, e.g. { id: '2026-10-19b', title: '…' }. */
export async function updateVersion() {
  try {
    const list = await (await fetch(new URL('../changelog.json', import.meta.url))).json();
    return list?.[0] || null;
  } catch { return null; }
}

const fails = (sha) => +ls.get(`ota.fails.${sha}`) || 0;

/**
 * Called first thing at start-up. If we're on the installed version and a
 * downloaded update is waiting, switch to it (the page reloads).
 * Returns true if the app is about to reload.
 */
export async function boot() {
  if (!supported()) return false;
  await detectRunning();
  const want = ls.get('ota.want'), path = ls.get('ota.wantPath');
  if (!want || !path || ls.get('ota.disabled') === '1') return false;
  if (runningSha === want) return false; // already on the newest download
  if (fails(want) >= 2) return false; // this version didn't start properly — skip it
  ls.set(`ota.fails.${want}`, String(fails(want) + 1)); // cleared by markGood()
  try {
    await P().WebView.setServerBasePath({ path });
    return true;
  } catch { return false; }
}

/** Called once the app has started successfully. */
export function markGood() {
  if (runningSha) {
    const wasNew = ls.get('ota.current') !== runningSha;
    ls.set(`ota.fails.${runningSha}`, '0');
    ls.set('ota.current', runningSha);
    if (wasNew) setTimeout(() => toast('CardDex was updated ✓', 2500), 1800);
  }
  window.__carddexBooted = true;
}

async function json(url) {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function dataPath(sub) {
  const { uri } = await P().Filesystem.getUri({ path: sub, directory: 'DATA' });
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function toBase64(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

let checking = false;
/**
 * Checks GitHub for a newer version and downloads it.
 * Returns 'none' | 'downloaded' | 'needs-apk' | 'unsupported' | 'offline' | 'error'.
 */
export async function checkForUpdate({ force = false, quiet = true } = {}) {
  if (!supported()) return 'unsupported';
  if (!online()) return 'offline';
  if (checking) return 'none';
  if (!force && !autoUpdatesOn()) return 'none';
  checking = true;
  try {
    ls.set('ota.lastCheck', String(Date.now()));
    const sha = (await json(`${API}/commits/main`))?.sha;
    if (!sha) return 'none';
    // The app's version is its www folder: data-only changes on GitHub don't count as an update
    const root = await json(`${API}/git/trees/${sha}`);
    const wwwSha = (root?.tree || []).find((t) => t.path === 'www' && t.type === 'tree')?.sha;
    if (!wwwSha) return 'none';
    if (wwwSha === runningSha || wwwSha === ls.get('ota.want')) return 'none';

    // Does this version need a newer APK?
    let need = 0;
    try { need = parseInt(await (await fetch(RAW(sha, 'build/native-api.txt'))).text(), 10) || 0; } catch { /* assume fine */ }
    if (need > (await nativeInfo()).api) { showApkBanner(); return 'needs-apk'; }

    const tree = await json(`${API}/git/trees/${wwwSha}?recursive=1`);
    const files = (tree?.tree || []).filter((t) => t.type === 'blob').map((t) => t.path);
    if (!files.includes('index.html')) return 'none';

    if (!quiet) toast('Downloading update…');
    const dir = `ota/${wwwSha}`;
    const queue = files.slice();
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        const r = await fetch(RAW(sha, `www/${f}`));
        if (!r.ok) throw new Error(`couldn’t download ${f}`);
        await P().Filesystem.writeFile({ path: `${dir}/${f}`, data: toBase64(await r.arrayBuffer()), directory: 'DATA', recursive: true });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    ls.set('ota.want', wwwSha);
    ls.set('ota.wantPath', await dataPath(dir));
    cleanup([wwwSha, runningSha]);
    showRestart();
    return 'downloaded';
  } catch (e) {
    if (!quiet) toast('Update check failed: ' + (e?.message || e));
    return 'error';
  } finally {
    checking = false;
  }
}

/** Removes old downloaded versions (keeps the running and newest one). */
async function cleanup(keep) {
  try {
    const { files } = await P().Filesystem.readdir({ path: 'ota', directory: 'DATA' });
    for (const f of files || []) {
      const name = typeof f === 'string' ? f : f.name;
      if (!keep.includes(name)) await P().Filesystem.rmdir({ path: `ota/${name}`, directory: 'DATA', recursive: true }).catch(() => {});
    }
  } catch { /* nothing to clean */ }
}

export async function restartNow() {
  const path = ls.get('ota.wantPath');
  if (path && supported()) await P().WebView.setServerBasePath({ path });
  else location.reload();
}

/** Go back to the version that came with the APK (until the next update). */
export async function useInstalledVersion() {
  ls.set('ota.want', '');
  ls.set('ota.wantPath', '');
  toast('Close and reopen the app to use the installed version');
}

export function setAutoUpdates(on) { ls.set('ota.disabled', on ? '0' : '1'); }
export function autoUpdatesOn() { return ls.get('ota.disabled') !== '1'; }

function showRestart() {
  if (document.getElementById('update-banner')) return;
  const b = h('div', { id: 'update-banner' },
    h('span', {}, '✨ Update downloaded'),
    h('button', { class: 'btn mini', onclick: () => restartNow() }, 'Restart now'),
    h('button', { class: 'link', 'aria-label': 'Later', onclick: () => b.remove() }, 'Later'));
  document.getElementById('app')?.prepend(b);
}

function showApkBanner() {
  if (document.getElementById('apk-banner')) return;
  const b = h('div', { id: 'apk-banner' },
    h('span', {}, '⬆️ New app version — install it to keep getting updates'),
    h('a', { class: 'btn mini', href: RELEASES }, 'Download'),
    h('button', { class: 'link', 'aria-label': 'Dismiss', onclick: () => b.remove() }, '✕'));
  document.getElementById('app')?.prepend(b);
}
