/**
 * Service Worker for KilimoSmart PWA
 * ===================================
 * Configures offline caching with smart cache strategies:
 * - Network-first for API calls (with offline fallback)
 * - Cache-first for static assets
 * - Stale-while-revalidate for non-critical resources
 */

const CACHE_VERSION = 'v2';
const CACHE_KEYS = {
  STATIC: `kilimosmart-static-${CACHE_VERSION}`,
  API: `kilimosmart-api-${CACHE_VERSION}`,
  IMAGES: `kilimosmart-images-${CACHE_VERSION}`,
};

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/index.html',
  '/manifest.json',
];

// API endpoints that should be cached
const CACHEABLE_API_PATHS = [
  '/api/labels/',
  '/api/health',
];

// ═════════════════════════════════════════════════════════════════
// INSTALL: Pre-cache critical assets
// ═════════════════════════════════════════════════════════════════
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');
  event.waitUntil(
    caches.open(CACHE_KEYS.STATIC).then((cache) => {
      console.log('[SW] Caching critical assets');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Some precache assets failed (expected if offline):', err);
        // Don't fail install if optional assets are missing
      });
    })
  );
  self.skipWaiting();
});

// ═════════════════════════════════════════════════════════════════
// ACTIVATE: Clean old cache versions
// ═════════════════════════════════════════════════════════════════
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old cache versions
          if (!Object.values(CACHE_KEYS).includes(cacheName)) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// ═════════════════════════════════════════════════════════════════
// FETCH: Smart routing based on request type
// ═════════════════════════════════════════════════════════════════
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external domains
  if (url.origin !== self.location.origin) {
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // STRATEGY 1: Static Assets (CSS, JS)
  // Cache-first with network fallback
  // ─────────────────────────────────────────────────────────────
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(
      caches.match(request).then((response) => {
        if (response) {
          console.log('[SW] Cache HIT (static):', url.pathname);
          return response;
        }
        console.log('[SW] Cache MISS (static):', url.pathname);
        return fetch(request)
          .then((response) => {
            // Clone and cache successful responses
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_KEYS.STATIC).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            // Offline: return empty response or cached
            console.warn('[SW] Offline - failed to fetch static:', url.pathname);
            return new Response('', { status: 503, statusText: 'Service Unavailable' });
          });
      })
    );
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // STRATEGY 2: API Calls
  // Network-first with cache fallback
  // ─────────────────────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_KEYS.API).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          console.log('[SW] Network HIT (API):', url.pathname);
          return response;
        })
        .catch(() => {
          // Offline: try cache first
          console.log('[SW] Network FAIL - trying cache (API):', url.pathname);
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline response
            return new Response(
              JSON.stringify({
                error: 'You are offline',
                message: 'This feature requires internet. Please check back when connected.',
              }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' },
              }
            );
          });
        })
    );
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // STRATEGY 3: Images
  // Cache-first, with network fallback (stale-while-revalidate pattern)
  // ─────────────────────────────────────────────────────────────
  if (request.destination === 'image') {
    event.respondWith(
      caches.open(CACHE_KEYS.IMAGES).then((cache) => {
        return cache.match(request).then((response) => {
          if (response) {
            console.log('[SW] Cache HIT (image):', url.pathname);
            // Refresh in background if online
            fetch(request).then((freshResponse) => {
              if (freshResponse && freshResponse.status === 200) {
                cache.put(request, freshResponse.clone());
              }
            });
            return response;
          }
          console.log('[SW] Cache MISS (image):', url.pathname);
          return fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Return a placeholder or empty response
              return new Response('', { status: 404, statusText: 'Not Found' });
            });
        });
      })
    );
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // STRATEGY 4: HTML Pages (including /)
  // Network-first with cache fallback
  // ─────────────────────────────────────────────────────────────
  if (request.destination === '' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_KEYS.STATIC).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          console.log('[SW] Network FAIL - trying cache (HTML):', url.pathname);
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Show offline page if available
            return caches.match('/').catch(() => {
              return new Response('<h1>Offline</h1><p>Connection lost. Try again later.</p>', {
                status: 503,
                headers: { 'Content-Type': 'text/html' },
              });
            });
          });
        })
    );
    return;
  }

  // Default: network-first
  event.respondWith(
    fetch(request)
      .then((response) => response)
      .catch(() => caches.match(request))
  );
});

// ═════════════════════════════════════════════════════════════════
// BACKGROUND SYNC: Queue failed requests for retry
// ═════════════════════════════════════════════════════════════════
self.addEventListener('sync', (event) => {
  if (event.tag === 'diagnose-upload-retry') {
    event.waitUntil(
      // Placeholder: Implement retry logic for failed diagnosis uploads
      Promise.resolve()
    );
  }
});
