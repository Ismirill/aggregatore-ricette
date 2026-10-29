#!/usr/bin/env python3
"""Pellegrino Artusi, "La scienza in cucina e l'arte di mangiar bene" (ed. 1895, trascrizione di Wikisource) -> www/artusi.json.

L'opera è di pubblico dominio (autore morto nel 1911). Il testo originale resta nella scheda; titolo moderno,
ingredienti con dosi, passaggi, persone e tipo di piatto li ricava il server AI dal testo (a lotti giornalieri,
al massimo LIMIT per esecuzione, come per le ricette dal mondo). Le ricette già analizzate restano salvate.
"""
import html
import json
import os
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
OUT = ROOT / 'www' / 'artusi.json'
WS = 'https://it.wikisource.org/w/api.php'
PREFIX = "La scienza in cucina e l'arte di mangiar bene (1895)/Ricette/"
AI = 'https://ricette-ai.ricettedelcuore.workers.dev/analyze'
UA = {'User-Agent': 'AggregatoreRicette/1.0 (https://ismirill.github.io/aggregatore-ricette/)', 'Content-Type': 'application/json'}
LIMIT = int(os.environ.get('ARTUSI_LIMIT', 120))
CATS = ['Antipasti', 'Primi', 'Secondi', 'Contorni', 'Piatti unici', 'Lievitati', 'Dolci', 'Altro']
# capitolo -> tipo di piatto (None = lo decide l'AI)
CHAPTERS = {
    'Minestre/Minestre in brodo': 'Primi', 'Minestre/Minestre asciutte e di magro': 'Primi', 'Principii': 'Antipasti', 'Salse': 'Altro',
    'Uova': 'Secondi', 'Paste e pastelle': 'Altro', 'Ripieni': 'Altro', 'Fritti': None, 'Tramessi': None, 'Umidi': 'Secondi', 'Rifreddi': None,
    'Erbaggi e legumi': 'Contorni', 'Piatti di pesce': 'Secondi', 'Arrosti': 'Secondi', 'Pasticceria': 'Dolci', 'Dolci al cucchiaio': 'Dolci',
    'Siroppi': 'Altro', 'Conserve': 'Altro', 'Liquori': 'Altro', 'Gelati': 'Dolci', 'Cose diverse': None,
}
LABEL = {k: k.split('/')[-1] for k in CHAPTERS}
# Ricette che si cucinano ancora oggi (numero di Artusi -> titolo moderno, '' = titolo già moderno): le altre restano nel file
# con "hide" e l'app non le mostra, perché sono piatti ormai fuori uso (cacciagione minuta, rigaglie, siroppi, rosoli...)
KEEP = {
    6: 'Cappelletti romagnoli', 7: '', 8: 'Tortellini bolognesi', 11: '', 16: 'Passatelli in brodo', 33: 'Riso e salsiccia', 38: '', 40: 'Riso e zucchine',
    41: 'Strichetti (farfalle) alla bolognese', 42: '', 44: '', 45: '', 50: '', 51: '', 52: 'Tagliatelle alla romagnola', 55: 'Risotto al nero di seppia',
    56: 'Risotto ai piselli', 57: 'Risotto al pomodoro', 58: '', 62: 'Risotto ai gamberi', 65: 'Maccheroni al sugo alla napoletana', 66: 'Maccheroni al ragù bolognese',
    67: 'Pasta con le sarde', 68: '', 70: 'Pappardelle all\'aretina', 71: 'Pappardelle al sugo di coniglio', 72: 'Pappardelle alla lepre', 73: '', 75: 'Ravioli alla genovese',
    76: '', 78: 'Spaghetti con i piselli', 80: 'Crostini ai capperi', 82: 'Crostini di fegatini (crostini toscani)', 90: '', 91: '', 95: '', 96: 'Maionese', 105: '',
    106: '', 107: 'Uova alla coque e sode', 108: 'Uova in camicia', 111: '', 112: '', 116: '', 118: 'Pastella per fritture', 125: 'Frittelle di ricotta', 127: 'Frittelle di mele',
    134: 'Fritto misto alla romana', 135: 'Frittelle di riso', 138: '', 142: '', 143: 'Zucchine fritte', 145: '', 149: 'Crocchette di patate', 151: 'Crocchette di riso',
    157: '', 159: 'Fegato al vino bianco', 160: '', 162: '', 166: '', 167: 'Cotolette ripiene', 175: '', 176: '', 177: 'Polenta con salsicce', 178: 'Polenta pasticciata al forno',
    179: 'Maccheroni gratinati alla besciamella', 187: 'Salsiccia con le uova', 190: '', 192: '', 194: 'Insalata russa', 198: '', 201: '', 202: 'Pollo al marsala',
    203: '', 205: 'Petti di pollo in padella', 218: '', 224: 'Brasato di manzo', 226: '', 228: '', 229: 'Involtini di vitello ripieni', 235: 'Polpette di bollito',
    236: '', 237: 'Polpettone alla fiorentina', 239: 'Agnello con i piselli', 242: 'Cotechino in camicia', 243: 'Spezzatino di manzo', 245: 'Spezzatino di vitello',
    246: '', 249: 'Trippa al sugo', 253: 'Fegato alla veneziana', 255: 'Filetto al marsala', 256: '', 260: 'Pasticcio di maccheroni al forno', 264: 'Lesso rifatto con le cipolle',
    265: 'Ossobuco', 267: '', 269: 'Arista di maiale al forno', 273: 'Zucchine ripiene', 274: 'Zucchine ripiene di magro', 275: 'Fagiolini e zucchine in padella', 280: '',
    282: '', 284: '', 285: '', 289: 'Funghi in umido', 291: 'Funghi alla griglia', 294: 'Melanzane fritte', 295: 'Melanzane in umido', 296: 'Melanzane alla griglia',
    297: 'Parmigiana di melanzane', 303: 'Cipolline in agrodolce', 306: 'Lenticchie in umido', 310: '', 312: 'Carciofi alla griglia', 314: 'Piselli alla francese',
    316: '', 318: 'Fave fresche stufate', 319: 'Pomodori ripieni', 320: 'Cavolfiore gratinato alla besciamella', 323: 'Broccoli saltati alla fiorentina',
    326: 'Cavolo nero in padella', 327: 'Finocchi gratinati alla besciamella', 329: 'Patate saltate in padella', 331: 'Purè di patate', 332: 'Tortino di zucchine',
    333: 'Tortino di patate', 335: 'Spinaci al burro', 337: '', 339: '', 340: 'Verza stufata', 341: '', 347: '', 349: 'Sogliole alla griglia', 350: 'Filetti di sogliola al vino',
    352: 'Triglie alla griglia', 354: '', 355: 'Tonno fresco con i piselli', 356: 'Tonno alla griglia', 360: 'Alici alla marinara', 361: 'Alici fritte', 362: 'Totani alla griglia',
    369: 'Telline alla livornese', 370: 'Seppie con i piselli', 376: '', 380: '', 381: 'Polpette di baccalà', 385: 'Palombo fritto', 386: 'Roast beef',
    387: 'Arrosto di vitello in casseruola', 388: 'Arrosto all\'aglio e rosmarino', 390: 'Agnello arrosto all\'aretina', 393: '', 397: '', 398: 'Pollo alla diavola',
    399: '', 400: 'Faraona arrosto', 401: 'Tacchino arrosto', 406: '', 409: '', 414: '', 416: 'Budino di nocciole', 417: 'Biscotti croccanti alle mandorle', 420: '',
    421: 'Torta Margherita', 422: '', 426: 'Torta ai pinoli', 431: '', 433: 'Cenci (chiacchiere)', 434: 'Schiacciata con i ciccioli', 436: 'Schiacciata livornese',
    437: '', 439: 'Biscotto al cioccolato', 442: 'Panettone', 443: 'Ciambelle (buccellati)', 444: 'Torta Maddalena', 445: 'Crostata di ricotta e mandorle', 447: 'Plumcake quattro quarti',
    451: 'Crostata di marmellata', 452: '', 454: '', 456: 'Fave dei morti', 460: '', 465: '', 466: 'Torta di riso', 467: '', 468: 'Torta di zucca', 471: '',
    479: 'Budino di riso', 483: 'Budino al limone', 484: 'Budino al cioccolato', 489: 'Plumcake', 490: 'Bavarese', 491: '', 499: 'Crema pasticcera', 501: 'Crema chantilly',
    503: 'Uova di neve (île flottante)', 504: 'Crème caramel', 506: 'Latteruolo (budino di latte)', 509: 'Pesche ripiene al forno', 513: 'Charlotte di mele',
    515: 'Soufflé al cioccolato', 520: 'Pere cotte', 532: 'Mele al forno', 533: '', 542: 'Passata di pomodoro', 543: 'Marmellata di albicocche', 549: 'Marmellata di arance',
    554: '', 555: '', 557: 'Gelato alla crema', 558: 'Gelato al cioccolato', 562: 'Gelato al pistacchio', 565: 'Macedonia di frutta',
}


def get(url, data=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


def chapter_text(ch):
    q = {'action': 'parse', 'page': PREFIX + ch, 'prop': 'text', 'format': 'json', 'formatversion': '2'}
    h = json.loads(get(WS + '?' + urllib.parse.urlencode(q)))['parse']['text']
    t = html.unescape(re.sub(r'<[^>]+>', '\n', h))
    t = re.sub(r'\[\s*p\.\s*\n?\s*\d+\s*\n?\s*modifica\s*\n?\]', '', t)  # segnaposto delle pagine
    t = re.sub(r'(\w)-\n(\w)', r'\1\2', t)  # parole spezzate a fine riga
    return re.sub(r'[ \t]+', ' ', t)


def split_recipes(text, ch):
    """Le ricette iniziano con "N. - Titolo" su una riga."""
    parts = re.split(r'^\s*(\d{1,3})\.\s*-\s*([^\n]{3,90})$', text, flags=re.M)
    out = []
    for i in range(1, len(parts) - 2, 3):
        n, title, body = int(parts[i]), parts[i + 1].strip().rstrip('.'), parts[i + 2]
        body = re.sub(r'\n(?![A-ZÈ«\d])', ' ', body.strip())  # ricompone le righe spezzate
        body = re.sub(r'\s{2,}', ' ', body).strip()
        if len(body) < 80 or n > 800:
            continue
        # "Burro, grammi 60." -> "60 g burro"
        ings = [f'{int(float(m.group(2).replace(",", ".")))} g {m.group(1).strip()}' for m in re.finditer(r'([A-ZÈ][^.,;:\n]{2,40}),\s*grammi\s*(\d+(?:[.,]\d+)?)', body)]
        m = re.search(r'per\s+(\d+|due|tre|quattro|cinque|sei|sette|otto|dieci|dodici)\s+persone', body, re.I)
        words = {'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5, 'sei': 6, 'sette': 7, 'otto': 8, 'dieci': 10, 'dodici': 12}
        out.append({'id': f'ar-{n}', 'num': n, 'origTitle': title, 'chapter': LABEL[ch], 'text': body[:6000], 'ings': ings,
                    'servings0': int(m.group(1)) if m and m.group(1).isdigit() else words.get((m.group(1).lower() if m else ''), None)})
    return out


def main():
    prev = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {'recipes': []}
    done = {r['id']: r for r in prev['recipes'] if r.get('analyzed')}
    raw = []
    for ch in CHAPTERS:
        try:
            raw += split_recipes(chapter_text(ch), ch)
        except Exception as e:
            print('capitolo non letto', ch, e)
        time.sleep(0.3)
    print(f'Artusi: {len(raw)} ricette lette da Wikisource, {len(done)} già analizzate')
    out, new, stop = [], 0, False
    for r in raw:
        if r['id'] in done:
            out.append(done[r['id']]); continue
        rec = {**r, 'title': r['origTitle'], 'cat': CHAPTERS[next(k for k, v in LABEL.items() if v == r['chapter'])] or 'Altro',
               'servings': r['servings0'], 'ingredients': r['ings'], 'steps': [r['text']], 'diets': [], 'analyzed': False}
        if not stop and new < LIMIT and r['num'] in KEEP:  # la quota AI va solo ai piatti che l'app mostra
            try:
                a = json.loads(get(AI, {'url': f'https://it.wikisource.org/wiki/{urllib.parse.quote(PREFIX.replace(" ", "_"))}', 'source': 'Artusi 1895',
                                         'caption': f"{r['origTitle']}\n{r['text']}\n(Testo del 1895 in italiano antico: traduci i nomi in italiano moderno, es. fagiuolini = fagiolini, presciutto = prosciutto, balsamella = besciamella, cazzaruola = casseruola, vitella di latte = vitello.)",
                                         'cats': CATS}))['result'] or {}
                time.sleep(4.5)
                new += 1
                if a.get('is_recipe') is False:
                    rec['analyzed'] = True  # non è una ricetta (es. consiglio): resta nel testo originale
                else:
                    hint = CHAPTERS[next(k for k, v in LABEL.items() if v == r['chapter'])]
                    rec.update(title=(a.get('title') or r['origTitle'])[:120], cat=hint or (a.get('cat') if a.get('cat') in CATS else 'Altro'),
                               servings=(lambda v: int(v) if str(v).isdigit() and 0 < int(v) <= 50 else r['servings0'])(a.get('servings')), time=a.get('time') or None,
                               ingredients=a.get('ingredients') or r['ings'], steps=a.get('steps') or [r['text']], diets=a.get('diets') or [],
                               country='Italia', region=a.get('region') or '', analyzed=True)
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print('Quota giornaliera esaurita: si continua domani.'); stop = True
                else:
                    print('analisi non riuscita', r['id'], e.code)
            except Exception as e:
                print('analisi non riuscita', r['id'], e)
        for f in ('b', 'n', 'cov', 's', 'sub'):
            rec.pop(f, None)
        res, _ = base_ricette.analyze(rec) if rec['ingredients'] else (None, [])
        if res:
            rec.update(res)
        rec.pop('hide', None)
        if rec['num'] not in KEEP:
            rec['hide'] = True
        elif KEEP[rec['num']] and rec.get('analyzed'):
            rec['title'] = KEEP[rec['num']]
        out.append(rec)
    base_ricette.RES.save()
    data = {'source': 'Pellegrino Artusi, La scienza in cucina e l\'arte di mangiar bene (1895)', 'url': 'https://it.wikisource.org/wiki/La_scienza_in_cucina_e_l%27arte_di_mangiar_bene_(1895)',
            'license': 'Pubblico dominio', 'updated': time.strftime('%Y-%m-%d'), 'total': len(raw), 'recipes': out}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"Artusi: {sum(1 for r in out if r.get('analyzed'))} analizzate su {len(out)} ({new} in questa esecuzione)")


if __name__ == '__main__':
    main()
