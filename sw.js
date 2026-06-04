const CACHE_NAME = 'punt-tracker-v11';
const APP_SHELL = [
  './',
  './index.html',
  './tracker.css',
  './tracker.js',
  './storage.js',
  './stats.js',
  './field.js',
  './stopwatch.js',
  './charts.js',
  './supabase-client.js',
  './auth.js',
  './coach.js',
  './team-view.js',
  './icon.svg',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.hostname.endsWith('.supabase.co')) return;

  const isNavigation = event.request.mode === 'navigate';

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone).catch(() => {});
            });
          }
          return response;
        })
        .catch(() => {
          if (isNavigation) return caches.match('./');
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
