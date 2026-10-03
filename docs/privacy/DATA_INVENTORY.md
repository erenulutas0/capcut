# Veri envanteri — web editörü (yerel beta)

> Tarih: 2026-09-22 · Durum: KODDAN ÇIKARILDI, HUKUKİ İNCELEME YOK
> Kapsam: `web/` (Next.js, yalnızca istemci tarafı editör). Roadmap P2-04, lansman listesi §B
> "Privacy/terms ve SDK veri envanteri gerçek davranışla eşleşiyor".
> Veri sorumlusu, iletişim, hukuki dayanak ve barındırma sağlayıcısı **belirlenmedi** (belge 30 K02).

Bu belge "ne yapmayı planlıyoruz" değil, **kodun bugün ne yaptığıdır**. Her satır bir dosyaya
dayanır; bir davranış değişirse önce bu belge ve `/gizlilik` sayfası (`web/src/components/PrivacyPage.tsx`,
metinler `web/src/i18n/messages.ts` içindeki `privacy.*`) güncellenir. Ağ bölümü otomatik testle
doğrulanır (`web/tests/e2e/privacy.spec.ts` → "nothing leaves the machine").

## 1. Özet

| Soru | Cevap | Kanıt |
|---|---|---|
| Kullanıcı medyası sunucuya gider mi? | Hayır. `File` nesneleri yalnızca sayfa ve worker'lar arasında structured clone ile taşınır. | `web/src/adapters/export/protocol.ts`, `web/src/adapters/silence/protocol.ts`, e2e testi |
| Hesap / oturum? | Yok. | Kodda auth yok |
| Analitik, hata raporlama servisi, reklam? | Yok. Üçüncü taraf script yok. | `web/next.config.ts`, `web/src/app/layout.tsx`, `package.json` bağımlılıkları |
| Çevrimdışı kopya? | Evet, 30 Eylül 2026'dan beri (ADR-031): bir service worker uygulamanın **kendi dosyalarını** (sayfalar, derleme dosyaları, altyazı yazı tipi, simgeler, manifest) Cache Storage'da tutar ki site internetsiz açılsın. Medya, dışa aktarılan dosya, proje ya da başka bir origin'in dosyası bu önbelleğe girmez (§2.5). | `web/scripts/lib/service-worker.js`, `web/scripts/lib/precache.mjs`, e2e `pwa.spec.ts` |
| Çerez, localStorage, sessionStorage? | Çerez ve sessionStorage kullanılmıyor. localStorage'da yalnızca ilk kullanım ipucunun kapatıldığı (`clip.firstRunHint.dismissed` = `1`) durur, o da yalnızca kullanıcı "Anladım"a basınca yazılır (§2.4). e2e testi ipucu kapatılmamış oturumun sonunda üçünün de boş olduğunu, kapatınca yalnızca o anahtarın yazıldığını doğrular. | `web/src/components/editor/FirstRunHint.tsx` + e2e testleri |
| Cihaz parmak izi? | Yok. Tanı dosyasındaki tarayıcı bilgisi yalnızca kullanıcı indirirse oluşur ve kendiliğinden gönderilmez. | `web/src/adapters/diagnostics.ts` |
| Model dosyası / AI? | Bu sürümde yok. | — |
| Kendiliğinden gönderilen bir şey? | Yok. Uygulama kodunda `fetch`/XHR/WebSocket/beacon yok; tek `fetch` benzeri işlem tarayıcının yazı tipi yüklemesi (aynı origin; editör yüklendikten sonra, tarayıcı boştayken — `useCaptionFont.ts`). | `grep -rn "fetch(" web/src` boş; e2e testi |
| Sayfa başka bir adrese bağlanabilir mi? | Tarayıcı engeller: her sayfada Content-Security-Policy (`default-src 'self'`, `connect-src 'self'`, script yalnız aynı origin + derleme anındaki satır içi betik hash'leri). Dışarı giden bağlantılar Referer taşımaz (`no-referrer`). | `web/scripts/apply-csp.mjs`, `docs/security/2026-09-30-static-site-hardening.md`, e2e `csp.spec.ts` |

## 2. Bu tarayıcıda kalıcı saklananlar

### 2.1 IndexedDB `clip-editor` — şema sürümü 2

Şema tek yerde tanımlı: `web/src/adapters/localDb.ts` (`DB_VERSION = 2`, `upgradeSchema`).
Yükseltme yalnızca store **ekler**; v1 veritabanındaki proje korunur (birim testi
`web/tests/unit/exportLog.test.ts` → "database upgrade", gerçek tarayıcıda e2e
`privacy.spec.ts` → "upgrading a v1 database keeps the saved project and adds the log store").
Başka sekmede daha yeni sürüm açılırsa bağlantı `versionchange` ile kapanır ve bir sonraki
kullanımda yeniden açılır.

**Store `projects`** (keyPath `projectId`) — `web/src/adapters/projectStore.ts`,
kayıt biçimi `web/src/domain/projectRecord.ts` (`ProjectRecord`). Otomatik kayıt
500 ms debounce ile (`web/src/components/editor/useProjectPersistence.ts`).

| Alan | İçerik | Kişisel veri olabilir mi |
|---|---|---|
| `recordVersion`, `projectId`, `createdAt`, `updatedAt` | Sürüm, yerel sabit kimlik (`p_local_001`, `web/src/application/commands.ts`), zaman damgaları | Zaman damgası |
| `title` | Kullanıcının yazdığı proje adı | **Evet** (serbest metin) |
| `edl` | Düzenleme tarifi: anlar (kaynak giriş/çıkış), sıralama, kadraj/oran, kazanç, müzik ayarları, **altyazı satırlarının metni** ve biçimi (`web/src/domain/edl.ts`) | **Evet** (altyazı metni serbest metin) |
| `bindings[]` | Her kaynak için: `fileName`, `sizeBytes`, `lastModified`, `durationUs`, `displayWidth/Height`, `mimeType`, `fingerprint` (FNV-1a, içerik hash'i değil), `lastSeenAt` | **Evet** (dosya adı) |

Medya baytı, blob URL, base64 **yok** (`projectStore.ts` başlık yorumu; kayıt `JSON.parse(JSON.stringify())` ile düz JSON).
Silme: tarayıcının site verisini temizlemek; kaynak dosya istendiğinde "Kayıtlı projeyi sil"
(`RelinkPanel` → `useProjectPersistence.forget`). Tarayıcı depolamayı kendisi de boşaltabilir.

**Store `exportLog`** (keyPath `id`, autoIncrement) — yeni, bu değişiklikle eklendi.
Alanlar `web/src/domain/exportLog.ts` (`ExportLogEntry`), yazma `web/src/components/editor/useExport.ts`
(`logAttempt`), depolama `web/src/adapters/exportLogStore.ts`.

| Alan | İçerik |
|---|---|
| `at` | Denemenin bittiği an (ISO) |
| `outcome` | `succeeded` / `failed` / `canceled` |
| `failureCode` | Yalnızca başarısızlıkta; `ExportFailureCode` enum'u (snake_case desenle doğrulanır) |
| `outputDurationMs` | Başarılıysa üretilen dosyadan ölçülen, değilse planlanan süre |
| `width`, `height` | Çıktı çözünürlüğü |
| `route` | `opfs` / `memory`; yalnızca dosya üretildiyse |
| `elapsedMs` | Sayfa tarafında başlangıçtan son olaya kadar geçen süre |
| `planPrefix` | Render planı parmak izinin ilk 9 karakteri (`fp_` + 6 hex); aynı tarifin denemelerini eşleştirmek için. Sayılardan oluşan bir FNV hash'inin öneki; tarife geri çevrilemez |

Dosya adı, proje adı, altyazı metni, medya **yok** — serbest metin alanı tanımlı değil; okurken
`sanitizeExportLogEntry` yalnızca bilinen alanları kopyalar. En fazla 20 kayıt: her eklemeden
sonra eskiler silinir (birim testi + gerçek IndexedDB'de e2e "keeps only the last 20 attempts").
Silme: `/gizlilik` sayfasında ve "Sorun bildir" penceresinde **"Günlüğü temizle"**
(`web/src/components/ExportLogPanel.tsx`). Kayıt başarısız olursa dışa aktarma etkilenmez.

### 2.2 OPFS (tarayıcının özel dosya sistemi) — geçici dışa aktarma dosyası

- Ne: dışa aktarılan MP4, `clip-export-<requestId>.mp4` (`web/src/adapters/export/opfsEntries.ts`,
  `EXPORT_ENTRY_PREFIX`). Yalnızca tarayıcı worker içinde senkron erişim sunuyorsa ve
  `navigator.storage.estimate()` dosyanın iki katı boş alan gösteriyorsa kullanılır; yoksa
  dosya bellekte tutulur (`web/src/adapters/export/outputSink.ts`, ADR-013).
- Ne zaman silinir:
  1. başarısız/iptal edilen denemede hemen (`outputSink.ts` `discard`, `exportWorker.ts` ~739);
  2. indirme artık sunulmadığında: dışa aktarma penceresi kapanınca, yeni kontrol/dışa aktarma
     başlayınca veya editör unmount olunca (`useExport.ts` `releaseUrl`);
  3. yeni bir dışa aktarma başlarken worker'ın önceki dosyaları (`exportWorker.ts` ~552);
  4. sekme kapanır/çökerse: editör bir sonraki açılışta ve her dışa aktarma başında
     **6 saatten eski** `clip-export-*` dosyalarını siler (`STALE_AFTER_MS`, `sweepExportEntries`).
- e2e kanıtı: `web/tests/e2e/editor.spec.ts` → "writes the output to temporary storage and removes it afterwards".

### 2.3 Bellek (yalnızca açık sekme)

| Ne | Nerede |
|---|---|
| Seçilen dosyalar için `blob:` URL'leri (önizleme) | `web/src/adapters/browserMedia.ts` |
| Sessizlik bulucunun ses yüksekliği zarfları; anahtar `dosyaAdı|boyut|lastModified|aralık`, en çok 200 | `web/src/adapters/silence/silenceClient.ts` (`sessionCache`) |
| Bellek rotasında üretilen MP4 baytları (indirme sunulduğu sürece) | `useExport.ts` |
| Son yetenek kontrolünün aşama sonuçları ve bu oturumda görülen hata **kodları** (en çok 30) | `web/src/adapters/diagnostics.ts` |
| Undo/redo geçmişi, editör durumu | `web/src/application/history.ts`, `useEditorState.ts` |

Oturum hata kodları: medya (`error.*` sebepleri), düzenleme, depolama, sessizlik, dışa aktarma,
yetenek engelleri, plan retleri ve yakalanmamış hatalar. Yakalanmamış hatalarda **mesaj
tutulmaz**, yalnızca sınıf adı (`TypeError` → `type_error`), çünkü mesaj dosya adı veya altyazı
alıntılayabilir. Kod olmayan her değer (`^[a-z][a-z0-9_]{0,63}$` dışı) kayda girmeden atılır.

### 2.4 localStorage — ilk kullanım ipucu (2026-09-30, UX denetimi)

Tek anahtar: `clip.firstRunHint.dismissed`, değeri `1`. Editördeki "Nasıl kesilir? Üç adım"
ipucunda "Anladım"a basınca yazılır; ipucu bir daha gösterilmez. Kimlik, proje, dosya adı ya da
zaman içermez; hiçbir yere gönderilmez. Tarayıcı depolamayı reddederse (gizli pencere, site verisi
engelli) okuma ve yazma `try/catch` içindedir: ipucu yine görünür, "Anladım" onu o sayfa açık
kaldıkça gizler. Silinmesi: tarayıcının site verisini temizlemek. Kaynak:
`web/src/components/editor/FirstRunHint.tsx`; test: `web/tests/e2e/kesit.spec.ts` → "first-time
user".

### 2.5 Cache Storage ve service worker — çevrimdışı kopya (2026-09-30, ADR-031)

- **Ne:** tek önbellek, adı `clip-app-<sürüm>` (sürüm = saklanan dosyaların baytlarından ve
  worker kodundan hesaplanan 16 hex karakter). İçinde yalnızca derleme anında çıkarılan liste var
  (`web/scripts/lib/precache.mjs`, `web/scripts/build-sw.mjs`): dört sayfa (`/`, `/editor`,
  `/gizlilik`, `/gizlilik/en`), `/_next/static/` altındaki bütün derleme dosyaları (kaynak
  haritası ve TypeScript kaynağı hariç), `/fonts/caption/*.woff2`, `/icons/*.png`, `/icon.svg`,
  `/apple-icon.png`, `/manifest.webmanifest`. Bu derlemede 4 sayfa + 37 dosya, ~1,9 MB.
- **Ne değil:** kullanıcı medyası, `blob:` adresleri, OPFS dosyaları, dışa aktarılan MP4, proje
  yedeği, altyazı ya da tanı dosyası, başka origin'in herhangi bir dosyası. Worker çalışırken ağdan
  gelen hiçbir yanıtı önbelleğe **yazmaz**; önbellek yalnızca kurulumda listeyle dolar. POST ve
  `Range` istekleri, başka origin'ler, liste dışı adresler worker'dan geçmez (tarayıcının kendi yolu).
- **Service worker kaydı:** `<base>/sw.js`, kapsam `<base>/` (Pages'te `/capcut/`). Kendi isteği
  yalnızca kurulumda listedeki dosyalardır, aynı origin'den. Yalnızca üretim derlemesinde
  kaydedilir (`next dev`'de değil). Kaynak: `web/src/adapters/pwa/serviceWorker.ts`.
- **Ne zaman silinir:** yeni sürümün worker'ı etkinleşince eski `clip-app-*` önbellekleri silinir
  (başka adlı önbelleklere dokunulmaz: `github.io` origin'i başka projelerle paylaşılır). Hepsi:
  tarayıcının bu siteye ait verisini temizlemek.
- **Kanıt:** e2e `web/tests/e2e/pwa.spec.ts` — önbelleğin tam olarak sw.js'teki listeye eşit ve
  izinli uygulama yollarından ibaret olduğu; çevrimdışı dışa aktarmadan sonra önbelleğin
  değişmediği (medya yok); `privacy.spec.ts` "nothing leaves the machine" oturum sonunda her
  önbellek girdisinin izinli uygulama yolu olduğu; Pages duman testi `/capcut/` altında aynısı.
  Birim: `web/tests/unit/serviceWorker.test.ts` (liste, sürüm, worker davranışı).

### 2.6 Kullanılmayanlar

`sessionStorage`, çerez: kodda yok (`grep`); e2e oturum testi çerezlerin, `document.cookie`'nin ve
iki web depolamanın (ipucu kapatılmadığı için localStorage da) boş olduğunu doğrular.

## 3. Kullanıcının tetiklediği indirmeler

Hepsi yalnızca düğmeye basınca `blob:` URL ve `<a download>` ile (ya da kaydetme penceresinde seçilen
dosyaya) oluşur; ağ isteği yoktur.

**Paylaş (2026-09-30, ADR-031):** biten video, kullanıcı "Paylaş"a basınca `navigator.share({ files })`
ile işletim sisteminin paylaşma menüsüne verilir; nereye gideceğini (WhatsApp, Drive, kişi…) kullanıcı
orada seçer. Uygulama bu sırada ağa bir şey göndermez ve dosyayı başka yere kopyalamaz; paylaşılan
`File` indirilen dosyanın kendisidir (OPFS'teki dosya ya da seçilen dosya, yeniden adlandırılarak,
kopyasız). Tarayıcı dosya paylaşamıyorsa düğme çizilmez (`web/src/adapters/share.ts`).

| Dosya | İçerik | Kaynak |
|---|---|---|
| `<kaynak-adı>-clip.mp4` | Dışa aktarılan video (anlar, müzik, yakılmış altyazı). Dosya adı kaynak dosyanın adından türetilir. | `useExport.ts` `safeBaseName`, `ExportDialog.tsx` |
| `<proje-adı>.clip.json` | Tam `ProjectRecord`: **proje adı, altyazı metinleri, kaynak dosya adları dahil**. Medya yok. | `useProjectPersistence.ts` `downloadBackup` |
| `<proje-adı>.srt` / `.vtt` | Altyazı satırları ve zamanları | `CaptionTools.tsx` |
| `clip-tani-YYYYMMDD-HHMM.json` | Tanı dosyası (bkz. §5). Adında yalnızca tarih var. | `ReportDialog.tsx`, `domain/diagnostics.ts` |

Not: yedek panelindeki açıklama önceden "yalnızca hangi anları seçtiğini ve ayarlarını taşır"
diyordu; bu gerçek içerikle eşleşmediği için `backup.body` (tr/en) düzeltildi.

### 2.7 Açılış ekranı ve görev sihirbazları (2026-10-03, ADR-034)

Yeni saklanan veri **yok**.

- **Arama kutusu** ("Ne yapmak istediğini yaz"): yazılan metin yalnızca bileşenin belleğinde
  durur (`components/home/TaskFinder.tsx`, React durumu), sayfanın içindeki kelime listesiyle
  eşleştirilir (`domain/taskSearch.ts`, saf fonksiyon) ve hiçbir yere yazılmaz: localStorage,
  IndexedDB, adres çubuğu (sorgu parametresi yok), ağ isteği yok. e2e: yazarken sayfa hiç
  istek yapmaz (`home.spec.ts`).
- **Sihirbazlar** (`/yap/<id>/`): seçilen video ve müzik editördeki gibi yalnızca bellekte
  (§2.3). **Proje tarifi saklanmaz**: sihirbazdan (ya da "Kes" / "Daha fazla ayar → editörde
  aç" ile açılan editörden) IndexedDB `projects` deposuna yazılmaz ve oradan okunmaz; `/editor`'de
  kayıtlı proje yerinde durur (e2e: `wizards.spec.ts`). Dışa aktarma günlüğü (§2.1) ve geçici
  dışa aktarma dosyası (§2.2) editördeki indirmeyle aynı yoldan yazılır.
- Çevrimdışı kopya (§2.5) artık `/yap/kes`, `/yap/bosluk`, `/yap/dikey`, `/yap/muzik`,
  `/yap/cevir` sayfalarını da içerir (yalnızca uygulamanın kendi dosyaları).

## 4. Ağ

### 4.1 Uygulamanın kendi origin'i dışında istek: yok

`web/tests/e2e/privacy.spec.ts` → "a full session contacts only the app origin, and only for app
files" şu oturumu çalıştırır: açılış ekranı (2026-10-03'e kadar tanıtım sayfası) → `/gizlilik` → editör, video içe aktarma, iki an, altyazı
satırı, sessizlik analizi (worker'da ses çözme), SRT indirme, altyazılı gerçek dışa aktarma ve
MP4 indirme, proje yedeği indirme, "Sorun bildir" ve tanı dosyası indirme. İstekler
**context** düzeyinde dinlenir (worker istekleri dahil) ve şunlar doğrulanır:

- origin dışı istek sayısı 0, WebSocket 0;
- origin içi her istek `GET` ve gövdesiz (yükleme/form gönderimi yok);
- origin içi her yol izin listesinde: `/`, `/editor`, `/gizlilik`, `/gizlilik/en`, `/_next/static/**`,
  `/fonts/caption/inter-latin(-ext)-700-normal.woff2`, (varsa) `/favicon.ico` ve `/icon.svg` (site simgesi, 2026-09-30);
  ADR-031 ile `/manifest.webmanifest`, `/icons/{icon-192,icon-512,maskable-512}.png`, `/apple-icon.png`
  ve `/sw.js` (worker'ın kurulum istekleri de bu listenin içindedir);
- oturum sonunda çerez yok, localStorage/sessionStorage boş (bu oturumda ilk kullanım ipucu
  kapatılmaz; kapatılınca yazılan tek anahtar §2.4'te);
- oturum sonunda Cache Storage'daki her girdi `clip-app-*` önbelleğinde ve izinli bir uygulama yolu;
  `.mp4`, `.json`, `.srt`, `blob:` yok (§2.5).

Eski, daha dar test `web/tests/e2e/editor.spec.ts` → "nothing is sent off the machine" de duruyor.

### 4.2 Origin'in sunduğu dosyalar (2026-09-22 ölçümü)

`PRIVACY_LIST_REQUESTS=1` ile aynı test isteği listeler. Görülenler:

- belgeler: `/`, `/editor`, `/gizlilik`, `/gizlilik/en` (ayrıca Next.js `Link` önyüklemesi için aynı
  yollara `?_rsc=` ekli `fetch`);
- `/_next/static/chunks/*.js` ve `*.css`: uygulama kodu, Turbopack çalışma zamanı, export ve
  sessizlik worker'ları (mediabunny kütüphanesi dahil, paketin içinde; uzaktan yüklenmez);
- `/fonts/caption/inter-latin-700-normal.woff2`, `/fonts/caption/inter-latin-ext-700-normal.woff2`
  (Inter Bold, SIL OFL 1.1, `web/public/fonts/caption/OFL.txt`). Hem sayfa (`useCaptionFont.ts`)
  hem export worker (`exportWorker.ts`, origin `isWebOrigin` ile doğrulanır) yükler.

Site simgesi `/icon.svg` (`web/src/app/icon.svg`, 2026-09-30): tarayıcı sekme simgesi için kendisi ister; içinde veri yok.

Uygulama olarak yükleme (ADR-031): `/manifest.webmanifest` (ad, renkler, başlangıç adresi; `web/src/app/manifest.ts`),
simgeler `/icons/*.png` ve iOS için `/apple-icon.png` (logodan üretildi, `web/scripts/generate-app-icons.mjs`),
service worker `/sw.js`. Hiçbirinde kullanıcı verisi yok.

`web/public/` altında bunlardan başka dosya yok (yazı tipleri, lisansı, `icons/`). Sunucunun kendisi (barındırma) IP adresi, zaman ve
user agent'ı her web sitesinde olduğu gibi görebilir; barındırma sağlayıcısı ve erişim
kayıtlarının saklama süresi **belirlenmedi**.

## 5. Tanı dosyası ("Sorun bildir")

Yardım penceresinden ve dışa aktarma engellendi/başarısız durumlarından açılır
(`web/src/components/editor/ReportDialog.tsx`). İçerik indirmeden önce tam olarak gösterilir;
indirilen dosya gösterilen metnin aynısıdır (e2e). **Hiçbir şey otomatik gönderilmez**; bu
yolda ağ kodu yoktur. Gönderim adresi build sırasında `NEXT_PUBLIC_SUPPORT_CONTACT` ile verilir;
boşsa "İletişim adresi henüz belirlenmedi — dosyayı seni betaya davet eden kişiye gönder." yazar.

Alan listesi bir izin listesidir (`web/src/domain/diagnostics.ts` `buildDiagnostics`):

| Bölüm | Alanlar |
|---|---|
| `app` | `version` (package.json), `commit` (build anında `git rev-parse` veya `GIT_COMMIT`; `web/next.config.ts`) |
| `browser` | `userAgent` (≤300 karakter), `platform`, `language`, `hardwareConcurrency`, `deviceMemoryGb` |
| `screen` | ekran genişlik/yükseklik, `devicePixelRatio`, pencere genişlik/yükseklik |
| `features` | secureContext, crossOriginIsolated, Worker, OffscreenCanvas, Video/AudioEncoder, Video/AudioDecoder, OPFS, WebGPU, IndexedDB |
| `storage` | kota ve kullanım, MB'a yuvarlanmış |
| `capabilityGate` | son kontrolün aşama sonuçları (ortam, encoder yapılandırması, öz-test, altyazı fontu, kaynak çözülebilirliği, kaynak codec'leri, HDR, engel kodları) — yoksa `null` |
| `project` | yalnızca yapı: an sayısı, altyazı satırı sayısı, müzik var mı, oran, kısa kenar, çıktı süresi |
| `exportLog` | §2.1'deki günlük |
| `sessionErrors` | §2.3'teki kodlar |

Dosya adı, proje adı, altyazı metni, proje/asset kimlikleri **yok**; birim testi projeye ve
girdilere bunları özellikle koyup çıktıda aramaz (`web/tests/unit/diagnostics.test.ts`).

## 6. Bu envanteri geçersiz kılacak değişiklikler

Aşağıdakilerden biri eklenirse bu belge, `/gizlilik` metni ve e2e izin listesi aynı PR'da
güncellenmeli: herhangi bir `fetch`/XHR/beacon/WebSocket; üçüncü taraf script, font veya CDN;
analitik/hata raporlama SDK'sı; hesap/oturum; çerez veya web depolama; yeni IndexedDB store'u
veya `ProjectRecord` alanı; OPFS'e yeni dosya türü; model dosyası indirme; service worker'ın listesine
uygulama dosyası dışında bir şey girmesi ya da çalışırken ağ yanıtlarını önbelleğe yazmaya başlaması.

## 7. Açık kurucu kararları (uygulama bunları uydurmaz)

- Veri sorumlusu (kişi/şirket), faaliyet yeri, gizlilik iletişim adresi — belge 30 K02.
- Hukuki dayanak ve başvuru/hak kullanma yolu — hukuki inceleme.
- Barındırma sağlayıcısı ve sunucu erişim kaydı saklama süresi.
- Destek iletişim adresi (`NEXT_PUBLIC_SUPPORT_CONTACT`) ve kullanıcının gönderdiği tanı
  dosyalarının saklama süresi (belge 19 "en çok 7 gün" önerisi — onaylanmadı).
- Uygulama adı (K01): sayfa ve dosya adları geçici "Clip" adını kullanır.
