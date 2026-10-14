// "What's new": shows the changelog (www/changelog.json) after an update.
import { h, sheet } from './ui.js';

const SEEN = 'whatsnew.seen';
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } },
};

async function load() {
  try {
    const r = await fetch(new URL('../changelog.json', import.meta.url));
    return r.ok ? await r.json() : [];
  } catch { return []; }
}

function show(entries, title = 'What’s new') {
  sheet({
    title,
    content: (b) => {
      for (const e of entries) {
        b.append(
          h('h3', { class: 'section-title' }, e.title, h('small', { class: 'muted' }, `  ${e.date}`)),
          h('ul', { class: 'whatsnew' }, (e.items || []).map((x) => h('li', {}, x))));
      }
      if (!entries.length) b.append(h('p', { class: 'muted' }, 'No notes yet.'));
    },
  });
}

/** After an update: show the notes you haven't seen yet (first run just remembers where you are). */
export async function maybeShowWhatsNew() {
  const log = await load();
  if (!log.length) return;
  const seen = ls.get(SEEN);
  ls.set(SEEN, log[0].id);
  if (!seen) {
    // First time this feature runs: show the latest notes once
    show(log.slice(0, 1));
    return;
  }
  const i = log.findIndex((e) => e.id === seen);
  const fresh = i < 0 ? log.slice(0, 3) : log.slice(0, i);
  if (fresh.length) show(fresh);
}

/** Settings → What's new: the whole list. */
export async function showAllWhatsNew() {
  show(await load(), 'What’s new');
}
