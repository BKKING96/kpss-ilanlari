/* sw.js — kpss-3a1f502d5b · paketle.mjs tarafından üretildi, elle düzenlemeyin.
   Kabuk (sayfa + ikon + manifest) önbelleğe alınır; ilan verisi alınmaz ki
   sayfa her zaman taze listeyi göstersin. */
const SURUM = "kpss-3a1f502d5b";
const KABUK = ["./", "manifest.webmanifest", "ikon-180.png", "ikon-192.png", "ikon-512.png"];

self.addEventListener("install", (olay) => {
  olay.waitUntil(
    caches.open(SURUM).then((k) => k.addAll(KABUK)).catch(() => { }).then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (olay) => {
  olay.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== SURUM).map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});
/* Taze kalması gereken yollar: ilan verisi ve beslemeler. */
const VERI_MI = (yol) => /\/veriler\//.test(yol) || /\/(besleme|sitemap)\.xml$/.test(yol);
self.addEventListener("fetch", (olay) => {
  const istek = olay.request;
  const u = new URL(istek.url);
  if (istek.method !== "GET" || u.origin !== self.location.origin) return;
  if (VERI_MI(u.pathname)) return;
  if (istek.mode === "navigate") {
    /* Sayfa: önce ağa sor (yeni sürüm varsa o gelsin), ulaşamazsan önbellekteki
       son sayfayı göster — uçakta, kesintide, kapalı sunucuda site açılır. */
    olay.respondWith(
      fetch(istek)
        .then((yanit) => {
          const kopya = yanit.clone();
          /* yönlendirilmiş yanıt önbelleğe konamaz: olursa sessizce geçiyoruz */
          caches.open(SURUM).then((k) => k.put("./", kopya)).catch(() => { });
          return yanit;
        })
        .catch(() => caches.match("./").then((x) => x || Response.error()))
    );
    return;
  }
  olay.respondWith(
    caches.match(istek).then((bulunan) =>
      bulunan ||
      fetch(istek).then((yanit) => {
        const kopya = yanit.clone();
        caches.open(SURUM).then((k) => k.put(istek, kopya)).catch(() => { });
        return yanit;
      })
    )
  );
});
