#!/usr/bin/env python3
"""Converte l'"Italian Gastronomic Recipes Dataset" (Fossemò, Mignosi, Raggioli, Spezialetti, D'Asaro, Zenodo 2022,
doi:10.5281/zenodo.7265211, licenza CC BY 4.0) in www/collegate.json.

Il dataset contiene solo dati descrittivi di ricette di GialloZafferano (nome, categoria, tempo, difficoltà, livello di
costo, ingredienti in inglese con un peso relativo) e il link alla pagina originale: nell'app diventano ricette
"collegate" che rimandano a GialloZafferano per dosi e procedimento. Il dataset è fermo al 2022: lo script serve una volta.
Uso:  python3 scripts/zenodo.py <cartella estratta del dataset>
"""
import csv
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'www' / 'collegate.json'
CAT = {'First Course': 'Primi', 'Second Course': 'Secondi', 'Starter': 'Antipasti', 'Complete Meal': 'Piatti unici', 'Savoury Cake': 'Piatti unici'}
DIFF = {1: 1, 2: 1, 3: 2, 4: 3}  # GialloZafferano: molto facile, facile, media, difficile -> facile, facile, media, impegnativa
COST = ['', 'molto basso', 'basso', 'medio', 'elevato', 'molto elevato']
IT = {
    'Alice fish': 'alici', 'Almonds': 'mandorle', 'Anice': 'anice', 'Artichoke': 'carciofi', 'Asparagus': 'asparagi', 'Aubergine': 'melanzane',
    'Avocado': 'avocado', 'Bamboo Shoot': 'germogli di bambù', 'Basil': 'basilico', 'Batter': 'pastella', 'Beans': 'fagioli', 'Bechamel': 'besciamella',
    'Beef': 'manzo', 'Beef Broth': 'brodo di carne', 'Black Pepper': 'pepe nero', 'Blue Cheese': 'gorgonzola', 'Bread': 'pane', 'Broccoli': 'broccoli',
    'Burrata': 'burrata', 'Butter': 'burro', 'Caciocavallo Cheese': 'caciocavallo', 'Calamarata': 'calamarata', 'Capers': 'capperi', 'Cardamom': 'cardamomo',
    'Carrots': 'carote', 'Cayenne': 'pepe di Cayenna', 'Celery': 'sedano', 'Chicken Meat': 'pollo', 'Chickpeas': 'ceci', 'Chilli Peppers': 'peperoncino',
    'Chives': 'erba cipollina', 'Cinnamon': 'cannella', 'Clams': 'vongole', 'Clove': 'chiodi di garofano', 'Cod': 'merluzzo', 'Conchiglioni': 'conchiglioni',
    'Coriander': 'coriandolo', 'Corn Starch': 'amido di mais', 'Couscous': 'cous cous', 'Crabmeat': 'polpa di granchio', 'Cream': 'panna',
    'Cucumber': 'cetrioli', 'Cumin': 'cumino', 'Cuttlefish': 'seppie', 'Ditaloni': 'ditaloni', 'Edam': 'edamer', 'Eggs': 'uova', 'Farfalle': 'farfalle',
    'Flour': 'farina', 'Fontina Cheese': 'fontina', 'Fruit Juice': 'succo di frutta', 'Fusilli': 'fusilli', 'Garlic': 'aglio', 'Ginger': 'zenzero',
    'Guanciale': 'guanciale', 'Ham': 'prosciutto cotto', 'Lard': 'lardo', 'Latteria Cheese': 'formaggio latteria', 'Laurel': 'alloro', 'Leek': 'porri',
    'Lemon': 'limone', 'Lentils': 'lenticchie', 'Linguine': 'linguine', 'Marjoram': 'maggiorana', 'Milk': 'latte', 'Mint': 'menta', 'Mixed Pasta': 'pasta mista',
    'Mozzarella': 'mozzarella', 'Mushroom': 'funghi', 'Mussels': 'cozze', 'Nutmeg': 'noce moscata', 'Oil': 'olio extravergine', 'oil': 'olio extravergine',
    'Olives': 'olive', 'Onion': 'cipolla', 'Orechiette': 'orecchiette', 'Oregano': 'origano', 'Paccheri': 'paccheri', 'Pancetta': 'pancetta',
    'Paprika': 'paprika', 'Parmesan': 'parmigiano', 'Parsley': 'prezzemolo', 'Peanuts': 'arachidi', 'Peas': 'piselli', 'Pecorino Cheese': 'pecorino',
    'Penne': 'penne', 'Pepper': 'pepe', 'Pine Nut': 'pinoli', 'Pizzoccheri': 'pizzoccheri', 'Pork Meat': 'carne di maiale', 'Potato': 'patate',
    'Potato Starch': 'fecola di patate', 'Prawn': 'gamberi', 'Prosciutto': 'prosciutto crudo', 'Puff Pastry': 'pasta sfoglia', 'Pumpkin': 'zucca',
    'Rice': 'riso', 'Ricotta Cheese': 'ricotta', 'Rigatoni': 'rigatoni', 'Rocket': 'rucola', 'Rosemary': 'rosmarino', 'Saffron': 'zafferano', 'Sage': 'salvia',
    'Salami': 'salame', 'Salmon': 'salmone', 'Sardine': 'sardine', 'Sausage': 'salsiccia', 'Scallop': 'capesante', 'Scamorza Cheese': 'scamorza',
    'Scampi': 'scampi', 'Seaweed': 'alga nori', 'Semolina': 'semolino', 'Sesame': 'sesamo', 'Shallot': 'scalogno', 'Soy Sauce': 'salsa di soia',
    'Spaghetti': 'spaghetti', 'Squacquerone Cheese': 'squacquerone', 'Squid': 'calamari', 'Sugar': 'zucchero', 'Swordfish': 'pesce spada', 'Thyme': 'timo',
    'Tomato': 'pomodoro', 'Trofie': 'trofie', 'Tuna': 'tonno', 'Turmeric': 'curcuma', 'Turnip Greens': 'cime di rapa', 'Valtellina Cheese': 'formaggio Valtellina Casera',
    'Veal': 'vitello', 'Vegetable Broth': 'brodo vegetale', 'Vinegar': 'aceto', 'Wasabi': 'wasabi', 'Wine': 'vino', 'Yogurt': 'yogurt', 'Ziti': 'ziti',
    'Zucchini': 'zucchine', 'Zucchini Flowers': 'fiori di zucca',
}


def main(folder):
    rows = list(csv.reader(open(Path(folder) / 'foods' / 'CSV' / 'recipes.csv', encoding='utf-8-sig'), delimiter=';'))[1:]
    out = []
    for x in rows:
        if not x[0].strip() or 'giallozafferano' not in x[2]:
            continue
        ings = []
        for i in range(8, 8 + 18 * 3, 3):  # 18 coppie ingrediente / id / peso relativo (1-5)
            if i < len(x) and x[i].strip():
                ings.append((IT.get(x[i].strip(), x[i].strip().lower()), int(x[i + 2] or 0)))
        ings.sort(key=lambda t: -t[1])  # i più importanti per primi
        out.append({
            'id': 'gz-' + re.sub(r'\W+', '-', x[0].lower()).strip('-'), 'title': x[0].strip(), 'url': x[2].strip(),
            'cat': CAT.get(x[3].strip(), ''), 'time': int(x[7]) if x[7].strip().isdigit() else None,
            'diff': DIFF.get(int(x[6]), None) if x[6].strip().isdigit() else None,
            'cost': COST[int(x[5])] if x[5].strip().isdigit() and 0 < int(x[5]) < 6 else '',
            'ingredients': [n for n, _ in ings],
        })
    data = {'source': 'Italian Gastronomic Recipes Dataset (Fossemò, Mignosi, Raggioli, Spezialetti, D\'Asaro, 2022)',
            'doi': 'https://doi.org/10.5281/zenodo.7265211', 'license': 'CC BY 4.0', 'recipes': out}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(out)} ricette collegate salvate in {OUT}')


if __name__ == '__main__':
    main(sys.argv[1])
