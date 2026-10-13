// Image "fingerprints" for scanning. Each downloaded card image gets a small
// fingerprint (70 bytes). A photo of a card is fingerprinted the same way and
// compared against every saved card to find the closest matches — no internet needed.

const W = 128, H = 178;           // working size (card aspect ≈ 63 × 88 mm)
const ART = { x: 0.08, y: 0.10, w: 0.84, h: 0.42 }; // where the artwork usually sits
export const FP_LEN = 70;
export const FP_VERSION = 1; // bump if the fingerprint maths changes (scan data gets rebuilt)

let work = null, wctx = null;
function workCanvas() {
  if (!work) {
    work = document.createElement('canvas');
    work.width = W; work.height = H;
    wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = 'high';
  }
  return wctx;
}

// Two-step downscale for better quality on big photos.
let mid = null, mctx = null;
function drawScaled(src, sx, sy, sw, sh) {
  const ctx = workCanvas();
  if (sw > W * 3) {
    if (!mid) { mid = document.createElement('canvas'); mid.width = W * 3; mid.height = H * 3; mctx = mid.getContext('2d'); mctx.imageSmoothingQuality = 'high'; }
    mctx.clearRect(0, 0, mid.width, mid.height);
    mctx.drawImage(src, sx, sy, sw, sh, 0, 0, mid.width, mid.height);
    ctx.drawImage(mid, 0, 0, W, H);
  } else {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  }
  return ctx.getImageData(0, 0, W, H).data;
}

function box(data, rx, ry, rw, rh, ow, oh, rgb) {
  const x0 = Math.round(rx * W), y0 = Math.round(ry * H);
  const bw = (rw * W) / ow, bh = (rh * H) / oh;
  const out = new Float32Array(ow * oh * (rgb ? 3 : 1));
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
    const xs = Math.floor(x0 + ox * bw), xe = Math.max(xs + 1, Math.floor(x0 + (ox + 1) * bw));
    const ys = Math.floor(y0 + oy * bh), ye = Math.max(ys + 1, Math.floor(y0 + (oy + 1) * bh));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = ys; y < ye && y < H; y++) for (let x = xs; x < xe && x < W; x++) {
      const i = (y * W + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    n = n || 1;
    const o = oy * ow + ox;
    if (rgb) { out[o * 3] = r / n; out[o * 3 + 1] = g / n; out[o * 3 + 2] = b / n; }
    else out[o] = (0.299 * r + 0.587 * g + 0.114 * b) / n;
  }
  return out;
}

const N = 32;
const COS = (() => {
  const t = new Float32Array(9 * N);
  for (let u = 0; u < 9; u++) for (let x = 0; x < N; x++) t[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  return t;
})();

function phash(gray) {
  // Low-frequency DCT coefficients (1..8 × 1..8) compared with their median
  const rows = new Float32Array(9 * N); // partial DCT along x
  for (let y = 0; y < N; y++) for (let u = 1; u < 9; u++) {
    let s = 0;
    for (let x = 0; x < N; x++) s += gray[y * N + x] * COS[u * N + x];
    rows[u * N + y] = s;
  }
  const coefs = [];
  for (let v = 1; v < 9; v++) for (let u = 1; u < 9; u++) {
    let s = 0;
    for (let y = 0; y < N; y++) s += rows[u * N + y] * COS[v * N + y];
    coefs.push(s);
  }
  const med = [...coefs].sort((a, b) => a - b)[32];
  const out = new Uint8Array(8);
  coefs.forEach((c, i) => { if (c > med) out[i >> 3] |= 1 << (i & 7); });
  return out;
}

/** Fingerprint of the card inside rectangle (sx,sy,sw,sh) of an image/canvas/bitmap. */
export function fingerprint(src, sx = 0, sy = 0, sw, sh) {
  sw = sw ?? (src.width || src.videoWidth);
  sh = sh ?? (src.height || src.videoHeight);
  const data = drawScaled(src, sx, sy, sw, sh);
  const fp = new Uint8Array(FP_LEN);
  fp.set(phash(box(data, 0, 0, 1, 1, N, N, false)), 0);
  fp.set(phash(box(data, ART.x, ART.y, ART.w, ART.h, N, N, false)), 8);
  const c1 = box(data, ART.x, ART.y, ART.w, ART.h, 4, 3, true); // 36 values
  const c2 = box(data, 0, 0, 1, 1, 3, 2, true);                  // 18 values
  const all = [...c1, ...c2];
  const mean = all.reduce((a, b) => a + b, 0) / all.length || 1;
  all.forEach((v, i) => { fp[16 + i] = Math.max(0, Math.min(255, Math.round((v * 128) / mean))); });
  return fp;
}

export async function fingerprintBlob(blob) {
  const bmp = await createImageBitmap(blob);
  try { return fingerprint(bmp); } finally { bmp.close?.(); }
}

const POP = new Uint8Array(256).map((_, i) => { let c = 0, n = i; while (n) { c += n & 1; n >>= 1; } return c; });

export function distance(a, b) {
  let h1 = 0, h2 = 0, col = 0;
  for (let i = 0; i < 8; i++) h1 += POP[a[i] ^ b[i]];
  for (let i = 8; i < 16; i++) h2 += POP[a[i] ^ b[i]];
  for (let i = 16; i < FP_LEN; i++) col += Math.abs(a[i] - b[i]);
  return h1 + 1.5 * h2 + (col / 54) * 0.35;
}

/** A few slightly different crops, so small framing errors still match. */
export function queryFingerprints(src, rect) {
  const out = [];
  const sw = src.width || src.videoWidth, sh = src.height || src.videoHeight;
  const variants = [[0, 0, 0], [0.04, 0, 0], [0.08, 0, 0], [-0.03, 0, 0], [0.04, 0.02, 0], [0.04, -0.02, 0], [0.04, 0, 0.02], [0.04, 0, -0.02]];
  for (const [inset, dx, dy] of variants) {
    const w = rect.w * (1 - 2 * inset), h = rect.h * (1 - 2 * inset);
    const x = rect.x + rect.w * inset + rect.w * dx, y = rect.y + rect.h * inset + rect.h * dy;
    if (x < 0 || y < 0 || x + w > sw || y + h > sh) continue;
    out.push(fingerprint(src, x, y, w, h));
  }
  return out;
}

/** Returns the best `limit` matches: [{key, score}] (lower score = closer). */
export function bestMatches(queries, fps, limit = 12, allowed = null) {
  const best = [];
  for (const [key, fp] of fps) {
    if (allowed && !allowed(key)) continue;
    let d = Infinity;
    for (const q of queries) { const v = distance(q, fp); if (v < d) d = v; }
    if (best.length < limit || d < best[best.length - 1].score) {
      best.push({ key, score: d });
      best.sort((a, b) => a.score - b.score);
      if (best.length > limit) best.pop();
    }
  }
  return best;
}

/** Turns a score into a rough confidence label. */
export function confidence(score) {
  if (score < 38) return { label: 'Strong match', cls: 'good' };
  if (score < 55) return { label: 'Possible match', cls: 'ok' };
  return { label: 'Weak match', cls: 'weak' };
}
