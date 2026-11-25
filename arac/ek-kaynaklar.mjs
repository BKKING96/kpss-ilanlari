/*  ===================================================================
 *  ek-kaynaklar.mjs — Kamu İlanları (SBB) ve Yerel Yönetimler (CSB) toplayıcıları
 *  -------------------------------------------------------------------
 *  scraper.mjs bu modülü kullanır; yardımcılar (tarih, il bulma ...) dışarıdan
 *  verilir ki dönen içe-aktarım (circular import) oluşmasın.
 *
 *  Kaynak durumları (19 Kasım 2026'da yeniden yoklandı):
 *   ✓ kamuilan.sbb.gov.tr          → statik HTML, 29 ilan bloğu, başvuru aralığı veriyor
 *   ✓ yerelyonetimler.csb.gov.tr   → statik HTML, belediye personel duyuruları + detay metni
 *   ✗ esube.iskur.gov.tr           → WAF: gerçek tarayıcı başlığıyla TLS sıfırlıyor,
 *                                    sahte/eski başlıkla "Request Rejected"
 *   ✗ ilan.gov.tr                  → TLS zinciri doğrulanamıyor (UNABLE_TO_VERIFY_LEAF_SIGNATURE)
 *   ✗ kariyerkapisi.gov.tr         → içerik kurum girişi sonrası; /ilanlar boş kabuk
 *   ✗ resmigazete.gov.tr ilan parçaları → .htm dosyaları Word dışa aktarımı, personel
 *                                         ilanı metni yapısal değil (ayrıştırılamıyor)
 *   ✗ osym.gov.tr                  → sınav/yerleştirme duyurusu, personel ilanı yok
 *  =================================================================== */

const AYLAR = { ocak:1, şubat:2, mart:3, nisan:4, mayıs:5, haziran:6, temmuz:7, ağustos:8, eylül:9, ekim:10, kasım:11, aralık:12 };

const basHarf = (s) => (s || "").toLocaleLowerCase("tr").split(/\s+/)
  .map((w) => (w ? w[0].toLocaleUpperCase("tr") + w.slice(1) : w)).join(" ").replace(/\s+/g, " ").trim();

/* "23 Kasım - 4 Aralık" / "1 Aralık - 7 Aralık" → {baslangic, sonBasvuru} (ISO) */
function aralik(data, bugun) {
  const bugunYil = +bugun.slice(0, 4);
  const ayGün = (yazi) => {
    const m = (yazi || "").trim().match(/(\d{1,2})\s*(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)/i);
    return m ? { gun: +m[1], ay: AYLAR[m[2].toLocaleLowerCase("tr")] } : null;
  };
  const parca = (data || "").split(/\s*[-–—]\s*/);   // tire, kısa çizgi, uzun çizgi
  const a = ayGün(parca[0]), b = ayGün(parca[1] || parca[0]);
  if (!a && !b) return { baslangic: null, sonBasvuru: null };
  const iso = (x, yil) => `${yil}-${String(x.ay).padStart(2, "0")}-${String(x.gun).padStart(2, "0")}`;
  let yil = bugunYil;
  const basIso = a ? iso(a, yil) : null;
  // başlangıç 40 günden eskiyse muhtemelen gelecek yılın ilanıdır
  if (basIso && basIso < yeniEksi(bugun, 40)) { yil = bugunYil + 1; }
  const baslangic = a ? iso(a, yil) : null;
  let son = b ? iso(b, yil) : null;
  if (son && baslangic && son < baslangic) son = iso(b, yil + 1);
  return { baslangic, sonBasvuru: son };
}
/* BUGÜN — Türkiye takvimi. new Date().toISOString() kullanılırsa bulut
   sunucusunda (UTC) gece 00:00-02:59 arasında dün görünür; ayrıca
   new Date(y,m,d).toISOString() Türkiye'de bir gün geri kayar.
   Bu yüzden tarihler saat diliminden bağımsız üretilir.               */
export function bugunTR(tarih = new Date()) {
  const p = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(tarih);
  const al = (t) => p.find((x) => x.type === t)?.value;
  return `${al("year")}-${al("month")}-${al("day")}`;
}
/* gün ekle/çıkar → ISO tarih (UTC üzerinde hesaplanır, kayma olmaz) */
function gunEkle(iso, gun) {
  const [y, a, g] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, a - 1, g) + gun * 864e5).toISOString().slice(0, 10);
}
function yeniEksi(iso, gun) { return gunEkle(iso, -gun); }

/* Başlıktan kontenjan sayısı: "22 ÖĞRETİM ELEMANI ALACAK" → 22.
   "657 sayılı … 10 personel alınacak" → 10 (657 atlanır).
   Kurallar: yalnız "alacak/alınacak" işaretinden ÖNCEKI sayılara bakılır
   (sondaki sayı kontenjandır); "sayılı" sözcüğüne bitişik sayılar, yıl
   görünümlü (1900-2100) sayılar ve yaş kısıtları atlanır. Bulunamazsa null —
   uydurulmaz.                                                              */
function kontenjanBul(yazi) {
  const t = (yazi || "").toLocaleLowerCase("tr");
  const isaret = t.search(/alacak|alınacak|alınacaktır|istihdam edilecek|temin edilecek|alımı/);
  if (isaret < 0) return null;
  const on = t.slice(0, isaret);
  const adaylar = [...on.matchAll(/\b(\d{1,4})\b(?!\s*(?:sayılı|sayili|yaş|yas|yıl|yil|gün|gun))/g)]
    .map((x) => +x[1])
    .filter((n) => n > 0 && !(n >= 1900 && n <= 2100) && n < 10000);
  return adaylar.length ? adaylar[adaylar.length - 1] : null;
}

/* ------------------------------------------------- Kamu İlanları (SBB) ----
   25 Kasım 2026'da site yapısı değişti; iki biçim birlikte desteklenir.
   YENİ (bugünkü sayfa):
     <a href='ilanDetay.aspx?kod=…' class='xx' target='_blank'>
       <div><img class='limg2' src='…'/>
         <p class='alt_p1'>KURUM</p>
         <p class='alt_p2'> 22 ÖĞRETİM ELEMANI ALACAK<em> ( 25 Kasım - 9 Aralık) </em></p>
       </div></a>
   ESKİ: sayfa içinde <span class=…>KURUM</span> … <span>UNVAN</span> bloğu.
   Değişiklikten sonra katı "span" deseni 116 ilanın yalnızca 27'sini
   görebiliyordu; aşağıdaki bağlantı-merkezli okuma 89 yeni biçimi de alır.  */
export function sbbAyristir(html, Y) {
  const bugun = bugunTR();
  const cikti = [];
  const gorulen = new Set();

  /* yayın tarihi: her ilan <li> içinde <time class='cbp_tmtime'><h4>24</h4><h3> Kasım</h3></time> */
  const zamanlar = [];
  for (const m of html.matchAll(/<time[^>]*class=['"][^'"]*cbp_tmtime[^'"]*['"][^>]*>\s*<h4>\s*(\d{1,2})\s*<\/h4>\s*<h3>\s*([^<]{3,20}?)\s*<\/h3>/gi)) {
    const gun = +m[1], ay = AYLAR[Y.temiz(m[2]).toLocaleLowerCase("tr")];
    if (!gun || !ay) continue;
    const yil = +bugun.slice(0, 4);
    let iso = `${yil}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}`;
    if (iso > gunEkle(bugun, 45)) iso = `${yil - 1}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}`; // yılbaşı geçişi
    zamanlar.push({ index: m.index, iso });
  }
  const tarihBul = (index) => {
    let son = null;
    for (const z of zamanlar) { if (z.index > index) break; son = z.iso; }
    return son;
  };

  const kaydet = ({ url, kurum, baslik, aralikYazi, tarihIso }) => {
    kurum = basHarf(Y.temiz(kurum || ""));
    baslik = Y.temiz(baslik || "");
    aralikYazi = Y.temiz(aralikYazi || "");
    if (!kurum || !baslik) return;
    const tam = "https://kamuilan.sbb.gov.tr/" + url.replace(/^\.?\//, "");
    if (baslik.includes(kurum.split(" ")[0]) === false) baslik = `${kurum} ${baslik}`;
    /* SBB aynı ilanı sayfada iki kez bağlıyor ve her bağlantının "kod" parametresi
       her çekilişte değişiyor. Kimlik bağlantıdan değil İÇERİKTEN üretilir:
       böylece mükerrer satırlar tek kayda iner ve turlar arasında çoğalmaz. */
    const icerik = (kurum + "|" + baslik + "|" + aralikYazi).toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
    if (gorulen.has(icerik)) return;
    gorulen.add(icerik);
    const { baslangic, sonBasvuru } = aralik(aralikYazi, bugun);
    const metin = kurum + " " + baslik;
    cikti.push({
      id: "sbb-" + hash(icerik),
      url: tam,
      baslik,
      tarih: tarihIso || bugun,
      kategori: "Kamu İlanları (SBB)",
      kategoriSlug: "kamuilan-sbb",
      yayinda: true,
      detayVar: true,               // detay PDF; ayrıştırılacak ek metin yok
      eklendi: bugun,
      baslangic, sonBasvuru,
      basvuruAraligi: aralikYazi || null,
      puanTurleri: [], minPuan: null, kpssSartli: false,
      ogrenim: Y.ogrenimBul ? Y.ogrenimBul(metin.toLocaleLowerCase("tr")) : [],
      kontenjan: kontenjanBul(baslik),
      iller: Y.illeriBul(metin),
      kurum,
      unvanlar: [...new Set([...metin.matchAll(Y.UNVANLAR)].map((x) => x[1].replace(/\s+/g, " ")))].slice(0, 5),
      yontem: /işkur|iskur/i.test(metin) ? "İŞKUR" : "e-Devlet / Kariyer Kapısı",
      kaynak: "Kamu İlanları (SBB)",
      ozet: `${kurum} — ${baslik}. Başvuru aralığı: ${aralikYazi || "kaynakta belirtilmemiş"}.`,
    });
  };

  /* her ilan bağlantısını tek tek ele al: yeni biçim önce, eski biçim yedek */
  for (const m of html.matchAll(/<a\s+href=['"]([^'"]*ilanDetay\.aspx\?kod=[^'"]+)['"]/gi)) {
    /* pencereyi bir sonraki </a> ile sınırla: komşu ilanın metni karışmasın
       (bozuk/uzun bloklarda en fazla 1600 karakterle sınırlı tut) */
    const kapanis = html.indexOf("</a>", m.index);
    const parca = kapanis > m.index && kapanis - m.index < 2000
      ? html.slice(m.index, kapanis)
      : html.slice(m.index, m.index + 1600);
    const genis = html.slice(m.index, m.index + 1600); // eski biçim: span'lar bağlantının dışında olabilir
    const ara = (re) => parca.match(re) || genis.match(re);
    const p1 = ara(/<p\s+class=['"]alt_p1['"]\s*>([^<]{4,200}?)\s*<\/p>/i);
    const p2 = ara(/<p\s+class=['"]alt_p2['"]\s*>([\s\S]{4,300}?)\s*<\/p>/i);
    if (p1 && p2) {
      const em = p2[1].match(/<em[^>]*>\s*\(?\s*([^)<]{4,60}?)\s*\)?\s*<\/em>/i) || parca.match(/<em[^>]*>\s*\(\s*([^)]{4,60}?)\s*\)\s*<\/em>/i);
      kaydet({
        url: m[1], kurum: p1[1],
        baslik: p2[1].replace(/<em[\s\S]*?<\/em>/gi, " "),
        aralikYazi: em ? em[1] : "",
        tarihIso: tarihBul(m.index),
      });
      continue;
    }
    /* eski biçim: üç span (kurum / unvan / tarih aralığı) */
    const eski = genis.match(/<span\s+class\s*=\s*['"][^'"]*['"]\s*>\s*([^<]{4,120}?)\s*<\/span>[\s\S]{0,400}?<span\s+class\s*=\s*['"][^'"]*['"]\s*>\s*([^<]{4,160}?)\s*<\/span>(?:[\s\S]{0,300}?<span\s+class\s*=\s*['"][^'"]*['"]\s*>\s*([^<]{3,60}?)\s*<\/span>)?/i);
    if (eski) kaydet({ url: m[1], kurum: eski[1], baslik: eski[2], aralikYazi: eski[3], tarihIso: tarihBul(m.index) });
  }
  return cikti;
}

/* --------------------------------------------- Yerel Yönetimler (CSB) ------ */
/* /duyurular listesi:
   <a href=".../xxx-duyuru-479031" class="duyurular-wrapper">
     <div class="date"><span><i> 17</i> Kasım 2026</span><p>Salı</p></div>
     <div class="info truncate-text-3"><p>MUDURNU BELEDİYE ... İLANI...</p></div>   */
export function csbListeyiOku(html, Y) {
  const bugun = bugunTR();
  const cikti = [], gorulen = new Set();
  for (const m of html.matchAll(/href="(https:\/\/yerelyonetimler\.csb\.gov\.tr\/([a-z0-9\-çğıöşü]+)-duyuru-(\d+))"/gi)) {
    const url = m[1], id = m[3];
    if (gorulen.has(id)) continue;
    gorulen.add(id);
    const cevre = html.slice(m.index, m.index + 1400);
    const baslikHam = Y.temiz((cevre.match(/class="info[^"]*"[^>]*>\s*<p>([\s\S]{5,400}?)<\/p>/i) || [])[1] || "").replace(/\.{3}|…$/g, "").trim();
    const gunYil = (cevre.match(/<i>\s*(\d{1,2})\s*<\/i>\s*([A-Za-zçğıöşü]+)\s*(\d{4})/) || []).slice(1);
    const slugBaslik = basHarf(m[2].replace(/-duyuru-\d+$/, "").replace(/-/g, " "));
    const baslik = (baslikHam.length > 15 ? baslikHam : slugBaslik);
    const trKaynak = (baslik + " " + m[2]).toLocaleLowerCase("tr"); // "ALIM" → "alım" (Türkçe küçük harf)
    if (!/alım|alim|personel|işçi|isci|memur|sözleşmeli|sozlesmeli|itfaiye|zabıta|zabita/.test(trKaynak)) continue;
    const iptal = /iptal/.test((baslik + " " + m[2]).toLocaleLowerCase("tr"));
    const tarihIso = gunYil.length === 3 ? Y.tarih(gunYil.join(" ")) || bugun : bugun;
    // başlıkta il arama; yoksa slug'daki ili dene
    let iller = Y.illeriBul(baslik);
    if (!iller.length) iller = Y.illeriBul(m[2].replace(/-/g, " "));
    // "mudurnu-belediye-baskanligina..." → Mudurnu Belediyesi ; "samsun-ili-asarcik-belediyesi" → Asarcık Belediyesi
    const kelimeler = m[2].split("-");
    const bi = kelimeler.findIndex((x) => /^belediye/.test(x));
    let kurum = null;
    if (bi > 0) {
      let isim = kelimeler.slice(0, bi);
      const i = isim.indexOf("ili");
      if (i >= 0) isim = isim.slice(i + 1);
      if (isim.length) kurum = basHarf(isim.join(" ")) + " Belediyesi";
    }
    const unvanlar = [...new Set([...(baslik + " ").matchAll(Y.UNVANLAR)].map((x) => x[1].replace(/\s+/g, " ").replace(/^\w/, (c) => c.toLocaleUpperCase("tr"))))].slice(0, 4);
    cikti.push({
      id: "csb-" + id,
      url,
      baslik: baslik + (iptal ? " (İptal)" : ""),
      tarih: tarihIso,
      kategori: "Yerel Yönetimler (CSB)",
      kategoriSlug: "yerel-yonetimler-csb",
      yayinda: !iptal,
      iptal,
      detayVar: false,
      eklendi: bugun,
      sonBasvuru: null, baslangic: null,
      puanTurleri: [], minPuan: null, kpssSartli: false,
      ogrenim: Y.ogrenimBul ? Y.ogrenimBul(baslik.toLocaleLowerCase("tr")) : [],
      kontenjan: kontenjanBul(baslik),
      iller,
      kurum, unvanlar, yontem: null,
      kaynak: "Yerel Yönetimler (CSB)",
      ozet: baslik + (iptal ? " — bu duyuru iptal edildi." : ""),
      govdeMetni: "",
    });
  }
  return cikti;
}

/* ------------------------------------------------------ çakışma kontrolü ---- */
const UNVAN_ANAHTAR = [
  "kaymakam adayı", "müfettiş yardımcısı", "uzman yardımcısı", "denetçi yardımcısı", "denetmen yardımcısı",
  "kontrolör yardımcısı", "stajyer", "itfaiye eri", "zabıta memuru", "zabıta", "memur yardımcısı",
  "sağlık teknikeri", "sağlık teknisyeni", " Büro Personeli".trim().toLowerCase(), "destek personeli",
  "araştırma görevlisi", "hemşire", "mühendis", "mimar", "veteriner", "avukat", "şoför", "aşçı",
  "tekniker", "teknisyen", "memur", "işçi", "personel",
];

/* Aynı ilanın iki kaynakta farklı başlıkla çıkma ihtimaline karşı parmak izi */
export function parmakIzi(kayit) {
  const t = (kayit.baslik || "").toLocaleLowerCase("tr");
  const unvan = UNVAN_ANAHTAR.find((u) => t.includes(u));
  const sayi = (t.match(/\b\d{1,4}\b/) || [])[0] || "";
  const kurum = (kayit.kurum || "").toLocaleLowerCase("tr").split(/\s+/)[0] || "";
  if (!unvan || !kurum) return null;
  return `${unvan}|${sayi}|${kurum}`;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
