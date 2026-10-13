// Scanner: live camera with a card-shaped frame, or pick a photo from the gallery.
// The photo is matched against card images saved on the phone (works offline).
import { h, icon, pushBack, toast, cardArt, langBadge, chips, chooseDialog } from '../ui.js';
import { state, changeOwned, qty, VARIANTS } from '../store.js';
import { loadFingerprints, updateScanData, scanDataStale } from '../sync.js';
import { queryFingerprints, bestMatches, confidence } from '../fp.js';
import { LANGS, online } from '../api.js';
import { openCard } from './card.js';
import { openPicker } from './search.js';

let open = false;

export async function openScanner() {
  if (open) return;
  open = true;
  let stream = null, track = null, torch = false, sessionAdded = 0;
  let scope = state.settings.scanLangs?.length ? state.settings.scanLangs.filter((l) => state.settings.langs.includes(l)) : [];
  if (!scope.length) scope = 'all';

  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
  video.setAttribute('playsinline', ''); video.muted = true;
  const still = h('canvas', { class: 'scan-still', hidden: true });
  const frame = h('div', { class: 'scan-frame' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }));
  const hint = h('div', { class: 'scan-hint' }, 'Line the card up with the frame');
  const status = h('div', { class: 'scan-status' });
  const tally = h('span', { class: 'scan-tally', hidden: true });
  const results = h('div', { class: 'scan-results', hidden: true });
  const torchBtn = h('button', { class: 'scan-icon', 'aria-label': 'Torch', hidden: true, onclick: toggleTorch }, icon('flash'));
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: onFile });

  const langOpts = [{ value: 'all', label: 'All' }, ...state.settings.langs.map((l) => ({ value: l, label: LANGS[l].short }))];
  const scopeChips = chips(langOpts, scope === 'all' ? 'all' : scope[0], (v) => { scope = v === 'all' ? 'all' : [v]; updateStatus(); });

  const root = h('div', { class: 'scanner' },
    video, still,
    h('div', { class: 'scan-shade' }),
    frame, hint,
    h('div', { class: 'scan-top' },
      h('button', { class: 'scan-icon', 'aria-label': 'Close scanner', onclick: close }, icon('close')),
      h('div', { class: 'scan-title' }, 'Scan a card', tally),
      torchBtn),
    h('div', { class: 'scan-scope' }, scopeChips, status),
    h('div', { class: 'scan-bottom' },
      h('button', { class: 'scan-icon labeled', onclick: () => fileInput.click() }, icon('image'), h('small', {}, 'Photo')),
      h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: capture }),
      h('button', { class: 'scan-icon labeled', onclick: manual }, icon('search'), h('small', {}, 'Search'))),
    results, fileInput);
  document.body.append(root);
  const removeBack = pushBack(() => close(true));
  requestAnimationFrame(() => root.classList.add('open'));
  updateStatus();
  startCamera();

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

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { noCamera('This phone’s camera can’t be opened here. Use “Photo” instead.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (!open) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() || {};
      if (caps.torch) torchBtn.hidden = false;
      if (caps.focusMode?.includes?.('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    } catch (e) {
      noCamera(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your phone’s settings, or use “Photo”.' : 'Couldn’t start the camera. Use “Photo” instead.');
    }
  }

  function noCamera(msg) { hint.textContent = msg; hint.classList.add('warn'); }

  async function toggleTorch() {
    torch = !torch;
    try { await track.applyConstraints({ advanced: [{ torch }] }); torchBtn.classList.toggle('on', torch); } catch { /* unsupported */ }
  }

  // Where the frame sits, in the video's own pixels (video uses object-fit: cover)
  function frameRectInVideo() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2, offY = (vr.height - vh * scale) / 2;
    return { x: (fr.left - vr.left - offX) / scale, y: (fr.top - vr.top - offY) / scale, w: fr.width / scale, h: fr.height / scale };
  }

  async function capture() {
    if (!video.videoWidth) { toast('Camera not ready — try “Photo” instead'); return; }
    still.width = video.videoWidth; still.height = video.videoHeight;
    still.getContext('2d').drawImage(video, 0, 0);
    root.classList.add('flash');
    setTimeout(() => root.classList.remove('flash'), 180);
    const r = frameRectInVideo();
    showStill();
    await runMatch(still, r);
  }

  function showStill() {
    // Show the frozen frame exactly where the video was
    still.hidden = false;
    video.pause();
  }
  function resume() {
    still.hidden = true;
    results.hidden = true;
    root.classList.remove('has-results');
    video.play().catch(() => {});
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
    const queries = queryFingerprints(src, rect);
    const matches = bestMatches(queries, fps, 12, (k) => allowed(k) && state.cards.has(k));
    showResults(matches, matches[0], src, rect);
  }

  function showResults(matches, chosen, src, rect, message) {
    results.hidden = false;
    root.classList.add('has-results');
    results.innerHTML = '';
    const actions = h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: resume }, 'Retake'),
      h('button', { class: 'btn', onclick: () => adjust(src, rect) }, 'Adjust crop'),
      h('button', { class: 'btn', onclick: manual }, 'Search'));
    if (message || !chosen) {
      results.append(h('p', { class: 'pad' }, message || 'No match found.'), actions);
      return;
    }
    const card = state.cards.get(chosen.key);
    const set = state.sets.get(card.setKey);
    const conf = confidence(chosen.score);
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
      matches.length > 1 ? h('div', { class: 'muted small' }, 'Not it? Other close matches:') : null,
      h('div', { class: 'match-strip' }, matches.filter((m) => m.key !== chosen.key).map((m) => {
        const c = state.cards.get(m.key);
        return h('button', { class: 'match-alt', onclick: () => showResults(matches, m, src, rect) },
          cardArt(c), h('small', {}, `${LANGS[c.lang]?.short} #${c.localId}`));
      })),
      actions);
  }

  async function add(card, variant) {
    await changeOwned(card.key, variant, 1);
    sessionAdded++;
    tally.hidden = false;
    tally.textContent = ` · ${sessionAdded} added`;
    toast(`Added ${card.name} ✓`);
    if (state.settings.scanContinuous) resume();
    else { results.innerHTML = ''; results.append(h('p', { class: 'pad' }, `${card.name} added. `), h('button', { class: 'btn primary wide', onclick: resume }, 'Scan next card')); }
  }

  function manual() {
    openPicker({
      title: 'Find the card', multi: false,
      onPick: async (c) => { await add(c, 'normal'); },
    });
  }

  async function onFile() {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(f));
      const max = 2000, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = h('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      adjust(c, null);
    } catch { toast('Couldn’t open that photo'); }
  }

  /** Lets you drag/zoom a photo so the card sits inside the frame. */
  function adjust(src, rect) {
    video.pause();
    const stage = h('div', { class: 'adjust' });
    const img = h('canvas', { class: 'adjust-img' });
    img.width = src.width; img.height = src.height;
    img.getContext('2d').drawImage(src, 0, 0);
    const box = h('div', { class: 'scan-frame static' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }));
    const zoom = h('input', { type: 'range', min: 0.2, max: 6, step: 0.01, class: 'zoom-range', 'aria-label': 'Zoom' });
    stage.append(img, h('div', { class: 'scan-shade' }), box,
      h('div', { class: 'adjust-bar' },
        h('div', { class: 'muted small center' }, 'Drag and pinch so the card fills the frame'),
        zoom,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => { stage.remove(); removeAdjBack(); resume(); } }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: find }, 'Find card'))));
    root.append(stage);
    const removeAdjBack = pushBack(() => { stage.remove(); resume(); });

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
    stream?.getTracks().forEach((t) => t.stop());
    root.classList.remove('open');
    setTimeout(() => root.remove(), 250);
  }
}
