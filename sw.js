/* ==========================================================================
   Saad PS2 — Service Worker
   - صفحات التنقل: Network-first مع رجوع إلى الكاش عند انقطاع الشبكة.
   - JS/CSS/المانيفست: Network-first أيضاً حتى لا يتزاوج HTML جديد مع أصول قديمة.
   - بقية الأصول (أيقونات، كتالوج JSON): Cache-first مع تحديث في الخلفية.
   ========================================================================== */
var CACHE_NAME = 'saad-ps2-v10';
var APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './game-database.js',
  './saf-storage-bridge.bundle.js',
  './database/manifest.json',
  './database/catalog.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return Promise.all(APP_SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () { /* ملف اختياري */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function fromCache(request, fallback) {
  return caches.match(request, { ignoreSearch: true }).then(function (cached) {
    if (cached) return cached;
    return fallback ? caches.match(fallback) : undefined;
  });
}

function cachePut(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return response;
  var copy = response.clone();
  caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
  return response;
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // الأغلفة الخارجية تبقى على شبكة المتصفح

  var destination = request.destination || '';
  var networkFirst = request.mode === 'navigate' || destination === 'script' ||
    destination === 'style' || destination === 'manifest' || url.pathname.endsWith('.json');

  if (networkFirst) {
    event.respondWith(
      fetch(request).then(function (response) {
        cachePut(request, response);
        return response;
      }).catch(function () {
        return fromCache(request, request.mode === 'navigate' ? './index.html' : null)
          .then(function (cached) { return cached || Response.error(); });
      })
    );
    return;
  }

  event.respondWith(
    fromCache(request, null).then(function (cached) {
      if (cached) {
        // تحديث صامت في الخلفية
        fetch(request).then(function (response) { cachePut(request, response); }).catch(function () {});
        return cached;
      }
      return fetch(request).then(function (response) { return cachePut(request, response); });
    })
  );
});