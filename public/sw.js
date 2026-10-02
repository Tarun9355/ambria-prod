// Ambria service worker — exists so the app is installable as a PWA (Android/Chrome want one).
// It deliberately caches NOTHING: every request still goes to the network exactly as before, so a
// new deploy is never hidden behind a stale cached build (the app's own "new version" banner,
// useVersionCheck, keeps working untouched). The only thing it adds is a plain offline page when
// a navigation fails, instead of the browser's dinosaur.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ambria — offline</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F1F5F9;font-family:system-ui,sans-serif;color:#1A1A2E;text-align:center;padding:24px}
button{margin-top:16px;padding:10px 22px;border:0;border-radius:12px;background:#4F46E5;color:#fff;font-weight:600;font-size:15px}</style></head>
<body><div><div style="font-size:40px">📶</div><h2 style="margin:12px 0 4px">You're offline</h2><p style="margin:0;color:#64748B">Ambria needs an internet connection.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // everything else: untouched, straight to network
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
  );
});
