# ADR-047 — "LiloCut'a paylaş": telefonun paylaşma menüsünden gelen video (Web Share Target)

> Tarih: 2026-10-17 · Durum: UYGULANDI (kurucu onayı: özellik; ekran, var olan açılış ekranına bir ekleme —
> veto için ekran görüntüleri [docs/ux/2026-10-17-paylas](../ux/2026-10-17-paylas/README.md)).
> [ADR-031](ADR-031-phone-share-install-offline.md)'in manifest'ine ve service worker'ına bir hedef ekler;
> [ADR-034](ADR-034-task-first-home.md)'ün açılış ekranına "elde bir video" hâli. Şema (EDL v2) ve politika
> (`2026-10-17.v11`) **değişmedi**: paylaşılan video seçilen bir videoyla aynı sınırlardan geçer (sihirbazın
> kendi retleri). Gizlilik: [veri envanteri](../privacy/DATA_INVENTORY.md) §2.9, `/gizlilik` "Paylaştığın video".

## Neden

Telefonda bir videoyla bir şey yapmak isteyen kişi galeridedir. Bugüne kadar yol: galeriden çık, uygulamayı aç,
işi seç, "Videonu seç", galeride aynı videoyu yeniden bul. Hedef ("bir çocuk istediğini yapabilsin"): galeride
**Paylaş → LiloCut**, uygulama o videoyla açılır ve "Bu videoyla ne yapmak istiyorsun?" diye sorar; karta
dokununca iş, video açık, bir sonraki adımda.

## Akış (Android, yüklü uygulama)

1. Galeri / WhatsApp / Dosyalar → bir video → **Paylaş** → **LiloCut** (manifest `share_target`; Android bu
   hedefi yalnız yüklü uygulamada, yalnız video için gösterir).
2. Chrome uygulamayı açar ve videoyu `POST <base>/paylas/` (`multipart/form-data`, alan `video`) olarak verir.
3. Uygulamanın **service worker'ı** bu isteği **cihazda** alır (GitHub Pages POST alamaz; istek ağa hiç çıkmaz):
   paylaşımın ilk videosunu Cache Storage'a (`clip-shared`) koyar, **303** ile `<base>/?paylasim=<id>`'e yönlendirir.
4. Açılış ekranı: **"Bu videoyla ne yapmak istiyorsun?"**, videonun küçük resmi, adı, süresi, "Başka bir video
   seç"; altında arama ve bütün kartlar. Her kart (ve aramanın "Başla"sı) `/yap/<iş>?paylasim=<id>` açar.
5. Sihirbaz videoyu alır ve hemen açar — "Videonu seç" adımı yok; "Kes" doğrudan editör, "GIF yap" Adım 2 / 3.
   Saklanan kopya **o anda silinir**; adres sorgusunu kaybeder (yenileme = sihirbazın kendi ilk adımı).
6. "Ana ekrana dön": video hâlâ elde (bellekte), başka bir iş aynı videoyla.

## Kararlar

### 1. Manifest

```json
"share_target": { "action": "<base>/paylas/", "method": "POST", "enctype": "multipart/form-data",
                  "params": { "files": [{ "name": "video", "accept": ["video/*"] }] } }
```

- **Yalnız `video/*`.** `image/gif` (ve resimler) **alınmaz**: uygulama resim açmaz; GIF onun yaptığı bir şeydir,
  düzenlediği değil. Android hedefi resim paylaşımında göstermemeli (telefonda bakılacak, 2); yine de bir resim
  gelirse worker onu almaz ve ekran söyler.
- `title` / `text` / `url` alınmaz (videoyla gelen bir açıklama yazısı işe yaramaz ve saklanmamalı).
- Adres `<base>/` kapsamında; Pages'te `/capcut/paylas/`, e2e'de `/paylas/` (`withBasePath`, tek sabit:
  `SHARE_ACTION_PATH`). **Kurulabilirlik:** Chrome'un `Page.getInstallabilityErrors` ve `Page.getAppManifest`
  hataları **0** (e2e `/` altında, Pages duman testi `/capcut/` altında; `share_target` Chrome'un manifest
  denetiminden geçiyor).

### 2. Service worker: POST'u kim alır, nereye koyar

Kod tek yerde, iki tarafın ortak modülü: **`web/scripts/lib/share-target.mjs`** — içe aktarma yok, düz fonksiyonlar.
`build-sw.mjs` onu `export` sözcükleri çıkarılarak `sw.js`'e yazar (`precache.mjs` `withShareInbox` /
`inlineModule`; içinde `import`/`export` kalırsa derleme durur); sayfa tarafı (`src/adapters/pwa/sharedVideo.ts`)
aynı modülü içe aktarır. Önbelleğin sürüm adı bu kodu da kapsar (değişirse yeni `clip-app-*`).

- Worker yalnız şu isteği alır: `POST`, `mode: navigate`, aynı köken, yolu `<base>/paylas` (eğik çizgili ya da
  çizgisiz). Başka her POST eskisi gibi tarayıcınındır (birim testi).
- `request.formData()` → bütün alanlardaki dosyalar, gönderen uygulamanın sırasıyla → **ilk video** (tür
  `video/*`; türü boş ya da `application/octet-stream` ise uzantı: mp4, mov, m4v, 3gp, webm, mkv, …).
- Önce eski paylaşım silinir (**tek kayıt**), sonra `cache.put('<base>/paylas/dosya/<id>', new Response(video))`;
  başlıklarda ad (URL kodlu), tür, değiştirilme tarihi, paylaşım anı, gelen dosya sayısı. `<id>` = an (36'lık) +
  6 rastgele harf.
- Yanıt `Response.redirect(<base>/?paylasim=<id>, 303)`: tarayıcı GET ile izler; yenileme videoyu yeniden göndermez.
- Video yok → `?paylasim-hata=video-degil`; hiç dosya yok → `bos`; form okunamadı → `okunamadi`; `cache.put`
  `QuotaExceededError` → `yer` (yarım kopya silinir); beklenmeyen her hata → `okunamadi` — paylaşım asla
  tarayıcının "siteye ulaşılamıyor" sayfasında bitmez.

**Neden Cache Storage (IndexedDB değil, OPFS hiç değil).** (1) Hem worker hem sayfa şemasız erişir; IndexedDB'de
projelerin veritabanı (`clip-editor`, şema 2) var ve ona bir depo eklemek şema sürümü demek. (2) `cache.put` gövdeyi
diske akıtarak yazar; sayfa `response.blob()` ile **diskteki** baytlara bakan bir `File` alır (bellekte kopya yok).
(3) Silmesi tek çağrı, adı ayrı (`clip-shared`): uygulamanın çevrimdışı kopyasının (`clip-app-*`) temizliği, model
deposu (`clip-models-*`) ve "Uygulamayı baştan indir" (ADR-044) ona dokunmaz. OPFS dışa aktarmanın alanı;
kullanıcının projelerinin yanına paylaşılan dosya konmaz.

**`clients.claim()` gerekmiyor.** Gezinme istekleri, sayfa kontrol edilmese de kaydın **kapsamına** göre aktif worker'a
gider. Sorun "worker sayfayı kontrol ediyor mu" değil, "bu tarayıcıda aktif bir worker var mı"dır (aşağıda).

### 3. Silme: paylaşılan videolar birikmez

| Ne zaman | Kim |
|---|---|
| Bir iş videoyu aldığında, hemen | Sihirbaz (`takeVideoForWizard` → `forgetShare`) |
| "Başka bir video seç" | Açılış ekranı |
| Hiçbir işe dokunulmadı: paylaşımdan **15 dk** sonra | Açılış ekranının zamanlayıcısı |
| Uygulamanın **her açılışı** | Her sayfa (`PwaClient` → `sweepShares`): adresinin göstermediği bütün paylaşımlar, gösterdiği 15 dk'dan eskiyse o da |
| Worker'ın her etkinleşmesi | 15 dk'dan eski olanlar |
| Yeni paylaşım | Worker, eskisini |

Son kayıt gidince önbellek de silinir; hiç paylaşım yapılmamış tarayıcıda `clip-shared` hiç oluşmaz (bakmak
`caches.has` ile; `caches.open` oluştururdu). **15 dakika:** paylaşımla iş seçimi arası saniyeler–dakikalardır; 15 dk
bir telefon görüşmesine yeter, kopyayı da bir film izleme süresince tutmaz. Bellekteki video zamanlayıcıdan sonra
da çalışır (e2e: 15 dk 30 sn sonra kopya yok, "Her yerde açılsın" yine videoyla açılıyor).

**Silinen kopyadan okunan `File`.** Chrome, önbellek kaydı silinse de sayfanın elindeki blob'un diskteki verisini
tutar. Ölçüldü (e2e, Playwright Chromium): kopya silindikten **sonra** GIF bu dosyadan yapıldı ve kaydedildi;
"Kes" aynı dosyayla editörü açtı. Telefonda bakılacak (aşağıda, 3).

### 4. Açılış ekranı

- `HomeIntro` (istemci bileşeni) başlığı ve elde video varsa kutuyu çizer; sayfa önce statik HTML'dir ve paylaşımı
  bilmez — bugünkü ekranı çizer, saklanan kopya okununca (birkaç ms) kutu gelir.
- Kutu: `<video src="blob:…#t=0.1" muted preload="metadata">` (96 px, `aria-hidden`; resim süsü, ad metin),
  ad (`safeFileName`, 48 harf), süre (`formatLengthShort`: "24,0 sn"), "Bir iş seç; video onda açılır.",
  "Başka bir video seç" (≥ 44 px; dosya seçme penceresi; seçilen video yalnız bellekte tutulur, `?paylasim=secilen`).
  Bölgenin adı "Paylaştığın video" / "Seçtiğin video". Açılış ekranı yine mediabunny yüklemez, worker başlatmaz.
- Birden çok dosya: "3 dosya paylaştın. Bir seferde bir video açılır: ilk videoyu aldım. Ötekiler için onları tek tek
  paylaş."
- Video olmayan / boş / okunamadı / yer yok / artık yok: başlık ve kartlar her zamanki gibi, lede'in altında tek
  cümle (sırasıyla): "Paylaştığın dosya bir video değil. Bu uygulama yalnızca videolarla çalışır: galeriden bir
  video paylaş." · "Paylaşımdan bir dosya gelmedi. …" · "Paylaştığın video okunamadı. Aşağıdan bir iş seçip videoyu
  galeriden seç." · "Paylaştığın videoyu açacak kadar boş yer yok. Telefonunda biraz yer aç ya da aşağıdan bir iş
  seçip videoyu galeriden seç: öyle açınca kopyası alınmaz." · "Paylaştığın video artık burada değil. Yeniden
  paylaş ya da aşağıdan bir iş seçip videonu seç."
- Kartlar ve arama `withHeldVideo(href)`; ADR-044'ün 10 sn tam yükleme yedeği sorguyu korur (`fullPageHref`,
  eğik çizgi sorgudan önce: `/capcut/yap/gif/?paylasim=…`; birim testi).

### 5. Sihirbaz

`WizardFlow` (bütün on bir sihirbazın ortak çatısı) sayfa canlanınca bir kez: adres `?paylasim=<id>` diyorsa
videoyu **bellekten** (yumuşak gezinme) ya da **saklanan kopyadan** (tam sayfa yüklemesi: çevrimdışıyken kartlar
tam yüklemeye düşer — ADR-031; ADR-044'ün 10 sn yedeği) alır ve sihirbazın kendi `pick` yolundan açar (editörün
retleri — çok büyük, çok uzun, okunamıyor, HEVC ipucu — aynen). Kopya silinir, adres sorgusuz olur. Kopya yoksa
seçme adımında: "Paylaştığın video artık burada değil. Videonu buradan seç."; ana ekranda seçilen video tam
yüklemede kaybolduysa: "Ana ekranda seçtiğin video bu sayfaya gelemedi. Videonu buradan yeniden seç."

### 6. Uygulama hazır değilken (bu tarayıcıda service worker yok)

**Ne oluyor (ölçülen):** worker yokken POST ağa, sitenin sunucusuna gider — **video gövdesiyle**. e2e (`next start`):
istek `POST /paylas/ multipart/form-data` olarak sunucuya ulaşıyor (308 ile `/paylas`'a bir kez daha), yanıt Next'in
"Server action not found." sayfası; tarayıcıda hiçbir şey saklanmıyor. Pages duman testi: `serve-static.mjs` POST'a
405 veriyor (GitHub Pages'in POST'a "405 Not Allowed" verdiği **bildiriliyor; canlı sitede doğrulanmadı** —
aşağıdaki komut).

**Statik bir açıklama sayfası neden yok.** İlk taslakta `/paylas/` bir sayfaydı ("Uygulamayı bir kez açıp yeniden
paylaş"). Ölçümde hiçbir sunucu onu POST'a göstermedi: `next start` POST'u sunucu eylemi sanıp kendi hatasını
veriyor, statik bir dosya sunucusu POST'u reddediyor. Kimsenin GET'le açmadığı bir sayfa yalnızca yük olurdu;
kaldırıldı. Bu durumda telefonda görünen, **sunucunun kendi hata sayfasıdır**; orada bizim hiçbir kodumuz yok.

**Ne zaman olur.** Paylaşma hedefi yalnız yüklü uygulamada vardır ve yükleme, siteyi açmış (worker'ı kaydetmiş)
bir tarayıcıda olur. Worker'ın sonradan olmaması: kullanıcı site verisini temizledi (`github.io` kökeni başka
Pages siteleriyle ortak), tarayıcı disk dolunca kökenin verisini sildi, worker kurulamadı (disk dolu: o zaman
paylaşım da sığmazdı). Bir de ilk yayının dar anı: eski worker etkinken telefonun uygulaması yeni manifest'le
güncellenirse eski worker POST'u tanımaz (uygulama kapanıp açılınca yeni worker devreye girer).

**Yapılabilecek, yapılmayan (kurucu kararı, aşağıda).** `navigator.storage.persist()`: yüklü uygulamada Chrome çoğu
zaman sormadan verir ve tarayıcının disk dolunca silmesini önler (projeleri de korur). Kullanıcının kendi
temizlemesini önlemez.

### 7. Masaüstü ve diğer tarayıcılar

Paylaşma hedefi olmayan her yerde (masaüstü Chrome/Edge/Firefox, iOS) hiçbir şey değişmez: manifest alanını
tanımayan tarayıcı yok sayar; adreste `?paylasim` yoksa açılış ekranı bugünkü HTML'in aynısıdır. Kalite katmanının
görsel karşılaştırması: tabanından farklı ekran 0 (Sonuçlar).

## Değişen dosyalar

- Yeni: `web/scripts/lib/share-target.mjs` (+ `.d.mts`), `web/src/adapters/pwa/sharedVideo.ts`,
  `web/src/components/home/HomeIntro.tsx`, testler `web/tests/unit/shareTarget.test.ts`,
  `web/tests/e2e/share-target.spec.ts`, `web/tests/e2e/shareKit.ts`.
- Değişen: `web/src/app/manifest.ts`, `web/scripts/lib/service-worker.js`, `web/scripts/lib/precache.mjs`,
  `web/scripts/build-sw.mjs`, `web/src/app/page.tsx`, `web/src/app/home.css`, `TaskFinder.tsx`,
  `navigationFallback.ts`, `WizardFlow.tsx`, `PwaClient.tsx`, `PrivacyPage.tsx`, `messages.ts` / `.en.ts`,
  `cloudMessages.ts` / `.en.ts`, `web/scripts/serve-static.mjs` (POST → 405).
- CSP değişmedi (`form-action 'none'` kalıyor: paylaşım bizim bir formumuz değil, tarayıcının gezinmesi).
- Politika (belge 15 / `policy.ts`): ek yok — paylaşılan video seçilen videoyla aynı sınırlardan geçer.

## Testler

- **Birim** `shareTarget.test.ts`: hangi dosya video (tür, uzantı, yanlış ad), ilk video + sayım, yönlendirme
  adresleri ve işaretin geri okunması (kötü biçimli id reddi), kartın adresi; `receiveShare` gerçek `FormData` /
  `File` / `Response` ve bellekte bir Cache Storage ile: saklanan kayıt ve başlıkları, tek kayıt, video yok / boş /
  okunamadı / yer yok (hiçbir şey kalmaz, önbellek oluşmaz); `sweepShares` (sayfa açılışı: yalnız adresindeki ve
  taze olan kalır; 15 dk sınırı; worker etkinleşmesi yalnız eskiyi siler; ait olmayan kayıt), `forgetShare`, zamanlayıcı
  süresi; modülün düz betik olarak ayrıştırılması. `serviceWorker.test.ts`: üretilen worker'ın kendisi — POST
  `/capcut/paylas/` ve `/capcut/paylas` 303 + kayıt, ağ isteği yok; video olmayan paylaşım; başka her POST
  bırakılır; etkinleşme süpürmesi. `navigationFallback.test.ts`: sorgulu tam yükleme adresi.
- **e2e** `share-target.spec.ts` (gerçek worker, gerçek Cache Storage; paylaşım boş bir sayfadan uygulamanın
  adresine çok parçalı POST gezinmesi — Android'in yaptığı istek): paylaşılan video ekranda (ad, süre, kutu, 11
  kart videoyla), "GIF yap" Adım 2 / 3'te, kopya o an siliniyor, GIF silinen kopyadan yapılıp kaydediliyor, ana
  ekrana dönünce video elde, "Kes" editörü açıyor; tam sayfa yüklemesiyle "Kes" saklanan kopyadan; üç dosya → ilk
  video + cümle; resim → ret cümlesi, saklanan yok, axe 0; 15 dk (sayfa saati) → kopya yok, bellekteki video
  çalışıyor; sonraki açılış → kopya yok; artık olmayan paylaşım (açılış ekranı + sihirbaz + seçilen video);
  "Başka bir video seç" + arama + "Bunu henüz yapamıyoruz."; a11y 360 ve 1440 px (axe 0, yatay kaydırma yok,
  düğme ≥ 44 px); worker yok → POST sunucuya, hiçbir şey saklanmıyor. `pwa.spec.ts`: manifest'te `share_target`;
  kurulabilirlik 0 hata. `privacy.spec.ts` / `transcript-keep.spec.ts` / bulut `cloud-keep.spec.ts`: "Paylaştığın
  video" kartı (TR + EN; bulut ek cümlesi yalnız bulut derlemesinde).
- **Pages duman testi** (`/capcut/`): manifest `action` `/capcut/paylas/`, worker'dan geçen paylaşım
  `/capcut/?paylasim=…`, kart `/capcut/yap/dikey/?paylasim=…`, sihirbaz Adım 2'de, kopya silindi, kökten çıkan
  istek yok; worker yok → 405.

## Sonuçlar — Doğrulama (17 Ekim 2026, bu makine, son kodla, ölçüm kilidi altında)

| Komut | Sonuç |
|---|---|
| `npx tsc --noEmit -p .`, `npx eslint .` | hatasız |
| `npx vitest run` | 90 dosya, **1548 / 1548** (+17: `shareTarget.test.ts` 13, `serviceWorker.test.ts` 4) |
| Olağan e2e (`CLIP_TEST_HOOKS=1` derlemesi, `E2E_PORT=3194`) | **458: 454 geçti, 4 atlandı, 0 başarısız**, 29,0 dk; `PAGE-RECOVERED-TOTAL 0`, `PAGE-DEAD-TOTAL 0` (bekçinin kendi sınamalarının bilerek yaptıkları: 9 / 2) |
| Bulut e2e (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL=http://127.0.0.1:38197` derlemesi) | **59: 55 geçti, 4 atlandı**; `PAGE-RECOVERED-TOTAL 0` |
| Durağan çıktı (`/capcut`, CI ortam değişkenleri) + Pages duman testi (`PAGES_PORT=3198`) | **15: 9 geçti, 6 atlandı** (model dosyası ve bulut ön uçuşu isteyenler; yeni paylaşım sınaması geçti) |
| `npm run quality` | 676 ölçü: 598 bütçe içinde, 8 dışında (önceden açık olanlar), farklı ekran **0** (taban yenilenmedi); ana ekran aktarılan JS 184 → 188 KB |

Ekran görüntüleri bu dalın test kancalı derlemesinden (`docs/ux/2026-10-17-paylas/`).

## Telefonda bakılacaklar (ana oturum; kurucunun Galaxy S23'ü)

Paylaşma hedefi yalnız **WebAPK** olarak yüklü uygulamada vardır; Chrome `localhost` (adb reverse) için WebAPK
yapmaz, yani deneme **yayındaki sitede** olur (bu dal yayınlandıktan sonra).

0. `curl -i -X POST -d x=1 https://erenulutas0.github.io/capcut/paylas/` ve `curl -i -X POST -d x=1
   https://erenulutas0.github.io/capcut/` — GitHub Pages POST'a gerçekten 405 mi veriyor, yoksa (yolu olmayan
   adreste) 404 sayfasını mı? Sonuç bu belgeye ve envanter §2.9'a yazılmalı.
1. **Kurulum (kurucu yapar):** uygulama zaten yüklüyse manifest değişikliği WebAPK'ya ancak Chrome uygulamayı
   güncelleyince (günler sürebilir) gelir → en sağlamı: uygulamayı kaldır, Chrome'da
   `https://erenulutas0.github.io/capcut/` aç, 10 sn bekle (worker kurulsun), ⋯ → "Uygulamayı yükle".
2. Galeri → kısa bir video → Paylaş: listede **LiloCut** var mı (simge, ad). Resimde **yok** mu.
3. Paylaş → uygulama açılıyor mu, ne kadar sürede; "Bu videoyla ne yapmak istiyorsun?", resim, ad, süre.
   CDP (`adb forward tcp:9222 localabstract:chrome_devtools_remote`; WebAPK sekmesi Chrome hedefi olarak görünür,
   yalnız kendi sekmemiz): `location.search` `?paylasim=`, `await caches.keys()` içinde `clip-shared`.
4. "GIF yap" → Adım 2 / 3, video açık; `caches.has('clip-shared')` → `false`; GIF'i indir → kaydedildi.
   (Silinen kopyadan okunan dosyanın telefonda da okunabildiğinin kanıtı.)
5. "Ana ekrana dön" → video hâlâ orada → "Kes" → editör videoyla.
6. WhatsApp'tan gelen bir videoyu ve Dosyalarım'dan bir videoyu paylaş (türü `video/mp4` mi geliyor).
7. Galeride **üç video** seçip paylaş → ilk video + "3 dosya paylaştın…" cümlesi (Android hangi sırayla veriyor).
8. **Büyük video** (1080p 3–5 dk, 300 MB+; 4K / HEVC Samsung kaydı): paylaşımdan ekrana süre; Chrome çöküyor mu;
   worker'ın POST'u (Chrome bir worker olayına ~5 dk verir) yetişiyor mu; disk dolduğunda "yer yok" cümlesi.
9. Uygulama açıkken (bir indirme sürerken) yeniden paylaş: Android aynı pencereyi mi kullanıyor, indirme ne oluyor.
10. Uçak modunda paylaş → çalışmalı (worker cihazda).
11. Paylaşıp hiçbir şeye dokunmadan uygulamayı kapat, sonra simgesinden aç → `clip-shared` yok.
12. Samsung Internet'ten yüklenmiş uygulamada paylaşma hedefi var mı (bilinmiyor).
13. Bittiğinde: kendi sekmelerimiz dışında hiçbir şeye dokunmadan site verisi temizliği (phone-cleanup.mjs).
    **Worker yok** durumu telefonda denenmemeli: `github.io` verisini temizlemek kurucunun başka Pages sitelerini de siler.

## Doğrulanmayan

- Gerçek Android paylaşma menüsü, WebAPK, büyük dosya, bellek, Samsung Internet (yukarıdaki liste).
- GitHub Pages'in POST'a verdiği yanıt (405 varsayımı; `serve-static.mjs` onu taklit ediyor).
- Silinen önbellek kaydından okunan `File`'ın Android Chrome'da da okunabilir kalması (masaüstü Chromium'da ölçüldü).
- iOS (Safari'de Web Share Target yok; değişen bir şey olmamalı).

## Kurucu kararları

1. **Ekran** (veto): [docs/ux/2026-10-17-paylas](../ux/2026-10-17-paylas/README.md) — kutunun yeri; elde video
   varken örnek cümleler gizlensin mi (telefonda kartlar ~150 px yukarı gelir).
2. **Worker yokken** paylaşım sitenin sunucusuna gider ve sunucunun hata sayfasında biter (nadir; §6). Seçenekler:
   (a) olduğu gibi + belge (şimdiki); (b) yüklü uygulamada `navigator.storage.persist()` (tek satır; tarayıcının
   disk dolunca silmesini önler, projeleri de korur); (c) curl GitHub'ın yolu olmayan adrese POST'ta 404 sayfası
   verdiğini gösterirse, 404 sayfasına "uygulamayı bir kez aç, yeniden paylaş" cümlesi.
3. **15 dakika** (hiç dokunulmayan kopyanın ömrü) uygun mu.
4. **Yalnız video** (`video/*`; resim ve GIF alınmaz).
