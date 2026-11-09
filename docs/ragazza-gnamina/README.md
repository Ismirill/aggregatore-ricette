# La ragazza di Gnamina e il suo studio di cucina

Il kit fisso per fare sempre la stessa ragazza nella stessa cucina, video dopo video.
I video si generano con MiniMax H3 sul PC con la GPU, tramite ComfyUI alla porta 8188.

## Riferimenti fissi (`riferimenti/`)

Vanno passati **sempre in questo ordine**, perché nei prompt sono `<Picture 1>` … `<Picture 5>`:

| # | File | Cosa fissa |
|---|------|------------|
| 1 | `1-volto.jpg` | il volto: tondetto, guance piene, capelli lunghi castano scuro, niente rossore |
| 2 | `2-figura.jpg` | la figura intera e il vestito: corporatura morbida ma non grassa, maglione crema, grembiule di lino con il pomodorino |
| 3 | `3-cucina-fronte.jpg` | lo studio di cucina visto di fronte: isola in rovere e crema, piano a induzione, pentole di rame, pomodori, basilico, aglio, olio, pasta; dietro le piastrelle bianche, la barra in ottone con pentole e mestoli, le mensole con i barattoli e la finestra con le erbe |
| 4 | `4-cucina-sinistra.jpg` | lo stesso studio visto da sinistra |
| 5 | `5-cucina-destra.jpg` | lo stesso studio visto da destra |

Le due immagini `origine-*` sono le ragazze generate da Geronimo da cui è nata la ragazza: servono solo per rifare la scheda da capo.

## Descrizioni fisse (`prompt/`)

- `personaggio.txt` è la descrizione della ragazza. Va incollata **identica** in ogni prompt.
- `video_benvenuto_fisso.txt` è il video di benvenuto del sito. Va usato come modello per i video nuovi: si cambiano solo le inquadrature e le battute.
- `cucina-set.json` è il prompt da cui è nato lo studio (seme 25783, quarta immagine del lotto con seme 2026).
- `still_*.txt` e `set_*.txt` sono i prompt delle immagini di riferimento.

## Impostazioni fisse

```bash
python3 script/h3_r2v.py \
  --ref riferimenti/1-volto.jpg --ref riferimenti/2-figura.jpg \
  --ref riferimenti/3-cucina-fronte.jpg --ref riferimenti/4-cucina-sinistra.jpg --ref riferimenti/5-cucina-destra.jpg \
  --prompt prompt/video_benvenuto_fisso.txt --out video.mp4 \
  --w 768 --h 1024 --dur 6.5 --seed 47 \
  --noturbo --steps 20 --sched beta --realism 0.65 \
  --model Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors
```

- **Qualità piena, niente turbo.** Con la LoRA turbo a 4 passi la voce diventa metallica.
- **LoRA realism a 0.65.** Se la ragazza ingrassa o le guance tornano rosse, va abbassata, non alzata.
- **Seme 47.** Lo stesso seme con lo stesso prompt dà lo stesso video.
- Ogni video da 6–7 secondi richiede circa 10–11 minuti sulla RTX 5080.

## Controlli prima di usare un video

1. **Dizione.** `script/trascrivi.sh video.mp4` trascrive l'audio con il servizio di dettatura di Gnamina. La trascrizione deve dire «Gnamina» e non contenere parole in più come «ya» o «eh». Se le contiene, si cambia il seme.
2. **Frasi ripetute.** Se l'ultima frase viene detta due volte, si taglia il video dopo la prima con ffmpeg (`-t`), con una breve dissolvenza dell'audio.
3. **Pulizia dell'audio** prima della pubblicazione:
   ```bash
   ffmpeg -i video.mp4 -af "highpass=f=70,afftdn=nr=12:nf=-40:tn=1,lowpass=f=13000,aresample=44100" …
   ```
4. **Versione per il sito.** Il video va ridotto a 600x800, H.264 crf 25 e AAC, con `+faststart`. Il file va in `www/casa/cuoca.mp4` e la sua prima immagine in `www/casa/cuoca.webp`.

## Backup completo

I file grandi non stanno nel repository. Sono nella release GitHub **«ragazza-gnamina»**: https://github.com/Ismirill/aggregatore-ricette/releases/tag/ragazza-gnamina

| Archivio | Contenuto |
|----------|-----------|
| `gnamina-video-prove.zip` | tutti i video di prova, le schede del personaggio e le viste della cucina, in qualità originale |
| `gnamina-immagini-generate.zip` | le 12 mascotte in cartone, i 4 studi di cucina e i riferimenti in PNG senza perdita |
| `gnamina-origine-pc.zip` | il video «Gnamina_completo» e le ragazze `last1*` generate sul PC, da cui è nata la ragazza |
| `gnamina-flussi-comfyui.zip` | i modelli ufficiali di ComfyUI (immagine, immagine→video, riferimento→video) da cui sono ricavati gli script |

## Altro materiale qui

- `mascotte-cartone/` contiene la prima idea scartata, la cuoca-gnometta 3D: il foglio delle 12 proposte e i prompt.
- `prompt/storico/` contiene i prompt delle prove precedenti, dalla ragazza in cucina alle versioni all'isola.
- `script/` contiene, oltre a `h3_r2v.py`:
  - `h3_gen.py`: testo→immagine (usa `comfy_gen.py`)
  - `h3_i2v.py`: immagine→video
  - `key.py`: scontorno dal verde
  - `sheet_*.py`: fogli di confronto
  - `trascrivi.sh`: controllo della dizione
