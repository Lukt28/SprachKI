// Service Worker: hält die App offline startklar.
// Anfragen an Google werden bewusst nie zwischengespeichert.

const VERSION = 'rena-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/store.js',
  './js/persona.js',
  './js/providers/index.js',
  './js/providers/shared.js',
  './js/providers/gemini.js',
  './js/providers/openaiCompatible.js',
  './js/audio.js',
  './js/vad-worklet.js',
  './js/tts.js',
  './js/views/conversation.js',
  './js/views/dictionary.js',
  './js/views/quiz.js',
  './js/views/settings.js',
  './js/views/vocabsheet.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Einzeln laden: eine fehlende Datei darf die Installation nicht kippen.
    await Promise.all(SHELL.map(url => cache.add(url).catch(err => console.warn('nicht gecacht:', url, err))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // Gemini & Co. immer direkt

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);

    // Netz zuerst, damit Änderungen sofort ankommen; Cache als Rückfall.
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
