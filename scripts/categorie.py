#!/usr/bin/env python3
"""Classifica ogni ricetta del ricettario nel tipo di piatto giusto incrociando più fonti indipendenti:

  1. categorie di Wikibooks (es. "Primi piatti-Pasta", "Secondi piatti-Pesce")   peso 3
  2. descrizione della voce su Wikipedia o Wikidata (es. "primo piatto tipico...") peso 2
  3. nome del piatto (risotto, torta, polpette...)                                 peso 1,5
  4. composizione degli ingredienti (pasta/riso, zucchero+farina, carne/pesce...) peso 1

Vince il tipo con più punti; in www/categorie.json resta anche quali fonti l'hanno deciso.
Le descrizioni già scaricate vengono riusate: gira in automatico su GitHub dopo base_ricette.py.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / 'www' / 'ricettario.json'
OUT = ROOT / 'www' / 'categorie.json'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)'}
TYPES = ['Antipasti', 'Primi', 'Secondi', 'Contorni', 'Piatti unici', 'Lievitati', 'Dolci', 'Altro']

# Testo (categoria o descrizione) -> tipo. L'ordine conta: le regole più specifiche prima.
TEXT_RULES = [
    (r'pane e focacce|\bpizz[ae]\b|focacc|lievitat|impasti lievitati|\bpane\b|pagnott|brioche|panettone|pandoro|colomba|lievito madre|pasta madre|\bbread\b|bun\b|yeast', 'Lievitati'),
    (r'torte salate|torta salata|quiche|piadin|panin|street food|piatti unici|piatto unico|tramezzin|sandwich|burger|hamburger|tacos|burrito', 'Piatti unici'),
    (r'\bdolc[ei]\b|dessert|torte dolci|biscott|pasticc|gelat|semifredd|budin|cremè|crema pasticc|dolci al cucchiaio|cioccolat(?!o fondente amaro)|cake|pastry|cookie|biscuit|sweet|pudding|confection|ice cream|frittell[ae] dolc|tiramis|crostat|ciambell|panettone|colomba', 'Dolci'),
    (r'salse|salsa|sugo|sughi|condiment|ragù|pesto|brodo|fondo|bevand|liquor|cocktail|drink|tisan|conserv|marmellat|confettur|sottaceti|sottoli|spezie|marinat|sauce|beverage|liqueur|jam|preserve|dressing|condiment|stock\b|broth', 'Altro'),
    (r'contorn|side dish|insalat(?:a|e) (?:di|mista|verde)|verdure (?:al|in|ripien)|ortagg', 'Contorni'),
    (r'antipast|stuzzich|finger food|tapas|aperitiv|crostin|bruschett|appetizer|starter|hors', 'Antipasti'),
    (r'primi piatti|primo piatto|\bpasta\b|paste ripiene|risott|zupp|minestr|vellutat|gnocch|lasagn|first course|soup|noodle|pasta dish|risotto|polenta', 'Primi'),
    (r'secondi piatti|secondo piatto|piatto di carne|piatto di pesce|main course|stufat|arrost|bollit|brasat|spezzatin|polpett|frittat|omelette|stew|roast|meat dish|fish dish|seafood dish', 'Secondi'),
]
TEXT_RX = [(re.compile(r, re.I), t) for r, t in TEXT_RULES]

# Nome del piatto -> tipo (come nell'app, ma su tutte le ricette)
TITLE_RULES = [
    (r'\bpane\b|\bpan\b|pagnott|ciabatt|filone|panin[io] (al|di) latte|pizz[ae]\b|pizzett|focacc|grissin|taralli|friselle|brioche|cornett|croissant|panettone|pandoro|colomba|bab[aà]\b|krapfen|bomboloni|maritozz|pan brioche|lievito madre|pasta madre|bagel|pretzel|naan|pita|calzone|panzerott|sfincion|schiacciata|crescentina|tigelle', 'Lievitati'),
    (r'\btort[ae] (?!salat)|tiramis|biscott|cioccolat|crostat|cheese ?cake|gelat|muffin|dessert|panna cotta|ciambell|plumcake|brownie|pancake|cannol|semifredd|budin|crema (?!di (?:zucca|funghi|patate|porri|ceci|piselli|asparagi))|biscotti|frittell|zeppol|bign|sbrisolon|amaretti|cantucci|strudel|crêpe dolc|marmellata', 'Dolci'),
    (r'salsa|sugo|pesto|ragù|besciamella|maionese|brodo|liquore|rosolio|sciroppo|grappa|limoncello|cocktail|sangria|tisana|confettura|marmellata|sottaceti|crackers', 'Altro'),
    (r'piadina|panino|torta salata|quiche|burger|tacos|burrito|piatto unico|sformato di pasta|timballo', 'Piatti unici'),
    (r'pasta|spaghett|risott|lasagn|gnocch|tortellin|tagliatell|penne|ravioli|zupp|minestr|vellutat|linguine|fusilli|orecchiette|rigatoni|paccheri|bucatini|tagliolini|cannelloni|pici|trofie|ramen|noodle|canederl|agnolott|cappellett|cous ?cous|cuscus|pappardelle|maltagliat|strozzapret|cavatell|culurgion|malloreddus|passatelli|polenta|farinata', 'Primi'),
    (r'insalata|contorno|patate|verdur|zucchin|melanzan|spinaci|funghi|peperon|carciof|broccol|caponata|cavol|fagiolin|piselli|finocch|cipoll|carote|asparag|bietol|cime di rapa|ratatouille|purè|purea', 'Contorni'),
    (r'antipast|bruschett|crostin|tartin|stuzzichin|olive|frisella|crocchett|carpaccio|vitello tonnato|caprese|hummus|baba gan', 'Antipasti'),
    (r'pollo|carne|manzo|maiale|pesce|salmone|tonno|polpett|arrosto|filetto|bistecca|scaloppin|cotolett|spezzatino|gamber|merluzzo|tacchino|frittata|vitello|orata|branzino|spigola|salsiccia|abbacchio|agnell|coniglio|trippa|ossobuco|brasato|bollito|stinco|seppie|baccal|stoccafisso|polpo|calamar|cozze|involtin|spiedin|cotechino|fegato|anatra|faraona|acciugh|sarde|sgombr|uova|omelette', 'Secondi'),
]
TITLE_RX = [(re.compile(r, re.I), t) for r, t in TITLE_RULES]

# Preparazioni di base (impasti, creme, salse, brodi): mai primi o secondi, anche se il nome contiene "pasta"
BASE = re.compile(r"^(pasta (frolla|sfoglia|bris[eé]e?|choux|matta|di mandorle|reale|di zucchero|madre|per pizza|di pane)|lievito madre|pasta madre|pan di spagna|"
                  r"crema (pasticcera|chantilly|inglese|al burro)|besciamella|maionese|brodo|fondo|sugo|salsa|ragù|pesto|glassa|meringa|caramello|ganache|impasto|"
                  r"marmellata|confettura|gelatina|sciroppo|liquore|rosolio)\b", re.I)
SWEET_TITLE = re.compile(r"\bdolc[ei]\b|\bdolcetti\b", re.I)
STARCH = {'pasta', "pasta all'uovo", 'pasta fresca ripiena', 'riso', 'cereali', 'semola', 'farina di mais'}
PROTEIN = {'pollo e tacchino', 'coniglio', 'agnello', 'maiale', 'carne macinata', 'interiora', 'manzo e vitello', 'salmone', 'tonno in scatola',
           'acciughe', 'baccalà', 'cozze e vongole', 'crostacei', 'molluschi', 'pesce', 'uova', 'salumi', 'tofu e seitan'}
VEG = {'patate', 'zucchine', 'melanzane', 'peperoni', 'cetrioli', 'finocchi', 'cavoli', 'insalata', 'funghi', 'carciofi', 'asparagi', 'fagiolini',
       'piselli', 'zucca', 'verdure varie', 'pomodori', 'pomodorini', 'cipolla', 'carote', 'sedano'}
SWEET = {'zucchero', 'miele', 'cioccolato', 'cacao', 'marmellata', 'biscotti e dolci pronti', 'mascarpone', 'frutta essiccata'}
BAKE = {'farina', 'lievito', 'burro', 'uova', 'latte', 'panna'}


def api(url, **q):
    q.update(format='json', formatversion='2')
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(q), headers=UA)
    for i in range(3):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(3 * (i + 1))
    return {}


def descriptions(titles, known):
    """Descrizione breve di Wikipedia (italiano) per titolo; per le mancanti prova Wikidata."""
    out = dict(known)
    todo = [t for t in titles if t not in out]
    for i in range(0, len(todo), 50):
        g = todo[i:i + 50]
        r = api('https://it.wikipedia.org/w/api.php', action='query', titles='|'.join(g), prop='description', redirects='1')
        q = r.get('query', {})
        back = {x['to']: x['from'] for x in q.get('redirects', [])}
        norm = {x['to']: x['from'] for x in q.get('normalized', [])}
        for p in q.get('pages', []):
            t = p.get('title', '')
            orig = norm.get(back.get(t, t), back.get(t, t))
            if p.get('description') and not p.get('missing'):
                out[orig] = p['description']
        for t in g:
            out.setdefault(t, '')
        time.sleep(0.5)
    for t in [t for t in todo if not out.get(t)]:
        r = api('https://www.wikidata.org/w/api.php', action='wbsearchentities', search=t, language='it', uselang='it', type='item', limit='3')
        for e in r.get('search', []):
            if e.get('label', '').lower() == t.lower() and e.get('description'):
                out[t] = e['description']
                break
        time.sleep(0.2)
    return out


UNLEAVENED = re.compile(r'farinata|panell|paniss|cecina|piadin|tozzett|cantucc|biscott|cracker|frittell|pettole', re.I)
YEAST = re.compile(r"lievito (di birra|madre|secco|naturale|fresco)|pasta madre|lievito di pasta|lievito biologico", re.I)


def from_ingredients(r):
    """Tipo suggerito dalla composizione (grammi a persona per gruppo di ingredienti)."""
    if not r.get('b'):
        return None
    s = r.get('servings') or r.get('s') or 4
    g = defaultdict(float)
    for k, x in r['b']:
        for name, group in (('starch', STARCH), ('protein', PROTEIN), ('veg', VEG), ('sweet', SWEET), ('bake', BAKE)):
            if k in group:
                g[name] += x / s
    flour = sum(x for k, x in r['b'] if k in ('farina', 'semola', 'farina di mais')) / s
    if YEAST.search(' '.join(r.get('ingredients', []))) and flour >= 40:
        return 'Lievitati'
    if g['sweet'] >= 25 and g['protein'] < 40:
        return 'Dolci'
    if g['starch'] >= 50 and g['protein'] < 120:
        return 'Primi'
    if g['protein'] >= 100:
        return 'Secondi'
    if g['veg'] >= 120 and g['starch'] < 30 and g['protein'] < 40:
        return 'Contorni'
    return None


def first(rx_list, text):
    for rx, t in rx_list:
        if rx.search(text):
            return t
    return None


def main():
    data = json.loads(BOOK.read_text(encoding='utf-8'))
    prev = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    desc = descriptions([r['title'] for r in data['recipes']], prev.get('desc', {}))
    items, changed = {}, 0
    for r in data['recipes']:
        score, by = defaultdict(float), []
        for c in r.get('cats') or r.get('tags') or []:
            t = first(TEXT_RX, c)
            if t:
                score[t] += 3; by.append(f'wikibooks: {c}'); break
        d = desc.get(r['title'], '')
        t = d and first(TEXT_RX, d)
        if t:
            score[t] += 2; by.append(f'descrizione: {d}')
        t = first(TITLE_RX, r['title'])
        if t:
            score[t] += 1.5; by.append('nome del piatto')
        t = from_ingredients(r)
        if t:
            score[t] += 2.5 if t == 'Lievitati' else 1; by.append('ingredienti' + (' (lievito di birra o madre)' if t == 'Lievitati' else ''))
        # impasti senza lievito che Wikibooks mette tra "pane e focacce": farinata, panelle, piadina, biscotti...
        if score.get('Lievitati') and not YEAST.search(' '.join(r.get('ingredients', []))) and UNLEAVENED.search(r['title']):
            score.pop('Lievitati'); by.append('senza lievito')
            if not score:
                score[first(TITLE_RX, r['title']) or 'Antipasti'] = 1
        if BASE.search(r['title']):  # preparazione di base: ha la precedenza su tutto
            score = defaultdict(float, {'Altro': 10}); by.append('preparazione di base (impasto, crema, salsa o brodo)')
        elif SWEET_TITLE.search(r['title']):
            score['Dolci'] += 4; by.append('"dolci" nel nome')
        cat = max(score, key=lambda k: (score[k], -TYPES.index(k))) if score else 'Altro'
        conf = 'alta' if score and score[cat] >= 4 else 'media' if score and score[cat] >= 2.5 else 'bassa'
        items[r['id']] = {'cat': cat, 'conf': conf, 'by': by}
        if prev.get('items', {}).get(r['id'], {}).get('cat') not in (None, cat):
            changed += 1
    OUT.write_text(json.dumps({'updated': time.strftime('%Y-%m-%d'), 'items': items, 'desc': desc}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    count = defaultdict(int)
    for x in items.values():
        count[x['cat']] += 1
    print(dict(count), '| fiducia bassa:', sum(1 for x in items.values() if x['conf'] == 'bassa'), '| cambiate:', changed)


if __name__ == '__main__':
    main()
