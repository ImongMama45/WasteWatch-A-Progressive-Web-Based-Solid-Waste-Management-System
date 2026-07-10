/**
 * sw.js — WasteWatch Service Worker
 * -----------------------------------
 * Caches the app shell so the dashboard loads offline.
 * Strategy: Cache-first for static assets, network-first for API.
 */

const CACHE_NAME = 'wastewatch-v1'

// Static assets to pre-cache (app shell)
const PRECACHE_URLS = [
    '/',
    '/index.html',
]

// Install: pre-cache app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    )
})

// Activate: remove old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    )
})

// Fetch strategy:
//   /api/*       → network-first (fresh data), fallback to cache
//   everything else → cache-first (fast), fallback to network
self.addEventListener('fetch', event => {
    const { request } = event
    const url = new URL(request.url)

    // Skip non-GET, chrome-extension, and cross-origin requests
    if (request.method !== 'GET' || url.protocol === 'chrome-extension:' || url.origin !== self.location.origin) return

    if (url.pathname.startsWith('/api/')) {
        // Network-first for API
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (!response || response.status !== 200 || response.type !== 'basic') return response
                    const clone = response.clone()
                    caches.open(CACHE_NAME)
                      .then(c => c.put(request, clone))
                      .catch(e => console.warn('SW Cache Put Failed:', e))
                    return response
                })
                .catch(() => caches.match(request))
        )
    } else {
        // Cache-first for static assets
        event.respondWith(
            caches.match(request)
                .then(cached => cached || fetch(request).then(response => {
                    if (!response || response.status !== 200 || response.type !== 'basic') return response
                    const clone = response.clone()
                    caches.open(CACHE_NAME)
                      .then(c => c.put(request, clone))
                      .catch(e => console.warn('SW Cache Put Failed:', e))
                    return response
                }))
                .catch(() => caches.match('/index.html'))   // SPA fallback
        )
    }
})
