// Server dell'Aggregatore Ricette: fa le richieste AI per conto dell'app con Cloudflare Workers AI
// (quota gratuita giornaliera, nessuna chiave per l'utente). I prompt stanno qui, così l'endpoint non è un proxy generico.
const MODEL = '@cf/google/gemma-4-26b-a4b-it'; // visione + testo, licenza Gemma (utilizzabile in UE)
const ORIGINS = ['https://ismirill.github.io', 'https://localhost', 'http://localhost', 'http://localhost:8080', 'capacitor://localhost'];
const DIETS = ['Vegano', 'Vegetariano', 'Senza glutine', 'Senza lattosio', 'Senza uova', 'Senza frutta secca', 'Ipocalorico'];

const cors = origin => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/')
      return new Response('Server AI dell\'Aggregatore Ricette: attivo. Si usa dall\'app, non dal browser.\nApp: https://ismirill.github.io/aggregatore-ricette/\n',
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (req.method !== 'POST' || !['/analyze', '/photo'].includes(path)) return reply(origin, { error: 'Not found' }, 404);
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return reply(origin, { error: 'Troppe richieste' }, 429);
    try {
      const body = await req.json();
      return reply(origin, path === '/photo' ? await photo(env, body) : await analyze(env, body));
    } catch (e) {
      // Quota giornaliera gratuita esaurita o errore del modello
      const limit = e.status === 429 || /neuron|quota|limit|4006/i.test(e.message);
      const status = limit ? 429 : e.status === 400 ? 400 : 502;
      console.log('errore AI', e.message);
      return reply(origin, { error: limit ? 'Limite giornaliero raggiunto, riprova domani' : e.status === 400 ? e.message : 'Servizio AI non disponibile' }, status);
    }
  },
};
