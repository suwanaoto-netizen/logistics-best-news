// sw.js — Service Worker (PWA対応)
const CACHE = 'lbn-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  // API通信はキャッシュしない
  if (e.request.url.includes('supabase') || e.request.url.includes('anthropic')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
