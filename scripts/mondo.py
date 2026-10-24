#!/usr/bin/env python3
"""Ricette dal mondo: dataset UniTools (theunitools.com, 501 ricette di 127 paesi, licenza CC BY-SA 4.0) -> www/mondo.json.

Le ricette sono in inglese: il server AI le traduce in italiano a lotti (al massimo LIMIT per esecuzione, per restare nella
quota gratuita giornaliera); quelle già tradotte restano salvate e non si rifanno. Calorie e nutrienti vengono dal dataset;
la base in grammi per il costo si calcola come per il ricettario (base_ricette.py). Gira ogni giorno su GitHub finché
non sono tradotte tutte, poi controlla solo le novità del dataset.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_ricette  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'www' / 'mondo.json'
SRC = 'https://theunitools.com/data/unitools-recipes-v1.json'
AI = 'https://ricette-ai.ricettedelcuore.workers.dev/translate-recipe'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)', 'Content-Type': 'application/json'}
LIMIT = int(__import__("os").environ.get("MONDO_LIMIT", 150))
UNITS = {'g': 'g', 'kg': 'kg', 'ml': 'ml', 'l': 'l', 'tbsp': ('cucchiaio', 'cucchiai'), 'tsp': ('cucchiaino', 'cucchiaini'),
         'clove': ('spicchio', 'spicchi'), 'pinch': ('pizzico', 'pizzichi'), 'sprig': ('rametto', 'rametti'), 'slice': ('fetta', 'fette'), 'piece': ''}
FRAC = {0.25: '¼', 0.5: '½', 0.75: '¾', 1 / 3: '⅓', 2 / 3: '⅔'}
CAT = {'soup': 'Primi', 'dessert': 'Dolci', 'snack': 'Antipasti', 'bread': 'Lievitati', 'side': 'Contorni', 'salad': 'Contorni', 'sauce': 'Altro', 'drink': 'Altro'}
DIETS = {'vegetarian': 'Vegetariano', 'vegan': 'Vegano', 'gluten-free': 'Senza glutine'}


def qty(q):
    if q is None:
        return ''
    w, f = int(q), q - int(q)
    for v, s in FRAC.items():
        if abs(f - v) < 0.02:
            return (f'{w} ' if w else '') + s
    return f'{q:g}'.replace('.', ',')


def line(i, name, note):
    u = i.get('unit')
    if u == 'toTaste':
        s = f'{name} q.b.'
    else:
        unit = UNITS.get(u, u or '')
        if isinstance(unit, tuple):
            unit = unit[0] if (i.get('quantity') or 0) <= 1 else unit[1]
        s = ' '.join(x for x in (qty(i.get('quantity')), unit, name) if x)
    return s + (f' ({note})' if note and len(note) <= 70 else '')


def translate(r):
    body = {'recipe': {'name': r['name']['en'], 'summary': r['summary']['en'],
                       'ingredients': [{'name': i['name']['en'], 'note': (i.get('note') or {}).get('en', '')} for i in r['ingredients']],
                       'steps': [s['text']['en'] for s in r['steps']]}}
    req = urllib.request.Request(AI, data=json.dumps(body).encode(), headers=UA)
    return json.loads(urllib.request.urlopen(req, timeout=120).read())['result']


def convert(r, it):
    pasta = any(k in json.dumps(r['ingredients']).lower() for k in ('spaghetti', 'pasta', 'noodle', 'rice', 'risotto', 'linguine', 'penne', 'gnocchi', 'lasagn'))
    cat = CAT.get(r['category']) or ('Primi' if r['category'] == 'main' and pasta else 'Secondi' if r['category'] == 'main' else 'Altro')
    if r['category'] == 'breakfast':
        cat = 'Dolci' if any('sugar' in i['name']['en'].lower() or 'honey' in i['name']['en'].lower() for i in r['ingredients']) else 'Altro'
    low = lambda t: t[:1].lower() + t[1:] if t[:2] != t[:2].upper() else t  # "Spaghetti" -> "spaghetti", ma "DOP" resta
    ings = [line(i, low(t['name']), t['note']) for i, t in zip(r['ingredients'], it['ingredients'])]
    n = r['nutritionPerServing']
    rec = {'id': 'wo-' + r['slug'], 'title': r.get('nativeName') if r['country'] == 'IT' and r.get('nativeName') else it['name'],
           'nativeName': r.get('nativeName') or '', 'summary': it['summary'], 'country': r['country'], 'cat': cat,
           'diets': [DIETS[d] for d in r['diets'] if d in DIETS], 'servings': r['baseServings'],
           'time': (r.get('prepMinutes') or 0) + (r.get('cookMinutes') or 0) or None,
           'diff': {'easy': 1, 'medium': 2, 'hard': 3}.get(r['difficulty'], 2),
           'ingredients': ings, 'steps': it['steps'],
           'n': {'k': round(n['calories']), 'p': round(n['protein']), 'c': round(n['carbs']), 'f': round(n['fat'])}}
    if r.get('photo'):
        rec.update(image=r['photo']['url'], imgAuthor=r['photo'].get('author', ''), imgLicense=r['photo'].get('license', ''))
    base, _ = base_ricette.analyze(rec)  # grammi per ingrediente, per il costo con i prezzi del mese
    if base:
        rec['b'] = base['b']; rec['cov'] = base['cov']
        if base.get('sub'):
            rec['sub'] = base['sub']
    return rec


def main():
    data = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'recipes': []}
    done = {r['id']: r for r in data['recipes']}
    src = json.loads(urllib.request.urlopen(urllib.request.Request(SRC, headers=UA), timeout=120).read())
    src = src if isinstance(src, list) else src['recipes']
    out, new, stop = [], 0, False
    for r in src:
        rid = 'wo-' + r['slug']
        if rid in done:
            out.append(done[rid]); continue
        if stop or new >= LIMIT:
            continue
        try:
            out.append(convert(r, translate(r))); new += 1
            time.sleep(4.5)  # sotto il limite di richieste del server
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print('Quota giornaliera esaurita: si continua domani.'); stop = True
            else:
                print('traduzione non riuscita', r['slug'], e.code)
        except Exception as e:
            print('traduzione non riuscita', r['slug'], e)
    data = {'source': 'UniTools — theunitools.com', 'url': 'https://theunitools.com/en/data', 'license': 'CC BY-SA 4.0',
            'note': 'Tradotte in italiano con l\'AI dal dataset originale (inglese)', 'updated': time.strftime('%Y-%m-%d'),
            'total': len(src), 'recipes': out}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    base_ricette.RES.save()
    print(f'Ricette dal mondo: {len(out)} tradotte su {len(src)} ({new} in questa esecuzione)')


if __name__ == '__main__':
    main()
