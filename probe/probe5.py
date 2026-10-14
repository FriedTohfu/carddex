import json, urllib.request, os, re, gzip
os.makedirs('out5', exist_ok=True)
UA={'User-Agent':'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36','Accept-Encoding':'gzip'}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60) as r:
            b=r.read(); b=gzip.decompress(b) if b[:2]==b'\x1f\x8b' else b; return r.status,b.decode('utf-8','replace')
    except urllib.error.HTTPError as e: return e.code, e.read()[:300].decode('utf-8','replace')
    except Exception as e: return 0,str(e)
def nd(t):
    m=re.search(r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>',t,re.S); return json.loads(m.group(1)) if m else None
s,t=get('https://www.pkmn.gg/jp/series/original'); d=nd(t)
open('out5/original.json','w').write(json.dumps(d,ensure_ascii=False))
links=sorted(set(re.findall(r'href="(/jp/series/original/[^"]+)"',t)))
open('out5/links.txt','w').write('\n'.join(links))
if links:
    s2,t2=get('https://www.pkmn.gg'+links[0]); d2=nd(t2)
    open('out5/set.json','w').write(json.dumps(d2,ensure_ascii=False))
    open('out5/set.html','w').write(t2)
s3,t3=get('https://www.pkmn.gg/sitemap.xml'); open('out5/sitemap.xml','w').write(t3)
