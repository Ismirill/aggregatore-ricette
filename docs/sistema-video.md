# Il sistema video di Gnamina

Progetto del 4 novembre 2026 (terza stesura). Obiettivo: quando una persona **registra un video con Gnamina**, la fotocamera dentro l'app riprende e **l'icona di Gnamina viene impressa in basso a destra mentre si gira**; il video finito, verticale 9:16, **viene salvato nel rullino del telefono** e da lì si condivide su TikTok, Instagram Reels, Facebook e YouTube Shorts: il file che arriva ai social porta già il marchio. Vale per il contest e per le ricette che uno aggiunge alla propria libreria. Vincoli di sempre: semplice per chi non è pratico, nessun costo, nessuno spazio cloud nostro.

## Cosa c'è oggi (versione 101)

- La regia (`recOpen` in `www/index.html`) accende la fotocamera a 1280×720 e registra tre clip separate con `MediaRecorder` (ingredienti 30 s, preparazione 120 s, piatto 30 s), ognuna rifacibile. Le clip restano in IndexedDB; «Condividi» passa i tre file separati al menù del telefono.
- «Registra un video» apre la fotocamera **del telefono** (app Fotocamera), «Scegli dal telefono» prende un file esistente: in entrambi i casi il video va su YouTube e nell'app resta il link.
- Nessun marchio, nessun salvataggio nel rullino, formato dipendente dal telefono (MP4 su iPhone, spesso WebM su Android).

## Le decisioni

### 1. Il marchio si imprime durante la ripresa

La fotocamera dentro l'app non registra più direttamente lo stream della camera. Lo stream va in un `<video>` nascosto; un ciclo di disegno (`requestAnimationFrame`, 30 fotogrammi al secondo) copia ogni fotogramma su un **canvas verticale** (720×1280; 1080×1920 sui telefoni con `navigator.deviceMemory` ≥ 4) ritagliandolo a riempire il quadro, e sopra disegna **l'icona di Gnamina in basso a destra**: circa il 13 % della larghezza, margine 4 % dai bordi, angoli arrotondati, ombra morbida perché si legga anche sul bianco. Il `MediaRecorder` registra `canvas.captureStream(30)` più la traccia audio del microfono. Quello che esce dal registratore **ha già il marchio**: non esiste un passaggio di montaggio dopo.

Sul canvas si possono aggiungere, sempre in diretta e senza costo: il nome del piatto nei primi 3 secondi e, nella regia, l'etichetta della parte («Gli ingredienti», «La preparazione», «Il piatto pronto») nei primi 3 secondi di ciascuna.

Serve una versione dell'icona **con sfondo trasparente** (bollo tondo con bordo bianco sottile): quella attuale è un PNG su fondo rosso pieno.

### 2. Tutte le riprese passano dalla fotocamera dentro l'app

- **«Registra con la guida»** (regia, contest): come oggi, tre parti con tempi scanditi, ma con il marchio impresso.
- **«Registra un video»** (libreria): non apre più l'app Fotocamera del telefono, che non può imprimere niente; apre la **stessa fotocamera dentro Gnamina in modo libero**, senza le tre parti, con orologio e stop a 3 minuti (avviso a 10 secondi dalla fine; «Continua fino a 10 minuti» per chi vuole un video lungo per TikTok o YouTube normale).
- **«Scegli dal telefono»**: un file già girato non può ricevere il marchio «durante la ripresa». Resta come oggi, solo per collegare il link YouTube, con la scritta «senza marchio Gnamina». *(Alternativa, se la si vuole: un passaggio di ri-codifica che imprime il marchio su un file esistente, lo stesso motore del canvas con il file al posto della camera; dura quanto il video. Da decidere.)*

### 3. Il video finito va nel rullino del telefono

Appena la registrazione finisce, l'app **salva il file nel rullino** (Foto su iPhone, Galleria su Android) in un album «Gnamina», e tiene una copia in IndexedDB per rivederlo dentro la scheda della ricetta. Da lì:

- **«📤 Pubblica»** apre il menù di condivisione del telefono con il file: la persona tocca TikTok, Instagram, Facebook o YouTube e si trova nella schermata di pubblicazione di quell'app con il video già caricato. Gnamina mette negli appunti la **didascalia** (titolo, «Ricetta su Gnamina», `#gnamina #ricetta`, link alla ricetta) e avvisa «Nella descrizione tieni premuto e scegli Incolla».
- Chi preferisce può aprire TikTok o Instagram da solo e scegliere il video dal rullino: è già pronto, con il marchio.
- Il contest continua a chiedere il link YouTube incollato come oggi (fase 2: anche link TikTok o Instagram, quando il server dei contest terrà i voti).

Come si salva nel rullino, per piattaforma:

| Dove | Salvare nel rullino | Condividere il file |
|---|---|---|
| APK Android | nuovo metodo `AndroidShare.saveVideo(nome, dati)` → `MediaStore.Video` nell'album «Gnamina» (nessun permesso dalla Android 10 in su; `WRITE_EXTERNAL_STORAGE` solo fino alla 9) | `AndroidShare.shareVideo` → file nella cache + `FileProvider` + `ACTION_SEND video/mp4` (lo stesso meccanismo già usato per il video della fotocamera) |
| App iPhone | plugin Capacitor gratuito (`@capacitor-community/media`) o ponte Swift con `PHPhotoLibrary`; serve `NSPhotoLibraryAddUsageDescription` in Info.plist | `navigator.share` con file nel WKWebView, da provare; altrimenti `@capacitor/share` |
| Sito (PWA) | Chrome Android: `navigator.share` → «Salva nel dispositivo»; Safari iPhone: `navigator.share` → «Salva video» | `navigator.share` con file; sul computer si scarica |

I file passano dal JavaScript al nativo in base64 a pezzi (un video di 3 minuti pesa circa 50 MB): da misurare.

### 4. Il formato: MP4 H.264/AAC

TikTok, Reels, Facebook e Shorts vogliono lo stesso file: **9:16, MP4 con video H.264 e audio AAC**, fino a 3 minuti per Shorts e Reels (TikTok 10). Il tetto di 3 minuti della regia va bene per tutti.

- **iPhone**: `MediaRecorder` scrive già MP4 H.264/AAC.
- **Android**: il WebView di Chrome dalla versione 126 sa scrivere MP4 (`video/mp4;codecs=avc1,mp4a.40.2`), si controlla con `isTypeSupported`. **Da verificare sul telefono vero**, mai provato.
- Se un telefono sa fare solo WebM: YouTube e TikTok lo accettano, Instagram e Facebook no. Ripiego: codifica con **WebCodecs** (`VideoEncoder` H.264 + `AudioEncoder` AAC) e il piccolo muxer `mp4-muxer` (circa 20 KB, copiato nel progetto). Si decide dopo la prova su Android.

Non si fa: conversione sul server (il worker Cloudflare non esegue ffmpeg, il PC con la GPU non è raggiungibile da internet), ffmpeg.wasm nell'app (30 MB e troppa memoria).

### 5. Perché non le API dei social

| Piattaforma | Cosa chiede | Perché no |
|---|---|---|
| TikTok Content Posting API | revisione dell'app (2–4 settimane); finché non è approvata i post escono **privati** | burocrazia, e un errore lascia i video invisibili |
| Instagram Graph API | account professionale, app Facebook, App Review per `instagram_content_publish` | esclude chi ha un account normale |
| Facebook Graph API | pubblica solo su Pagine, non sul profilo personale | quasi nessuno pubblica su una Pagina |
| YouTube Data API | OAuth, circa 6 caricamenti al giorno per tutta l'app; video **privati** finché Google non verifica l'app | inutilizzabile per molte persone |

Il rullino e il menù di condivisione funzionano con qualunque account, senza revisioni, quote o costi. Le API restano un'idea di fase 2 per il solo canale ufficiale di Gnamina (le vincitrici della settimana).

## La regia: tre parti rifacibili, unite alla fine (deciso il 4/11/2026)

Ogni parte della regia resta un file a sé, **già con il marchio impresso**, così «Rifai questa parte» continua a funzionare come oggi. Su «Usa questo video» l'app **unisce le tre parti in un solo file**: rilegge le clip una dopo l'altra in un `<video>` nascosto, le ridisegna sullo stesso canvas (senza aggiungere di nuovo l'icona, c'è già) con l'audio che passa da un `AudioContext`, e registra il risultato. L'unione dura quanto il video (fino a 3 minuti) con la barra «Sto unendo le tre parti, non chiudere l'app»; alla fine il file unico va nel rullino e in IndexedDB, e le tre clip si buttano. Se l'app va in sfondo durante l'unione (iPhone sospende la pagina), si riparte con un avviso. Le etichette delle parti si disegnano durante la ripresa, come il marchio.

Scartata l'alternativa della registrazione continua con pausa tra le parti (un solo file subito, ma senza «Rifai questa parte»): l'utente preferisce l'attesa finale.

Il modo libero («Registra un video») non ha parti: il file esce dal registratore già completo, senza unione.

## Rischi e come li gestiamo

- **Fotogrammi persi sui telefoni lenti**: il disegno su canvas a 30 fps a 720p regge sui telefoni degli ultimi 5–6 anni; se il ciclo misura meno di 20 fps nei primi secondi, si scende a 540×960. Da provare sul telefono Android dell'utente.
- **WKWebView (iPhone)**: `canvas.captureStream` + `MediaRecorder` funzionano da iOS 14.5; l'orientamento della camera e la rotazione del canvas vanno provati.
- **Permessi**: fotocamera e microfono ci sono già; su iPhone si aggiunge quello per salvare nelle Foto.
- **Peso dei file**: 3 minuti a 2,5 Mbit/s ≈ 55 MB; IndexedDB regge, il passaggio al nativo va fatto a pezzi.
- **Diritti**: nessuna musica aggiunta; solo l'audio della persona; il marchio solo su video girati con l'app.
- **Instagram rifiuta WebM**: coperto dal ripiego WebCodecs (decisione dopo la prova Android).

## Le tappe

| Tappa | Cosa esce | Versione |
|---|---|---|
| A | Fotocamera dentro l'app su canvas con icona (regia e modo libero), scheda iniziale ed etichette, unione finale delle tre parti con barra di avanzamento, salvataggio in IndexedDB, «Pubblica» e «Salva nel rullino» con quello che il telefono sa fare oggi (`navigator.share`), icona con trasparenza, «Registra un video» che apre la fotocamera dell'app | **103, fatta il 4/11/2026** (provata nel browser con la fotocamera finta; quadro 720×1280, 2,5 Mbit/s) |
| B | Rullino nativo: `saveVideo`/`shareVideo` nell'APK, plugin o ponte su iPhone con la descrizione d'uso; prova su telefoni veri (formato prodotto, fluidità, orientamento) | 104 |
| C | Se Android dà solo WebM: WebCodecs + muxer MP4 | 105 |
| D | Didascalia negli appunti con link e hashtag; «Come funziona» del contest aggiornato; eventuale marchio su file esistenti (vedi 2) | con B |
| E (fase 2, forse) | Canale ufficiale Gnamina: pubblicazione automatica delle vincitrici via API YouTube dal workflow GitHub | dopo il 5/12 |

Prima di tutto, una prova veloce sul telefono Android dell'utente: aprire il sito, console, `MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')`. Dalla risposta dipende la tappa C.
