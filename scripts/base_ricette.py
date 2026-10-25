#!/usr/bin/env python3
"""Calcola in locale la "base" delle ricette del ricettario (www/ricettario.json), senza AI:
per ogni ricetta i grammi di ogni ingrediente (campo b) e calorie/macronutrienti a persona (campo n).

Il costo non viene salvato qui: lo calcolano app e server moltiplicando i grammi per i prezzi del mese
(Osservatorio Prezzi MIMIT per provincia + prezzi indicativi di server/ingredienti.json).
Da rilanciare dopo scripts/wikibooks.py o dopo modifiche a server/ingredienti.json.
Uso:  python3 scripts/base_ricette.py [--report]
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / 'www' / 'ricettario.json'
TABLE = json.loads((ROOT / 'server' / 'ingredienti.json').read_text(encoding='utf-8'))['items']
for it in TABLE:
    it['rx'] = re.compile(it['re'], re.I)

FRAC = {'½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3}
NUM = r'(\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?|[½¼¾⅓⅔])'
# unità -> grammi (None = usa il peso del pezzo dell'ingrediente)
UNITS = [
    (r'kg|chil[oi]', 1000), (r'hg|etti?', 100), (r'g|gr|grammi|grammo', 1),
    (r'l|lt|litr[oi]', 1000), (r'dl|decilitr[oi]', 100), (r'cl|centilitr[oi]', 10), (r'ml|millilitr[oi]|cc', 1),
    (r'cucchiai(?:o|ate?)?(?: da tavola)?|cucchiaiat[ae]', 15), (r'cucchiain[oi]', 5), (r'tazz(?:a|e)', 200), (r'tazzin[ae]', 60),
    (r'bicchier(?:e|i)', 150), (r'bicchierin[oi]', 50), (r'mestol[oi]', 100), (r'pizzic(?:o|hi)', 1), (r'noc(?:e|i)(?= di)', 10),
    (r'manciat[ae]', 30), (r'mazzett[oi]|mazz[oi]', 25), (r'ciuff[oi]', 10), (r'ramett[oi]|rametti', 3), (r'fogli[ae]', 1),
    (r'spicch(?:io|i)', 5), (r'fett[ae]|fettin[ae]', 30), (r'bustin[ae]', None), (r'scatol[ae]|lattin[ae]|barattol[oi]', 400),
    (r'confezion[ei]|pacc(?:o|hi)|panett[oi]', None), (r'vasett[oi]', 125), (r'goccio|gocce|spruzzo', 5), (r'dad[oi]', 10),
]
UNIT_RX = re.compile(r'^\s*(' + '|'.join(u for u, _ in UNITS) + r')\b\.?', re.I)
WORD_NUM = {'un': 1, 'uno': 1, 'una': 1, "un'": 1, 'mezzo': .5, 'mezza': .5, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5, 'sei': 6,
            'sette': 7, 'otto': 8, 'dieci': 10, 'dodici': 12, 'qualche': 3, 'alcuni': 3, 'alcune': 3, 'abbondante': 1}


def num(s):
    s = s.strip()
    if s in FRAC:
        return FRAC[s]
    if '/' in s:
        a, b = (float(x) for x in s.split('/'))
        if a > 16 or b > 16:  # "320/350 g" è un intervallo, non una frazione
            return (a + b) / 2
        return a / b if b else 0
    return float(s.replace(',', '.'))


def entry(line):
    # Vince l'ingrediente nominato per primo; a parità, il nome più lungo (es. "pomodori pelati" su "pomodori")
    for t in (re.sub(r'\([^)]*\)', ' ', line.lower()), line.lower()):  # prima senza le alternative tra parentesi
        best = None
        for i, it in enumerate(TABLE):
            m = it['rx'].search(t)
            if m and (best is None or (m.start(), -len(m.group()), i) < best[0]):
                best = ((m.start(), -len(m.group()), i), it)
        if best:
            return best[1]
    return None


def grams(line, it, servings):
    low = line.lower().replace('½', ' ½ ').replace('¼', ' ¼ ')
    outside = re.sub(r'\([^)]*\)', ' ', low)
    low = outside  # le quantità tra parentesi sono spesso alternative ("o 2 bustine"): si ignorano
    if re.search(r'\bq\.?\s?b\b|quanto basta|a piacere|per (?:ungere|spolverizzare|friggere|la frittura|guarnire|decorare)', low) and not re.search(NUM + r'\s*(?:g|gr|kg|ml|l)\b', low):
        return it['qb'] * servings / 4, False
    m = re.search(NUM + r'(?:\s*[-–]\s*' + NUM + r')?', low)
    if m:
        n = num(m.group(1))
        if m.group(2):
            n = (n + num(m.group(2))) / 2  # "2-3 spicchi" -> 2,5
        rest = low[m.end():]
    else:
        w = re.search(r"\b(" + '|'.join(re.escape(k) for k in WORD_NUM) + r")\b", low)
        if not w:
            return it['qb'] * servings / 4, False
        n, rest = WORD_NUM[w.group(1)], low[w.end():]
    if re.match(r'\s*(?:mezz[oa])\b', rest):
        n *= .5
        rest = re.sub(r'^\s*mezz[oa]', '', rest)
    u = UNIT_RX.match(rest)
    if u:
        unit = next(g for rx, g in UNITS if re.match(r'\s*(?:' + rx + r')\b', rest, re.I))
        if unit is None:  # bustina/confezione: dipende dall'ingrediente
            unit = 16 if it['k'] == 'lievito' else 0.5 if 'vanill' in low else it.get('pz') or 250
        if unit == 15 and it['k'].startswith('olio'):
            unit = 10
        return n * unit, True
    if 'pz' in it and n * it['pz'] <= 5000:  # "30 costolette" sono pezzi; "450 di tonno" sono grammi
        return n * it['pz'], True
    return (n if n >= 10 else n * 50), True  # numero senza unità: grammi se grande, porzioni se piccolo


# Ricerca ampliata per gli ingredienti non riconosciuti (sinonimi, somiglianza, Wikipedia/Wikidata, Open Food Facts)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ricerca_ingredienti import Resolver  # noqa: E402
VOCAB = sorted({w for it in TABLE for w in re.findall(r'[a-zàèéìòù]{4,}', re.sub(r'\\[bswd]|\(\?[!=<][^)]*\)', ' ', it['re'].lower()))})
RES = Resolver(entry, VOCAB)


def analyze(r):
    try:
        s = int(float(str(r.get('servings') or 4).replace(',', '.'))) or 4
    except (TypeError, ValueError):
        s = 4
    r['servings'] = s if r.get('servings') else r.get('servings')
    acc, matched, total, unknown, subs = Counter(), 0, 0, [], []
    for line in r['ingredients']:
        if re.match(r'^\s*(?:per |occorrente|ingredienti)\b.*:\s*$', line.lower()) or len(line) < 3:
            continue
        it = entry(line)
        if not it:
            found = RES.resolve(line)
            if found and found[0] == 'skip':
                continue  # attrezzo o istruzione, non un ingrediente
            if not found:
                total += 1
                unknown.append(line)
                continue
            it = found[0]
            subs.append([line, it['k'], found[1]])  # prodotto identificato o sostituito con un analogo
        total += 1
        g, _ = grams(line, it, s)
        acc[it['k']] += min(g, 5000)
        matched += 1
    if not total or matched / total < 0.6:
        return None, unknown
    by_k = {it['k']: it for it in TABLE}
    tot = {x: sum(by_k[k][x] * g / 100 for k, g in acc.items()) for x in ('kcal', 'p', 'c', 'f')}
    if not r.get('servings'):  # persone non indicate: stima ~600 kcal a porzione (almeno 4)
        s = max(4, round(tot['kcal'] / 600))
    n = {'k': round(tot['kcal'] / s), 'p': round(tot['p'] / s), 'c': round(tot['c'] / s), 'f': round(tot['f'] / s)}
    if not 20 <= n['k'] <= 3000:
        return None, unknown
    out = {'b': [[k, round(g)] for k, g in acc.items() if g >= 1], 'n': n, 'cov': round(matched / total, 2)}
    if subs:
        out['sub'] = subs
    if not r.get('servings'):
        out['s'] = s  # porzioni stimate
    return out, unknown


def main():
    data = json.loads(BOOK.read_text(encoding='utf-8'))
    unknown, ok = Counter(), 0
    for r in data['recipes']:
        for f in ('b', 'n', 'cov', 's', 'sub'):
            r.pop(f, None)
        res, unk = analyze(r) if r['ingredients'] else (None, [])
        unknown.update(re.sub(r'[\d½¼¾,./]+', '', u).strip().lower()[:40] for u in unk)
        if res:
            r.update(res)
            ok += 1
    RES.save()
    data['base'] = {'source': 'calcolo locale (server/ingredienti.json) + ricerca ampliata'}
    BOOK.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    nsub = sum(len(r.get('sub', [])) for r in data['recipes'])
    print(f"{ok} ricette su {len(data['recipes'])} con base calcolata; {nsub} ingredienti identificati con la ricerca ampliata ({RES.online} cercati online); {sum(unknown.values())} ancora sconosciuti")
    if '--report' in sys.argv:
        print('Ingredienti non riconosciuti più frequenti:', unknown.most_common(40))


if __name__ == '__main__':
    main()
