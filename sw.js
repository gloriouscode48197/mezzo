/**
 * Mezzo - Service Worker
 * Enables offline support and PWA installation
 */

const CACHE_NAME = 'mezzo-v15';
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

// Fetch - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
