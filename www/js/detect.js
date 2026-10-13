// Finds the card in a photo (its 4 edges), straightens it, and picks the best
// match. This is what makes scanning work without perfect framing.
import { fingerprint, queryFingerprints, distance } from './fp.js';

const CARD_RATIO = 63 / 88;

// ---------- small image helpers ----------
function toCanvas(src, sx, sy, sw, sh, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}

function channels(data, w, h) {
  // gray + "colourfulness" so yellow/silver borders stand out even on a white desk
  const gray = new Float32Array(w * h), chroma = new Float32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const r = data[j], gg = data[j + 1], b = data[j + 2];
    gray[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
    chroma[i] = Math.max(r, gg, b) - Math.min(r, gg, b);
  }
  return [blur(gray, w, h), blur(chroma, w, h)];
}

function blur(a, w, h) {
  const k = [1, 4, 6, 4, 1], t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -2; i <= 2; i++) s += a[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + 2];
    t[y * w + x] = s / 16;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -2; i <= 2; i++) s += t[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + 2];
    o[y * w + x] = s / 16;
  }
  return o;
}

function gradients(chs, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (const a of chs) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const dx = (a[i - w + 1] + 2 * a[i + 1] + a[i + w + 1]) - (a[i - w - 1] + 2 * a[i - 1] + a[i + w - 1]);
      const dy = (a[i + w - 1] + 2 * a[i + w] + a[i + w + 1]) - (a[i - w - 1] + 2 * a[i - w] + a[i - w + 1]);
      if (Math.abs(dx) > Math.abs(gx[i])) gx[i] = dx;
      if (Math.abs(dy) > Math.abs(gy[i])) gy[i] = dy;
    }
  }
  return { gx, gy };
}

// ---------- line finding ----------
// For one side of the card, collect strong edge points along scan lines, then
// find straight lines through them (RANSAC). Lines are u = a*v + b where v runs
// along the edge and u across it.
function edgePoints(G, w, h, side, band, span) {
  const pts = [];
  const horiz = side === 'top' || side === 'bottom';
  const [v0, v1] = span, [u0, u1] = band;
  for (let v = Math.round(v0); v <= v1; v += 2) {
    // up to 3 strongest local maxima along this scan line
    const cand = [];
    for (let u = Math.max(2, Math.round(u0)); u <= Math.min((horiz ? h : w) - 3, u1); u++) {
      const g = Math.abs(horiz ? G.gy[u * w + v] : G.gx[v * w + u]);
      const gp = Math.abs(horiz ? G.gy[(u - 1) * w + v] : G.gx[v * w + u - 1]);
      const gn = Math.abs(horiz ? G.gy[(u + 1) * w + v] : G.gx[v * w + u + 1]);
      if (g >= gp && g >= gn && g > 25) cand.push([g, u]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    for (const [g, u] of cand.slice(0, 5)) pts.push({ u, v, g });
  }
  return pts;
}

function fitLine(pts) {
  let sv = 0, su = 0, svv = 0, svu = 0;
  for (const p of pts) { sv += p.v; su += p.u; svv += p.v * p.v; svu += p.v * p.u; }
  const n = pts.length, d = n * svv - sv * sv;
  if (!n || Math.abs(d) < 1e-6) return null;
  const a = (n * svu - sv * su) / d;
  return { a, b: (su - a * sv) / n };
}

function ransacLines(pts, count, tol = 1.6, iters = 160) {
  const lines = [];
  let pool = pts.slice();
  for (let k = 0; k < count && pool.length > 8; k++) {
    let best = null;
    for (let i = 0; i < iters; i++) {
      const p = pool[(Math.random() * pool.length) | 0], q = pool[(Math.random() * pool.length) | 0];
      if (Math.abs(p.v - q.v) < 10) continue;
      const a = (q.u - p.u) / (q.v - p.v);
      if (Math.abs(a) > 0.35) continue; // card edges are roughly straight-on
      const b = p.u - a * p.v;
      let s = 0;
      for (const r of pool) if (Math.abs(r.u - (a * r.v + b)) < tol) s += 1;
      if (!best || s > best.s) best = { a, b, s };
    }
    if (!best) break;
    const inl = pool.filter((r) => Math.abs(r.u - (best.a * r.v + best.b)) < tol);
    const f = fitLine(inl) || best;
    lines.push({ a: f.a, b: f.b, support: inl.length });
    pool = pool.filter((r) => Math.abs(r.u - (best.a * r.v + best.b)) >= tol * 2.5);
  }
  return lines;
}

function intersect(hl, vl) {
  // hl: y = a*x + b ; vl: x = c*y + d
  const y = (hl.a * vl.b + hl.b) / (1 - hl.a * vl.a);
  return { x: vl.a * y + vl.b, y };
}

/**
 * Looks for the card near the viewfinder frame.
 * Returns up to 3 candidate outlines [{tl,tr,br,bl}] in source pixels, best first.
 */
export function detectCard(src, frame, max = 3) {
  const sw = src.width || src.videoWidth, sh = src.height || src.videoHeight;
  const ex = frame.w * 0.3, ey = frame.h * 0.25;
  const rx = Math.max(0, frame.x - ex), ry = Math.max(0, frame.y - ey);
  const rw = Math.min(sw, frame.x + frame.w + ex) - rx, rh = Math.min(sh, frame.y + frame.h + ey) - ry;
  const W = 300, scale = W / rw, H = Math.round(rh * scale);
  const c = toCanvas(src, rx, ry, rw, rh, W, H);
  const data = c.getContext('2d').getImageData(0, 0, W, H).data;
  const G = gradients(channels(data, W, H), W, H);
  // expected frame position in work coordinates
  const fx0 = (frame.x - rx) * scale, fy0 = (frame.y - ry) * scale, fw = frame.w * scale, fh = frame.h * scale;
  const inX = fw * 0.36, inY = fh * 0.33;
  const spanX = [fx0 + fw * 0.12, fx0 + fw * 0.88], spanY = [fy0 + fh * 0.1, fy0 + fh * 0.9];
  const sides = {
    top: ransacLines(edgePoints(G, W, H, 'top', [2, fy0 + inY], spanX), 5),
    bottom: ransacLines(edgePoints(G, W, H, 'bottom', [fy0 + fh - inY, H - 3], spanX), 5),
    left: ransacLines(edgePoints(G, W, H, 'left', [2, fx0 + inX], spanY), 5),
    right: ransacLines(edgePoints(G, W, H, 'right', [fx0 + fw - inX, W - 3], spanY), 5),
  };
  const nX = (spanX[1] - spanX[0]) / 2, nY = (spanY[1] - spanY[0]) / 2;
  const pick = (arr, n) => arr.filter((l) => l.support > n * 0.25);
  const T = pick(sides.top, nX), B = pick(sides.bottom, nX), L = pick(sides.left, nY), R = pick(sides.right, nY);
  const quads = [];
  for (const t of T) for (const b of B) for (const l of L) for (const r of R) {
    const tl = intersect(t, l), tr = intersect(t, r), br = intersect(b, r), bl = intersect(b, l);
    const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y), wBot = Math.hypot(br.x - bl.x, br.y - bl.y);
    const hL = Math.hypot(bl.x - tl.x, bl.y - tl.y), hR = Math.hypot(br.x - tr.x, br.y - tr.y);
    const ww = (wTop + wBot) / 2, hh = (hL + hR) / 2;
    if (ww < fw * 0.45 || hh < fh * 0.45) continue;
    const ratioErr = Math.abs(Math.log((ww / hh) / CARD_RATIO));
    if (ratioErr > 0.2) continue;
    if (Math.abs(Math.log(wTop / wBot)) > 0.25 || Math.abs(Math.log(hL / hR)) > 0.25) continue;
    const support = (t.support + b.support) / (2 * nX) + (l.support + r.support) / (2 * nY);
    // prefer the outer lines (card edge) over inner ones (art box, text box)
    const size = (ww * hh) / (fw * fh);
    quads.push({ score: support * 1.0 - ratioErr * (globalThis.__RW ?? 4) + size * (globalThis.__SW ?? 0.6), pts: [tl, tr, br, bl] });
  }
  quads.sort((a, b) => b.score - a.score);
  const back = (p) => ({ x: rx + p.x / scale, y: ry + p.y / scale });
  return quads.slice(0, max).map((q) => {
    const [tl, tr, br, bl] = q.pts.map(back);
    return { tl, tr, br, bl };
  });
}

// ---------- straightening (perspective warp) ----------
function homography(dst) {
  // maps unit square (u,v in 0..1) to the quad
  const [p0, p1, p2, p3] = dst;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
  return {
    a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x,
    d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y, g, h,
  };
}

/** Returns a straightened, card-shaped canvas (outW × outH) of the outline q. */
export function warpCard(src, q, outW = 252, outH = 352, inset = 0) {
  const pts = [q.tl, q.tr, q.br, q.bl];
  const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))) - 2);
  const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))) - 2);
  const maxX = Math.min(src.width || src.videoWidth, Math.ceil(Math.max(...pts.map((p) => p.x))) + 2);
  const maxY = Math.min(src.height || src.videoHeight, Math.ceil(Math.max(...pts.map((p) => p.y))) + 2);
  // read the source area at a resolution close to the output
  const s = Math.min(1, (outH * 1.5) / Math.max(1, maxY - minY));
  const cw = Math.max(1, Math.round((maxX - minX) * s)), ch = Math.max(1, Math.round((maxY - minY) * s));
  const sc = toCanvas(src, minX, minY, maxX - minX, maxY - minY, cw, ch);
  const sd = sc.getContext('2d').getImageData(0, 0, cw, ch).data;
  const H = homography(pts.map((p) => ({ x: (p.x - minX) * s, y: (p.y - minY) * s })));
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const og = out.getContext('2d');
  const od = og.createImageData(outW, outH);
  for (let y = 0; y < outH; y++) {
    const v = inset + (1 - 2 * inset) * ((y + 0.5) / outH);
    for (let x = 0; x < outW; x++) {
      const u = inset + (1 - 2 * inset) * ((x + 0.5) / outW);
      const z = H.g * u + H.h * v + 1;
      const X = (H.a * u + H.b * v + H.c) / z, Y = (H.d * u + H.e * v + H.f) / z;
      const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
      const o = (y * outW + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= cw - 1 || y0 >= ch - 1) { od.data[o] = od.data[o + 1] = od.data[o + 2] = 128; od.data[o + 3] = 255; continue; }
      const i00 = (y0 * cw + x0) * 4, i10 = i00 + 4, i01 = i00 + cw * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        od.data[o + k] = (sd[i00 + k] * (1 - fx) + sd[i10 + k] * fx) * (1 - fy) + (sd[i01 + k] * (1 - fx) + sd[i11 + k] * fx) * fy;
      }
      od.data[o + 3] = 255;
    }
  }
  og.putImageData(od, 0, 0);
  return out;
}

// ---------- careful comparison of a few finalists ----------
const DW = 40, DH = 56;
function dense(src) {
  // small grayscale + colour picture, each normalised for lighting
  const c = toCanvas(src, 0, 0, src.width, src.height, DW, DH);
  const d = c.getContext('2d').getImageData(0, 0, DW, DH).data;
  const g = new Float32Array(DW * DH), col = new Float32Array(DW * DH * 2);
  for (let i = 0, j = 0; i < DW * DH; i++, j += 4) {
    const r = d[j], gg = d[j + 1], b = d[j + 2];
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
    const s = r + gg + b + 1;
    col[i * 2] = r / s; col[i * 2 + 1] = gg / s;
  }
  return { g, col };
}

function ncc(a, b, y0, y1) {
  let sa = 0, sb = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 2; x < DW - 2; x++) { const i = y * DW + x; sa += a[i]; sb += b[i]; n++; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let y = y0; y < y1; y++) for (let x = 2; x < DW - 2; x++) {
    const i = y * DW + x, p = a[i] - ma, q = b[i] - mb;
    num += p * q; da += p * p; db += q * q;
  }
  return num / Math.sqrt(da * db + 1e-6);
}

function colorDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function similarity(q, c) {
  const art = ncc(q.g, c.g, Math.round(DH * 0.1), Math.round(DH * 0.53));
  const full = ncc(q.g, c.g, 2, DH - 2);
  return 0.55 * art + 0.45 * full - 4 * colorDiff(q.col, c.col);
}

/**
 * Full matching pipeline.
 * fps: Map(key -> fingerprint). opts.getImage(key) -> image/bitmap of a card (for the final check), optional.
 * Returns [{key, score, sim}] best first (lower score = better).
 */
export async function matchPhoto(src, frame, fps, opts = {}) {
  const allowed = opts.allowed || (() => true);
  // 1. candidate pictures of the card: straightened outlines + plain frame crops
  const views = [];
  let outlines = [];
  try { outlines = detectCard(src, frame, opts.outlines || 12); } catch { /* fall back to the frame */ }
  outlines.forEach((q, i) => {
    views.push({ c: warpCard(src, q) });
    if (i < 3) views.push({ c: warpCard(src, q, 252, 352, 0.02) });
  });
  const frameCanvas = toCanvas(src, frame.x, frame.y, frame.w, frame.h, 252, 352);
  views.push({ c: frameCanvas, w: 1 });
  // 2. quick shortlist with fingerprints
  const queries = views.map((v) => fingerprint(v.c));
  for (const f of queryFingerprints(src, frame)) queries.push(f);
  const best = new Map();
  for (const [key, f] of fps) {
    if (!allowed(key)) continue;
    let d = Infinity;
    for (const q of queries) { const x = distance(q, f); if (x < d) d = x; }
    if (best.size < 40) best.set(key, d);
    else {
      let worstK = null, worst = -1;
      for (const [k, v] of best) if (v > worst) { worst = v; worstK = k; }
      if (d < worst) { best.delete(worstK); best.set(key, d); }
    }
  }
  let ranked = [...best].map(([key, score]) => ({ key, score })).sort((a, b) => a.score - b.score);
  // 3. careful check of the finalists against their actual pictures
  if (opts.getImage) {
    const qd = views.map((v) => dense(v.c));
    const finalists = ranked.slice(0, opts.finalists || 16);
    await Promise.all(finalists.map(async (m) => {
      try {
        const img = await opts.getImage(m.key);
        if (!img) return;
        const cd = dense(img);
        let s = -Infinity;
        for (const q of qd) s = Math.max(s, similarity(q, cd));
        m.sim = s;
      } catch { /* no picture */ }
    }));
    const withSim = finalists.filter((m) => m.sim != null);
    if (withSim.length) {
      withSim.sort((a, b) => b.sim - a.sim);
      const rest = ranked.filter((m) => m.sim == null);
      ranked = [...withSim, ...rest];
    }
  }
  return ranked.slice(0, opts.limit || 12);
}
