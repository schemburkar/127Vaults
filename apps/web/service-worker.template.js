/* The release build injects a complete, versioned, same-origin app shell. */
const CACHE = '127vaults-shell-' + __SHELL_VERSION__;
const ASSETS = __SHELL_ASSETS__;
const allowed = new Set(ASSETS);
const installedClients = new Set();
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // All or nothing: a missing WASM/module/icon must fail the installation.
    await cache.addAll(ASSETS.map(path => new Request(path, { cache: 'reload', credentials: 'same-origin' })));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('127vaults-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === '127vaults-installed' && event.source?.id) installedClients.add(event.source.id);
  if (event.data?.type === '127vaults-check-shell' && event.ports?.[0]) {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(CACHE), missing = [];
        for (const path of ASSETS) if (!await cache.match(path)) missing.push(path);
        // Repair a partially removed shell while connected; readiness is based
        // on cached bytes, not merely on a surviving worker registration.
        if (missing.length) await cache.addAll(missing.map(path => new Request(path, { cache: 'reload', credentials: 'same-origin' })));
        for (const path of ASSETS) if (!await cache.match(path)) throw Error('INCOMPLETE_SHELL');
        event.ports[0].postMessage({ ready: true });
      } catch { event.ports[0].postMessage({ ready: false }); }
    })());
  }
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Never cache or intercept API/auth/admin traffic, writes, or external sites.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !allowed.has(url.pathname)) return;
  event.respondWith((async () => {
    const client = event.clientId && await self.clients.get(event.clientId);
    const pwa = installedClients.has(event.clientId) || (client && new URL(client.url).searchParams.get('pwa') === '1') || (request.mode === 'navigate' && url.pathname === '/' && url.searchParams.get('pwa') === '1');
    if (!pwa) return fetch(request); // Ordinary browser use stays online-only.
    const cached = await (await caches.open(CACHE)).match(url.pathname);
    return cached || fetch(request);
  })());
});
