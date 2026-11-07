# Gnamina

La tua app di cucina: ricette dai social (TikTok, Instagram, YouTube, Facebook, siti), un ricettario di piatti italiani e dal mondo, contest settimanali tra Gnammers, menu a budget e lista della spesa. Pensata per essere semplice, anche per chi non ha dimestichezza con il telefono, e a costo zero.

- **Sito e app web**: https://gnamina.it (si installa dalla pagina, su iPhone e Android)
- **App Android (APK)**: https://github.com/Ismirill/aggregatore-ricette/releases/tag/apk (il file `Gnamina-<versione>.apk` più recente; dentro l'app l'aggiornamento è automatico)
- **App iOS**: progetto Capacitor nella cartella `ios/`

Sito, APK e app iOS escono sempre insieme dalla stessa versione: a ogni modifica GitHub pubblica il sito, compila l'APK e compila l'app iOS. Ogni passo è annotato in [CHANGELOG.md](CHANGELOG.md).

## Com'è fatta

- `www/`: l'app intera (un solo `index.html`, service worker, dati del ricettario, foto, avatar).
- `server/`: il server su Cloudflare Workers (analisi dei link con l'AI, trascrizioni, sincronizzazione cifrata del ricettario, account, stelle e commenti dei Gnammers, database D1).
- `android/` e `ios/`: i progetti Capacitor.
- `scripts/`: gli script Python che costruiscono e aggiornano il ricettario (Wikibooks, Artusi, Regione Puglia, foto con licenza libera).
- `.github/workflows/`: la pubblicazione automatica.

I segreti (chiavi AI, token) non sono nel repository: stanno come segreti su Cloudflare e su GitHub.
