// Scanner: takes a photo with the phone's camera app (or uploads one), centres
// the card in a frame you can adjust, then finds the matching card.
import { h, icon, pushBack, toast, cardArt, langBadge, chips, chooseDialog } from '../ui.js';
import { state, changeOwned, qty, VARIANTS } from '../store.js';
import { loadFingerprints, updateScanData, scanDataStale } from '../sync.js';
import { confidence } from '../fp.js';
import { matchPhoto, findCardAnywhere } from '../detect.js';
import * as db from '../db.js';
import { LANGS, online, cardImg } from '../api.js';
import { openCard } from './card.js';
import { openPicker } from './search.js';

let open = false;

export async function openScanner() {
  if (open) return;
  open = true;
  let sessionAdded = 0;
  let scope = state.settings.scanLangs?.length ? state.settings.scanLangs.filter((l) => state.settings.langs.includes(l)) : [];
  if (!scope.length) scope = 'all';

  const still = h('canvas', { class: 'scan-still', hidden: true });
  const status = h('div', { class: 'scan-status' });
  const tally = h('span', { class: 'scan-tally', hidden: true });
  const results = h('div', { class: 'scan-results', hidden: true });
  // The phone's own camera app (sharp focus on every phone) and the gallery
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => onFile(e.target) });
  const uploadInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => onFile(e.target) });
  const takePhoto = () => cameraInput.click();
  const upload = () => uploadInput.click();

  const langOpts = [{ value: 'all', label: 'All' }, ...state.settings.langs.map((l) => ({ value: l, label: LANGS[l].short }))];
  const scopeChips = chips(langOpts, scope === 'all' ? 'all' : scope[0], (v) => { scope = v === 'all' ? 'all' : [v]; updateStatus(); });

  const landing = h('div', { class: 'scan-landing' },
    h('div', { class: 'ball spin-slow' }),
    h('p', {}, 'Take a photo of your card, or upload one. You can recentre it before it’s matched.'),
    h('button', { class: 'btn primary wide big', onclick: takePhoto }, icon('camera', 20), ' Take photo'),
    h('button', { class: 'btn wide big', onclick: upload }, icon('image', 20), ' Upload photo'),
    h('button', { class: 'btn ghost wide', onclick: () => manual() }, icon('search', 18), ' Search by name instead'));

  const root = h('div', { class: 'scanner' },
    still,
    h('div', { class: 'scan-top' },
      h('button', { class: 'scan-icon', 'aria-label': 'Close scanner', onclick: () => close() }, icon('close')),
      h('div', { class: 'scan-title' }, 'Scan a card', tally),
      h('span', { style: { width: '46px' } })),
    h('div', { class: 'scan-scope' }, scopeChips, status),
    landing, results, cameraInput, uploadInput);
  document.body.append(root);
  const removeBack = pushBack(() => close(true));
  requestAnimationFrame(() => root.classList.add('open'));
  // Go straight to the camera
  takePhoto();
  updateStatus();

  let preparing = false;
  async function updateStatus() {
    const fps = await loadFingerprints();
    let n = 0;
    for (const k of fps.keys()) if (allowed(k) && state.cards.has(k)) n++;
    status.classList.remove('warn');
    // First scan (or weekly check): fetch the small scan data file
    if (online() && !preparing && (!n || await scanDataStale())) {
      preparing = true;
      status.innerHTML = '';
      status.append(h('span', { class: 'mini-ball spin' }), ' Getting scan data…');
      try { await updateScanData(); } catch { /* not available yet */ }
      return updateStatus();
    }
    if (n) status.textContent = `Can recognise ${n.toLocaleString()} cards`;
    else {
      status.textContent = online() ? 'Scan data isn’t ready yet — use Search, or try again later' : 'Connect to the internet once to set up scanning';
      status.classList.add('warn');
    }
  }

  function allowed(key) {
    const lang = key.slice(0, key.indexOf(':'));
    if (!state.settings.langs.includes(lang)) return false;
    return scope === 'all' || scope.includes(lang);
  }

  function showStill() { still.hidden = false; landing.hidden = true; }
  function backToStart() {
    still.hidden = true;
    results.hidden = true;
    root.classList.remove('has-results');
    landing.hidden = false;
  }

  // A photo arrived (camera or upload): find the card, centre it in the frame, let you adjust
  async function onFile(input) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    landing.hidden = true;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(f));
      const max = 2000, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = h('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      results.hidden = false; results.innerHTML = '';
      results.append(h('div', { class: 'scan-wait' }, h('span', { class: 'mini-ball spin' }), 'Finding the card…'));
      await new Promise((r) => setTimeout(r, 40));
      adjust(c, autoCentre(c));
    } catch { toast('Couldn’t open that photo'); backToStart(); }
  }

  /** Where the card probably is: its detected outline (slightly padded), or the middle of the photo. */
  function autoCentre(c) {
    const fw = Math.min(c.width * 0.8, c.height * 0.8 * (63 / 88)), fh = fw * (88 / 63);
    const guess = { x: (c.width - fw) / 2, y: (c.height - fh) / 2, w: fw, h: fh };
    try {
      const q = findCardAnywhere(c);
      if (!q) return guess;
      const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      let w = (Math.max(...xs) - Math.min(...xs)) * 1.04, hh = (Math.max(...ys) - Math.min(...ys)) * 1.04;
      // keep the card shape
      if (w / hh > 63 / 88) hh = w * 88 / 63; else w = hh * 63 / 88;
      return { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
    } catch { return guess; }
  }

  async function runMatch(src, rect) {
    const fps = await loadFingerprints();
    const pool = [...fps.keys()].filter((k) => allowed(k) && state.cards.has(k));
    if (!pool.length) {
      showResults([], null, src, rect, online()
        ? 'Scan data isn’t ready yet, so there’s nothing to compare with. Tap “Search” to find the card by name.'
        : 'Scanning needs a one-time download of scan data. Connect to the internet and open the scanner again, or tap “Search”.');
      return;
    }
    results.hidden = false;
    root.classList.add('has-results');
    results.innerHTML = '';
    results.append(h('div', { class: 'scan-wait' }, h('span', { class: 'mini-ball spin' }), 'Looking for a match…'));
    await new Promise((r) => setTimeout(r, 30));
    // Finds the card's edges, straightens it, shortlists with fingerprints,
    // then double-checks the finalists against their pictures.
    const matches = await matchPhoto(src, rect, fps, {
      allowed: (k) => allowed(k) && state.cards.has(k),
      getImage: cardBitmap,
      finalists: online() ? 16 : 10,
    });
    showResults(matches, matches[0], src, rect);
  }

  async function cardBitmap(key) {
    let blob = (await db.get('images', key)) || (await db.get('imgcache', key))?.b;
    if (!blob && online()) {
      const card = state.cards.get(key);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(cardImg(card, 'low'), { signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) { blob = await r.blob(); db.put('imgcache', { b: blob, t: Date.now() }, key).catch(() => {}); }
      } catch { /* can't check this one */ }
    }
    return blob ? createImageBitmap(blob) : null;
  }

  function showResults(matches, chosen, src, rect, message) {
    results.hidden = false;
    root.classList.add('has-results');
    results.innerHTML = '';
    const actions = h('div', {},
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { backToStart(); takePhoto(); } }, icon('camera', 16), ' Retake'),
        h('button', { class: 'btn', onclick: () => adjust(src, rect) }, 'Recentre'),
        h('button', { class: 'btn', onclick: () => { backToStart(); upload(); } }, 'Upload'),
        h('button', { class: 'btn', onclick: manual }, 'Search')),
      h('button', { class: 'btn ghost wide', onclick: () => addNew(src, rect) }, '＋ Not listed? Add it as a new card'));
    if (message || !chosen) {
      results.append(h('p', { class: 'pad' }, message || 'No match found.'), actions);
      return;
    }
    const card = state.cards.get(chosen.key);
    const set = state.sets.get(card.setKey);
    const conf = chosen.sim != null
      ? (chosen.sim > 0.55 ? { label: 'Strong match', cls: 'good' } : chosen.sim > 0.35 ? { label: 'Possible match', cls: 'ok' } : { label: 'Weak match', cls: 'weak' })
      : confidence(chosen.score);
    const others = matches.filter((m) => m.key !== chosen.key);
    const versions = others.filter((m) => state.cards.get(m.key)?.name === card.name);
    const close = others.filter((m) => state.cards.get(m.key)?.name !== card.name);
    const strip = (list) => h('div', { class: 'match-strip' }, list.map((m) => {
      const c = state.cards.get(m.key);
      const st = state.sets.get(c.setKey);
      return h('button', { class: 'match-alt', onclick: () => showResults(matches, m, src, rect) },
        cardArt(c), h('small', {}, `${LANGS[c.lang]?.short} #${c.localId}`), h('small', { class: 'alt-set' }, st?.name || ''));
    }));
    const owned = qty(card.key);
    results.append(
      h('div', { class: 'match-main' },
        h('button', { class: 'match-art', onclick: () => openCard(card.key) }, cardArt(card)),
        h('div', { class: 'match-info' },
          h('span', { class: `conf ${conf.cls}` }, conf.label),
          h('b', {}, card.name),
          h('small', {}, set?.name || '', ` · #${card.localId}`),
          h('div', {}, langBadge(card.lang), owned ? h('span', { class: 'pill good' }, ` Owned ×${owned}`) : null),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', onclick: () => add(card, 'normal') }, icon('plus', 18), ' Add'),
            h('button', { class: 'btn', onclick: async () => {
              const v = await chooseDialog('Add which version?', VARIANTS.map(([value, label]) => ({ value, label })));
              if (v) add(card, v);
            } }, 'Add as…')))),
      versions.length ? h('div', { class: 'small strip-title' }, `Other versions of ${card.name} — check the set and foil:`) : null,
      versions.length ? strip(versions) : null,
      close.length ? h('div', { class: 'muted small strip-title' }, 'Not it? Other close matches:') : null,
      close.length ? strip(close) : null,
      actions);
  }

  async function add(card, variant) {
    // Open the camera for the next card straight away (needs to happen during the tap)
    if (state.settings.scanContinuous) { backToStart(); takePhoto(); }
    await changeOwned(card.key, variant, 1);
    sessionAdded++;
    tally.hidden = false;
    tally.textContent = ` · ${sessionAdded} added`;
    toast(`Added ${card.name} ✓`);
    if (!state.settings.scanContinuous) {
      results.innerHTML = '';
      results.append(h('p', { class: 'pad' }, `${card.name} added.`), h('button', { class: 'btn primary wide', onclick: () => { backToStart(); takePhoto(); } }, icon('camera', 18), ' Scan next card'));
    }
  }

  async function addNew(src, rect) {
    const { openAddCard } = await import('./addcard.js');
    const { cropCard } = await import('../custom.js');
    let photo = null;
    try { photo = cropCard(src, rect); } catch { /* no photo */ }
    const lang = scope !== 'all' ? scope[0] : undefined;
    openAddCard({ photo, lang, onDone: (card) => { if (card) { sessionAdded++; tally.hidden = false; tally.textContent = ` · ${sessionAdded} added`; backToStart(); } } });
  }

  function manual() {
    openPicker({
      title: 'Find the card', multi: false,
      onPick: async (c) => { await add(c, 'normal'); },
    });
  }

  /** Lets you drag/zoom a photo so the card sits inside the frame. */
  function adjust(src, rect) {
    landing.hidden = true;
    results.hidden = true;
    root.classList.remove('has-results');
    const stage = h('div', { class: 'adjust' });
    const img = h('canvas', { class: 'adjust-img' });
    img.width = src.width; img.height = src.height;
    img.getContext('2d').drawImage(src, 0, 0);
    const box = h('div', { class: 'scan-frame static' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }));
    const zoom = h('input', { type: 'range', min: 0.2, max: 6, step: 0.01, class: 'zoom-range', 'aria-label': 'Zoom' });
    stage.append(img, h('div', { class: 'scan-shade' }), box,
      h('div', { class: 'adjust-bar' },
        h('div', { class: 'muted small center' }, 'Drag and pinch to centre the card in the frame'),
        zoom,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => { stage.remove(); removeAdjBack(); backToStart(); takePhoto(); } }, icon('camera', 16), ' Retake'),
          h('button', { class: 'btn primary', onclick: find }, 'Find card'))));
    root.append(stage);
    const removeAdjBack = pushBack(() => { stage.remove(); backToStart(); });

    let t = { x: 0, y: 0, s: 1 };
    requestAnimationFrame(() => {
      const fr = box.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      if (rect) {
        // Put the previous crop back inside the frame
        t.s = fr.width / rect.w;
        t.x = fr.left - sr.left - rect.x * t.s;
        t.y = fr.top - sr.top - rect.y * t.s;
      } else {
        // Start with the photo covering the frame, centred on it
        t.s = Math.max(fr.width / src.width, fr.height / src.height);
        t.x = fr.left - sr.left + (fr.width - src.width * t.s) / 2;
        t.y = fr.top - sr.top + (fr.height - src.height * t.s) / 2;
      }
      zoom.min = String(t.s * 0.3); zoom.max = String(t.s * 8); zoom.value = String(t.s);
      apply();
    });
    function apply() { img.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.s})`; }
    zoom.addEventListener('input', () => {
      const sr = stage.getBoundingClientRect();
      zoomAt(+zoom.value, sr.width / 2, sr.height / 2);
    });
    function zoomAt(ns, cx, cy) {
      t.x = cx - ((cx - t.x) * ns) / t.s;
      t.y = cy - ((cy - t.y) * ns) / t.s;
      t.s = ns; apply();
    }
    const pts = new Map();
    let last = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.adjust-bar')) return;
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = snapshot();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = snapshot();
      if (last && now.n === last.n) {
        const sr = stage.getBoundingClientRect();
        if (now.n === 2 && last.d > 0) zoomAt(Math.max(+zoom.min, Math.min(+zoom.max, t.s * (now.d / last.d))), now.cx - sr.left, now.cy - sr.top);
        t.x += now.cx - last.cx; t.y += now.cy - last.cy;
        apply(); zoom.value = String(t.s);
      }
      last = now;
    });
    const up = (e) => { pts.delete(e.pointerId); last = snapshot(); };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    function snapshot() {
      const p = [...pts.values()];
      if (!p.length) return null;
      const cx = p.reduce((a, b) => a + b.x, 0) / p.length, cy = p.reduce((a, b) => a + b.y, 0) / p.length;
      const d = p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
      return { n: p.length, cx, cy, d };
    }

    async function find() {
      const fr = box.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      const r = { x: (fr.left - sr.left - t.x) / t.s, y: (fr.top - sr.top - t.y) / t.s, w: fr.width / t.s, h: fr.height / t.s };
      // Copy into the still view so results show over it
      still.width = src.width; still.height = src.height;
      still.getContext('2d').drawImage(src, 0, 0);
      stage.remove(); removeAdjBack();
      showStill();
      // Clamp to the photo so all crop variants fit
      const pad = (canvas) => {
        if (r.x >= 0 && r.y >= 0 && r.x + r.w <= canvas.width && r.y + r.h <= canvas.height) return [canvas, r];
        const c = h('canvas'); const m = Math.ceil(Math.max(r.w, r.h) * 0.2);
        c.width = canvas.width + 2 * m + Math.ceil(Math.max(0, -r.x) + Math.max(0, r.x + r.w - canvas.width));
        c.height = canvas.height + 2 * m + Math.ceil(Math.max(0, -r.y) + Math.max(0, r.y + r.h - canvas.height));
        const ox = m + Math.max(0, -r.x), oy = m + Math.max(0, -r.y);
        const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, ox, oy);
        return [c, { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }];
      };
      const [cv, rr] = pad(src);
      await runMatch(cv, rr);
    }
  }

  function close(fromBack) {
    if (!open) return;
    open = false;
    if (!fromBack) removeBack();
    root.classList.remove('open');
    setTimeout(() => root.remove(), 250);
  }
}
