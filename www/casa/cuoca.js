/* Benvenuto della ragazza di Gnamina: al tocco del logo si apre un foglio di quaderno con il video che saluta (con la voce).
   Usato da benvenuto.html e dal sito (index.html in modalità sito). Se il video non c'è o non parte, resta l'immagine che saluta. */
(function () {
  var BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');
  var css = '\
#gnBenv{border:0;padding:0;background:transparent;width:min(420px,92vw,max(290px,calc((100vh - 330px)*.75 + 40px)));max-width:none;overflow:visible}\
#gnBenv::backdrop{background:rgba(43,36,32,.55);backdrop-filter:blur(3px)}\
#gnBenv .gbCard{position:relative;background:#fbf5e9 url(' + BASE + 'carta.jpg) center/cover;border-radius:6px;padding:18px 20px 20px;box-shadow:0 30px 60px rgba(0,0,0,.35);transform:rotate(-1.2deg);font-family:Nunito,system-ui,sans-serif;color:#2b2420;text-align:center;animation:gbIn .45s cubic-bezier(.2,1.4,.4,1)}\
#gnBenv .gbTape{position:absolute;top:-22px;left:50%;width:150px;transform:translateX(-50%) rotate(3deg);pointer-events:none;filter:drop-shadow(0 3px 3px rgba(0,0,0,.18))}\
#gnBenv .gbMedia{position:relative;width:100%;aspect-ratio:3/4;margin:6px auto 14px;background:#fff;padding:10px 10px 0;box-sizing:border-box;border-radius:3px;box-shadow:0 10px 24px rgba(43,36,32,.22);transform:rotate(1.4deg)}#gnBenv .gbMedia>div{position:relative;width:100%;height:100%;overflow:hidden;border-radius:2px;background:#e9dccb}\
#gnBenv video,#gnBenv .gbStill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\
#gnBenv.vid .gbStill{display:none}\
#gnBenv h2{font-weight:900;font-size:1.7rem;margin:0;color:#c8301f;letter-spacing:-.01em}\
#gnBenv p{margin:6px auto 14px;max-width:30ch;font-size:1.02rem;line-height:1.4}\
#gnBenv .gbBtns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}\
#gnBenv .gbBtns a,#gnBenv .gbBtns button{font:800 1rem Nunito,system-ui,sans-serif;border-radius:999px;padding:11px 18px;text-decoration:none;cursor:pointer;border:2px solid #c8301f}\
#gnBenv .gbGo{background:#c8301f;color:#fff}#gnBenv .gbAlt{background:#fff;color:#c8301f}\
#gnBenv .gbX{position:absolute;top:8px;right:10px;width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.85);font-size:1.4rem;line-height:1;cursor:pointer;color:#2b2420;z-index:2}\
#gnBenv .gbAgain{position:absolute;bottom:12px;right:12px;z-index:2;border:0;border-radius:999px;background:rgba(255,255,255,.9);padding:6px 12px;font:700 .85rem Nunito,system-ui,sans-serif;cursor:pointer;color:#2b2420;box-shadow:0 2px 6px rgba(0,0,0,.15)}\
@keyframes gbIn{from{opacity:0;transform:rotate(-1.2deg) translateY(30px) scale(.9)}}\
@media (max-height:760px){#gnBenv .gbCard{padding:14px 16px 16px}#gnBenv h2{font-size:1.35rem}#gnBenv p{font-size:.92rem;margin:4px auto 10px}#gnBenv .gbMedia{margin:4px auto 10px}#gnBenv .gbBtns a,#gnBenv .gbBtns button{padding:9px 14px;font-size:.92rem}}\
@media (max-height:560px){#gnBenv{max-height:100vh;overflow-y:auto;padding:28px 10px 12px;box-sizing:border-box;width:min(440px,96vw)}#gnBenv .gbCard{box-shadow:0 8px 20px rgba(0,0,0,.3)}#gnBenv .gbMedia{width:min(100%,62vh)}}\
@media (prefers-reduced-motion:reduce){#gnBenv .gbCard{animation:none}}';

  var dlg, video;
  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var onLanding = /benvenuto\.html$|\/$/.test(location.pathname) && !document.getElementById('tabs');
    dlg = document.createElement('dialog'); dlg.id = 'gnBenv'; dlg.setAttribute('aria-label', 'Benvenuto su Gnamina');
    dlg.innerHTML = '<div class="gbCard"><img class="gbTape" src="' + BASE + 'nastro-pois.webp" alt="">' +
      '<button class="gbX" aria-label="Chiudi">×</button>' +
      '<div class="gbMedia"><div><img class="gbStill" src="' + BASE + 'cuoca.webp" alt="La ragazza di Gnamina che saluta dalla cucina">' +
      '<video playsinline preload="none" poster="' + BASE + 'cuoca.webp"><source src="' + BASE + 'cuoca.mp4" type="video/mp4"></video>' +
      '<button class="gbAgain" hidden>↻ Ancora</button></div></div>' +
      '<h2>Benvenuti su Gnamina!</h2><p>Le ricette di casa, le sfide della settimana e il tuo menu. Tutto gratis.</p>' +
      '<div class="gbBtns"><a class="gbGo" href="./?v=book">Sfoglia il ricettario</a>' +
      (onLanding ? '<button class="gbAlt gbClose">Resta qui</button>' : '<a class="gbAlt" href="benvenuto.html">Cos\'è Gnamina</a>') + '</div></div>';
    document.body.appendChild(dlg);
    video = dlg.querySelector('video');
    var again = dlg.querySelector('.gbAgain');
    video.addEventListener('playing', function () { dlg.classList.add('vid'); again.hidden = true; });
    video.addEventListener('ended', function () { again.hidden = false; });
    video.addEventListener('error', function () { dlg.classList.remove('vid'); }, true);
    again.onclick = function () { video.currentTime = 0; video.play().catch(function () {}); };
    dlg.querySelector('.gbX').onclick = close;
    var c = dlg.querySelector('.gbClose'); if (c) c.onclick = close;
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('close', function () { video.pause(); });
  }
  function close() { video.pause(); dlg.close(); }
  function open(e) {
    if (e) e.preventDefault();
    if (!dlg) build();
    dlg.classList.remove('vid');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    try { video.currentTime = 0; } catch (x) {}
    var p = video.play(); // il tocco sul logo consente l'audio
    if (p && p.catch) p.catch(function () { video.muted = true; video.play().catch(function () {}); });
  }
  window.gnBenvenuto = open;
})();
