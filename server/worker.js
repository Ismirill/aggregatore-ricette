import ING from './ingredienti.json';
// Server dell'Aggregatore Ricette: fa le richieste AI per conto dell'app con Cloudflare Workers AI
// (quota gratuita giornaliera, nessuna chiave per l'utente). I prompt stanno qui, così l'endpoint non è un proxy generico.
const MODEL = '@cf/google/gemma-4-26b-a4b-it'; // visione + testo, licenza Gemma (utilizzabile in UE)
const ORIGINS = ['https://ismirill.github.io', 'https://gnamina.it', 'https://www.gnamina.it', 'https://gnamina.com', 'https://www.gnamina.com', 'https://localhost', 'http://localhost', 'http://localhost:8080', 'http://127.0.0.1:8080', 'capacitor://localhost'];
const DIETS = ['Vegano', 'Vegetariano', 'Senza glutine', 'Senza lattosio', 'Senza uova', 'Senza frutta secca', 'Ipocalorico'];

const cors = origin => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});
const reply = (origin, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

// Catena di fornitori AI, ognuno con il proprio piano gratuito e la propria chiave: Workers AI (Cloudflare) per primo e, quando
// ha esaurito la quota del giorno o non risponde, Gemini (Google AI Studio) e poi Groq. Le chiavi sono segreti del worker
// (`npx wrangler secret put GEMINI_KEY` / `GROQ_KEY`): senza chiavi resta il solo Workers AI, come prima.
// Il piano gratuito di Gemini può usare ciò che riceve per migliorare i modelli (anche con revisione umana): va bene per i post
// pubblici, non per le foto personali (quaderni, libri, piatti): per quelle (personal) Gemini si salta e resta Groq.
const GEMINI_VIDEO_FALLBACK = ['gemini-3.5-flash', 'gemini-2.5-flash']; // riserva per i video, se il modello principale è sovraccarico
const GEMINI_MODEL = 'gemini-3.5-flash-lite', GROQ_MODEL = 'qwen/qwen3.8-27b'; // entrambi leggono le immagini e rispondono in JSON
const quotaErr = e => e.status === 429 || e.status >= 500 || /neuron|quota|limit|4006|RESOURCE_EXHAUSTED|capacity/i.test(e.message);
const dataUrl = u => { const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(u || ''); return m ? { mime: m[1], data: m[2] } : null; };
async function aiCf(env, prompt, image) {
  const content = [...(image ? [{ type: 'image_url', image_url: { url: image } }] : []), { type: 'text', text: prompt }];
  // Senza ragionamento: risponde subito in JSON e consuma meno quota gratuita
  const r = await env.AI.run(MODEL, {
    messages: [{ role: 'user', content }], max_tokens: 2000, temperature: 0.2, // bassa: deve trascrivere, non inventare
    chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' },
  });
  return typeof r.response === 'string' ? r.response : r.choices?.[0]?.message?.content || JSON.stringify(r.response ?? '');
}
async function aiGemini(env, prompt, image) {
  const d = dataUrl(image);
  const body = { contents: [{ parts: [...(d ? [{ inline_data: { mime_type: d.mime, data: d.data } }] : []), { text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } } };
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''); }
    const msg = str(await r.text(), 300);
    if (r.status === 400 && !i && /thinking/i.test(msg)) { delete body.generationConfig.thinkingConfig; continue; } // modello senza quel parametro
    throw Object.assign(new Error('Gemini ' + r.status + ' ' + msg), { status: r.status });
  }
}
async function aiGroq(env, prompt, image) {
  const content = [...(image ? [{ type: 'image_url', image_url: { url: image } }] : []), { type: 'text', text: prompt }];
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.GROQ_KEY },
    body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content }], temperature: 0.2, max_tokens: 2000, response_format: { type: 'json_object' } }) });
  if (!r.ok) throw Object.assign(new Error('Groq ' + r.status + ' ' + str(await r.text(), 300)), { status: r.status });
  return (await r.json()).choices?.[0]?.message?.content || '';
}
async function ai(env, prompt, image, personal) {
  const chain = [['Workers AI', () => aiCf(env, prompt, image)]];
  if (env.GEMINI_KEY && !personal) chain.push(['Gemini', () => aiGemini(env, prompt, image)]);
  if (env.GROQ_KEY) chain.push(['Groq', () => aiGroq(env, prompt, image)]);
  // Prova dell'amministratore (header X-Provider con X-Admin): si usa solo il fornitore indicato, per verificarlo davvero
  const only = env.FORCE_AI ? chain.filter(([n]) => n.toLowerCase().startsWith(env.FORCE_AI)) : chain;
  if (!only.length) throw Object.assign(new Error('Fornitore AI non disponibile: ' + env.FORCE_AI), { status: 400 });
  let err;
  for (const [name, run] of only) {
    try { return await run(); } catch (e) { err = e; if (!quotaErr(e)) throw e; console.log(name, 'non disponibile:', str(e.message, 200)); }
  }
  throw err;
}
// Chiede il JSON al modello; se la risposta non è valida riprova una volta
async function aiJson(env, prompt, image, personal) {
  for (let i = 0; i < 2; i++) {
    try { const j = lastJson(await ai(env, prompt, image, personal)); if (j) return j; } catch (e) { if (i || e.status) throw e; }
  }
  return null;
}
const lastJson = t => { const m = String(t).replace(/```json|```/g, '').match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; };
const str = (v, n) => String(v ?? '').slice(0, n);

// Cache su D1 delle letture dei post (/preview) e delle analisi AI (/analyze): la stessa ricetta virale la salvano in tanti,
// così la lettura esterna, la trascrizione del video e la chiamata al modello si pagano una volta sola. La chiave è
// l'impronta del link (o del testo): nel database non si vede da chi arriva la richiesta. Si salvano solo i risultati utili.
const CACHE_V = 5; // aumentare quando cambiano prompt o formato della risposta: le voci vecchie non valgono più
const DAY = 86_400_000;
async function cached(env, kind, key, ttl, make, worth = () => true) {
  if (!env.SYNC || env.FORCE_AI) return make(); // nelle prove dell'amministratore niente cache: si vuole la risposta del fornitore
  const k = await hexSha(`${kind}:${CACHE_V}:${key}`);
  try {
    const row = await env.SYNC.prepare('SELECT v FROM cache WHERE k = ?1 AND exp > ?2').bind(k, Date.now()).first();
    if (row) { const v = JSON.parse(row.v); if (worth(v)) return { ...v, cached: true }; } // una riga salvata prima di un controllo più severo si rifà
  } catch (e) { console.log('cache lettura', e.message); }
  const v = await make();
  try {
    const s = JSON.stringify(v);
    if (worth(v) && s.length < 200_000) await env.SYNC.prepare('INSERT OR REPLACE INTO cache (k,v,exp) VALUES (?1,?2,?3)').bind(k, s, Date.now() + ttl).run();
  } catch (e) { console.log('cache scrittura', e.message); }
  return v;
}
// Link senza parametri di tracciamento (utm_*, igsh, srtk, mibextid, fbclid…): lo stesso post condiviso da persone diverse ha la stessa chiave
function cacheUrl(u) {
  try {
    const x = new URL(u); x.hash = '';
    for (const p of [...x.searchParams.keys()]) if (/^(igsh|srtk|mibextid|mdxt|fbclid|gclid|ref|_t|_r|si|s|feature)$/i.test(p) || /^utm_/i.test(p)) x.searchParams.delete(p);
    return x.href.replace(/\/+$/, ''); // il percorso resta com'è: i codici dei post Instagram distinguono maiuscole e minuscole
  } catch { return String(u); }
}
// pagine di accesso dei social (TikTok, Instagram, Facebook) arrivate al posto del post
const LOGIN_RX = /log in or sign up|<title>log in \| tiktok|accedi o iscriviti|make your day/i;
// p3: letture rifatte con le correzioni del 10/11 (video oltre 24 MB, niente falso parlato, blog linkati)
const previewCached = (env, b) => cached(env, 'preview', cacheUrl(b.url) + (b.transcribe === false ? ':senza-parlato' : ':p4'), 3 * DAY, () => preview(env, b),
  r => !!(r.transcript || /ld\+json/.test(r.html) || /property="(?:og:)?description" content="[^"]{60,}"/.test(r.html)) && !LOGIN_RX.test(r.html || '') && !r.retry); // niente pagina di accesso o vuota in cache: conta la descrizione, non il titolo
// b.yt: il video YouTube della stessa ricetta, trovato sulla pagina del blog del cuoco quando il blog non scrive il procedimento
const siteYtOf = b => /^[\w-]{11}$/.test(String(b.yt || '')) ? String(b.yt) : '';
const ANALYZE_V = 5; // versione del prompt di /analyze: aumentarla rifà solo le analisi (non le letture dei post) con le regole nuove
const analyzeCached = (env, b) => cached(env, 'analyze', JSON.stringify([ANALYZE_V, str(b.caption || b.title, 9000), ytIdOf(b.url), !!b.haveSteps, str(b.image, 2000), str(b.source, 40), (Array.isArray(b.cats) ? b.cats : []).slice(0, 30), ...(siteYtOf(b) ? [siteYtOf(b)] : [])]), 30 * DAY,
  () => analyze(env, b), r => !!(r.result && r.result.ingredients?.length && !(r.result.inferred && !r.result.steps?.length))); // le analisi «indovinate» (ingredienti tipici, nessun passaggio) non si salvano: la prossima volta si riprova

// Scarica la copertina del post (lato server non ci sono blocchi CORS)
async function imagePart(url) {
  try {
    if (!/^https:\/\//.test(url)) return null;
    const r = await fetch(url);
    const type = r.headers.get('content-type') || '';
    // solo i formati che i modelli leggono: una copertina AVIF (Facebook) faceva fallire tutta l'analisi
    if (!r.ok || !/^image\/(?:jpe?g|png|webp|gif)\b/i.test(type)) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 4e6) return null;
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
  } catch { return null; }
}

// Numeri scritti nel testo del post (per controllare che dosi, tempi e porzioni non siano inventati).
// Nel parlato trascritto le dosi sono in lettere («due etti di farina», «mezzo litro», «tre uova»): valgono anche quelle,
// convertite come le scrive il modello (due etti → 200, mezzo chilo → 500, un litro → 1000)
const WORD_N = { un: 1, una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20, venticinque: 25, trenta: 30, quaranta: 40, cinquanta: 50, sessanta: 60, settanta: 70, ottanta: 80, novanta: 90, cento: 100, centocinquanta: 150, duecento: 200, duecentocinquanta: 250, trecento: 300, quattrocento: 400, cinquecento: 500, seicento: 600, settecento: 700, ottocento: 800, novecento: 900, mille: 1000, mezzo: 0.5, mezza: 0.5 };
const NUM_WORDS = Object.keys(WORD_N).join('|');
function numsIn(t) {
  const s = String(t).toLowerCase(), out = new Set((s.match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(',', '.')));
  const add = n => { if (n > 0) out.add(String(+n.toFixed(2))); };
  for (const m of s.matchAll(new RegExp(`\\b(\\d+(?:[.,]\\d+)?|${NUM_WORDS})\\b(\\s+e\\s+mezz[oa]\\b)?(?:\\s+(etti?|ett[oi]|chil[oi]|kg|grammi?|gr?|litr[oi]|l|ml|cl|dl|decilitr[oi]|cucchia\\w*|tazz[ae]|bicchier\\w*)\\b(\\s+e\\s+mezz[oa]\\b)?)?`, 'g'))) {
    let n = /^\d/.test(m[1]) ? parseFloat(m[1].replace(',', '.')) : WORD_N[m[1]];
    if (m[2] || m[4]) n += 0.5;
    const u = m[3] || '';
    add(n);
    if (/^ett/.test(u)) add(n * 100); else if (/^(chil|kg)/.test(u)) add(n * 1000); else if (/^(litr|l)$/.test(u) || /^litr/.test(u)) add(n * 1000); else if (/^(dl|decil)/.test(u)) add(n * 100); else if (u === 'cl') add(n * 10);
  }
  return out;
}
// Durate scritte nel post: "30 minuti", "1 ora", "15'", "mezz'ora", "una decina di minuti", "una ventina di minuti"
const NUM_IT = { un: 1, una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, dodici: 12, quindici: 15, venti: 20, venticinque: 25, trenta: 30, quaranta: 40, quarantacinque: 45, cinquanta: 50, sessanta: 60,
  decina: 10, dozzina: 12, quindicina: 15, ventina: 20, trentina: 30, quarantina: 40, cinquantina: 50 };
const TIME_RX = /(?:\d+(?:[.,]\d+)?|\b(?:un[ao]?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|dodici|quindici|venti(?:cinque)?|trenta|quaranta(?:cinque)?|cinquanta|sessanta)\b|\b(?:una\s+)?(?:decina|dozzina|quindicina|ventina|trentina|quarantina|cinquantina)\s+di)\s*(?:['’′]|min\b|minut\w*|ore\b|ora\b|h\b|hour\w*|hrs?\b)|mezz['’]?\s?ora|mezzora|un['’]ora|quarto d['’]ora|tre quarti d['’]ora/i;
// Porzioni: solo con la parola (persone, porzioni…) o nell'intestazione "ingredienti per 4": "per 10 minuti" non è una porzione
const SERV_RX = /(?:per|x|serves?|for)\s*\d+\s*(?:person|porzion|pers\b|people|serving|pax)|\d+\s*(?:person|porzion|serving|pax)|(?:ingredienti|dosi)[^\n:]{0,25}(?:per|x)\s*\d+\s*(?=$|\n|:|\)|\.)/i;

async function analyze(env, b) {
  const cats = (Array.isArray(b.cats) ? b.cats : []).slice(0, 30).map(c => str(c, 40));
  const text = str(b.caption || b.title, 9000); // didascalia + parlato trascritto (un video di 3 minuti ≈ 3.000 caratteri)
  const prompt = `Questo è un post con una ricetta, salvato in un ricettario personale in italiano.
Link: ${str(b.url, 500)}
Fonte: ${str(b.source, 40)}${b.author ? ' · autore: ' + str(b.author, 80) : ''}
Titolo/didascalia (e, se presente, la trascrizione di ciò che viene detto nel video, sotto «Parlato nel video»: vale quanto il testo scritto, comprese le dosi e i tempi detti a voce):
"""${text}"""

Sei un trascrittore fedele, non un cuoco: riporta SOLO ciò che è scritto nel testo (hashtag compresi: #cannellini, #carote sono ingredienti) o chiaramente visibile nell'immagine allegata. Non aggiungere dosi, tempi, porzioni o passaggi che non ci sono. Meglio un campo vuoto di un dato inventato.
Se c'è il «Parlato nel video», ciò che il cuoco dice vale come testo scritto: le dosi dette a voce in lettere vanno scritte in cifre («due etti di farina» → "200 g farina", «mezzo litro di latte» → "500 ml latte", «tre uova» → "3 uova", «un cucchiaio» → "1 cucchiaio"), e i passaggi raccontati a voce vanno in steps, in ordine, uno per voce. La trascrizione automatica può avere errori di ascolto: correggi solo quelli evidenti.
Guarda bene l'immagine: se mostra il piatto, elenca gli ingredienti che si riconoscono con certezza (es. fagioli bianchi, carote a dadini, patate, pasta corta, pane); se contiene testo sovrimpresso (titolo, elenco di ingredienti, dosi), trascrivilo e usalo come se fosse nel post.
Estrai i dati in italiano. Se il post è in un'altra lingua (inglese, spagnolo…), traduci in italiano titolo, ingredienti e passaggi: i nomi di piatti noti restano com'è d'uso in Italia («Arancini», «Tacos», «Pad Thai», «Paella»), ma i nomi descrittivi si traducono sempre («Mermelada de mandarina» → "Marmellata di mandarini", «Tarte aux pommes» → "Torta di mele", «700 g de mandarina» → "700 g mandarini"), «chicken» → pollo, «bell peppers» → peperoni. I numeri delle dosi restano esattamente quelli del post e si traducono solo le unità: cup/cups → tazza/tazze, tbsp → cucchiaio, tsp → cucchiaino, lb → libbra, oz → oncia, clove → spicchio; nei passaggi le temperature in °F si scrivono in °C se il post le dà anche in °C, altrimenti si convertono (425°F → 220°C).
- title: SOLO il nome del piatto, senza hashtag, emoji, aggettivi pubblicitari o commenti: «Carbonara vegana, la più buona del mondo» → "Carbonara vegana"; «Come fare la pasta alla norma perfetta» → "Pasta alla norma". Il nome deve restare specifico, con gli ingredienti o la variante che lo distinguono: «Pizza in 1h 45 ~ Basilico, Limone, Parmigiano & Pepe nero» → "Pizza basilico, limone e parmigiano", non solo "Pizza"; «Pane fatto in casa in due passaggi» → "Pane fatto in casa", non solo "Pane".
- cat: uno tra ${cats.map(c => `"${c}"`).join(', ')}.
- servings: per quante persone sono le dosi, SOLO se scritto nel post ("per 4 persone", "4 porzioni", "ingredienti per 2"…); altrimenti 0. "per 10 minuti" non è una porzione.
- ingredients: un ingrediente per voce, nell'ordine del post (una riga con due misure dello stesso ingrediente, es. «2 uova 100 g» o «3 cachi (circa 600 g)», è UN solo ingrediente: "2 uova (100 g)"), formato "quantità unità ingrediente" (es. "320 g spaghetti", "2 uova", "olio extravergine q.b."). Le quantità solo se scritte nel post: se un ingrediente è nominato senza dose, scrivi solo il nome (es. "pomodori secchi"), NON "q.b." e NON una dose tipica. Se il post non elenca ingredienti, metti i soli NOMI: prima quelli nominati nel testo e negli hashtag, poi quelli che vedi nell'immagine (mettili anche in seen), senza dosi, e imposta inferred a true. Usa nomi concreti, non categorie: niente "verdure" o "legumi" se sai quali sono (carote, cannellini). Se non riconosci il piatto, lascia vuoto.
- steps: passaggi del procedimento SOLO se descritti nel post, un passaggio per voce, con le parole del post; altrimenti vuoto.
- diets: solo tra ${DIETS.map(x => `"${x}"`).join(', ')} e solo se evidente dagli ingredienti elencati; nel dubbio nessuna.
- country e region: zona d'origine del piatto se chiara dal nome (region solo per regioni italiane), altrimenti stringa vuota.
- time: minuti totali dall'inizio al piatto pronto, come li vive chi cucina. Se il post dichiara chiaramente il tempo TOTALE di preparazione ("pronta in 30 minuti", "tempo: 1 ora", "tempo di preparazione 45 min") usa quello e basta. Altrimenti RICOSTRUISCILO passaggio per passaggio, in ordine: le durate scritte nel post valgono così come sono (intervalli o alternative: la più lunga); per ogni passaggio SENZA durata scritta stima il tempo di lavoro o di attesa che richiede davvero (es. lessare le patate "finché morbide" ≈ 25, pelare e tagliare verdure ≈ 10, impastare ≈ 10, lasciar intiepidire ≈ 10, formare palline o polpette ≈ 10, soffriggere ≈ 5, montare o mescolare ≈ 5) e somma tutto. La durata di un solo passaggio (es. "cuoci 20 minuti") NON è mai il totale se prima o dopo ci sono altri passaggi: il totale è sempre più alto. Metti 0 solo se il post non descrive nessun passaggio e non dà nessun tempo.
- time_how: "indicato" se il post dichiara il tempo totale; "sommato" se hai sommato solo durate scritte nel post; "stimato" se hai dovuto stimare almeno un passaggio; "" se time è 0.
- time_note: se time_how è "stimato" o "sommato", il conto in breve (max 100 caratteri, es. "lessare ≈25 + intiepidire ≈10 + formare ≈10 + friggitrice 20"); altrimenti "".
- seen: gli ingredienti che hai riconosciuto guardando l'immagine (e non scritti nel post), stessi nomi usati in ingredients.
- inferred: true solo se gli ingredienti non sono scritti nel post (li hai presi dal nome del piatto o dall'immagine).
- is_recipe: false se il post non riguarda una ricetta o un piatto.
Rispondi solo con JSON: {"is_recipe":true,"title":"","servings":0,"cat":"","diets":[],"country":"","region":"","time":0,"time_how":"","time_note":"","inferred":false,"seen":[],"ingredients":[],"steps":[]}`;
  const img = b.image ? await imagePart(str(b.image, 2000)) : null;
  // se il modello rifiuta l'immagine (formato o contenuto), l'analisi si rifà con il solo testo invece di fallire
  let r0;
  try { r0 = await aiJson(env, prompt, img); }
  catch (e) { if (!img) throw e; console.log('analisi senza immagine:', str(e.message, 200)); r0 = await aiJson(env, prompt, null); }
  const r = r0 && faithful(r0, text);
  // YouTube: se il procedimento non è scritto né nella descrizione né sul sito del cuoco, Gemini guarda il video
  // i «capitoli» del video (00:00 Preparazione del sugo…) non sono un procedimento: si tolgono dai passaggi (sono le righe del testo che iniziano con un orario)
  const norm = x => String(x).trim().toLowerCase().replace(/[.\s]+$/, '');
  const chapters = new Set((text.match(/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*[-–—)]?\s*\S.*$/gm) || []).map(l => norm(l.replace(/^\s*[\d:]+\s*[-–—)]?\s*/, ''))));
  if (r && chapters.size && Array.isArray(r.steps)) r.steps = r.steps.filter(x => !chapters.has(norm(x)));
  // passaggi veri = almeno due frasi di una certa lunghezza
  // (in un video oltre i 3 minuti ne servono almeno tre: due righe di appunti, «Il ripieno va preparato il giorno prima», non bastano)
  const realSteps = (r?.steps || []).filter(x => String(x).trim().length >= 30).length >= ((+b.seconds || 0) > 180 ? 3 : 2);
  // se il link non è di YouTube ma il blog del cuoco ha il video della ricetta (b.yt), Gemini guarda quello
  const yid = r && r.is_recipe !== false && !b.haveSteps && !realSteps ? ytIdOf(b.url) || siteYtOf(b) : '';
  if (yid) try {
    const v = await ytVideoRecipe(env, yid, ytIdOf(b.url) ? +b.seconds || 0 : 0);
    if (v && v.is_recipe !== false) {
      const st = (Array.isArray(v.steps) ? v.steps : []).map(x => str(x, 600).trim()).filter(Boolean).slice(0, 30);
      if (st.length) { r.steps = st; r.from_video = true; }
      const vt = str(v.title, 120).trim(); if (vt && (!r.title || r.title === r.title.toUpperCase() || r.title.length > 60)) r.title = vt; // «GNOCCHI AI FRUTTI DI MARE: la RICETTA…» → il nome del piatto
      // dal video del blog (b.yt) si prendono i passaggi: gli ingredienti scritti nel post o sul blog hanno le dosi e restano
      const ing = (Array.isArray(v.ingredients) ? v.ingredients : []).map(x => str(x, 120).trim()).filter(Boolean).slice(0, 40);
      if (ing.length && (r.inferred || !r.ingredients.length || (ytIdOf(b.url) && ing.length > r.ingredients.length + 2))) { r.ingredients = ing; r.inferred = false; r.seen = []; r.from_video = true; }
      if (!r.servings && +v.servings > 0 && +v.servings <= 100) r.servings = Math.round(+v.servings);
      if (!r.time && +v.time > 0 && +v.time <= 1440) { r.time = Math.round(+v.time); r.time_how = 'video'; r.time_note = ''; }
    }
  } catch (e) { console.log('video Gemini', e.message); }
  if (r && r.title) r.title = dishName(r.title);
  // i passaggi presi dal parlato arrivano spesso in minuscolo («fare le melanzane a strisce»): iniziano con la maiuscola
  if (r && Array.isArray(r.steps)) r.steps = r.steps.map(x => String(x).trim()).filter(Boolean).map(x => x.charAt(0).toUpperCase() + x.slice(1));
  return { result: r };
}

// Titoli dei post: resta solo il nome del piatto (stessa funzione nell'app)
// Dal titolo di un post o di un video al solo nome del piatto: via commenti, superlativi, «come fare», hashtag, emoji, nome del canale
const FLUFF=/\b(pi[uù]\s+\w+\s+(del\s+mondo|che\s+(esist\w*|c'?[èe]|abbia\w*)|di\s+sempre|mai\s+\w+)|(del\s+mondo|che\s+esist\w*|di\s+sempre|in\s+assoluto)|fatt[aoie]\s+(per|da|come|in\s+casa)|per\s+tutti|per\s+(me|te|voi|noi)|come\s+(si\s+fa|fare|farl[aoie]|prepararl[aoie]|preparare|cucinare|non\s+l'?hai|al\s+ristorante|quell[aoie]|la\s+faccio|lo\s+faccio|nonna|quando)|(la|il|le|i)?\s*mi[aoe]\s+(versione|ricetta)|ricetta\s+(facile|veloce|perfetta|originale|cremosa|infallibile|semplice|della\s+nonna|di\s+famiglia|segreta|definitiva|completa)|(facile|veloce|facilissim\w|velocissim\w|buonissim\w|cremosissim\w|golosissim\w|perfett[aoie]|infallibile|spettacolare|pazzesc\w|incredibile|strepitos\w|favolos\w|irresistibile|deliziosissim\w)\b|in\s+\d+\s+minuti|in\s+pochi\s+minuti|senza\s+(errori|segreti|fatica|sforzo|impazzire)|trucc\w|segret\w|svel\w|provala|provatela|provateci|devi\s+provare|da\s+provare|non\s+ci\s+credere|lasciat\w|guard\w+\s+fino|iscrivi\w*|like|subscribe|tutorial|vlog|parte\s+\d+|ep\.?\s*\d+|episodio)\b/i;
function dishName(t){
  let s=String(t||'').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,' ').replace(/#\S+|@\S+/g,' ').replace(/\s+/g,' ').trim();
  if(!s)return '';
  const orig=s;
  s=s.replace(/\s*[|•·]\s*(youtube|tiktok|instagram|facebook|cookist|giallozafferano|fatto in casa da benedetta)[^|•·]*$/i,'');
  // pezzi separati da : | - – — ! ? … ( , : si tiene il primo che non è un commento
  const parts=s.split(/\s*(?:[:|•·!?]|\s[-–—]\s|\.{3}|…|\(|\)|,\s)\s*/).map(x=>x.trim()).filter(x=>/[a-zà-ü]/i.test(x));
  let best=parts.find(p=>!FLUFF.test(p))||parts[0]||s;
  // in testa: «ricetta», «come fare la», «ecco la», «la migliore», «la vera»…
  for(let k=0;k<3;k++)best=best.replace(/^(?:la\s+|il\s+|le\s+|i\s+|lo\s+|gli\s+|l')?(?:ricetta\s+(?:della|del|dello|delle|dei|degli|di|per)\s+|ricetta\s+|come\s+(?:si\s+fa|fare|preparare|cucinare|si\s+prepara|si\s+cucina|si\s+fanno|si\s+preparano|facciamo|prepariamo|cucino|faccio|preparo)\s+|ecco\s+|oggi\s+|facciamo\s+|prepariamo\s+|cuciniamo\s+|vi\s+presento\s+|vi\s+svelo\s+|la\s+ver[ae]\s+|il\s+vero\s+|la\s+migliore?\s+|il\s+migliore?\s+|le\s+migliori\s+|i\s+migliori\s+|la\s+pi[uù]\s+buona\s+|il\s+pi[uù]\s+buono\s+|un[ao']?\s+|tutt[aoie]\s+(?:la|il|le|i)\s+|(?:la|il|le|i|lo|gli)\s+(?=\w))\s*/i,'');
  // in coda: commenti dopo il nome
  for(let k=0;k<3;k++)best=best.replace(/\s+(?:che\s+(?:esist\w*|c'?[èe]|abbia\w*|piace\w*|fa\s+impazzire|conquista\w*|tutti\s+\w+)|pi[uù]\s+\w+\s+(?:del\s+mondo|di\s+sempre|che\s+.*|mai\s+.*)|del\s+mondo|di\s+sempre|in\s+assoluto|fatt[aoie]\s+(?:per|da|come|in\s+casa).*|per\s+tutti.*|per\s+(?:me|te|voi|noi).*|come\s+(?:non\s+l'?hai|al\s+ristorante|quell[aoie]|la\s+faccio|lo\s+faccio|nonna|quando|si\s+deve|dio\s+comanda).*|in\s+\d+\s+minuti.*|in\s+pochi\s+minuti.*|senza\s+(?:errori|segreti|fatica|sforzo|impazzire).*|(?:facile|veloce|facilissim\w|velocissim\w|buonissim\w|cremosissim\w|golosissim\w|perfett[aoie]|infallibile|spettacolare|pazzesc\w|incredibile|strepitos\w|favolos\w|irresistibile|deliziosissim\w|squisit\w|super\s+\w+|originale|classic[aoie]|tradizionale|autentic[aoie]|vera|verissim\w)(?:\s+(?:e|ed|,)\s+\w+)*|ricetta(?:\s+\w+)*|(?:la|il)\s+mi[ao]\s+\w+.*|versione\s+\w+.*|tutorial.*|step\s+by\s+step.*|passo\s+(?:dopo|per)\s+passo.*)\s*$/i,'').replace(/\s+(?:\w+\s+(?:e|ed)\s+)?(?:facile|veloce|facilissim\w|velocissim\w|buonissim\w|cremosissim\w|golosissim\w|perfett[aoie]|infallibile|spettacolare|pazzesc\w|incredibile|strepitos\w|favolos\w|irresistibile|deliziosissim\w|squisit\w)\s*$/i,'');
  best=best.replace(/\s+(?:e|ed|con|senza|al|alla|allo|alle|ai|agli|di|del|della|dello|delle|dei|degli|e\s+con)\s*$/i,'');
  best=best.replace(/^[\s\-–—:;,.!?'"«»“”]+|[\s\-–—:;,.!?'"«»“”]+$/g,'').trim();
  if(best.length<3||!/[a-zà-ü]{3}/i.test(best))best=orig.replace(/^[\s\-–—:;,.!?'"«»]+|[\s\-–—:;,.!?'"«»]+$/g,'');
  if(best.length>3&&best===best.toUpperCase())best=best.toLowerCase();
  return best.charAt(0).toUpperCase()+best.slice(1);
}

// Controllo meccanico sul risultato: tutto ciò che è un numero deve stare nel testo del post, altrimenti via.
// Il modello a volte "completa" lo stesso: così dosi, tempi e porzioni inventati non arrivano all'utente.
// Tutte le durate scritte nel post, in minuti, per frase: dentro una frase le durate sono alternative o intervalli
// ("almeno mezz'ora, anche un'ora", "10-12 minuti") e vale la più lunga; frasi diverse sono passaggi diversi e si sommano.
// Un tempo presentato come totale ("pronta in", "tempo totale") vale da solo.
function timesIn(text) {
  const t = String(text).toLowerCase().replace(/[’′]/g, "'"), res = { total: 0, sum: 0, max: 0, n: 0 };
  for (const sent of t.split(/(?<=[.!?\n])\s+|\n+/)) {
    let best = 0;
    for (const m of sent.matchAll(/(mezz'?\s?ora|mezzora|un'or(?:a|etta)|quarto d'ora|tre quarti d'ora)|(\d+(?:[.,]\d+)?|\b(?:un[ao]?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|dodici|quindici|venti(?:cinque)?|trenta|quaranta(?:cinque)?|cinquanta|sessanta)\b|\b(?:una\s+)?(decina|dozzina|quindicina|ventina|trentina|quarantina|cinquantina)\s+di)\s*('|min\b|minut\w*|ore\b|ora\b|h\b|hour\w*|hrs?\b)/g)) {
      let mins;
      if (m[1]) mins = { "mezz'ora": 30, 'mezz ora': 30, mezzora: 30, "un'ora": 60, "un'oretta": 60, "quarto d'ora": 15, "tre quarti d'ora": 45 }[m[1]] || 30;
      else {
        const w = m[3] || m[2].replace(/^una\s+/, '').trim(), n = /^\d/.test(w) ? parseFloat(w.replace(',', '.')) : NUM_IT[w] || 0;
        mins = Math.round(n * (/^(or|h\b|hour|hr)/.test(m[4]) ? 60 : 1));
      }
      if (!mins) continue;
      const before = sent.slice(Math.max(0, m.index - 40), m.index);
      if (/pront[aoie]?\s+in|tempo\s+(?:totale|di preparazione|complessivo)?|totale|ci vogliono|in sol[io]|bastano|si prepara in/.test(before)) res.total = Math.max(res.total, mins);
      best = Math.max(best, mins); res.n++;
    }
    res.sum += best; res.max = Math.max(res.max, best);
  }
  return res;
}
const servingsIn = text => +((String(text).match(SERV_RX) || [''])[0].match(/\d+/) || [0])[0] || 0;

function faithful(r, text) {
  const nums = numsIn(text), spoken = /parlato nel video:/i.test(text); // il parlato trascritto vale come testo scritto
  const hasList = /ingredient/i.test(text) || new RegExp(`(?:\\d+|\\b(?:${NUM_WORDS}))\\s?(?:g|gr|grammi?|kg|chil[oi]|ml|cl|dl|l|litr[oi]|ett[oi]|cucchia|tazz|bicchier|pizzic)\\b`, 'i').test(text) || (spoken && nums.size > 0);
  // tempo e porzioni: valgono solo se scritti nel post; se il modello li salta o li inventa, si legge direttamente il testo
  const tm = timesIn(text), sv = servingsIn(text);
  r.time = Math.round(+r.time) || 0; r.time_note = str(r.time_note, 120).trim();
  const steps = Array.isArray(r.steps) ? r.steps.filter(Boolean).length : 0;
  if (tm.total) { r.time = tm.total; r.time_how = 'indicato'; r.time_note = ''; } // il post dichiara il totale: vale quello e basta
  else if (!steps && !tm.n) { r.time = 0; r.time_how = ''; r.time_note = ''; } // né passaggi né durate: niente da ricostruire
  else {
    // Il totale si ricostruisce dai passaggi: le durate scritte sono un pavimento (mai sotto la loro somma), le stime per i
    // passaggi senza durata un tetto ragionevole (mezz'ora a passaggio). Dentro questi limiti vale il conto del modello.
    // Con il parlato del video contano le durate dei passaggi estratti: a voce si nominano anche tempi che non fanno parte
    // del procedimento (una variante, «in frigo per 24 ore» detto alla fine), e la somma di tutto il testo gonfiava il totale.
    const said = spoken && steps >= 3 ? Math.min(tm.sum, timesIn(r.steps.filter(Boolean).join('\n')).sum) : tm.sum;
    const floor = said, ceil = said + 30 * Math.max(steps, 1) + 30;
    if (r.time < floor) r.time = floor; else if (r.time > ceil) r.time = ceil;
    r.time_how = r.time > said ? 'stimato' : tm.n > 1 ? 'sommato' : 'indicato';
    if (r.time_how !== 'stimato') r.time_note = '';
  }
  if (!SERV_RX.test(text) || !r.servings || !nums.has(String(r.servings))) r.servings = sv;
  if (!hasList) r.inferred = true;
  r.ingredients = (Array.isArray(r.ingredients) ? r.ingredients : []).map(String).map(x => {
    const m = x.match(/^\s*(\d+(?:[.,]\d+)?)(?:\s*[-–\/]\s*\d+(?:[.,]\d+)?)?\s*/); // "300 g …", "2-3 …", "1/2 …"
    const frac = x.match(/^\s*(?:[½¼¾⅓⅔]|\d+\/\d+)\s/);
    if (m && !nums.has(m[1].replace(',', '.'))) return x.slice(m[0].length).replace(/^(?:g|gr|kg|ml|cl|l|cucchiai?n?[oi]?|tazz[ae]|spicchi?o?|fette?|pizzic[oh]i?|bustin[ae]|foglie?|rametti?|cucchiaini?)\s+(?:di\s+)?/i, '').trim(); // dose non nel post: resta il nome
    if (frac && !/[½¼¾⅓⅔]|\d\/\d/.test(text)) return x.replace(frac[0], '').trim();
    if (/\bq\.?\s?b\.?/i.test(x) && !/\bq\.?\s?b\b/i.test(text)) return x.replace(/\s*,?\s*q\.?\s?b\.?\s*$/i, '').trim(); // "q.b." messo dal modello
    return x.trim();
  }).filter(Boolean);
  if (r.inferred && r.ingredients.length) r.ingredients = r.ingredients.map(x => x.replace(/^\d[\d.,\/\s]*(?:g|gr|kg|ml|cl|l)?\s*/i, '').trim()).filter(Boolean);
  const low = r.ingredients.map(x => x.toLowerCase());
  r.seen = (Array.isArray(r.seen) ? r.seen : []).map(String).map(x => x.trim()).filter(x => x && low.some(y => y.includes(x.toLowerCase()) || x.toLowerCase().includes(y)));
  return r;
}

// Ricette di GialloZafferano per il piatto riconosciuto (titolo, link, foto)
async function giallo(query) {
  try {
    const r = await fetch(`https://www.giallozafferano.it/ricerca-ricette/${encodeURIComponent(query).replace(/%20/g, '+')}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return [];
    const html = await r.text(), out = [], seen = new Set();
    const re = /<a href="(https:\/\/ricette\.giallozafferano\.it\/[^"]+\.html)" title="([^"]+)">\s*(?:<[^>]+>\s*)*?<img src="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) && out.length < 8) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ title: m[2].replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"'), url: m[1], image: m[3], site: 'GialloZafferano' });
    }
    return out;
  } catch { return []; }
}

// Trascrizione di una ricetta fotografata (scritta a mano, stampata, su un libro o uno schermo)
async function ocr(env, b) {
  const data = str(b.image, 6e6);
  if (!data) throw Object.assign(new Error('Foto mancante'), { status: 400 });
  const result = await aiJson(env, `Questa foto mostra una ricetta scritta (a mano, stampata, su un libro, una rivista o uno schermo). Trascrivila fedelmente, senza inventare quello che non c'è. Rispondi SOLO con un oggetto JSON:
{"is_recipe":true|false,"title":"nome del piatto","servings":numero di persone o null,"time":minuti totali o null,"cat":"Antipasti|Primi|Secondi|Contorni|Piatti unici|Lievitati|Dolci|Altro","ingredients":["quantità e ingrediente, uno per voce, come scritto"],"steps":["un passaggio per voce, in ordine"],"notes":"eventuali note o consigli presenti"}
Se il testo è in un'altra lingua, traducilo in italiano. Se la foto non contiene una ricetta leggibile, restituisci is_recipe false.`, `data:image/jpeg;base64,${data}`, true); // foto personale: mai a Gemini
  return { result };
}

// Ricetta dettata a voce: Whisper trascrive l'audio, poi il modello ricava i campi dal testo (audio personale: mai a Gemini)
async function dictate(env, b) {
  const data = str(b.audio, 8e6);
  if (!data) throw Object.assign(new Error('Audio mancante'), { status: 400 });
  const buf = Buffer.from(data, 'base64');
  if (buf.byteLength < 1000) throw Object.assign(new Error('Audio troppo corto'), { status: 400 });
  const transcript = await whisper(env, buf, str(b.mime, 40).toLowerCase());
  if (b.plain) return { transcript: transcript || '' }; // solo il testo (comandi a voce di «Cucina con me»)
  if (!transcript) return { result: null, transcript: '' };
  const result = await aiJson(env, `Questo è il testo di una ricetta dettata a voce da chi la cucina, trascritto automaticamente (può avere errori di ascolto, parole in dialetto, numeri scritti in lettere). Ricava i dati della ricetta restando fedele a quello che è stato detto: non inventare dosi, tempi o passaggi non detti; correggi solo gli errori evidenti di trascrizione e scrivi le quantità in cifre (es. «due etti di farina» → «200 g farina», «mezzo litro» → «500 ml»). Rispondi SOLO con un oggetto JSON:
{"is_recipe":true|false,"title":"nome del piatto","servings":numero di persone o null,"time":minuti totali o null,"cat":"Antipasti|Primi|Secondi|Contorni|Piatti unici|Lievitati|Dolci|Altro","ingredients":["quantità e ingrediente, uno per voce, come detto"],"steps":["un passaggio per voce, in ordine, scritto in modo chiaro"],"notes":"consigli o note dette a parte"}
Se il testo non descrive una ricetta, restituisci is_recipe false.

Testo dettato:
---
${transcript}
---`, null, true);
  return { result, transcript };
}

async function photo(env, b) {
  const data = str(b.image, 6e6);
  if (!data) throw Object.assign(new Error('Foto mancante'), { status: 400 });
  const result = await aiJson(env, `Riconosci il piatto in questa foto. Rispondi SOLO con un oggetto JSON:
{"dish":"nome del piatto in italiano, come lo cercheresti su un sito di ricette","description":"una frase su cos'è","confidence":"alta|media|bassa","alternatives":["altri piatti possibili, max 3"],"keywords":["2-4 parole chiave"]}
Se nella foto non c'è un piatto o del cibo, restituisci dish vuoto.`, `data:image/jpeg;base64,${data}`, true); // foto personale: mai a Gemini
  const recipes = result?.dish ? await giallo(result.dish) : [];
  return { result: result && { ...result, recipes } };
}

// Prezzi medi indicativi al consumo in Italia (€/kg, €/l o €/pezzo), riferimento per stime coerenti.
// Da aggiornare periodicamente, ad es. con i dati dell'Osservatorio prezzi del MIMIT o dell'ISTAT.
// Prezzi indicativi dalla tabella condivisa server/ingredienti.json (usati quando il MIMIT non rileva il prodotto)
const PRICES = ING.items.filter(x => x.eur).map(x => `${x.k} ${String(x.eur).replace('.', ',')}/kg`).join('; ');

// Prezzi ufficiali: Osservatorio Prezzi del MIMIT (rilevazioni mensili per 64 province).
// Il MIMIT pubblica un mese alla volta: il cron giornaliero controlla se è uscito un mese nuovo e, in quel caso,
// aggiorna le province a lotti (restando nei limiti del piano gratuito). Senza mese nuovo rinfresca solo i dati più vecchi di 30 giorni.
const MIMIT_URL = 'https://osservaprezzi.mise.gov.it/prezzi/livelli/beni-e-servizi-di-largo-consumo/archivio-rilevazioni-beni-e-servizi-di-largo-consumo';
const MIMIT_CATS = ['altri_alim', 'orto', 'ittici'];
const BATCH = 12; // 12 province x 3 categorie + 2 pagine = 38 richieste (limite gratuito: 50)
const MESI = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
// Coordinate approssimative dei capoluoghi rilevati dal MIMIT, per trovare la provincia più vicina
const PROVINCES = {Alessandria:[44.91,8.61],Ancona:[43.62,13.52],Aosta:[45.74,7.32],Arezzo:[43.46,11.88],'Ascoli Piceno':[42.85,13.58],Avellino:[40.91,14.79],Bari:[41.12,16.87],Belluno:[46.14,12.22],Benevento:[41.13,14.78],Bergamo:[45.70,9.67],Biella:[45.57,8.05],Bologna:[44.49,11.34],Bolzano:[46.50,11.35],Brescia:[45.54,10.22],Cagliari:[39.22,9.12],Catanzaro:[38.91,16.59],Cosenza:[39.30,16.25],Cremona:[45.13,10.02],Cuneo:[44.39,7.55],Ferrara:[44.84,11.62],Firenze:[43.77,11.26],Forli:[44.22,12.04],Genova:[44.41,8.93],Gorizia:[45.94,13.62],Grosseto:[42.76,11.11],Lecco:[45.86,9.40],Livorno:[43.55,10.31],Lodi:[45.31,9.50],Lucca:[43.84,10.50],Macerata:[43.30,13.45],Mantova:[45.16,10.79],Messina:[38.19,15.55],Milano:[45.46,9.19],Modena:[44.65,10.93],Napoli:[40.85,14.27],Novara:[45.45,8.62],Padova:[45.41,11.88],Palermo:[38.12,13.36],Parma:[44.80,10.33],Perugia:[43.11,12.39],Pescara:[42.46,14.21],Piacenza:[45.05,9.69],Pistoia:[43.93,10.91],Pordenone:[45.96,12.66],Ravenna:[44.42,12.20],'Reggio Calabria':[38.11,15.65],'Reggio Emilia':[44.70,10.63],Rimini:[44.06,12.57],Roma:[41.90,12.50],Rovigo:[45.07,11.79],Sassari:[40.73,8.56],Siena:[43.32,11.33],Siracusa:[37.08,15.29],Terni:[42.56,12.65],Torino:[45.07,7.69],Trento:[46.07,11.12],Treviso:[45.67,12.24],Trieste:[45.65,13.78],Udine:[46.06,13.24],Varese:[45.82,8.83],Venezia:[45.44,12.32],Vercelli:[45.32,8.42],Verona:[45.44,10.99],Vicenza:[45.55,11.55]};
function nearestProvince(lat, lon, among = Object.keys(PROVINCES)) {
  if (!isFinite(lat) || !isFinite(lon)) return null;
  let best = null, bd = Infinity;
  for (const name of among) {
    const [a, b] = PROVINCES[name];
    const d = (a - lat) ** 2 + ((b - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return bd < 4 ? best : null; // oltre ~200 km (es. fuori dall'Italia) usa la media nazionale
}
const unescape = t => t.replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim();

async function mimitPage(params) {
  const u = new URL(MIMIT_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // Il portale a volte non risponde (522): riprova con pause crescenti
  for (let i = 0; ; i++) {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (AggregatoreRicette)' } }).catch(() => null);
    if (r?.ok) return r.text();
    if (i >= 2) throw new Error('MIMIT ' + (r ? r.status : 'rete'));
    await new Promise(ok => setTimeout(ok, 3000 * (i + 1)));
  }
}
const options = (html, name) => {
  const m = html.match(new RegExp(`<select[^>]*name="${name.replace(/[[\]]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</select>`));
  return m ? [...m[1].matchAll(/<option[^>]*value="([^"]*)"/g)].map(x => x[1]).filter(Boolean) : [];
};
function tableRows(html) {
  const i = html.indexOf('id-table-results');
  if (i < 0) return [];
  const t = html.slice(i, html.indexOf('</table>', i));
  return [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => unescape(c[1])))
    .filter(r => r.length >= 4 && !isNaN(parseFloat(r[3])));
}

async function loadPrices(env) {
  try { return JSON.parse(await env.PRICES_KV.get('prices') || 'null') || { provinces: {} }; } catch { return { provinces: {} }; }
}
// Aggiorna un lotto di province; restituisce quante ne ha aggiornate e quante ne restano
async function refreshBatch(env) {
  const home = await mimitPage({});
  const year = Math.max(...options(home, 'ANNO').map(Number));
  const month = Math.max(...options(await mimitPage({ ANNO: year }), 'MESE').map(Number));
  const period = `${MESI[month]} ${year}`;
  const data = await loadPrices(env);
  // Prima le città più popolose, poi le altre
  const order = [...new Set(['Roma', 'Milano', 'Napoli', 'Torino', 'Palermo', 'Bari', 'Bologna', 'Firenze', 'Genova', 'Venezia', 'Verona', 'Cagliari', ...Object.keys(PROVINCES)])];
  const stale = order.filter(p => {
    const d = data.provinces[p];
    return !d || d.period !== period || Date.now() - Date.parse(d.updated) > 30 * 864e5;
  });
  const done = [];
  for (const prov of stale.slice(0, BATCH)) {
    const items = {};
    let failed = false;
    for (const cat of MIMIT_CATS) {
      try { for (const r of tableRows(await mimitPage({ ANNO: year, MESE: month, 'f[PROVINCIA]': prov, 'f[TIPO_RECORD_MISE]': cat }))) items[r[0]] = parseFloat(r[3]); }
      catch { failed = true; break; }
    }
    if (failed) break; // portale non disponibile: salva il lavoro fatto e riprende al prossimo giro
    if (Object.keys(items).length) { data.provinces[prov] = { period, updated: new Date().toISOString(), items }; done.push(prov); }
  }
  // Media nazionale di ogni prodotto sulle province disponibili del mese più recente
  const acc = {};
  for (const d of Object.values(data.provinces)) if (d.period === period) for (const [k, v] of Object.entries(d.items)) (acc[k] ||= []).push(v);
  data.period = period;
  data.national = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100]));
  data.updated = new Date().toISOString();
  await env.PRICES_KV.put('prices', JSON.stringify(data));
  _prices = null;
  return { period, updated: done, remaining: stale.length - done.length };
}
let _prices;
async function prices(env) {
  if (!_prices || Date.now() - _prices.t > 3600e3) _prices = { t: Date.now(), d: await loadPrices(env) };
  return _prices.d;
}
// Prezzi da usare: provincia richiesta o più vicina, altrimenti media nazionale
async function pricesFor(env, b, req) {
  const d = await prices(env);
  const cf = req.cf || {};
  const prov = PROVINCES[b.province] ? b.province : nearestProvince(+(b.lat ?? cf.latitude), +(b.lon ?? cf.longitude));
  let zone = prov, local = prov && d.provinces[prov];
  // Provincia senza dati questo mese: usa la più vicina tra quelle disponibili
  if (prov && !local) { zone = nearestProvince(...PROVINCES[prov], Object.keys(d.provinces).filter(p => p !== prov)); local = zone && d.provinces[zone]; }
  if (local && Object.keys(local.items).length) return { zone: zone === prov ? prov : `${zone} (vicino a ${prov})`, period: local.period, items: { ...d.national, ...local.items } };
  if (d.national && Object.keys(d.national).length) return { zone: 'media nazionale', period: d.period, items: d.national };
  return null;
}

// €/kg di ogni ingrediente della tabella per la zona: media dei prodotti MIMIT corrispondenti, altrimenti prezzo indicativo
async function priceTable(env, b, req) {
  const official = await pricesFor(env, b, req);
  const eur = {}, src = {};
  for (const it of ING.items) {
    let v = null;
    if (official && it.mimit) {
      const rx = new RegExp(it.mimit, 'i');
      const hits = Object.entries(official.items).filter(([k]) => rx.test(k)).map(([, x]) => x);
      if (hits.length) v = Math.round(hits.reduce((a, x) => a + x, 0) / hits.length * 100) / 100;
    }
    eur[it.k] = v ?? it.eur;
    src[it.k] = v == null ? 'i' : 'm'; // i = indicativo, m = MIMIT
  }
  // version cambia a ogni aggiornamento dei prezzi: l'app la confronta e ricalcola i costi delle ricette
  const d = await prices(env);
  const version = `${d.period || ''}|${(d.updated || '').slice(0, 10)}|${ING.items.length}`;
  return { zone: official?.zone || 'media nazionale', period: official?.period || null, version, eur, src, re: Object.fromEntries(ING.items.map(x => [x.k, x.re])) };
}

async function nutrition(env, b, req) {
  const official = await pricesFor(env, b, req);
  const ingredients = (Array.isArray(b.ingredients) ? b.ingredients : []).slice(0, 40).map(x => str(x, 150));
  if (!ingredients.length) throw Object.assign(new Error('Ingredienti mancanti'), { status: 400 });
  const servings = Math.min(50, Math.max(1, parseInt(b.servings) || 4));
  const result = await aiJson(env, `Ricetta: ${str(b.title, 150)} (dosi per ${servings} persone)
Ingredienti:
${ingredients.map(x => '- ' + x).join('\n')}

Per ogni ingrediente stima, per la quantità indicata (se è "q.b." o manca, usa una quantità tipica per ${servings} persone):
- grams: peso in grammi (o millilitri) usato nella ricetta;
- kcal: calorie totali di quella quantità, con valori nutrizionali medi (crudo, come si compra);
- protein, carbs, fat: grammi di proteine, carboidrati e grassi di quella quantità;
- eur: costo in euro di quella quantità con prezzi medi al supermercato in Italia. ${official ? `Usa per primi questi prezzi medi ufficiali (Osservatorio Prezzi MIMIT, ${official.period}, ${official.zone}; prezzo per la quantità tra parentesi): ${Object.entries(official.items).map(([k, v]) => `${k} ${v} €`).join('; ')}. Per gli ingredienti che non compaiono lì usa ` : 'Usa '}questi prezzi medi indicativi: ${PRICES}. Per ingredienti non presenti in nessun elenco stima un prezzo medio italiano realistico. Conta solo la quantità usata, non la confezione intera.
Ignora le voci che non sono ingredienti (es. note tra parentesi).
Rispondi solo con JSON: {"items":[{"name":"","grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0,"eur":0}]}`);
  const num = v => Math.max(0, +v || 0);
  const items = (result?.items || []).map(x => ({ name: str(x.name, 80), grams: num(x.grams), kcal: num(x.kcal), protein: num(x.protein), carbs: num(x.carbs), fat: num(x.fat), eur: num(x.eur) }));
  return { result: { servings, items, prices: official ? `Osservatorio Prezzi MIMIT, ${official.period} · ${official.zone}` : 'prezzi medi indicativi', zone: official?.zone || null } };
}

// Anteprima di una pagina per conto dell'app: i browser non possono leggere direttamente Facebook, Instagram e molti siti.
// Il server si identifica in modo trasparente come "AggregatoreRicette" e usa solo i dati pubblici delle anteprime dei link
// (titolo, descrizione, immagine) e i blocchi schema.org Recipe.
const PREVIEW_UA = 'Gnamina/1.0 (+https://gnamina.it/)';
// Trascrizione del parlato di un video (Whisper su Workers AI). Solo video brevi e non troppo pesanti: la quota è condivisa.
// info.partial diventa true se del video si è potuta scaricare (e quindi trascrivere) solo la prima parte
async function transcribe(env, videoUrl, seconds, referer = 'https://www.tiktok.com/', info = {}) {
  try {
    if (!env?.AI || !/^https:\/\//.test(videoUrl) || !seconds || seconds > 600) return '';
    // solo i primi 24 MB: i video dei social hanno l'indice all'inizio, quindi anche un pezzo si legge (es. 92 s di un reel di 125 s da 31 MB)
    const r = await fetch(videoUrl, { headers: { 'User-Agent': PREVIEW_UA, Referer: referer, Range: 'bytes=0-23999999' } });
    if (!r.ok) return '';
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 24e6) return '';
    // «Content-Range: bytes 0-23999999/31000000»: il file intero è più grande del pezzo scaricato
    const whole = +((r.headers.get('content-range') || '').split('/')[1] || 0);
    // video con sola musica: Whisper inventa frasi di chiusura dei sottotitoli («Grazie a tutti», «Sottotitoli creati dalla comunità Amara.org», «Musica»)
    const t = (await whisper(env, buf)).replace(/\b(?:musica|grazie a tutti|grazie per la visione|grazie per l'attenzione|sottotitoli (?:creati|a cura) [^.]*|amara\.org|iscriviti al canale)\b[.!,]?/gi, ' ').replace(/\s+/g, ' ').trim();
    if (t.split(' ').filter(w => /\p{L}{2}/u.test(w)).length < 6) return '';
    // video con sola musica: Whisper inventa frasi ripetute («Grazie a tutti. Grazie a tutti…»), che non sono una ricetta
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
    if (w.length >= 6 && new Set(w).size / w.length < 0.35) return '';
    if (whole > buf.byteLength) info.partial = true;
    return t;
  } catch (e) { console.log('trascrizione non riuscita', e.message); return null; } // null = da riprovare (non va in cache)
}
// Whisper: se c'è la chiave si usa prima Groq (piano gratuito con 8 ore di audio al giorno, nessun addestramento sui dati),
// e Workers AI resta di riserva: la trascrizione è la voce che più consuma la quota di Cloudflare
async function whisper(env, buf, mime = 'video/mp4') {
  const ext = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }[mime] || 'mp4';
  if (env.GROQ_KEY && env.FORCE_AI !== 'cf') try {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: ext === 'mp4' ? 'video/mp4' : mime }), 'audio.' + ext); fd.append('model', 'whisper-large-v3-turbo'); fd.append('language', 'it'); fd.append('response_format', 'json');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + env.GROQ_KEY }, body: fd });
    if (r.ok) { console.log('Whisper: Groq'); return str((await r.json()).text, 8000).trim(); }
    console.log('Groq whisper non disponibile:', r.status, str(await r.text(), 200));
  } catch (e) { console.log('Groq whisper non disponibile:', e.message); }
  const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: Buffer.from(buf).toString('base64'), language: 'it', task: 'transcribe' });
  return str(out?.text, 8000).trim();
}

// Parole significative di un titolo o di una riga di ingredienti (per confronti tolleranti)
const STOP = new Set(['alla', 'alle', 'allo', 'agli', 'con', 'della', 'delle', 'del', 'dei', 'degli', 'di', 'da', 'il', 'la', 'le', 'lo', 'gli', 'un', 'una', 'per', 'come', 'fatto', 'fatti', 'ricetta', 'ricette', 'facile', 'veloce', 'classico', 'classica', 'grande', 'buono', 'buona', 'perfetto', 'perfetta', 'originale', 'tradizionale', 'cremoso', 'cremosa', 'the', 'and']);
const words = t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 4 && !STOP.has(w));
const ytIdOf = url => { try { const u = new URL(url); if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) return ''; const id = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1]; return /^[\w-]{11}$/.test(id || '') ? id : ''; } catch { return ''; } };

// La stessa ricetta sul sito del cuoco: nella descrizione del video c'è quasi sempre il link al sito, e lì la ricetta ha i dati
// strutturati (schema.org Recipe) con il procedimento scritto. Si cerca sul sito il titolo del video («?s=», WordPress e simili),
// si legge la pagina più somigliante e la si accetta se è lo stesso piatto: titolo sovrapponibile e, quando il video elenca gli
// ingredienti, gli stessi ingredienti (le dosi possono differire, es. per un numero diverso di persone: vale la lista del sito)
// i passaggi di una scheda schema.org, come testo (stringa, elenco di HowToStep o di sezioni)
const ldSteps = ins => !ins ? [] : typeof ins === 'string' ? [ins] : [].concat(ins).flatMap(s => typeof s === 'string' ? [s] : s && s.itemListElement ? ldSteps(s.itemListElement) : [String(s && (s.text || s.name) || '')]);
async function creatorRecipe(desc, title, timeoutMs = 9000) {
  const stopAt = Date.now() + timeoutMs, left = () => Math.max(500, stopAt - Date.now());
  const fx = (url, opt = {}) => fetch(url, { ...opt, headers: { 'User-Agent': PREVIEW_UA, 'Accept-Language': 'it-IT,it;q=0.9', ...(opt.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(left()) }).catch(() => null);
  const short = String(title).split(/[:|–—]| - /)[0].trim(), tw = words(short);
  if (tw.length < 1) return '';
  const links = [...new Set((String(desc).match(/https?:\/\/[^\s)<>"']+/g) || []).map(x => x.replace(/[.,;!?]+$/, '')))]
    .filter(x => !/youtube\.|youtu\.be|instagram\.|facebook\.|tiktok\.|twitter\.|x\.com|amazon|amzn\.|apple\.|spotify\.|telegram|whatsapp|t\.me|linktr|paypal|patreon|pinterest|threads\.net|discord|twitch|onlyfans|play\.google|tidal|deezer/i.test(x)).slice(0, 5);
  const origins = [], direct = [];
  for (const l of links) { // i link corti (bit.ly…) si seguono per trovare il sito vero
    const r = await fx(l, { method: 'HEAD' }); const u = r && r.url || l;
    try { const x = new URL(u), o = x.origin; if (/youtube\.|youtu\.be|instagram\.|facebook\.|tiktok\.|amazon|google\./i.test(x.hostname)) continue; if (!origins.includes(o)) origins.push(o);
      const slug = words(decodeURIComponent(x.pathname.split('/').filter(Boolean).pop() || '')); // link diretto alla pagina della ricetta
      if (tw.filter(w => slug.some(y => y.startsWith(w.slice(0, 5)))).length >= Math.min(2, tw.length)) direct.push(u); } catch {}
    if (origins.length >= 3 || Date.now() > stopAt) break;
  }
  console.log('sito del cuoco: siti', origins.join(' ') || 'nessuno');
  // ingredienti scritti nella descrizione (righe brevi con una dose o un segno di elenco): i nomi, per riconoscere lo stesso piatto
  const descNames = new Set();
  // i capitoli del video («00:37 Tomato Sauce») e i link non sono ingredienti
  for (const line of String(desc).split('\n')) { if (line.length > 80 || !/\d|^\s*[-•✔✓*▪►]/.test(line) || /^\s*\(?(?:\d{1,2}:)?\d{1,2}:\d{2}\b|https?:\/\//.test(line)) continue; const w = words(line.replace(/\d+(?:[.,]\d+)?\s*(?:g|gr|grammi|kg|ml|cl|l|cucchia\w*|spicchi?o?|mazz\w*|pizzic\w*|tazz\w*|bicchier\w*)?\b/gi, '')).filter(x => !/^(q\.?b|quanto|basta|piacere|ingredient|preparare|persone|porzioni|circa|extravergine|fresco|fresca)/.test(x)); if (w.length) descNames.add(w[0].slice(0, 5)); }
  const checkPage = async u => {
      const pr = await fx(u); if (!pr || !pr.ok) return '';
      const ph = (await pr.text()).slice(0, 1_500_000);
      for (const m of ph.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        if (!/"Recipe"/.test(m[1])) continue;
        let rec; try { const j = JSON.parse(m[1]); rec = [j, ...(j['@graph'] || []), ...(Array.isArray(j) ? j : [])].find(x => x && (x['@type'] === 'Recipe' || (Array.isArray(x['@type']) && x['@type'].includes('Recipe')))); } catch { continue; }
        if (!rec || !rec.recipeInstructions) continue;
        const rw = words(rec.name || ''); if (tw.filter(w => rw.some(x => x.startsWith(w.slice(0, 5)))).length < Math.min(2, tw.length)) continue;
        // stesso piatto se gli ingredienti del video si ritrovano sul sito (almeno la metà, e almeno due); le dosi possono differire
        if (descNames.size >= 3) {
          const siteW = (rec.recipeIngredient || []).map(String).flatMap(l => words(l.replace(/\d+(?:[.,]\d+)?/g, '')).map(x => x.slice(0, 5)));
          const hit = [...descNames].filter(n => siteW.includes(n)).length;
          if (hit < Math.max(2, Math.ceil(descNames.size / 2))) { console.log('sito del cuoco: ingredienti diversi', u, hit, '/', descNames.size); continue; }
        }
        console.log('sito del cuoco: ricetta trovata', u);
        // il blog ha la scheda ma non il procedimento scritto (passaggi «-» sotto le foto): se nella pagina c'è il video YouTube della ricetta, lo si segnala all'app
        const written = ldSteps(rec.recipeInstructions).some(x => /\p{L}{2}/u.test(x));
        const yt = written ? '' : (ph.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/) || [])[1] || '';
        return `<script type="application/ld+json">${JSON.stringify(rec).replace(/<\//g, '<\\/')}</script><meta property="gn:site" content="${u.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${yt ? `<meta property="gn:yt" content="${yt}">` : ''}`;
      }
      return '';
  };
  for (const u of direct.slice(0, 2)) { const r = await checkPage(u); if (r) return r; if (Date.now() > stopAt) return ''; }
  for (const origin of origins) {
    const sr = await fx(`${origin}/?s=${encodeURIComponent(short)}`); if (!sr || !sr.ok) continue;
    const html = (await sr.text()).slice(0, 1_500_000), host = new URL(origin).hostname.replace(/^www\./, '');
    const cand = {};
    for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) { const u = m[1].split('#')[0]; if (/[?&]s=|\/page\/\d|\/tag\/|\/category\/|\/categoria\//.test(u)) continue; try { if (new URL(u).hostname.replace(/^www\./, '') !== host) continue; } catch { continue; }
      const slug = words(decodeURIComponent(u.split('/').filter(Boolean).pop() || '')); const sc = tw.filter(w => slug.some(x => x.startsWith(w.slice(0, 5)))).length; if (sc > (cand[u] || 0)) cand[u] = sc; }
    const best = Object.entries(cand).sort((a, b) => b[1] - a[1]).filter(([, sc]) => sc >= Math.min(2, tw.length)).slice(0, 2);
    console.log('sito del cuoco: candidati su', origin, best.map(x => x[0]).join(' ') || 'nessuno');
    for (const [u] of best) { if (direct.includes(u)) continue; const r = await checkPage(u); if (r) return r; if (Date.now() > stopAt) return ''; }
  }
  return '';
}

// Didascalia di un post social con il link alla ricetta sul sito o sul blog del cuoco (es. «RICETTA: https://blog…»):
// la ricetta si legge da lì come per YouTube. Il «titolo» per riconoscerla è la prima riga col nome del piatto,
// saltando le righe generiche («Nuova VIDEO RICETTA», «Ingredienti», link, hashtag)
async function socialSite(desc) {
  desc = String(desc || '');
  if (!/https?:\/\/(?!(?:www\.)?(?:instagram|facebook|tiktok|youtube|youtu\.be|linktr))/i.test(desc)) return '';
  const clean = l => l.replace(/https?:\/\/\S+|#\S+|@\S+/g, '').replace(/[^\p{L}\p{N}' ,.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const title = desc.split('\n').map(clean).find(l => words(l).length >= 1 && !/\bvideo\b|^(?:nuova )?ricett[ae]\b|^ingredienti|^procedimento|^per \d/i.test(l)) || clean(desc.split('\n')[0]);
  try { return await creatorRecipe(desc, title); } catch (e) { console.log('sito del cuoco (social)', e.message); return ''; }
}

// Gemini guarda il video YouTube (link pubblico passato direttamente all'API) e trascrive ingredienti e passaggi come detti e mostrati.
// Si usa solo quando il procedimento non è scritto da nessuna parte; consuma quota del piano gratuito, quindi video fino a 25 minuti
async function ytVideoRecipe(env, id, seconds) {
  if (!env.GEMINI_KEY || !id || (seconds && seconds > 1500)) return null;
  const prompt = `Guarda questo video di cucina e trascrivi fedelmente la ricetta così come viene detta e mostrata: sei un trascrittore, non un cuoco. Rispondi in italiano, SOLO con JSON:
{"is_recipe":true,"title":"nome del piatto","servings":0,"time":0,"ingredients":["quantità unità ingrediente, come detto o mostrato (es. \"400 g spaghetti\", \"3 spicchi aglio\"); solo il nome se la dose non viene detta"],"steps":["un passaggio per voce, in ordine, con le parole del cuoco, comprese temperature e tempi detti"]}
steps: ogni passaggio è una frase completa, con la maiuscola all'inizio e il punto alla fine, che descrive un'azione compiuta: unisci nella stessa voce le frasi brevi della stessa azione («puliamo la cipolla», «la tagliamo in otto pezzi» → "Puliamo la cipolla e la tagliamo in otto pezzi."), e lascia fuori i commenti che non sono istruzioni. Di norma bastano da 5 a 15 passaggi.
Un passaggio è un'azione di cucina (tagliare, mescolare, impastare, cuocere, far riposare, servire). NON sono passaggi, e non vanno in steps: l'elenco degli ingredienti detto a voce («un etto di mortadella», «parmigiano reggiano»: vanno solo in ingredients), i saluti, le battute, i racconti e le opinioni del cuoco («siamo nella Pork Valley», «il ripieno il giorno dopo è tutta un'altra cosa»). Un consiglio su come fare si tiene, scritto come istruzione («Il ripieno è meglio prepararlo il giorno prima.»).
servings: per quante persone, solo se detto, altrimenti 0. time: minuti totali dall'inizio al piatto pronto solo se detto o chiaramente deducibile dai tempi detti, altrimenti 0. Non inventare dosi, tempi o passaggi non detti né mostrati. is_recipe false se il video non è una ricetta.`;
  const body = { contents: [{ parts: [{ file_data: { file_uri: `https://www.youtube.com/watch?v=${id}` } }, { text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4000, responseMimeType: 'application/json', mediaResolution: 'MEDIA_RESOLUTION_LOW' } };
  // Modello sovraccarico (503) o quota del minuto (429): si riprova dopo una pausa, poi con i modelli di riserva
  const models = [...new Set([GEMINI_MODEL, ...GEMINI_VIDEO_FALLBACK])];
  const stopAt = Date.now() + 50000;
  for (const model of models) for (let i = 0; i < 3; i++) {
    if (Date.now() > stopAt - 5000) return null;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(5000, stopAt - Date.now())) }).catch(e => ({ ok: false, status: 0, text: async () => String(e.message) }));
    if (r.ok) { const j = await r.json(); console.log('video Gemini: ok', model, JSON.stringify(j.usageMetadata || {})); return lastJson((j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')); }
    const msg = str(await r.text(), 300);
    if (r.status === 400 && /mediaResolution|media_resolution/i.test(msg)) { delete body.generationConfig.mediaResolution; continue; }
    console.log('video Gemini non disponibile:', model, r.status, str(msg.replace(/\s+/g, ' '), 160));
    if (r.status === 503 || r.status === 429) { if (i < 2) await new Promise(ok => setTimeout(ok, 2500)); continue; }
    break; // altro errore (404 modello, 400): passa al modello successivo
  }
  return null;
}

async function preview(env, b) {
  let u;
  try { u = new URL(str(b.url, 2000)); } catch { throw Object.assign(new Error('Link non valido'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(u.hostname)) throw Object.assign(new Error('Link non valido'), { status: 400 });
  const get = async url => {
    for (let i = 0; i < 2; i++) {  // Instagram e Facebook a volte rifiutano: un secondo tentativo
      const r = await fetch(url, { headers: { 'User-Agent': PREVIEW_UA, 'Accept-Language': 'it-IT,it;q=0.9' }, redirect: 'follow' }).catch(() => null);
      if (r?.ok) return { r, html: (await r.text()).slice(0, 2_000_000) };
      await new Promise(ok => setTimeout(ok, 1500));
    }
    return null;
  };
  // YouTube: oEmbed dà solo il titolo; la pagina del video ha la descrizione completa (spesso con ingredienti e dosi), autore e durata.
  // I sottotitoli automatici non si leggono da qui (il lettore li chiede con i suoi token): il parlato resta fuori
  const yt = /(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname) && (u.hostname.endsWith('youtu.be') ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1]);
  if (yt && /^[\w-]{11}$/.test(yt)) {
    // YouTube a volte risponde con una pagina senza dati (consenso, controllo): un secondo tentativo, poi almeno titolo e autore da oEmbed
    let html = '', title = '', desc = '', author = '', secs = 0;
    // i dati del video stanno in «videoDetails»: si legge da lì, non dal primo "title" della pagina (che può essere di una playlist)
    const js = k => { const at = html.indexOf('"videoDetails":'), part = at >= 0 ? html.slice(at, at + 60_000) : html; const m = part.match(new RegExp(`"${k}":"((?:[^"\\\\]|\\\\.)*)"`)); try { return m ? JSON.parse('"' + m[1] + '"') : ''; } catch { return ''; } };
    for (let i = 0; i < 2 && !desc; i++) {
      if (i) await new Promise(ok => setTimeout(ok, 800));
      // SOCS=CAI è la scelta «rifiuta i cookie non necessari»: senza, dall'Europa YouTube manda alla pagina del consenso invece del video
      const r = await fetch(`https://www.youtube.com/watch?v=${yt}&hl=it`, { headers: { 'User-Agent': i ? PREVIEW_UA : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'it-IT,it;q=0.9', Cookie: 'SOCS=CAI' }, redirect: 'follow' }).catch(() => null);
      html = r?.ok ? (await r.text()).slice(0, 3_000_000) : '';
      if (!r?.ok) console.log('YouTube pagina', r ? r.status : 'rete', 'tentativo', i + 1);
      else if (/consent\.youtube\.com|consent\.google/.test(r.url) || !html.includes('"videoDetails":')) console.log('YouTube pagina senza dati (consenso o controllo), tentativo', i + 1, str(r.url, 80));
      title = js('title'); desc = js('shortDescription'); author = js('author'); secs = +js('lengthSeconds') || 0;
    }
    // Con la chiave ufficiale (segreto YOUTUBE_KEY, YouTube Data API v3, gratuita: 10.000 unità al giorno, 1 per video) la descrizione arriva sempre
    if (!desc && env.YOUTUBE_KEY) try {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${yt}&key=${env.YOUTUBE_KEY}`, { signal: AbortSignal.timeout(8000) })).json();
      const it = j.items?.[0]; if (it) { title = str(it.snippet?.title, 300); desc = str(it.snippet?.description, 6000); author = str(it.snippet?.channelTitle, 120);
        const m = String(it.contentDetails?.duration || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); secs = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; console.log('YouTube: Data API'); }
      else console.log('YouTube Data API:', str(JSON.stringify(j.error || j), 200));
    } catch (e) { console.log('YouTube Data API', e.message); }
    if (!title) try { const o = await (await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`)).json(); title = str(o.title, 300); author = str(o.author_name, 120); console.log('YouTube: solo oEmbed'); } catch {}
    if (title || desc) {
      const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      let site = ''; try { site = await creatorRecipe(desc, title); } catch (e) { console.log('sito del cuoco', e.message); }
      return { html: `<html><head><title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:site_name" content="${esc(author)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="https://i.ytimg.com/vi/${yt}/hqdefault.jpg">${site}</head></html>`, url: `https://www.youtube.com/watch?v=${yt}`, seconds: secs, site: !!site };
    }
  }
  // Instagram: la pagina di incorporamento ufficiale (pensata per mostrare i post su altri siti) ha la didascalia completa
  let embedCaption = '', embedImage = '', igVideo = '', igSeconds = 0, igRef = 'https://www.instagram.com/';
  const ig = u.hostname.match(/instagram\.com$/) && u.pathname.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/);
  if (ig) {
    const e = await get(`https://www.instagram.com/${ig[1] === 'reels' ? 'reel' : ig[1]}/${ig[2]}/embed/captioned/`);
    const m = e && e.html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/);
    const im = e && e.html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/);
    if (im) embedImage = im[1].replace(/&amp;/g, '&');
    // il video del reel (nella pagina è un testo JSON con le barre protette): serve a trascrivere il parlato, dove spesso c'è il procedimento
    const vu = e && e.html.match(/video_url\\*":\\*"(https:[^"]+?)\\*"/), vd = e && e.html.match(/video_duration\\*":([\d.]+)/);
    if (vu) { igVideo = vu[1].replace(/\\+u0026/g, '&').replace(/\\/g, ''); igSeconds = vd ? +vd[1] : 0; }
    if (m) embedCaption = unescape(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<a [^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, '')).replace(/View all \d+ comments\s*$/i, '').trim();
  }
  // Facebook: la pagina del video chiede l'accesso, ma il riquadro di incorporamento ufficiale (plugins/video.php) ha il testo del post,
  // con i link veri (al posto di l.facebook.com) e il file del video da trascrivere
  if (/(^|\.)facebook\.com$|(^|\.)fb\.watch$/.test(u.hostname) && /\/videos?\/|\/reel\/|\/watch|fb\.watch/.test(u.hostname + u.pathname + u.search)) {
    const e = await get(`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u.href)}&show_text=true&width=500`);
    const m = e && e.html.match(/data-testid="post_message"[^>]*>([\s\S]*?)<\/div>/);
    if (m) embedCaption = unescape(m[1]
      .replace(/<a [^>]*href="https:\/\/l\.facebook\.com\/l\.php\?u=([^&"]+)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, (_, x) => { try { return ' ' + decodeURIComponent(x.replace(/&amp;/g, '&')) + ' '; } catch { return ' '; } })
      .replace(/<\/p>\s*<p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    const v = e && (e.html.match(/"sd_src(?:_no_ratelimit)?\\*":\\*"(https:[^"]+?)\\*"/) || e.html.match(/"hd_src(?:_no_ratelimit)?\\*":\\*"(https:[^"]+?)\\*"/));
    if (v) { igVideo = v[1].replace(/\\+u0025/g, '%').replace(/\\+u0026/g, '&').replace(/\\/g, ''); igSeconds = 120; igRef = 'https://www.facebook.com/'; } // la durata non c'è: il limite vero è il peso del file (24 MB)
  }
  // TikTok: la pagina del video chiede l'accesso e oEmbed non dà più il testo; la pagina di incorporamento ha didascalia, autore e copertina
  let tk = null;
  if (/(^|\.)tiktok\.com$/.test(u.hostname)) {
    let id = (u.pathname.match(/\/video\/(\d+)/) || u.pathname.match(/^\/(?:embed|player\/v1)\/(\d+)/) || [])[1];
    if (!id) { // link corti vm.tiktok.com / vt.tiktok.com / tiktok.com/t/…: si segue il reindirizzamento
      const h = await fetch(u, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': PREVIEW_UA } }).catch(() => null);
      id = (h && new URL(h.url).pathname.match(/\/video\/(\d+)/) || [])[1];
    }
    const e = id && await get(`https://www.tiktok.com/embed/${id}`);
    const m = e && e.html.match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
    try {
      const data = m && JSON.parse(m[1]).source.data, v = data && Object.values(data).find(x => x && x.videoData)?.videoData;
      if (v) tk = { text: str(v.itemInfos?.text, 6000), author: str(v.authorInfos?.nickName || v.authorInfos?.uniqueId, 80), image: str((v.itemInfos?.covers || [])[0], 1000), url: id ? `https://www.tiktok.com/@${v.authorInfos?.uniqueId || 'tiktok'}/video/${id}` : u.href,
        video: str((v.itemInfos?.video?.urls || [])[0], 2000), seconds: +v.itemInfos?.video?.videoMeta?.duration || 0 };
    } catch {}
    if (id && !tk) throw Object.assign(new Error('TikTok non risponde, riprova tra qualche minuto'), { status: 502 });
    if (tk) {
      // il parlato del video, trascritto (nei reel la ricetta spesso è solo detta a voce), e la ricetta sul sito del cuoco se la didascalia ha il link
      const info = {};
      const [tr, site] = await Promise.all([b.transcribe === false ? '' : transcribe(env, tk.video, tk.seconds, undefined, info), socialSite(tk.text)]), transcript = tr || '';
      const esc = v => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return { html: `<html><head><title>${esc(tk.text.split('\n')[0].slice(0, 140))}</title><meta property="og:title" content="${esc(tk.text)}"><meta property="og:site_name" content="${esc(tk.author)}"><meta property="og:image" content="${esc(tk.image)}">${site}</head></html>`, url: tk.url, transcript, site: !!site, ...(tr === null ? { retry: true } : {}), ...(info.partial && transcript ? { partial: true } : {}) };
    }
  }
  const page = await get(u);
  if (!page && !embedCaption) throw Object.assign(new Error('Il sito non permette di leggere questo post'), { status: 502 });
  const r = page?.r || { url: u.href }, html = page?.html || '';
  const meta = k => {
    // le virgolette di apertura e chiusura devono coincidere: «Il Cucchiaio d'Argento» non si tronca all'apostrofo
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=(?:"([^"]*)"|'([^']*)')`, 'i')) || html.match(new RegExp(`<meta[^>]+content=(?:"([^"]*)"|'([^']*)')[^>]*(?:property|name)=["']${k}["']`, 'i'));
    return m ? unescape(m[1] ?? m[2] ?? '') : '';
  };
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(x => /recipe/i.test(x)).slice(0, 3);
  // si restituisce una pagina minima che l'app legge come se l'avesse scaricata lei
  const tag = (k, v) => v ? `<meta property="${k}" content="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` : '';
  const mini = `<html><head><title>${(unescape((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')).replace(/</g, '&lt;')}</title>`
    + ['og:title', 'og:site_name', 'description'].map(k => tag(k, meta(k))).join('') + tag('og:image', meta('og:image') || embedImage)
    + tag('og:description', embedCaption.length > meta('og:description').length ? embedCaption : meta('og:description'))
    + ld.map(x => `<script type="application/ld+json">${x}</script>`).join('') + '</head></html>';
  // Reel di Instagram: come per TikTok si trascrive il parlato (Groq prima, Workers AI di riserva), solo video fino a 4 minuti
  const desc = embedCaption.length > meta('og:description').length ? embedCaption : meta('og:description');
  const info = {};
  const [transcript, site] = await Promise.all([igVideo && b.transcribe !== false ? transcribe(env, igVideo, igSeconds, igRef, info) : '', ld.length ? '' : socialSite(desc)]);
  const out = { html: site ? mini.replace('</head>', site + '</head>') : mini, url: r.url };
  if (transcript) out.transcript = transcript; if (transcript && info.partial) out.partial = true; if (site) out.site = true; if (transcript === null) out.retry = true;
  return out;
}

// Traduzione in italiano di una ricetta strutturata (dataset UniTools, CC BY-SA 4.0): solo titolo, descrizione,
// nomi e note degli ingredienti, passaggi. Formato e dimensione limitati: non è un traduttore generico.
async function translateRecipe(env, b) {
  const r = b.recipe || {};
  const src = {
    name: str(r.name, 120), summary: str(r.summary, 600),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 40).map(x => ({ name: str(x.name, 80), note: str(x.note || '', 160) })),
    steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 25).map(x => str(x, 700)),
  };
  if (!src.name || !src.ingredients.length) throw Object.assign(new Error('Ricetta non valida'), { status: 400 });
  const out = await aiJson(env, `Traduci in italiano questa ricetta, in modo naturale e con i termini usati nelle cucine italiane
(traduci anche le misure nel testo: "two tablespoons" = "due cucchiai", "a teaspoon" = "un cucchiaino", "a cup" = "una tazza"; "scallions" = "cipollotti", "heavy cream" = "panna fresca", "all-purpose flour" = "farina 00", "cilantro" = "coriandolo fresco").
Il nome del piatto: se ha un nome tradizionale noto in Italia usalo (es. "Spaghetti carbonara" -> "Spaghetti alla carbonara"), altrimenti traducilo o lascia il nome originale.
Mantieni esattamente la stessa struttura e lo stesso numero di ingredienti e di passaggi, nello stesso ordine.
Rispondi solo con JSON nello stesso formato:
${JSON.stringify(src)}`);
  const ok = out && typeof out.name === 'string' && Array.isArray(out.ingredients) && out.ingredients.length === src.ingredients.length && Array.isArray(out.steps) && out.steps.length === src.steps.length;
  if (!ok) throw Object.assign(new Error('Traduzione non valida'), { status: 502 });
  return { result: { name: str(out.name, 120), summary: str(out.summary, 700), ingredients: out.ingredients.map(x => ({ name: str(x.name, 80), note: str(x.note || '', 200) })), steps: out.steps.map(x => str(x, 900)) } };
}

// Foto generata con l'AI per una ricetta senza immagine (solo per l'aggiornamento automatico su GitHub, protetto da segreto).
// Flux Schnell resta nella quota gratuita giornaliera di Workers AI; l'immagine torna in base64 (PNG).
const CAT_EN = { Primi: 'pasta or rice first course', Secondi: 'main course', Contorni: 'vegetable side dish', Antipasti: 'appetizer', Dolci: 'dessert', Lievitati: 'baked bread or pizza', 'Piatti unici': 'one-dish meal', Colazione: 'breakfast' };
// Prima il modello di testo "studia" la ricetta (nome italiano, ingredienti, tipo di piatto) e descrive in inglese
// com'è il piatto pronto: così il generatore di immagini non fraintende il nome (es. "Acciughe alle olive" non è una pasta).
async function genImage(env, b) {
  const title = String(b.title || '').replace(/["\n]/g, ' ').trim().slice(0, 120);
  if (!title) throw Object.assign(new Error('Titolo mancante'), { status: 400 });
  const ing = (b.ingredients || []).slice(0, 12).map(x => String(x).slice(0, 60)).join('; ');
  const where = b.country && b.country !== 'Italia' ? `della cucina di ${String(b.country).slice(0, 40)}` : 'della cucina italiana';
  // descrizione già scritta guardando foto reali del piatto (scripts/aspetto_piatti.json): niente passaggio di testo
  const given = str(b.visual, 600).replace(/["\n]/g, ' ').trim();
  const d = given ? { visual: given, dish: title, course: '' } : await aiJson(env, `Ricetta ${where}: «${title}»${b.cat ? ` (tipo di piatto: ${str(b.cat, 20)})` : ''}.
Ingredienti: ${ing || 'non indicati'}.
Descrivi come appare questo piatto una volta pronto e servito, basandoti sugli ingredienti e sul tipo di preparazione, senza inventare ingredienti che non ci sono (se non c'è pasta, non è un piatto di pasta; se è un antipasto o un contorno, non mostrarlo come primo).
Rispondi SOLO con JSON: {"dish":"nome del piatto in inglese","course":"appetizer|first course|main course|side dish|one-dish meal|bread or pizza|dessert|breakfast|other","visual":"descrizione visiva in inglese in una frase (max 40 parole): forma, colori, ingredienti visibili, come è impiattato"}`);
  const visual = str(d?.visual, 600).replace(/["\n]/g, ' ').trim(), dish = str(d?.dish, 80).replace(/["\n]/g, ' ').trim(), course = str(d?.course, 20);
  const prompt = `Professional food photography of ${dish || title}, ${course && course !== 'other' ? course + ', ' : ''}${b.country && b.country !== 'Italia' ? `traditional dish from ${String(b.country).slice(0, 40)}` : 'traditional Italian home cooking'}. ${visual || `made with ${ing.slice(0, 160)}`} Served on a plate on a rustic wooden table, natural soft daylight, shallow depth of field, appetizing, photorealistic, no text, no people, no hands`;
  const r = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 });
  if (!r?.image) throw new Error('Immagine non generata');
  return { image: r.image, prompt, dish, course };
}

// Bozze del marchio (solo amministratore): un'immagine da un prompt, con Gemini (modello immagini) o con FLUX di Workers AI
async function brandImage(env, b) {
  const prompt = str(b.prompt, 1500).trim(); if (!prompt) throw Object.assign(new Error('Prompt mancante'), { status: 400 });
  if (b.provider === 'gemini') {
    if (!env.GEMINI_KEY) throw Object.assign(new Error('Gemini non configurato'), { status: 400 });
    const model = str(b.model, 60) || 'gemini-2.5-flash-image';
    const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, body: JSON.stringify(body) });
    if (!r.ok) throw Object.assign(new Error('Gemini ' + r.status + ' ' + str(await r.text(), 400)), { status: r.status });
    const parts = (await r.json()).candidates?.[0]?.content?.parts || [];
    const img = parts.find(p => p.inlineData || p.inline_data); const d = img && (img.inlineData || img.inline_data);
    if (!d) throw new Error('Gemini: nessuna immagine ' + str(parts.map(p => p.text || '').join(' '), 200));
    return { image: d.data, mime: d.mimeType || d.mime_type || 'image/png', provider: 'gemini' };
  }
  // Modelli di immagini di Workers AI (tutti nel piano gratuito): FLUX restituisce base64, Lucid/Phoenix restituiscono i byte
  const models = { flux: '@cf/black-forest-labs/flux-1-schnell', lucid: '@cf/leonardo/lucid-origin', phoenix: '@cf/leonardo/phoenix-1.0', sdxl: '@cf/bytedance/stable-diffusion-xl-lightning' };
  const m = models[b.provider] || models.flux;
  const r = await env.AI.run(m, b.provider === 'flux' || !models[b.provider] ? { prompt, steps: Math.min(8, +b.steps || 4) } : { prompt, width: 1024, height: 1024, num_steps: b.provider === 'phoenix' ? 25 : 20, guidance: b.provider === 'phoenix' ? 4 : 4.5, negative_prompt: 'blurry, photo, 3d render, text, watermark, letters, words' });
  if (r?.image) return { image: r.image, mime: 'image/jpeg', provider: b.provider };
  if (r instanceof ReadableStream || r instanceof ArrayBuffer || r?.byteLength !== undefined) {
    const buf = r instanceof ReadableStream ? await new Response(r).arrayBuffer() : r;
    return { image: Buffer.from(buf).toString('base64'), mime: 'image/png', provider: b.provider };
  }
  throw new Error('Immagine non generata');
}

// Verifica che una foto trovata su una banca immagini mostri davvero il piatto (solo GitHub Actions, protetto da segreto).
// Costa pochi neuroni rispetto a generare l'immagine: si prova prima questa strada.
async function checkImage(env, b) {
  const title = str(b.title, 120).trim(), data = str(b.image, 4e6);
  if (!title || !data) throw Object.assign(new Error('Titolo o foto mancante'), { status: 400 });
  const ing = (Array.isArray(b.ingredients) ? b.ingredients : []).slice(0, 6).map(x => str(x, 40)).join(', ');
  const r = await aiJson(env, `Questa foto è stata trovata cercando «${title}»${ing ? ` (ingredienti: ${ing})` : ''} su una banca di immagini.
Guarda SOLO la foto e rispondi con un oggetto JSON:
{"seen":"cosa mostra davvero la foto, in poche parole","match":true|false,"confidence":"alta|media|bassa"}
match è true solo se la foto mostra un piatto pronto che un cuoco italiano riconoscerebbe come «${title}» o una sua variante molto vicina (stesso piatto, stessi ingredienti principali, stesso tipo di preparazione).
È false se mostra un piatto diverso, ingredienti crudi, un animale vivo, un'illustrazione, un testo, persone in primo piano o non è chiaro cosa sia.`, `data:image/jpeg;base64,${data}`);
  return { result: r && { seen: str(r.seen, 160), match: r.match === true, confidence: str(r.confidence, 10) } };
}

// Sincronizzazione delle ricette personali tra dispositivi. Il telefono cifra ogni ricetta con una chiave derivata dal
// «codice ricettario» e manda qui solo l'impronta del codice (k) e i dati cifrati: il server non può leggere le ricette.
// Ogni documento vince se la sua ora di modifica t è più recente; le cancellazioni restano come segnaposto (del=1).
async function sync(env, b) {
  if (!env.SYNC) throw Object.assign(new Error('Sincronizzazione non disponibile'), { status: 503 });
  const k = String(b.k || '');
  if (!/^[0-9a-f]{64}$/.test(k)) throw Object.assign(new Error('Codice non valido'), { status: 400 });
  const now = Date.now();
  const stmts = [];
  for (const c of (Array.isArray(b.changes) ? b.changes : []).slice(0, 60)) {
    const id = str(c.id, 80), t = Math.floor(+c.t || 0), del = c.del ? 1 : 0, data = del ? '' : String(c.data || '');
    if (!id || !t || data.length > 500000) continue;
    stmts.push(env.SYNC.prepare('INSERT INTO docs (k,id,t,s,del,data) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(k,id) DO UPDATE SET t=excluded.t, s=excluded.s, del=excluded.del, data=excluded.data WHERE excluded.t > docs.t').bind(k, id, t, now, del, data));
  }
  if (stmts.length) await env.SYNC.batch(stmts);
  const since = Math.floor(+b.since);
  let rows = [], more = false;
  if (since >= 0) {
    const r = await env.SYNC.prepare('SELECT id, t, s, del, data FROM docs WHERE k = ?1 AND s > ?2 ORDER BY s LIMIT 100').bind(k, since).all();
    rows = r.results || []; more = rows.length === 100;
  }
  // prossimo "since": l'ultimo arrivo letto se c'è altro, altrimenti adesso con un margine per le scritture concorrenti
  return { now, next: more ? rows[rows.length - 1].s : now - 5000, rows, more };
}

// --- Account: Firebase Authentication (email, Google, Apple, Facebook) ---
// L'app ottiene un ID token da Firebase; qui si verifica la firma con le chiavi pubbliche di Google e si collega l'utente
// al suo codice ricettario (cifrato nel database con una chiave derivata dal segreto del server). Niente password qui.
const te = new TextEncoder(), td = new TextDecoder();
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
let jwks = { keys: null, at: 0 };
async function firebaseKeys(env) {
  if (jwks.keys && Date.now() - jwks.at < 3600e3) return jwks.keys;
  const r = await fetch(env.FIREBASE_JWKS || 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('Chiavi di verifica non disponibili');
  jwks = { keys: (await r.json()).keys || [], at: Date.now() };
  return jwks.keys;
}
async function verifyUser(env, req) {
  const no = m => Object.assign(new Error(m), { status: 401 });
  const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw no('Accesso richiesto');
  if (!env.FIREBASE_PROJECT) throw Object.assign(new Error('Account non ancora attivi'), { status: 503 });
  const [h, p, s] = m[1].split('.');
  let hdr, pay;
  try { hdr = JSON.parse(td.decode(b64u(h))); pay = JSON.parse(td.decode(b64u(p))); } catch { throw no('Sessione non valida'); }
  const now = Date.now() / 1000;
  if (hdr.alg !== 'RS256' || pay.aud !== env.FIREBASE_PROJECT || pay.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT}` || !pay.sub || !(pay.exp > now - 60) || !(pay.iat < now + 300)) throw no('Sessione non valida');
  const jwk = (await firebaseKeys(env)).find(k => k.kid === hdr.kid);
  if (!jwk) throw no('Sessione non valida');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), te.encode(`${h}.${p}`)))) throw no('Sessione non valida');
  return { uid: pay.sub, email: pay.email || '', name: pay.name || '', verified: !!pay.email_verified, provider: pay.firebase?.sign_in_provider || '' };
}
// Cifratura lato server (codici ricettario, passaggi di accesso) con una chiave derivata dal segreto ADMIN_TOKEN
async function serverKey(env, info) {
  if (!env.ADMIN_TOKEN) throw new Error('Segreto del server mancante');
  const base = await crypto.subtle.importKey('raw', te.encode(env.ADMIN_TOKEN), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('gnamina'), info: te.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealS(env, info, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await serverKey(env, info), te.encode(text)); return b64(iv) + '.' + b64(new Uint8Array(ct)); }
async function openS(env, info, s) { const [iv, ct] = String(s).split('.'); return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u(iv) }, await serverKey(env, info), b64u(ct))); }
const CODE_AB = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x => CODE_AB[x % 32]).join('');
const hexSha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');

// POST /account (Bearer): restituisce il codice ricettario dell'utente, creandolo al primo accesso (o adottando quello del
// dispositivo, così le ricette già sincronizzate diventano quelle dell'account). Con {delete:true} cancella account e ricette.
async function account(env, req, b) {
  const u = await verifyUser(env, req);
  if (!env.SYNC) throw Object.assign(new Error('Sincronizzazione non disponibile'), { status: 503 });
  const now = Date.now();
  const row = await env.SYNC.prepare('SELECT code FROM users WHERE uid = ?1').bind(u.uid).first();
  let code = row ? await openS(env, 'codice', row.code) : null;
  if (b.delete) {
    await socialTables(env);
    await env.SYNC.batch([...(code ? [env.SYNC.prepare('DELETE FROM docs WHERE k = ?1').bind(await hexSha('gnamina-id:' + code)), env.SYNC.prepare('DELETE FROM users WHERE uid = ?1').bind(u.uid)] : []), env.SYNC.prepare('DELETE FROM profiles WHERE uid = ?1').bind(u.uid), env.SYNC.prepare('DELETE FROM comments WHERE uid = ?1').bind(u.uid), env.SYNC.prepare('DELETE FROM reports WHERE uid = ?1').bind(u.uid)]);
    return { deleted: true };
  }
  if (!code) {
    code = /^[A-Z2-9]{16}$/.test(b.code || '') ? b.code : randomCode();
    await env.SYNC.prepare('INSERT INTO users (uid,email,name,provider,code,created,seen) VALUES (?1,?2,?3,?4,?5,?6,?6)').bind(u.uid, u.email, u.name, u.provider, await sealS(env, 'codice', code), now).run();
  } else await env.SYNC.prepare('UPDATE users SET seen = ?2, email = ?3, name = ?4 WHERE uid = ?1').bind(u.uid, now, u.email, u.name).run();
  return { code, email: u.email, name: u.name, verified: u.verified, provider: u.provider };
}
// Passaggio dell'accesso dal sito all'app Android (dove l'accesso Google/Apple/Facebook non può avvenire nella WebView):
// il sito deposita il refresh token cifrato sotto un codice a 6 cifre, l'app lo ritira entro 10 minuti.
async function handoffNew(env, req, b) {
  await verifyUser(env, req);
  const rt = str(b.rt, 2000);
  if (!rt) throw Object.assign(new Error('Dati mancanti'), { status: 400 });
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  await env.SYNC.batch([env.SYNC.prepare('DELETE FROM handoff WHERE exp < ?1').bind(Date.now()), env.SYNC.prepare('INSERT OR REPLACE INTO handoff (code,data,exp) VALUES (?1,?2,?3)').bind(code, await sealS(env, 'accesso', rt), Date.now() + 600e3)]);
  return { code };
}
async function handoffTake(env, b) {
  const code = String(b.code || '').replace(/\D/g, '');
  const row = code.length === 6 ? await env.SYNC.prepare('SELECT data, exp FROM handoff WHERE code = ?1').bind(code).first() : null;
  if (row) await env.SYNC.prepare('DELETE FROM handoff WHERE code = ?1').bind(code).run();
  if (!row || row.exp < Date.now()) throw Object.assign(new Error('Codice di accesso non valido o scaduto'), { status: 404 });
  return { rt: await openS(env, 'accesso', row.data) };
}

// Stelle dei Gnammers: voto da 1 a 5 sulle ricette del ricettario (id stabili), media e numero di voti visibili a tutti.
// Chi vota: l'account (uid), oppure il dispositivo (id casuale generato dall'app); un voto per ricetta, modificabile o ritirabile.
let starsReady = false;
async function starsTable(env) {
  if (starsReady) return;
  await env.SYNC.prepare('CREATE TABLE IF NOT EXISTS stars (id TEXT NOT NULL, who TEXT NOT NULL, s INTEGER NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (id, who))').run();
  starsReady = true;
}
async function starsWho(env, req, body) {
  if (req.headers.get('Authorization')) { try { return 'u:' + (await verifyUser(env, req)).uid; } catch {} }
  const d = String(body.dev || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (d.length < 8) throw Object.assign(new Error('Dispositivo non identificato'), { status: 400 });
  return 'd:' + d;
}
async function starsGet(env, req, body) {
  await starsTable(env);
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(x => String(x).slice(0, 80)).filter(Boolean))].slice(0, 80);
  if (!ids.length) return { stars: {} };
  const q = ids.map((_, i) => '?' + (i + 1)).join(',');
  const agg = await env.SYNC.prepare(`SELECT id, AVG(s) AS a, COUNT(*) AS n FROM stars WHERE id IN (${q}) GROUP BY id`).bind(...ids).all();
  const out = {};
  for (const r of agg.results) out[r.id] = [Math.round(r.a * 10) / 10, r.n, 0];
  let who = null; try { who = await starsWho(env, req, body); } catch {}
  if (who) {
    const my = await env.SYNC.prepare(`SELECT id, s FROM stars WHERE who = ?${ids.length + 1} AND id IN (${q})`).bind(...ids, who).all();
    for (const r of my.results) (out[r.id] ||= [0, 0, 0])[2] = r.s;
  }
  return { stars: out };
}
// Le ricette più votate dai Gnammers (vetrina del sito): media e numero di voti, al massimo 16
async function starsTop(env) {
  await starsTable(env);
  const r = await env.SYNC.prepare('SELECT id, AVG(s) AS a, COUNT(*) AS n FROM stars GROUP BY id ORDER BY a DESC, n DESC LIMIT 16').all();
  return { top: r.results.map(x => ({ id: x.id, avg: Math.round(x.a * 10) / 10, n: x.n })) };
}
async function starsVote(env, req, body) {
  await starsTable(env);
  const id = String(body.id || '').slice(0, 80), s = Math.round(+body.s) || 0;
  if (!id) throw Object.assign(new Error('Ricetta mancante'), { status: 400 });
  const who = await starsWho(env, req, body);
  if (s >= 1 && s <= 5) await env.SYNC.prepare('INSERT INTO stars (id,who,s,t) VALUES (?1,?2,?3,?4) ON CONFLICT(id,who) DO UPDATE SET s=excluded.s, t=excluded.t').bind(id, who, s, Date.now()).run();
  else await env.SYNC.prepare('DELETE FROM stars WHERE id = ?1 AND who = ?2').bind(id, who).run();
  const r = await env.SYNC.prepare('SELECT AVG(s) AS a, COUNT(*) AS n FROM stars WHERE id = ?1').bind(id).first();
  return { id, avg: r?.n ? Math.round(r.a * 10) / 10 : 0, n: r?.n || 0, my: s >= 1 && s <= 5 ? s : 0 };
}

// Gnammers: profilo pubblico (nome e pomodoro, con il livello) e commenti sotto le ricette del ricettario (stesso id delle stelle).
// I commenti sono pubblici e in chiaro, così si possono moderare. Si scrive solo con l'account (email confermata se è un account
// con password) e dopo essersi presentati; chi chiude l'account sparisce anche dai commenti (vedi account()).
let socialReady = false;
async function socialTables(env) {
  if (socialReady) return;
  await env.SYNC.batch([
    env.SYNC.prepare('CREATE TABLE IF NOT EXISTS profiles (uid TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0, t INTEGER NOT NULL)'),
    env.SYNC.prepare('CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, rid TEXT NOT NULL, uid TEXT NOT NULL, text TEXT NOT NULL, t INTEGER NOT NULL, del INTEGER NOT NULL DEFAULT 0)'),
    env.SYNC.prepare('CREATE INDEX IF NOT EXISTS comments_rid ON comments (rid, t)'),
    env.SYNC.prepare('CREATE TABLE IF NOT EXISTS reports (cid TEXT NOT NULL, uid TEXT NOT NULL, why TEXT, t INTEGER NOT NULL, PRIMARY KEY (cid, uid))'),
  ]);
  socialReady = true;
}
const bad = m => Object.assign(new Error(m), { status: 400 });
// Parole che qui non si usano: il commento (o il nome) viene rifiutato prima di essere salvato
const BAD_WORDS = /\b(vaffanculo|stronz\w*|coglion\w*|merd\w*|cazz\w*|puttan\w*|troi[ae]|froci\w*|negr[oi]|minchia|bastard\w*|porca madonna|porco dio|dio cane|idiot[aie]|deficient[ei]|cretin[aio]|imbecill[ei]|ricchion\w*)\b/i;
const cleanText = (v, n) => str(v, n).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
async function profileSet(env, req, b) {
  const u = await verifyUser(env, req); await socialTables(env);
  const name = cleanText(b.name, 30).replace(/[<>]/g, ''), avatar = /^tom:[fm]$/.test(String(b.avatar || '')) ? String(b.avatar) : '', level = Math.min(4, Math.max(0, Math.round(+b.level) || 0));
  if (name.length < 2 || !avatar) throw bad('Servono nome e immagine');
  if (BAD_WORDS.test(name)) throw bad('Questo nome non va bene');
  await env.SYNC.prepare('INSERT INTO profiles (uid,name,avatar,level,t) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(uid) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, level=excluded.level, t=excluded.t').bind(u.uid, name, avatar, level, Date.now()).run();
  return { ok: true, name, avatar, level };
}
const fmtComment = (r, me) => ({ id: r.id, name: r.name || 'Gnammer', avatar: r.avatar || '', level: r.level || 0, text: r.text, t: r.t, mine: !!me && r.uid === me });
async function commentsGet(env, req, b) {
  await socialTables(env);
  const rid = str(b.id, 80);
  if (!rid) throw bad('Ricetta mancante');
  let me = ''; if (req.headers.get('Authorization')) { try { me = (await verifyUser(env, req)).uid; } catch {} }
  const rows = await env.SYNC.prepare('SELECT c.id, c.uid, c.text, c.t, p.name, p.avatar, p.level FROM comments c LEFT JOIN profiles p ON p.uid = c.uid WHERE c.rid = ?1 AND c.del = 0 ORDER BY c.t DESC LIMIT 60').bind(rid).all();
  return { comments: rows.results.map(r => fmtComment(r, me)).reverse() };
}
async function commentAdd(env, req, b) {
  const u = await verifyUser(env, req); await socialTables(env);
  if (u.provider === 'password' && !u.verified) throw Object.assign(new Error('Conferma prima la tua email con il link che ti abbiamo mandato'), { status: 403 });
  const rid = str(b.id, 80), text = cleanText(b.text, 500);
  if (!rid) throw bad('Ricetta mancante');
  if (text.length < 2) throw bad('Scrivi qualcosa');
  if (BAD_WORDS.test(text)) throw bad('Il commento contiene parole che qui non si usano');
  if (/https?:\/\/|www\.|\.(it|com|net|org)\b/i.test(text)) throw bad('Nei commenti niente link');
  const p = await env.SYNC.prepare('SELECT name, avatar, level FROM profiles WHERE uid = ?1').bind(u.uid).first();
  if (!p) throw Object.assign(new Error('Presentati prima ai Gnammers: nome e immagine'), { status: 403 });
  const last = await env.SYNC.prepare('SELECT MAX(t) AS t, COUNT(*) AS n FROM comments WHERE uid = ?1 AND t > ?2').bind(u.uid, Date.now() - 3600e3).first();
  if (last?.t && Date.now() - last.t < 15e3) throw Object.assign(new Error('Aspetta qualche secondo tra un commento e l\'altro'), { status: 429 });
  if ((last?.n || 0) >= 30) throw Object.assign(new Error('Hai scritto tanti commenti in poco tempo: riprova tra un po\''), { status: 429 });
  const row = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 20), rid, uid: u.uid, text, t: Date.now(), ...p };
  await env.SYNC.prepare('INSERT INTO comments (id,rid,uid,text,t) VALUES (?1,?2,?3,?4,?5)').bind(row.id, rid, u.uid, text, row.t).run();
  return { comment: fmtComment(row, u.uid) };
}
async function commentDel(env, req, b) {
  await socialTables(env);
  const cid = str(b.id, 40); if (!cid) throw bad('Commento mancante');
  if (env.ADMIN_TOKEN && req.headers.get('X-Admin') === env.ADMIN_TOKEN) { await env.SYNC.prepare('UPDATE comments SET del = 2 WHERE id = ?1').bind(cid).run(); return { ok: true }; } // moderazione
  const u = await verifyUser(env, req);
  const r = await env.SYNC.prepare('UPDATE comments SET del = 1 WHERE id = ?1 AND uid = ?2').bind(cid, u.uid).run();
  if (!r.meta.changes) throw Object.assign(new Error('Puoi cancellare solo i tuoi commenti'), { status: 403 });
  return { ok: true };
}
async function commentReport(env, req, b) {
  const u = await verifyUser(env, req); await socialTables(env);
  const cid = str(b.id, 40), why = cleanText(b.why, 200); if (!cid) throw bad('Commento mancante');
  await env.SYNC.prepare('INSERT OR IGNORE INTO reports (cid,uid,why,t) VALUES (?1,?2,?3,?4)').bind(cid, u.uid, why, Date.now()).run();
  const n = (await env.SYNC.prepare('SELECT COUNT(*) AS n FROM reports WHERE cid = ?1').bind(cid).first())?.n || 0;
  if (n >= 3) await env.SYNC.prepare('UPDATE comments SET del = 3 WHERE id = ?1 AND del = 0').bind(cid).run(); // tre segnalazioni: nascosto in attesa di controllo
  return { ok: true, hidden: n >= 3 };
}
const SOCIAL = { '/profile': profileSet, '/comments': commentsGet, '/comments/add': commentAdd, '/comments/del': commentDel, '/comments/report': commentReport };

export default {
  // Aggiornamento automatico dei prezzi: un lotto di province ogni giorno
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshBatch(env).then(r => console.log('prezzi', r.period, 'aggiornate', r.updated.length, 'restano', r.remaining), e => console.log('prezzi non aggiornati:', e.message)));
    if (env.SYNC) ctx.waitUntil(env.SYNC.prepare('DELETE FROM cache WHERE exp < ?1').bind(Date.now()).run().catch(e => console.log('pulizia cache', e.message)));
  },
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/')
      return new Response('Server AI dell\'Aggregatore Ricette: attivo. Si usa dall\'app, non dal browser.\nApp: https://gnamina.it/\n',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    // Copertina di un post social: i CDN di Instagram/Facebook/TikTok non permettono di mostrare le immagini su altri siti
    // e i loro indirizzi scadono. Solo quei server di immagini, solo immagini, massimo 3 MB.
    if (req.method === 'GET' && path === '/thumb') {
      let t;
      try { t = new URL(new URL(req.url).searchParams.get('u') || ''); } catch { return reply(origin, { error: 'Link non valido' }, 400); }
      if (t.protocol !== 'https:' || !/(^|\.)(cdninstagram\.com|fbcdn\.net|tiktokcdn(-[a-z]+)?\.com|tiktokcdn-eu\.com|ibytedtos\.com)$/.test(t.hostname)) return reply(origin, { error: 'Immagine non consentita' }, 403);
      const ip = req.headers.get('CF-Connecting-IP') || 'local';
      if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return reply(origin, { error: 'Troppe richieste' }, 429);
      const r = await fetch(t, { headers: { 'User-Agent': PREVIEW_UA, Accept: 'image/*' } }).catch(() => null);
      const type = r?.headers.get('content-type') || '';
      if (!r?.ok || !type.startsWith('image/') || +(r.headers.get('content-length') || 0) > 3e6) return reply(origin, { error: 'Immagine non disponibile' }, 502);
      return new Response(r.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', ...cors(origin) } });
    }
    if (req.method === 'GET' && path === '/price-table') {
      const u = new URL(req.url);
      const b = { province: u.searchParams.get('province') || '', lat: u.searchParams.has('lat') ? +u.searchParams.get('lat') : undefined, lon: u.searchParams.has('lon') ? +u.searchParams.get('lon') : undefined };
      return reply(origin, await priceTable(env, b, req));
    }
    if (req.method === 'GET' && path === '/prices') {
      const d = await prices(env), u = new URL(req.url);
      const cf = req.cf || {};
      const auto = nearestProvince(+cf.latitude, +cf.longitude);
      const prov = u.searchParams.get('province');
      return reply(origin, { period: d.period || null, updated: d.updated || null, provinces: Object.keys(PROVINCES), available: Object.keys(d.provinces), auto,
        items: prov && d.provinces[prov] ? d.provinces[prov].items : undefined });
    }
    // Avvio manuale di un lotto (protetto da segreto): POST /refresh-prices con header X-Admin
    if (req.method === 'POST' && path === '/refresh-prices') {
      if (!env.ADMIN_TOKEN || req.headers.get('X-Admin') !== env.ADMIN_TOKEN) return reply(origin, { error: 'Non autorizzato' }, 403);
      try { return reply(origin, await refreshBatch(env)); } catch (e) { return reply(origin, { error: e.message }, 503); }
    }
    // Foto AI per le ricette senza immagine (solo GitHub Actions, header X-Admin)
    if (req.method === 'POST' && path === '/genimg') {
      if (!env.ADMIN_TOKEN || req.headers.get('X-Admin') !== env.ADMIN_TOKEN) return reply(origin, { error: 'Non autorizzato' }, 403);
      try { return reply(origin, await genImage(env, await req.json())); } catch (e) {
        const limit = e.status === 429 || /neuron|quota|limit|4006/i.test(e.message);
        return reply(origin, { error: limit ? 'Limite giornaliero raggiunto' : e.message }, limit ? 429 : e.status === 400 ? 400 : 502);
      }
    }
    if (req.method === 'POST' && path === '/brandimg') {
      if (!env.ADMIN_TOKEN || req.headers.get('X-Admin') !== env.ADMIN_TOKEN) return reply(origin, { error: 'Non autorizzato' }, 403);
      try { return reply(origin, await brandImage(env, await req.json())); } catch (e) { return reply(origin, { error: e.message }, e.status === 400 ? 400 : e.status === 429 ? 429 : 502); }
    }
    if (req.method === 'POST' && path === '/checkimg') {
      if (!env.ADMIN_TOKEN || req.headers.get('X-Admin') !== env.ADMIN_TOKEN) return reply(origin, { error: 'Non autorizzato' }, 403);
      try { return reply(origin, await checkImage(env, await req.json())); } catch (e) {
        const limit = e.status === 429 || /neuron|quota|limit|4006/i.test(e.message);
        return reply(origin, { error: limit ? 'Limite giornaliero raggiunto' : e.message }, limit ? 429 : e.status === 400 ? 400 : 502);
      }
    }
    if (req.method !== 'POST' || !['/analyze', '/photo', '/ocr', '/dictate', '/nutrition', '/preview', '/translate-recipe', '/sync', '/account', '/handoff', '/handoff/take', '/stars', '/stars/vote', '/stars/top', ...Object.keys(SOCIAL)].includes(path)) return reply(origin, { error: 'Not found' }, 404);
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    // Le letture leggere (stelle e commenti di una scheda) non consumano il limite per IP: chi sfoglia il ricettario le fa a ogni ricetta
    if (env.LIMITER && path !== '/stars' && path !== '/stars/top' && path !== '/comments' && !(await env.LIMITER.limit({ key: ip })).success) return reply(origin, { error: 'Troppe richieste' }, 429);
    // Stelle dei Gnammers (lettura a lotti e voto)
    if (req.method === 'POST' && (path === '/stars' || path === '/stars/vote' || path === '/stars/top')) {
      if (!env.SYNC) return reply(origin, { error: 'Non disponibile' }, 503);
      let body; try { body = await req.json(); } catch { return reply(origin, { error: 'Richiesta non valida' }, 400); }
      try {
        if (path === '/stars/vote') { const ip = req.headers.get('CF-Connecting-IP') || 'local'; if (env.LIMITER && !(await env.LIMITER.limit({ key: 'stars:' + ip })).success) return reply(origin, { error: 'Troppe richieste' }, 429); }
        return reply(origin, path === '/stars/top' ? await starsTop(env) : path === '/stars' ? await starsGet(env, req, body) : await starsVote(env, req, body));
      } catch (e) { return reply(origin, { error: e.message }, e.status || 500); }
    }
    // Gnammers: profilo pubblico e commenti
    if (SOCIAL[path]) {
      if (!env.SYNC) return reply(origin, { error: 'Non disponibile' }, 503);
      let body; try { body = await req.json(); } catch { return reply(origin, { error: 'Richiesta non valida' }, 400); }
      try { return reply(origin, await SOCIAL[path](env, req, body)); } catch (e) { if (!e.status) console.log('errore', path, e.message); return reply(origin, { error: e.status ? e.message : 'Operazione non riuscita' }, e.status || 502); }
    }
    if (path === '/sync' || path === '/account' || path === '/handoff' || path === '/handoff/take') {
      try {
        const body = await req.json();
        return reply(origin, path === '/sync' ? await sync(env, body) : path === '/account' ? await account(env, req, body) : path === '/handoff' ? await handoffNew(env, req, body) : await handoffTake(env, body));
      } catch (e) { console.log('errore', path, e.message); return reply(origin, { error: e.status ? e.message : 'Operazione non riuscita' }, e.status || 502); }
    }
    // Prova di un singolo fornitore AI (solo amministratore): header X-Provider = workers | gemini | groq | cf (quest'ultimo solo per Whisper)
    const force = env.ADMIN_TOKEN && req.headers.get('X-Admin') === env.ADMIN_TOKEN ? str(req.headers.get('X-Provider') || '', 10).toLowerCase() : '';
    if (force) env = { ...env, FORCE_AI: force };
    try {
      const body = await req.json();
      return reply(origin, path === '/photo' ? await photo(env, body) : path === '/ocr' ? await ocr(env, body) : path === '/dictate' ? await dictate(env, body) : path === '/nutrition' ? await nutrition(env, body, req) : path === '/preview' ? await previewCached(env, body) : path === '/translate-recipe' ? await translateRecipe(env, body) : await analyzeCached(env, body));
    } catch (e) {
      // Quota giornaliera gratuita esaurita o errore del modello
      const limit = e.status === 429 || /neuron|quota|limit|4006/i.test(e.message);
      const status = limit ? 429 : e.status === 400 ? 400 : 502;
      console.log('errore AI', e.message);
      return reply(origin, { error: limit ? 'Limite giornaliero raggiunto, riprova domani' : e.status === 400 || path === '/preview' ? e.message : 'Servizio AI non disponibile' }, status);
    }
  },
};
