/*  ===================================================================
 *  yeni-kaynaklar.mjs — aggregator (derleyici) kaynak toplayıcıları
 *  -------------------------------------------------------------------
 *  scraper.mjs bu modülü kullanır; tarih/il/temizleme yardımcıları (Y)
 *  dışarıdan verilir ki dönen içe-aktarım oluşmasın.
 *
 *  NEDEN BU SİTELER?  (25-26 Kasım 2026'da canlı yoklandı)
 *  Resmî kaynakların çoğu botlarla korunuyor ve doğrudan çekilemiyor:
 *    ✗ esube.iskur.gov.tr   → WAF boş yanıt veriyor
 *    ✗ kariyerkapisi.gov.tr → içerik tarayıcıda üretiliyor
 *    ✗ resmigazete.gov.tr   → ilanlar iç içe geçmiş PDF/Word, yapısal değil
 *    ✗ saglik.gov.tr / MSB  → 1 KB kabuk sayfa / TLS hatası
 *  Aşağıdaki derleyici siteler BU kaynakların ilanlarını kendi sayfalarında
 *  düzgün biçimde yayımlıyor, bazılarında JSON API bile var:
 *    ✓ kadroatlasi.com.tr      → tek sayfada ~450 ilan + kurum/tür/tarih/kontenjan
 *    ✓ kariyerbankasi.net      → WordPress JSON API (tam metin dahil)
 *    ✓ personelalim.com.tr     → WordPress JSON API (tam metin dahil)
 *    ✓ kamualimlari.com        → statik HTML liste (+ ilan sayfasında başvuru tarihi)
 *    ✓ kamuatlas.com           → statik HTML liste (+ ilan sayfasında başvuru tarihi)
 *    ✓ memuralimilanlari.com   → statik HTML liste (+ ilan sayfasında başvuru tarihi)
 *    ✓ memurjet.com            → statik HTML liste (+ ilan sayfasında başvuru tarihi)
 *  Denendi ama kullanılmıyor: kamumemuralimi.net (yazılarının tamamı KPSS haberi,
 *  ilân çıkmıyor), kamuisilanlari.com (Ocak 2026'dan beri güncellenmiyor),
 *  kamuturk.com / uygunkadro.com / memurol.com (liste alanları JS ile üretiliyor).
 *  Bu siteler HABER/ÖZET sayfasıdır; ilanın resmî bağlantısı metinde geçiyorsa
 *  kayıt O resmî adrese yönlendirilir, geçmiyorsa özet sayfada kalır
 *  (kaydın "ozetUrl" alanında özet sayfanın adresi her zaman durur).
 *
 *  EK YÜK: WordPress sitelerde ilan metni JSON'un içinde gelir, yani ilan
 *  başına ayrıca sayfa indirilmez. Kadro Atlası için de liste yeterlidir.
 *  =================================================================== */

const AYLAR_KISA = {
  ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7,
  ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12,
  oca: 1, şub: 2, mar: 3, nis: 4, may: 5, haz: 6, tem: 7, ağu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
};

/* ------------------------------------------------------- kaynak ayarları ---- */
export const YENI_KAYNAKLAR = [
  {
    slug: "kadro-atlasi", ad: "Kadro Atlası", tur: "kadro",
    liste: ["https://kadroatlasi.com.tr/ilan"],
    aciklama: "Kariyer Kapısı + Resmî Gazete + İŞKUR + belediye portalları derlemesi",
  },
  {
    slug: "kariyer-bankasi", ad: "Kariyer Bankası", tur: "wp",
    site: "https://kariyerbankasi.net",
    /* kategori slug'ları her turda /categories üzerinden yeniden çözülür
       (WordPress kategori numaraları sabit değildir) */
    kategoriler: ["memur-alimi", "isci-alimi", "sozlesmeli-personel-alimlari", "belediye-personel-alimlari", "polis-alimlari", "askeri-personel-alimi", "kamu-bankasi-personel-alimlari"],
    adet: 40,
    aciklama: "Kurum kurum alım duyurusu (tam metin JSON API'de)",
  },
  {
    slug: "kamu-alimlari", ad: "Kamu Alımları", tur: "kart",
    liste: ["https://kamualimlari.com/ilanlar"],
    desen: /\/ilan\/(\d+)\/([a-z0-9\-çğıöşü]+)/i,
    aciklama: "Kadro sayısı ve kurumu bağlantı adında taşıyan liste",
  },
  {
    slug: "kamu-atlas", ad: "Kamu Atlas", tur: "kart",
    liste: ["https://kamuatlas.com/ilanlar", "https://kamuatlas.com/ilanlar?page=2"],
    desen: /\/ilan\/kk\/([a-z0-9-]{8,})/i,
  },
  {
    slug: "memur-alim-ilanlari", ad: "Memur Alım İlanları", tur: "kart",
    liste: ["https://memuralimilanlari.com/ilanlar", "https://memuralimilanlari.com/ilanlar?page=2"],
    desen: /\/ilan\/([a-z0-9-]{6,})/i,
  },
  {
    slug: "personel-alim", ad: "Personel Alımı", tur: "wp", site: "https://personelalim.com.tr",
    kategorier: [], adet: 30,
  },
  {
    slug: "kamu-is-ilanlari", ad: "Kamu İş İlanları", tur: "kart",
    liste: ["https://www.memurjet.com/is-ilanlari"],
    desen: /\/is-ilanlari\/([a-z0-9\-çğıöşü]+)/i,
    aciklama: "Güncel memur/işçi alımı listesi",
  },
];

const wpPostAdresi = (k) => `${k.site}/wp-json/wp/v2/posts?per_page=${k.adet || 30}&orderby=date&order=desc&_fields=id,date,modified,link,slug,title,content`;

/* çekilecek adresler (scraper bunları önbelleğe indirir) */
export function yeniKaynakAdresleri() {
  const u = [];
  for (const k of YENI_KAYNAKLAR) {
    // WordPress sitelerde son yazıların tamamı zaten büyük ölçüde alım duyurusu;
    // kategori süzgeci ayrıca bir istek gerektirdiği için kullanılmıyor.
    if (k.tur === "wp") u.push(wpPostAdresi(k));
    else u.push(...k.liste);
  }
  return u;
}

/* bu adresler "liste" sayfasıdır → kısa tazelik süresi kullanılır */
export function yeniKaynakMi(url) {
  return YENI_KAYNAKLAR.some((k) => (k.tur === "wp" ? url.startsWith(k.site + "/wp-json/") : (k.liste || []).some((a) => a === url || url.startsWith(a + "/"))));
}

/* --------------------------------------------------------------- yardımcılar */
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const trKucuk = (s) => (s || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

/* "25 KAS 2026" / "25 Kas 2026" → "2026-11-25" (Kadro Atlası tarih mührü) */
function kisaTarih(yazi) {
  const m = (yazi || "").match(/(\d{1,2})\s*([A-Za-zçğıöşüÇĞİÖŞÜ]{3,})\s*(\d{4})/);
  if (!m) return null;
  const ay = AYLAR_KISA[m[2].toLocaleLowerCase("tr").slice(0, 3)];
  if (!ay) return null;
  return `${m[3]}-${String(ay).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

/* HTML/Türkçe metin → {sonBasvuru, baslangic, kontenjan, puanTurleri, minPuan, ogrenim}
   (memurlar.net detay ayrıştırıcısının kısa hali: derleyici metinleri içindir) */
function metindenCikar(metin, Y) {
  const t = (metin || "").replace(/\s+/g, " ");
  const GUN = "(\\d{1,2}[./]\\d{1,2}[./]\\d{4}|\\d{1,2}\\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\\s+\\d{4})";
  const sb = [
    t.match(new RegExp("son\\s+başvuru(?:sudur)?\\s*(?:tarihi\\s*)?[:\\-]?\\s*" + GUN, "i")),
    t.match(new RegExp("(?:başvuru|son|müracaat)\\s+(?:bitiş|son|bitim)\\s+tarihi\\s*[:\\-]?\\s*" + GUN, "i")),
    t.match(new RegExp(GUN + "\\s*(?:tarihine|saatine)\\s+kadar", "i")),
    t.match(new RegExp("(?:başvurular|başvuruları)\\s*" + GUN + "\\s*(?:ile|-|ve|/)\\s*(" + GUN + ")", "i")),
  ].find(Boolean);
  const bb = t.match(new RegExp("(?:başvuru\\s+başlangıç\\s*tarihi|başlangıç\\s*tarihi|başvurular?\\s*" + GUN + "\\s*(?:ile|-|ve))", "i"));
  const kucuk = trKucuk(t);
  const puanTurleri = [...new Set([...t.matchAll(/KPSS\s*P\s?0?(\d{1,3})/gi)].map((m) => "P" + +m[1]))];
  const minP = [...t.matchAll(/(?:en\s+az|asgari|minimal)?\s*(\d{2,3})\s*(?:ve\s+)?(?:üzeri|üstü)?\s*(?:kpss\s*)?(?:puan|şart)/gi)]
    .map((m) => +m[1]).filter((p) => p >= 50 && p <= 100);
  // "1.250 kadro" binlik ayraçlı da yazılabiliyor
  const k = t.match(/\b(\d{1,4}(?:\.\d{3})?)\s*(?:kişi|adet|personel|memur|işçi|sözleşmeli|öğretim|kadro|hemşire|tekniker|uzman)/i);
  const ogrenim = [];
  if (/lisans\s*mezun|4\s*yıllık|fakülte\s*mezun|en\s*az\s*lisans/.test(kucuk)) ogrenim.push("Lisans");
  if (/ön\s*lisans|meslek\s*yüksekokul|\bmyo\b|2\s*yıllık/.test(kucuk)) ogrenim.push("Ön lisans");
  if (/ortaöğretim\s*mezun|lise\s*mezun|meslek\s*lisesi|düz\s*lise/.test(kucuk)) ogrenim.push("Ortaöğretim");
  if (/yüksek\s*lisans|doktora|lisansüstü/.test(kucuk)) ogrenim.push("Lisansüstü");
  return {
    sonBasvuru: sb ? Y.tarih(sb[sb.length - 1]) : null,
    baslangic: bb ? Y.tarih(bb[1] || bb[0]) : null,
    kontenjan: k ? (+(k[1].replace(/\./g, "")) > 30000 ? null : +(k[1].replace(/\./g, ""))) : null,
    puanTurleri, minPuan: minP.length ? Math.min(...minP) : null,
    ogrenim,
  };
}

/* Bir başlık/metin gerçekten İLAN duyurusu mu, yoksa genel haber mi?
   Derleyici siteler KPSS haberi, kredi kampanyası, emekli zammı gibi yazılar
   da yayımlıyor; onlar siteye girmez.                          */
const ILAN_IPUCU = /(alim|alım|alinacak|alınacak|alacak|temin|basvuru|başvuru|sözleşmeli|sozlesmeli|kadro|istihdam)/i;
const HABER_IPUCU = /(kampanya|kredi|zam|indirim|emekli maaş|maaş zamm| promosyon|seçim|anket|müjde|dolandır|tarihleri açıklandı|sınav sonuç|sonuçları|yerleştirme|nasıl yapılır|nedir|şartları neler|rehber|takvim|var mı)/i;
function ilanMi(baslik, govde) {
  const t = (baslik || "") + " " + (govde || "").slice(0, 800);
  if (!ILAN_IPUCU.test(t)) return false;
  if (HABER_IPUCU.test(baslik || "")) return false;
  // " Personel Alımı", "Memur Alımı", "9000 Uzman Erbaş", "Başvuruları Sürüyor" gibi net kalıplar
  return /\d{1,5}\s*[\wçğıöşüÇĞİÖŞÜ ]{0,30}?(alim|alım|personel|memur|işçi|isci|erbaş|erbas|kadro|öğretim)/i.test(baslik)
    || /(memur|personel|işçi|isci|sözleşmeli|sozlesmeli|akademik|öğretim|ogretim|subay|erbaş|polis|bekçi|kaymakam|uzman) (alim|alım|temin|başvuru|başvurular)/i.test(baslik)
    || /(basvurular|başvurular|başvuruları)\s*(sürüyor|başladı|devam|açıldı|bugün|son)/i.test(baslik)
    || /alim|alım/i.test(baslik);
}

/* İl listesi: başlıkta il geçiyorsa güvenilen cevap odur. Metindeki liste
   yanıltıcı olabiliyor: "81 ilde istihdam" tarzı duyuruların içinde bütün
   şehirler geçiyor ve süzgeçte tek bir ilan 81 ilde görünüyordu.            */
function illerSec(baslik, metin, Y) {
  const b = Y.illeriBul(baslik);
  if (b.length) return b.slice(0, 6);
  const m = Y.illeriBul(metin);
  return m.length <= 8 ? m.slice(0, 6) : [];
}

/* Kurum adı. Derleyici siteler başlığı kendi biçimlerinde kısaltıyor
   ("İçişleri Bak.", "… Alımı (Karayolları Genel Müdürlüğü)"), bu yüzden önce
   kısaltmalar açılır, sonra parantez içindeki kurum denenir.               */
function kurumBul(baslik, metin, Y) {
  const t = (baslik || "")
    .replace(/\bBak\./g, "Bakanlığı").replace(/\bBşk\./g, "Başkanlığı")
    .replace(/\bGen\./g, "Genel ").replace(/\bÜnv\./g, "Üniversitesi");
  const parantez = (t.match(/[({\[]([^)\]}]{6,70})[)\]}]/) || [])[1];
  for (const aday of [parantez, t, (metin || "").slice(0, 1500)]) {
    if (!aday) continue;
    const m = aday.match(Y.KURUM_DESEN);
    if (m) return m[1].trim().replace(/^[({\[]\s*/, "");
  }
  return null;
}

/* Kurumun kendi sitesindeki/Resmî Gazete'deki bağlantıyı bulur.
   Yalnızca kurumun ANA SAYFASI kabul edilmez ("icisleri.gov.tr" gibi):
   ilanın kendisine giden bir yol olmalı, aksi halde kullanıcı boşa yönlendirilir. */
function resmiBul(metin, hariçDomainler) {
  const adaylar = [...(metin || "").matchAll(/https?:\/\/[^\s"'<>()\]]+/g)].map((m) => m[0].replace(/[.,;]$/, ""));
  const iyi = (u) => {
    let d; try { d = new URL(u); } catch { return false; }
    const alan = d.hostname.replace(/^www\./, "");
    if (hariçDomainler.some((h) => alan === h || alan.endsWith("." + h))) return false;
    const domainUygun = /\.(gov\.tr|edu\.tr|k12\.tr)$/.test(alan) || /kariyerkapisi|kamuilan|resmigazete/i.test(alan);
    const yol = (d.pathname || "/").replace(/\/+$/, "");
    if (!domainUygun) return false;
    // kök veya tek kelimelik genel dizinler ("…/tr", "…/duyurular") ilana götürmez
    if (yol.length < 4 || /^\/(tr|tr-TR|AnaSayfa|anasayfa|duyurular|haberler|kurumsal|iletisim)$/i.test(yol)) return false;
    return true;
  };
  const onemli = adaylar.filter((u) => /resmigazete|kariyerkapisi|kamuilan/i.test(u));
  return onemli.find(iyi) || adaylar.find(iyi) || null;
}

/* WordPress REST çıktısı → ilan kayıtları */
export function wpIlanlari(jsonYazi, k, Y) {
  let gonderiler = [];
  try { gonderiler = JSON.parse(jsonYazi); } catch { return []; }
  if (!Array.isArray(gonderiler)) return [];
  const cikti = [];
  const HIC = [new URL(k.site).hostname.replace(/^www\./, ""), "wordpress.org"];
  for (const g of gonderiler) {
    const baslik = Y.temiz(g.title?.rendered || "");
    const govde = Y.temiz(g.content?.rendered || "");
    if (!baslik || !ilanMi(baslik, govde)) continue;   // KPSS haberi / kampanya yazısı değilse al
    if (/iptal|hakkında|sonuçları|yerleştirme|takvim|sonuçlar/i.test(baslik)) continue;
    const hamTarih = (g.date || "").slice(0, 10);
    const alan = metindenCikar(baslik + " " + govde.slice(0, 4000), Y);
    /* Gerçek bir alım duyurusunda ya kadro sayısı ya başvuru tarihi vardır.
       Bu ikisi yoksa yazı KPSS haberi/rehberidir (kamumemuralimi.net bu tür
       yazılarla dolu) ve ilân listemize girmemeli.                     */
    const sayi = /\b\d{1,5}\s+(?:[\wçğıöşüÇĞİÖŞÜ]+\s+){0,3}?(kişi|kadro|personel|memur|işçi|isci|erbaş|hemşire|tekniker|mühendis|öğretim)/i;
    if (!alan.kontenjan && !alan.sonBasvuru && !sayi.test(baslik)) continue;
    const metin = baslik + " " + govde.slice(0, 3000);
    const kurum = kurumBul(baslik, govde, Y);
    cikti.push({
      id: "wp-" + hash(k.slug + "#" + (g.id || g.link)),
      url: resmiBul(govde, HIC) || g.link,
      ozetUrl: g.link,
      baslik, tarih: hamTarih || Y.bugun(),
      kategori: k.ad, kategoriSlug: k.slug,
      kurum, ...alan,
      yayinda: true, detayVar: true, eklendi: Y.bugun(),
      iller: illerSec(baslik, metin, Y),
      unvanlar: [...new Set([...metin.matchAll(Y.UNVANLAR)].map((x) => x[1].replace(/\s+/g, " ")))].slice(0, 5),
      ogrenim: alan.ogrenim.length ? alan.ogrenim : Y.ogrenimBul(trKucuk(metin)),
      kpssSartli: /kpss/i.test(metin),
      yontem: /kariyer\s*kapısı|e-?devlet/.test(trKucuk(metin)) ? "e-Devlet / Kariyer Kapısı" : null,
      kaynak: k.ad,
      ozet: `${baslik}. (Derleyen: ${k.ad}${alan.sonBasvuru ? " · son başvuru " + alan.sonBasvuru : ""})`,
      govdeMetni: govde.slice(0, 2200),
    });
  }
  return cikti;
}

/* Kadro Atlası liste blokları → ilan kayıtları
   <li class="kk-ilan" data-durum="acik" data-tur="..." data-kaynak="resmi-gazete" ...>
     <span class="kk-stamp" aria-label="Yayım tarihi: 25 KAS 2026">…
     <p class="kk-ilan__kurum">KURUM</p>
     <h2 class="kk-ilan__title"><a href="/ilan/…">BAŞLIK</a></h2>
     <p class="kk-ilan__meta"><span>Son başvuru: <strong>09.12.2026</strong></span><span>22 kişi</span><span>Resmî Gazete</span></p>  */
export function kadroAtlasiIlanlari(html, k, Y) {
  const cikti = [];
  const KAYNAK_AD = { "resmi-gazete": "Resmî Gazete", "kariyer-kapisi": "Kariyer Kapısı", "iskur": "İŞKUR", "belediye": "Belediye portalı" };
  for (const m of html.matchAll(/<li\s+[^>]*class=["'][^"']*kk-ilan[^"']*["'][^>]*>([\s\S]{100,2500}?)<\/li>/gi)) {
    const blok = m[0];
    const acik = /data-durum=["']acik["']/i.test(blok);
    const tur = (blok.match(/data-tur=["']([^"']+)["']/i) || [])[1] || "";
    const kaynakKodu = (blok.match(/data-kaynak=["']([^"']+)["']/i) || [])[1] || "";
    const yayim = (blok.match(/aria-label=["']Yayım tarihi:\s*([^"']+)["']/i) || [])[1] || "";
    const kurum = Y.temiz((blok.match(/kk-ilan__kurum["'][^>]*>([\s\S]{3,200}?)<\//i) || [])[1]);
    const link = blok.match(/<h2[^>]*kk-ilan__title[^>]*>\s*<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{3,300}?)<\/a>/i);
    if (!link) continue;
    const baslik = Y.temiz(link[2]);
    const adrese = new URL(link[1], "https://kadroatlasi.com.tr").href;
    const meta = (blok.match(/kk-ilan__meta[\s\S]{0,900}?<\/p>/i) || [""])[0];
    const sonMeta = (meta.match(/Son başvuru:\s*<strong[^>]*>([^<]{4,40})</i) || [])[1];
    const kisi = (meta.match(/>\s*([\d.]{1,6})\s*<!--[^>]*-->\s*kişi/i) || meta.match(/([\d.]{1,6})\s*kişi/i) || [])[1];
    const tarihIso = kisaTarih(yayim);
    const metin = [kurum, baslik, tur].filter(Boolean).join(" ");
    const alan = metindenCikar(metin, Y);
    cikti.push({
      id: "ka-" + hash(adrese),
      url: adrese, ozetUrl: adrese,
      baslik: kurum && !baslik.toLocaleLowerCase("tr").includes(trKucuk(kurum).split(" ")[0]) ? `${kurum}: ${baslik}` : baslik,
      tarih: tarihIso || Y.bugun(),
      kategori: k.ad + (tur ? " · " + tur.replace(/[-_]/g, " ").replace(/^./, (x) => x.toLocaleUpperCase("tr")) : ""), kategoriSlug: k.slug,
      kurum: kurum || null,
      sonBasvuru: Y.tarih(sonMeta || "") || alan.sonBasvuru,
      baslangic: null,
      kontenjan: kisi ? +(String(kisi).replace(/\./g, "")) : null,
      puanTurleri: [], minPuan: null, kpssSartli: false,
      ogrenim: Y.ogrenimBul(trKucuk(metin)),
      iller: illerSec(baslik, metin, Y),
      unvanlar: [...new Set([...metin.matchAll(Y.UNVANLAR)].map((x) => x[1].replace(/\s+/g, " ")))].slice(0, 5),
      yayinda: acik, detayVar: true, eklendi: Y.bugun(),
      yontem: null,
      kaynak: KAYNAK_AD[kaynakKodu] || k.ad,
      ozet: `${kurum || ""} ${baslik}${tur ? " (" + tur + ")" : ""}. Kaynak derlemesi: ${k.ad}.`,
      govdeMetni: "",
    });
  }
  return cikti;
}

/* Düz HTML ilan listeleri (kamualimlari.com, memurjet.com) */
export function kartIlanlari(html, k, Y, gorulen = new Set()) {
  const cikti = [];
  const temel = k.liste[0];
  for (const m of html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{3,220}?)<\/a>/gi)) {
    const es = m[1].match(k.desen);
    if (!es) continue;
    const baslik = Y.temiz(m[2]);
    if (baslik.length < 12 || !/alim|alım|personel|memur|işçi|isci|temin|akademik|öğretim/i.test(baslik)) continue;
    if (HABER_IPUCU.test(baslik)) continue;   // ilan olmayan duyuru/haber kartı
    const adrese = new URL(m[1], temel).href;
    if (gorulen.has(adrese)) continue;
    gorulen.add(adrese);
    const yolAdi = Y.temiz((es[2] || es[1] || "").replace(/-/g, " "));
    const metin = baslik + " " + yolAdi;
    const alan = metindenCikar(metin, Y);
    const kurum = kurumBul(baslik, yolAdi, Y);
    const cevre = html.slice(Math.max(0, m.index - 1200), m.index + 1400);
    const kartTarih = Y.tarih((cevre.match(/(?:yayın|yayin|ekleme|tarih|ilân|ilan)[^\d]{0,14}(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i) || [])[1] || "");
    cikti.push({
      id: "kr-" + hash(k.slug + "#" + adrese),
      url: adrese, ozetUrl: adrese,
      baslik, tarih: kartTarih || Y.bugun(), tarihBilinmiyor: !kartTarih,
      kategori: k.ad, kategoriSlug: k.slug,
      kurum, ...alan,
      ogrenim: alan.ogrenim.length ? alan.ogrenim : Y.ogrenimBul(trKucuk(metin)),
      yayinda: true, detayVar: true, detayIstenen: true, eklendi: Y.bugun(),
      iller: illerSec(baslik, metin, Y),
      unvanlar: [...new Set([...metin.matchAll(Y.UNVANLAR)].map((x) => x[1].replace(/\s+/g, " ")))].slice(0, 5),
      kpssSartli: /kpss/i.test(metin), yontem: null,
      kaynak: k.ad,
      ozet: `${baslik}. (Derleyen: ${k.ad} — şartlar kaynak sayfada)`,
      govdeMetni: "",
    });
  }
  return cikti;
}

/* ------------------------------------- düz HTML kaynakların İLAN detayları -- */
/* kamualimlari.com ve memurjet.com listelerde yalnızca başlık veriyor; son
   başvuru tarihi, kurum ve puan türü ilan SAYFASINDA. Liste kaydı işaretsiz
   kalmasın diye detayları da okuyoruz (bütçe yettiği kadar).               */
/* Detayı okunmamış kayıtlar: başvuru tarihi/puan türü eksik ya da yayım tarihi
   bilinmiyor. Detay adresi kaydın kendi adresidir; okunduktan sonra bayrak
   düşürülür ki her turda boşuna indirilmesin.                           */
export function kartDetayAdresleri(kayitlar, limit = 24) {
  return kayitlar
    .filter((x) => x.detayIstenen && (!x.sonBasvuru || x.tarihBilinmiyor))
    .slice(0, limit)
    .map((x) => ({ id: x.id, url: x.ozetUrl || x.url }));
}

function duzMetin(html) {
  return (html || "")
    .replace(/<script[\s\S]{0,60000}?<\/script>/gi, " ")
    .replace(/<style[\s\S]{0,12000}?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ").trim();
}

/* yılı olmayan tarih ("7 Aralık") bugün üzerinden tahmin edilir */
function tarihTahmin(yazi, Y) {
  const dogrudan = Y.tarih(yazi);
  if (dogrudan) return dogrudan;
  const m = (yazi || "").match(/(\d{1,2})\s*([A-Za-zçğıöşüÇĞİÖŞÜ]{3,})/);
  if (!m) return null;
  const ay = AYLAR_KISA[m[2].toLocaleLowerCase("tr").slice(0, 3)];
  if (!ay) return null;
  const bugun = new Date(Y.bugun() + "T00:00:00Z");
  const buYil = new Date(Date.UTC(bugun.getUTCFullYear(), ay - 1, +m[1]));
  // 45 günden geride kaldıysa gelecek yıl kastediliyor olmalı (kış aylarında okunan yaz ilanı)
  const aday = buYil - bugun < -45 * 864e5 ? new Date(Date.UTC(bugun.getUTCFullYear() + 1, ay - 1, +m[1])) : buYil;
  return aday.toISOString().slice(0, 10);
}

const SON_BASVURU_DESEN = [
  /son (?:ba[şv]vuru|başvuru) tarihi[:\s]+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i,
  /son (?:ba[şv]vuru|başvuru) tarihi[:\s]+(\d{1,2}\s+[A-Za-zçğıöşüÇĞİÖŞÜ]{3,}\d{0,4}(?:\s*\d{4})?)/i,
  /son (?:ba[şv]vuru|başvuru)[:\s]+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i,
  /son (?:ba[şv]vuru|başvuru)[:\s]+(\d{1,2}\s+[A-Za-zçğıöşüÇĞİÖŞÜ]{3,}[^\d]{0,8}\d{0,4})/i,
  /son gün\s+(\d{1,2}\s+[A-Za-zçğıöşüÇĞİÖŞÜ]{3,}[^\d]{0,8}\d{0,4})/i,
];
const BASLANGIC_DESEN = [
  /ba[şv]şvuru (?:başlangıcı|başlangıç)[^\d]{0,14}(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i,
  /başvuru başlangıç\s*(\d{1,2}\s+[A-Za-zçğıöşüÇĞİÖŞÜ]{3,}[^\d]{0,8}\d{0,4})/i,
  /ilan (?:başlangıç|tarihi)[:\s]+(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i,
];

/* Bir ilan sayfasının metnini kayda işler. */
export function kartDetayUygula(kayit, html, k, Y) {
  const metin = duzMetin(html);
  if (metin.length < 200) return false;
  const disDomainler = [new URL(k.liste[0]).hostname.replace(/^www\./, "")];

  const kurum = ((metin.match(/(?:^|\s)Kurum\s+([A-ZÇĞİÖŞÜ][\wçğıöşü ]{4,55}?(?:Bakanlığı|Üniversitesi|Belediyesi|Başkanlığı|Müdürlüğü|Genel Müdürlüğü))/) || [])[1] || "").trim()
    || kurumBul(kayit.baslik, metin.slice(0, 2500), Y);
  if (kurum && (!kayit.kurum || kayit.kurum.length < kurum.length)) kayit.kurum = kurum;

  for (const re of SON_BASVURU_DESEN) {
    const m = metin.match(re);
    const t = m ? tarihTahmin(m[1], Y) : null;
    if (t) { kayit.sonBasvuru = t; break; }
  }
  if (!kayit.baslangic) {
    for (const re of BASLANGIC_DESEN) {
      const m = metin.match(re);
      const t = m ? tarihTahmin(m[1], Y) : null;
      if (t) { kayit.baslangic = t; break; }
    }
  }

  const alan = metindenCikar(metin.slice(0, 6000), Y);
  if (!kayit.kontenjan && alan.kontenjan) kayit.kontenjan = alan.kontenjan;
  if (!kayit.puanTurleri.length && alan.puanTurleri.length) kayit.puanTurleri = alan.puanTurleri;
  if (kayit.minPuan == null && alan.minPuan != null) kayit.minPuan = alan.minPuan;
  if (!kayit.ogrenim.length) kayit.ogrenim = alan.ogrenim.length ? alan.ogrenim : Y.ogrenimBul(trKucuk(metin.slice(0, 3000)));
  if (!kayit.iller.length) kayit.iller = illerSec(kayit.baslik + " " + (kayit.kurum || ""), metin.slice(0, 3000), Y);
  if (!kayit.unvanlar.length) kayit.unvanlar = [...new Set([...metin.slice(0, 4000).matchAll(Y.UNVANLAR)].map((x) => x[1].replace(/\s+/g, " ")))].slice(0, 5);
  if (!kayit.kpssSartli) kayit.kpssSartli = /kpss/i.test(metin.slice(0, 4000));
  if (!kayit.yontem) kayit.yontem = /kariyer\s*kapısı|e-?devlet/i.test(metin.slice(0, 4000)) ? "e-Devlet / Kariyer Kapısı" : null;

  /* Liste sayfalarında yayım tarihi yok; ilan sayfasında varsa onu kullanıyoruz.
     Olmazsa "bugün" görünecek ve kullanıcının gözünde yanlış bir tarih çıkacak. */
  const yayimIzi = metin.match(/(?:yayınlandı|yayınlanma|yayım tarihi|ilan tarihi|eklenme|okunma)[^\d]{0,14}(\d{1,2}[.\/]\d{1,2}[.\/]\d{4}|\d{1,2}\s+[A-Za-zçğıöşüÇĞİÖŞÜ]{3,}[^\d]{0,8}\d{0,4})/i);
  if (yayimIzi) {
    const t = tarihTahmin(yayimIzi[1], Y);
    if (t && t <= Y.bugun() && t >= "2020-01-01") kayit.tarih = t;
  }

  const resmi = resmiBul(html, disDomainler);
  if (resmi) kayit.url = resmi;
  kayit.govdeMetni = metin.slice(0, 2200);
  kayit.ozet = `${kayit.baslik}${kayit.kurum ? " — " + kayit.kurum : ""}${kayit.sonBasvuru ? " · son başvuru " + kayit.sonBasvuru : ""}. (Derleyen: ${k.ad})`;
  kayit.detayVar = true;
  kayit.tarihBilinmiyor = false;
  return true;
}

/* Derleyici sitelerin liste sayfalarında aylar öncesinin KAPALI duyuruları da
   durur (üniversiteler aynı ilanı her ay yeniliyor). Bunları baştan almıyoruz:
   saklanınca aynı kurumun Ekim/Kasım sürümleri yan yana görünüyor.
     · başvuru tarihi 30 günden eskiyse  → artık kimse aramıyor
     · başvuru tarihi yok ve 45 günden eskiyse
     · kapalı ve 21 günden eskiyse                                */
export function kayitYasliMi(k, bugunIso) {
  const gunOnce = (gun) => new Date(Date.parse(bugunIso + "T00:00:00Z") - gun * 864e5).toISOString().slice(0, 10);
  if (k.sonBasvuru && k.sonBasvuru < gunOnce(30)) return true;
  if (!k.sonBasvuru && (k.tarih || "0000") < gunOnce(45)) return true;
  if (!k.yayinda && (k.tarih || "0000") < gunOnce(21)) return true;
  return false;
}

/* tek giriş noktası: bir kaynak ayarının önbellekteki çıktısını kayda çevirir */
export function kaynaklariOku(k, icerikler, Y) {
  if (k.tur === "kadro") return kadroAtlasiIlanlari(icerikler[k.liste[0]] || "", k, Y);
  if (k.tur === "kart") {
    /* Aynı ilan ikinci sayfada da yineleniyor; adres tek sefer sayılır. */
    const gorulen = new Set();
    return k.liste.flatMap((u) => kartIlanlari(icerikler[u] || "", k, Y, gorulen));
  }
  if (k.tur === "wp") return wpIlanlari(icerikler[wpPostAdresi(k)] || "", k, Y);
  return [];
}
