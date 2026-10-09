// Campus Café service worker: makes the app installable and lets it open instantly / offline.
// Only this site's own files are cached. Everything else (the Supabase API, auth, functions)
// goes straight to the network, so data is never served stale from here.
// The build step (vite.config.js) fills in the list of this build's files and a version for the cache,
// so a new deploy gets a fresh cache and the old one is deleted. In dev both stay as they are here.
const BUILD = '__BUILD__';
const BUILD_FILES = /*__PRECACHE__*/[];
const CACHE = 'campus-cafe-' + BUILD;
const MAX_ENTRIES = 120;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // the whole app shell is stored on install, so it opens offline after a single visit
      .then((cache) => cache.addAll(['./', 'manifest.webmanifest', 'icons/icon-192.png', ...BUILD_FILES]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Keep the cache from growing forever as new hashed builds replace old ones.
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
}

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      trim(cache);
    }
    return response;
  } catch {
    return (await cache.match(request)) || (fallbackKey && (await cache.match(fallbackKey))) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // pages: always try the network first so a new deploy shows up, fall back to the cached shell offline
    event.respondWith(networkFirst(request, './'));
  } else if (/\/(assets|fonts|icons)\//.test(url.pathname)) {
    // hashed bundles, fonts and icons never change under the same URL
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
