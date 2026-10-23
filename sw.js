/**
 * Mezzo - Service Worker
 * Enables offline support and PWA installation
 */

const CACHE_NAME = 'mezzo-v32';
const ASSETS = [
  '/',
  '/index.html',
  '/landing.css',
  '/landing.js',
  '/try-it.html',
  '/monitoring.html',
  '/calibration.css',
  '/privacy.html',
  '/privacy.css',
  '/design-tokens/mezzo-tokens.css',
  '/src/audio.js',
  '/src/engine.js',
  '/src/analytics.js',
  '/src/range-ring.js',
  '/src/level-meter.js',
  '/src/zone-announcer.js',
  '/src/page-transition.js',
  '/src/mezzo-session.js',
  '/src/session-state.js',
  '/src/profiles.js',
  '/src/home-dock.js',
  '/manifest.webmanifest'
];

// Install - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - serve from cache, fall back to network. The playground
// (/playground/) is never cached or served from cache: it's a separate,
// frozen page whose files share names with the app's (e.g. src/engine.js),
// so it always comes straight from the network.
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname.startsWith('/playground')) return;
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
