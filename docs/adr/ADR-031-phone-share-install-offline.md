# ADR-031 — Telefonda tamamlanan akış: paylaş, uygulama olarak yükle, internetsiz aç

> Tarih: 2026-09-30 · Durum: UYGULANDI (kurucu onayı 30 Eylül 2026). PRD R10 "kaydet/share
> sheet" ve R12 "web ilk yükleme/offline desteği ayrıca belirtilir" (belge 04) bu kayıtla
> belirtilir. [ADR-026](ADR-026-kesit-list.md)'nın indirme bölümüne "Paylaş"ı ekler; şema
> (EDL v2) ve politika (`2026-09-24.v6`) **değişmedi**. Güvenlik: [statik site
> sertleştirmesi](../security/2026-09-30-static-site-hardening.md) "Güncelleme: service worker";
> gizlilik: [veri envanteri](../privacy/DATA_INVENTORY.md) §2.5, §3, §4.

## Neden

Kullanıcıların çoğu telefonla çekiyor ve telefondan paylaşıyor. Bugüne kadar indirme bir
bilgisayar akışıydı: "Bilgisayara kaydet", paylaşma yok, ana ekrana ekleme yok, internet yoksa
site açılmıyor. Kurucu bu sürümden hemen sonra bir Samsung Android telefonda deneyecek.

## Telefonda akış (adım adım)

**Android Chrome (kurucunun telefonu: Galaxy S23, Android 16, Chrome 154).** Koordinatörün
cihazda adb+CDP ile yaptığı yoklamaya göre bu telefonda `window.showSaveFilePicker` **var**,
`navigator.canShare({ files })` doğru, WebCodecs H.264 + AAC kodlama var, OPFS çalışıyor; görüntü
alanı 360 × 643 CSS px. Bu yüzden akış:

1. Kesiti işaretle → kartın ⬇'ı (ya da alttaki çubuk / üstteki düğme).
2. Android'in kaydetme penceresi açılır (ADR-026'nın yolu; tıklamanın içinde, `await`'ten önce).
3. Video doğrudan seçilen dosyaya kodlanır; kartta "Kaydedildi: ad.mp4".
4. Altında **"Paylaş"**: sistemin paylaşma menüsü (WhatsApp, Instagram, Drive…). Paylaşılan dosya
   kaydedilen dosyanın kendisidir (sonuç gelince bir kez `handle.getFile()`, kopyasız).

**Kaydetme penceresi olmayan tarayıcı** (Samsung Internet'te var mı ölçülmedi; iOS Safari,
Firefox): video tarayıcının geçici diskine (OPFS, yoksa belleğe) kodlanır, kartta yan yana
**"Kaydet"** (İndirilenler klasörüne) ve **"Paylaş"**. Dokunmatik ekranda cümleler "bilgisayar"
demez: "Video hazır. “Kaydet” cihazına kaydeder, “Paylaş” bir uygulamaya gönderir.",
"Tarayıcın dosyayı İndirilenler klasörüne kaydeder; Dosyalar uygulamasında bulursun.",
"Kaydederken cihazında yaklaşık … daha boş yer gerekir.".

## Kararlar

### 1. Paylaş (Web Share API)

| Konu | Karar |
|---|---|
| Ne zaman görünür | Sonuç gelince `navigator.share` ve `navigator.canShare({ files: [file] })` doğruysa. Değilse düğme **hiç çizilmez** (Playwright'ın Chromium'u, masaüstü Firefox). |
| Hangi dosya | Kaydetme penceresi yolu: `handle.getFile()` (bir kez, sonuç gelince), `video/mp4` türüyle aynı adla sarılır. OPFS yolu: worker'ın verdiği diske dayalı `File`, önerilen adla sarılır (bayt kopyası yok). Bellek yolu: aynı baytlardan `File`. Aynı `File` hem "Kaydet" bağlantısının `blob:` adresi hem paylaşım. |
| Kullanıcı etkinleşmesi | "Paylaş" tıklaması `navigator.share`'i **eşzamanlı** çağırır (`useDownloads.share` → `adapters/share.ts`); önünde `await` yok. e2e bunu ölçer: çağrı anında `navigator.userActivation.isActive === true`. |
| Kapatma | `AbortError` (kullanıcı menüyü kapattı) sessiz: mesaj yok, günlük yok. |
| Ret | Diğer her hata: kartta "Paylaşılamadı. Videoyu kaydet, sonra Dosyalar ya da galeri uygulamasından paylaş." (kaydedilmiş dosyada "…klasöründen paylaşabilirsin."). Oturum hata koduna `share_refused` yazılır (tanı dosyası). Sonraki başarılı paylaşım cümleyi kaldırır. |
| Büyük dosya | Chromium tek seferde **en fazla 50 MiB** paylaşır (aşağıda ölçüm). `canShare` bunu söylemez (1 GiB için de `true`), `share()` ise hemen `NotAllowedError` verir. Bu yüzden Chromium'da 50 MiB'tan büyük dosyada düğme yerine: "Bu video (… MB) buradan paylaşmak için büyük: tarayıcı en fazla 52,4 MB paylaşabiliyor. Videoyu kaydet, sonra Dosyalar ya da galeri uygulamasından paylaş." Chromium'u tanıma: kullanıcı aracısında `Chrome/` (Android Chrome, Edge, Samsung Internet dahil; iOS'taki Chrome WebKit'tir, `CriOS`). Safari'ye bu sınır uygulanmaz (ölçülmedi, kendi cevabına bırakıldı). |
| Metin | Düğme "Paylaş", erişilebilir adı "Paylaş: dosya-adı.mp4" (birden çok kartta ayırt edilir), açıklaması "Paylaşma menüsünü açar: videoyu bir uygulamaya ya da bir kişiye gönderebilirsin." |
| Düzen | "Kaydet" ile "Paylaş" aynı satırda (`flex-wrap`); sığmazsa alt alta. 360 px'te yan yana, ikisi de ≥ 44 px yüksek, yatay kaydırma yok (e2e). |

### 2. "Bilgisayara kaydet" yerine "Kaydet"

Karar ölçütü: telefon düzeni (genişlik ≤ 760 px) **ya da** dokunmatik ana işaretçi
(`(hover: none) and (pointer: coarse)`, `useTouchScreen`). Masaüstünde metinler aynı kaldı
("Bilgisayara kaydet"; mevcut testler değişmedi). Böylece dar bir masaüstü penceresi de "Kaydet"
der; yanlış değil. Tanıtım sayfasındaki ve bantlardaki "bilgisayarından çıkmaz" cümleleri
her yerde "cihazından çıkmaz" oldu (TR + EN).

### 3. Uygulama olarak yükle (manifest)

- `web/src/app/manifest.ts` → `<base>/manifest.webmanifest` (Next her sayfaya `<link rel="manifest">`
  yazar). `id` ve `scope` = `<base>/`, `start_url` = editör (`/capcut/editor/` Pages'te, `/editor`
  e2e'de), `display: standalone`, `lang: tr`, tema ve arka plan `#101315` (koyu tema `--bg`).
- Ad tek yerde: `web/src/appIdentity.ts` (`APP_NAME = 'Clip'`, geçici ad K01). Yeniden adlandırma
  oradan başlar; görünen metinler `messages.ts`'te.
- Simgeler logodan (`web/src/app/icon.svg`) yerel Chromium ile üretildi
  (`web/scripts/generate-app-icons.mjs`, kütüphane yok): 192 ve 512 px "any" (yuvarlak köşeli
  kare), 512 px "maskable" (tam dolgu, makas güvenli dairenin içinde: köşegen %71 < %80), iOS için
  opak 180 px `apple-icon.png` (Next `<link rel="apple-touch-icon">` yazar). `appleWebApp` meta'ları
  (başlık "Clip") eklendi.
- ⋯ (Diğer) menüsünde **"Uygulama olarak yükle"**: yalnızca tarayıcı `beforeinstallprompt`
  gönderdiyse (Chromium). Olay saklanır, düğme `prompt()`'u tıklamayla çağırır, tek kullanımlıktır;
  yüklenince (`appinstalled`) ya da uygulama zaten ana ekrandan açıldıysa (`display-mode:
  standalone`) görünmez. `preventDefault` ile Chrome'un kendi alt çubuğu gösterilmez (tarayıcı
  menüsündeki "Uygulamayı yükle" yine durur).
- iPhone/iPad Safari'de olay yok: aynı yerde "Ana ekrana ekle — Safari’de Paylaş düğmesine bas,
  sonra “Ana Ekrana Ekle”yi seç." Tanıma temkinli: iPhone/iPod/iPad ya da dokunmatik "Mac"
  (iPadOS masaüstü modu) **ve** `Version/… Safari/`; iOS'taki Chrome/Firefox/Edge/Opera, Google
  uygulaması, Instagram/Facebook web görünümü hariç (birim testi). Başka her yerde hiçbir şey.

### 4. İnternetsiz açılış (service worker)

- **Adres ve kapsam:** `<base>/sw.js`, kapsam `<base>/` (`/capcut/` ya da `/`). Next'in `/sw.js`
  rotası (`web/src/app/sw.js/route.ts`, `force-static`) yalnızca adresi ayırır; gövdesini derlemeden
  sonra `web/scripts/build-sw.mjs` yazar (`npm run build` = `next build` → `apply-csp.mjs` →
  `build-sw.mjs`): statik çıktıda `out/sw.js`, `next start` için `.next/server/app/sw.js.body`.
- **Liste derleme anında:** `web/scripts/lib/precache.mjs` derleme çıktısını tarar: dört sayfa
  (Next'in `_not-found`, `_global-error` ve dışa aktarmanın `404/` sayfası hariç), `/_next/static/`
  altındaki her dosya (kaynak haritası ve TypeScript kaynağı hariç), altyazı yazı tipleri,
  simgeler, manifest. Bu derlemede **4 sayfa + 37 dosya, 1,86 MB** (Pages ve e2e derlemesi aynı).
  Bir sayfa ya da yazı tipi eksikse derleme hata verir.
- **Sürüm:** önbellek adı `clip-app-<16 hex>`: saklanan dosyaların baytları + worker kodunun
  SHA-256'sı. Aynı derleme aynı adı verir; tek bayt değişirse yeni ad (birim testi). Etkinleşince
  eski `clip-app-*` önbellekleri silinir, başka adlara dokunulmaz (`github.io` paylaşılan origin).
- **Kurulum:** `Cache.addAll` ile hepsi ya da hiçbiri. Sayfalar ve hash'siz dosyalar `cache:
  'no-cache'` ile istenir (Pages `max-age=600` veriyor; eski HTML yeni listeye karışmasın),
  hash'li derleme dosyaları HTTP önbelleğinden gelebilir.
- **Sunma:**
  - sayfalar **önce ağ**, ağ hata verirse ya da 4 sn'de cevap gelmezse saklanan sayfa. Eşleme
    `/capcut/editor`, `/capcut/editor/`, `/capcut/editor/index.html`, sorgu dizesi farkı olmadan
    aynı sayfaya gider (Pages'in 301 yönlendirmesi çevrimdışı olmaz). Listede olmayan sayfa
    tarayıcının kendi yoluna bırakılır (çevrimdışıyken tarayıcının hata sayfası; eski sayfa
    gösterilmez);
  - listedeki derleme dosyaları **önce önbellek**, yoksa ağ. Simge bağlantılarındaki içerik
    hash'i sorgusu (`/icon.svg?icon.2qx….svg`) aynı dosyayı alır;
  - başka her şey worker'dan geçmez: POST, `Range` (video), başka origin, `<base>/` dışı, liste
    dışı adresler, RSC yükleri. Çalışırken gelen hiçbir yanıt önbelleğe yazılmaz: önbellekte
    yalnızca liste var.
- **Bulunan ve düzeltilen hata (worker adresi):** Turbopack dışa aktarma ve sessizlik worker'larını
  `…/turbopack-worker-….js#params=…` adresiyle başlatıyor; worker ayarlarını kendi adresinin
  `#` kısmından okur. Önbellekten dönen yanıt saklandığı adresi taşır (`#` kısmı yok) ve worker
  "Missing worker bootstrap config" ile duruyordu (uygunluk kapısı "Bu tarayıcıda çıktı
  alınamıyor" dedi — e2e yakaladı). Worker betiği isteklerinde (`destination: worker`) önbellekteki
  gövde yeni bir `Response` ile verilir; adresi olmayan yanıtta tarayıcı istenen adresi (`#`
  dahil) kullanır. Chrome'da dedicated worker, sayfa henüz worker'ın kontrolünde değilken bile
  worker'ın adresine göre service worker'dan geçiyor; bu yüzden hata ilk ziyarette de görülebiliyordu.
- **`next start`'ın kopyası:** `next start` önceden oluşturulmuş rota gövdesini ilk istekte
  `.next/server/route-cache/`'e kopyalıyor ve sonra oradan sunuyor (yeniden başlatmada da).
  `build-sw.mjs` aynı derlemede yeniden çalışırsa bu kopyayı siler (temiz `next build`'de yok).
- **Kayıt:** yalnızca üretim derlemesinde (`NODE_ENV === 'production'`; `next dev`'de hiç), sayfa
  `load` olduktan sonra, `updateViaCache: 'none'`. Kaydı ve güncelleme notunu kök layout'taki
  `PwaClient` yapar (her sayfada). Kurulum ilk ziyarette sayfayı kontrol etmez (`clients.claim` yok):
  o sayfa ağdan açılmıştır; bir sonraki açılış (ya da yenileme) worker'dan gelir. Kurulu uygulama
  günlerce açık kalabileceği için ekrana dönüşte en çok saatte bir `registration.update()`.
- **Güncelleme notu:** yeni worker kurulup beklerse sayfa önce ona "bu sayfanın derleme dosyaları
  sende mi?" diye sorar (sayfadaki `script`/`stylesheet` adresleri). Evetse sayfa zaten yeni
  sürümdendir (ağdan gelmiştir): worker sessizce devreye girer, yenileme yok. Hayırsa üstte sessiz
  bir not: **"Yeni sürüm hazır."** + "Sonra" / **"Yenile"**. Sayfa hiçbir zaman kendiliğinden
  yenilenmez; başka bir sekmenin "Yenile"si bu sekmeyi yenilemez. İndirme sürerken "Yenile"
  kapalıdır ve "İndirme bitince yenileyebilirsin." yazar (`setAppBusy`, `useDownloads`).
- **CSP değişmedi** (`worker-src 'self'`, `manifest-src 'self'`, `img-src 'self'` yetiyor).

## Ölçülen

### Paylaşma boyut sınırı

`web/scripts/measure-share.mjs`: sayfa, tarayıcının özel diskinde seyrek (bellek harcamayan)
bir MP4 türünde dosya oluşturur, gerçek bir tıklamayla `canShare` ve `share` çağırır. Paylaşma
menüsü açılan denemede söz 3 sn bekler durumda kalır ("menü açıldı") ve sayfa kapatılır; hiçbir
hedef seçilmez, dosya bir yere gitmez. Windows 11, bu makine:

| Boyut | Chrome 154.0.8037.58 | Edge 154.0.4258.37 | Chrome, Android öykünmesi (Pixel 7) | Playwright Chromium 153 |
|---|---|---|---|---|
| 1 / 49 / 50 MiB | `canShare` true, menü açıldı | aynı | aynı | `navigator.share` yok |
| 50 MiB + 1 bayt | `canShare` **true**, `share` 0 ms'de `NotAllowedError: Permission denied` | aynı | aynı | — |
| 51 / 100 MiB, 1 GiB | aynı ret | aynı | aynı | — |

Sonuç: sınır tam **52 428 800 bayt** ve `canShare` bunu söylemiyor. Android öykünmesi Windows'taki
aynı Blink kodudur; **gerçek Android'de ölçülmedi** (Chromium kaynağında sınır platformdan
bağımsız bir sabit; telefonda doğrulanmalı, aşağıda).

Bu sınır telefonda sık karşılaşılacak kadar küçük: yeniden kodlanan 1080p çıktıda 50 MiB ≈ **73 sn**
(ADR-026 ölçümü: 1:50 → 75,6 MiB, ~5,8 Mbit/s). Hızlı kesimde (ADR-027) çıktı kaynağın bit hızını
taşır: telefonun 1080p kaydı tipik olarak 15–20 Mbit/s ise ~20–28 sn, 4K kayıtta birkaç saniye
(bu bit hızları tahmin, kurucunun telefonunda ölçülmedi). Daha uzun kesitte kullanıcı "Kaydet"i
kullanır ve galeriden/Dosyalar'dan paylaşır; kart bunu söyler.

### Önbellek

4 sayfa + 37 dosya, 1,86 MB (e2e ve Pages derlemesi). Worker betiği ~7 KB.

### Kurulabilirlik

Lighthouse 12'den beri PWA kategorisi yok (belge `docs/perf/2026-09-30-load.md` Lighthouse 13.5
kullanıyor). Onun eski "installable-manifest" denetiminin sorduğu şeyi Chrome'a doğrudan
soruyoruz: `Page.getInstallabilityErrors` ve `Page.getAppManifest` (CDP) — e2e'de `/` altında,
Pages duman testinde `/capcut/` altında: **0 hata**.

## Test edilen

Hepsi 2026-09-30'da bu dalda, ölçüm kilidi altında (tam koşular) koşuldu. Sonuçlar aşağıda
"Sonuçlar"da.

- `web/tests/e2e/pwa.spec.ts` (yeni): paylaşma (seçilen dosya ve yedek yol; `File` adı, türü,
  boyutu indirilen/kaydedilen dosyayla bayt bayt aynı; tıklamanın etkinleşmesi), `AbortError`
  sessiz, ret cümlesi, paylaşamayan tarayıcıda düğme yok; 360 px telefon (kaydetme penceresi yolu
  ve yedek yol; "Kaydet"/"Paylaş" yan yana, "bilgisayar" yok, axe 0, yatay kaydırma yok);
  dokunmatik geniş ekran; manifest (her sayfada bağlantı, alanlar, simgelerin PNG boyutları,
  apple-touch-icon); Chrome'un kurulabilirlik denetimi; ⋯'da "Uygulama olarak yükle" (sahte
  `beforeinstallprompt`, tek kullanım, axe 0); iPhone Safari ipucu; worker'ın önbelleği sw.js'teki
  listeye tam eşit ve yalnızca izinli uygulama yolları, editörün bütün betik/stil dosyaları içinde;
  **çevrimdışı** (`context.setOffline(true)`): tanıtım sayfası, editöre bağlantıyla geçiş,
  gizlilik (TR/EN), editörde video açma, altyazı (yazı tipi önbellekten, worker'da da), kesit
  indirme; önbellek indirme sonrası değişmedi (medya yok); bilinmeyen sayfa tarayıcı hatası;
  güncelleme notu (yerel vekil ile "yeni yayın": not, axe 0, "Sonra", yenilemede geri gelir,
  indirme sürerken "Yenile" kapalı ve cümle, "Yenile" ile yeni worker ve eski önbelleğin silinmesi);
  sayfa zaten yeni sürümdense sessiz geçiş.
- `privacy.spec.ts`: gizlilik sayfasında "Çevrimdışı kopya" (`clip-app-`, service worker); tam
  oturumun izin listesine manifest, simgeler, `sw.js`; oturum sonunda Cache Storage'da yalnızca
  izinli uygulama yolları, `.mp4/.json/.srt/blob:` yok.
- `csp.spec.ts`: tam oturumda editörün ikinci yüklemesi worker'ın kontrolünde, HDR dışa aktarması
  önbellekten gelen worker betikleriyle: 0 ihlal.
- `a11y.spec.ts`: "indirme hazır" durumları (1440, 390, 320 px) artık "Paylaş" düğmesiyle
  denetleniyor.
- Pages duman testi: `/capcut/` altında manifest ve simgeler, worker kapsamı `/capcut/`, önbellekte
  yalnızca `/capcut/` uygulama dosyaları, Chrome kurulabilirlik denetimi, çevrimdışı yeniden
  yükleme (tanıtım, eğik çizgisiz `/capcut/editor`, gizlilik, editör) ve çevrimdışı kesit indirme.
- Birim: `tests/unit/share.test.ts` (paylaşma kararı ve 50 MiB sınırı, Chromium tanıma, kapatma
  ile ret ayrımı, iOS Safari tanıma), `tests/unit/serviceWorker.test.ts` (liste — statik ve sunucu
  derlemesi, sürüm, şablon; worker'ın kendisi sahte `caches`/`fetch` ile: kurulum listesi, yalnız
  kendi eski önbelleklerini silmesi, neyi sunup neyi bırakması, worker adresinin korunması,
  çevrimdışı sayfa eşlemesi, mesajlar).

## Sonuçlar (2026-09-30/10-01, Windows 11, bu makine, `web/` içinde)

| Komut | Sonuç |
|---|---|
| `npx tsc --noEmit -p .`, `npx eslint .` | hatasız |
| `npx vitest run` | 42 dosya, **526 test geçti** (önce 509; +17: `share.test.ts` 7, `serviceWorker.test.ts` 10) |
| `npm run build` (sunucu derlemesi) | başarılı; `build-sw: … clip-app-…: 4 pages, 37 files, 1.86 MB` |
| `E2E_PORT=3241 npx playwright test` (tam e2e, ölçüm kilidiyle) | **170 geçti, 2 atlandı** (isteğe bağlı ekran görüntüsü testleri), 0 başarısız, 5,0 dk (önce 155 + 2; +15 `pwa.spec.ts`) |
| Statik çıktı (CI ortam değişkenleri, PowerShell) + `npx playwright test -c playwright.pages.config.ts` | **3 geçti** (yeni: manifest, worker kapsamı `/capcut/`, kurulabilirlik 0 hata, çevrimdışı yenileme ve indirme) |
| `node scripts/run-matrix.mjs --browser=chromium` (`next start -p 3100`) | **22 PASS**, 0 FAIL |
| `node scripts/run-matrix.mjs --browser=chrome` | **22 PASS**, 0 FAIL |
| `node scripts/measure-share.mjs --channel=chrome / msedge / chrome --mobile / chromium` | yukarıdaki tablo |

Matris sürücüsü her koşuda yeni bir tarayıcı bağlamı açar (kalıcı profil yok); e2e de her testte
yeni bağlam kullanır. Kayıtlı bir worker'ın başka bir derlemeyi sunması bu yüzden mümkün değil;
matris içinde ilk vakadan sonra sayfalar ve worker betikleri bu derlemenin önbelleğinden gelir.

İlk e2e koşuları iki gerçek hata buldu (ikisi de düzeltildi, yukarıda): worker adresinin `#params=`
kısmının önbellekten dönen yanıtta kaybolması ve `next start`'ın rota kopyası yüzünden yeniden
yazılan worker'ın sunulmaması. Bir test tasarım hatası da: Playwright `context.route` tarayıcının
worker güncelleme denetimini göremiyor; "yeni yayın" bu yüzden testte yerel bir vekille
(başka port, `/sw.js`'i yeniden yazar, gerisini e2e sunucusuna iletir) canlandırılıyor.

## Test edilmeyen (gerçek cihaz gerekiyor)

Kurucunun Samsung'unda bakılacaklar, sırayla:

1. **Chrome, kaydetme penceresi yolu:** ⬇ → Android kaydetme penceresi → "Kaydedildi: …" →
   "Paylaş" → WhatsApp / Instagram / Drive'da video gerçekten açılıyor mu (`handle.getFile()` ile
   alınan dosya içerik URI'sinden okunabiliyor mu).
2. **50 MiB'tan büyük bir dosyada** (ör. 1080p 3–5 dakika) "Paylaş" yerine boyut cümlesi mi
   çıkıyor; 50 MiB'ın hemen altında paylaşım gerçekten çalışıyor mu (Android'deki sınır ölçülmedi).
3. **Samsung Internet 30:** `showSaveFilePicker` var mı (yoksa "Kaydet" + "Paylaş" yolu),
   `canShare` doğru mu, `beforeinstallprompt` geliyor mu ("Uygulama olarak yükle" ⋯'da görünüyor
   mu; görünmüyorsa tarayıcı menüsündeki "Sayfayı ekle → Ana ekran" yolu), aynı 50 MiB sınırı var mı.
4. **Yükleme:** Chrome'da ⋯ → "Uygulama olarak yükle" → ana ekranda "Clip" simgesi (maskelenmiş
   simgenin kırpılmadığı), açılınca editör, tarayıcı çubuğu yok, üst çubuk rengi koyu.
5. **Çevrimdışı:** siteyi bir kez aç, uçak modu, ana ekrandaki simgeden (ya da tarayıcıdan) aç →
   editör açılıyor mu; galeriden bir video seçip kesit indirebiliyor musun.
6. **Güncelleme notu:** yeni bir yayından sonra açık sekmede "Yeni sürüm hazır." çıkıyor mu,
   "Yenile" yeni sürümü getiriyor mu (Pages'te gerçek bir yayınla; burada yerel vekille sınandı).
7. **Metinler 360 px'te:** "Kaydet"/"Paylaş" yan yana, kaydırma yok, büyük yazı tipi ayarında.

Burada hiç denenmeyenler: **iOS Safari** (Mac/iPhone yok, K04): paylaşma, "Ana Ekrana Ekle"
ipucu, iOS'ta service worker ve çevrimdışı açılış; iOS'ta indirilen dosyanın "Dosyalar"a gittiği
varsayım. **Gerçek paylaşma hedefleri** (WhatsApp, Instagram, Drive, Windows paylaşma penceresi):
yalnızca sahte `navigator.share` ile ve menünün açıldığını gösteren ölçümle. Gerçek
`beforeinstallprompt` (Playwright'ın headless tarayıcısı göndermiyor; sahte olayla sınandı).
Masaüstü Chrome'da "Paylaş" düğmesi Windows paylaşma penceresini açar; bu pencere de elle denenmedi.

## Bilinen sınırlar

- Yeni sürüm arka planda kurulup başka bir sekme "Yenile"ye basarsa, eski sürümde açık kalan
  sekmenin sonradan yükleyeceği (tembel) dosyalar önbellekte yoktur; çevrimiçiyken ağdan gelir,
  çevrimdışıyken o sekmeyi yenilemek gerekir (nadir: iki sekme + yayın + internet kesilmesi).
- Ağ 4 sn'den yavaşsa yeni bir yayın varken saklanan (eski) sayfa açılabilir; worker yeni sürümü
  arka planda kurar ve not çıkar.
- İlk ziyaret: worker o sayfayı kontrol etmez; internet o ilk açılıştan sonra kesilirse aynı
  sayfada dışa aktarma worker'ı yine önbellekten gelir (Chrome'da worker kendi adresiyle eşlenir),
  ama sayfanın kendi tembel dosyaları gelmez. Yenileme (ya da yeniden açma) yeterli.
