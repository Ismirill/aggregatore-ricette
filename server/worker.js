import ING from './ingredienti.json';
// Server dell'Aggregatore Ricette: fa le richieste AI per conto dell'app con Cloudflare Workers AI
// (quota gratuita giornaliera, nessuna chiave per l'utente). I prompt stanno qui, così l'endpoint non è un proxy generico.
const MODEL = '@cf/google/gemma-4-26b-a4b-it'; // visione + testo, licenza Gemma (utilizzabile in UE)
const ORIGINS = ['https://ismirill.github.io', 'https://localhost', 'http://localhost', 'http://localhost:8080', 'capacitor://localhost'];
const DIETS = ['Vegano', 'Vegetariano', 'Senza glutine', 'Senza lattosio', 'Senza uova', 'Senza frutta secca', 'Ipocalorico'];

const cors = origin => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
const unescape = t => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim();

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
  return { zone: official?.zone || 'media nazionale', period: official?.period || null, eur, src };
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
    if (req.method !== 'POST' || !['/analyze', '/photo', '/nutrition'].includes(path)) return reply(origin, { error: 'Not found' }, 404);
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return reply(origin, { error: 'Troppe richieste' }, 429);
    try {
      const body = await req.json();
      return reply(origin, path === '/photo' ? await photo(env, body) : path === '/nutrition' ? await nutrition(env, body, req) : await analyze(env, body));
    } catch (e) {
      // Quota giornaliera gratuita esaurita o errore del modello
      const limit = e.status === 429 || /neuron|quota|limit|4006/i.test(e.message);
      const status = limit ? 429 : e.status === 400 ? 400 : 502;
      console.log('errore AI', e.message);
      return reply(origin, { error: limit ? 'Limite giornaliero raggiunto, riprova domani' : e.status === 400 ? e.message : 'Servizio AI non disponibile' }, status);
    }
  },
};
