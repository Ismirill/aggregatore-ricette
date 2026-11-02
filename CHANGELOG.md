# Registro delle modifiche di Gnamina

Ogni passo del lavoro, dal più recente. Sito, app Android (APK) e app iOS escono sempre insieme dalla stessa versione: a ogni modifica GitHub pubblica il sito, compila l'APK e compila l'app iOS (vedi la scheda Actions).

Gli aggiornamenti notturni automatici del ricettario (traduzioni, Artusi, foto) non sono elencati qui: si vedono nella cronologia dei commit come «Aggiornamento automatico ricettario e versione».

## 2026-11-02
- **Versione 79**: nuova icona di Gnamina, scelta tra oltre cento bozze generate con MiniMax H3 sul PC con GPU dell'utente (ComfyUI): un adesivo a forma di pomodoro con picciolo in alto a destra che sporge dalla cornice, «Gnam» grande in lettere grasse e golose, «ina» piccola su un nastro, su fondo rosso. Aggiornati favicon, icone PWA (con versione «maskable» dedicata), icona adattiva Android (primo piano + colore di sfondo) e icona iOS. Testata ripulita: solo la nuova icona e il titolo della sezione, senza logotipo, separatore e sottotitolo.
- **Server**: endpoint `/brandimg` esteso ai modelli di immagini di Workers AI (Lucid Origin, Phoenix, SDXL); verificato che 18 bozze pesanti esauriscono la quota giornaliera gratuita, per cui le bozze del marchio si fanno sul PC dell'utente.

## 2026-11-01
- **Server**: endpoint `/brandimg` (solo amministratore, header `X-Admin`) per generare bozze del marchio da un prompt con i modelli di immagini gratuiti di Workers AI (FLUX schnell, Lucid Origin e Phoenix di Leonardo, SDXL Lightning) o con Gemini; verificato che Gemini non genera immagini nel piano gratuito (limite 0), i modelli Cloudflare sì, in 2-5 s.
- **Versione 78**: nuova ricetta passo per passo. Invece di un unico modulo da scorrere, dopo la scelta della fonte (link, scritta a mano, foto, file) il modulo si percorre una schermata alla volta, con i pallini e «Passo N di M» come nel percorso del menu: il link o la foto (Gnamina legge la ricetta da sola e dopo la lettura passa al controllo), il nome del piatto e il tipo, gli ingredienti, il procedimento, i dettagli facoltativi (diete, paese, valutazione, etichette, note) e infine riepilogo, video e «Salva la ricetta». Tasti «Indietro» e «Avanti» grandi, campi più larghi, un solo controllo per volta (il link, il nome del piatto), tipo di piatto, paese e diete dedotti dagli ingredienti se lasciati vuoti. Pensato per chi ha poca dimestichezza con il telefono. La modifica di una ricetta già salvata resta il modulo completo in una pagina. Nuovo tasto «📋 Incolla» accanto al link e scelta tra «Scatta la foto» e «Scegli dalla galleria».
- **Versione 77**: il video di una tua ricetta. Nel modulo della ricetta si registra un video (o se ne sceglie uno dal telefono) e lo si passa all'app YouTube, che lo carica sul canale dell'utente: Gnamina non offre spazio cloud e salva solo il link, incollato con un tasto. Il video compare nella scheda in «Le mie ricette» e, se la ricetta non ha foto, il fotogramma di YouTube fa da copertina. Android: ponte nativo (fotocamera → YouTube, con FileProvider); iOS: permessi fotocamera/microfono e menu di condivisione.
- **Server**: catena di fornitori AI verificata con le chiavi impostate (Gemini e Groq rispondono in 1-2 s su testo e foto; la trascrizione dei TikTok passa da Whisper di Groq in ~3 s, senza consumare la quota Cloudflare). Nuovo header `X-Provider` (solo amministratore, con `X-Admin`) per provare un singolo fornitore saltando la cache.

- Server: catena di fornitori AI, ognuno con il proprio piano gratuito. Workers AI (Cloudflare) resta il primo; quando esaurisce la quota del giorno o non risponde, il server passa a Gemini (Google AI Studio, `gemini-3.5-flash-lite`) e poi a Groq (`qwen/qwen3.8-27b`), entrambi con lettura delle immagini e risposta JSON. Per la trascrizione dei video, se c'è la chiave, Whisper di Groq (8 ore di audio al giorno gratis) viene usato per primo e quello di Cloudflare resta di riserva. Le chiavi sono segreti del worker (`GEMINI_KEY`, `GROQ_KEY`): senza chiavi tutto resta come prima. Le foto personali (quaderni, piatti) non vanno mai a Gemini, il cui piano gratuito usa i dati per migliorare i modelli
- Versione 76: tempo della ricetta ricostruito per intero. Regola: se il post dichiara chiaramente il tempo totale di preparazione vale quello; altrimenti l'AI ricostruisce il tempo passaggio per passaggio, con le durate scritte nel post così come sono e una stima realistica per i passaggi senza durata (lessare le patate «finché morbide», pelare e tagliare, intiepidire, formare le palline…). Prima la durata di un solo passaggio («friggitrice 20 minuti») diventava il totale. Il server tiene il conto tra la somma delle durate scritte e un tetto ragionevole; l'app scrive «tempo ≈ 65 min, stimato dai passaggi (lessare ≈25 + intiepidire ≈10 + … + friggitrice 20)», distinto da «indicato nel post» e «somma dei passaggi»
- Server: cache delle letture dei post e delle analisi AI (tabella `cache` su D1). La stessa ricetta condivisa da più persone costa una sola lettura esterna, una sola trascrizione del video e una sola chiamata al modello: la seconda volta la risposta arriva in un decimo di secondo. Chiave = impronta del link (senza parametri di tracciamento) o del testo; si salvano solo i risultati utili (niente pagine di accesso o analisi vuote); letture valide 3 giorni, analisi 30; pulizia notturna. Stimato –30/50% di quota AI con molti utenti
- Versione 75: ricette dai siti web che prima «non si trovavano». Cucchiaio d'Argento e Buonissimo (e chiunque usi lo stesso sistema editoriale) scrivono i dati schema.org con a capo letterali dentro le stringhe: il lettore JSON rifiutava l'intero blocco e la ricetta sembrava assente. Ora la lettura è tollerante (a capo, virgole finali, commenti HTML). GialloZafferano, Fatto in casa da Benedetta, Misya, Tavolartegusto, Ricette della Nonna leggevano già bene. Sul server il nome del sito non si tronca più all'apostrofo

## 2026-10-31

- Versione 74: eliminare (o modificare) una tua ricetta direttamente dall'elenco «Le mie»: tieni premuta la scheda, tocca il pulsante ⋯ in alto a destra della foto, o sul computer usa il tasto destro; si apre un menu con Modifica ed Elimina (con conferma). L'eliminazione vale anche per gli altri dispositivi sincronizzati
- Versione 73: l'AI ascolta il video. Per i TikTok il server scarica il video e trascrive il parlato (Whisper su Cloudflare, in italiano): ingredienti, dosi e tempi detti a voce valgono come testo del post, con gli stessi controlli di fedeltà. Per Instagram il video non è accessibile: si usano didascalia, hashtag e copertina. Il modello ora legge anche la copertina (ingredienti riconoscibili, testo sovrimpresso) e gli hashtag (#cannellini, #carote), e non usa più parole generiche («verdure», «legumi») quando sa quali sono; gli ingredienti visti nella foto arrivano a parte (seen)
- Versione 72: tempo totale della ricetta calcolato bene. Prima l'AI prendeva la durata di un solo passaggio (es. «12 minuti» di forno per una torta salata che ne richiede quasi due ore). Ora: se il post dichiara il totale («pronta in 30 minuti») vale quello; altrimenti si sommano le durate di tutti i passaggi (riposo dell'impasto, cotture, forno, raffreddamento), anche scritte a parole («una ventina di minuti», «mezz'ora, anche un'ora»); il server ricontrolla la somma sul testo e corregge l'AI se sbaglia; l'app indica «tempo ≈ N min, somma dei passaggi». Corretto anche «per 10 minuti» scambiato per «10 persone»
- Versione 71: ricette dai social più fedeli e lettura dei post corretta.
  - Instagram e Facebook dall'app Android: la WebView riceveva la pagina di accesso di Instagram (solo «Instagram», senza didascalia) e l'AI rispondeva «non trovo una ricetta». Ora per Instagram, Facebook, TikTok e Pinterest il post lo legge sempre il server dalla pagina di incorporamento; il browser legge da solo solo gli altri siti, e una pagina di accesso non viene più scambiata per il post
  - TikTok: oEmbed non dà più didascalia, autore e copertina; il server li prende dalla pagina di incorporamento (anche dai link corti vm/vt.tiktok.com)
  - Analisi AI «da trascrittore»: riporta solo ciò che è scritto nel post. Niente dosi tipiche, niente «q.b.» aggiunti, niente tempi o porzioni stimati; temperatura del modello bassa. Se il post non elenca gli ingredienti, dà solo i nomi tipici del piatto, senza dosi, e l'app lo dice chiaramente
  - Controllo meccanico sul server: ogni numero della risposta (dosi, tempo, porzioni) deve comparire nel testo del post, altrimenti viene tolto; tempo e porzioni scritti nel post vengono letti direttamente dal testo («pronta in 20 minuti», «per 2 persone»)
  - Didascalie Instagram: tolto anche il prefisso «13K likes, 71 comments - nome su data:»

## 2026-10-30

- Versione 70: corretto l'aggiornamento dell'APK che reinstallava la versione vecchia. Ogni versione ha ora un file con il suo numero (Gnamina-70.apk…), così il telefono non riapre l'APK già scaricato; il sito con il nuovo numero di versione esce solo quando l'APK è già scaricabile; l'avviso nell'app dice quale versione c'è e quale file aprire. AggregatoreRicette.apk resta il link fisso all'ultima versione
- Versione 69: il Ricettario si apre su «🇮🇹 Italiane» (tutte le ricette italiane, con i tipi di piatto nella seconda riga); restano Tutte, Colazione, Internazionali e le categorie; la ricerca cerca sempre in tutto il ricettario
- Versione 68: 35 ricette che erano in «Altro» spostate nella categoria giusta (es. hummus e guacamole negli antipasti, gazpacho nei primi, fagioli all'uccelletto nei contorni, shakshuka nei secondi, granita nei dolci); correzioni a mano in scripts/categorie.py (MANUAL), valide per tutte le fonti. In «Altro» restano salse, sughi, creme, impasti di base, brodi, bevande e liquori
- Versione 67: tolta dal Ricettario la sezione «Prodotti tipici» (193 schede della Regione Puglia di vini, formaggi, oli, frutta e conserve, senza ingredienti né procedimento); restano le ricette pugliesi vere; lo script puglia.py non scarica più i prodotti
- Versione 66: ✕ in alto per uscire subito, sempre visibile anche scorrendo, in «Nuova ricetta / Modifica», Impostazioni e riconoscimento da foto; nel percorso de «Il mio menu» freccia ← e ✕ anche in alto (sito, APK e iOS)
- Sito, APK e app iOS aggiornati insieme: GitHub compila anche l'app iOS a ogni modifica; nasce questo registro delle modifiche
- iOS: estensione Condividi verso Gnamina e link gnamina:// passati alla pagina
- App iOS con Capacitor: progetto Xcode, avvio a scene per iOS 27, icona e schermata di avvio di Gnamina

## 2026-10-29

- Artusi solo con i piatti ancora in uso e 109 piatti di tutti i giorni scritti per l'app
- Pixabay: tolto il controllo errato sulla forma della chiave
- Foto da Pixabay controllate a vista
- Fonti di foto, prezzi, nutrienti e piatti quotidiani nei riquadri nascosti di ogni sezione
- Pixabay: pulizia della chiave e controllo della forma
- Pixabay: User-Agent nella richiesta
- Ricerca manuale di foto su Pixabay
- Foto generate di primi e minestre controllate a vista

## 2026-10-28

- Altre foto vere da Wikipedia e Openverse controllate a vista
- 238 foto vere da Wikimedia Commons controllate a vista
- Foto AI rifatte da descrizioni scritte guardando foto reali dei piatti
- 18 foto vere da Wikimedia Commons al posto delle foto AI sbagliate
- Controllo a vista delle 110 foto AI: 70 sbagliate nascoste e rifatte per prime
- Foto AI fedeli alla ricetta: descrizione del piatto prima di generare, controllo e rifacimento delle vecchie
- La sezione Budget si chiama Il mio menu
- Account con email/password e Google, Apple, Facebook (Firebase Authentication)
- Backup su file: salva su iCloud Drive, Google Drive o nel telefono e ripristina dal file
- Ricette personali sincronizzate tra dispositivi con un codice ricettario

## 2026-10-27

- Foto cercate su banche di immagini libere (Openverse, Pexels, Pixabay) con verifica AI prima della generazione
- Lotto foto AI ridotto a 12 al giorno e messaggio di quota esaurita più chiaro

## 2026-10-26

- Varia menu: i piatti del menu precedente vengono penalizzati, così ogni variazione cambia davvero le portate
- Messaggio corretto quando la quota AI gratuita del giorno è esaurita (non «troppe richieste»); lotti giornalieri ridotti (Artusi 60, foto AI 25) per lasciare quota agli utenti
- Sottotitolo «la tua app di cucina»: titolo e descrizione della pagina, manifest, schermata di benvenuto, lista condivisa e splash Android
- Prima apertura: schermata di benvenuto in «Le mie ricette» con le tre azioni principali, i passi per salvare dai social e otto piatti del giorno dal Ricettario
- Nuova ricetta passo per passo: da un link, scritta a mano, fotografata (trascritta dall'AI con il nuovo endpoint /ocr) o da un file di testo/immagine; Annulla e «cambia» per tornare alla scelta
- Menu Budget: avvertenza nelle note (suggerimenti automatici, non una dieta né un consiglio medico o nutrizionale; responsabilità e verifica di etichette e allergeni)
- Pagina del menu Budget: lista della spesa come pulsante grande in alto, note/prezzi di stagione/fonti in un riquadro chiuso in fondo, scritte dei piatti più leggibili
- Budget: pulsante «Nuovo» al posto di «Modifica» e «Annulla» nel percorso guidato per tornare al menu già creato
- Ricettario: solo ricette complete (almeno 3 ingredienti e un procedimento vero); le altre restano fuori finché non vengono analizzate
- Workflow: variabili del passo foto AI in forma estesa (il blocco inline con ${{ }} non è YAML valido)
- Testata e schede in basso nel carattere del logo (Fredoka incorporato, funziona anche offline)
- Foto generate con l'AI per le ricette senza immagine: endpoint /genimg sul Worker (Flux Schnell, quota gratuita, protetto da segreto), script a lotti giornalieri che salva JPEG in www/img, foto applicate a tutte le fonti con nota e badge «AI»
- Tema predefinito: Trattoria chiara (Automatico solo se scelto nelle impostazioni)
- Fonti e licenze delle ricette spostate in fondo all'elenco, in un riquadro chiuso «Fonti e licenze delle ricette»
- Ricerca social dal telefono: su iPhone apre YouTube e Instagram con lo schema dell'app (la ricerca non si perde), Instagram per hashtag, fallback alla pagina web
- Pulsanti di ricerca online con icone e colori dei social (YouTube, TikTok, Instagram, Google)
- Ricerca senza risultati: propone le ricette con lo stesso nome nell'altra sezione e la ricerca online su YouTube, TikTok, Instagram e Google
- Nuovo nome e marchio: Gnamina. Logotipo Fredoka con punto della i a pomodoro in testata, icona con la G sul piatto morsicato (sito, iOS, Android adattiva e legacy), splash, manifest, titolo e nome app Android; rosso pomodoro come accento del tema Trattoria

## 2026-10-25

- Tipologie corrette dal nome del piatto: basi da sole (polenta, purè, cuscus, gnocchi senza condimento) e verdure/legumi conditi diventano contorni; pasta, risotti e minestre sempre primi; piatti esteri del ricettario esclusi dai menu italiani
- Lista della spesa in confezioni reali e per reparto; colazione (classica, dolce, salata, varia) e pane a tavola nel menu Budget; sezione Colazione nel Ricettario
- Lista della spesa condivisibile: pulsante Condividi (menu di condivisione Android, Web Share, altrimenti WhatsApp/e-mail/copia), testo con caselle da spuntare, costi e totale
- Menu Budget: domanda sui cibi già pronti (surgelati, confezionati, in scatola, gastronomia) nel percorso guidato
- Menu Budget realistici: elenco dei piatti italiani quotidiani con popolarità e area, procedura guidata in 5 passi con Varia menu, esclusione di piatti italo-americani e sostituti vegani; Artusi 1895 (pubblico dominio) e ricette singole libere (Wikipedia, Cookbook) importati
- Preparazioni di base (pasta frolla, brisée, sfoglia, creme, salse, brodi) mai come portate; Budget con costo e quantità di frutta e pane e prezzi al kg di frutta e verdura di stagione
- Copertine dei post social salvate dentro la ricetta (tramite il server), con riparazione automatica di quelle scadute; copertina anche dall'incorporamento Instagram
- Instagram: didascalia dalla pagina di incorporamento ufficiale con secondo tentativo, emoji decodificate, prefissi rimossi; avviso sulle dosi dedotte sempre presente

## 2026-10-24

- Automazione: parte sempre dall'ultima versione di main
- Sezione Internazionali nel Ricettario, suddivisa per paese con bandiere
- Ricette e prodotti tipici della Regione Puglia (CC BY 4.0) e ricette dal mondo UniTools tradotte in italiano (CC BY-SA 4.0), con traduzione automatica a lotti giornalieri
- 101 ricette collegate a GialloZafferano dall'Italian Gastronomic Recipes Dataset (CC BY 4.0), con link alla ricetta completa
- Nuova tipologia Lievitati (pane, pizza, focacce, brioche...) nel ricettario, nelle proprie ricette e nel Budget
- Stile Trattoria (tovaglia a quadretti) predefinito in modalità chiara; scelta dello stile Trattoria/Crema nelle impostazioni
- Lettura dei post Facebook/Instagram e dei siti dal server tramite anteprima pubblica dei link, con identificazione trasparente
- Post Facebook/Instagram: didascalia completa dalla pagina (APK), campo Descrizione con Incolla dagli appunti, descrizione dal Comando Rapido (?desc=)
- Ricerca ampliata degli ingredienti sconosciuti (sinonimi, somiglianza, Wikipedia/Wikidata, Open Food Facts) con prodotti analoghi; salvataggio automatico più robusto
- Lista della spesa: link di ricerca su Amazon per ogni prodotto e copia della lista; porzione di verdura cruda a 100 g
- Tipo di piatto verificato incrociando più fonti; più foto (Commons, Wikidata, Wikipedia inglese); filtri e ordinamenti per tempo, difficoltà e costo
- Scelta del tema: automatico, chiaro o scuro
- Nuova veste grafica: tema caldo chiaro/scuro, navigazione in basso, schede con foto, scheda ricetta con immagine grande; icona dell'app
- Foto dei piatti da Wikipedia/Wikimedia Commons con credito, cercate in automatico; pulsante Cerca su YouTube
- Tempo e difficoltà stimati per ogni ricetta, filtro per tempo; Budget chiede il tempo per cucinare (feriali/weekend), solo facili, preparazioni anticipate; vegetariano e pescetariano
- Corregge la lettura del numero di versione Android nella build automatica
- Autogestione: GitHub Actions aggiorna ricettario ogni mese, pubblica sito e APK; app ricalcola i costi a ogni cambio prezzi e avvisa delle nuove versioni
- Sezione Budget: menu bilanciato settimanale o per pasto, frutta e verdura di stagione, lista della spesa; base ricette calcolata in locale e costi mensili per zona dal server
- Ricettario: 708 ricette da Wikibooks (CC BY-SA 4.0) da sfogliare, cercare e salvare, con fonte citata
- Prezzi aggiornati mensilmente; riprova se il portale MIMIT non risponde; provincia vicina se mancano dati
- Prezzi ufficiali MIMIT per provincia, aggiornati ogni ~15 giorni; zona da posizione o GPS
- Pulsante Analizza, persone sempre visibili, calorie e costo a persona, aggiornamenti immediati
- Persone e ricalcolo dosi; AI senza ragionamento con risposta JSON (più veloce e affidabile)
- Blocca lo zoom automatico di Safari e i contenuti più larghi dello schermo
- Impostazioni riorganizzate e stili corretti per Safari su iPhone
- Server: messaggio chiaro quando aperto dal browser
- Collega l'app al server AI pubblicato su Cloudflare
- AI gratuita con Cloudflare Workers AI (Gemma 4) e ricette da GialloZafferano
- AI tramite server Cloudflare: nessuna chiave da inserire per l'utente
- Usa Google Gemini (piano gratuito) al posto di Claude per foto e analisi AI
- Ricerca ricette da foto e analisi AI dei post social con Claude
- Estrazione dati ricetta, diete, zona geografica, valutazione e video
- Aggregatore Ricette: raccoglitore di link di ricette (web app + APK)
