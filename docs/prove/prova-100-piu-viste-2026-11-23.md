# Prova delle 100 ricette più viste sui social (23/11/2026)

**Come:** i video di ricette con più visualizzazioni, 25 per piattaforma.
- **YouTube:** ricerca italiana ordinata per visualizzazioni, da 5 a 557 milioni.
- **TikTok:** visualizzazioni lette dalla pagina del video, da 0,8 a 86 milioni.
- **Instagram:** visualizzazioni lette dalla pagina di incorporamento, da 0,4 a 21 milioni. Quasi tutti i reel sono in inglese o francese: tra i reel più visti trovati senza accesso non ce n'erano di italiani.
- **Facebook:** visualizzazioni dichiarate dalla pagina o dai risultati di ricerca, da 0,3 a 12 milioni.

L'app li ha importati uno ogni 15 secondi con il server vero, svuotando ogni volta anche tempo e porzioni. Il PC con Qwen era spento: il giudizio l'hanno dato quattro aiutanti Sonnet con le stesse regole del collaudatore del 19/11. Io ho poi controllato a mano i casi gravi.

## Risultati

| Piattaforma | Voto medio | Buone (4-5) | Scarse (1-2) |
|---|---|---|---|
| YouTube | 3,6 | 12 | 3 |
| TikTok | 3,9 | 16 | 4 |
| Instagram | 3,6 | 14 | 3 |
| Facebook | 3,2 | 11 | 8 |
| **Totale** | **3,6** | **53** | **18** |

- Nessun errore dell'app; 13 secondi in media per link.
- Due casi senza ricetta, entrambi di Emily Mariko: «Best lunch of the week!» e una didascalia vuota.

## Difetti veri (controllati a mano)

1. **Stessa ricetta su post diversi (Facebook, grave).**
   - Cosa succede: su 4 video la pagina di Facebook dà come testo solo «Video», e tutti e quattro escono come «Biscuit log». Il crème caramel e i cookies ripieni di Cookist sono tra questi.
   - Causa: la memoria delle analisi usa come chiave il testo del post e non il link, quindi testi uguali danno la stessa ricetta.
   - Rimedio: mettere il link nella chiave quando il testo è corto. Quando il testo è solo «Video», usare il titolo scritto nel link (es. `creme-caramel-il-segreto-per-renderlo-perfetto`).
2. **Elenco ingredienti in inglese o francese non riconosciuto (Instagram, Facebook).**
   - Cosa succede: il server riconosce l'elenco solo dalle parole italiane («ingredienti», «g», «cucchiai», «tazze»). Con «1 cup», «1/2 tsp», «Ingrédients», «tu auras besoin de» e gli elenchi puntati crede che gli ingredienti siano indovinati. Mostra l'avviso «il post non elenca gli ingredienti» e toglie le dosi: «tazza cottage cheese» senza «1».
   - Casi: 52, 59, 60, 63, 70, 74, 77.
3. **Descrizione tradotta in altre lingue presa come procedimento** (nella prova l'app sovrascriveva i campi come quando si incolla la descrizione: incollando il solo link i passaggi provvisori si svuotano).
   - Caso: pizza di Vito Iacopelli, 11 milioni di visualizzazioni. I passaggi sono la descrizione in spagnolo e in arabo, con gli inviti a iscriversi.
4. **Saluti e sponsor tra gli ingredienti.**
   - Esempi: «Buon appetito grazie per la visione», «Sponsor: Mulino Caputo», «Grazie per la vostra attenzione!», «Chosen Foods» dentro l'ingrediente.
5. **Tempo preso dal titolo acchiappa-clic.**
   - Esempi: «Dolce in 5 minuti» resta 5 minuti con 3-4 ore di frigo; «5 min» con 50 minuti di bagnomaria o 25 di forno.
   - Il controllo della v179 non scatta quando ingredienti e passaggi vengono dal video.
   - Casi: 9, 16, 24.
6. **Titoli generici.**
   - Esempi: «Pizza» per gli spiedini di penne, «Dolce con la mela», «Dolce con mela», «Dolce senza forno» per una torta di savoiardi.
   - Casi: 1, 6, 7, 22, 24, 42.
7. **Titoli e ingredienti rimasti in francese o in inglese.**
   - Esempi: «Tartes tarins salées», «Gaufres de pommes de terre», «Baked feta pasta», «pâte brisée», «lardons», «dumpling»; unità «libbre», «pollice», «oz».
8. **TikTok con didascalia vuota.**
   - L'app dice «Non riesco a leggere la pagina» invece di trascrivere il parlato del video, che la pagina rende disponibile.
9. **Ingredienti usati nei passaggi ma assenti dalla lista** (cannella, zucchero a velo, panna, miele).
   - Il modello salta ancora la regola del prompt in circa 1 ricetta su 10.

## Non difetti dell'app

- Post senza ricetta, con parlato inutile: il brasato di GialloZafferano («Sì, sì, sì…») e il salmon bowl.
- «Spaghetti alla carbonara» di Vincenzo's Plate con 2 ingredienti: il post ha solo il titolo.
  - Qui l'app avvisa correttamente che gli ingredienti sono indovinati.
  - Si potrebbe però far guardare il video a Gemini anche per Facebook, come già succede per YouTube.

File grezzi (fuori dal progetto): `scratchpad/prova-viste/risultati.jsonl`, `giudizi-*.jsonl`, elenchi dei link `yt25.tsv` e `social75.tsv`.

## Correzioni (versione 189)

Tutti i difetti 1-8 sono stati corretti (dettagli in CHANGELOG.md). Provate offline sui 100 risultati salvati:
- **Post stranieri:** 6 dei 7 post con l'elenco ora sono riconosciuti; resta indovinato solo il post francese con gli ingredienti scritti dentro la frase.
- **Ingredienti tolti e aggiunti:** saluti e sponsor tolti in 4 ricette; 20 ingredienti aggiunti dai passaggi, controllati a mano.
- **Nessun peggioramento:** sui 100 risultati del 19/11 le regole nuove cambiano solo 3 ricette, con aggiunte giuste («passata» in due ricette, «semola» per stendere).
- **Tempi:** i tempi dal video salgono a 25, 50 e 240 minuti dove erano 5.

Il messaggio dell'app per il TikTok senza testo è stato provato nel browser. Le parti che usano il modello (traduzione dei titoli, titolo dal video, chiave della memoria) si possono provare solo dopo aver ripubblicato il server.
