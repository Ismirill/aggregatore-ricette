# Prova di 100 link social con collaudatore locale (19/11/2026)

**Come:** 100 link nuovi presi da Google e da YouTube (25 YouTube, 25 TikTok, 25 Instagram, 25 Facebook), diversi dai 120 delle prove del 17/11. L'app li ha importati uno ogni 15 secondi con il server vero. Il giudizio l'ha dato un modello locale sul PC con la scheda grafica (nessun token Claude): Claude ha solo orchestrato e controllato le segnalazioni prima di correggere.

**Scelta del collaudatore:** esame su 8 ricette con difetti noti (6 con un difetto, 2 pulite).

| Modello | Difetti trovati | Difetti inventati | Tempo |
|---|---|---|---|
| Qwen 3.8 27B | 7 | 3 | 8 s |
| Qwen 3.8 27B con ragionamento | 6 | 1 | 159 s |
| Qwen 3.6 35B | 7 | 3 | 124 s |
| **Qwen 3.6 35B con ragionamento** | 6 | **0** | 242 s |

Scelto Qwen 3.6 con ragionamento: l'unico senza falsi allarmi. Due correzioni al collaudatore dopo i primi giudizi: le ricette prese dal video (Gemini) o dal sito del cuoco non si confrontano con il testo del post, e la riga «(il post non elenca gli ingredienti…)» è un avviso voluto.

## Problemi veri trovati e corretti

1. **TikTok non funzionava per nessuno** (25 su 25: «TikTok non risponde»). TikTok ha cambiato la pagina di incorporamento: ora i dati arrivano dopo, con JavaScript, e il video senza cookie risponde 403. Il server legge la pagina del video come da iPhone (didascalia, autore, copertina, durata) e scarica il video con il cookie della pagina, così il parlato si trascrive ancora.
2. **Ricetta sbagliata dal sito del cuoco** (Fusi di pollo al forno con patate → presa «con finocchi e funghi»): il link «ricetta stampabile» portava all'elenco delle ricette e bastavano due parole in comune. Ora ogni parola del titolo del video deve ritrovarsi nel nome o negli ingredienti della ricetta del sito.
3. **Righe della descrizione tra i passaggi** (Polpette al sugo: capitoli del video, «INGREDIENTI», link e firme social): filtrate nel server e nell'app; se non resta un procedimento vero, Gemini guarda il video.
4. **Ingredienti dell'elenco scritto saltati dal modello** (risotto: «maggiorana»): se il post ha l'elenco «Ingredienti:» una voce per riga, le voci mancanti tornano in lista (righe di copyright e link escluse).
5. **Diete sbagliate** (cheesecake con biscotti segnata «Senza glutine»): le diete in contrasto con gli ingredienti si tolgono.
6. **«Risposta AI non valida»** su un post Facebook con parlato lungo: errore momentaneo; il server ora riprova una volta da solo.
7. **Messaggio sbagliato** quando nel post non c'è proprio la ricetta (focaccia: «elencati gli ingredienti tipici» con la lista vuota): ora dice che nel post non c'è la ricetta.
8. **Saluti finali come passaggio** («spero che vi piacciano… A presto!» dal sito di Benedetta): tolti.

## Segnalazioni non corrette (motivo)

- Tempi «165 min» ripetuti in tre ricette: residuo del mio giro di prova (il campo tempo non veniva svuotato tra un link e l'altro), non un errore dell'app.
- Dosi diverse tra sito del cuoco e descrizione del video (lasagne, parmigiana): il sito e la descrizione hanno versioni diverse della stessa ricetta.
- Ingredienti nominati nei passaggi e non in lista (passata, pasta): la regola c'è già nel prompt, il modello a volte la salta.
- «vino bianco» nel risotto resta fuori: il controllo lo crede presente perché c'è «aceto di vino bianco».
- Tempo totale dei siti che non conta il riposo in frigo (tiramisù, cheesecake): è il tempo scritto dal sito.
