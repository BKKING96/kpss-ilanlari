/*  ===================================================================
 *  KPSS İLAN AJANI — veri toplayıcı  (Node.js 18+, tek dosya, kurulum yok)
 *  -------------------------------------------------------------------
 *  NE YAPAR?
 *   ilan.memurlar.net üzerindeki kamu personel alım ilanlarını tarar;
 *   kurum, kadro, KPSS puan türü, istenen taban puan, öğrenim durumu,
 *   il ve son başvuru tarihini ayrıştırıp  site/veriler/  altına yazar.
 *   Site bu dosyaları okur; yani veriyi tazeleyince içerik de tazelenir.
 *
 *  KOMUTLAR (Terminalde bu klasördeyken):
 *      node scraper.mjs          →  yeni ilanları çeker, veriyi tazeler
 *      node scraper.mjs isle     →  indirdiklerini yeniden ayrıştırır (çevrimdışı)
 *      node scraper.mjs liste    →  sadece kategori listelerini indirir
 *
 *  Her çalıştırma ~100 saniyede kendini durdurur ve nereye kaldığını
 *  hatırlar. Ekranda "tekrar çalıştır" yazarsa aynı komutu bir daha
 *  yazman yeterli.
 *  =================================================================== */

import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sbbAyristir, csbListeyiOku, parmakIzi, bugunTR } from "./ek-kaynaklar.mjs";
import { YENI_KAYNAKLAR, yeniKaynakAdresleri, yeniKaynakMi, kaynaklariOku, kayitYasliMi, kartDetayAdresleri, kartDetayUygula } from "./yeni-kaynaklar.mjs";

const BURADAN = path.dirname(fileURLToPath(import.meta.url));
/* KPSS_CACHE / KPSS_VERI: bulut (GitHub Actions) çalışırken yolları dışarıdan
   verir. Verilmezse yerel klasör düzeni eskisiyle aynı kalır. */
const ONEK = process.env.KPSS_CACHE ? path.resolve(process.env.KPSS_CACHE) : path.join(BURADAN, "cache");
const VERI = process.env.KPSS_VERI ? path.resolve(process.env.KPSS_VERI) : path.join(BURADAN, "site", "veriler");
const BASE = "https://ilan.memurlar.net";
const MOD = process.argv[2];

/* --- önbellek tazelik süreleri -------------------------------------------
   Önceden önbellek HİÇ tazelenmiyordu: bir kez indirilen liste sayfası
   sonsuza dek kullanılıyor, bu yüzden yeni ilanlar hiç görünmüyordu
   (site 19 Kasım'dan beri 131 kayıtta donmuştu).
     · liste sayfaları  : hızlı değişir → 10 dakika
     · ilan detayları   : nadiren değişir → 3 gün                            */
const TAZE_LISTE_MS = 10 * 60 * 1000;
const TAZE_DETAY_MS = 3 * 24 * 60 * 60 * 1000;

/* ek kaynaklar (SBB listesi, CSB duyuru listesi) */
const EK_KAYNAKLAR = { sbb: "https://kamuilan.sbb.gov.tr/", csb: "https://yerelyonetimler.csb.gov.tr/duyurular" };

/* bir adres liste sayfası mı, ilan detayı mı? (tazelik süresini belirler) */
const listeMi = (u) =>
  /\/kategori\//.test(u) ||
  /\/duyurular(\/\d+)?\/?$/.test(u) ||
  /^https:\/\/kamuilan\.sbb\.gov\.tr\/?$/.test(u) ||
  yeniKaynakMi(u) ||            // derleyici sitelerin liste/API adresleri de hızlı tazelenir
  u === BASE + "/";
const esikMs = (u) => (listeMi(u) ? TAZE_LISTE_MS : TAZE_DETAY_MS);

/* önbellekteki kopya hâlâ taze mi? (taze değilse yeniden indirilir) */
function onbekTaze(url) {
  const dosya = path.join(ONEK, ad(url));
  if (!existsSync(dosya)) return false;
  try {
    const j = JSON.parse(readFileSync(dosya, "utf8"));
    return Date.now() - (j.alindi || 0) < esikMs(url);
  } catch { return false; }
}

/* ------------------------------------------------ mod: kaz (tek işçi) ----- */
/* Ağ katmanı aynı süreç içinde art arda çok isteye izin vermediği için
   her 2 URL taze bir Node sürecinde indirilir.                        */
if (MOD === "kaz") {
  const COZ = new TextDecoder("windows-1254"); // site Windows-1254 yayınlar
  await mkdir(ONEK, { recursive: true });
  let ok = 0;
  for (const url of process.argv.slice(3)) {
    const dosya = path.join(ONEK, ad(url));
    if (onbekTaze(url)) { ok++; continue; }
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "accept-language": "tr-TR,tr;q=0.9",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      const tip = res.headers.get("content-type") || "";
      const govde = /utf-8/i.test(tip) ? new TextDecoder("utf-8").decode(buf) : COZ.decode(buf);
      await writeFile(dosya, JSON.stringify({ url, alindi: Date.now(), html: govde }), "utf8");
      ok++;
    } catch (h) { console.log("  ! " + h.message); }
  }
  console.log("kaz:" + ok + "/" + (process.argv.length - 3));
  process.exit(0);
}

function ad(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  return h.toString(36) + ".json";
}

/* ------------------------------------------------------------ yapılar ----- */
const KATEGORILER = [
  { slug: "kpss-b-ilanlari", ad: "KPSS-B (Merkezi olmayan alımlar)" },
  { slug: "4b-ilanlari", ad: "4/B Sözleşmeli Personel" },
  { slug: "genel-ilanlar", ad: "Genel İlanlar" },
  { slug: "mahalli-ilanlari", ad: "Mahalli İdareler / Belediyeler" },
  { slug: "daimi-isci-ilanlari", ad: "Daimi İşçi Alımı" },
  { slug: "gecici-isci-ilanlari", ad: "Geçici İşçi Alımı" },
  { slug: "engelli-ilanlari", ad: "Engelli Personel Alımı" },
  { slug: "sydv-ilanlari", ad: "Sosyal Yardımlaşma Vakıfları (SYDV)" },
  { slug: "askeri-ilanlar", ad: "Askeri / Güvenlik" },
  { slug: "kpss-a-ilanlari", ad: "KPSS-A (Kurum Giriş Sınavları)" },
  { slug: "lakinma-ajansi", ad: "Kalkınma Ajansları" },
  { slug: "akademik-ilanlar-devlet", ad: "Akademik Kadro (Devlet)" },
  { slug: "akademik-ilanlar-vakif", ad: "Akademik Kadro (Vakıf)" },
];

/* --- çekilen liste adresleri ----------------------------------------------
   · her kategorinin iki hali: süresi geçenler (Expire=true) + geçenler
   · bir de memurlar.net ANA SAYFASI: kategori dışına taşan ilanları da yakalar
   Not: memurlar.net kategori listelerinde sayfalama YOK (canlı yoklandı),
   yani bir kategorinin tek sayfası vardır; derinlik SBB ve CSB tarafında.   */
const ANA_SAYFA = BASE + "/";
const kategoriUrl = (k, gecen) => `${BASE}/kategori/${k.slug}/?Expire=${gecen}`;
const listeAdresleri = () => {
  const u = [];
  for (const k of KATEGORILER) for (const e of ["false", "true"]) u.push(kategoriUrl(k, e));
  u.push(ANA_SAYFA);
  return u;
};

const ILLER = ["Adana","Adıyaman","Afyonkarahisar","Ağrı","Aksaray","Amasya","Ankara","Antalya","Ardahan","Artvin","Aydın","Balıkesir","Bartın","Batman","Bayburt","Bilecik","Bingöl","Bitlis","Bolu","Burdur","Bursa","Çanakkale","Çankırı","Çorum","Denizli","Diyarbakır","Düzce","Edirne","Elazığ","Erzincan","Erzurum","Eskişehir","Gaziantep","Giresun","Gümüşhane","Hakkari","Hatay","Iğdır","Isparta","Mersin","İstanbul","İzmir","Kars","Kastamonu","Kayseri","Karaman","Kırıkkale","Kırklareli","Kırşehir","Kilis","Kocaeli","Konya","Kütahya","Malatya","Manisa","Mardin","Muğla","Muş","Nevşehir","Niğde","Ordu","Osmaniye","Rize","Sakarya","Samsun","Siirt","Sinop","Sivas","Şanlıurfa","Şırnak","Tekirdağ","Tokat","Trabzon","Tunceli","Uşak","Van","Yozgat","Zonguldak","Yalova","Karabük"];

const UNVANLAR = /(Uzman\s+Yardımcısı|Uzman\s+Yard\.?|Uzman|Müfettiş\s+Yardımcısı|Müfettiş|Denetmen\s+Yardımcısı|Denetçi\s+Yardımcısı|Memur\s+Yardımcısı|Memur|Hemşire|Sağlık\s+Teknisyeni|Sağlık\s+Teknikeri|Laborant|Ebe|Veteriner\s+Hekim|Veteriner|Mühendis|Mimar|Tekniker|Teknisyen|Büro\s+Personeli|Destek\s+Personeli|Temizlik\s+Görevlisi|Güvenlik\s+Görevlisi|Koruma\s+ve\s+Güvenlik|Şoför|Aşçı|Kaloriferci|Bahçıvan|Araştırma\s+Görevlisi|Okutman|Kaymakam\s+Adayı|Vali\s+Yardımcısı|Programcı|Çözümleyici|Avukat|Mütercim|Tercüman|Kütüphane\s+Personeli|Arşiv\s+Görevlisi|Grafiker|Öğretmen|Zabıta|İtfaiye\s+Eri|İşçi|Memo|Erbaş|Sözleşmeli\s+Personel|Personel)/gi;

const KURUM_DESEN = /([A-ZÇĞİÖŞÜ][\wÇĞİÖŞÜçğıöşü&().\-' ]{2,48}?(?:Bakanlığı|Başkanlığı|Genel Müdürlüğü|Genel Müdürlüğü|Kurumu|İdaresi Başkanlığı|İdaresi|Müdürlüğü|Üniversitesi|Belediyesi|Belediye Başkanlığı|Ajansı|Vakfı|Komutanlığı|Kurulu|Merkezi|Bankası|Başmüdürlüğü|Genel Başkanlığı))/;

const AYLAR = { ocak:1, şubat:2, mart:3, nisan:4, mayıs:5, haziran:6, temmuz:7, ağustos:8, eylül:9, ekim:10, kasım:11, aralık:12 };

/* --------------------------------------------------------- yardımcılar ---- */
const temiz = (s) => (s || "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ").trim();

function tarih(yazi) {
  if (!yazi) return null;
  let m = yazi.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = yazi.match(/(\d{1,2})\s*(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s*(\d{4})/i);
  if (m) {
    const a = AYLAR[m[2].toLowerCase()];
    if (a) return `${m[3]}-${String(a).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  return null;
}
const illeriBul = (metin) => ILLER.filter((il) => new RegExp(`(^|[^\\p{L}])${il}([^\\p{L}]|$)`, "giu").test(metin || ""));

/* kısa metinlerde öğrenim ipucu ara (başlıklar için) */
function ogrenimBul(kucuk) {
  const o = [];
  if (/\blisansüstü\b|yüksek lisans|doktora/.test(kucuk)) o.push("Lisansüstü");
  else if (/\blisans\b|4 yıllık|fakülte/.test(kucuk)) o.push("Lisans");
  if (/ön\s?lisans|meslek yüksekokul|\bmyo\b|2 yıllık/.test(kucuk)) o.push("Ön lisans");
  if (/ortaöğretim|orta öğretim|lise|meslek lisesi/.test(kucuk)) o.push("Ortaöğretim");
  return o;
}

/* ------------------------------------------------- liste sayfası ayrıştırma */
/* Ana liste: <div class="content-items list"> içindeki "img-left item ... square-mini"
   bağlantıları. Kenar çubuğundaki "benzer/çok okunan" ilanları aynı deseni
   kullanmadığı için onlar alınmaz (aksi halde 2014'ten kalma ilanlar giriyor). */
function listeyiOku(html, kategori) {
  const cikti = [], gorulen = new Set();
  const blok = (html.match(/<div[^>]*class="content-items list[^"]*"[^>]*>([\s\S]*?)(?:<div[^>]*class="sidebar|<footer|<section)/i) || [])[1] || html;
  for (const m of blok.matchAll(/<a[^>]+class="[^"]*(?:img-left|square)[^"]*"[^>]*href="([^"]*\/ilan\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const govde = m[3];
    const gun = (govde.match(/datetime="(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (!gun) continue;
    const baslik = temiz((govde.match(/<h5[^>]*>([\s\S]*?)<\/h5>/) || [])[1]) || temiz((m[0].match(/title="([^"]+)"/) || [])[1]);
    if (!baslik) continue;
    const anahtar = kategori.slug + "#" + m[2];
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    cikti.push({ id: m[2], url: new URL(m[1], BASE).href, baslik, tarih: gun, kategori: kategori.ad, kategoriSlug: kategori.slug });
  }
  return cikti;
}

/* -------------------------------------------------- detay sayfası ayrıştırma */
/* İlan sayfalarında schema.org JobPosting (JSON-LD) bloğu var:
   qualifications = ilanın tam metni, description = özet satırı.
   Birçok İŞKUR/mahalli ilanı ise SADECE GÖRSEL olarak yayınlanır; oralarda
   tek güvenilir kaynak başlık + özet satırıdır, o yüzden başlıktan da türetiyoruz. */
function detayiOku(html, baslik) {
  let ld = null;
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      if (j && (j["@type"] === "JobPosting" || j.title)) { ld = j; break; }
    } catch { /* bozuksa HTML'e düşeriz */ }
  }

  const govdeKaynak = (() => {
    if (ld && ld.qualifications) return temiz(String(ld.qualifications));
    const makale = (html.match(/<article[\s\S]*?<\/article>/i) || [])[0] || html;
    const duz = temiz(makale.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
    const bas = duz.search(/Yazdır/i);
    return (bas > -1 ? duz.slice(bas + 6) : duz)
      .replace(/(fedy|Yorumlar\s*\(|yorum default|Kategoriler).*$/i, "").trim();
  })();
  const ozetSatir = (ld && ld.description ? String(ld.description) : "").trim();
  const basligi = [baslik, ozetSatir].filter(Boolean).join(" | ");
  const govde = (basligi + " " + ozetSatir + " " + govdeKaynak).slice(0, 12000);
  const kucuk = govde.toLowerCase();

  /* --- son başvuru / başvuru başlangıcı ------------------------------- */
  const GunRE = "(\\d{1,2}[.\\/]\\d{1,2}[.\\/]\\d{4}|\\d{1,2}\\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\\s+\\d{4})";
  const sb = [
    govde.match(new RegExp("son\\s+başvuru\\s+(?:tarihi\\s*)?[:\\-]?\\s*" + GunRE, "i")),
    govde.match(new RegExp("başvuru\\s+(?:bitiş|son)\\s+tarihi\\s*[:\\-]?\\s*" + GunRE, "i")),
    govde.match(new RegExp("müracaat\\s*\\([^)]*\\)\\s*[\\/]\\s*(\\w+\\s+\\d{4})", "i")),
    govde.match(new RegExp(GunRE + "\\s*(?:tarihine|saatine)\\s+kadar", "i")),
    govde.match(new RegExp("(?:başvurular|başvuruları)\\s*(?:" + GunRE + ")\\s*(?:ile|-|ve)\\s*(" + GunRE + ")", "i")),
  ].find(Boolean);
  let sonBasvuru = null;
  if (sb) {
    const sonuncu = sb[sb.length - 1];
    sonBasvuru = tarih(sonuncu);
  }
  const bb = govde.match(new RegExp("(?:başvuru\\s+başlangıç\\s*tarihi|başlangıç\\s*tarihi|başvurular\\s*(?::\\s*)?)" + "\\s*[:\\-]?\\s*" + GunRE, "i"));
  const baslangic = bb ? tarih(bb[1]) : null;
  const aralik = govde.match(new RegExp(GunRE + "\\s*(?:ile|-|ve|/)\\s*(" + GunRE + ")", "i"));
  const bitisAralik = aralik ? tarih(aralik[1]) : null;
  if (!sonBasvuru && bitisAralik && /başvuru|müracaat|sınav/i.test(govde.slice(Math.max(0, (aralik?.index || 0) - 120), (aralik?.index || 0) + 90))) sonBasvuru = bitisAralik;

  /* --- KPSS puan türleri ve istenen taban puan ------------------------ */
  const turler = new Set();
  for (const m of govde.matchAll(/KPSS\s*P\s?(\d{1,3})/gi)) turler.add("P" + m[1]);
  for (const m of govde.matchAll(/\bP\s?(\d{1,3})\b(?=[^.\n]{0,30}puan\s*türü)/gi)) turler.add("P" + m[1]);
  for (const m of govde.matchAll(/(?:puan\s*türü|puan\s*cinsi|puan\s*türlerinden|puan\s*türünden)[^.\n]{0,60}?\bP\s?(\d{1,3})\b/gi)) turler.add("P" + m[1]);
  for (const m of govde.matchAll(/\bP\s?(\d{1,3})\b\s*(?:ve|veya|ile|,)?\s*(?:\(\d+\)\s*)?(?:puanı\s*şartı|puan\s*şartı|puanı\s*olan|istenir)/gi)) turler.add("P" + m[1]);

  const puanlar = [];
  const ekle = (x) => { const p = +x; if (p >= 50 && p <= 100) puanlar.push(p); };
  const PUAN_DESENLERI = [
    /\bKPSS\s*(?:\s?P\s?\d{1,3})?\s*(?:puanı\s*(?:şartı\s*)?)?(?:olan\s+|en\s+az\s+)?(\d{2,3})(?=\D)/gi,
    /(\d{2,3})\s+ve\s+(?:üzeri|üstü|üzerinden|daha)\s+(?:aranan\s+)?(?:KPSS\s+)?(?:puan|şart)/gi,
    /(?:en\s+az|asgari)\s+(\d{2,3})\s+(?:puan|KPSS|şart)/gi,
  ];
  for (const desen of PUAN_DESENLERI) for (const m of govde.matchAll(desen)) ekle(m[1]);
  const minPuan = puanlar.length ? Math.min(...puanlar) : null;

  /* --- öğrenim durumu -------------------------------------------------- */
  const ogrenim = [];
  if (/(lisans\s+mezun|lisans\s+(?:mezunu|programı|mezun)|4\s+(?:yıl|yıllık)\s+(?:eğitim|yükseköğretim)|dört\s+yıllık|fakülte\s+mezun|en\s+az\s+lisans|lisans\s+seviye)/.test(kucuk)) ogrenim.push("Lisans");
  if (/(önlisans|ön\s+lisans|2\s+(?:yıl|yıllık)\s+(?:eğitim|yükseköğretim)|iki\s+yıllık|meslek\s+yüksekokul|myo\b)/.test(kucuk)) ogrenim.push("Ön lisans");
  if (/(ortaöğretim\s+(?:mezunu|mezu|eğitim|seviye|kurum)|orta\s+öğretim\s+mezun|lise\s+(?:mezunu|mezu)|meslek\s+lisesi|düz\s+lise|any\s+lise|ortaöğretim\s+kurum)/.test(kucuk)) ogrenim.push("Ortaöğretim");
  if (/(ilköğretim|ortaokul|ilkokul\s+mezun)/.test(kucuk)) ogrenim.push("İlköğretim");
  if (/(yüksek\s+lisans|lisansüstü|doktora|tezli\s+yüksek)/.test(kucuk)) ogrenim.push("Lisansüstü");

  /* --- kontenjan ------------------------------------------------------- */
  let kontenjan = null;
  const k1 = basligi.match(/\b(\d{1,4})\s*(?:adet|kişi|sözleşmeli\s*personel|sözleşmeli|personel|memur|hemşire|işçi|öğretmen|uzman|müfettiş|denetmen|denetçi|teknisyen|tekniker|destek|memo|er\b)/i)
    || govde.match(/\b(\d{1,4})\s*(?:adet|kişi)\s*(?:personel|memur|işçi|hemşire|sözleşmeli|uzman|teknisyen|tekniker|müfettiş|denetmen)/i)
    || govde.match(/toplam\s*(?:kadro\s*sayısı\s*)?(\d{1,4})\s*(?:adet|kişi|personel|kadro)?/i);
  kontenjan = parseInt(k1 && k1[1], 10) || null;
  if (kontenjan !== null && (kontenjan > 30000 || kontenjan < 1)) kontenjan = null;

  /* --- il -------------------------------------------------------------- */
  const iller = illeriBul(govdeKaynak).concat(illeriBul(basligi).filter((x) => !illeriBul(govdeKaynak).includes(x)));

  /* --- kurum / unvan / yöntem / kaynak --------------------------------- */
  const kurumMu = (s) => !!s && !/Yazdır|Yorumlar|Abone|Kaynak|İlan\s*Giriş|Güncelleme|Ana\s*sayfa|Son\s*Dakika/i.test(s) && s.length > 5;
  let kurum = ((ld && ld.hiringOrganization && !/memurlar/i.test(ld.hiringOrganization.name || "") && ld.hiringOrganization.name) || "").trim() || null;
  for (const kaynakMetin of [ozetSatir, baslik, govdeKaynak]) {
    if (kurumMu(kurum)) break;
    kurum = ((kaynakMetin || "").match(KURUM_DESEN) || [])[1]?.replace(/\s+/g, " ").trim() || null;
  }
  if (!kurumMu(kurum)) kurum = null;

  const unvanlar = new Set();
  for (const m of (baslik + " " + govde).matchAll(UNVANLAR)) unvanlar.add(m[1].replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

  const yontem = /kariyer\s+kapısı|turkiye\.gov\.tr|e-?devlet/.test(kucuk) ? "e-Devlet / Kariyer Kapısı"
    : /şahsen|elden\s+başvuru/.test(kucuk) ? "Şahsen / elden"
    : /iadeli\s+taahhütlü|posta\s+ile|postaya|kargo/.test(kucuk) ? "Posta ile"
    : /elektronik\s+ortam|online|internet\s+üzerinden|başvuru\s+linki|web\s+site/.test(kucuk) ? "Online"
    : /işkur|iskur/.test(kucuk) ? "İŞKUR"
    : null;

  const kaynak = (temiz(html).match(/Kaynak\s*:\s*([\wçğıöşüÇĞİÖŞÜ\s.]{3,30}?)(?:İlan\s*Giriş|Yazdır|Yorumlar|Abone)/) || [])[1]?.trim() || null;

  return {
    sonBasvuru, baslangic,
    puanTurleri: [...turler].slice(0, 6),
    minPuan,
    kpssSartli: turler.size > 0 || /\bkpss\b/i.test(govde),
    ogrenim: ogrenim.length ? [...new Set(ogrenim)] : ["Belirtilmemiş"],
    kontenjan, iller: [...new Set(iller)].slice(0, 5), kurum,
    unvanlar: [...unvanlar].slice(0, 6), yontem, kaynak,
    ozet: (ozetSatir || govdeKaynak).slice(0, 500),
    govdeMetni: (govdeKaynak || ozetSatir).slice(0, 2200),
  };
}

/* ------------------------------------------------------- işçi sürücüsü ----- */
function isci(gorevler, butceMs) {
  const bas = Date.now();
  const eksik = gorevler.filter((u) => !onbekTaze(u)); // taze önbellek süreç açmaz
  for (let i = 0; i < eksik.length; i += 2) {
    if (Date.now() - bas > butceMs) return false;
    try {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), "kaz", ...eksik.slice(i, i + 2)], {
        encoding: "utf8", timeout: 40000, maxBuffer: 20 * 1024 * 1024,
      });
    } catch { /* sessiz geç; sonraki tur tekrar dener */ }
  }
  return true;
}

async function onekOku(url) {
  const dosya = path.join(ONEK, ad(url));
  if (!existsSync(dosya)) return null;
  try { return JSON.parse(await readFile(dosya, "utf8")).html; } catch { return null; }
}

/* Aynı ilanın iki kaynakta açılan kopyalarını kapatır.
   parmakIzi() kurum + ünvan + sayı üzerinden çalıştığı için eşleşme güçlüdür,
   ama ilan tahtalarında aynı kurumun aynı sayıda personeli AYNI AY içinde iki
   kez aradığı da oluyor; bu yüzden başvuru tarihinin de yakın olması istenir.
   Kalan kayıt "en dolu" olandır: detayı okunmuş, kurumu ve ilanı bilinen.   */
function mukerrerleriAyikla(kayitlar) {
  const esik = new Date(Date.parse(bugunTR() + "T00:00:00Z") - 120 * 864e5).toISOString().slice(0, 10);
  const gruplar = new Map();
  for (const [id, k] of Object.entries(kayitlar)) {
    if ((k.tarih || "0000") < esik) continue;
    const p = parmakIzi(k);
    if (!p) continue;
    if (!gruplar.has(p)) gruplar.set(p, []);
    gruplar.get(p).push([id, k]);
  }
  const doluluk = (k) =>
    (k.detayVar ? 4 : 0) + (String(k.id).match(/^\d+$/) ? 2 : 0) +   // memurlar.net sayfası en dolu kaynaktır
    (k.sonBasvuru ? 1 : 0) + (k.kurum ? 1 : 0) + ((k.iller || []).length ? 1 : 0) + ((k.puanTurleri || []).length ? 1 : 0);
  let kaldirilan = 0;
  for (const grup of gruplar.values()) {
    if (grup.length < 2) continue;
    grup.sort((a, b) => doluluk(b[1]) - doluluk(a[1]));
    const [, bir] = grup[0];
    for (const [id, k] of grup.slice(1)) {
      /* Tek başına parmak izi yetmez: aynı kurum aynı sayıda kişiyi aynı hafta
         İKİ farklı kadro için arıyor olabilir. Kayıtların aynı ilan olduguna
         hükmetmek için basvuru tarihinin de (yoksa yayim tarihinin) ayni
         olması — en fazla bir gün farkla — aranır.                     */
      const gunFarki = (a, b) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) : Infinity);
      const tarihYakin = gunFarki(bir.sonBasvuru, k.sonBasvuru) <= 864e5 || gunFarki(bir.tarih, k.tarih) <= 864e5;
      if (!tarihYakin) continue;
      if (!bir.kurum && k.kurum) bir.kurum = k.kurum;
      if (!bir.sonBasvuru && k.sonBasvuru) bir.sonBasvuru = k.sonBasvuru;
      if (!bir.kontenjan && k.kontenjan) bir.kontenjan = k.kontenjan;
      if (!bir.ozetUrl && k.ozetUrl) bir.ozetUrl = k.ozetUrl;
      if (!bir.yayinda && k.yayinda) bir.yayinda = true;
      delete kayitlar[id];
      kaldirilan++;
    }
  }
  return kaldirilan;
}

/* ------------------------------------------------- sonuç dosyalarını yaz ---- */
/* kaynak etiketini tek biçime getir (kaynak metninde "işkur" / "İşkur" karışık geçiyor) */
function kaynakce(k) {
  if (!k) return null;
  const es = { "işkur": "İŞKUR", "kamuilan": "Kamu İlanları", "kamu ilanları": "Kamu İlanları", "resmi gazete": "Resmî Gazete", "yerel yönetimler": "Yerel Yönetimler" };
  const t = k.trim().toLocaleLowerCase("tr");
  return es[t] || k.trim();
}

/* ---------------------------------------------------- KPSS puan türü sınıflandırması
   Kullanıcı süzgeci yalnızca üç türü gösterir (ÖSYM'nin resmî eşlemesi):
     P3  = lisans KPSS  ·  P93 = ön lisans KPSS  ·  P94 = ortaöğretim KPSS
   Bu üçünün dışında kalan (öğretmen P10/P121, din hizmetleri P121/P122,
   kendi giriş sınavlı / sadece sözlü / KPSS şartı olmayan) ilanlar
   "KPSS dışı" listesine düşer.                                            */
const UC_TUR = ["P3", "P93", "P94"];
function turBul(govde) {
  const t = new Set();
  if (!govde) return t;
  for (const m of govde.matchAll(/KPSS[\s\S]{0,120}?\bP\s?0?(\d{1,3})\b/gi)) t.add("P" + +m[1]);
  for (const m of govde.matchAll(/\bP\s?0?(\d{1,3})\b[^.\n]{0,45}?puan\s*t[üu]r[üu]/gi)) t.add("P" + +m[1]);
  for (const m of govde.matchAll(/puan\s*t[üu]r[üu][^.\n]{0,55}?\bP\s?0?(\d{1,3})\b/gi)) t.add("P" + +m[1]);
  return t;
}
function puanSinifi(i, govde) {
  const metin = [govde, i.govdeMetni, i.ozet, i.baslik].filter(Boolean).join(" ");
  const hepsi = [...turBul(metin), ...(i.puanTurleri || []).map((x) => "P" + +String(x).replace(/\D/g, ""))]
    .filter((x) => /^P\d{1,3}$/.test(x));
  const uc = [...new Set(hepsi.filter((x) => UC_TUR.includes(x)))];
  if (uc.length) return { puanSinifi: "kpssli", puanTurleriUC: uc.sort((a, b) => a.length - b.length), kpssTuruBiliniyor: true };
  // ilanda açıkça başka bir puan türü yazıyorsa (P10, P43, P121 …) tahmin YAPILMAZ → KPSS dışı
  if (hepsi.length) return { puanSinifi: "kpss-disi", puanTurleriUC: [], kpssTuruBiliniyor: false };
  const metinKpss = /\bkpss\b/i.test(metin);
  if (!metinKpss && !i.kpssSartli) return { puanSinifi: "kpss-disi", puanTurleriUC: [], kpssTuruBiliniyor: false };
  // KPSS şartı var ama türü yazmıyor: öğrenim durumundan yorulabilir (P3=lisans, P93=ön lisans, P94=ortaöğretim)
  const o = i.ogrenim || [];
  const y = [];
  if (o.includes("Lisans") && !o.includes("Lisansüstü")) y.push("P3");
  if (o.includes("Ön lisans")) y.push("P93");
  if (o.includes("Ortaöğretim")) y.push("P94");
  if (y.length) return { puanSinifi: "kpssli", puanTurleriUC: y, kpssTuruBiliniyor: false };
  return { puanSinifi: "kpss-disi", puanTurleriUC: [], kpssTuruBiliniyor: false };
}

async function yaz(kayitlar) {
  const bugun = bugunTR(); // Türkiye takvimi (bulut UTC'de çalışsa da doğru)
  const liste = Object.values(kayitlar).map((i) => {
    const gecti = i.sonBasvuru ? i.sonBasvuru < bugun : null;
    const sinif = puanSinifi(i, i.govdeMetni);
    return {
      ...i,
      kaynak: kaynakce(i.kaynak),
      durum: i.iptal ? "kapandi" : gecti === null ? "belirsiz" : gecti ? "kapandi" : "acik",
      // "P03" gibi yazımları tek biçime indir: P3
      puanTurleri: [...new Set((i.puanTurleri || [])
        .map((t) => "P" + parseInt(String(t).replace(/\D/g, ""), 10))
        .filter((t) => /^P\d{1,3}$/.test(t) && +t.slice(1) > 0))],
      puanSinifi: sinif.puanSinifi,
      puanTurleriUC: sinif.puanTurleriUC,
      kpssTuruBiliniyor: sinif.kpssTuruBiliniyor,
      kalanGun: i.sonBasvuru ? Math.round((new Date(i.sonBasvuru) - new Date(bugun)) / 864e5) : null,
      arama: [i.baslik, i.kurum, (i.unvanlar || []).join(" "), (i.iller || []).join(" "), i.kategori, (i.puanTurleri || []).join(" "), (i.ogrenim || []).join(" "), (i.puanTurleriUC || []).join(" ")]
        .filter(Boolean).join(" ").toLocaleLowerCase("tr"),
    };
  }).map((i) => ({ ...i, arama: i.arama + " " + (i.puanSinifi === "kpss-disi" ? "kpss dışı kpss'siz" : "kpssli") }))
    .sort((a, b) => (b.tarih || "").localeCompare(a.tarih || ""));

  // kurum + puan türü bazlı taban puan karnesi (yıllar içinde birikir)
  const karne = {};
  for (const i of liste) {
    if (!i.minPuan || i.puanSinifi !== "kpssli") continue;
    const yil = (i.tarih || "").slice(0, 4);
    for (const tur of (i.puanTurleriUC && i.puanTurleriUC.length ? i.puanTurleriUC : ["P?"])) {
      const a = `${yil}|${i.kurum || "Genel"}|${tur}`;
      karne[a] = karne[a]
        ? { ...karne[a], ust: Math.max(karne[a].ust, i.minPuan), ilan: karne[a].ilan + 1 }
        : { yil, kurum: i.kurum || "Genel", puanTuru: tur, min: i.minPuan, ust: i.minPuan, ilan: 1, ogrenim: (i.ogrenim || [])[0] || null };
    }
  }

  const ozet = {
    guncelleme: new Date().toISOString(),
    /* Türkiye saatiyle yaz: bulut sunucusu UTC'de çalışıyor, yoksa sitedeki
       "veri tarihi" 3 saat geride görünürdü. */
    guncellemeYazi: new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }),
    toplam: liste.length,
    acik: liste.filter((i) => i.durum === "acik").length,
    ortaogretim: liste.filter((i) => (i.ogrenim || []).includes("Ortaöğretim")).length,
    onlisans: liste.filter((i) => (i.ogrenim || []).includes("Ön lisans")).length,
    kadro: liste.reduce((t, i) => t + ((i.kontenjan || 0) < 20000 ? (i.kontenjan || 0) : 0), 0),
    kpssli: liste.filter((i) => i.puanSinifi === "kpssli").length,
    kpssDisi: liste.filter((i) => i.puanSinifi === "kpss-disi").length,
    turSayilari: { P3: liste.filter((i) => (i.puanTurleriUC || []).includes("P3")).length, P93: liste.filter((i) => (i.puanTurleriUC || []).includes("P93")).length, P94: liste.filter((i) => (i.puanTurleriUC || []).includes("P94")).length },
    kaynak: "memurlar.net · kamuilan.sbb.gov.tr · yerelyonetimler.csb.gov.tr",
  };

  await mkdir(VERI, { recursive: true });
  await writeFile(path.join(VERI, "ilanlar.json"), JSON.stringify(liste, null, 1), "utf8");
  await writeFile(path.join(VERI, "puan-karnesi.json"), JSON.stringify(Object.values(karne).sort((a, b) => b.min - a.min), null, 1), "utf8");
  await writeFile(path.join(VERI, "ozet.json"), JSON.stringify(ozet, null, 1), "utf8");
  // veriyi index.html içine de göm: site çift tıklayla da açılabilsin
  // (bulut çalışmasında index.html yoktur: KPSS_PAKETLE=0 ile atlanır)
  if (process.env.KPSS_PAKETLE !== "0") try {
    execFileSync(process.execPath, [path.join(BURADAN, "paketle.mjs")], { encoding: "utf8", timeout: 30000 });
  } catch { console.log("  (index.html paketlenemedi — elle: node paketle.mjs)"); }
  return {
    liste, acik: ozet.acik, ortaogretim: ozet.ortaogretim,
    puanli: liste.filter((i) => i.minPuan).length,
    puanTuru: liste.filter((i) => (i.puanTurleri || []).length).length,
    tarih: liste.filter((i) => i.sonBasvuru).length,
    kurum: liste.filter((i) => i.kurum).length,
    il: liste.filter((i) => (i.iller || []).length).length,
    bekleyen: liste.filter((i) => !i.detayVar).length,
  };
}

/* ------------------------------------------------- ortak: kayıtları yükle --- */
async function kayitlariYukle() {
  const yol = path.join(VERI, "ilanlar.json");
  if (!existsSync(yol)) return {};
  return Object.fromEntries(JSON.parse(await readFile(yol, "utf8")).map((i) => [i.id, i]));
}

/* -------------------------------------------------- mod: isle (çevrimdışı) -- */
async function isle() {
  const kayitlar = await kayitlariYukle();
  if (!Object.keys(kayitlar).length) return console.log("Kayıt yok. Önce: node scraper.mjs");
  const sinir = parseInt(process.env.SINIR || "0", 10);
  const hedefler = Object.values(kayitlar).filter((i) => !i.detayVar);
  let islenen = 0;
  for (const il of hedefler) {
    if (sinir && islenen >= sinir) break;
    const html = await onekOku(il.url);
    if (!html) continue;
    const t = Date.now();
    Object.assign(il, detayiOku(html, il.baslik));
    const sure = Date.now() - t;
    if (sure > 1500) console.log(`  yavaş: ${sure}ms  ${il.id} ${(il.baslik || "").slice(0, 40)}`);
    il.detayVar = true;
    islenen++;
  }
  const s = await yaz(kayitlar);
  console.log(`  Ayrıştırıldı ${islenen}  |  toplam ${s.liste.length}  kurum ${s.kurum}  il ${s.il}  sonbaşvuru ${s.tarih}  puan ${s.puanli}  puantürü ${s.puanTuru}  bekleyen ${s.bekleyen}`);
}

/* --------------------------------------------------------- liste → kayıt --- */
/* Bir liste sayfasının içeriğini kayıtlara ekler. Aynı ilan birkaç listede
   geçerse tek kayıt kalır ve süresi GEÇMEMİŞ listede görüldüyse "yayinda"
   işareti korunur. (Süresi geçen listede görünmesi tek başına "yayından
   kalktı" demek değildir: aynı ilan başka kategorinin canlı listesinde
   duruyor olabilir; bu yüzden yayinda bayrağı burada ASLA false yapılmaz —
   kapanış kararı son başvuru tarihine göre yaz() içinde verilir.)
   Dönen değer: yeni kayıt sayısı.                                          */
function listelerdenYukle(kayitlar, html, kategori, { gecen = false, gecenAlinsin = false } = {}) {
  let yeni = 0;
  for (const il of listeyiOku(html, kategori)) {
    const eski = kayitlar[il.id];
    if (eski) { if (!gecen) eski.yayinda = true; continue; }
    if (gecen && !gecenAlinsin) continue; // ilk seferde süresi geçmiş ilanlar alınmaz
    kayitlar[il.id] = { ...il, yayinda: !gecen, detayVar: false, eklendi: bugunTR() };
    yeni++;
  }
  return yeni;
}

/* -------------------------------------------------------- mod: liste ------- */
async function sadeceListe() {
  await mkdir(ONEK, { recursive: true });
  const bitti = isci(listeAdresleri(), 95000);
  console.log("Listeler: " + (bitti ? "tamam" : "kısmi — tekrar çalıştır"));
}

/* --------------------------------------------- ek kaynakların birleştirilmesi */
/* EK_KAYNAKLAR ve tazelik yardımcıları dosyanın başında tanımlı.            */

async function ekKaynaklariBirlestir(kayitlar, { indir = false, butce = 0 } = {}) {
  const Y = { temiz, tarih, illeriBul, ogrenimBul, UNVANLAR };
  const bas = Date.now();
  const kalan = () => Math.max(0, butce - (Date.now() - bas));
  if (indir && kalan() > 5000) isci([EK_KAYNAKLAR.sbb, EK_KAYNAKLAR.csb], kalan());

  /* CSB duyuru listesi sayfalıdır: /duyurular, /duyurular/2, /duyurular/3 …
     Sayfa sayısı 1. sayfadaki bağlantılardan öğrenilir (en fazla 6 sayfa). */
  const csbSayfalari = [EK_KAYNAKLAR.csb];
  const csbIlk = await onekOku(EK_KAYNAKLAR.csb);
  if (csbIlk) {
    const n = Math.max(1, ...[...csbIlk.matchAll(/\/duyurular\/(\d+)/g)].map((m) => +m[1]));
    for (let s = 2; s <= Math.min(n, 6); s++) csbSayfalari.push(`${EK_KAYNAKLAR.csb}/${s}`);
  }
  if (indir && kalan() > 8000) isci(csbSayfalari.slice(1), Math.max(0, kalan() - 8000));

  const yeni = [];
  const sbbHtml = await onekOku(EK_KAYNAKLAR.sbb);
  if (sbbHtml) yeni.push(...sbbAyristir(sbbHtml, Y));
  let csbSayfaSayisi = 0;
  for (const u of csbSayfalari) {
    const h = await onekOku(u);
    if (!h) continue;
    csbSayfaSayisi++;
    yeni.push(...csbListeyiOku(h, Y));
  }

  // aynı ilanın iki kaynakta çıkma ihtimali: parmak izi eşleşirse mevcut kaydı zenginleştir
  // Yalnızca son ~120 günün kayıtları kullanılır: aynı kurum iki yıl üst üste
  // "50 işçi alımı" ilan ederse yeni ilan yıllar önceki KAPANDI kayıtla birleşmesin.
  const izler = new Map();
  const esikTarih = new Date(Date.parse(bugunTR() + "T00:00:00Z") - 120 * 864e5).toISOString().slice(0, 10);
  for (const k of Object.values(kayitlar)) {
    if ((k.tarih || "0000") < esikTarih) continue;
    const p = parmakIzi(k); if (p && !izler.has(p)) izler.set(p, k);
  }
  let eklenen = 0, birlesen = 0, tekrar = 0;
  const gorulenId = new Set();
  for (const y of yeni) {
    if (gorulenId.has(y.id)) { tekrar++; continue; } // aynı duyuru birden fazla listede geçebilir
    gorulenId.add(y.id);
    const p = parmakIzi(y);
    const es = p ? izler.get(p) : null;
    if (es) {
      if (!es.sonBasvuru && y.sonBasvuru) { es.sonBasvuru = y.sonBasvuru; es.baslangic = es.baslangic || y.baslangic; }
      es.ekKaynak = { ad: y.kaynak, url: y.url };
      birlesen++;
    } else if (kayitlar[y.id]) {
      /* kayıt zaten var: detaydan çıkarılmış alanları (puan, öğrenim, gövde
         metni…) ezme; yalnızca değişebilen bilgileri tazele. */
      const m = kayitlar[y.id];
      m.baslik = y.baslik; m.ozet = y.ozet;
      m.yayinda = y.yayinda; if ("iptal" in y) m.iptal = y.iptal;
      m.basvuruAraligi = y.basvuruAraligi || m.basvuruAraligi;
      if (y.sonBasvuru) { m.sonBasvuru = y.sonBasvuru; m.baslangic = y.baslangic || m.baslangic; }
      m.tarih = m.tarih || y.tarih;
      if (y.detayVar) m.detayVar = true;
    } else {
      kayitlar[y.id] = y;
      if (p && !izler.has(p)) izler.set(p, y);
      eklenen++;
    }
  }
  /* Eski turlardan biriken mükerrer SBB kayıtları: SBB bağlantı kodlarını her
     çekilişte değiştirdiği için aynı ilanın eski kimlikleri dosyada kalıyordu.
     Bugünkü listeyle aynı içerikse eski kayıt silinir (yeni tek kayıt kalır). */
  const icerikAnahtari = (k) => ((k.kurum || "") + "|" + (k.baslik || "")).toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
  const bugunkuSbb = new Set(yeni.filter((y) => y.kategoriSlug === "kamuilan-sbb").map(icerikAnahtari));
  let silinen = 0;
  for (const [id, k] of Object.entries(kayitlar)) {
    if (k.kategoriSlug !== "kamuilan-sbb") continue;
    if (bugunkuSbb.has(icerikAnahtari(k)) && !yeni.some((y) => y.id === id)) { delete kayitlar[id]; silinen++; }
  }
  return { sbb: !!sbbHtml, csb: csbSayfaSayisi > 0, csbSayfa: csbSayfaSayisi, eklenen, birlesen, tekrar, silinen };
}

/* ------------------------------------- derleyici (aggregator) kaynaklar ---- */
/* kadroatlasi / kariyerbankasi / kamumemuralimi / kamualimlari / memurjet.
   Bu siteler Resmî Gazete, Kariyer Kapısı ve İŞKUR ilanlarını derliyor; kendi
   kayıtları yok ama METİNLERİ ulaşılabilir. Aynı ilan memurlar.net'te de varsa
   yeni kayıt açılmaz, mevcut kayıt tamamlanır (parmak izi eşleşmesiyle).     */
async function yeniKaynaklariBirlestir(kayitlar, { indir = false, butce = 0 } = {}) {
  const Y = { temiz, tarih, illeriBul, ogrenimBul, ogrenimBulKisa: ogrenimBul, UNVANLAR, KURUM_DESEN, bugun: () => bugunTR() };
  const adresler = yeniKaynakAdresleri();
  if (indir && butce > 8000) isci(adresler, Math.max(0, butce - 5000));

  const icerikler = {};
  for (const u of adresler) { const h = await onekOku(u); if (h) icerikler[u] = h; }

  // aynı ilanın memurlar.net/SBB kaydısıyla çakışmaması için parmak izi haritası
  const esikTarih = new Date(Date.parse(bugunTR() + "T00:00:00Z") - 120 * 864e5).toISOString().slice(0, 10);
  const izler = new Map();
  for (const k of Object.values(kayitlar)) {
    if ((k.tarih || "0000") < esikTarih) continue;
    const p = parmakIzi(k); if (p && !izler.has(p)) izler.set(p, k);
  }

  let eklenen = 0, birlesen = 0, okunanKaynak = 0;
  const kaynakDurum = [];
  for (const k of YENI_KAYNAKLAR) {
    let yeni = [];
    try { yeni = kaynaklariOku(k, icerikler, Y); } catch (h) { console.log("  ! " + k.ad + ": " + h.message); }
    if (yeni.length) okunanKaynak++;
    let buKaynakYeni = 0;
    for (const y of yeni) {
      if (kayitYasliMi(y, bugunTR())) continue;          // ayılar öncesinin kapalı duyurusu
      const p = parmakIzi(y);
      const es = p ? izler.get(p) : null;
      if (es) {  // aynı ilan başka kaynakta zaten var: eksik alanları tamamla
        if (!es.sonBasvuru && y.sonBasvuru) { es.sonBasvuru = y.sonBasvuru; es.baslangic = es.baslangic || y.baslangic; }
        if (!es.kontenjan && y.kontenjan) es.kontenjan = y.kontenjan;
        if (!es.iller.length && y.iller.length) es.iller = y.iller;
        if (!es.unvanlar.length && y.unvanlar.length) es.unvanlar = y.unvanlar;
        if (!es.ogrenim.length && y.ogrenim.length) es.ogrenim = y.ogrenim;
        birlesen++;
        continue;
      }
      if (kayitlar[y.id]) {
        const m = kayitlar[y.id];
        m.baslik = y.baslik; m.ozet = y.ozet;
        if (y.sonBasvuru) { m.sonBasvuru = y.sonBasvuru; m.baslangic = y.baslangic || m.baslangic; }
        if (y.kontenjan) m.kontenjan = y.kontenjan;
        continue;
      }
      kayitlar[y.id] = y;
      if (p && !izler.has(p)) izler.set(p, y);
      eklenen++; buKaynakYeni++;
    }
    kaynakDurum.push(k.ad + " " + buKaynakYeni);
  }

  /* Düz HTML kaynaklarda (kamualimlari, memurjet) liste yalnızca başlık veriyor;
     son başvuru, puan türü ve kurum ilan SAYFASINDA. Bütçe yettiğince okunur. */
  let detayIslenen = 0;
  if (indir) {
    const istenen = [];
    for (const k of YENI_KAYNAKLAR.filter((x) => x.tur === "kart")) {
      const kendi = Object.values(kayitlar).filter((x) => x.kategoriSlug === k.slug);
      for (const r of kartDetayAdresleri(kendi, 12)) istenen.push({ id: r.id, url: r.url, slug: k.slug });
    }
    if (istenen.length) {
      const b = Math.max(0, butce - 6000);
      if (b > 8000) {
        isci(istenen.map((x) => x.url), b);
        const kayitEki = Object.fromEntries(Object.entries(kayitlar).flatMap(([id, k]) => (k.detayIstenen ? [[id, k]] : [])));
        for (const { id, url, slug } of istenen) {
          const kayit = kayitEki[id]; if (!kayit) continue;
          const html = await onekOku(url); if (!html) continue;
          const k = YENI_KAYNAKLAR.find((x) => x.slug === slug);
          try { if (kartDetayUygula(kayit, html, k, Y)) detayIslenen++; } catch { /* bozuk sayfa: başlıksız bırak */ }
        }
      }
    }
  }

  /* Süresi dolmuş derleme kayıtları listeyi şişirmesin (kural yeni-kaynaklar.mjs'te). */
  const yeniSluglar = new Set(YENI_KAYNAKLAR.map((x) => x.slug));
  let elenen = 0;
  for (const [id, k] of Object.entries(kayitlar)) {
    if (!k.kategoriSlug || !yeniSluglar.has(k.kategoriSlug)) continue;
    if (k.sonBasvuru && k.sonBasvuru < bugunTR()) k.yayinda = false;
    if (kayitYasliMi(k, bugunTR())) { delete kayitlar[id]; elenen++; }
  }
  return { eklenen, birlesen, elenen, detayIslenen, okunanKaynak, kaynakDurum };
}

/* günlüğe satır ekle: süreç beklenmedik biçimde kapanırsa iz kalması için */
async function izMesaji(s) {
  try {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path.join(BURADAN, "guncelleme-loğu.txt"), `${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}  ${s}\n`, "utf8");
  } catch { /* log yazılamazsa sorun değil */ }
}

/* ------------------------------------------------------------ ANA ---------- */
/* Çalışma kilidi: zamanlayıcı her dakika çalıştığı için, bir tarama uzun
   sürerse ikinci bir tarama aynı dosyalarla uğraşmasın (yarım yazma riski). */
const KILIT = path.join(ONEK, "_calisiyor");
async function kilitAl() {
  const { stat, writeFile: yz } = await import("node:fs/promises");
  const s = await stat(KILIT).catch(() => null);
  if (s && Date.now() - s.mtimeMs < 15 * 60 * 1000) return false;
  try { await yz(KILIT, new Date().toISOString(), "utf8"); } catch { /* okunamazsa devam */ }
  return true;
}
async function kilidiBirak() {
  try { rmSync(KILIT, { force: true }); } catch { } // senkron: çıkışta da çalışır
}

async function ana() {
  const t0 = Date.now();
  /* Tur başına zaman bütçesi: yerelde eskisi gibi 100 saniye.
     Bulutta BUTCE_SN=600 gibi bir değerle genişletilebilir. */
  const BUTCE = Math.max(30, +(process.env.BUTCE_SN || 100)) * 1000;
  const kalanZaman = () => BUTCE - (Date.now() - t0);
  console.log("\n  KPSS İLAN AJANI — güncelleme  (" + new Date().toLocaleString("tr-TR") + ")\n");
  await mkdir(ONEK, { recursive: true });
  await mkdir(VERI, { recursive: true });
  if (!(await kilitAl())) { console.log("  Başka bir tarama hâlâ sürüyor; bu tur atlandı."); return; }
  process.on("exit", kilidiBirak);
  // 1) kategori listeleri + ana sayfa
  const bit1 = isci(listeAdresleri(), kalanZaman());
  console.log("  1/5  Liste sayfaları: " + (bit1 ? "tamam" : "kısmi"));

  // 2) listeleri ayrıştır
  const kayitlar = await kayitlariYukle();
  const once = Object.keys(kayitlar).length;
  for (const k of KATEGORILER) {
    for (const e of ["false", "true"]) {
      const html = await onekOku(kategoriUrl(k, e));
      if (html) listelerdenYukle(kayitlar, html, k, { gecen: e === "true" });
    }
  }
  const anaHtml = await onekOku(ANA_SAYFA);
  if (anaHtml) listelerdenYukle(kayitlar, anaHtml, { slug: "gundem", ad: "Gündemdeki İlanlar" }, { gecen: false });
  console.log("  2/5  Kayıt sayısı: " + Object.keys(kayitlar).length + " (önceki " + once + ")");
  await izMesaji(`liste ayrıştırıldı: ${Object.keys(kayitlar).length} kayıt`);
  await yaz(kayitlar); // yeni ilanları hemen diske yaz: süreç yarım kalsa bile liste kaybolmaz

  // 3) ek kaynaklar: Kamu İlanları (SBB) ve Yerel Yönetimler (CSB)
  const ek = await ekKaynaklariBirlestir(kayitlar, { indir: true, butce: Math.max(0, kalanZaman() - 25000) });
  console.log("  3/5  Ek kaynaklar: Kamu İlanları " + (ek.sbb ? "okundu" : "alınamadı") + ", Yerel Yönetimler " + (ek.csb ? ek.csbSayfa + " sayfa okundu" : "alınamadı") +
    " → " + ek.eklenen + " yeni, " + ek.birlesen + " birleşti" + (ek.silinen ? ", " + ek.silinen + " mükerrer temizlendi" : ""));
  await yaz(kayitlar);

  // 4) derleyici kaynaklar (Kadro Atlası, Kariyer Bankası, Kamu Memur Alımı, …)
  const yn = await yeniKaynaklariBirlestir(kayitlar, { indir: true, butce: Math.max(0, kalanZaman() - 25000) });
  console.log("  4/5  Derleyici kaynaklar: " + yn.okunanKaynak + "/" + YENI_KAYNAKLAR.length + " okundu → " +
    yn.eklenen + " yeni, " + yn.birlesen + " mevcut ilanla birleşti" +
    (yn.detayIslenen ? ", " + yn.detayIslenen + " ilan sayfası işlendi" : "") +
    (yn.elenen ? ", süresi geçmiş " + yn.elenen + " kayıt atıldı" : "") +
    "  (" + yn.kaynakDurum.join(", ") + ")");
  await yaz(kayitlar);

  // 5) ilan detayları (memurlar.net sayfaları + yerel yönetim duyuru metinleri)
  const eksik = Object.values(kayitlar).filter((i) => !i.detayVar).map((i) => i.url);
  const bit2 = isci(eksik, Math.max(0, kalanZaman()));
  await izMesaji(`detay indirmesi: ${bit2 ? "tamam" : "kısmi"} (${eksik.length} aday)`);

  // 5) ayrıştır + yaz
  for (const il of Object.values(kayitlar)) {
    if (il.detayVar) continue;
    const html = await onekOku(il.url);
    if (!html) continue;
    const etiket = il.kaynak, kategori = il.kategori;
    Object.assign(il, detayiOku(html, il.baslik));
    if (etiket) il.kaynak = etiket;      // ek kaynak kayıtlarının etiketi ezilmesin
    if (kategori) il.kategori = kategori;
    il.detayVar = true;
  }
  // 6) aynı ilanın farklı kaynaklardaki kopyalarını detaylar okunduktan sonra ayıkla
  const ayiklanan = mukerrerleriAyikla(kayitlar);
  if (ayiklanan) console.log("  •   Mükerrer kaynak kayıtları: " + ayiklanan + " kopya kaldırıldı");

  const s = await yaz(kayitlar);

  // guncelleme.bat bu dosyanın var/yok oluşuna bakarak tekrarlama kararı verir
  const bayrak = path.join(ONEK, "_devam");
  if (!bit1 || !bit2 || s.bekleyen) await writeFile(bayrak, new Date().toISOString(), "utf8");
  else { try { const { rm } = await import("node:fs/promises"); await rm(bayrak, { force: true }); } catch {} }

  console.log(`\n  TAMAM (${((Date.now() - t0) / 1000).toFixed(0)} sn) — ${s.liste.length} kayıt | açık ${s.acik} | kurum ${s.kurum} | il ${s.il} | son başvuru ${s.tarih} | puan ${s.puanli} | puan türü ${s.puanTuru}`);
  if (!bit1 || !bit2 || s.bekleyen) console.log("  İşlem tam bitmedi → aynı komutu tekrar çalıştır, kaldığı yerden devam eder.");
  console.log("  Çıktı: site/veriler/ilanlar.json\n");
}

/* mod: sifirla — ayrıştırma bayraklarını sıfırlar (yeni ayrıştırıcıyı test için) */
async function sifirla() {
  const kayitlar = await kayitlariYukle();
  Object.values(kayitlar).forEach((i) => { i.detayVar = false; });
  await mkdir(VERI, { recursive: true });
  await writeFile(path.join(VERI, "ilanlar.json"), JSON.stringify(Object.values(kayitlar), null, 1), "utf8");
  console.log(Object.keys(kayitlar).length + " kayıt sıfırlandı → şimdi: node scraper.mjs isle");
}

/* ------------------------------------------- mod: kur (çevrimdışı kurulum) -- */
/* Ağa çıkmaz: önbellekteki kategori listelerinden kayıtları üretir,
   önbellekteki detay sayfalarından alanları ayrıştırır, dosyaları yazar.   */
async function kur() {
  const kayitlar = {};
  for (const k of KATEGORILER) {
    for (const e of ["false", "true"]) {
      const html = await onekOku(kategoriUrl(k, e));
      if (html) listelerdenYukle(kayitlar, html, k, { gecen: e === "true", gecenAlinsin: true });
    }
  }
  const anaHtml = await onekOku(ANA_SAYFA);
  if (anaHtml) listelerdenYukle(kayitlar, anaHtml, { slug: "gundem", ad: "Gündemdeki İlanlar" });
  let islenen = 0;
  await ekKaynaklariBirlestir(kayitlar);
  await yeniKaynaklariBirlestir(kayitlar);   // önbellekteki derleyici çıktılarından
  for (const il of Object.values(kayitlar)) {
    if (il.detayVar) continue;
    const html = await onekOku(il.url);
    if (!html) continue;
    const etiket = il.kaynak, kategori = il.kategori;
    Object.assign(il, detayiOku(html, il.baslik));
    if (etiket) il.kaynak = etiket;
    if (kategori) il.kategori = kategori;
    il.detayVar = true;
    islenen++;
  }
  // detayı olmayan arşiv kayıtlarını at: boş satırdan iyidir hiç satır olmaması
  for (const [id, i] of Object.entries(kayitlar)) if (!i.detayVar && !i.yayinda && !String(i.id).startsWith("csb-")) delete kayitlar[id];
  mukerrerleriAyikla(kayitlar);
  const s = await yaz(kayitlar);
  console.log(`  Önblekten kuruldu: ${s.liste.length} kayıt (${islenen} detay) | acik ${s.acik} | kurum ${s.kurum} | il ${s.il} | sonbaşvuru ${s.tarih} | puan ${s.puanli}`);
}

const secim = { isle, kur, liste: sadeceListe, sifirla }[MOD] || ana;
secim().catch((h) => { console.error("HATA:", h && h.message ? h.message : h); process.exit(1); });
