import json, urllib.request, os, re, gzip
os.makedirs('out5', exist_ok=True)
UA={'User-Agent':'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36','Accept-Encoding':'gzip'}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60) as r:
            b=r.read(); b=gzip.decompress(b) if b[:2]==b'\x1f\x8b' else b; return r.status,b.decode('utf-8','replace')
    except urllib.error.HTTPError as e: return e.code, e.read()[:500].decode('utf-8','replace')
    except Exception as e: return 0,str(e)
st={}
for name,u in [('robots','https://www.pkmn.gg/robots.txt'),('series','https://www.pkmn.gg/jp/series'),('terms','https://www.pkmn.gg/terms')]:
    s,t=get(u); st[name]=[s,len(t)]; open(f'out5/{name}.html','w').write(t)
json.dump(st,open('out5/res.json','w'),indent=1)
