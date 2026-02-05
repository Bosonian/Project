const CACHE_NAME = 'pupilcheck-v2.0';
const ASSETS = [
  './',
  './index.html',
  './measure.html',
  './history.html',
  './manifest.json',
  './css/variables.css',
  './css/components.css',
  './css/measure.css',
  './css/history.css',
  './js/app.js',
  './js/i18n.js',
  './js/patient-store.js',
  './js/detection-classical.js',
  './js/detection-ml.js',
  './js/detection-cloud.js',
  './js/measurement.js',
  './js/history.js',
  './js/report.js',
  './lang/en.json',
  './lang/de.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// ML model files - cached on first use (large, don't block install)
const ML_MODEL_PATTERNS = [
  /models\//,
  /mediapipe/,
  /tensorflow/
];

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for HTML, cache-first for assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cloud API calls (never cache detection requests)
  if (url.pathname.includes('/detect') || url.pathname.includes('/health')) return;

  // HTML: network first, fall back to cache
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ML models and CDN resources: cache first with network fallback
  const isMLResource = ML_MODEL_PATTERNS.some(p => p.test(url.href));
  if (isMLResource || url.origin !== location.origin) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          });
        })
    );
    return;
  }

  // Other same-origin assets: cache first, fall back to network
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
  );
});
