// Server dell'Aggregatore Ricette: tiene la chiave Gemini e fa le richieste AI per conto dell'app.
// I prompt stanno qui, così l'endpoint non può essere usato come proxy generico.
const MODEL_TEXT = 'gemini-2.5-flash-lite'; // analisi delle didascalie (economico, senza ricerca)
const MODEL_SEARCH = 'gemini-2.5-flash';    // foto + ricerca Google (1.500 ricerche/giorno incluse)
const ORIGINS = ['https://ismirill.github.io', 'https://localhost', 'http://localhost', 'http://localhost:8080', 'capacitor://localhost'];
const DIETS = ['Vegano', 'Vegetariano', 'Senza glutine', 'Senza lattosio', 'Senza uova', 'Senza frutta secca', 'Ipocalorico'];

const cors = origin => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});
const reply = (origin, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

async function gemini(env, model, parts, { search = false, json = false } = {}) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      ...(search ? { tools: [{ google_search: {} }] } : {}),
      ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error?.message || res.statusText), { status: res.status });
  const c = d.candidates?.[0];
  if (!c?.content) throw new Error('Nessuna risposta');
  return {
    text: c.content.parts.map(x => x.text || '').join('\n'),
    chunks: (c.groundingMetadata?.groundingChunks || []).map(x => x.web).filter(Boolean).map(w => ({ title: w.title, uri: w.uri })),
  };
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
    return { inline_data: { mime_type: type.split(';')[0], data: btoa(bin) } };
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
- ingredients: un ingrediente per voce, con quantità se indicate. Se la didascalia non li elenca ma il piatto è chiaramente riconoscibile, metti gli ingredienti tipici e aggiungi alla fine la voce "(ingredienti dedotti, verifica nel video)". Se non riconosci il piatto, lascia vuoto.
- steps: passaggi del procedimento, solo se descritti o deducibili con certezza; altrimenti vuoto.
- diets: solo tra ${DIETS.map(x => `"${x}"`).join(', ')} e solo se sei ragionevolmente sicuro dagli ingredienti; nel dubbio non metterla.
- country e region: zona d'origine del piatto (region solo per regioni italiane), stringa vuota se non chiaro.
- time: minuti totali, 0 se non noto.
- is_recipe: false se il post non riguarda una ricetta.
Rispondi solo con JSON: {"is_recipe":true,"title":"","cat":"","diets":[],"country":"","region":"","time":0,"ingredients":[],"steps":[]}`;
  const img = b.image ? await imagePart(str(b.image, 2000)) : null;
  const { text } = await gemini(env, MODEL_TEXT, img ? [img, { text: prompt }] : [{ text: prompt }], { json: true });
  return { result: lastJson(text) };
}

async function photo(env, b) {
  const data = str(b.image, 6e6);
  if (!data) throw Object.assign(new Error('Foto mancante'), { status: 400 });
  const { text, chunks } = await gemini(env, MODEL_SEARCH, [
    { inline_data: { mime_type: 'image/jpeg', data } },
    { text: `Riconosci il piatto in questa foto. Poi cerca con Google da 5 a 8 ricette di questo piatto, preferendo siti di cucina italiani affidabili (es. GialloZafferano, Cookist, Fatto in casa da Benedetta, Cucchiaio d'Argento, Misya) e, se utili, video YouTube. Usa solo pagine trovate nella ricerca.
Rispondi alla fine SOLO con un oggetto JSON, senza altro testo:
{"dish":"nome del piatto in italiano","description":"una frase su cos'è","confidence":"alta|media|bassa","alternatives":["altri piatti possibili"],"keywords":["parole per cercarlo"],"recipes":[{"title":"...","url":"https://...","site":"...","note":"cosa la distingue, max 15 parole"}]}
Se nella foto non c'è un piatto, restituisci dish vuoto e recipes vuoto.` },
  ], { search: true });
  return { result: lastJson(text), chunks };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST' || !['/analyze', '/photo'].includes(path)) return reply(origin, { error: 'Not found' }, 404);
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return reply(origin, { error: 'Troppe richieste' }, 429);
    try {
      const body = await req.json();
      return reply(origin, path === '/photo' ? await photo(env, body) : await analyze(env, body));
    } catch (e) {
      // Errori di Google: non esporre dettagli della chiave all'app
      const status = e.status === 429 ? 429 : e.status === 400 && /foto/i.test(e.message) ? 400 : 502;
      return reply(origin, { error: status === 429 ? 'Limite raggiunto' : 'Servizio AI non disponibile' }, status);
    }
  },
};
