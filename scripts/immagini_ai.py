#!/usr/bin/env python3
"""Foto generate con l'AI per le ricette rimaste senza immagine dopo la ricerca su Wikipedia/Commons (immagini.py).

Chiede al server (/genimg, protetto dal segreto ADMIN_TOKEN) un'immagine per ogni ricetta senza foto, a lotti giornalieri
(LIMIT per esecuzione, per restare nella quota gratuita di Workers AI), la riduce a JPEG e la salva in www/img/<id>.jpg;
in www/immagini.json la voce ha "gen": true, così l'app la mostra con la nota «immagine generata». Gira su GitHub.
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
API = 'https://ricette-ai.ricettedelcuore.workers.dev/genimg'
TOKEN = os.environ.get('ADMIN_TOKEN') or ((ROOT / 'server' / '.admin-token').read_text().strip() if (ROOT / 'server' / '.admin-token').exists() else '')
LIMIT = int(os.environ.get('IMG_LIMIT', 60))
SOURCES = ['ricettario.json', 'puglia.json', 'mondo.json', 'artusi.json', 'libere.json', 'collegate.json']


def recipes():
    out = []
    for f in SOURCES:
        p = WWW / f
        if p.exists():
            out += [r for r in json.loads(p.read_text(encoding='utf-8'))['recipes'] if not r.get('image') and r.get('title')]
    return out


def gen(r):
    body = {'title': r['title'], 'cat': r.get('cat'), 'country': r.get('country'), 'ingredients': (r.get('ingredients') or [])[:5]}
    req = urllib.request.Request(API, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'X-Admin': TOKEN, 'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)'})
    return json.loads(urllib.request.urlopen(req, timeout=180).read())


def main():
    if not TOKEN:
        print('ADMIN_TOKEN mancante: nessuna immagine generata'); return
    from PIL import Image
    data = json.loads(OUT.read_text(encoding='utf-8'))
    IMG.mkdir(exist_ok=True)
    todo = [r for r in recipes() if r['id'] not in data['items']]
    print(f'{len(todo)} ricette senza foto')
    done = 0
    for r in todo[:LIMIT * 2]:  # qualche tentativo in più per i fallimenti singoli
        if done >= LIMIT:
            break
        try:
            res = gen(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print('Quota giornaliera esaurita: si continua domani.'); break
            print('non generata', r['id'], e.code); continue
        except Exception as e:
            print('non generata', r['id'], e); continue
        if not res.get('image'):
            continue
        im = Image.open(io.BytesIO(base64.b64decode(res['image']))).convert('RGB')
        im.thumbnail((640, 640))
        name = re.sub(r'[^a-z0-9_-]', '_', r['id'].lower()) + '.jpg'
        im.save(IMG / name, 'JPEG', quality=82, optimize=True, progressive=True)
        data['items'][r['id']] = {'img': 'img/' + name, 'gen': True}
        if r['id'] in data.get('missing', []):
            data['missing'].remove(r['id'])
        done += 1
        time.sleep(2)
    data['updated'] = time.strftime('%Y-%m-%d')
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"Foto generate: {done} in questa esecuzione, {sum(1 for v in data['items'].values() if v.get('gen'))} in totale")


if __name__ == '__main__':
    main()
