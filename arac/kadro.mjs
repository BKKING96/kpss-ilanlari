/* ============================================================================
   kadro.mjs — ilanın GERÇEK konusunu bulur: ne alınıyor, kim alıyor, hangi il(de)
   ----------------------------------------------------------------------------
   Neden ayrı bir modül? Eski hâlinde filtrenin "kategori" satırı ilanın hangi
   siteden geldiğini gösteriyordu ("Kamu İlanları (SBB)", "Kariyer Bankası" …).
   İlan arayan biri kaynak site adı aramaz; "hemşire", "sürekli işçi",
   "P94 ile alınabilirim" arar. Bu modül o üç soruyu cevaplar:

     kadroBul()      → kadro türü  (Memur / Sağlık / Teknik / Akademik …)
     kurumTuruBul()  → ilanı veren kurum türü (Bakanlık / Üniversite / Belediye …)
     illerBul()      → 81 il + bölgesi

   Sıra ÖNEMLİ: desenler yukarıdan aşağı denenir, ilk eşleşen kazanır. Bu yüzden
   özelden genele doğru sıralandı (engelli → askeri → KPSS-A → akademik → sağlık
   → teknik → işçi → sözleşmeli → memur → diğer). "Sözleşmeli personel" neredeyse
   her ilanda geçtiği için en sonda; "personel/memur" en sonda.
   ============================================================================ */

/* ------------------------------------------------------------- kadro türü ---- */
const KADRO_TURLERI = [
  {
    slug: "engelli", ad: "Engelli / Eski Hükümlü",
    desen: /engelli|eski\s+hükümlü|terör\s+gazisi|şehit\s+(yakını|eşi|yetimi|çocuğu)|gaziler|3713|koruma\s+muhtaç/i,
  },
  {
    slug: "askeri", ad: "Askeri & Güvenlik",
    desen: /uzman\s+erbaş|erbaş|astsubay|subay\s+alımı|çarşı\s+ve\s+mahalle\s+bekçisi|bekçi|polis\s+alımı|polis\s+aday|korucu|askeri\s+öğrenci|jandarma|sahil\s+güvenlik/i,
  },
  {
    slug: "kpss-a", ad: "KPSS-A / Kurum Sınavlı",
    desen: /kaymakam|vali\s+yardımcısı|müfettiş|teftiş\s+kurulu|denetmen|denetçi|kontrolör|uzman\s+yardımcısı|stajyer|kariyer\s+meslek|a\s+grubu|kurum\s+sınavı|giriş\s+sınavıyla/i,
  },
  {
    slug: "akademik", ad: "Akademik & Öğretmen",
    desen: /akademik|araştırma\s+görevlisi|öğretim\s+(üyesi|elemanı|görevlisi)|okutman|lecturer|profesör|doçent|doktor(?:alı)?\s+öğretim|öğretmen|okul\s+öncesi|rektörlük|dekanlık|enstitü\s+müdür/i,
  },
  {
    slug: "saglik", ad: "Sağlık Personeli",
    desen: /hemşire|ebe(?!veyn)|sağlık\s+teknik(er|yen)|sağlık\s+personeli|sağlık\s+memuru|laborant|tıbbi\s+sekreter|röntgen|rad-yo|anestezi|ameliyathane|diş\s+protez|eczacı|ecza\s+tekniker|sağlık\s+bakım|veteriner|klinik|poliklinik|hastane/i,
  },
  {
    slug: "teknik", ad: "Teknik Personel",
    desen: /mühendis|mimar|teknik(er|yen)|şehir\s+planc|peyzaj|harita\s+ve\s+kadastro|bilgisayar\s+işletmen|programcı|çözümleyici|ağ\s+uzmanı|sistem\s+cihaz|coğrafi\s+bilgi|jeoloji|jeofizik|kaptan|makininist|makine\s+işletme|operat[öo]r|teknik\s+personel|laboratuvar/i,
  },
  {
    slug: "isci-gecici", ad: "Geçici / Mevsimlik İşçi",
    desen: /geçici\s+iş?ci|mevsimlik\s+(iş?ci|personel)|belirli\s+süreli\s+iş|geçici\s+destek\s+personeli/i,
  },
  {
    slug: "isci-daimi", ad: "Sürekli İşçi",
    desen: /sürekli\s+iş?ci|daimi\s+iş?ci|kadrolu\s+iş?ci|işçi\s+alımı|işçi|hamal|şoför|kamyond|operat[öo]r|aşçı|kaloriferci|bahçıvan|temizlik\s+iş?çi|fabrika\s+işçi/i,
  },
  {
    slug: "sozlesmeli", ad: "Sözleşmeli Personel (4/B)",
    desen: /sözleşmeli|4\/b\b|657[^a-z0-9]{0,4}4\/b|45\d'inci\s+madde/i,
  },
  {
    slug: "memur", ad: "Memur / Büro Personeli",
    desen: /memur|kamu\s+personeli|büro\s+personeli|destek\s+personeli|idari\s+personel|zabıta|itfaiye|avukat|mütercim|tercüman|kütüphane|arşiv|grafiker|veri\s+giriş|anketör|çağrı\s+merkezi|sekreter|santral/i,
  },
];
const DIGER = { slug: "diger", ad: "Diğer Kamu İlanları" };

/* Metni tek biçime indirir: Türkçe küçük harf, tire/alt çizgi boşluk. */
const norm = (s) => String(s || "").replace(/[-_/·|]+/g, " ").toLocaleLowerCase("tr");

/**
 * İlânın hangi kadro türüne girdiğini bulur.
 * @param {object} i { baslik, unvanlar, kurum, kategori, govdeMetni, ozet }
 * @returns {{ad:string, slug:string, neden:string}}
 */
export function kadroBul(i = {}) {
  /* Ünvan listesi en güçlü kanıt: önce onda aranır, sonra başlıkta, en son
     gövde metninde. Böylece "Hemşire Alımı" başlıklı ilan metninde "personel"
     geçtiği için Memur çukura düşmez.                                      */
  const katmanlar = [
    (i.unvanlar || []).join(" "),
    i.baslik || "",
    [i.kategori, i.kaynak].filter(Boolean).join(" "),
    (i.ozet || "") + " " + (i.govdeMetni || "").slice(0, 900),
  ].map(norm);
  for (let k = 0; k < katmanlar.length; k++) {
    const t = katmanlar[k];
    if (!t.trim()) continue;
    for (const e of KADRO_TURLERI) if (e.desen.test(t)) return { ad: e.ad, slug: e.slug, neden: ["ünvan", "başlık", "kategori", "metin"][k] };
  }
  return { ad: DIGER.ad, slug: DIGER.slug, neden: "eşleşme yok" };
}

/* -------------------------------------------------------------- kurum türü ---- */
const KURUM_TURLERI = [
  { slug: "universite", ad: "Üniversite", desen: /üniversite|rektörlük|dekanlık|uygulama\s+ve\s+araştırma\s+merkezi|e[ğğ]itim\s+ve\s+araştırma\s+hastanesi/i },
  { slug: "belediye", ad: "Belediye / Mahalli İdare", desen: /belediye|mahall[ıi]\s+özel\s+idare|il\s+özel\s+idare|büyükşehir|kanalizasyon|ulaşım\s*a?\s*ş?\b|iets|iETT|ASKİ|BUSKİ|ISKI/i },
  { slug: "saglik", ad: "Hastane / Sağlık Kurumu", desen: /hastane|sağlık\s+müdürlüğü|ilhizam|kanserle\s+savaş|verem\s+savaş|halk\s+sağlığı\s+(baş|mü)düri?/i },
  { slug: "bakanlik", ad: "Bakanlık / Genel Müdürlük", desen: /bakanlık|genel\s+müdürlük|genel\s+başkanlık|başkanlığı|idaresi\s+başkanlığı|ajans|strateji\s+ve\s+bütçe|vergi\s+dairesi|defterdarlık/i },
  { slug: "kamu", ad: "Diğer Kamu Kurumu", desen: /kurumu|işletme|şirketi|fakülte|enstitü|yüksekokul|i̇şkur|işkur|ticaret\s+odası|odası\s+borluğu|vakfı/i },
];

/** İlanı veren kurumun türü. @returns {{ad:string, slug:string}} */
export function kurumTuruBul(kurum, metin) {
  const t = norm([kurum, metin].filter(Boolean).join(" "));
  for (const e of KURUM_TURLERI) if (e.desen.test(t)) return { ad: e.ad, slug: e.slug };
  return { ad: "Kurumu belirsiz", slug: "belirsiz" };
}

/* ------------------------------------------------------------------- iller ---- */
/* 81 il, coğrafî bölgelerine göre. Bölge grupları arayüzdeki İl seçicisinde
   kullanılıyor; liste aynı zamanda scraper'ın eski ILLER dizisinden eksikleri
   tamamlıyor (Kahramanmaraş, Düzce, Bolu, Adıyaman gibi).                   */
export const BOLGELER = {
  "Marmara": ["İstanbul", "Edirne", "Kırklareli", "Tekirdağ", "Kocaeli", "Sakarya", "Bursa", "Bilecik", "Balıkesir", "Çanakkale", "Yalova"],
  "Ege": ["İzmir", "Aydın", "Denizli", "Muğla", "Manisa", "Kütahya", "Uşak", "Afyonkarahisar"],
  "Akdeniz": ["Antalya", "Burdur", "Isparta", "Mersin", "Adana", "Osmaniye", "Hatay", "Kahramanmaraş"],
  "İç Anadolu": ["Ankara", "Konya", "Karaman", "Aksaray", "Niğde", "Nevşehir", "Kayseri", "Sivas", "Yozgat", "Kırşehir", "Kırıkkale", "Çankırı", "Eskişehir"],
  "Karadeniz": ["Zonguldak", "Karabük", "Bartın", "Kastamonu", "Bolu", "Düzce", "Sinop", "Samsun", "Amasya", "Çorum", "Tokat", "Ordu", "Giresun", "Trabzon", "Rize", "Artvin", "Gümüşhane", "Bayburt"],
  "Doğu Anadolu": ["Erzurum", "Erzincan", "Tunceli", "Bingöl", "Elazığ", "Malatya", "Van", "Muş", "Bitlis", "Hakkâri", "Ağrı", "Kars", "Iğdır", "Ardahan"],
  "Güneydoğu Anadolu": ["Gaziantep", "Adıyaman", "Kilis", "Şanlıurfa", "Diyarbakır", "Mardin", "Batman", "Şırnak", "Siirt"],
};
export const TUM_ILLER = Object.values(BOLGELER).flat();
export const IL_BOLGE = Object.fromEntries(Object.entries(BOLGELER).flatMap(([b, iller]) => iller.map((il) => [il, b])));
/* Hakkâri/Hakkari, Kilis… gibi yazım farkları ve il adı içeren kurum adları
   (ör. "İstanbul Vilayetler") için tekilleştirme anahtarı.                   */
const trKucuk = (s) => String(s || "").toLocaleLowerCase("tr").replace(/[ıİ]/g, "i").replace(/[^a-zçğıöşüü ]/g, " ");
const IL_ARAMA = TUM_ILLER.map((il) => ({ il, k: trKucuk(il) }));

/**
 * Metinde geçen illeri bulur. Kısa/yanlış eşleşmeleri önlemek için il adının
 * kelime olarak geçmesi gerekir ("Artvin" → Artıvin sayılmaz).
 */
export function illerBul(metin) {
  const t = " " + trKucuk(metin) + " ";
  const bulunan = IL_ARAMA.filter((x) => new RegExp(`(^|[^a-zçğıöşü])${x.k.replace(/ /g, "\\s+")}($|[^a-zçğıöşü])`, "g").test(t)).map((x) => x.il);
  return [...new Set(bulunan)];
}

/** Kurum adından il çıkar: "Konya Büyükşehir Belediyesi" → Konya. */
export function ilKurumdan(kurum) {
  return illerBul(kurum || "")[0] || null;
}

/* ------------------------------------------------------- iş ilanı olmayanı ayıkla ---- */
/* Ana sayfadan toplanan haber başlıkları araya karışıyor (maç kadrosu, transfer
   haberi, konser duyurusu…). Bunlar ilan değil; filtrelerde "ilgisiz" işaretlenir
   ve varsayılan listede gösterilmez. Yakalanan hiçbir şey silinmez — yalnızca
   etiketlenir, ileride yanıldığı anlaşılırsa geri almak tek satır.            */
/* ÖNEMLİ: Türkçede kelime sonu ekler ASCII \w'e girmez ("Maçına" → "Maç" + "ına").
   \b ve \w bu yüzden Türkçe metinde yanlış çalışır; burada hiç kullanmadık.   */
const HABER = /(ma[aç]|macli|teknik direktör|futbol|transfer|deplasman|süper\s*(lig|kupa)|uefa|fifa|şampiyonlar\s+lig|basketbol|voleybol|tenis\s+dünyas|konser|festival|sergi|imza\s+günü|dizi\s+(sezon|bölüm)|film\s+(gişe|fragman)|magazin|hava\s+durumu|dizi\s+kadros)/i;
const ILAN_KELIME = /al[ıi]m|al[ıi]nacak|al[ıi]m[ıi]|personel|memur|iş?çi|kpss|başvuru|sözleşmeli|şartname|sınav|atama|istihdam|düzenlenecek|kadrosunda|kontenjan/i;

/** Başlık bir iş ilanı değilse true. Yalnızca GÜÇLÜ kanıtla işaretler: ilana
   benzer tek bir kelime bile varsa dokunmayız (yakalanandan çok kaçırmayı tercih ederiz). */
export function ilgisizMi(i = {}) {
  const t = [i.baslik, i.ozet].filter(Boolean).join(" ");
  if (!HABER.test(t)) return false;
  return !ILAN_KELIME.test(t);
}

/* --------------------------------------------- başvuru aciliyeti (rozet) ----- */
/**
 * Karttaki rozetin metni. null → rozet yok.
 * @param {number|null} kalanGun
 */
export function aciliyet(kalanGun) {
  if (kalanGun === null || kalanGun === undefined || kalanGun < 0) return null;
  if (kalanGun === 0) return { seviye: "bugun", yazi: "Bugün son gün" };
  if (kalanGun === 1) return { seviye: "yarin", yazi: "Yarın son gün" };
  if (kalanGun <= 3) return { seviye: "ucgun", yazi: kalanGun + " gün kaldı" };
  if (kalanGun <= 7) return { seviye: "hafta", yazi: kalanGun + " gün kaldı" };
  return null;
}
