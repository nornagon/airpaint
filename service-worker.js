const CURRENT_CACHES = {
  app: "app-v1",
};

const appUrls = [
  "./index.js",
  "./coordinate-map.js",
  "./gl.js",
  "./contrast.js",
  "./bresenham.js",
  "./cp437.js",
  "./default-palette.js",
  "./idb.js",
  "./xp.js",
  "./fonts/config.json",
  "./fonts/cp437_8x8.png",
  "./fonts/cp437_10x10.png",
  "./fonts/cp437_12x12.png",
  "./fonts/cp437_14x14.png",
  "./fonts/cp437_16x16.png",
  "./fonts/cp437_18x18.png",
  "./fonts/cp437_20x20.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CURRENT_CACHES.app);
    await cache.addAll(appUrls);
  })());
});

self.addEventListener("activate", function (event) {
  // Delete all caches that aren't named in CURRENT_CACHES.
  // While there is only one cache in this example, the same logic will handle the case where
  // there are multiple versioned caches.
  var expectedCacheNamesSet = new Set(Object.values(CURRENT_CACHES));
  event.waitUntil(
    caches
      .keys()
      .then(function (cacheNames) {
        return Promise.all(
          cacheNames.map(function (cacheName) {
            if (!expectedCacheNamesSet.has(cacheName)) {
              // If this cache name isn't present in the set of "expected" cache names, then delete it.
              console.log("Deleting out of date cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        self.clients.claim();
      })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET")
    return event.respondWith(fetch(event.request));

  const { request } = event

  // Prevent Chrome Developer Tools error:
  // Failed to execute 'fetch' on 'ServiceWorkerGlobalScope': 'only-if-cached' can be set only with 'same-origin' mode
  //
  // See also https://stackoverflow.com/a/49719964/1217468
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return
  }

  return event.respondWith(async function () {
    const cache = await caches.open(CURRENT_CACHES.app)

    const cachedResponsePromise = await cache.match(request)
    const networkResponsePromise = fetch(request)

    if (request.url.startsWith(self.location.origin)) {
      event.waitUntil(async function () {
        const networkResponse = await networkResponsePromise

        await cache.put(request, networkResponse.clone())
      }())
    }

    return cachedResponsePromise || networkResponsePromise
  }())
});
