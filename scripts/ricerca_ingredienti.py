#!/usr/bin/env python3
"""Ricerca ampliata per gli ingredienti che la tabella (server/ingredienti.json) non riconosce.

Quattro livelli, dal più rapido al più lento; il primo che trova il prodotto vince:
  1. sinonimi e nomi regionali/stranieri (dizionario qui sotto)
  2. somiglianza con i nomi noti (plurali, accenti, errori di battitura)
  3. descrizione del prodotto su Wikipedia/Wikidata ("la gallinella è un pesce...")
  4. categoria del prodotto su Open Food Facts
Se il prodotto preciso non è in tabella si usa il prodotto analogo più vicino (stesso gruppo: calorie e prezzo simili).
Le risposte restano in scripts/ingredienti_appresi.json, così le ricerche successive sono immediate.
"""
import difflib
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'scripts' / 'ingredienti_appresi.json'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)'}

# Righe che non sono ingredienti (attrezzi, istruzioni): si ignorano
NOT_FOOD = re.compile(r'spago|stampo|vaso|vasett[io] di vetro|colino|forma circolare|teglia|carta (da )?forno|stuzzicadent|pellicola|sac [àa] poche|'
                      r'termometro|^baking$|^quindi |uno dei seguenti|varietà di salse|^l?\s*ingrediente|mestolo|frusta|ciotola|contenitor|barattolo vuoto|tovagliol|'
                      r'terrin[ae]|piatt[oi] fond|per involgere|^\s*per \d+ persone|a seconda dei|scegliere|a piacere$|montatore|temperatura|^\s*cucchiaio\s*$', re.I)

# 1. Sinonimi, nomi regionali e stranieri -> testo che la tabella riconosce
SYNONYMS = {
    'lauro': 'alloro', 'mistrà': 'liquore', 'mistra': 'liquore', 'kimel': 'liquore', 'rhum': 'rum', 'fioreta': 'ricotta', 'sapa': 'miele', 'mosto cotto': 'miele',
    'batata': 'patate', 'patata dolce': 'patate', 'patate dolci': 'patate', 'sbrinz': 'parmigiano', 'emmenthal': 'formaggio', 'vacherin': 'formaggio',
    'castelmagno': 'formaggio', 'raschera': 'formaggio', 'crème fraîche': 'panna', 'creme fraiche': 'panna', 'crema da cucina': 'panna',
    'grasso vegetale': 'margarina', 'cefali': 'pesce', 'cefalo': 'pesce', 'gallinella': 'pesce', 'triglia': 'pesce', 'triglie': 'pesce', 'arselle': 'vongole',
    'murici': 'cozze', 'canestrelli': 'capesante', 'cicale': 'scampi', 'chorizo': 'salame', 'sanguinaccio': 'salame', 'animella': 'animelle',
    'cervella': 'fegato', 'filone spinale': 'fegato', 'tettina': 'fegato', 'testone': 'fegato', 'orecchia': 'fegato', 'muso': 'fegato',
    'biancostato': 'manzo', 'scannello': 'manzo', 'verzini': 'salsiccia', 'corn flakes': 'cereali', 'fedelini': 'spaghetti', 'ferricelli': 'pasta',
    'fileja': 'pasta', 'grano duro cotto': 'farro', 'harissa': 'salsa', 'galanga': 'zenzero', 'radice di iris': 'spezie', 'aromi misti': 'erbe aromatiche',
    'fumo liquido': 'salsa', 'confettini': 'zucchero', 'diavoletti': 'zucchero', 'codette': 'zucchero', 'gelatina da dolci': 'gelatina in fogli',
    'fiori d\'arancio': 'liquore', 'acqua di fiori d\'arancio': 'liquore', 'crema pasticcera': 'latte', 'carosello': 'cetrioli', 'rapa': 'rape',
    'mais': 'mais dolce', 'carvi': 'cumino', 'caglio': 'lievito', 'ventresca': 'tonno', 'pesciolini': 'pesce', 'ricopertura': 'cioccolato',
    "fior d'arancio": 'liquore', 'smen': 'burro', 'verze': 'verza', 'pomidoro': 'pomodori', 'missoltini': 'pesce', 'aringa': 'pesce', 'serpillo': 'timo',
    'daikon': 'rape', 'kombu': 'verdure', 'martini': 'liquore', 'rane': 'pollo', 'casera': 'formaggio', 'prescinsôea': 'ricotta', 'prescinseua': 'ricotta',
    'fieno greco': 'spezie', 'gomma arabica': 'zucchero', 'malto': 'miele', 'meringa': 'zucchero', 'pizzoccheri': 'pasta', 'mosto': 'miele', 'puntine': 'salsiccia', 'divino': 'vino', 'nduja': 'salame', 'guanciale': 'guanciale', 'speck': 'speck',
}

# 3/4. Descrizione o categoria -> testo che la tabella riconosce (prodotto analogo)
GROUP_RULES = [
    (r'crostace|shrimp|prawn|crab|lobster', 'gamberi'), (r'bivalv|clam|mussel|oyster|scallop', 'vongole'), (r'mollus|gasteropod|cefalopod|squid|octopus', 'calamari'),
    (r'\bpesc[ei]\b|ittic|fish|tonno|salmone|merluzz', 'pesce'), (r'formagg|cacio|cheese', 'formaggio'), (r'salume|insaccat|salsicc|sanguinacc|sausage|cured meat|ham\b', 'salame'),
    (r'frattagli|interiora|ghiandol|cervell|midollo|offal|organ meat', 'fegato'), (r'carne|taglio (di|del)|bovin|manzo|beef|meat', 'manzo'),
    (r'liquor|distillat|acquavite|\brum\b|grappa|amaro|liqueur|spirit', 'liquore'), (r'\bvino\b|wine', 'vino'), (r'\bbirra\b|beer', 'birra'),
    (r'spezi|rizoma|radice aromatica|spice|seasoning', 'spezie'), (r'erba aromatica|pianta aromatica|herb', 'erbe aromatiche'),
    (r'tubero|patata|tuber|sweet potato', 'patate'), (r'formato di pasta|pasta (alimentare|secca|fresca)|pasta\b', 'pasta'),
    (r'cereal|grano|frumento|orzo|farro|grain', 'cereali'), (r'legum|fagiol|lenticch|cece|bean|lentil', 'legumi'),
    (r'brassic|cavol|cabbage', 'cavoli'), (r'ortagg|verdur|vegetable|bulbo', 'verdure varie'), (r'fung|mushroom', 'funghi'),
    (r'agrum|citrus', 'arance'), (r'frutt|bacca|fruit|berr', 'frutta'), (r'burro|margarin|grasso|butter|fat\b', 'burro'), (r'panna|cream|crème', 'panna'), (r'latte|milk', 'latte'), (r'olio|oil', 'olio'), (r'zucchero|confett|codett|decorazion|caramell|sugar|candy|sprinkle', 'zucchero'),
    (r'miele|sciropp|melass|honey|syrup', 'miele'), (r'cioccolat|chocolate', 'cioccolato'), (r'biscott|cookie|biscuit', 'biscotti'),
    (r'salsa|condiment|sauce|dressing|paste\b', 'salsa'), (r'pane|bread', 'pane'), (r'uov|egg', 'uova'),
]
GROUP_RX = [(re.compile(r, re.I), t) for r, t in GROUP_RULES]
NOT_THING = re.compile(r'comune|frazione|località|città|villaggio|fiume|lago|monte|regione|provincia|quartiere|calciatore|attore|attrice|cantante|scrittore|politico|film|album|singolo|serie televisiva|famiglia|cognome|personaggio|videogioco|azienda|squadra', re.I)
STOP = r"\b(di|del|della|dello|dei|degli|delle|d'|un|una|uno|q\.?b\.?|circa|cucchiai[oa]?|cucchiain[oi]|bicchier(?:e|i|ino|ini)|tazz[ae]|pizzico|spicchi?o?|fett[ae]|grammi?|gr|g|kg|ml|dl|cl|litr[oi]|mezz[oa]|grandi?|piccol[ei]|medi[oe]?|fresc[ho]|fresche|freschi|pezz(?:o|etto)|due|tre|quattro|sedici|a persona|grattugiat[oa]|tritat[oa]|puliti|eviscerati|compatta|con conchiglia|disponibile.*)\b"


def plain(t):
    return ''.join(c for c in unicodedata.normalize('NFD', t.lower()) if unicodedata.category(c) != 'Mn')


def name_of(line):
    """Il nome del prodotto in una riga di ingredienti ("100 g di sbrinz grattugiato" -> "sbrinz")."""
    t = re.sub(r'\([^)]*\)|[\d½¼¾,./;:]+', ' ', line.lower())
    t = re.sub(STOP, ' ', t)
    return re.sub(r'\s+', ' ', t).strip(" -'")


def get(url, timeout=30):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout))
    except Exception:
        return {}


def by_description(name):
    """3. Descrizione su Wikipedia (riassunto) o Wikidata."""
    for title in (name, name.capitalize()):
        d = get('https://it.wikipedia.org/api/rest_v1/page/summary/' + urllib.parse.quote(title.replace(' ', '_')))
        text = f"{d.get('description', '')} {d.get('extract', '')[:300]}"
        if NOT_THING.search(d.get('description', '') or d.get('extract', '')[:120]):
            continue
        if d.get('type') == 'standard' and text.strip():
            for rx, t in GROUP_RX:
                if rx.search(text):
                    return t, f'Wikipedia: {d.get("description") or d.get("extract", "")[:60]}'
    r = get('https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode({'action': 'wbsearchentities', 'search': name, 'language': 'it', 'uselang': 'it', 'format': 'json', 'limit': 3}))
    for e in r.get('search', []):
        if NOT_THING.search(e.get('description', '')):
            continue
        for rx, t in GROUP_RX:
            if rx.search(e.get('description', '')):
                return t, f'Wikidata: {e["description"]}'
    return None


def by_openfoodfacts(name):
    """4. Categoria del primo prodotto trovato su Open Food Facts."""
    r = get('https://world.openfoodfacts.org/cgi/search.pl?' + urllib.parse.urlencode({'search_terms': name, 'search_simple': 1, 'json': 1, 'page_size': 3, 'fields': 'categories_tags,product_name'}), 40)
    for p in r.get('products', []):
        cats = ' '.join(p.get('categories_tags', [])).replace('en:', ' ').replace('-', ' ')
        for rx, t in GROUP_RX:
            if rx.search(cats):
                return t, f'Open Food Facts: {p.get("product_name", "")[:40]}'
    return None


class Resolver:
    def __init__(self, entry, vocab):
        self.entry, self.vocab = entry, vocab  # entry(testo) -> voce della tabella o None
        self.cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
        self.online = 0

    def save(self):
        CACHE.write_text(json.dumps(dict(sorted(self.cache.items())), ensure_ascii=False, indent=0), encoding='utf-8')

    def resolve(self, line):
        """(voce della tabella, come è stata trovata) | ('skip', motivo) | None"""
        if NOT_FOOD.search(line):
            return 'skip', 'non è un ingrediente'
        name = name_of(line)
        if len(name) < 3:
            return None
        key = plain(name)
        if key in self.cache:
            c = self.cache[key]
            return (self.entry(c['as']), c['via']) if c.get('as') and self.entry(c['as']) else None
        found = None
        for syn, target in SYNONYMS.items():  # 1. sinonimi
            if re.search(r'\b' + re.escape(plain(syn)) + r'\b', key):
                found = (target, f'sinonimo di {target}'); break
        if not found:  # 2. somiglianza (plurali, accenti, errori di battitura)
            for w in [w for w in key.split() if not re.search(r'(at[aeio]|ut[aeio]|it[aeio])$', w) or len(w) < 5]:
                m = difflib.get_close_matches(w, self.vocab, n=1, cutoff=0.84)
                if m and self.entry(m[0]):
                    found = (m[0], f'simile a "{m[0]}"'); break
        if not found:  # 3 e 4. ricerca online
            self.online += 1
            found = by_description(name) or by_openfoodfacts(name)
            time.sleep(0.3)
        self.cache[key] = {'as': found[0], 'via': found[1]} if found else {'as': None, 'via': 'non trovato'}
        return (self.entry(found[0]), found[1]) if found and self.entry(found[0]) else None
