// Service worker mínimo: la interfaz (HTML, JS, CSS, íconos) queda en caché para abrir al instante y sin red.
// Las llamadas al backend y MQTT NO se cachean: los datos siempre son en vivo.
const CACHE = 'simon-shell-v1'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  const isAsset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')
  if (req.mode === 'navigate') {
    // red primero para ver siempre la versión nueva; sin red, la copia guardada
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('/', cp)); return r }).catch(() => caches.match('/')))
  } else if (isAsset) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r })),
    )
  }
})
