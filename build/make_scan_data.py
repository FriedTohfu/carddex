"""
Builds the scan data used by the app's camera scanner.

Runs on GitHub (see .github/workflows/scan-data.yml). It downloads every card
image once, computes the same 70-byte fingerprint the app uses (by running
www/js/fp.js inside a real Chromium browser), and writes small files:

  data/index.json        what's available and when it was built
  data/fp-<lang>.json    {v, lang, built, keys: [...card ids], fp: base64}

Only new cards are processed on later runs, so monthly updates are quick.
"""
import base64, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data')
TCG = os.environ.get('TCG_BASE', 'https://api.tcgdex.net/v2')
LANGS = os.environ.get('LANGS', 'en,ja,zh-tw,zh-cn').split(',')
MAX_MIN = float(os.environ.get('MAX_MINUTES', '300'))
UA = {'User-Agent': 'CardDex-scan-data/1.0 (personal collection app)'}
START = time.time()

FP_SRC = open(os.path.join(ROOT, 'www/js/fp.js'), encoding='utf-8').read()
FP_VERSION = int(re.search(r'FP_VERSION\s*=\s*(\d+)', FP_SRC).group(1))
# Make the module usable as a plain script inside the page
PAGE_SCRIPT = re.sub(r'^export\s+', '', FP_SRC, flags=re.M)


def get(url, binary=False, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                return data if binary else json.loads(data.decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1 + i * 2)
        except Exception:
            time.sleep(1 + i * 2)
    return None


def card_list(lang):
    sets = get(f'{TCG}/{lang}/sets')
    if not sets:
        return []
    def one(s):
        full = get(f"{TCG}/{lang}/sets/{urllib.parse.quote(s['id'])}")
        return [(c['id'], c.get('image')) for c in (full or {}).get('cards', []) if c.get('image')]
    with ThreadPoolExecutor(8) as ex:
        out = []
        for part in ex.map(one, sets):
            out.extend(part)
    return out


def load_existing(lang):
    p = os.path.join(OUT, f'fp-{lang}.json')
    if not os.path.exists(p):
        return {}
    d = json.load(open(p, encoding='utf-8'))
    if d.get('v') != FP_VERSION:
        return {}  # fingerprint maths changed: rebuild everything
    raw = base64.b64decode(d['fp'])
    n = len(raw) // len(d['keys']) if d['keys'] else 70
    return {k: raw[i * n:(i + 1) * n] for i, k in enumerate(d['keys'])}


def save(lang, fps, index):
    keys = sorted(fps)
    blob = b''.join(fps[k] for k in keys)
    built = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    with open(os.path.join(OUT, f'fp-{lang}.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': FP_VERSION, 'lang': lang, 'built': built, 'keys': keys,
                   'fp': base64.b64encode(blob).decode('ascii')}, f, separators=(',', ':'))
    index[lang] = {'v': FP_VERSION, 'built': built, 'count': len(keys), 'file': f'fp-{lang}.json',
                   'bytes': os.path.getsize(os.path.join(OUT, f'fp-{lang}.json'))}


JS = """async (items) => {
  const out = [];
  for (const b64 of items) {
    if (!b64) { out.push(null); continue; }
    try {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fp = await fingerprintBlob(new Blob([arr]));
      let s = ''; for (const x of fp) s += String.fromCharCode(x);
      out.push(btoa(s));
    } catch (e) { out.push(null); }
  }
  return out;
}"""


def main():
    os.makedirs(OUT, exist_ok=True)
    ip = os.path.join(OUT, 'index.json')
    index = json.load(open(ip)) if os.path.exists(ip) else {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content('<!doctype html><html><body></body></html>')
        page.add_script_tag(content=PAGE_SCRIPT)
        for lang in LANGS:
            print(f'== {lang}: reading card list', flush=True)
            cards = card_list(lang)
            if not cards:
                print(f'   {lang}: not available, skipped', flush=True)
                continue
            fps = load_existing(lang)
            todo = [(cid, img) for cid, img in cards if cid not in fps]
            print(f'   {len(cards)} cards with images, {len(todo)} new', flush=True)
            if not todo and lang in index:
                continue  # nothing new: leave the file untouched
            done = 0
            with ThreadPoolExecutor(16) as ex:
                for i in range(0, len(todo), 96):
                    if (time.time() - START) / 60 > MAX_MIN:
                        print('   time limit reached, saving progress (next run continues)', flush=True)
                        break
                    batch = todo[i:i + 96]
                    imgs = list(ex.map(lambda t: get(f'{t[1]}/low.webp', binary=True, tries=2), batch))
                    b64 = [base64.b64encode(b).decode('ascii') if b and len(b) > 500 else None for b in imgs]
                    res = page.evaluate(JS, b64)
                    for (cid, _), r in zip(batch, res):
                        if r:
                            fps[cid] = base64.b64decode(r)
                    done += len(batch)
                    if done % 960 == 0 or done >= len(todo):
                        print(f'   {lang}: {done}/{len(todo)}', flush=True)
                    if done % 4800 == 0:
                        save(lang, fps, index)
            save(lang, fps, index)
            print(f'   {lang}: {len(fps)} fingerprints saved', flush=True)
        browser.close()
    with open(ip, 'w') as f:
        json.dump(index, f, indent=1)


if __name__ == '__main__':
    main()
