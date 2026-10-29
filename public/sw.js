const CACHE = 'packbox-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/pwa-icon.svg', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

// Clone synchronously, before returning the response to the browser. Once the
// fetch event's response has been handed off, its body may already be consumed.
function cacheResponse(request, response) {
  if (!response.ok) return Promise.resolve();
  const copy = response.clone();
  return caches.open(CACHE).then((cache) => cache.put(request, copy));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          // cacheResponse clones immediately; waitUntil keeps the write alive
          // without delaying delivery of the page to the user.
          event.waitUntil(cacheResponse('/index.html', response).catch(() => {}));
        }
        return response;
      }).catch(() => caches.match('/index.html')),
    );
    return;
  }

  if (new URL(event.request.url).pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) event.waitUntil(cacheResponse(event.request, response).catch(() => {}));
          return response;
        });
      }),
    );
  }
});
