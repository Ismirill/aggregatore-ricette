import ING from './ingredienti.json';
// Server dell'Aggregatore Ricette: fa le richieste AI per conto dell'app con Cloudflare Workers AI
// (quota gratuita giornaliera, nessuna chiave per l'utente). I prompt stanno qui, così l'endpoint non è un proxy generico.
const MODEL = '@cf/google/gemma-4-26b-a4b-it'; // visione + testo, licenza Gemma (utilizzabile in UE)
const ORIGINS = ['https://ismirill.github.io', 'https://localhost', 'http://localhost', 'http://localhost:8080', 'http://127.0.0.1:8080', 'capacitor://localhost'];
const DIETS = ['Vegano', 'Vegetariano', 'Senza glutine', 'Senza lattosio', 'Senza uova', 'Senza frutta secca', 'Ipocalorico'];

const cors = origin => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});
const reply = (origin, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

async function ai(env, prompt, image) {
  const content = [...(image ? [{ type: 'image_url', image_url: { url: image } }] : []), { type: 'text', text: prompt }];
  // Senza ragionamento: risponde subito in JSON e consuma meno quota gratuita
  const r = await env.AI.run(MODEL, {
    messages: [{ role: 'user', content }], max_tokens: 2000,
    chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' },
  });
  return typeof r.response === 'string' ? r.response : r.choices?.[0]?.message?.content || JSON.stringify(r.response ?? '');
}
// Chiede il JSON al modello; se la risposta non è valida riprova una volta
async function aiJson(env, prompt, image) {
  for (let i = 0; i < 2; i++) {
    try { const j = lastJson(await ai(env, prompt, image)); if (j) return j; } catch (e) { if (i || e.status) throw e; }
  }
  return null;
}
const lastJson = t => { const m = String(t).replace(/```json|```/g, '').match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; };
const str = (v, n) => String(v ?? '').slice(0, n);

// Scarica la copertina del post (lato server non ci sono blocchi CORS)
async function imagePart(url) {
  try {
    if (!/^https:\/\//.test(url)) return null;
    const r = await fetch(url);
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 4e6) return null;
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
  } catch { return null; }
}

async function analyze(env, b) {
  const cats = (Array.isArray(b.cats) ? b.cats : []).slice(0, 30).map(c => str(c, 40));
  const prompt = `Questo è un post con una ricetta, salvato in un ricettario personale in italiano.
Link: ${str(b.url, 500)}
Fonte: ${str(b.source, 40)}${b.author ? ' · autore: ' + str(b.author, 80) : ''}
Titolo/didascalia:
"""${str(b.caption || b.title, 6000)}"""

Estrai i dati in italiano:
- title: nome breve del piatto (senza hashtag né emoji).
- cat: uno tra ${cats.map(c => `"${c}"`).join(', ')}.
- servings: per quante persone sono le dosi. Usa il numero indicato nel post ("per 4", "4 porzioni"…); se non è indicato, stimalo dalle quantità (di solito 80-100 g di pasta o 150-200 g di carne a persona); se non ci sono quantità, metti 4.
- ingredients: un ingrediente per voce, nel formato "quantità unità ingrediente" (es. "320 g spaghetti", "2 uova", "1 spicchio d'aglio", "olio extravergine q.b."), con le quantità per il numero di persone in servings. Usa le quantità del post; quelle mancanti stimale con le dosi tipiche e, se ne hai stimata almeno una, aggiungi alla fine la voce "(dosi stimate, verifica nel video)". Se la didascalia non elenca gli ingredienti ma il piatto è chiaramente riconoscibile, metti gli ingredienti tipici con le dosi e aggiungi alla fine "(ingredienti e dosi dedotti, verifica nel video)". Se non riconosci il piatto, lascia vuoto.
- steps: passaggi del procedimento, solo se descritti o deducibili con certezza; altrimenti vuoto.
- diets: solo tra ${DIETS.map(x => `"${x}"`).join(', ')} e solo se sei ragionevolmente sicuro dagli ingredienti; nel dubbio non metterla.
- country e region: zona d'origine del piatto (region solo per regioni italiane), stringa vuota se non chiaro.
- time: minuti totali, 0 se non noto.
- is_recipe: false se il post non riguarda una ricetta.
Rispondi solo con JSON: {"is_recipe":true,"title":"","servings":4,"cat":"","diets":[],"country":"","region":"","time":0,"ingredients":[],"steps":[]}`;
  const img = b.image ? await imagePart(str(b.image, 2000)) : null;
  return { result: await aiJson(env, prompt, img) };
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
Se il testo è in un'altra lingua, traducilo in italiano. Se la foto non contiene una ricetta leggibile, restituisci is_recipe false.`, `data:image/jpeg;base64,${data}`);
  return { result };
}

async function photo(env, b) {
  const data = str(b.image, 6e6);
  if (!data) throw Object.assign(new Error('Foto mancante'), { status: 400 });
  const result = await aiJson(env, `Riconosci il piatto in questa foto. Rispondi SOLO con un oggetto JSON:
{"dish":"nome del piatto in italiano, come lo cercheresti su un sito di ricette","description":"una frase su cos'è","confidence":"alta|media|bassa","alternatives":["altri piatti possibili, max 3"],"keywords":["2-4 parole chiave"]}
Se nella foto non c'è un piatto o del cibo, restituisci dish vuoto.`, `data:image/jpeg;base64,${data}`);
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
const PREVIEW_UA = 'AggregatoreRicette/1.0 (+https://ismirill.github.io/aggregatore-ricette/)';
async function preview(b) {
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
  // Instagram: la pagina di incorporamento ufficiale (pensata per mostrare i post su altri siti) ha la didascalia completa
  let embedCaption = '', embedImage = '';
  const ig = u.hostname.match(/instagram\.com$/) && u.pathname.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/);
  if (ig) {
    const e = await get(`https://www.instagram.com/${ig[1] === 'reels' ? 'reel' : ig[1]}/${ig[2]}/embed/captioned/`);
    const m = e && e.html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/);
    const im = e && e.html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/);
    if (im) embedImage = im[1].replace(/&amp;/g, '&');
    if (m) embedCaption = unescape(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<a [^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, '')).replace(/View all \d+ comments\s*$/i, '').trim();
  }
  const page = await get(u);
  if (!page && !embedCaption) throw Object.assign(new Error('Il sito non permette di leggere questo post'), { status: 502 });
  const r = page?.r || { url: u.href }, html = page?.html || '';
  const meta = k => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'));
    return m ? unescape(m[1]) : '';
  };
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(x => /recipe/i.test(x)).slice(0, 3);
  // si restituisce una pagina minima che l'app legge come se l'avesse scaricata lei
  const tag = (k, v) => v ? `<meta property="${k}" content="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` : '';
  const mini = `<html><head><title>${(unescape((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')).replace(/</g, '&lt;')}</title>`
    + ['og:title', 'og:site_name', 'description'].map(k => tag(k, meta(k))).join('') + tag('og:image', meta('og:image') || embedImage)
    + tag('og:description', embedCaption.length > meta('og:description').length ? embedCaption : meta('og:description'))
    + ld.map(x => `<script type="application/ld+json">${x}</script>`).join('') + '</head></html>';
  return { html: mini, url: r.url };
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
async function genImage(env, b) {
  const title = String(b.title || '').replace(/["\n]/g, ' ').trim().slice(0, 120);
  if (!title) throw Object.assign(new Error('Titolo mancante'), { status: 400 });
  const where = b.country && b.country !== 'Italia' ? `traditional dish from ${String(b.country).slice(0, 40)}` : 'traditional Italian home cooking';
  const hint = (b.ingredients || []).slice(0, 5).map(x => String(x).replace(/^[\d\s.,/½¼¾]+(g|kg|ml|l|dl|cucchiai?o?|cucchiaini?|tazz[ae]|spicch[io]|fett[ae]|pizzic[oh]i?)?\.?\s*(di\s)?/i, '')).join(', ').slice(0, 160);
  const prompt = `Professional food photography of "${title}", ${where}, ${CAT_EN[b.cat] || 'dish'}${hint ? `, made with ${hint}` : ''}, served on a plate on a rustic wooden table, natural soft daylight, shallow depth of field, appetizing, photorealistic, no text, no people, no hands`;
  const r = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 });
  if (!r?.image) throw new Error('Immagine non generata');
  return { image: r.image, prompt };
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
    if (code) await env.SYNC.batch([env.SYNC.prepare('DELETE FROM docs WHERE k = ?1').bind(await hexSha('gnamina-id:' + code)), env.SYNC.prepare('DELETE FROM users WHERE uid = ?1').bind(u.uid)]);
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

export default {
  // Aggiornamento automatico dei prezzi: un lotto di province ogni giorno
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshBatch(env).then(r => console.log('prezzi', r.period, 'aggiornate', r.updated.length, 'restano', r.remaining), e => console.log('prezzi non aggiornati:', e.message)));
  },
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/')
      return new Response('Server AI dell\'Aggregatore Ricette: attivo. Si usa dall\'app, non dal browser.\nApp: https://ismirill.github.io/aggregatore-ricette/\n',
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
    if (req.method === 'POST' && path === '/checkimg') {
      if (!env.ADMIN_TOKEN || req.headers.get('X-Admin') !== env.ADMIN_TOKEN) return reply(origin, { error: 'Non autorizzato' }, 403);
      try { return reply(origin, await checkImage(env, await req.json())); } catch (e) {
        const limit = e.status === 429 || /neuron|quota|limit|4006/i.test(e.message);
        return reply(origin, { error: limit ? 'Limite giornaliero raggiunto' : e.message }, limit ? 429 : e.status === 400 ? 400 : 502);
      }
    }
    if (req.method !== 'POST' || !['/analyze', '/photo', '/ocr', '/nutrition', '/preview', '/translate-recipe', '/sync', '/account', '/handoff', '/handoff/take'].includes(path)) return reply(origin, { error: 'Not found' }, 404);
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return reply(origin, { error: 'Troppe richieste' }, 429);
    if (path === '/sync' || path === '/account' || path === '/handoff' || path === '/handoff/take') {
      try {
        const body = await req.json();
        return reply(origin, path === '/sync' ? await sync(env, body) : path === '/account' ? await account(env, req, body) : path === '/handoff' ? await handoffNew(env, req, body) : await handoffTake(env, body));
      } catch (e) { console.log('errore', path, e.message); return reply(origin, { error: e.status ? e.message : 'Operazione non riuscita' }, e.status || 502); }
    }
    try {
      const body = await req.json();
      return reply(origin, path === '/photo' ? await photo(env, body) : path === '/ocr' ? await ocr(env, body) : path === '/nutrition' ? await nutrition(env, body, req) : path === '/preview' ? await preview(body) : path === '/translate-recipe' ? await translateRecipe(env, body) : await analyze(env, body));
    } catch (e) {
      // Quota giornaliera gratuita esaurita o errore del modello
      const limit = e.status === 429 || /neuron|quota|limit|4006/i.test(e.message);
      const status = limit ? 429 : e.status === 400 ? 400 : 502;
      console.log('errore AI', e.message);
      return reply(origin, { error: limit ? 'Limite giornaliero raggiunto, riprova domani' : e.status === 400 || path === '/preview' ? e.message : 'Servizio AI non disponibile' }, status);
    }
  },
};
