// Service worker for Sambandscentralen.
//
// Three caching rules, one per kind of request:
//
//   /api/*                network only. Incident data goes stale in minutes and
//                         a cached answer would be worse than none.
//   /_next/static, /icons cache first. Content-hashed or stable filenames, so a
//                         hit is always the right bytes.
//   everything else       network first, and only the page shell is written
//                         back, as the offline fallback.
//
// The previous version wrote every successful same-origin GET into one cache,
// keyed on the full URL. Every ?event=, ?view= and ?search= combination became
// its own permanent entry, so a cache meant to hold a handful of files grew
// without limit as people used the site.
const VERSION = 'v3';
const SHELL_CACHE = `samband-shell-${VERSION}`;
const STATIC_CACHE = `samband-static-${VERSION}`;
const KEEP = [SHELL_CACHE, STATIC_CACHE];

// The offline fallback is the feed with no query string, so one entry answers
// for every URL the app can be opened at.
const SHELL_URL = '/';

const PRECACHE = [SHELL_URL, '/manifest.json', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Not addAll, one 404 there would reject the whole install and leave the
      // site with no service worker at all.
      Promise.all(
        PRECACHE.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((response) => (response.ok ? cache.put(url, response) : null))
            .catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Lets a navigation start fetching while the worker is still booting.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('samband-') && !KEEP.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      // Stored under the bare path: the fallback has to answer for /?event=123
      // as well, and one shell does that.
      cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const shell = await caches.match(SHELL_URL);
    if (shell) return shell;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  // Cross-origin (map tiles, fonts) is left to the browser: handling it here
  // puts the request under connect-src instead of img-src and the CSP blocks it.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((hit) => hit || Response.error()))
  );
});
