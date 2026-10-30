# Registro delle modifiche di Gnamina

Ogni passo del lavoro, dal più recente. Sito, app Android (APK) e app iOS escono sempre insieme dalla stessa versione: a ogni modifica GitHub pubblica il sito, compila l'APK e compila l'app iOS (vedi la scheda Actions).

Gli aggiornamenti notturni automatici del ricettario (traduzioni, Artusi, foto) non sono elencati qui: si vedono nella cronologia dei commit come «Aggiornamento automatico ricettario e versione».

## 2026-10-30

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
