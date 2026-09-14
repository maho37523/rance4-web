importScripts('https://storage.googleapis.com/workbox-cdn/releases/4.3.1/workbox-sw.js');

workbox.core.skipWaiting();
workbox.core.clientsClaim();

let cacheOptions = {
    cacheName: 'kichikuou',
    plugins: [
        new workbox.expiration.Plugin({
            maxEntries: 100,
            purgeOnQuotaError: true,
        })
    ],
};

// Cache-first for fonts and SoundFonts.
workbox.routing.registerRoute(/\/(fonts|soundfonts)\//, new workbox.strategies.CacheFirst(cacheOptions));

// Cache Storage does not include Range in its default key. Caching a 206
// response under an ALD URL can therefore feed a later 4 MiB request a small
// or unrelated segment. The launcher owns complete-file caching explicitly in
// its own versioned cache; all requests to the range-capable game proxy must
// bypass Workbox.
workbox.routing.registerRoute(
    ({url}) => url.origin === 'https://ranceking-archive-proxy.ljc787865.workers.dev',
    new workbox.strategies.NetworkOnly()
);

// Network first for other same-origin resources.
workbox.routing.registerRoute(/\//, new workbox.strategies.NetworkFirst(cacheOptions));
