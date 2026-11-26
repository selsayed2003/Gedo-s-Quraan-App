// Offline support: the app and the full Quran text are stored on the phone.
// Audio streams from the internet. Bump VERSION after changing any file.
const VERSION = "quran-v3";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "search.js", "manifest.webmanifest",
  "fonts/sch-400.woff2", "fonts/sch-700.woff2", "icons/icon-192.png", "icons/icon-512.png",
  "data/surahs.json", "data/search.json",
];
for (let i = 1; i <= 114; i++) SHELL.push(`data/s/${i}.json`);
const TIMINGS = "quran-timings";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TIMINGS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin) {
    const isData = //(data|fonts|icons)//.test(url.pathname);
    e.respondWith(isData ? cacheFirst(e.request) : networkFirst(e.request));
  } else if (url.hostname === "api.qurancdn.com") {
    // word timings never change: keep a copy once downloaded
    e.respondWith(
      caches.open(TIMINGS).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
  }
});

// Quran text, fonts, icons: never change -> use the copy on the phone.
async function cacheFirst(req) {
  return (await caches.match(req, { ignoreSearch: true })) || fetch(req);
}
// App files (look, buttons, logic): get the newest version when online,
// use the saved copy when there is no internet.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(req, { cache: "no-cache" }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
  }
}
