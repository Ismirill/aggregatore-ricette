const C='ricette-v20',ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./ricettario.json','./stagioni.json','./immagini.json'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
// Sempre dalla rete (senza cache HTTP per le pagine dell'app), con la copia salvata come riserva offline
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const own=new URL(e.request.url).origin===location.origin;
  e.respondWith(fetch(own?new Request(e.request.url,{cache:'no-cache'}):e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));
});
