#!/usr/bin/env python3
"""Cerca una foto per ogni ricetta del ricettario su Wikipedia in italiano (immagini di Wikimedia Commons,
con licenze libere) e salva l'elenco in www/immagini.json: {id: {"img": miniatura, "file": pagina della foto}}.

Si accetta solo una voce il cui titolo corrisponde al piatto (stesso titolo o redirect, oppure un risultato di
ricerca che contiene le parole principali del nome), per non mostrare foto sbagliate.
Le ricette già cercate vengono saltate: gira automaticamente su GitHub insieme all'aggiornamento del ricettario.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / 'www' / 'ricettario.json'
OUT = ROOT / 'www' / 'immagini.json'
API = 'https://it.wikipedia.org/w/api.php'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)'}
STOP = {'di', 'del', 'della', 'dei', 'degli', 'delle', 'al', 'alla', 'alle', 'allo', 'ai', 'agli', 'con', 'e', 'in', 'a', 'da', 'la', 'il',
        'lo', 'le', 'i', 'gli', 'un', 'una', 'per', 'su', 'sul', 'sulla', "d'", "all'", "dell'", 'alla', 'ricetta', 'classica', 'classico'}


def api(**q):
    q.update(format='json', formatversion='2', redirects='1')
    req = urllib.request.Request(API + '?' + urllib.parse.urlencode(q), headers=UA)
    for i in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(3 * (i + 1))
    return {}


def words(t):
    return {w for w in re.findall(r"[a-zàèéìòù]+", t.lower().replace("'", ' ')) if w not in STOP and len(w) > 2}


FOOD = re.compile(r'piatt|cucina|dolc|ricett|salsa|pietanz|aliment|tort|pasta|zupp|minestr|formagg|bevand|liquor|\bpane\b|biscott|specialit|antipast|contorn|dessert|condiment|insalat|crem|gastronom|frittat|focacc|pizz|risott|carne|pesce|verdur|frutt|cibo|piadin|polpett|salum|sugo|ragù|brodo|cocktail|budino|gelato|confettur|conserv', re.I)


def food(page, strict):
    d = page.get('description')
    if d:
        return bool(FOOD.search(d))
    return not strict  # senza descrizione: va bene solo se il titolo coincide


def thumb(page):
    th = page.get('thumbnail', {}).get('source')
    name = page.get('pageimage')
    if not th or not name or re.search(r'\.(svg|gif)$', name, re.I):
        return None  # niente loghi, stemmi o disegni
    return {'img': th, 'file': 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(name)}


def exact(titles):
    """Voci con lo stesso titolo (anche tramite redirect), a gruppi di 50."""
    found = {}
    for i in range(0, len(titles), 50):
        group = titles[i:i + 50]
        r = api(action='query', titles='|'.join(group), prop='pageimages|description', piprop='thumbnail|name', pithumbsize='480')
        q = r.get('query', {})
        back = {x['to']: x['from'] for x in q.get('redirects', [])}
        norm = {x['to']: x['from'] for x in q.get('normalized', [])}
        for p in q.get('pages', []):
            t = p.get('title', '')
            orig = norm.get(back.get(t, t), back.get(t, t))
            th = thumb(p)
            if th and not p.get('missing') and food(p, False):
                found[orig] = th
        time.sleep(0.5)
    return found


def search(title):
    """Primo risultato di ricerca, accettato solo se contiene tutte le parole principali del piatto."""
    r = api(action='query', generator='search', gsrsearch=title, gsrlimit='3', gsrnamespace='0',
            prop='pageimages|description', piprop='thumbnail|name', pithumbsize='480')
    need = words(title)
    for p in sorted(r.get('query', {}).get('pages', []), key=lambda x: x.get('index', 9)):
        if need and need <= words(p.get('title', '')) and food(p, True):
            return thumb(p)
    return None


def main():
    recipes = json.loads(BOOK.read_text(encoding='utf-8'))['recipes']
    data = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'source': 'Wikipedia / Wikimedia Commons', 'items': {}, 'missing': []}
    done = set(data['items']) | set(data['missing'])
    todo = [r for r in recipes if r['id'] not in done]
    print(f'{len(recipes)} ricette, {len(todo)} da cercare')
    hits = exact([r['title'] for r in todo])
    for n, r in enumerate(todo, 1):
        th = hits.get(r['title']) or search(r['title'])
        if th:
            data['items'][r['id']] = th
        else:
            data['missing'].append(r['id'])
        if n % 50 == 0:
            print(f'  {n}/{len(todo)}')
        time.sleep(0.3)
    data['updated'] = time.strftime('%Y-%m-%d')
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"{len(data['items'])} ricette con foto, {len(data['missing'])} senza")


if __name__ == '__main__':
    main()
