const CACHE_NAME = "video-delay-v46";
const FILES = [
  "./",
  "./index.html",
  "./style.css?v=46",
  "./app.js?v=46",
  "./manifest.webmanifest?v=46",
  "./sw.js?v=46",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./app-icon.png",
  "./club-logo.png",
  "./logo.svg"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("video-delay-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cached) => cached || fetch(event.request))
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
