"""
Writes the notes for an APK release: the latest "What's new" entries from
www/changelog.json, plus every change since the previous build.
Usage: python build/release_notes.py <previous-tag-or-empty> > notes.md
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
prev = sys.argv[1] if len(sys.argv) > 1 else ''


def git(*args):
    try:
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except Exception:
        return ''


out = ['Download **CardDex.apk** below and open it on your Android phone to install or update.', '']
try:
    log = json.load(open(os.path.join(ROOT, 'www', 'changelog.json'), encoding='utf-8'))
except Exception:
    log = []

# Changelog entries added since the previous build (or the newest one)
old_ids = set()
if prev:
    try:
        old_ids = {e['id'] for e in json.loads(git('show', f'{prev}:www/changelog.json') or '[]')}
    except Exception:
        old_ids = set()
fresh = [e for e in log if e['id'] not in old_ids] or log[:1]
if fresh:
    out.append("## What's new")
    for e in fresh:
        out.append(f"**{e['title']}** ({e['date']})")
        out += [f'- {x}' for x in e.get('items', [])]
        out.append('')

# Does this build need installing (Android side changed), or does the app update itself?
if prev and git('diff', '--name-only', prev, 'HEAD', '--', 'build/native-api.txt').strip():
    out.append('> ⚠️ This version changes the Android side of the app: install this APK once to keep getting automatic updates.')
else:
    out.append('> If you already have the app installed, it updates itself, so there\'s no need to reinstall.')
out.append('')

# Every change since the previous build
SKIP = ('Update card data', 'Update older Japanese', 'Update Japanese card list', 'Probe')
commits = [s for s in git('log', '--no-merges', '--pretty=%s', f'{prev}..HEAD' if prev else '-15').splitlines()
           if s and not s.startswith(SKIP)]
if commits:
    out.append('## Changes in this build')
    out += [f'- {c}' for c in commits]
print('\n'.join(out))
