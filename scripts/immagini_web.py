#!/usr/bin/env python3
"""Foto cercate sulle banche di immagini libere per le ricette rimaste senza foto dopo Wikipedia/Commons (immagini.py).

Per ogni ricetta senza immagine cerca il titolo su Openverse (Creative Commons, senza chiave), Pexels e Pixabay
(se i segreti PEXELS_KEY / PIXABAY_KEY sono impostati). Ogni candidata viene fatta controllare al server (/checkimg,
visione AI, pochi neuroni): si tiene solo se mostra davvero quel piatto. La foto accettata viene ridotta a JPEG 640 px
in www/img/<id>.jpg e segnata in www/immagini.json con autore, licenza e fonte ("web"), così l'app mostra il credito.
Le ricette per cui non si trova nulla vengono annotate in "web_tried" e riprovate dopo qualche mese; a quelle ci pensa
poi immagini_ai.py (foto generata). Gira su GitHub, a lotti (SEARCH_LIMIT ricette per esecuzione).
"""
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WWW = ROOT / 'www'
OUT = WWW / 'immagini.json'
IMG = WWW / 'img'
API = 'https://ricette-ai.ricettedelcuore.workers.dev/checkimg'
TOKEN = os.environ.get('ADMIN_TOKEN') or ((ROOT / 'server' / '.admin-token').read_text().strip() if (ROOT / 'server' / '.admin-token').exists() else '')
PEXELS = os.environ.get('PEXELS_KEY', '')
PIXABAY = os.environ.get('PIXABAY_KEY', '')
LIMIT = int(os.environ.get('SEARCH_LIMIT', 30))     # ricette per esecuzione
CANDIDATES = 2                                       # foto da far controllare all'AI per ogni ricetta
RETRY_DAYS = 120                                     # dopo quanto riprovare una ricetta rimasta senza foto
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)'}
SOURCES = ['ricettario.json', 'puglia.json', 'mondo.json', 'artusi.json', 'libere.json', 'collegate.json']
# Parole che nei titoli non aiutano la ricerca ("Pollo in salsa d'uovo" -> "pollo salsa uovo")
STOP = {'alla', 'alle', 'allo', 'agli', 'ai', 'al', 'di', 'del', 'della', 'delle', 'dei', 'degli', 'con', 'in', 'e', 'ed', 'o', 'a', 'la', 'le', 'il', 'lo', 'gli', 'i', 'un', 'una', 'col', 'coi', 'colla', 'per', 'da', 'su', 'the', 'with', 'and', 'of'}


def get(url, headers=None, timeout=45, tries=2):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=timeout)
        except urllib.error.HTTPError:
            raise
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3)


def recipes():
    out = []
    for f in SOURCES:
        p = WWW / f
        if p.exists():
            out += [r for r in json.loads(p.read_text(encoding='utf-8'))['recipes'] if not r.get('image') and r.get('title')]
    return out


def terms(title):
    t = re.sub(r'[(\[].*?[)\]]', ' ', title)
    w = [x for x in re.findall(r"[a-zà-ú']+", t.lower()) if x not in STOP and len(x) > 2]
    return ' '.join(w) or title


# --- fonti: ogni funzione restituisce candidate {url, by, lic, src, page} ---
OV_FAILS = 0  # Openverse senza chiave è lento e a volte non risponde: dopo 2 errori di fila si salta per il resto del lotto


def openverse(q):
    global OV_FAILS
    if OV_FAILS >= 2:
        return []
    u = 'https://api.openverse.org/v1/images/?' + urllib.parse.urlencode({'q': q, 'page_size': 6, 'category': 'photograph', 'license': 'cc0,pdm,by,by-sa', 'mature': 'false'})
    try:
        d = json.load(get(u, timeout=25, tries=1))
    except Exception:
        OV_FAILS += 1; raise
    OV_FAILS = 0
    return [{'url': x.get('url'), 'by': x.get('creator') or '', 'lic': ('CC ' + x['license'].upper() + ' ' + (x.get('license_version') or '')).strip() if x.get('license') not in ('cc0', 'pdm') else ('CC0' if x.get('license') == 'cc0' else 'Pubblico dominio'),
             'src': x.get('source') or 'Openverse', 'page': x.get('foreign_landing_url') or ''} for x in d.get('results', []) if x.get('url')]


def pexels(q):
    if not PEXELS:
        return []
    u = 'https://api.pexels.com/v1/search?' + urllib.parse.urlencode({'query': q, 'per_page': 6, 'locale': 'it-IT', 'orientation': 'landscape'})
    d = json.load(get(u, {'Authorization': PEXELS}))
    return [{'url': x['src'].get('large') or x['src'].get('medium'), 'by': x.get('photographer') or '', 'lic': 'Licenza Pexels', 'src': 'Pexels', 'page': x.get('url') or ''} for x in d.get('photos', [])]


def pixabay(q):
    if not PIXABAY:
        return []
    u = 'https://pixabay.com/api/?' + urllib.parse.urlencode({'key': PIXABAY, 'q': q, 'lang': 'it', 'image_type': 'photo', 'category': 'food', 'safesearch': 'true', 'per_page': 6})
    d = json.load(get(u))
    return [{'url': x.get('webformatURL'), 'by': x.get('user') or '', 'lic': 'Licenza Pixabay', 'src': 'Pixabay', 'page': x.get('pageURL') or ''} for x in d.get('hits', [])]


def candidates(title):
    out, seen = [], set()
    for fn in (pexels, pixabay, openverse):
        try:
            for c in fn(terms(title)):
                if c['url'] and c['url'] not in seen:
                    seen.add(c['url']); out.append(c)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f'  {fn.__name__}: limite di richieste raggiunto')
            else:
                print(f'  {fn.__name__}: errore {e.code}')
        except Exception as e:
            print(f'  {fn.__name__}: {e}')
    return out


def fetch_image(url):
    from PIL import Image
    r = get(url, timeout=40)
    if not (r.headers.get('content-type') or '').startswith('image/'):
        return None
    im = Image.open(io.BytesIO(r.read(8_000_000))).convert('RGB')
    if im.width < 400 or im.height < 300:
        return None
    im.thumbnail((640, 640))
    return im


def check(r, im):
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=80)
    body = {'title': r['title'], 'ingredients': [re.sub(r'^[\d\s.,/½¼¾]+(g|kg|ml|l|dl)?\.?\s*(di\s)?', '', x) for x in (r.get('ingredients') or [])[:6]], 'image': base64.b64encode(buf.getvalue()).decode()}
    req = urllib.request.Request(API, data=json.dumps(body).encode(), headers={**UA, 'Content-Type': 'application/json', 'X-Admin': TOKEN})
    return json.loads(urllib.request.urlopen(req, timeout=120).read()).get('result') or {}


def main():
    if not TOKEN:
        print('ADMIN_TOKEN mancante: nessuna ricerca'); return
    data = json.loads(OUT.read_text(encoding='utf-8'))
    tried = data.setdefault('web_tried', {})
    IMG.mkdir(exist_ok=True)
    today = time.strftime('%Y-%m-%d')
    cutoff = time.strftime('%Y-%m-%d', time.localtime(time.time() - RETRY_DAYS * 86400))
    srcs = '+'.join(n for n, k in (('pexels', PEXELS), ('pixabay', PIXABAY), ('openverse', True)) if k)
    # si salta una ricetta solo se è stata cercata di recente sulle STESSE fonti: con una chiave nuova si riprova tutto
    def skip(id):
        t = tried.get(id, '')
        return t[:10] >= cutoff and t[11:] == srcs
    todo = [r for r in recipes() if r['id'] not in data['items'] and not skip(r['id'])]
    print(f'{len(todo)} ricette senza foto da cercare' + ('' if PEXELS else ' (senza PEXELS_KEY)') + ('' if PIXABAY else ' (senza PIXABAY_KEY)'))
    found = checked = 0
    for r in todo[:LIMIT]:
        cands = candidates(r['title'])
        print(f"{r['title']}: {len(cands)} candidate")
        ok = None
        for c in cands[:CANDIDATES]:
            try:
                im = fetch_image(c['url'])
                if im is None:
                    continue
                res = check(r, im); checked += 1
                print(f"  {c['src']}: {res.get('seen', '?')} -> {'sì' if res.get('match') else 'no'} ({res.get('confidence', '?')})")
                if res.get('match') and res.get('confidence') != 'bassa':
                    ok = (c, im); break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print('Quota AI giornaliera esaurita: si continua domani.')
                    data['updated'] = today
                    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
                    print(f'Foto trovate: {found} in questa esecuzione, {checked} controllate')
                    return
                print(f'  errore {e.code}')
            except Exception as e:
                print(f'  errore: {e}')
        if ok:
            c, im = ok
            name = re.sub(r'[^a-z0-9_-]', '_', r['id'].lower()) + '.jpg'
            im.save(IMG / name, 'JPEG', quality=82, optimize=True, progressive=True)
            data['items'][r['id']] = {'img': 'img/' + name, 'web': {'by': c['by'][:80], 'lic': c['lic'], 'src': c['src'], 'page': c['page'][:300]}}
            if r['id'] in data.get('missing', []):
                data['missing'].remove(r['id'])
            tried.pop(r['id'], None)
            found += 1
        else:
            tried[r['id']] = f'{today} {srcs}'
        time.sleep(1)
    data['updated'] = today
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"Foto trovate: {found} in questa esecuzione ({checked} controllate), {sum(1 for v in data['items'].values() if v.get('web'))} in totale dal web")


if __name__ == '__main__':
    main()
