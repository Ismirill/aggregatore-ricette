# Il sistema video di Gnamina

Progetto del 4 novembre 2026. Obiettivo: dal video girato con la regia dell'app (tre parti, al massimo 3 minuti) esce **un solo file verticale 9:16, con l'icona di Gnamina in basso a destra**, pronto da pubblicare su TikTok, Instagram Reels e YouTube Shorts. Vincoli di sempre: semplice per chi non è pratico, nessun costo, nessuno spazio cloud nostro.

## Cosa c'è oggi (versione 101)

- La regia (`recOpen` in `www/index.html`) accende la fotocamera a 1280×720 e registra tre clip separate con `MediaRecorder` (ingredienti 30 s, preparazione 120 s, piatto 30 s), ognuna rifacibile.
- Le tre clip restano sul telefono in IndexedDB; la ricetta ricorda solo durate e formato.
- «Condividi» passa i **tre file separati** al menù di condivisione del telefono; il contest vuole il link YouTube incollato a mano.
- Nessuna filigrana, nessun montaggio, formato dipendente dal telefono (MP4 su iPhone, spesso WebM su Android).

## Le decisioni

### 1. Il montaggio si fa sul telefono, senza server

Alla fine della regia, su «Usa questo video», l'app monta le tre parti in un unico video:

- un `canvas` 1080×1920 (720×1280 sui telefoni lenti o con poca memoria), su cui si disegnano i fotogrammi delle tre clip una dopo l'altra, ritagliati a riempire il formato verticale (`object-fit: cover`);
- sopra, **l'icona di Gnamina in basso a destra**: circa il 13 % della larghezza, margine 4 % dai bordi, angoli arrotondati e un'ombra morbida perché si legga anche sul bianco; va preparata una versione dell'icona con sfondo trasparente (quella attuale è un PNG RGB su fondo rosso);
- all'inizio una **scheda di 2 secondi** con il nome del piatto e «Ricetta di <nome Gnammer>», e in sovraimpressione per i primi 3 secondi di ogni parte l'etichetta «Gli ingredienti», «La preparazione», «Il piatto pronto»;
- l'audio delle clip passa da un `AudioContext` (`createMediaElementSource` → `MediaStreamDestination`) e si aggiunge come traccia allo stream del canvas (`canvas.captureStream(30)`);
- un `MediaRecorder` registra lo stream composto in un solo file, salvato in IndexedDB al posto delle tre clip (che si possono buttare).

Il montaggio dura quanto il video (fino a 3 minuti): si mostra una barra di avanzamento con «Sto montando il video, non chiudere l'app», poi l'anteprima. Si fa una volta sola.

### 2. Il formato: MP4 H.264/AAC, con due ripieghi

TikTok, Reels e Shorts vogliono tutti lo stesso file: **9:16, 1080×1920, MP4 con video H.264 e audio AAC**. Durata: Shorts fino a 3 minuti, Reels fino a 3 minuti (le fonti non ufficiali dicono anche di più), TikTok fino a 10. Il tetto di 3 minuti della regia va bene per tutti.

- **iPhone**: `MediaRecorder` produce già MP4 H.264/AAC. Niente da fare.
- **Android**: il WebView di Chrome dalla versione 126 sa scrivere MP4 (`video/mp4;codecs=avc1,mp4a.40.2`); si controlla con `isTypeSupported` all'avvio del montaggio. **Da verificare sul telefono vero**: finora non lo abbiamo mai provato.
- Se il telefono sa fare solo WebM: YouTube e TikTok lo accettano, Instagram no. Ripiego: codifica con **WebCodecs** (`VideoEncoder` H.264 + `AudioEncoder` AAC) e un piccolo muxer MP4 in JavaScript (libreria `mp4-muxer`, circa 20 KB, copiata nel progetto e non caricata da CDN). È lavoro in più: si decide solo dopo la prova su Android.

Non si fa: conversione sul server (il worker Cloudflare non può eseguire ffmpeg, il PC con la GPU non è raggiungibile da internet), ffmpeg.wasm nell'app (30 MB da scaricare e troppa memoria sui telefoni vecchi).

### 3. La pubblicazione: il menù di condivisione del telefono, non le API

Dopo il montaggio il pulsante grande è **«📤 Pubblica»**: apre il menù di condivisione del telefono con il file; la persona tocca TikTok, Instagram o YouTube e si trova nella schermata di pubblicazione di quell'app, con il video già caricato. Accanto, «💾 Salva nel rullino». Gnamina prepara la **didascalia** (titolo, «Ricetta su Gnamina», `#gnamina #ricetta` e il link alla ricetta) e la copia negli appunti con l'avviso «Nella descrizione tieni premuto e scegli Incolla».

Perché non le API dirette (ricontrollato il 4/11/2026):

| Piattaforma | Cosa chiede | Perché no, per ora |
|---|---|---|
| TikTok Content Posting API | revisione dell'app (2–4 settimane, video dimostrativo, privacy policy, dominio verificato); finché non è approvata i post escono **privati** | burocrazia, e un errore lascia i video invisibili |
| Instagram Graph API | account professionale, app Facebook, App Review per `instagram_content_publish`, pagina collegata | esclude le Gnammers con account normale |
| YouTube Data API | OAuth, quota di 10 000 unità al giorno (un caricamento ne costa 1 600, cioè circa 6 video al giorno per tutta l'app), e i video di app non verificate da Google restano **privati** | inutilizzabile per molte persone; forse per il solo canale ufficiale di Gnamina |

Il menù di condivisione funziona con qualunque account, senza revisioni, senza quote e senza costi. Le API restano un'idea per la fase 2, solo per il canale ufficiale (le vincitrici della settimana).

### 4. Dove sta nell'app

1. Regia come oggi (tre parti, rifacibili).
2. Schermata «Fatto!» → **«✓ Monta il video»** (al posto di «Usa questo video») → barra di avanzamento → anteprima a tutto schermo con l'icona in basso a destra.
3. Sotto l'anteprima: «📤 Pubblica», «💾 Salva nel rullino», «↺ Rifai». Nel passo finale della ricetta la riga del video dice «🎬 Video montato (2:40), con il marchio Gnamina» con gli stessi pulsanti.
4. Il contest continua a chiedere il link YouTube: dopo la pubblicazione su YouTube si incolla come oggi. Se in seguito il server dei contest (fase 2) terrà i voti, il link potrà essere anche TikTok o Instagram.

### 5. Le parti native

- **Android (APK)**: nel WebView `navigator.share` con file non c'è; il ponte `AndroidShare` in `MainActivity.java` sa già condividere un file via `FileProvider` (lo fa per il video della fotocamera). Serve un metodo nuovo `shareVideo(nome, base64)` che scriva il file nella cache dell'app e lanci `ACTION_SEND` con `video/mp4`, più `saveVideo` per il rullino (MediaStore). Da verificare: oggi «Condividi» delle tre clip nell'APK probabilmente non funziona per lo stesso motivo.
- **iPhone (Capacitor)**: `navigator.share` con file nel WKWebView va provato; se non va, si aggiunge il plugin `@capacitor/share` (gratuito) o un ponte come su Android.
- **Sito (PWA)**: `navigator.share` con file su Chrome Android e Safari iOS; sul computer si scarica il file.

### 6. Rischi e come li gestiamo

- **Memoria sui telefoni vecchi**: 1080×1920 a 30 fotogrammi per 3 minuti può bloccare un telefono da 2 GB; si parte a 720×1280 se `navigator.deviceMemory` ≤ 3 o se la prima prova fallisce.
- **Tre minuti di attesa**: l'app sta in primo piano con la barra; se va in sfondo (iOS sospende la pagina) il montaggio riparte dall'inizio con un avviso.
- **Audio dalle clip su iPhone**: `createMediaElementSource` su URL `blob:` va provato in WKWebView; in alternativa si decodifica il blob con `decodeAudioData` e si suona da un `BufferSource`, più robusto.
- **Instagram rifiuta WebM**: coperto dal ripiego WebCodecs (decisione dopo la prova Android).
- **Diritti**: nessuna musica aggiunta; solo l'audio della persona.
- **Icona su fondo rosso**: per la filigrana serve una versione a bollo con trasparenza, da ricavare dall'icona attuale (ritaglio tondo con bordo bianco sottile).

## Le tappe

| Tappa | Cosa esce | Versione |
|---|---|---|
| A | Montaggio delle tre parti in un file 9:16 con icona, scheda iniziale ed etichette; barra di avanzamento; anteprima; «Pubblica» e «Salva nel rullino» con quello che il telefono sa fare oggi; icona con trasparenza | 102 |
| B | Prova su Android e iPhone veri: formato prodotto, condivisione nell'APK (ponte `shareVideo`/`saveVideo`), condivisione in WKWebView | 103 |
| C | Se Android dà solo WebM: codifica WebCodecs + muxer MP4 | 104 |
| D | Didascalia pronta negli appunti con link alla ricetta e hashtag; «Come funziona» del contest aggiornato | con A o B |
| E (fase 2, forse) | Canale ufficiale Gnamina: pubblicazione automatica delle vincitrici via API YouTube dal workflow GitHub | dopo il 5/12 |

Prima di tutto, una prova veloce sul telefono Android dell'utente: aprire il sito, console, `MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')`. Dalla risposta dipende la tappa C.
