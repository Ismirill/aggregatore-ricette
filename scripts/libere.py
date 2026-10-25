#!/usr/bin/env python3
"""Ricette singole con licenza libera per i piatti quotidiani che mancano al ricettario -> www/libere.json.

Fonti, scelte una per una:
  - Wikipedia in italiano (CC BY-SA 4.0): sezione "Preparazione" delle voci di piatti; dosi e passaggi li ricava il server AI
  - Cookbook di Wikibooks in inglese (CC BY-SA 4.0): ricette con ingredienti e passaggi, tradotte in italiano dal server AI
  - ricette base dell'app (preparazioni elementari come l'insalata mista), scritte qui
Le ricette già ottenute restano salvate; gira in automatico su GitHub.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_ricette  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'www' / 'libere.json'
SRV = 'https://ricette-ai.ricettedelcuore.workers.dev'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)', 'Content-Type': 'application/json'}
CATS = ['Antipasti', 'Primi', 'Secondi', 'Contorni', 'Piatti unici', 'Lievitati', 'Dolci', 'Altro']

# Wikipedia in italiano: voce -> (titolo per l'app, tipo di piatto)
WIKIPEDIA = {
    'Pasta al pomodoro': ('Pasta al pomodoro', 'Primi'), 'Arrosticini': ('Arrosticini', 'Secondi'), 'Uovo sodo': ('Uova sode', 'Secondi'),
    'Uovo in camicia': ('Uova in camicia', 'Secondi'), 'Minestrone': ('Minestrone di verdure', 'Primi'), 'Pollo alla cacciatora': ('Pollo alla cacciatora', 'Secondi'),
    'Scaloppina': ('Scaloppine', 'Secondi'), 'Peperonata': ('Peperonata', 'Contorni'), 'Cicoria ripassata': ('Cicoria ripassata in padella', 'Contorni'),
    'Fagioli all\'uccelletto': ("Fagioli all'uccelletto", 'Contorni'), 'Pasta e patate': ('Pasta e patate', 'Primi'), 'Spezzatino': ('Spezzatino con patate', 'Secondi'),
}
# Cookbook inglese: pagina -> (titolo italiano, tipo di piatto)
COOKBOOK = {
    'Tuscan Roast Potatoes': ('Patate al forno alla toscana', 'Contorni'), 'Caprese Salad': ('Insalata caprese', 'Antipasti'),
    'Italian Meatballs': ('Polpette al sugo', 'Secondi'), 'Risotto ai Funghi': ('Risotto ai funghi', 'Primi'), 'Chicken Cacciatore': ('Pollo alla cacciatora', 'Secondi'),
    'Spaghetti with Clams': ('Spaghetti alle vongole', 'Primi'), 'Pasta and Bean Soup (Pasta e Fagioli)': ('Pasta e fagioli', 'Primi'),
    'Basic Polenta': ('Polenta', 'Primi'), 'Rice and Peas (Risi e Bisi)': ('Risi e bisi', 'Primi'), 'Stracciatella I': ('Stracciatella in brodo', 'Primi'),
    'Minestrone alla Capucina': ('Minestrone alla cappuccina', 'Primi'), 'Tuscan Bean Soup': ('Zuppa di fagioli alla toscana', 'Primi'),
    'Pasta alla Gricia (Pasta with Guanciale)': ('Pasta alla gricia', 'Primi'), 'Vitello Tonnato (Veal with Tuna Sauce)': ('Vitello tonnato', 'Secondi'),
    'Ossobuco Alla Milanese': ('Ossobuco alla milanese', 'Secondi'), 'Eggplant Parmesan (Melanzane alla Parmigiana) I': ('Parmigiana di melanzane', 'Secondi'),
    'Olive Ascolane (Stuffed Fried Olives)': ('Olive ascolane', 'Antipasti'), 'Piadina (Thin Italian Flatbread)': ('Piadina romagnola', 'Piatti unici'),
    'Focaccia (Genovese)': ('Focaccia genovese', 'Lievitati'), 'Pesto I': ('Pesto alla genovese', 'Altro'), 'Marsala Chicken Scallopini': ('Scaloppine al Marsala', 'Secondi'),
    'Italian Poached Salmon': ('Salmone in umido', 'Secondi'), 'Spaghetti alla Puttanesca': ('Spaghetti alla puttanesca', 'Primi'),
    'Bread with Tomato Sauce (Pappa al Pomodoro)': ('Pappa al pomodoro', 'Primi'), 'Panna Cotta with Red Fruit Sauce': ('Panna cotta ai frutti rossi', 'Dolci'),
    'Tiramisù': ('Tiramisù', 'Dolci'), 'Zucchini Pasta Bake': ('Pasta al forno con zucchine', 'Primi'), 'Italian Rice with Wild Mushrooms': ('Riso ai funghi', 'Primi'),
}
# Preparazioni elementari, scritte per l'app (nessun contenuto di terzi)
BASE = [
    {'title': 'Insalata mista', 'cat': 'Contorni', 'servings': 4, 'time': 10, 'ingredients': ['200 g lattuga o insalata di stagione', '2 pomodori', '1 carota', '1 finocchio o 1 cetriolo', 'olio extravergine q.b.', 'aceto o limone q.b.', 'sale q.b.'],
     'steps': ['Lavate e asciugate l\'insalata, poi spezzettatela con le mani in una ciotola.', 'Tagliate i pomodori a spicchi, la carota a julienne e il finocchio (o il cetriolo) a fettine sottili.', 'Condite al momento di servire con olio, aceto o limone e sale.']},
    {'title': 'Verdure grigliate', 'cat': 'Contorni', 'servings': 4, 'time': 25, 'ingredients': ['2 zucchine', '1 melanzana', '2 peperoni', 'olio extravergine q.b.', 'sale q.b.', 'prezzemolo o menta q.b.', '1 spicchio d\'aglio'],
     'steps': ['Tagliate le zucchine e la melanzana a fette di mezzo centimetro e i peperoni a falde.', 'Scaldate bene una griglia o una bistecchiera e grigliate le verdure 3-4 minuti per lato, finché sono tenere e segnate.', 'Disponetele su un piatto e conditele con olio, sale, aglio tritato finissimo e le erbe.']},
    {'title': 'Carote al burro', 'cat': 'Contorni', 'servings': 4, 'time': 25, 'ingredients': ['600 g carote', '30 g burro', 'sale q.b.', 'prezzemolo q.b.', 'acqua o brodo q.b.'],
     'steps': ['Pelate le carote e tagliatele a rondelle.', 'Scioglietele il burro in padella, aggiungete le carote, salate e coprite a filo con acqua o brodo.', 'Cuocete coperto a fuoco medio per 15-20 minuti finché il liquido si asciuga e le carote sono tenere; completate con prezzemolo tritato.']},
    {'title': 'Zucchine trifolate', 'cat': 'Contorni', 'servings': 4, 'time': 20, 'ingredients': ['600 g zucchine', '1 spicchio d\'aglio', '3 cucchiai olio extravergine', 'prezzemolo q.b.', 'sale q.b.', 'pepe q.b.'],
     'steps': ['Tagliate le zucchine a rondelle sottili.', 'Scaldate l\'olio con l\'aglio in padella, unite le zucchine e cuocete a fuoco vivace 10-12 minuti mescolando, finché sono dorate.', 'Salate, pepate e spolverate con prezzemolo tritato.']},
    {'title': 'Fagiolini all\'olio', 'cat': 'Contorni', 'servings': 4, 'time': 25, 'ingredients': ['500 g fagiolini', '3 cucchiai olio extravergine', '1 spicchio d\'aglio', 'sale q.b.', 'limone q.b.'],
     'steps': ['Spuntate i fagiolini e lessateli in acqua bollente salata per 12-15 minuti, finché sono teneri ma ancora verdi.', 'Scolateli e conditeli con olio, aglio tritato finissimo, sale e qualche goccia di limone.']},
    {'title': 'Pomodori gratinati', 'cat': 'Contorni', 'servings': 4, 'time': 35, 'ingredients': ['4 pomodori maturi', '60 g pangrattato', '2 cucchiai parmigiano grattugiato', '1 spicchio d\'aglio', 'prezzemolo q.b.', 'origano q.b.', 'olio extravergine q.b.', 'sale q.b.'],
     'steps': ['Tagliate i pomodori a metà, salateli e lasciateli scolare capovolti per 10 minuti.', 'Mescolate pangrattato, parmigiano, aglio e prezzemolo tritati, origano e un filo d\'olio.', 'Coprite i pomodori con il composto e cuocete in forno a 200 °C per 20-25 minuti, finché la superficie è dorata.']},
    {'title': 'Finocchi gratinati', 'cat': 'Contorni', 'servings': 4, 'time': 40, 'ingredients': ['3 finocchi', '30 g burro', '40 g parmigiano grattugiato', '30 g pangrattato', 'sale q.b.', 'pepe q.b.'],
     'steps': ['Pulite i finocchi, tagliateli a spicchi e lessateli 10 minuti in acqua salata; scolateli bene.', 'Disponeteli in una teglia imburrata, salate, pepate e cospargete con parmigiano e pangrattato; aggiungete fiocchetti di burro.', 'Gratinate in forno a 200 °C per 20 minuti, finché la superficie è dorata.']},
    {'title': 'Funghi trifolati', 'cat': 'Contorni', 'servings': 4, 'time': 20, 'ingredients': ['500 g funghi champignon o misti', '2 spicchi d\'aglio', '3 cucchiai olio extravergine', 'prezzemolo q.b.', 'sale q.b.', 'pepe q.b.'],
     'steps': ['Pulite i funghi con un panno umido e affettateli.', 'Scaldate l\'olio con l\'aglio, unite i funghi e cuocete a fuoco vivace 10 minuti finché l\'acqua è evaporata.', 'Salate, pepate e completate con prezzemolo tritato.']},
    {'title': 'Tonno e fagioli', 'cat': 'Secondi', 'servings': 4, 'time': 10, 'ingredients': ['2 scatolette tonno sott\'olio (160 g sgocciolato)', '400 g fagioli cannellini lessati', '1 cipolla rossa', 'olio extravergine q.b.', 'aceto q.b.', 'sale q.b.', 'pepe q.b.', 'prezzemolo q.b.'],
     'steps': ['Affettate finemente la cipolla e, se volete, tenetela 10 minuti in acqua fredda per addolcirla.', 'Unite i fagioli scolati, il tonno sgocciolato e la cipolla; condite con olio, poco aceto, sale e pepe.', 'Completate con prezzemolo tritato e servite con pane.']},
    {'title': 'Uova al tegamino', 'cat': 'Secondi', 'servings': 2, 'time': 8, 'ingredients': ['4 uova', '20 g burro o 2 cucchiai olio extravergine', 'sale q.b.', 'pepe q.b.'],
     'steps': ['Scaldate il burro o l\'olio in un padellino antiaderente a fuoco medio.', 'Rompete le uova nel padellino senza rompere i tuorli e cuocete 3-4 minuti, finché l\'albume è rappreso e il tuorlo ancora morbido.', 'Salate e pepate e servite subito con pane.']},
]


def api(base, **q):
    q.update(format='json', formatversion='2')
    return json.load(urllib.request.urlopen(urllib.request.Request(base + '?' + urllib.parse.urlencode(q), headers=UA), timeout=60))


def post(path, body):
    req = urllib.request.Request(SRV + path, data=json.dumps(body).encode(), headers=UA)
    return json.loads(urllib.request.urlopen(req, timeout=120).read())['result']


def wikitext_clean(t):
    t = re.sub(r'<ref[^>]*>.*?</ref>|<ref[^>]*/>|<!--.*?-->', '', t, flags=re.S)
    for _ in range(3):
        t = re.sub(r'\{\{[^{}]*\}\}', '', t)
    t = re.sub(r'\[\[(?:File|Image|Immagine|Categoria|Category):[^\]]*\]\]', '', t, flags=re.I)
    t = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', t)
    t = re.sub(r"'{2,}", '', t)
    return re.sub(r'<[^>]+>', '', t).strip()


def from_wikipedia(page, title, cat):
    r = api('https://it.wikipedia.org/w/api.php', action='parse', page=page, prop='wikitext|sections', redirects=1)
    secs, wt = r['parse']['sections'], r['parse']['wikitext']
    text = ''
    for s in secs:
        if re.search(r'prepar|ingredient|procediment|ricett', s['line'], re.I):
            m = re.search(r'==+\s*' + re.escape(s['line']) + r'\s*==+\n(.*?)(?=\n==[^=]|\Z)', wt, re.S)
            if m:
                text += '\n' + wikitext_clean(m.group(1))
    if len(text) < 150:
        return None
    url = 'https://it.wikipedia.org/wiki/' + urllib.parse.quote(r['parse']['title'].replace(' ', '_'))
    a = post('/analyze', {'url': url, 'source': 'Wikipedia', 'caption': f'{title}\n{text[:6000]}', 'cats': CATS}) or {}
    return {'id': 'wp-' + re.sub(r'\W+', '-', page.lower()).strip('-'), 'title': title, 'cat': cat, 'url': url, 'source': 'Wikipedia', 'license': 'CC BY-SA 4.0',
            'servings': a.get('servings') or None, 'time': a.get('time') or None, 'ingredients': a.get('ingredients') or [], 'steps': a.get('steps') or [text.strip()],
            'diets': a.get('diets') or [], 'text': text.strip()[:3000], 'country': 'Italia', 'region': a.get('region') or ''}


def from_cookbook(page, title, cat):
    r = api('https://en.wikibooks.org/w/api.php', action='parse', page='Cookbook:' + page, prop='wikitext')
    wt = r['parse']['wikitext']
    ing = re.search(r'==\s*Ingredients\s*==\n(.*?)(?=\n==[^=]|\Z)', wt, re.S)
    pro = re.search(r'==\s*(?:Procedure|Directions|Method|Preparation)\s*==\n(.*?)(?=\n==[^=]|\Z)', wt, re.S)
    if not ing or not pro:
        return None
    ings = [wikitext_clean(l.lstrip('*# ')) for l in ing.group(1).splitlines() if l.strip().startswith(('*', '#'))]
    steps = [wikitext_clean(l.lstrip('*# ')) for l in pro.group(1).splitlines() if l.strip().startswith(('*', '#'))]
    sv = re.search(r'servings\s*=\s*(\d+)', wt, re.I)
    t = post('/translate-recipe', {'recipe': {'name': page, 'summary': '', 'ingredients': [{'name': x, 'note': ''} for x in ings], 'steps': steps}})
    url = 'https://en.wikibooks.org/wiki/Cookbook:' + urllib.parse.quote(page.replace(' ', '_'))
    rec = {'id': 'cb-' + re.sub(r'\W+', '-', page.lower()).strip('-'), 'title': title, 'cat': cat, 'url': url, 'source': 'Wikibooks (Cookbook)', 'license': 'CC BY-SA 4.0',
           'servings': int(sv.group(1)) if sv else None, 'ingredients': [x['name'] for x in t['ingredients']], 'steps': t['steps'], 'diets': [], 'country': 'Italia', 'region': ''}
    # dosi in grammi dove possibile: le conversioni (oz, cup) le fa già la traduzione; qui solo il tempo stimato
    return rec


def main():
    prev = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'recipes': []}
    done = {r['id']: r for r in prev['recipes']}
    out, new = [], 0
    for page, (title, cat) in WIKIPEDIA.items():
        rid = 'wp-' + re.sub(r'\W+', '-', page.lower()).strip('-')
        if rid in done:
            out.append(done[rid]); continue
        try:
            rec = from_wikipedia(page, title, cat)
            if rec and rec['ingredients']:
                out.append(rec); new += 1
            time.sleep(4.5)
        except Exception as e:
            print('Wikipedia non riuscita', page, e)
    for page, (title, cat) in COOKBOOK.items():
        rid = 'cb-' + re.sub(r'\W+', '-', page.lower()).strip('-')
        if rid in done:
            out.append(done[rid]); continue
        try:
            rec = from_cookbook(page, title, cat)
            if rec and rec['ingredients']:
                out.append(rec); new += 1
            time.sleep(4.5)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print('Quota giornaliera esaurita: si continua domani.'); break
            print('Cookbook non riuscito', page, e.code)
        except Exception as e:
            print('Cookbook non riuscito', page, e)
    for b in BASE:
        out.append({**b, 'id': 'base-' + re.sub(r'\W+', '-', b['title'].lower()).strip('-'), 'url': 'https://ismirill.github.io/aggregatore-ricette/', 'source': 'Aggregatore Ricette',
                    'license': 'Ricetta base dell\'app', 'diets': [], 'country': 'Italia', 'region': ''})
    for r in out:
        for f in ('b', 'n', 'cov', 's', 'sub'):
            r.pop(f, None)
        res, _ = base_ricette.analyze(r) if r.get('ingredients') else (None, [])
        if res:
            r.update(res)
    base_ricette.RES.save()
    OUT.write_text(json.dumps({'updated': time.strftime('%Y-%m-%d'), 'recipes': out}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Ricette libere: {len(out)} ({new} nuove)')


if __name__ == '__main__':
    main()
