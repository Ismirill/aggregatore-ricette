#!/usr/bin/env python3
"""Scarica le ricette del "Libro di cucina" di Wikibooks in italiano e le salva in www/ricettario.json.

Le ricette sono rilasciate con licenza CC BY-SA 4.0: l'app cita la fonte e il link alla pagina
(con la cronologia degli autori) su ogni ricetta.
Uso:  python3 scripts/wikibooks.py
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = 'https://it.wikibooks.org/w/api.php'
PREFIX = 'Libro di cucina/Ricette/'
OUT = Path(__file__).resolve().parent.parent / 'www' / 'ricettario.json'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)'}


def api(**q):
    q.update(format='json', formatversion='2')
    req = urllib.request.Request(API + '?' + urllib.parse.urlencode(q), headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=60))


def clean(t):
    """Wikitesto -> testo semplice."""
    t = re.sub(r'<ref[^>]*>.*?</ref>|<ref[^>]*/>', '', t, flags=re.S)
    t = re.sub(r'<!--.*?-->', '', t, flags=re.S)
    for _ in range(3):  # template annidati
        t = re.sub(r'\{\{[^{}]*\}\}', '', t)
    t = re.sub(r'\[\[(?:File|Immagine|Image|Categoria|Category):[^\]]*\]\]', '', t, flags=re.I)
    t = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', t)
    t = re.sub(r'\[https?://\S+ ([^\]]*)\]', r'\1', t)
    t = re.sub(r"'{2,}", '', t)
    t = re.sub(r'<[^>]+>', '', t)
    return re.sub(r'[ \t]+', ' ', t).strip()


def sections(text):
    """{'ingredienti': '...', 'preparazione': '...'} dai titoli == ... ==."""
    parts = re.split(r'^\s*={2,4}\s*(.*?)\s*={2,4}\s*$', text, flags=re.M)
    out = {'_intro': parts[0]}
    for name, body in zip(parts[1::2], parts[2::2]):
        out[clean(name).lower()] = out.get(clean(name).lower(), '') + '\n' + body
    return out


def pick(secs, *keys):
    for k, v in secs.items():
        if any(x in k for x in keys):
            return v
    return ''


def parse(title, text, categories):
    secs = sections(text)
    ing_txt = pick(secs, 'ingredient')
    prep_txt = pick(secs, 'preparazion', 'procediment', 'esecuzion', 'istruzion')
    ingredients = [clean(l.lstrip('*#:; ')) for l in ing_txt.splitlines() if re.match(r'\s*[*#]', l)]
    ingredients = [i for i in ingredients if i]
    steps = []
    for block in re.split(r'\n\s*\n|\n(?=\s*[#*])', prep_txt):
        s = clean(re.sub(r'^\s*[#*:]+\s*', '', block.strip()))
        if s and not s.lower().startswith(('categoria', 'vedi anche')):
            steps.append(s)
    m = re.search(r"per\s*'*\s*(\d{1,2})\s*'*\s*(?:persone|porzioni|pers)", text, re.I)
    servings = int(m.group(1)) if m else None
    regions = [c.split('-', 1)[1] for c in categories if c.startswith('Ricette regionali-')]
    if not ingredients and not steps:
        return None
    return {
        'id': 'wb-' + re.sub(r'\W+', '-', title.lower()).strip('-'),
        'title': title,
        'url': 'https://it.wikibooks.org/wiki/' + urllib.parse.quote((PREFIX + title).replace(' ', '_')),
        'region': regions[0] if regions else '',
        'tags': [c for c in categories if not re.match(r'(Ricette regionali-|Moduli|Pagine|Libro|Stub|Ricette\b)', c)][:4],
        'cats': [c for c in categories if not re.match(r'(Moduli|Pagine|Libro|Stub|Da unire|Da controllare)', c)],  # per la classificazione
        'servings': servings,
        'ingredients': ingredients[:40],
        'steps': steps[:30],
    }


def main():
    recipes, cont = [], {}
    while True:
        r = api(action='query', generator='allpages', gapprefix=PREFIX, gaplimit='50', gapnamespace='0',
                prop='revisions|categories', rvprop='content', rvslots='main', cllimit='max', **cont)
        for p in r.get('query', {}).get('pages', []):
            rev = (p.get('revisions') or [{}])[0].get('slots', {}).get('main', {}).get('content', '')
            if not rev or rev.lstrip().upper().startswith('#REDIRECT') or rev.lstrip().upper().startswith('#RINVIA'):
                continue
            cats = [c['title'].split(':', 1)[1] for c in p.get('categories', [])]
            rec = parse(p['title'][len(PREFIX):], rev, cats)
            if rec:
                recipes.append(rec)
        if 'continue' not in r:
            break
        cont = {k: v for k, v in r['continue'].items()}
        time.sleep(0.5)  # gentilezza verso i server di Wikimedia
    recipes.sort(key=lambda x: x['title'].lower())
    data = {
        'source': 'Wikibooks, Libro di cucina',
        'license': 'CC BY-SA 4.0',
        'license_url': 'https://creativecommons.org/licenses/by-sa/4.0/deed.it',
        'updated': time.strftime('%Y-%m-%d'),
        'recipes': recipes,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(recipes)} ricette salvate in {OUT} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
