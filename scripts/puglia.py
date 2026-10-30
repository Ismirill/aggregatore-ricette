#!/usr/bin/env python3
"""Ricette tipiche e prodotti tipici della Regione Puglia (dati.puglia.it, "Prodotti tipici e ricette", Pugliapromozione,
licenza CC BY 4.0) -> www/puglia.json.

Le ricette hanno il procedimento in forma di testo: ingredienti, dosi, passaggi e tipo di piatto li estrae il server AI
(/analyze, come per i post social). Le ricette già analizzate non vengono rifatte. Gira in automatico su GitHub.
"""
import html
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_ricette  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'www' / 'puglia.json'
CKAN = 'https://dati.puglia.it/ckan/api/3/action/package_show?id=prodotti-tipici-e-ricette'
AI = 'https://ricette-ai.ricettedelcuore.workers.dev/analyze'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)', 'Content-Type': 'application/json'}
CATS = ['Antipasti', 'Primi', 'Secondi', 'Contorni', 'Piatti unici', 'Lievitati', 'Dolci', 'Altro']


def get(url, data=None, timeout=90):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


def rows_from_xlsx(raw):
    """Foglio Excel letto senza librerie esterne."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    ss = [html.unescape(re.sub(r'<[^>]+>', '', m)) for m in re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode(), re.S)]
    rows = []
    for r in re.findall(r'<row[^>]*>(.*?)</row>', z.read('xl/worksheets/sheet1.xml').decode(), re.S):
        cells = {}
        for ref, t, v in re.findall(r'<c r="([A-Z]+)\d+"([^>]*)>(?:<v>(.*?)</v>)?', r):
            cells[ref] = ss[int(v)] if 't="s"' in t and v else (v or '')
        rows.append(cells)
    head = rows[0]
    return [{head[k]: (v or '').strip() for k, v in r.items() if k in head} for r in rows[1:]]


def clean(t):
    return re.sub(r'\s{2,}', ' ', t.replace(' ', ' ')).strip()


def main():
    meta = json.loads(get(CKAN))['result']
    xlsx = next(r['url'] for r in meta['resources'] if r['format'].upper() == 'XLSX')
    rows = rows_from_xlsx(get(xlsx))
    prev = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    done = {r['id']: r for r in prev.get('recipes', [])}
    recipes = []  # solo le ricette: i prodotti del territorio (vini, formaggi, oli, frutta…) non sono ricette
    for x in rows:
        base = {'id': 'pu-' + x['ID'], 'title': clean(x['NOME']), 'image': x.get('FOTO', ''), 'imgAuthor': x.get('AUTORE', ''),
                'link': x.get('LINK', ''), 'place': clean(x.get('LOCALITAASSOCIATE', '')), 'area': clean(x.get('TERRITORIASSOCIATI', ''))}
        text = clean(x.get('DESCRIZIONE', ''))
        if 'ricett' in x.get('RISORSATERRITORIALE', '').lower():
            if base['id'] in done and done[base['id']].get('text') == text:
                recipes.append(done[base['id']]); continue
            try:
                r = json.loads(get(AI, {'url': base['link'], 'source': 'Regione Puglia', 'caption': f"{base['title']}\n{text}", 'cats': CATS}))['result'] or {}
                time.sleep(4.5)  # sotto il limite di richieste del server
            except Exception as e:
                print('analisi non riuscita', base['title'], e); r = {}
            recipes.append({**base, 'text': text, 'cat': r.get('cat') if r.get('cat') in CATS else 'Altro', 'servings': r.get('servings') or None,
                            'time': r.get('time') or None, 'ingredients': r.get('ingredients') or [], 'steps': r.get('steps') or [text],
                            'diets': r.get('diets') or []})
    for r in recipes:  # grammi, calorie e nutrienti per costo e Budget, come per il ricettario
        for f in ('b', 'n', 'cov', 's', 'sub'):
            r.pop(f, None)
        res, _ = base_ricette.analyze(r) if r['ingredients'] else (None, [])
        if res:
            r.update(res)
    base_ricette.RES.save()
    data = {'source': 'Regione Puglia - Pugliapromozione, "Prodotti tipici e ricette"', 'url': 'https://dati.puglia.it/ckan/dataset/prodotti-tipici-e-ricette',
            'license': 'CC BY 4.0', 'updated': time.strftime('%Y-%m-%d'), 'recipes': recipes}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Puglia: {len(recipes)} ricette')


if __name__ == '__main__':
    main()
