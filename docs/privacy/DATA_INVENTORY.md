# Veri envanteri — web editörü (yerel beta)

> Tarih: 2026-09-22 · Durum: KODDAN ÇIKARILDI, HUKUKİ İNCELEME YOK
> Kapsam: `web/` (Next.js, yalnızca istemci tarafı editör). Roadmap P2-04, lansman listesi §B
> "Privacy/terms ve SDK veri envanteri gerçek davranışla eşleşiyor".
> Veri sorumlusu, iletişim, hukuki dayanak ve barındırma sağlayıcısı **belirlenmedi** (belge 30 K02).
> **14 Ekim 2026 (kurucu kararı):** veri sorumlusu, şirket kurulana kadar **kurucunun kendisi, kişi olarak**.
> Adı yalnızca yayın derlemesine verilir (`NEXT_PUBLIC_DATA_CONTROLLER_NAME`, CI'da depo değişkeni
> `DATA_CONTROLLER_NAME`); iletişim adresi destek iletişimidir (`NEXT_PUBLIC_SUPPORT_CONTACT`, CI'da GitHub
> Issues). Ad verilmeyen her derlemede `/gizlilik` "belirlenmedi" der; ad hiçbir yerde uydurulmaz, e-posta adresi
> ya da bağlantı içeren bir ad derlemeyi durdurur (`web/scripts/lib/dataController.mjs`). Faaliyet yeri, hukuki
> dayanak ve başvuru yolu hâlâ **belirlenmedi**. Barındırma: GitHub Pages (yayın derlemesi söyler).

> **14 Ekim 2026 — bulut yazıya dökme yolu yayında DAVETLİ DENEME olarak açılıyor (kurucu kararı).** Yol,
> depo değişkeni `CLOUD_TRANSCRIPT_URL` gerçek vekilin kökenini alınca yayındaki derlemeye girer (§8.7).
> O andan sonra bu belgenin §1, §2.4, §4.1 ve §6 satırları **§8'e göre okunur**: cihazdan yalnızca kullanıcı
> "Sesi gönder ve yaz"a bastığında ve yalnızca ses çıkar (§8.2).

> **18 Ekim 2026 — İngilizce arayüz (ADR-048).** Her sayfa iki dilde önceden çizilir (`/…` Türkçe, `/en/…`
> ve `/gizlilik/en` İngilizce). localStorage'da bir anahtar daha olabilir: `clip.language` (`tr` / `en`),
> yalnızca kullanıcı dil düğmesine bastığında yazılır (§2.4c). Hangi dilin açılacağına sayfa, bu anahtara ve
> yoksa tarayıcının dil listesine **cihazda** bakarak karar verir; dil listesi gönderilmez, saklanmaz.
> Çevrimdışı kopyada İngilizce sayfalar da vardır (§2.5: 15 → 28 sayfa). Ağ değişmedi (§4).

> **17 Ekim 2026 — "LiloCut'a paylaş" (ADR-047).** Telefonun paylaşma menüsünden uygulamaya paylaşılan
> video, bir iş onu alana kadar geçici bir kopya olarak bu tarayıcıda durur (§2.9). Bulut yolu açık ve kapalı
> derlemede aynıdır; açık derlemede yalnız "İnternette" seçilirse sesi gider (§8.2).

> **11 Ekim 2026 — bulut yazıya dökme yolu (ADR-039): yazıldı, KAPALI.** Bu belgenin geri kalanı
> **yayındaki derlemeyi** anlatır ve o derlemede hiçbir şey değişmedi: yol, yalnızca
> `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL` verilen bir derlemede vardır; yayındaki site ve CI onu
> vermez. Yol açık bir derlemede neyin değiştiği **§8**'de yazılıdır; o derleme yayınlanırsa bu
> belgenin §1, §2.4, §4.1 ve §6 satırları §8'e göre okunmalıdır.
>
> **13 Ekim 2026 — "Yazıya dök"ün yazısı editöre geçişte saklanır (ADR-034 ekleri).** Sabah yalnızca
> internette yazılan yazı için (yol açık derlemede), aynı akşam **cihazda yazılan yazı için de, yani
> yayındaki derlemede**: "Yazıya dök"te çıkan yazının üstünde "Daha fazla ayar → editörde aç"a basılınca
> o çalışma tarayıcının proje deposuna yazılır (§2.7, §8.4a). "Sihirbaz proje saklamaz" kuralının tek
> istisnası budur; §2.6'nın ve §2.8'in "sihirbazda hiçbir şey saklanmaz" satırları §2.7'ye göre okunmalıdır.

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
| Paylaşılan video? | **17 Ekim 2026'dan beri (ADR-047):** telefonun paylaşma menüsünden uygulamaya paylaşılan videonun bir kopyası, bir iş onu alana kadar bu tarayıcıda durur (Cache Storage `clip-shared`, en çok bir video; alınınca, 15 dakika sonra ya da sonraki açılışta silinir). Service worker varken cihazdan çıkmaz; worker yokken tarayıcı paylaşımı sitenin sunucusuna gönderir ve sunucu reddeder (§2.9). | `web/scripts/lib/share-target.mjs`, e2e `share-target.spec.ts` |
| Çerez, localStorage, sessionStorage? | Çerez kullanılmıyor. **13 Ekim 2026 (ADR-044):** sessionStorage'da tek anahtar olabilir — `clip:page-recovery`, yalnızca bir sayfa açılamayıp kendini yeniden yüklediğinde yazılır (§2.4a); sorunsuz oturumda sessionStorage boştur. localStorage'da yalnızca ilk kullanım ipucunun kapatıldığı (`clip.firstRunHint.dismissed` = `1`) durur, o da yalnızca kullanıcı "Anladım"a basınca yazılır (§2.4). **14 Ekim 2026 (ADR-036 eki):** localStorage'da bir anahtar daha olabilir — `clip.transcriptLargeFailed` = `1`, yalnızca büyük konuşma modeli bu tarayıcıda yazıya dökerken durduğunda yazılır (§2.8a). **18 Ekim 2026 (ADR-048):** `clip.language` = `tr` / `en`, yalnızca dil düğmesine basılınca (§2.4c). e2e testi ipucu kapatılmamış oturumun sonunda üçünün de boş olduğunu, kapatınca yalnızca o anahtarın yazıldığını doğrular. | `web/src/components/editor/FirstRunHint.tsx` + e2e testleri |
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
Silme: tarayıcının site verisini temizlemek; editörde "Diğer → Kayıtlı projeyi sil" (video açıkken de;
14 Ekim 2026, ADR-012 eki) ya da kaynak dosya istendiğinde aynı düğme (`RelinkPanel`); ikisi de
`useProjectPersistence.forget`. Silinen kayıt o sekmede geri yazılmaz. Tarayıcı depolamayı kendisi de boşaltabilir.

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
| `videoEncoder`, `videoDecoder`, `audioEncoder` | Gerçekten yapılandırılan codec dizgisi (`avc1.640028`, `mp4a.40.2`) ve `hardwareAcceleration` isteği; video kodlayıcısında bit hızı modu (`bitrateMode`: `constant` / `variable` / `quantizer`, başka bir değer atılır; ADR-045). Dizgi, codec dizgilerinin kendi dil bilgisine uymuyorsa atılır ("harf, rakam, nokta" yetmez: `tatil-2025.mp4` da öyledir) |
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
| "Sesi düzelt"in ölçümü (ADR-049): iki ses yüksekliği sonucu, iki kazanç ve dinletilecek 5 saniyelik iki ses parçası (önce / sonra, çözülmüş PCM, ≈ 4 MB); anahtar `dosyaAdı|boyut|lastModified|süre`, en çok 4 video | `web/src/adapters/silence/silenceClient.ts` (`soundChecks`) |
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

### 2.4c localStorage — dil seçimi (2026-10-18, ADR-048)

Tek anahtar: `clip.language`, değeri `tr` ya da `en`. **Yalnızca** kullanıcı dil düğmesine
("English" / "Türkçe": ana ekranın çubuğunda, editörün Ayarlar panelinde, gizlilik sayfasında)
bastığında ya da sonunda `?lang=tr` / `?lang=en` olan bir adresi açtığında yazılır (düğmenin açtığı
adres budur; sayfa betiği değeri saklar ve kelimeyi adresten siler). Ne içindir: sonraki sayfaların
seçilen dilde açılması. Kimlik, proje, video, dosya adı ya da zaman içermez; hiçbir yere gönderilmez;
tanı dosyasına girmez.

**Yazılmadan önce ne okunur:** her uygulama sayfasının `<head>`'indeki dil betiği
(`web/scripts/lib/language-redirect.js`, derleme sonrası `apply-csp.mjs` ile yazılır, hash'i CSP'de)
bu anahtarı ve yoksa tarayıcının kendi dil listesini (`navigator.languages`) **cihazda** okur:
listede Türkçe İngilizceden önce geliyorsa Türkçe, İngilizce önce geliyorsa ya da ikisi de yoksa
İngilizce; liste boşsa sayfa olduğu gibi kalır. Sayfanın dili farklıysa sayfa gizlenir ve aynı sayfanın
öbür dildeki önceden çizilmiş ikizi açılır (sorgu ve hash korunur). Dil listesi hiçbir yere gönderilmez,
saklanmaz. Tarayıcı depolamayı reddederse okuma ve yazma `try/catch` içindedir: seçim hatırlanmaz,
tarayıcının dili karar verir.

Silinmesi: `/gizlilik` "Dil seçimi" kartında **"Dil seçimini unut"**; tarayıcının site verisini
temizleyince. Kaynak: `web/src/adapters/languageChoice.ts`, `web/src/components/LanguageSwitch.tsx`,
`web/src/components/LanguageChoicePanel.tsx`, `web/scripts/lib/language-redirect.js`; testler:
`web/tests/unit/languageRedirect.test.ts` (sayfaya giden betiğin kendisi), `web/tests/e2e/english.spec.ts`
("the language button", "the privacy page lists the choice and forgets it").

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
  **Tek istisna (13 Ekim 2026, ADR-034 ekleri; her derlemede):** "Yazıya dök"te çıkan yazının — cihazda
  (ADR-036) ya da internette (ADR-039, yalnız yol açık derlemede) yazılmış — üstünde "Daha fazla ayar →
  editörde aç"a basılınca editör o çalışmayı **proje olarak saklar**: §2.1'deki `projects` kaydının
  aynısı, aynı anahtar, aynı otomatik kayıt (ne saklandığı ve ne saklanmadığı §8.4a'daki tabloda; o tablo
  cihazda yazılan yazı için de geçerlidir, `speaker` yalnızca internet yolunda olur). Satır çıkmamışsa
  saklanmaz. Depoda üstünde çalışılmış bir proje varsa önce sorulur ("Saklanan bir projen var"); seçilmeden
  hiçbir şey yazılmaz. Adres `/editor` olur; yenileme projeyi geri getirir ve video dosyasını yeniden
  ister. **Silme:** §2.1'deki proje silmenin aynısı — editörde "Diğer → Kayıtlı projeyi sil" (ya da editör
  dosyayı yeniden istediğinde aynı düğme), ya da tarayıcı verisini temizlemek. Öbür dokuz sihirbaz için yukarıdaki cümle değişmedi
  (e2e: `transcript-keep.spec.ts`, `wizards.spec.ts`). `/gizlilik` "Proje tarifi" kartı bunu söyler.
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
  `clip-models-` ile başlayan önbellekleri siler (`modelStore.ts`, `deleteStoredModels`). **14 Ekim 2026:** büyük model bu tarayıcıda yazarken durduysa "Yazıya dök" adımı ayrıca
  "Büyük modeli sil"i sunar: yalnızca büyük modelin kendi dosyaları (≈566,5 MB) silinir, küçük model
  ve iki modelin ortak dosyaları kalır (`deleteModelFiles`); kendiliğinden hiçbir şey silinmez (§2.8a). Sabit
  revizyon değişirse eski revizyonun dosyaları bir sonraki indirmede silinir (`pruneStale`).
  İndirme sırasında `navigator.storage.persist()` istenir (tarayıcı depolama baskısında dosyaları
  kendiliğinden atmasın diye; Firefox bunu kullanıcıya sorar).
- **"İyileştir" (ADR-037):** yeni saklanan veri yok. Videonun kareleri worker'da çözülür,
  ölçülür (histogram, renk dengesi, kumlanma, keskinlik: birkaç sayı) ve işlenir; ölçümler
  yalnızca açık sekmenin belleğindedir ve sekme kapanınca gider, hiçbir yere gönderilmez.
  Editörde ayar açılırsa tarifte yalnızca `enhance: { strength }` saklanır (EDL v4): hangi güç
  seçildiği; görüntüden türetilmiş hiçbir şey değil. Sihirbaz proje saklamaz.
- **"Sesi düzelt" (ADR-049, 18 Ekim 2026):** yeni saklanan veri yok. Videonun sesi ses yüksekliği
  worker'ında iki kez çözülür ve ölçülür (ses yüksekliği, aralık, tepe, iki kazanç: birkaç sayı);
  "Önce / Sonra" düğmeleri için 5 saniyelik iki ses parçası açık sekmenin belleğinde tutulur ve
  sayfanın kendi ses çıkışından çalınır. Hiçbiri saklanmaz, hiçbir yere gönderilmez; sekme kapanınca
  gider. Tarife bir şey yazılmaz (şema değişmedi); kazançlar yalnızca o indirmeyle worker'a gider.
- **Transkript metni:** altyazı izi olarak proje tarifinin içindedir (`captionTracks[0]`,
  `origin: 'transcript'`, EDL v3). Editörde (`/editor`) diğer altyazı satırları gibi IndexedDB'ye
  saklanır ve proje yedeğine girer (§2.1); sihirbazın (`/yap/yazi`) sonuç ekranında hiçbir şey saklanmaz,
  "Daha fazla ayar → editörde aç"a basılınca proje olarak saklanır (§2.7; 13 Ekim 2026).
  Kelime zamanları saklanmaz; yalnızca satırlar ve "anlaşılamadı" aralıkları.
- **Kullanıcının tetiklediği yeni indirmeler:** "Metni indir" (TXT, zaman damgalı satırlar),
  "SRT / VTT indir", "Altyazılı videoyu indir" (MP4). Hepsi tarayıcının yazdığı yerel dosyalardır.
- **Ölçüm kancası:** `globalThis.__clipTranscriptRuns` dizisi sayfa yüklenmeden önce tanımlanmışsa
  (yalnız ölçüm betikleri tanımlar) istemci bir koşunun kelime zamanlarını oraya yazar; olağan
  kullanımda dizi yoktur ve hiçbir şey yazılmaz (`__clipSilenceEnvelopes` ile aynı kalıp).

### 2.8a localStorage — "büyük model burada durdu" notu (2026-10-14, ADR-036 eki)

Tek anahtar: `clip.transcriptLargeFailed`, değeri `1`. **Yalnızca** büyük konuşma modeli
(`large-v3-turbo`) bu tarayıcıda yazıya dökerken beklenmedik bir hatayla durduğunda yazılır (iç hata,
bellek yetmedi, model başlatılamadı; videonun sesi olmaması, okunamaması, eksik model dosyası ya da
"Durdur" yazmaz). Ne içindir: uygulama bu tarayıcıda büyük modeli artık "Önerilen" göstermez ve ön
seçmez, küçük modeli önerir; büyük modelin satırı "Bu cihazda daha önce yazıya dökerken durdu" der.
Zaman, kimlik, video, dosya adı, hatanın metni ya da cihaz bilgisi içermez; hiçbir yere gönderilmez;
tanı dosyasına ("Sorun bildir") girmez. Tarayıcı depolamayı reddederse (gizli pencere) okuma ve yazma
`try/catch` içindedir; not yalnızca açık sekmenin belleğinde kalır.

Silinmesi: büyük model bu tarayıcıda bir kez yazıyı bitirebilirse kendiliğinden; `/gizlilik`
"Konuşma modeli" kartında ve editörde "Kısayollar ve sınırlar" penceresinde **"Bu notu sil"**;
tarayıcının site verisini temizleyince. Kaynak: `web/src/adapters/transcript/largeModelNote.ts`,
`web/src/components/transcript/useTranscription.ts`, `ModelStoragePanel.tsx`; testler:
`web/tests/e2e/transcript-large-fallback.spec.ts` (yazılır; tek yeni anahtar budur ve değeri `1`;
gizlilik sayfasından silinir; büyük model çalışınca kendiliğinden gider), `web/tests/e2e/privacy.spec.ts`
("Büyük model notu" kartı). Aynı değişiklikte, kullanıcı basarsa yalnızca büyük modelin kendi
dosyalarını silen **"Büyük modeli sil"** eklendi (§2.8 deposu; önbelleğin adı ve biçimi değişmedi;
küçük model ve ortak dosyalar kalır).

### 2.9 Cache Storage `clip-shared` — paylaşılan video, geçici kopya (2026-10-17, ADR-047)

"LiloCut'a paylaş": Android'de yüklü uygulama, telefonun paylaşma menüsünde videolar için bir hedeftir
(manifest `share_target`, yalnız `video/*`). Galeride (WhatsApp, Dosyalar…) bir videoda "Paylaş → LiloCut"
denince **telefonun tarayıcısı** videoyu uygulamanın adresine (`<base>/paylas/`) bir form gönderimi (POST,
`multipart/form-data`) olarak verir. Bu istek **cihazda kalır**: sitenin service worker'ı onu ağa çıkmadan
alır (`web/scripts/lib/share-target.mjs`, `sw.js`'e derleme anında yazılır) ve açılış ekranını açar.

- **Ne saklanır:** paylaşımın **ilk videosu**, bir kopya olarak; yanında başlıklarda adı, türü, değiştirilme
  tarihi, paylaşıldığı an ve paylaşımda kaç dosya geldiği. Başka hiçbir şey: paylaşımın öteki dosyaları
  (ikinci video, resim) ve metin alanları hiç saklanmaz. Kimlik, cihaz bilgisi yok.
- **Nerede:** Cache Storage, **`clip-shared`** adlı önbellek, **en çok bir kayıt** (yeni paylaşım eskisini
  siler). Anahtar `<base>/paylas/dosya/<id>` — hiçbir sunucunun sunmadığı, worker'ın yanıtlamadığı bir adres;
  `<id>` paylaşım anı + 6 rastgele harf. IndexedDB'ye (projeler) ve OPFS'e **dokunulmaz**. `clip-app-*`
  önbelleğinin (§2.5) ve `clip-models-*`'in (§2.8) dışındadır; worker'ın "eski sürüm" temizliği ve
  "Uygulamayı baştan indir" (§2.4a) ona dokunmaz.
- **Ne zaman silinir:** (1) bir iş (Kes, GIF yap…) videoyu aldığı anda — sihirbaz videoyu açarken kopyayı
  siler; videonun sayfadaki `File`'ı silinen kopyanın diskteki baytlarını okumaya devam eder (e2e: GIF bu
  silinmiş kopyadan yapılır); (2) açılış ekranında "Başka bir video seç"e basılınca; (3) hiçbir işe
  dokunulmazsa, açılış ekranı açıkken paylaşımdan **15 dakika** sonra (sayfanın zamanlayıcısı); (4) uygulamanın
  **her açılışında**: adresi o paylaşımı göstermeyen her sayfa (`?paylasim=<id>`) açılırken bütün paylaşılan
  videoları, adresindeki paylaşım 15 dakikadan eskiyse onu da siler; (5) worker'ın her etkinleşmesinde 15
  dakikadan eski olanı; (6) tarayıcının site verisini temizleyince. Son kayıt gidince önbelleğin kendisi de
  silinir; hiç paylaşım yapılmamış bir tarayıcıda `clip-shared` hiç oluşmaz (bakmak oluşturmaz).
- **Ağ:** service worker varken paylaşım hiçbir ağ isteği yapmaz; yönlendirme (303) de cihazdadır.
  **İstisna — worker yokken:** tarayıcı bu sitenin verisini silmişse (kullanıcı temizledi ya da tarayıcı yer
  açmak için sildi) ya da worker hiç kurulamadıysa (ör. disk doluydu) worker yoktur; o zaman tarayıcı POST'u
  **sitenin sunucusuna gönderir** (video gövdesiyle). Statik bir dosya sunucusu bunu kabul etmez:
  GitHub Pages POST'a 405 veriyor (canlı sitede 17 Ekim 2026'da doğrulandı; ADR-047 ek). Yüklü uygulama
  açılırken `navigator.storage.persist()` ister ki tarayıcı disk dolunca bu veriyi (worker dahil) silmesin;
  yeni bir şey saklanmaz (ADR-047, "Uygulama hazır değilken"); `next start` "Server action not found." der. Uygulama açılmaz,
  tarayıcıda hiçbir şey saklanmaz (e2e). Sağlayıcının bu istekten ne kaydettiği kendi bildirimine tabidir
  (§4.2, `/gizlilik` "Sunucu erişim kayıtları").
- **Bulut yolu açık derlemede (§8):** paylaşılan video galeriden seçilen bir video gibidir; yalnız kullanıcı
  "Yazıya dök"te "İnternette"yi seçip gönderirse **sesi** gider (§8.2); kopyanın kendisi hiçbir zaman.
- **Kaynak:** `web/src/app/manifest.ts`, `web/scripts/lib/share-target.mjs`,
  `web/scripts/lib/service-worker.js`, `web/src/adapters/pwa/sharedVideo.ts`,
  `web/src/components/home/HomeIntro.tsx`, `web/src/components/wizard/WizardFlow.tsx`,
  `web/src/components/pwa/PwaClient.tsx`. **Testler:** `web/tests/unit/shareTarget.test.ts`,
  `web/tests/unit/serviceWorker.test.ts` (worker'ın POST'u), `web/tests/e2e/share-target.spec.ts` (alma,
  silme: alınınca, 15 dakika, sonraki açılış; worker yokken POST sunucuya gider ve hiçbir şey saklanmaz),
  `web/tests/pages/pages-smoke.spec.ts` (`/capcut/` altında), `privacy.spec.ts` ("Paylaştığın video" kartı).

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
uygulama dosyası dışında bir şey girmesi ya da çalışırken ağ yanıtlarını önbelleğe yazmaya başlaması;
paylaşılan videonun (§2.9) birden fazlasının, ya da 15 dakikadan uzun saklanması, ya da `clip-shared` dışında bir
yere yazılması.

## 7. Açık kurucu kararları (uygulama bunları uydurmaz)

- Bulut yazıya dökme yolu için: §8.6.

- ~~Veri sorumlusu (kişi/şirket)~~ — 14 Ekim 2026: kurucu, kişi olarak, şirket kurulana kadar (adı yayın
  derlemesinin ayarından; yukarıdaki not). ~~Gizlilik iletişim adresi~~ — destek iletişimi (GitHub Issues; herkese
  açıktır, `/gizlilik` bunu söyler). Açık kalan: faaliyet yeri — belge 30 K02.
- Hukuki dayanak ve başvuru/hak kullanma yolu — hukuki inceleme.
- Barındırma sağlayıcısı ve sunucu erişim kaydı saklama süresi.
- Destek iletişim adresi (`NEXT_PUBLIC_SUPPORT_CONTACT`) ve kullanıcının gönderdiği tanı
  dosyalarının saklama süresi (belge 19 "en çok 7 gün" önerisi — onaylanmadı).
- Uygulama adı (K01) kararlaştırıldı: **LiloCut** (10 Ekim 2026, ADR-038). Sayfa başlıkları, yüklenen uygulamanın adı
  ve indirilen dosya adları (`lilocut-tani-…json`, `….lilocut.json`) bu adı kullanır. Tarayıcıda tutulanların adları
  bilerek değişmedi (`clip-editor`, `clip-export-`, `clip-app-`, `clip-models-`, `clip.firstRunHint.dismissed`):
  değişseydi kayıtlı projeler ve indirilmiş modeller sahipsiz kalırdı. Açık kalan: marka/alan adı incelemesi.

## 8. Bulut yazıya dökme yolu (ADR-039) — yazıldı, KAPALI (2026-10-11); 14 Ekim 2026: yayında davetli deneme olarak açılıyor (§8.7)

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
- **Silme hiç yapılamazsa** sağlayıcının kendi saklama kuralı geçer (belgeleri, 10 Ekim 2026'da okundu;
  ADR-039): yüklenen ses için silme 24 saatte başlar, en geç 48 saat; yazı 30 gün sonra kendiliğinden
  silinmeye başlar; silinen kaydın kimliği ve süresi faturalama için sağlayıcıda kalır. Model eğitimi: biz
  bir söz vermeyiz (sağlayıcının belgesi AB sunucularını kullananların verisini eğitimde kullanmadığını
  söylüyor; ücretsiz hesap için ayrıca doğrulanmadı — ADR-039 "Doğrulanmayanlar"). 14 Ekim 2026'dan beri
  `/gizlilik` bunları söyler (`cloud.privacy.deletion`, `cloud.privacy.retention`, `cloud.privacy.training`)
  ve sağlayıcının iki belgesine bağlantı verir (saklama ve model eğitimi; veri işleme sözleşmesi).
- Yazı: sonuç geldikten sonra yalnızca bu tarayıcıdadır (tarif, §2.1 / §2.3). Sihirbazın sonuç
  ekranında yalnızca bellekte; "Daha fazla ayar → editörde aç"a basılınca IndexedDB'de (§8.4a).

### 8.4 Bu tarayıcıda saklanan (yalnız açık derlemede)

| Ne | Nerede | Ne zaman yazılır | Nasıl silinir |
|---|---|---|---|
| Davet kodu | `localStorage` → `clip.cloudInvite` | Yalnızca "Kodu kaydet"e basılınca **ve** Worker kodu kabul edince. Biçime uymayan kod hiçbir yere gönderilmez ve yazılmaz. | "Davet kodunu kaldır" (seçim ekranında ve `/gizlilik` sayfasında); kod geri çekilmişse bir sonraki açılışta kendiliğinden; tarayıcı verisini temizleyince. |
| Seçilen yol (cihaz / internet) | **saklanmaz** | — | Her videoda yeniden sorulur. |
| Kim konuştu (13 Ekim 2026, ADR-043) | Proje tarifinde, satırın kendisinde: `speaker`, 1–20 arası bir **sıra numarası** (ilk duyulan ses 1). Ad, ses izi ya da sağlayıcının kimliği **değil**. Sihirbazın sonuç ekranında yalnızca bellekte; editöre geçince (§8.4a) ve `/editor`'de altyazı satırlarıyla birlikte IndexedDB'de ve proje yedeğinde (§2.1). | Sonuç geldiğinde tarife; depoya editöre geçişte ve editörün otomatik kaydıyla | Satır ya da proje silinince; tarayıcı verisi temizlenince. TXT ve VTT dosyalarına "1. kişi" olarak yazılır; SRT'ye ve videoya yazılmaz. |

Kanıt: `cloud-flow.spec.ts` → "never chosen for the user and never remembered" (localStorage'da
yalnızca `clip.cloudInvite`; sessionStorage boş) ve "the invite code can be removed…".

### 8.4a İnternette yazılan yazı: editöre geçişte proje olarak saklanır (13 Ekim 2026, ADR-034 eki)

Kurucu kararı (13 Ekim 2026): "Bulut yazısı editöre geçişte saklansın." Aynı akşam: cihazda yazılan yazı
da — yani bu tablo artık **her derlemede, her iki yol için** geçerlidir (§2.7); yalnızca `speaker` satırı
internet yoluna özgüdür. Yeni bir depo, yeni bir alan ya da şema değişikliği **yok**: yazılan şey
§2.1'deki `projects` kaydının aynısıdır (`ProjectRecord`, EDL v5), aynı anahtarla (`p_local_001`), aynı
otomatik kayıtla.

| Ne zaman | Depoda ne var |
|---|---|
| Yazı sonuç ekranında (editör açılmadı) | **Hiçbir şey.** Ekran bunu söyler: "Bu yazı henüz saklanmadı: editörde açarsan ya da metni indirirsen kalır, yoksa sayfa kapanınca gider." Sayfa yenilenirse yazı gider (e2e). |
| "Daha fazla ayar → editörde aç"a basıldı, depoda proje yok (ya da yalnızca açılmış, üstünde çalışılmamış bir video kaydı var) | Proje kaydı hemen yazılır: satırların metni, zamanı, **kim konuştu** numarası (`speaker`), biçim ayarları, kaynak dosyanın adı / boyutu / tarihi / süresi / çözünürlüğü / türü (§2.1'deki `bindings`). Ses, görüntü, davet kodu, iş kimliği, sağlayıcının yanıtı, kelime zamanları **yok**. |
| Aynı düğme, depoda üstünde çalışılmış bir proje var (kesit, altyazı / yazı satırı, müzik ya da proje adı) | Kullanıcıya sorulur; seçmeden hiçbir şey yazılmaz. "Eski proje kalsın (bu yazı saklanmaz)" → depoya dokunulmaz, editör saklamadan açılır ve başlığı "Bu düzenleme saklanmıyor" der. "Bu yazı saklansın (eski proje silinir)" → eski kaydın yerine yenisi yazılır. "Vazgeç" → hiçbir şey değişmez. |
| Depo kullanılamıyor (gizli pencere, dolu disk) | Yazılamaz; editörün başlığı "Düzenleme saklanamadı" ve nedenini söyler, "Yedek dosyasını indir" sunulur. |
| Depodaki kayıt daha yeni bir derlemenin | Açılmaz ve üstüne **yazılmaz** (ADR-043 Karar 3); başlık bunu söyler. |

- **"İnternette yazıldı" bilgisi saklanmaz.** Tarifte yazının nerede yazıldığını tutan bir alan yok ve
  eklenmedi (şema değişikliği olurdu). Depodaki kayıttan, yazının bir sunucuda yazıldığı **anlaşılmaz**;
  cihazda yazılmış bir yazının kaydıyla aynı biçimdedir (fark: satırlarda `speaker`). Editör bu izi
  "Otomatik yazıldı — yanlış olabilir" diye gösterir.
- **Silme:** §2.1'deki proje silmenin aynısı — editörde "Diğer → Kayıtlı projeyi sil" (video açıkken de,
  14 Ekim 2026) ya da editör video dosyasını yeniden istediğinde aynı düğme (onaydan sonra kayıt silinir ve
  o sekmede geri yazılmaz, ADR-012 ekleri; e2e), ya da tarayıcının site verisini temizlemek.
- **Adres:** saklanan geçişte adres çubuğu sayfa yüklenmeden `/editor` olur (`history.replaceState`);
  adrese kişisel hiçbir şey yazılmaz. Yenileme editörü açar, kayıtlı proje geri gelir ve video dosyası
  yeniden istenir (dosyanın kendisi hiçbir yerde saklanmaz, §2.3).
- **Cihazda yazılan yazı** (13 Ekim akşamı): aynı kural, aynı kayıt, aynı sorgu; sihirbazın sonuç
  ekranında saklanmaz, editöre geçince saklanır. Satır çıkmamışsa saklanmaz. Vekile istek gitmez (e2e).

Kod: `web/src/domain/wizardHandoff.ts` (kural), `web/src/components/transcript/KeepOnHandoff.tsx` (soru;
sabah `CloudKeep.tsx`, yalnız bulut derlemesinde), `web/src/components/wizard/TaskWizard.tsx`,
`useProjectPersistence.ts` (`adopt`). Kanıt: `tests/e2e/transcript-keep.spec.ts` (yayındaki derleme,
cihazda yazılan yazı), `tests/cloud/cloud-keep.spec.ts`, `tests/unit/wizardHandoff.test.ts`.

### 8.5 `/gizlilik` sayfası

Koşulludur (`src/components/PrivacyPage.tsx`, `CLOUD_ON`): yol kapalıyken hiçbir cümle değişmez.
Açıkken "hiçbir sunucuya gönderilmez", "Uygulama senin adına hiçbir şey göndermez" ve "bulutta
çalışan bir yapay zekâ kullanılmaz" cümleleri doğru karşılıklarıyla değişir ve "İnternette yazıya
dökme (isteğe bağlı, davetli deneme)" bölümü eklenir: ne gider, kime, nerede işlenir (AB), ne
zaman silinir, başkalarının sesi, vekilin tuttuğu kayıt, dakika sorgusu, denemenin sınırı; ayrıca
"Davet kodu" kartı ve kaldırma düğmesi. Kanıt: `tests/cloud/cloud-choice.spec.ts`,
`tests/e2e/cloud-off.spec.ts`.

13 Ekim 2026 (ADR-034 eki): açıkken bölüme "Yazı cihazında nerede durur" maddesi (`cloud.privacy.kept`:
önce yalnızca açık sayfada; editörde açılınca bu tarayıcıda proje olarak; önceki proje varsa sorulur;
nasıl silinir) ve "Proje tarifi" kartına bir cümle (`cloud.privacy.stored.project.extra`) eklenir.
Kapalıyken kartın cümlesi ("…ana ekrandaki bir işten başlattığın çalışma saklanmaz") değişmedi ve o
derlemede doğrudur. Kanıt: `tests/cloud/cloud-keep.spec.ts` (son sınama), `tests/unit/wizardHandoff.test.ts`.

### 8.6 Açık kurucu kararları

- ~~Veri sorumlusu~~ — 14 Ekim 2026: kurucu, kişi olarak (yukarıdaki not). **Hukuki dayanak (K02) hâlâ
  açık:** bulut yolu kişisel veriyi (sesi) üçüncü tarafa aktaran ilk özelliktir; belirlenmeden davetli deneme
  dışına açılmamalı (sayfa bunu söyler).
- ~~Bölge~~ — 14 Ekim 2026: AB (Worker `PROVIDER_REGION=eu`; kurucu kararı). `us` yapılırsa ekran ve gizlilik
  metni yanlış olur.
- ~~Bulut dakikasının ücretli/ücretsiz/deneme oluşu~~ — 14 Ekim 2026: ücretsiz davetli deneme, davet başına
  dakika, aylık tavan (politika `2026-10-14.v10`, belge 15).
- ~~Konuşmacı etiketlerinin kalıcı olması (EDL v5).~~ — 13 Ekim 2026: yapıldı (ADR-043; §8.4).
- ~~İnternette yazılan yazının kalıcılığı.~~ — 13 Ekim 2026: editöre geçişte saklanıyor (§8.4a).
- ~~Cihazda yazılan yazı da editöre geçişte saklansın mı.~~ — 13 Ekim 2026 akşamı: evet, yapıldı (§2.7;
  ADR-034 "Ek 2").
- "İnternette yazıldı" bilgisi kayıtta tutulsun mu (şema eklemesi; ADR-043 madde 5).
- Kişileri yeniden adlandırma (ADR-043): gelirse tarife **serbest metin** (bir ad) girer; bu envanter
  ve `/gizlilik` o değişiklikle birlikte güncellenmeli.

### 8.7 Yayın anı: davetli deneme (14 Ekim 2026, kurucu kararı)

Kurucu kararı: yol yayındaki sitede **davetli, ücretsiz deneme** olarak açılır; davet başına dakika, iş başına
en çok 120 dakika, Worker'da aylık 1 $ kesin tavan, AB bölgesi (politika `2026-10-14.v10`). Vekil Worker
kurucu tarafından yayınlandı; anahtarı ve defteri oradadır. **Siteye geçiş tek bir depo değişkeniyle olur**
(`CLOUD_TRANSCRIPT_URL`); bu çalışma değişkeni **ayarlamadı** ve Worker'a **hiç istek göndermedi**.

Geçiş anında yayındaki derlemede değişen (yukarıdaki tablolar zaten açık derlemeyi anlatıyordu):

| Nerede | Kapalıyken (bugün) | Açıkken |
|---|---|---|
| Her sayfanın `connect-src`'si | `'self'` | `'self'` + vekilin tek kökeni; başka hiçbir yönerge onu anmaz |
| "Yazıya dök" | Doğrudan cihaz üstü adımlar | Önce "Yazıyı nerede çıkaralım?" (kurucu onaylı B ekranı) |
| `/gizlilik` | Bugünkü cümleler | §8.5'teki değişiklikler + 14 Ekim'de eklenen: silme süreleri (bizim yeniden denememiz: 60 dk / en geç 24 saat / 10 dakikada bir), silinemezse sağlayıcının kuralı (48 saat / 30 gün), model eğitimi için söz verilmemesi, sağlayıcının iki belgesine bağlantı, denemenin ücretsiz ve sınırlı oluşu, veri sorumlusu cümlesi |
| Açılış ekranı alt yazısı (`home.trust`, `landing.note`) | "Videon cihazından çıkmaz." · "…bulut yükleme yok; her şey cihazında çalışır." | "Videon cihazından çıkmaz; yalnızca sen seçersen sesi gider." · "…Tek istisna: “Yazıya dök”te “İnternette”yi seçersen videonun yalnızca sesi gönderilir." |
| Editörün şeridi, alt çubuğu, "Kısayollar ve sınırlar" | "…bulut yok", "…bulut yüklemesi yok", "Bulut, hesap ve ödeme yok…" | "bulut yok" demez; yardım penceresi internet yolunu ve yalnızca sesin gittiğini söyler (`*.online` anahtarları, `messages.ts`) |
| Bu tarayıcıda saklanan | §2 | + davet kodu (`clip.cloudInvite`, yalnızca "Kodu kaydet"le) |

Değişmeyen: editördeki "Videoyu yazıya dök" yalnız cihaz üstüdür; sihirbazların "Videon cihazından çıkmaz"
alt yazısı o sihirbazda doğrudur (öbür sihirbazlar hiçbir şey göndermez).

**Ön uçuş sınaması** (`web/tests/pages/cloud-preflight.spec.ts`, Pages duman sınamasıyla birlikte koşar; yol
kapalı derlemede atlanır): her sayfada `connect-src` tam olarak `'self'` + vekil; seçim ekranı kurucunun
sözleriyle; `/gizlilik`'te bulut bölümü ve **adı verilmiş veri sorumlusu ile iletişim adresi** (yol açıkken
ad verilmemişse sınama — ve CI'da yayın — durur); sayfalar gezilirken, seçim ekranı açıkken ve "Cihazımda
yaz"dan sonra vekile **tek istek gitmez**; "Kodu kaydet"e basınca giden tek şey kalan dakika sorusudur (kod
yalnızca başlıkta). Sınamada vekile giden her istek yakalanır (durdurulur ya da sınamanın kendi sahte
yanıtıyla karşılanır); gerçek vekile hiçbir şey ulaşmaz.

Doğrulanmayan (geçişten sonra kurucunun kendi telefonunda, kendi davetiyle bakılmalı; ADR-039 "Kabul" eki):
gerçek Worker'ın CORS'u ve akıtılan yükleme, tarayıcının ürettiği ses dosyasının gerçek sağlayıcıda kabulü,
Worker'ın gerçekten `PROVIDER_REGION=eu` ve `MONTHLY_CAP_USD=1` ile çalıştığı (depodaki `wrangler.jsonc` öyle;
yayındaki ayarlar bu çalışmada okunmadı).
