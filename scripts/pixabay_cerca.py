"""Cerca su Pixabay una foto per ogni ricetta ancora senza immagine e salva le candidate in pixabay_candidate.json.
Non usa l'AI: le candidate vengono controllate a vista prima di essere pubblicate."""
import json, os, re, time, urllib.request, urllib.parse
from pathlib import Path
W = Path(__file__).resolve().parent.parent / 'www'
KEY = re.sub(r'\s', '', os.environ.get('PIXABAY_KEY', '')).strip('"\'')
print('chiave: lunghezza', len(KEY), '| forma corretta (numero-trattino-32 caratteri):', bool(re.fullmatch(r'\d+-[0-9a-f]{32}', KEY)))
im = json.load(open(W/'immagini.json'))['items']
rec = {}
for f in ['ricettario', 'puglia', 'mondo', 'artusi', 'libere', 'collegate']:
    p = W/f'{f}.json'
    if p.exists():
        for r in json.load(open(p))['recipes']: rec[r['id']] = r
ids = [i for i in rec if i not in im or im[i].get('redo')]
out = {}
for n, i in enumerate(ids):
    t = re.sub(r'\(.*?\)', '', rec[i]['title']).strip()
    q = {'key': KEY, 'q': t[:100], 'lang': 'it', 'image_type': 'photo', 'category': 'food', 'safesearch': 'true', 'per_page': 3}
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request('https://pixabay.com/api/?' + urllib.parse.urlencode(q), headers={'User-Agent': 'Gnamina/1.0 (https://ismirill.github.io/aggregatore-ricette/)'}), timeout=30))
        h = (d.get('hits') or [None])[0]
        if h:
            out[i] = {'thumb': h['webformatURL'], 'page': h['pageURL'], 'by': h.get('user', 'Pixabay'), 'lic': 'Pixabay License', 'src': 'Pixabay', 'tags': h.get('tags', '')}
    except Exception as e:
        print('errore', i, e, getattr(e, 'read', lambda: b'')()[:200])
    time.sleep(0.7)  # limite Pixabay: 100 richieste al minuto
print(len(ids), 'cercate,', len(out), 'trovate')
json.dump(out, open('pixabay_candidate.json', 'w'), ensure_ascii=False)
