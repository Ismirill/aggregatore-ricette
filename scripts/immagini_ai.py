#!/usr/bin/env python3
"""Foto generate con l'AI per le ricette rimaste senza immagine dopo Wikipedia/Commons (immagini.py) e le banche
di immagini (immagini_web.py).

Chiede al server (/genimg, protetto dal segreto ADMIN_TOKEN) un'immagine per ogni ricetta senza foto, a lotti giornalieri
(LIMIT per esecuzione, per restare nella quota gratuita di Workers AI), la riduce a JPEG e la salva in www/img/<id>.jpg;
in www/immagini.json la voce ha "gen": true, così l'app la mostra con la nota «immagine generata». Il server, prima di
generare, fa descrivere il piatto al modello di testo (ingredienti + tipo di piatto verificato in categorie.json), così
l'immagine corrisponde alla ricetta. Le foto generate in passato senza questo passaggio ("v" mancante) vengono fatte
controllare dalla visione AI (/checkimg): quelle sbagliate vengono rigenerate. Gira su GitHub.
"""
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WWW = ROOT / 'www'
OUT = WWW / 'immagini.json'
IMG = WWW / 'img'
API = 'https://ricette-ai.ricettedelcuore.workers.dev'
TOKEN = os.environ.get('ADMIN_TOKEN') or ((ROOT / 'server' / '.admin-token').read_text().strip() if (ROOT / 'server' / '.admin-token').exists() else '')
LIMIT = int(os.environ.get('IMG_LIMIT', 60))          # immagini generate per esecuzione (~170 neuroni l'una)
CHECK_LIMIT = int(os.environ.get('IMG_CHECK', 20))    # vecchie immagini da controllare per esecuzione (pochi neuroni l'una)
ONLY = os.environ.get('IMG_ONLY', '')                 # per le prove: solo questa ricetta (id)
GEN_VERSION = 2                                       # metodo di generazione: 2 = con descrizione del piatto
SOURCES = ['ricettario.json', 'puglia.json', 'mondo.json', 'artusi.json', 'libere.json', 'collegate.json']
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)'}


def recipes():
    cats = {}
    try:
        cats = {k: v['cat'] for k, v in json.loads((WWW / 'categorie.json').read_text(encoding='utf-8'))['items'].items() if v.get('cat')}
    except Exception:
        pass
    out = []
    for f in SOURCES:
        p = WWW / f
        if p.exists():
            for r in json.loads(p.read_text(encoding='utf-8'))['recipes']:
                if r.get('title'):
                    out.append({**r, 'cat': cats.get(r['id']) or r.get('cat')})  # tipo di piatto verificato (categorie.py)
    return out


def call(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={**UA, 'Content-Type': 'application/json', 'X-Admin': TOKEN})
    return json.loads(urllib.request.urlopen(req, timeout=180).read())


def gen(r):
    return call('/genimg', {'title': r['title'], 'cat': r.get('cat'), 'country': r.get('country'), 'ingredients': (r.get('ingredients') or [])[:12]})


def check(r, path):
    from PIL import Image
    im = Image.open(path).convert('RGB')
    im.thumbnail((512, 512))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=78)
    return call('/checkimg', {'title': r['title'], 'ingredients': (r.get('ingredients') or [])[:6], 'image': base64.b64encode(buf.getvalue()).decode()}).get('result') or {}


def save_image(r, data, res):
    from PIL import Image
    im = Image.open(io.BytesIO(base64.b64decode(res['image']))).convert('RGB')
    im.thumbnail((640, 640))
    name = re.sub(r'[^a-z0-9_-]', '_', r['id'].lower()) + '.jpg'
    im.save(IMG / name, 'JPEG', quality=82, optimize=True, progressive=True)
    data['items'][r['id']] = {'img': 'img/' + name, 'gen': True, 'v': GEN_VERSION}
    if r['id'] in data.get('missing', []):
        data['missing'].remove(r['id'])


class Quota(Exception):
    pass


def main():
    if not TOKEN:
        print('ADMIN_TOKEN mancante: nessuna immagine generata'); return
    data = json.loads(OUT.read_text(encoding='utf-8'))
    IMG.mkdir(exist_ok=True)
    allr = {r['id']: r for r in recipes()}
    done = checked = redone = 0
    try:
        # 1) vecchie immagini generate senza descrizione: controllo con la visione AI, rigenerazione se sbagliate
        old = [i for i, v in data['items'].items() if v.get('gen') and v.get('v', 1) < GEN_VERSION and not v.get('ok') and i in allr and (not ONLY or i == ONLY)]
        for i in old[:CHECK_LIMIT]:
            r, v = allr[i], data['items'][i]
            try:
                res = check(r, WWW / v['img'])
            except urllib.error.HTTPError as e:
                if e.code == 429: raise Quota()
                print('controllo non riuscito', i, e.code); continue
            except Exception as e:
                print('controllo non riuscito', i, e); continue
            checked += 1
            ok = res.get('match') and res.get('confidence') != 'bassa'
            print(f"{r['title']}: {res.get('seen', '?')} -> {'ok' if ok else 'da rifare'}")
            if ok:
                v['ok'] = True; continue
            if done >= LIMIT:
                continue  # resta segnata come da controllare: si rifà in un'altra esecuzione
            try:
                g = gen(r)
            except urllib.error.HTTPError as e:
                if e.code == 429: raise Quota()
                print('non rigenerata', i, e.code); continue
            if g.get('image'):
                save_image(r, data, g); done += 1; redone += 1
                print(f"  rigenerata come «{g.get('dish')}» ({g.get('course')})")
            time.sleep(2)
        # 2) ricette ancora senza foto
        todo = [r for r in allr.values() if not r.get('image') and r['id'] not in data['items'] and (not ONLY or r['id'] == ONLY)]
        print(f'{len(todo)} ricette senza foto')
        for r in todo[:LIMIT * 2]:
            if done >= LIMIT:
                break
            try:
                g = gen(r)
            except urllib.error.HTTPError as e:
                if e.code == 429: raise Quota()
                print('non generata', r['id'], e.code); continue
            except Exception as e:
                print('non generata', r['id'], e); continue
            if not g.get('image'):
                continue
            save_image(r, data, g); done += 1
            print(f"{r['title']} -> «{g.get('dish')}» ({g.get('course')})")
            time.sleep(2)
    except Quota:
        print('Quota giornaliera esaurita: si continua domani.')
    data['updated'] = time.strftime('%Y-%m-%d')
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"Foto generate: {done} in questa esecuzione ({redone} rifatte, {checked} controllate), {sum(1 for v in data['items'].values() if v.get('gen'))} in totale")


if __name__ == '__main__':
    main()
