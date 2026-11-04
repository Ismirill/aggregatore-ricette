"""Ingredienti dell'Artusi (1895) in parole di oggi.

Il modello traduce già l'italiano antico, ma lascia nomi di prodotti che non si trovano più o che oggi si chiamano
in un altro modo: farina d'Ungheria (una farina di grano tenero finissima: oggi farina 00), uva malaga e passolina
(uva passa, uvetta), lardone e carnesecca (pancetta), zucchero in polvere (semolato), rhum, vainiglia, rossi d'uovo…
Queste sostituzioni si applicano a ingredienti e passi di ogni ricetta, a ogni esecuzione di artusi.py; il testo
originale (campo «text») resta com'è. Da solo: `python3 scripts/artusi_moderno.py` aggiorna www/artusi.json.
"""
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'www' / 'artusi.json'

# (regex, sostituzione): l'ordine conta, le frasi lunghe prima delle parole sole; tutto senza distinzione di maiuscole
RULES = [
    (r"farina (?:fine o )?d[’']ungheria(?: o finissima)?", 'farina 00'),
    (r"farina di ungheria(?: o finissima)?", 'farina 00'),
    (r"\bd[’']ungheria\b", '00'),
    (r"uva(?: secca)?(?: di)? m[aà]laga", 'uva passa'),
    (r"\buva passolina\b", 'uvetta sultanina'),
    (r"\bpassolina\b", 'uvetta sultanina'),
    (r"\buvetta \(zibibbo\)", 'uvetta'),
    (r"\buva (?:secca|passa) o zibibbo\b", 'uva passa'),
    (r"\bzibibbo\b", 'uva passa'),
    (r"\bcotenne di lardone\b", 'cotenne di maiale'),
    (r"\blardone o carnesecca\b", 'pancetta'),
    (r"\blardone\b", 'pancetta'),
    (r"\bcarnesecca\b", 'pancetta'),
    (r"\blardo vergine\b", 'lardo'),
    (r"\bcacio raviggiolo\b", 'stracchino'),
    (r"\braviggiolo\b", 'stracchino'),
    (r"\b(?:cacio |formaggio )?(?:gruviera|gruyère|gruyere)\b", 'groviera'),
    (r"\bcacio parmigiano\b", 'parmigiano'),
    (r"\bcacio\b", 'formaggio'),
    (r"\bcioccolata\b", 'cioccolato fondente'),
    (r"\bzucchero\s+(?:fine\s+)?in\s+polvere\b", 'zucchero semolato'),
    (r"\bzucchero bianco fine\b", 'zucchero semolato'),
    (r"\bzucchero fine\b", 'zucchero semolato'),
    (r"\bzucchero bianco\b", 'zucchero'),
    (r"\bzucchero biondo\b", 'zucchero di canna'),
    (r"\brhum\b", 'rum'),
    (r"\bacquavite\b", 'grappa'),
    (r"\bspirito di vino\b", 'alcol per liquori'),
    (r"\blingua salata\b", 'lingua salmistrata'),
    (r"\bsemolino di granturco\b", 'farina di mais a grana grossa'),
    (r"\bfarina di granturco\b", 'farina di mais'),
    (r"\bgranturco\b", 'mais'),
    (r"\bfarina di grano\b(?! (?:saraceno|duro|tenero))", 'farina'),
    (r"\bfarina di patate\b", 'fecola di patate'),
    (r"\bsugo di pomodoro o conserva\b", 'passata di pomodoro o concentrato'),
    (r"\bconserva di pomodoro\b", 'concentrato di pomodoro'),
    (r"\bconserva di frutta\b", 'marmellata'),
    (r"\b(o|di|con|poca) conserva\b", r'\1 concentrato di pomodoro'),
    (r"\bla conserva\b", 'il concentrato di pomodoro'),
    (r"\bdella conserva\b", 'del concentrato di pomodoro'),
    (r"\balla conserva\b", 'al concentrato di pomodoro'),
    (r"\bvino bianco buono\b", 'vino bianco secco'),
    (r"\bolio (?:buono|fino)\b", 'olio extravergine di oliva'),
    (r"\bmadera o marsala\b", 'marsala'),
    (r"\bmadera\b", 'marsala'),
    (r"\bvino di cipro\b", 'marsala'),
    (r"\brosolio\b", 'liquore dolce'),
    (r"\bvainiglia\b", 'vaniglia'),
    (r"\brossi d[’']uov[oa]\b", 'tuorli'),
    (r"\brosso d[’']uovo\b", 'tuorlo'),
    (r"\bchiare d[’']uov[oa]\b", 'albumi'),
    (r"\bchiara d[’']uovo\b", 'albume'),
    (r"\btorlo\b", 'tuorlo'),
    (r"\btorli\b", 'tuorli'),
    (r"\bgrattato\b", 'grattugiato'),
    (r"\bgrattata\b", 'grattugiata'),
    (r"\bgrattati\b", 'grattugiati'),
    (r"\bgrattate\b", 'grattugiate'),
    (r"\barancio candito\b", 'arancia candita'),
    (r"(?<!fior d[’'])(?<!fiori d[’'])\barancio\b", 'arancia'),
    (r"\baranci\b", 'arance'),
    (r"\bburro fresco\b", 'burro'),
    (r"\bpresciutto\b", 'prosciutto'),
    (r"\bprosciutto grasso e magro\b", 'prosciutto crudo'),
    (r"\brossi delle uova\b", 'tuorli'),
    (r"\brosso dell[’']uovo\b", 'tuorlo'),
    (r"\bchiare delle uova\b", 'albumi'),
    (r"\bdelle chiare\b", 'degli albumi'),
    (r"\bdalle chiare\b", 'dagli albumi'),
    (r"\buova: chiare\b", 'uova: albumi'),
    (r"\ble (due|tre|quattro|cinque|sei|otto|dieci) chiare\b", r'i \1 albumi'),
    (r"\ble chiare\b", 'gli albumi'),
    (r"\bchiare montate\b", 'albumi montati'),
    (r"\bchiare rimaste\b", 'albumi rimasti'),
    (r"\bchiare\b(?= (?:e tuorli|a neve|sode|ben sode|montate|d[’']uov))", 'albumi'),
    (r"\b(?:tre|due|quattro|sei) chiare\b", lambda m: m.group(0).split()[0] + ' albumi'),
    (r"\balla m[aà]laga\b", "all'uva passa"),
    (r"\bconserva di (albicocche|pesche|fragole|lamponi|cotogne|prugne|ciliegie|more|ribes|arance|fichi)\b", r'marmellata di \1'),
    (r"pomodoro/conserva", 'pomodoro/concentrato'),
    (r"\bodore di\b", "un po' di"),
]
_RX = [(re.compile(p, re.I), s) for p, s in RULES]


def moderna(s):
    if not isinstance(s, str):
        return s
    for rx, sub in _RX:
        s = rx.sub(sub, s)
    return s


def moderna_rec(rec):
    """Applica le sostituzioni a ingredienti e passi (non al testo originale né al titolo)."""
    for k in ('ingredients', 'steps'):
        if isinstance(rec.get(k), list):
            rec[k] = [moderna(x) for x in rec[k]]
    return rec


if __name__ == '__main__':
    data = json.loads(OUT.read_text(encoding='utf-8'))
    before = json.dumps(data['recipes'], ensure_ascii=False)
    n = 0
    for r in data['recipes']:
        old = json.dumps({k: r.get(k) for k in ('ingredients', 'steps')}, ensure_ascii=False)
        moderna_rec(r)
        if json.dumps({k: r.get(k) for k in ('ingredients', 'steps')}, ensure_ascii=False) != old:
            n += 1
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Artusi: ingredienti e passi aggiornati in {n} ricette su {len(data["recipes"])}')
