# Veri envanteri — web editörü (yerel beta)

> Tarih: 2026-09-22 · Durum: KODDAN ÇIKARILDI, HUKUKİ İNCELEME YOK
> Kapsam: `web/` (Next.js, yalnızca istemci tarafı editör). Roadmap P2-04, lansman listesi §B
> "Privacy/terms ve SDK veri envanteri gerçek davranışla eşleşiyor".
> Veri sorumlusu, iletişim, hukuki dayanak ve barındırma sağlayıcısı **belirlenmedi** (belge 30 K02).

> **11 Ekim 2026 — bulut yazıya dökme yolu (ADR-039): yazıldı, KAPALI.** Bu belgenin geri kalanı
> **yayındaki derlemeyi** anlatır ve o derlemede hiçbir şey değişmedi: yol, yalnızca
> `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL` verilen bir derlemede vardır; yayındaki site ve CI onu
> vermez. Yol açık bir derlemede neyin değiştiği **§8**'de yazılıdır; o derleme yayınlanırsa bu
> belgenin §1, §2.4, §4.1 ve §6 satırları §8'e göre okunmalıdır.

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
| Çerez, localStorage, sessionStorage? | Çerez kullanılmıyor. **13 Ekim 2026 (ADR-044):** sessionStorage'da tek anahtar olabilir — `clip:page-recovery`, yalnızca bir sayfa açılamayıp kendini yeniden yüklediğinde yazılır (§2.4a); sorunsuz oturumda sessionStorage boştur. localStorage'da yalnızca ilk kullanım ipucunun kapatıldığı (`clip.firstRunHint.dismissed` = `1`) durur, o da yalnızca kullanıcı "Anladım"a basınca yazılır (§2.4). e2e testi ipucu kapatılmamış oturumun sonunda üçünün de boş olduğunu, kapatınca yalnızca o anahtarın yazıldığını doğrular. | `web/src/components/editor/FirstRunHint.tsx` + e2e testleri |
| Cihaz parmak izi? | Yok. Tanı dosyasındaki tarayıcı bilgisi yalnızca kullanıcı indirirse oluşur ve kendiliğinden gönderilmez. | `web/src/adapters/diagnostics.ts` |
| Model dosyası / AI? | Bu sürümde yok. | — |
| Kendiliğinden gönderilen bir şey? | Yok. Yayındaki derlemenin kodunda başka bir adrese giden `fetch`/XHR/WebSocket/beacon yok: `fetch` yalnızca kendi origin'imizden okur (yazı tipi — `useCaptionFont.ts`; "Modeli indir"e basılınca model dosyaları — §2.8). Bulut yolunun istemcisi (`web/src/adapters/cloud/`) depoda durur ama yayındaki derlemeye **girmez** (§8.1). | e2e testleri; `scripts/apply-csp.mjs` (durağan çıktıda bulut kodu bulursa derlemeyi durdurur); `tests/e2e/cloud-off.spec.ts` |
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
| `failureDetail` | Yalnızca başarısızlıkta (12 Ekim 2026): hatanın **nerede ve ne tür** olduğu — aşağıdaki tablo. Hatanın metni (`message`), yığını, dosya adı ya da yolu **yok** |
| `outputDurationMs` | Başarılıysa üretilen dosyadan ölçülen, değilse planlanan süre |
| `width`, `height` | Çıktı çözünürlüğü |
| `route` | `opfs` / `memory`; yalnızca dosya üretildiyse |
| `elapsedMs` | Sayfa tarafında başlangıçtan son olaya kadar geçen süre |
| `planPrefix` | Render planı parmak izinin ilk 9 karakteri (`fp_` + 6 hex); aynı tarifin denemelerini eşleştirmek için. Sayılardan oluşan bir FNV hash'inin öneki; tarife geri çevrilemez |

**`failureDetail`** (`web/src/domain/exportFailureDetail.ts`, `ExportFailureDetail`). Neden var: 11 Ekim 2026'da
gerçek bir makinede bir indirme "Beklenmeyen bir hata oluştu" ile bitti, ikinci basışta çalıştı ve geriye
hiçbir bilgi kalmadı (işleyici hata metnini bilerek iletmiyordu). Alanların hepsi sayı, doğru/yanlış ya da
dosyadaki sabit bir listeden değerdir:

| Alan | İçerik |
|---|---|
| `errorName` | Hatanın adı, **yalnızca** bilinen adlar listesindeyse (`EncodingError`, `InvalidStateError`, `TypeError`…; `KNOWN_ERROR_NAMES`); değilse `Other` |
| `stage` | Kendi kodumuzun koyduğu aşama etiketi (`EXPORT_STAGES`: `open_source`, `configure_decoder`, `decode`, `draw`, `configure_encoder`, `encode`, `audio_decode`, `audio_encode`, `write`, `finalize`, `commit`, `verify`, `worker_crash`…) |
| `via` | `exception` (işleyicide yakalandı) / `worker_error_event` (işleyicinin kendisi çöktü) / `worker_message_error` / `request_not_sent` / `stalled` (hata yok: indirme yerinde saydı, sayfa beklemeyi bıraktı) |
| `hint` | Hata metni **saklanmaz**; yalnızca bilinen birkaç cümleyle karşılaştırılır ve eşleşenin **etiketi** yazılır (`codec_reclaimed`, `encoding_error`, `decoding_error`…); eşleşmezse `null` |
| `phase` | Sayfanın gördüğü son adım (`preparing`, `encoding`, `finalizing`…) |
| `framesDone`, `totalFrames`, `videoPacketsOut` | Kaçıncı karede kaldığı |
| `videoEncoder`, `videoDecoder`, `audioEncoder` | Gerçekten yapılandırılan codec dizgisi (`avc1.640028`, `mp4a.40.2`) ve `hardwareAcceleration` isteği. Dizgi, codec dizgilerinin kendi dil bilgisine uymuyorsa atılır ("harf, rakam, nokta" yetmez: `tatil-2025.mp4` da öyledir) |
| `hardwareEncoderAvailable` | Bu tarayıcı bu görüntü için donanım kodlayıcısı sunuyor mu |
| `route` | `opfs` / `memory` / `file` |
| `pageWasHidden` | Deneme sırasında sayfa hiç gizlendi mi (başka sekme, küçültülmüş pencere) |
| `attemptInSession` | Bu sayfada kaçıncı indirme (0: ilki) |

**Hatanın metni neden hiç saklanmıyor:** tarayıcının ve medya kitaplığının hata cümleleri dosya adı, yol,
`blob:` adresi ya da dosyanın üstverisinden bir parça taşıyabilir; "şunları sil" diye yazılacak bir kuralın
hepsini yakaladığı gösterilemez. Bu yüzden metin işleyiciden çıkmaz; ad izin listesinden geçer; kayıt
okunurken `sanitizeExportFailureDetail` nesneyi alan alan yeniden kurar. Birim testleri her alana ayrı ayrı
dosya adı, yol ve altyazı cümlesi koyup çıktıda arar (`exportFailureDetail.test.ts`, `exportLog.test.ts`,
`diagnostics.test.ts`); e2e testi bilerek yol içeren bir hata fırlatır ve ne ekranda ne tanı dosyasında
bulunmadığını doğrular (`export-failure.spec.ts`).

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
| Son yetenek kontrolünün aşama sonuçları ve bu oturumda görülen hata **kodları** (en çok 30); arka plan işlerinin beklenmeyen hatasında ayrıca hatanın **nerede ve ne tür** olduğu (`detail`, 13 Ekim 2026 — aşağıda) | `web/src/adapters/diagnostics.ts` |
| Undo/redo geçmişi, editör durumu | `web/src/application/history.ts`, `useEditorState.ts` |

Oturum hata kodları: medya (`error.*` sebepleri), düzenleme, depolama, sessizlik, dışa aktarma,
yetenek engelleri, plan retleri ve yakalanmamış hatalar; 13 Ekim 2026'dan beri ayrıca cihazda yazıya
dökme (`transcript`), model indirme (`model_download`), bulut yolunun ses dosyası (`cloud_audio`,
yalnızca o yolun açık olduğu derlemede) ve "İyileştir" önizlemesi (`enhance_preview`).

**`detail`** (ADR-042 eki, 13 Ekim 2026). Bu beş arka plan işinden biri **kimsenin öngörmediği** bir
hatayla biterse — işin içinde beklenmeyen bir hata, işleyicinin çökmesi, okunamayan ileti, gönderilemeyen
istek ya da yerinde sayma — satır, kodun yanında §2.1'deki `failureDetail` ile **aynı türü** taşır
(`ExportFailureDetail`): izin listesinden hata adı, kendi aşama etiketimiz (`open_source`, `audio_decode`,
`audio_encode`, `loudness`, `model_download`, `model_check`, `model_load`, `speech_detect`, `recognise`,
`worker_crash`…), geliş yolu, bilinen cümlenin etiketi, sayfanın gördüğü son adım (`downloading`,
`checking`, `loading`, `listening`, `writing`, `analysing`, `preparing`…), sayfa hiç gizlendi mi. Bu işlerde
kare sayısı, codec ve yazma yolu alanları boştur (`null`). Hatanın metni, yığını, dosya adı, yol, altyazı
metni **yok**: metin işleyiciden çıkmaz; nesne hem kayda girerken (`recordFailure`) hem dosyaya yazılırken
(`sanitizeSessionError`) alan alan yeniden kurulur. Kendi kararımız olan retlerde ("ses yok", "model
eksik") `detail` yoktur. Yalnız açık sekmenin belleğindedir; sekme kapanınca gider. Testler: birim
`workerWatch.test.ts` (her işin her alanına dosya adı, yol, altyazı cümlesi, `blob:` adresi konup çıktıda
aranır), e2e `worker-failure.spec.ts` ve `tests/cloud/cloud-audio-failure.spec.ts` (bilerek yol içeren hata
fırlatılır; sayfada, saklananlarda, konsolda ve tanı dosyasında aranır). Yakalanmamış hatalarda **mesaj
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

### 2.4a sessionStorage — sayfa yeniden yükleme notu (2026-10-13, ADR-044)

Tek anahtar: `clip:page-recovery`. **Yalnızca** bir sayfa açılamadığında (sunulan HTML'i React
devralmadığında) ve sayfanın bekçisi (`web/src/pageWatchdog.ts`) onu bir kez kendiliğinden yeniden
yüklediğinde ya da kullanıcı "Yeniden yükle" / "Uygulamayı baştan indir"e bastığında yazılır. Sayfalar
sorunsuz açıldıkça hiç yazılmaz. Değeri küçük bir JSON'dur:

| Alan | Ne | Örnek |
|---|---|---|
| `s` | durum: `reloading` (yeniden yüklemeden hemen önce), `retried` (ikinci deneme başladı), `recovered` (ikinci deneme açıldı) | `recovered` |
| `t` | yeniden yüklemenin zamanı (epoch ms) | `1791892815000` |
| `p` | sayfanın yolu — uygulamanın kendi sayfası; sorgu dizgisi, dosya adı yok | `/capcut/yap/cevir/` |
| `why` | ne görüldü: `file` (derleme dosyası gelmedi), `style` (stil dosyası gelmedi), `timeout` (15 sn'de açılmadı), `button`, `reset`, `second try` | `file` |

Ne içindir: aynı sekmede **ikinci** otomatik yeniden yüklemeyi engellemek (döngü koruması) ve bir
sonraki 5 dakikada yeni bir otomatik yeniden yükleme yapmamak. Kimlik, proje, video ya da dosya adı
içermez; hiçbir yere gönderilmez; tanı dosyasına ("Sorun bildir") girmez. Sekmeye özeldir, sekme
kapanınca tarayıcı siler. Tarayıcı depolamayı reddederse (gizli pencere, site verisi engelli) okuma ve
yazma `try/catch` içindedir: o zaman otomatik yeniden yükleme **hiç yapılmaz**, yalnızca uyarı
gösterilir. "Uygulamayı baştan indir" düğmesi yalnızca bu uygulamanın service worker kaydını (kapsam
`<base>/`) ve `clip-app-` ile başlayan önbellekleri siler; IndexedDB'ye (projeler, günlük), OPFS'ye,
`clip-models-*` önbelleğine (konuşma modeli) ve localStorage'a dokunmaz. Kaynak: `web/src/pageWatchdog.ts`,
`web/src/components/PageWatchdog.tsx`; testler: `web/tests/unit/pageWatchdog.test.ts`,
`web/tests/e2e/page-watchdog.spec.ts` ("touches nothing else the browser keeps"); `/gizlilik` sayfasındaki
"Sayfa yeniden yükleme notu" kartı aynı değişiklikte eklendi.

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

Çerez: kodda yok (`grep`). `sessionStorage`: 13 Ekim 2026'dan beri tek anahtar, yalnızca bir sayfa
kendini yeniden yüklediğinde (§2.4a). e2e oturum testi çerezlerin, `document.cookie`'nin ve iki web
depolamanın (ipucu kapatılmadığı ve hiçbir sayfa yeniden yüklenmediği için ikisi de) boş olduğunu doğrular.

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

### 2.8 Konuşma modeli ve transkript — "Yazıya dök" (2026-10-04, ADR-036)

- **Ses nereye gider:** hiçbir yere. Videonun sesi transkript worker'ında (`web/src/adapters/
  transcript/`) çözülür, 16 kHz mono'ya indirilir, konuşma bulucu ve Whisper modeli **bu cihazda**
  çalışır. Motorun ağ erişimi yoktur: kütüphanenin `fetch`'i model deposunu okuyan bir fonksiyonla
  değiştirilmiştir, depoda olmayan dosya 404 alır, başka yerde aranmaz (`engine.ts`). Kanıt: e2e
  `transcript-real.spec.ts` (gerçek model; çevrimiçi ve **çevrimdışı**; origin dışı istek 0, CSP
  ihlali 0), `transcript.spec.ts`, Pages duman testi.
- **Yeni saklanan veri — model deposu:** Cache Storage'da **ayrı** bir önbellek, adı
  `clip-models-v1`. Yalnızca kullanıcı "Modeli indir"e basınca dolar; kendiliğinden indirme yok
  (e2e: düğmeye basılmadan `/models/` isteği 0). İçindekiler uygulamanın kendi dosyalarıdır:
  onnxruntime-web WebAssembly dosyası (26,9 MB), Silero VAD (2,2 MB), Whisper `base` (79,7 MB)
  ve kullanıcı seçerse `large-v3-turbo` (566,5 MB) — toplam 108,8 MB ya da 595,6 MB. Dosyalar
  **bu sitenin kendi adresinden** (`<site>/models/…`) gelir; başka bir siteye istek yok. Büyük
  dosyalar 32 MiB'lik parçalar hâlinde saklanır (`…?part=N`); tam dosya sha256'sı sabit listeyle
  (`web/src/domain/modelManifest.json`) tutunca `…?verified=1` işareti yazılır; tutmayan dosya
  silinir ve kullanılmaz.
- **Ne değil:** kullanıcının sesi, videosu ya da metni bu önbelleğe girmez. Service worker'ın
  `clip-app-*` önbelleği (§2.5) model dosyası içermez; worker model önbelleğine dokunmaz, onu
  silmez (yalnız `clip-app-*` adlarını siler).
- **Ne zaman silinir:** kullanıcı silene kadar kalır. "Modeli sil": `/gizlilik` sayfasındaki
  "Konuşma modeli" kartında ve editörde "Kısayollar ve sınırlar" penceresinde; ikisi de adı
  `clip-models-` ile başlayan önbellekleri siler (`modelStore.ts`, `deleteStoredModels`). Sabit
  revizyon değişirse eski revizyonun dosyaları bir sonraki indirmede silinir (`pruneStale`).
  İndirme sırasında `navigator.storage.persist()` istenir (tarayıcı depolama baskısında dosyaları
  kendiliğinden atmasın diye; Firefox bunu kullanıcıya sorar).
- **"İyileştir" (ADR-037):** yeni saklanan veri yok. Videonun kareleri worker'da çözülür,
  ölçülür (histogram, renk dengesi, kumlanma, keskinlik: birkaç sayı) ve işlenir; ölçümler
  yalnızca açık sekmenin belleğindedir ve sekme kapanınca gider, hiçbir yere gönderilmez.
  Editörde ayar açılırsa tarifte yalnızca `enhance: { strength }` saklanır (EDL v4): hangi güç
  seçildiği; görüntüden türetilmiş hiçbir şey değil. Sihirbaz proje saklamaz.
- **Transkript metni:** altyazı izi olarak proje tarifinin içindedir (`captionTracks[0]`,
  `origin: 'transcript'`, EDL v3). Editörde (`/editor`) diğer altyazı satırları gibi IndexedDB'ye
  saklanır ve proje yedeğine girer (§2.1); sihirbazda (`/yap/yazi`) hiçbir şey saklanmaz (§2.7).
  Kelime zamanları saklanmaz; yalnızca satırlar ve "anlaşılamadı" aralıkları.
- **Kullanıcının tetiklediği yeni indirmeler:** "Metni indir" (TXT, zaman damgalı satırlar),
  "SRT / VTT indir", "Altyazılı videoyu indir" (MP4). Hepsi tarayıcının yazdığı yerel dosyalardır.
- **Ölçüm kancası:** `globalThis.__clipTranscriptRuns` dizisi sayfa yüklenmeden önce tanımlanmışsa
  (yalnız ölçüm betikleri tanımlar) istemci bir koşunun kelime zamanlarını oraya yazar; olağan
  kullanımda dizi yoktur ve hiçbir şey yazılmaz (`__clipSilenceEnvelopes` ile aynı kalıp).

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
  kapatılmaz; kapatılınca yazılan tek anahtar §2.4'te; bir sayfa kendini yeniden yüklemek zorunda
  kalırsa sessionStorage'a yazılan tek anahtar §2.4a'da — o zaman bu test bilerek kırılır ve koşu
  `PAGE-RECOVERED` satırıyla nedenini söyler);
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
| `exportLog` | §2.1'deki günlük (başarısız denemede `failureDetail` ile: hatanın adı, aşaması, codec'ler — metni değil) |
| `sessionErrors` | §2.3'teki kodlar; arka plan işlerinin beklenmeyen hatasında `detail` ile (hatanın adı, aşaması, geliş yolu — metni değil) |

Dosya adı, proje adı, altyazı metni, proje/asset kimlikleri **yok**; birim testi projeye ve
girdilere bunları özellikle koyup çıktıda aramaz (`web/tests/unit/diagnostics.test.ts`).

## 6. Bu envanteri geçersiz kılacak değişiklikler

Aşağıdakilerden biri eklenirse bu belge, `/gizlilik` metni ve e2e izin listesi aynı PR'da
güncellenmeli: herhangi bir `fetch`/XHR/beacon/WebSocket; üçüncü taraf script, font veya CDN;
analitik/hata raporlama SDK'sı; hesap/oturum; çerez veya web depolama; yeni IndexedDB store'u
veya `ProjectRecord` alanı; OPFS'e yeni dosya türü; model dosyasının **başka bir adresten** indirilmesi
(bugün yalnızca kendi origin'imizden, §2.8) ya da sesin/metnin bir sunucuya gitmesi; service worker'ın listesine
uygulama dosyası dışında bir şey girmesi ya da çalışırken ağ yanıtlarını önbelleğe yazmaya başlaması.

## 7. Açık kurucu kararları (uygulama bunları uydurmaz)

- Bulut yazıya dökme yolu için: §8.6.

- Veri sorumlusu (kişi/şirket), faaliyet yeri, gizlilik iletişim adresi — belge 30 K02.
- Hukuki dayanak ve başvuru/hak kullanma yolu — hukuki inceleme.
- Barındırma sağlayıcısı ve sunucu erişim kaydı saklama süresi.
- Destek iletişim adresi (`NEXT_PUBLIC_SUPPORT_CONTACT`) ve kullanıcının gönderdiği tanı
  dosyalarının saklama süresi (belge 19 "en çok 7 gün" önerisi — onaylanmadı).
- Uygulama adı (K01) kararlaştırıldı: **LiloCut** (10 Ekim 2026, ADR-038). Sayfa başlıkları, yüklenen uygulamanın adı
  ve indirilen dosya adları (`lilocut-tani-…json`, `….lilocut.json`) bu adı kullanır. Tarayıcıda tutulanların adları
  bilerek değişmedi (`clip-editor`, `clip-export-`, `clip-app-`, `clip-models-`, `clip.firstRunHint.dismissed`):
  değişseydi kayıtlı projeler ve indirilmiş modeller sahipsiz kalırdı. Açık kalan: marka/alan adı incelemesi.

## 8. Bulut yazıya dökme yolu (ADR-039) — yazıldı, KAPALI (2026-10-11)

> Durum: istemci depoda, **yayındaki derlemede yok**. Vekil sunucu (Worker) yayınlanmadı. Bu
> bölümdeki her şey vekilin **yerel bir sahtesine** karşı sınandı (`web/tests/cloud/`,
> `cloud/fake-worker/`); gerçek Worker, gerçek sağlayıcı ve gerçek bir telefon doğrulanmadı
> (ADR-039, "Doğrulanmayanlar"). Veri sorumlusu belirlenmedi (K02).

### 8.1 Kapalıyken (yayındaki site, CI, ayarsız her derleme)

| Soru | Cevap | Kanıt |
|---|---|---|
| Seçim ekranı var mı? | Yok. "Yazıya dök" doğrudan cihaz üstü adımlara gider. | `tests/e2e/cloud-off.spec.ts` |
| Başka bir kökene istek atılabilir mi? | Hayır: `connect-src 'self'`. `fetch`, `fetch(no-cors)`, XHR, `sendBeacon` ve WebSocket denendi, hepsi engellendi; hedefte dinleyen sunucu hiçbir istek almadı. | `tests/e2e/cloud-off.spec.ts`, `tests/pages/pages-smoke.spec.ts` |
| Bulut istemcisinin kodu sayfada mı? | Hayır. Yolu yükleyen iki yer (`YaziWizard.tsx`, `CloudInviteSlot.tsx`) derleme sabitini kendisi karşılaştırır; paketleyici dalı ve parçalarını atar. Durağan çıktıda `/v1/jobs`, `/v1/quota` ya da `AssemblyAI` bulunursa derleme durur. | `scripts/apply-csp.mjs`, `tests/unit/cloudBuild.test.ts`, `tests/e2e/cloud-off.spec.ts` |
| Sayfalar sağlayıcıdan söz ediyor mu? | Hayır. Bulut cümleleri ayrı tabloda (`src/i18n/cloudMessages.ts`); `/gizlilik` bugünkü cümlelerini söyler. | `tests/e2e/cloud-off.spec.ts`, `tests/pages/pages-smoke.spec.ts` |
| Tarifte (EDL) değişiklik? | Yok: şema v4, yeni alan yok. | `tests/unit/cloudTranscript.test.ts` |

### 8.2 Açıkken cihazdan ne çıkar

Yalnızca kullanıcı **"Sesi gönder ve yaz"** düğmesine bastığında, her seferinde:

| Ne | Nereye | Nasıl |
|---|---|---|
| Videonun **sesi** (konuşma, arka plan sesi, müzik) | Bizim vekil Worker'ımıza (Cloudflare), oradan AssemblyAI'ye (AB bölgesi — Worker ayarı `PROVIDER_REGION=eu`) | Cihazda yeni bir dosya olarak kodlanır: Opus 24 kbit/s, tek kanal, 16 kHz, WebM (≈ 0,21 MB/dakika); Opus yoksa AAC 32 kbit/s, MP4. Kaynak dosyadan hiçbir şey kopyalanmaz. `POST /v1/jobs`, gövde = ses. — `src/adapters/cloud/cloudAudioWorker.ts`, `cloudClient.ts` |
| Sesin süresi (tam saniye) | Worker | `x-audio-duration-s` başlığı |
| İşin adı (tarayıcının ürettiği rastgele UUID) | Worker | `x-job-id` başlığı; işi sorgulamak ve silmek için |
| Davet kodu | Worker (yalnız özeti saklanır) | `Authorization: Bearer …` başlığı. Adreste (URL, sorgu) **asla**. |
| IP adresi, tarayıcı bilgisi | Cloudflare ağı (her istekte olduğu gibi) | Worker IP'nin tuzlanmış özetini en çok ~70 dk tutar (ADR-039 "Worker ne saklar") |

**Çıkmayanlar:** görüntü; kaynak dosyanın adı, öbür izleri, başlık/konum/cihaz/tarih etiketleri;
proje adı; altyazı metni; çerez (istekler `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`).
Kanıt: `tests/cloud/cloud-flow.spec.ts` → "the uploaded bytes are sound only" (sahte sunucunun
aldığı baytlar ffprobe ile okunur: tam bir ses izi, video izi yok; `title`, `creation_time`,
`location`, `make`, `model` etiketi yok; dosya adı ve kaynak kapsayıcının kutuları baytlarda yok).

**Düğmeye basılmadan önce:** kayıtlı davet kodu **yoksa** ekran hiçbir istek atmaz. Varsa, ekran
açılınca kalan dakikayı sorar (`GET /v1/quota`, kod başlıkta, gövde yok). Kanıt:
`cloud-flow.spec.ts` → "not one byte of sound leaves before the button is pressed".

### 8.3 Sağlayıcıda ne kalır, ne zaman silinir

- Olağan yol: sonuç tarayıcıya geçince Worker kaydı (ve yüklenen sesi) sağlayıcıda siler; tarayıcı
  ayrıca `DELETE /v1/jobs/:id` gönderir. Sınandı (sahte sağlayıcıda "kalan kayıt 0").
- Hata, zaman aşımı, kullanıcının durdurması, sayfadan çıkma: tarayıcı silme isteğini gönderir
  (sayfadan çıkarken `keepalive` ile). Silme isteği yapılamazsa ekran bunu söyler; Worker'ın
  temizlik alarmı siler (sonuç hazır olduktan 60 dk sonra, her durumda en geç 24 saatte).
- **Sınır:** yükleme sırasında durdurulan işte kayıt açılmaz; o ana kadar sağlayıcıya ulaşmış ses
  bizim elimizle silinemez, sağlayıcının kendi kuralıyla silinir (belgesine göre 24–48 saat).
  Ekran bu durumda "silindi" demez (ADR-039 "Bilinen sınır").
- Yazı: sonuç geldikten sonra yalnızca bu tarayıcıdadır (tarif, §2.1 / §2.3; sihirbazda yalnızca
  bellekte).

### 8.4 Bu tarayıcıda saklanan (yalnız açık derlemede)

| Ne | Nerede | Ne zaman yazılır | Nasıl silinir |
|---|---|---|---|
| Davet kodu | `localStorage` → `clip.cloudInvite` | Yalnızca "Kodu kaydet"e basılınca **ve** Worker kodu kabul edince. Biçime uymayan kod hiçbir yere gönderilmez ve yazılmaz. | "Davet kodunu kaldır" (seçim ekranında ve `/gizlilik` sayfasında); kod geri çekilmişse bir sonraki açılışta kendiliğinden; tarayıcı verisini temizleyince. |
| Seçilen yol (cihaz / internet) | **saklanmaz** | — | Her videoda yeniden sorulur. |
| Kim konuştu (13 Ekim 2026, ADR-043) | Proje tarifinde, satırın kendisinde: `speaker`, 1–20 arası bir **sıra numarası** (ilk duyulan ses 1). Ad, ses izi ya da sağlayıcının kimliği **değil**. Sihirbazda yalnızca bellekte (sihirbaz proje saklamaz, §2.7); editörde (`/editor`) altyazı satırlarıyla birlikte IndexedDB'de ve proje yedeğinde (§2.1). | Sonuç geldiğinde tarife; depoya yalnızca editörün otomatik kaydıyla | Satır ya da proje silinince; tarayıcı verisi temizlenince. TXT ve VTT dosyalarına "1. kişi" olarak yazılır; SRT'ye ve videoya yazılmaz. |

Kanıt: `cloud-flow.spec.ts` → "never chosen for the user and never remembered" (localStorage'da
yalnızca `clip.cloudInvite`; sessionStorage boş) ve "the invite code can be removed…".

### 8.5 `/gizlilik` sayfası

Koşulludur (`src/components/PrivacyPage.tsx`, `CLOUD_ON`): yol kapalıyken hiçbir cümle değişmez.
Açıkken "hiçbir sunucuya gönderilmez", "Uygulama senin adına hiçbir şey göndermez" ve "bulutta
çalışan bir yapay zekâ kullanılmaz" cümleleri doğru karşılıklarıyla değişir ve "İnternette yazıya
dökme (isteğe bağlı, davetli deneme)" bölümü eklenir: ne gider, kime, nerede işlenir (AB), ne
zaman silinir, başkalarının sesi, vekilin tuttuğu kayıt, dakika sorgusu, denemenin sınırı; ayrıca
"Davet kodu" kartı ve kaldırma düğmesi. Kanıt: `tests/cloud/cloud-choice.spec.ts`,
`tests/e2e/cloud-off.spec.ts`.

### 8.6 Açık kurucu kararları

- Veri sorumlusu ve hukuki dayanak (K02): bulut yolu kişisel veriyi (sesi) üçüncü tarafa aktaran
  ilk özelliktir; belirlenmeden davetli deneme dışına açılmamalı.
- Bölge AB kalacak mı (`PROVIDER_REGION`): ekran ve gizlilik metni "Avrupa" diyor.
- Bulut dakikasının ücretli/ücretsiz/deneme oluşu (politika belgesi 15 — değişmedi).
- ~~Konuşmacı etiketlerinin kalıcı olması (EDL v5).~~ — 13 Ekim 2026: yapıldı (ADR-043; §8.4).
- Kişileri yeniden adlandırma (ADR-043): gelirse tarife **serbest metin** (bir ad) girer; bu envanter
  ve `/gizlilik` o değişiklikle birlikte güncellenmeli.
