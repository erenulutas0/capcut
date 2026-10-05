# ADR-036 — "Yazıya dök": cihaz üstü İngilizce transkript, otomatik altyazı, yazıdan kesit

> Tarih: 2026-10-04 · Durum: UYGULANDI (motor, model deposu, sihirbaz, editörde "Yazı" sekmesi,
> testler). Politika `2026-10-04.v7` (belge 15), şema **EDL v3** (belge 10).
> Dayanak: [ADR-017](ADR-017-transcript-on-device.md) (rota ve eşikler),
> `docs/spikes/2026-10-03-asr-on-device-english.md` (Ekim denemesi: gönderilecek bileşim),
> [ADR-015](ADR-015-captions-burn-in.md)/[ADR-016](ADR-016-captions-srt-vtt-source-time.md)
> (altyazı izi, kaynak zamanı, videoya işleme), [ADR-034](ADR-034-task-first-home.md) (kartlar ve
> sihirbaz çatısı), [ADR-031](ADR-031-phone-share-install-offline.md) (service worker).
> Bu belgedeki her sayı `web/transcript-results/` altındaki ham dosyalardan
> (`node scripts/transcript/score.mjs`) ya da adı verilen testten gelir; tahmin yoktur.
> Ölçülmeyenler "Ölçülmeyen / yapılmayan" bölümündedir.

## Kurucu kararları (4 Ekim 2026) ve ne yapıldığı

| # | Karar | Yapılan |
|---|---|---|
| 1 | "Yazıya dök": YouTube tarzı transkript + otomatik altyazı, şimdilik İngilizce, cihazda | Yapıldı. Ses cihazdan çıkmaz; ücretli API yok. |
| 2 | Model kendi sitemizde (GitHub Pages), git'te değil; CI sabit revizyondan indirir, sha256 doğrular | Yapıldı (`web/scripts/fetch-models.mjs`, `ci.yml`). **Gerçek bir Pages yayınıyla denenmedi** (bu çalışma yayın yapmaz); sınırlar aşağıda. |
| 3 | CSP'ye `'wasm-unsafe-eval'` eklenebilir; başka gevşetme yok | **Eklenmedi: gerekmediği ölçüldü.** CSP 30 Eylül'deki hâliyle aynı. Aşağıda "CSP". |
| 4 | Küçük varsayılan (`base`, WASM), büyük isteğe bağlı (`large-v3-turbo`, WebGPU + `shader-f16`) | Yapıldı. `turbo` yalnızca WebGPU + `shader-f16` gerçekten varsa seçenek olarak görünür. |
| 5 | Cihaz üstü transkript ücretsiz temel özellik (belge 15) | Belge 15 `2026-10-04.v7`; bulut/ücretli AI satırı değişmedi. |

## Karar

### 1. Motor — denemenin gönderilecek bileşimi, adım adım aynı

`web/src/adapters/transcript/engine.ts` (worker içinde; denemenin `web/spike/asr/engine.js`'inden
taşındı):

1. **Silero VAD**, yayınlanmış varsayılanlarla (eşik 0,5 / 0,35; en kısa konuşma 0,25 s; 0,5 s'den
   kısa duraklama aralığı bölmez; iki yana 0,2 s pay) → konuşma aralıkları
   (`domain/speechSpans.ts`, denemenin `segments.mjs`'i).
2. Her aralık **tek başına** tanıyıcıya verilir; 30 s'den uzun aralık, pencerenin ikinci
   yarısındaki en düşük konuşma olasılığından bölünür.
3. Aralığın ortalama token log-olasılığı **−0,75'in altındaysa** ya da metni tekrar döngüsüyse
   (zlib oranı **> 2,4**) ya da metinde harf/rakam yoksa aralık **yazılmaz**: transkriptte
   "(anlaşılamadı)" aralığı olarak kalır (`domain/transcript.ts`, `spanVerdict`). Sessizce
   silinmez, yerine metin uydurulmaz.
4. Transformers.js'in sızdırdığı decoder önbelleği her aralıktan sonra bırakılır
   (`trackDecoderCaches` / `freeDecoderCaches`; denemede 10 GiB'a çıkan sızıntı).
5. Kelime zamanlarından model başına ölçülmüş sabit çıkarılır: `base` başlangıç 190 ms / bitiş
   200 ms, `turbo` 204 / 203 ms (denemenin long-a'da ölçtüğü; uygulama yolunda yeniden sınandı,
   aşağıda), aralığın dışına taşmadan.

Ses, videodan `mediabunny` `AudioSampleSink` ile **akış hâlinde** çözülür (sessizlik worker'ının
yolu, ADR-018/028), kanallar ortalanır, 16 kHz'e pencereli-sinc (Kaiser, ~80 dB) çok fazlı
örnekleyiciyle indirilir (`domain/resample.ts`; birim testi: seviye, perde, 10 kHz'in >60 dB
bastırılması, tıklamanın yerinde kalması, parça boyutundan bağımsızlık). Her çözülmüş parça kendi
zaman damgasıyla yerleştirilir (boşluk sessizlik olur, kodek ön dolgusu atılır): akışın `n`.
örneği videonun `n / 16000` s anıdır.

**Bellek uzun dosyada sınırlı — iki geçiş.** Birinci geçiş yalnızca konuşma olasılıklarını tutar
(saniyede 31 sayı); aralıklar belli olunca ikinci geçişte ses yeniden çözülür ve her aralığın
örnekleri (en çok 30 s = 1,9 MB) toplanıp tanıyıcıya verilir. Bütün ses hiçbir zaman bellekte
durmaz (120 dakika 16 kHz float 461 MB olurdu). Bedeli sesi iki kez çözmektir (ölçüm: dinleme
süresi, aşağıda).

**İlerleme gerçek sayıdır:** "Konuşma aranıyor: 03:10 / 12:00" (çözülen kaynak süresi) ve
"Yazılıyor: 14 / 87 konuşma parçası". Yüzde uydurulmaz; çubuğun değeri bu sayılardır.
**İptal** worker'ı sonlandırır; yarım sonuç saklanmaz (ADR-017).

**Tek iş parçacığı.** GitHub Pages COOP/COEP başlığı gönderemediği için `SharedArrayBuffer` yok;
`numThreads = 1` her yerde sabit (yerel sunucuda da), ölçülen ve yayınlanan aynı olsun diye.

**Motor ağa çıkamaz.** Kütüphanenin `fetch`'i (`env.fetch`) model deposunu okuyan bir fonksiyonla
değiştirildi; depoda olmayan dosya 404 alır. onnxruntime-web'in WebAssembly dosyası depodan bayt
olarak verilir (`wasmBinary`). Transformers.js'in tarayıcı önbelleği ve kendi wasm önbelleği kapalı.

Bağımlılıklar tam sürümle kilitli (`@huggingface/transformers` 4.3.0, içindeki `onnxruntime-web`
1.31.0-dev.20260914-8d85527a0); lisanslar ve dosya listesi `docs/security/DEPENDENCIES.md` §1.1.

### 2. Model: nereden gelir, nerede durur

- **Liste kaynak kodda sabit:** `web/src/domain/modelManifest.json` — her dosya için kaynak
  (Hugging Face deposu ve 40 karakterlik revizyon, ya da npm paketi ve sürümü), bayt sayısı,
  sha256. Birim testi çalışma zamanı dosyasının `node_modules`'taki dosyayla aynı olduğunu
  doğrular.
- **Derleme (CI):** `web/scripts/fetch-models.mjs` dosyaları önce `actions/cache`'ten (anahtar =
  listenin özeti), yoksa sabit revizyondan indirir, **her dosyanın uzunluğunu ve sha256'sını
  doğrular, tutmazsa derleme durur**, sonra `out/models/<grup>-<revizyon>/…` altına düz kopya
  olarak koyar (`--copy`: Pages yapıtı sabit bağ içeremez) ve `models/LICENSES.txt` yazar. Gerçek
  indirme yolu bu oturumda iki dosyayla denendi (Silero 2,2 MB ve `config.json`: indi, doğrulandı;
  bir baytı değiştirilen kopyada `--check` 1 ile çıktı).
- **Git'te değil** (`web/public/models/`, `web/.models-cache/` `.gitignore`'da), **service
  worker'ın listesinde değil** (`precache.mjs`: `/models/` hiç eşleşmez; paketleyicinin
  `_next/static/media/`'ya kopyaladığı 26,9 MB'lık `.wasm` de listeden çıkarıldı ve statik dışa
  aktarmadan silinir — aynı dosya sitede iki kez durmasın).
- **Tarayıcıda:** Cache Storage'da ayrı önbellek `clip-models-v1`
  (`adapters/transcript/modelStore.ts`). İndirme yalnızca **"Modeli indir (≈108,8 MB, bir kez)"**
  düğmesiyle başlar (düğmedeki sayı listedeki gerçek toplamdır). Büyük dosyalar 32 MiB'lik
  parçalarla (HTTP `Range`) iner ve her biten parça hemen saklanır: kesilen indirme **kaldığı
  parçadan** devam eder; `Range`'i yok sayan sunucuda da çalışır. Bütün parçalar gelince dosya
  akış hâlinde SHA-256'dan (`domain/sha256.ts`, FIPS 180-4; Node'unkiyle karşılaştırılarak
  sınanır) geçirilir; **tutmayan dosya silinir, işaretlenmez, kullanılmaz** ve kullanıcıya
  söylenir. İndirmeden önce `storage.estimate()` ile yer denetlenir; `storage.persist()` istenir.
- **Silme:** "Modeli sil" — `/gizlilik` sayfasındaki "Konuşma modeli" kartında ve editörde
  "Kısayollar ve sınırlar" penceresinde.
- **Çevrimdışı:** model indikten sonra yazıya dökme internetsiz çalışır (gerçek modelli e2e).

Düğmedeki 108,8 MB = `base` 79,7 MB + Silero 2,2 MB + onnxruntime WebAssembly 26,9 MB. Görev
tanımı "≈80 MB" diyordu; çalışma zamanı ve konuşma bulucu da kullanıcının indirdiği bayttır,
düğme hepsini söyler. `turbo` toplamı 595,6 MB (çalışma zamanı ve bulucu ortak: `base`'ten sonra
566,5 MB).

### 3. Veri: tek şekil — kaynak zamanlı altyazı izi (EDL v3)

Transkript ayrı bir varlık değil, doğrudan `captionTracks[0]`'dır: `timeBase: "source"`,
`origin: "transcript"`, `language: "en"`. Panel, videoya işleme, SRT/VTT ve yazıdan kesit aynı
satırları okur; yeni bir zaman eşlemesi yazılmadı (`outputCues`, ADR-016).

- **v3 = v2 + üç genişletme:** `origin`'e `transcript`; isteğe bağlı `unclear` (yazılamayan kaynak
  aralıkları; yalnız kaynak zamanlı transkript izinde); satır sınırı 500 → 3000. v2 tarif
  yalnızca numarası değişerek açılır (kayıpsız; `fixtures/edl/legacy-v2/` 3 geçerli + 1 geçersiz
  örnek, `fixtures.test.ts`); v1 → v3 zinciri duruyor. Eski projeler açılıyor (e2e
  `kesit.spec.ts` v2 kayıt, `captions.spec.ts` v1 yedek).
- **`unclear` çizilmez ve dışa aktarılmaz:** yalnızca panelde "(anlaşılamadı)" satırıdır. Üstüne
  elle satır yazılınca panelde bir daha görünmez. Matris satırı M22 bunu karede ölçer.
- **Kelime zamanları saklanmaz.** Satır (altyazı satırı = panel satırı) birimdir: tıklama satırın
  başına gider, kesit satırın aralığından yapılır, düzeltme satırın metnini değiştirir. ADR-017'nin
  "ayrı `TranscriptAsset`" taslağından sapma: iki ayrı şekil (kelimeler + satırlar) iki ayrı
  doğruluk kaynağı ve bir eşleme katmanı demekti; ilk sürümün hiçbir işi kelime zamanı istemiyor.
  Bedeli: bir satırı sonradan farklı bölmek için yeniden yazıya dökmek gerekir.
- **Girdi videonun tamamıdır** (ADR-017 "yalnızca tutulan anlar" diyordu): yazıdan kesit yapmak
  bütün videonun yazısını ister ve iz kaynak zamanlı olduğu için kesitler değişince yazı geçerli
  kalır. Eklenen müzik hiçbir zaman çözülmez.

### 4. Altyazı satırı kuralları (`domain/subtitleSegmentation.ts`)

Denemenin kuralları (§11.4), örneklerinde görülen iki kusur giderilerek:

- en çok 2 satır × 32 karakter; satır cümle sonunda, ≥ 0,5 s duraklamada, sığmayınca ya da 6 s'yi
  aşınca biter; yarıdan fazlası doluysa virgülde de biter;
- satır son kelimesinden 0,15 s sonra kalkar, sonrakinin üstüne binmez, arası elveriyorsa en az
  0,8 s görünür; 0,3 s'den kısa kalacak satır komşusuyla birleştirilir;
- iki satıra bölme en dengeli yerden, noktalama sonrası tercih edilerek;
- **"25 / -30" bölünmez** (tire, %, kesme ile başlayan ya da tire/para işaretiyle biten parça
  komşusuna yapışıktır); **kısa son parça tek başına satır olmaz** (10 karakterden kısaysa önceki
  satırla birleşir ya da ondan kelime alır);
- farklı konuşma aralıklarının kelimeleri aynı satıra girmez.
- **Çerçeveye sığma gerçek ölçümle:** satırlar üretilirken uygulamanın kendi altyazı yerleşimi
  (`layoutCaption`), gerçek yazı tipiyle, **9:16, 16:9 ve 1:1'in 720p ve 1080p'sinde**
  çağrılır (`fitsEveryFrame`); sığmayan aday satır hiç oluşmaz. Böylece uygulamanın yazdığı
  altyazı dışa aktarma ön denetiminde (ADR-015: üçüncü satır = ret) reddedilmez. İz sonradan
  "büyük" boya alınırsa ön denetim her elle yazılmış satırda olduğu gibi söyler.

Birim testleri gerçek model çıktısıyla çalışır (`tests/unit/fixtures/transcript-words.json`:
denemenin üç ham sonucundan birer dakika): her kelime tam bir satırda ve sırasında, satır
uzunluğu, süre, üst üste binmeme, uygulamanın metin kuralları ve üç çerçevede ön denetim.

### 5. Arayüz

**Kart ve sihirbaz** (`/yap/yazi/`, ADR-034 çatısı; adımlar: video → yazıya dök → indir):

1. "Videonu seç".
2. "Şimdilik yalnızca İngilizce konuşmaları yazıya döker. Yazıya dökme bu cihazda yapılır; videon
   ve sesin hiçbir yere gönderilmez." — her zaman, başlamadan önce.
   - Model yoksa: neden gerektiği + **"Modeli indir (≈108,8 MB, bir kez)"**; ilerleme bayt
     olarak ("34,2 MB / 108,8 MB"), "Durdur" (inen kısım saklanır), hata ve yeniden deneme.
   - WebGPU + `shader-f16` varsa model seçimi: "Küçük ve hızlı" / "Daha iyi kalite".
   - Model varsa: **"Yazıya dök"**; ilerleme gerçek sayılarla, geçen süre, "Durdur".
3. Sonuç: video + **yazı paneli** + "Altyazılı videoyu indir" (sihirbazın indirmesi; mevcut
   altyazı stili, varsayılan kutu/alt/orta), "Metni indir (TXT)", "SRT indir", "VTT indir",
   "Daha fazla ayar → editörde aç".

Dokunuş sayısı (kart dahil, dosya penceresi hariç): ilk kullanımda kart → Video seç → Modeli
indir → Yazıya dök → Altyazılı videoyu indir = **5**; model varken **4**; yalnız metin için 4 / 3.

**Yazı paneli** (`components/transcript/TranscriptPanel.tsx`; sihirbazda ve editörde aynı bileşen):

- zaman damgalı satırlar, yukarıdan aşağı; satır bir düğmedir: tıkla / Enter → video o ana gider;
- konuşulan satır işaretlidir (`aria-current`) ve oynarken görünür alanda tutulur: **liste**
  kayar (sayfa değil), **odak hiç taşınmaz**; kullanıcı listeyi kendi kaydırınca ya da klavyeyle
  gezince izleme durur, "Şimdiye dön" sürdürür; azaltılmış harekette kayma yerine atlama;
- liste gerçek bir listedir (`ul`/`li`), tek sekme durağıdır; ↑ ↓ Home End satırlar arasında gezer;
- kalem: satırın metni yerinde düzeltilir (Enter kaydeder, Esc bırakır; geri alınır); reddedilen
  düzeltme sebebini söyler;
- "(anlaşılamadı)" satırları yerinde durur, dinlenip elle yazılabilir;
- **"Bunlardan kesit yap"** (yalnız editörde): işaret kutularıyla seçilen satırlar kesit olur —
  her satırın aralığı (ilk kelimeden 0,15 s önce … satırın bitişi), listede yan yana seçilenler
  tek kesit; **hepsi ya da hiçbiri, tek geri alma adımı**; 20 kesit sınırı aşılırsa hiçbiri
  eklenmez ve kaç tanesinin sığdığı söylenir;
- makine çıktısı etiketi: **"Otomatik yazıldı — yanlış olabilir, düzeltebilirsin."**

**Editörde yerleşim: kesit listesinin yerinde "Kesitler | Yazı" sekmeleri.** Seçilen en basit
yerleşim bu, çünkü (a) masaüstünde video solda görünür kalırken yazı sağda akar — YouTube'un
düzeni; telefonda videonun hemen altında; (b) modal bir çekmece videoyu karartırdı ve "oynarken
izle" anlamsız olurdu; (c) Altyazı ayarları çekmecesi satır *düzenleme* yeri olarak kalıyor,
panel ise *gezinme ve kesme* yeri; (d) sekmeler yalnızca videoya bağlı satır varken görünür:
transkripti olmayan projede editör dünkü hâliyle aynıdır (mevcut testler değişmedi). Panel
kaynak zamanlı her izi gösterir — içe aktarılan SRT de "yazıdan kesit"e girer; makine etiketi
yalnız transkriptte çıkar. Editörde başlatma: "Diğer" ⋯ → "Videoyu yazıya dök (İngilizce)"
(aynı adımlar bir pencerede; var olan satırların yerini alacağını söyler, tek geri alma adımı).

Açılış ekranı sekiz kart oldu; "altyazı ekle", "yazıya dök", "transkript" artık işi başlatıyor.
"Bu henüz yok" yanıtı kodda duruyor (bir sonraki duyurulan iş için; birim testi), ama bugün
ulaşılabildiği bir iş yok.

### 6. Test ikizi (yalnız e2e derlemesinde)

Arayüz testleri her koşuda 109 MB indiremez. `CLIP_TEST_HOOKS=1` derlemesinde (ve yalnız onda)
bir test, sayfa yüklenmeden önce `window.__clipTranscriptTest` ile (a) kendi sunduğu **küçük bir
model listesi** ve (b) **sahte bir tanıyıcı** (`stubEngine.ts`: verilen aralıkları aynı worker
protokolünden yollar; hiçbir şey duymaz) verebilir. Gerçek olan her şey gerçek kalır: worker,
protokol, model deposu (parçalar, `Range`, sha256, silme), sihirbaz, satır kuralları, altyazı
izi, dışa aktarma. Yayına sızmaması üç yerde tutulur: bayrak her derlemede sabit bir değere
çözülür ve kapalıyken ikizin kodu pakete girmez (ölçüldü: olağan derlemede ikizin izi 0 dosyada,
e2e derlemesinde 1); `next.config.ts` statik dışa aktarmayı bu bayrakla derlemeyi reddeder;
`apply-csp.mjs` dışa aktarmada izi bulursa derlemeyi durdurur; Pages duman testi yayınlanan
betiklerde izi ve kanca adını arar.

Gerçek model ayrıca sınanır: `tests/e2e/transcript-real.spec.ts` ve Pages duman testinin iki
testi, model dosyaları yerindeyse koşar; yoksa **atlanır ve atlandığını yazar**.

## CSP: `'wasm-unsafe-eval'` eklenmedi

Kurucu eklenmesini onaylamıştı; **gerekmediği ölçüldü**, bu yüzden politika hiç gevşetilmedi.
WebAssembly sayfada değil transkript worker'ında derlenir; URL'den başlatılan worker'ı sayfanın
`<meta>` politikası değil kendi yanıt başlıkları yönetir ve statik barındırıcı başlık göndermez.
`web/scripts/transcript/csp-experiment.mjs`: anahtar kelime sayfanın politikasından çıkarılmış
hâlde gerçek modelle yazıya dökme — Chromium 153.0.8010.12, Chrome 154.0.8037.93, Edge
154.0.4258.53, Firefox 155.0: dördünde de çalıştı, 0 ihlal. Yayınlanan politika 30 Eylül'dekiyle
aynıdır; `csp.spec.ts` ve `tests/unit/csp.test.ts` değişmedi (ikisi de `unsafe-eval` geçen her
politikayı reddetmeye devam ediyor), `transcriptModels.test.ts` politikada `wasm-unsafe-eval`
olmadığını ayrıca sınar. Sınırı ve "başlık gönderebilen barındırıcıya geçilirse" notu güvenlik
belgesinde (`docs/security/2026-09-30-static-site-hardening.md`, 4 Ekim güncellemesi).

## Barındırma: yapıt boyutu ve GitHub Pages sınırları

| | Bayt |
|---|---|
| `base` (11 dosya) | 79 741 027 |
| `large-v3-turbo` (11 dosya; en büyüğü 370 035 242) | 566 460 117 |
| Silero VAD | 2 243 022 |
| onnxruntime-web WebAssembly | 26 861 777 |
| **Model dosyaları toplamı** | **675 305 943** (≈ 644 MiB) |

Sitenin geri kalanı ~3 MB'tır (ölçüm aşağıda "Paket boyutu"); yayınlanan site ≈ **0,68 GB**.

GitHub belgelerinden (4 Ekim 2026'da okundu; `docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits`
ve `actions/upload-pages-artifact` README):

- "Published GitHub Pages sites may be no larger than 1 GB." → 0,68 GB **sığıyor**; ikinci bir
  büyük model sığmaz.
- Yapıt: tek bir gzip'li tar, sembolik ya da sabit bağ içermemeli, "under 10GB (we recommend
  under 1 GB)". → betik `--copy` ile düz dosya yazar.
- "soft bandwidth limit of 100 GB per month" → ayda yaklaşık 900 `base` indirmesi (108,8 MB) ya
  da 168 `turbo` indirmesi (595,6 MB). Beta ölçeği için yeter; aşılırsa GitHub uyarır.
- "deployments will timeout if they take longer than 10 minutes" → 0,68 GB'lık yapıtın bu sürede
  yayınlanıp yayınlanmadığı **bilinmiyor**.
- Dosya başına sınır belgede yok; 100 MiB sınırı git içindir, yapıt için değil (370 MB'lık dosya
  git'e girmiyor).

**Gerçek bir yayınla denenmedi** (bu çalışma push/yayın yapmaz). Yerelde denenen: statik dışa
aktarma + iki model, `serve-static.mjs` ile `/capcut/` altında, `Range` istekleriyle; Pages duman
testi model dosyalarını bayt ve sha256 olarak doğrular ve sihirbazı gerçek modelle çalıştırır.
İlk yayında bakılacaklar: (1) yayın 10 dakikayı aşıyor mu; (2) `…/models/…/encoder_model_q4f16.onnx`
206 ile parça parça geliyor mu (GitHub Pages `.onnx`'i sıkıştırmadan sunmalı; sıkıştırırsa
`Range` kodlanmış bayta uygulanır ve sha256 tutmaz — uygulama o zaman dosyayı reddeder, yanlış
dosyayı kullanmaz); (3) e2e işinin süresi (ilk koşuda 566 MB indirir, sonra önbellekten).
Yayın `turbo` ile sığmaz ya da zaman aşımına uğrarsa: `ci.yml`'de model listesi `base` yapılır
(tek kelime); uygulama `turbo` dosyalarını bulamayınca "Model dosyası bu sitede bulunamadı" der
— bu durumda `turbo` seçeneği de arayüzden kaldırılmalıdır (bugün WebGPU'ya bakarak gösteriliyor).
Üçüncü taraf barındırıcıya düşülmez.

## Ölçüm — uygulama yolunda (deneme düzeneğinde değil)

**Nasıl:** `web/scripts/transcript/run-app.mjs` üretim derlemesini (`npm run build`, test kancasız;
`next start`) gerçek sihirbazdan sürer: video seç → "Modeli indir" → "Yazıya dök". Ham kelime
zamanları sayfanın etkisiz ölçüm kancasından (`__clipTranscriptRuns`), "gösterilen metin" panelin
DOM'undan okunur; "uydurma" yargısı **kullanıcıya gösterilen satırlar** üzerinden verilir.
Puanlama `score.mjs`: denemenin katı WER ölçüsü ve normalleştiricisi (`spike/asr/metrics.mjs`),
aynı referanslar. Makine denemeyle aynı (i5-12500, 12 çekirdek, 64 GB, RTX 3070 Ti); **boş
değildi**: koşular sırasında toplam işlemci doluluğu %44–95 (başka ajanlar ve kurucunun
programları). Ağır koşular `E:\capcut_better\.claude\measure-lock` kilidi altında yapıldı. **Hız
sayıları bu yüzden kötümser tarafta okunmalıdır.**

**Denemeden farkı (bilerek):** klipler denemenin 16 kHz WAV'ları değil, onlardan üretilmiş
**videolardır** (`prepare-media.mjs`: siyah 320×240 görüntü + AAC 48 kHz stereo 128 kbit/s MP4):
ölçülen yol AAC çözme → mono → 48→16 kHz → VAD → tanıyıcıdır. Deneme bunu "ölçülmeyenler"de
saymıştı.

### Uydurma metin (engelleyici ölçüt): 0

Doğru çıktısı boş olan 25 klip (`neg` 11, `negh` 6, `negv` 8 — sessizlik, gürültü, piyano, grup,
vlog müziği, üst üste müzik):

| Tarayıcı | Model | Uydurma metin gösteren klip | "(anlaşılamadı)" satırı |
|---|---|---|---|
| Chromium 153.0.8010.12 | `base` WASM | **0 / 25** | 7 klipte toplam 16 |
| Chrome 154.0.8037.93 | `base` WASM | **0 / 25** | 16 |
| Edge 154.0.4258.53 | `base` WASM | **0 / 25** | 16 |
| Firefox 155.0 | `base` WASM | **0 / 25** | 16 |
| Chromium 153 (WebGPU, pencereli) | `turbo` | **0 / 25** | 16 |

18 klipte konuşma bulucu hiçbir şey geçirmedi ("Bu videoda konuşma bulunamadı"); 7 klipte
(ritimli müzik) geçirdiği 16 aralığın hepsini koruma kuralı attı: kullanıcı kelime değil
"(anlaşılamadı)" görür, altyazılı video indirme kapalıdır. Duraklamalı kliplerde (pause-01/02)
boşluğa yazılan kelime: **0** (beş koşuda da). Kart bu yüzden açık.

### İngilizce doğruluk (katı WER; `base` WASM, Chromium 153)

| Klip | Uygulama | Deneme (aynı bileşim ya da en yakını) | Atılan aralık |
|---|---|---|---|
| long-a (8 dk, tek okuyucu) | **%4,9** | %4,5 (WebGPU, aralık başına) | 8 / 66 |
| long-b (8 dk) | **%8,6** | %5,4 (WebGPU, **paketli**; aralık başına ölçülmemişti) | 20 / 97 |
| long-c (18 dk, dört okuyucu) | **%6,9** | %5,9 (WebGPU, paketli) | 7 / 116 |
| long-fleurs (10 dk, 60 konuşmacı) | **%9,7** | %9,4 (WebGPU, paketli) | 3 / 69 |
| val-clean (doğrulama) | **%11,0** | %10,5 (WASM, aralık başına) | 1 / 28 |
| mix-clean | **%8,0** | %6,9 (WebGPU, aralık başına) | 2 / 21 |
| pause-01 + pause-02 | **%7,0** (17/244) | %6,1 (WASM, aralık başına) | 4 / 13 (dördü de müzik: doğru atma) |
| Eylül'ün 6 kısa temiz klibi | **%12,4** (16/129) | %9,3 (12/129) | 1 / 9 |
| müzik altında 20 / 10 / 5 / 0 dB | %9,3 / 10,1 / 12,5 / 15,7 | %9,0 / 8,8 / 9,3 / 14,3 (paketli) | 2 / 1 / 0 / 0 |
| pembe gürültü 10 / 5 dB | %19,7 / %38,7 | %11,1 / %20,7 (paketli) | 6 / 14 (31'er aralıkta) |
| val-music-5 / val-pink-5 | %10,6 / %62,6 | %11,0 / %52,9 (WebGPU, aralık başına) | 2 / 31, 21 / 41 |

Chrome 154 ve Edge 154 Chromium'la **kelimesi kelimesine aynı** çıktıyı verdi (pause %7,0,
long-fleurs %9,7, kısa klipler aynı); Firefox 155: pause %6,6, long-fleurs %9,8, altı kısa temiz
klip %11,6 (15/129).

**Okuma:** temiz uzun konuşmada `base` %4,9–9,7 (denemenin %4,1–9,4'üyle aynı bant), doğrulama
konuşmasında %11,0 (deneme %10,5), altı kısa klipte %12,4 (deneme %9,3; 129 kelimede 4 kelime
fark — en-05'te konuşma bulucu AAC'den çözülen seste aralığı 0,5 s geç başlattı ve ilk üç kelime
gitti). Yani **`base` ADR-017'nin %10 eşiğinin çevresinde, bir kısmı üstünde** — deneme de
"sınırda" demişti; uygulama yolu bunu iyileştirmedi, biraz kötüleştirdi. İki sebep ölçüldü:
(1) aralık başına çözmenin attığı gerçek aralıklar WER'e silme olarak girer (long-b'de 97
aralığın 20'si); (2) ses AAC'den geliyor. Gürültüde `base` hızla bozulur (pembe gürültü 5 dB:
aralıkların yarısı "(anlaşılamadı)"). Bu yüzden arayüz "Otomatik yazıldı — yanlış olabilir"
der ve model seçiminde "her 10–25 kelimede bir hata" yazar.

**`turbo` (WebGPU, Chromium 153, pencereli):** val-clean **%5,3**, long-a **%2,1**, mix-clean
%4,3, müzik 0 dB %4,5, pause %2,5, val-pink-5 %9,9, altı kısa klip %9,3 (12/129); atılan gerçek
aralık: long-a 2/66, val-pink-5 1/41, diğerlerinde 0. Eşiği geçiyor (deneme: %2,0–7,8).

### Kelime zamanı (referans: zorla hizalama; eşik p95 ≤ 250 ms)

Sabitler denemeden alındı ve uygulama yolunda **değiştirilmedi**; işaretli ortanca hata
düzeltmeden sonra `base`'de başlangıç +3 ms / bitiş −5 ms (n = 8 754 eşleşen kelime), `turbo`'da
+6 / +10 ms (n = 3 963): sabitler AAC yolunda da tutuyor.

| Model | Başlangıç: ortanca / p95 / ±250 ms içinde | Bitiş: ortanca / p95 / ±250 ms içinde |
|---|---|---|
| `base` (bütün zamanlı klipler) | 68 ms / **226 ms** / %96 | 81 ms / **274 ms** / %93 |
| `base`, klip klip p95 | long-a 206, long-b 243, long-c 237, mix-clean 191, pause 233 / 196; **val-clean 278**, val-music-5 262, val-pink-5 348 | 247, 279, 271, 228, 217 / 303; 333, 312, 400 |
| `turbo` (bütün zamanlı klipler) | 77 ms / **242 ms** / %95 | 86 ms / **306 ms** / %92 |

Denemeyle aynı sonuç: **başlangıç** toplamda eşiğin altında (klip bazında doğrulama konuşmasında
üstünde), **bitiş** eşiğin biraz üstünde. Eşik değiştirilmedi. Pratikte etkisi: satıra tıklama
ve yazıdan kesit başlangıç zamanını kullanır (kesit ilk kelimeden 0,15 s önce başlar); altyazı
satırı son kelimeden 0,15 s sonra kalkar. Altyazının tamamı Ayarlar → Altyazı'dan toplu
kaydırılabilir (ADR-016).

### Hız ve bellek

Hız = "Yazıya dök"e basıştan sonuca kadar geçen süre / ses süresi (model başlatma ~2 s ve iki
ses çözme geçişi dahil). Bellek = tarayıcı süreç ağacının özel baytları (400 ms'de bir), taban → tepe.

| Tarayıcı, model | Klip | Hız | Bellek | Makine doluluğu |
|---|---|---|---|---|
| Chromium 153, `base` WASM (1 iş parçacığı) | long-fleurs 10 dk | **0,45** (272 s) | 542 → 1 127 MiB | %46 |
| | long-a 8 dk | 0,54 | 457 → 1 188 MiB | %44 |
| | long-c 18 dk | 0,48 | 461 → 1 203 MiB | %47 |
| | long-b 8 dk (97 aralık) | 0,72 | 498 → 1 097 MiB | %50 |
| Chrome 154, `base` | long-fleurs 10 dk | **0,49** | 762 → 1 334 MiB | %58 |
| Edge 154, `base` | long-fleurs 10 dk | **0,45** | 731 → 1 257 MiB | %47 |
| Firefox 155, `base` | long-fleurs 10 dk | **0,52** | 944 → 1 758 MiB | %58 |
| Chromium 153, `turbo` WebGPU | long-a 8 dk | **0,28** | 1 528 → 4 436 MiB | %43 |
| | val-clean 4 dk | 0,25 | 1 461 → 4 396 MiB | %38 |

- **Deneme "tek iş parçacığı 0,28" demişti; gönderilen bileşim tek iş parçacığında 0,45–0,72.**
  Denemenin 0,28'i aralıkları 30 s'lik pencerelere *paketleyen* yoldandı; gönderilen bileşim her
  aralığı tek başına çözer ve Whisper her çağrıda 30 s'lik bir encoder geçişi yapar. Süre aralık
  sayısıyla büyüyor: aynı 150 s'lik konuşma 7 aralıkken 0,35, 21 aralıkken 0,88 (müzik 0 dB /
  temiz). Denemenin aralık başına WASM ölçümü 12 iş parçacığıylaydı (0,15–0,24); Pages'te iş
  parçacığı yok. **10 dakikalık konuşma bu (dolu) masaüstünde 4,5–5,5 dakika sürdü.** Arayüzdeki
  cümle buna göre yazıldı: "konuşmanın süresinin yarısı kadar sürebilir, yavaş cihazda daha uzun".
- Dinleme geçişi (çözme + örnekleme + VAD) 10 dakikalık videoda 13–24 s; ikinci çözme geçişi yazma
  süresinin içinde.
- `base` belleği 1,0–1,3 GiB (Firefox 1,8 GiB), deneme ile aynı düzeyde (1,1–1,5 GiB). `turbo`
  4,4–4,6 GiB (deneme 3,7 GiB + ekran kartı belleği; burada pencereli tarayıcının süreç ağacı,
  ekran kartı süreci dahil).
- Model indirme (yerel sunucudan): `base` 2,4–5,1 s, `turbo` 10,0 s — ağ süresi değildir.

### Uzun dosya: 60 dakika ve 120 dakika (girdi sınırı)

Uygulama yolu, Pages dışa aktarması (`/capcut`, CSP'li, iş parçacıksız), Chromium 153, `base`;
yoğun okuma konuşması (denemenin uzun klipleri uç uca), AAC MP4. İkisi de ölçüm kilidi altında,
tek seferde, baştan sona bitti:

| | 60 dakika (3599 s) | 120 dakika (7190 s) |
|---|---|---|
| Toplam süre | 37,7 dk (RTF 0,63; makine %71 dolu) | 54,5 dk (RTF 0,45; makine %31 dolu) |
| Dinleme geçişi (çözme + VAD) | 72,5 s | 120,2 s |
| Bellek tepe (tarayıcı süreç ağacı) | 1,12 GiB (1150 MiB) | 1,18 GiB (1207 MiB) |
| Konuşma aralığı / anlaşılamayan | 446 / 46 | 927 / 96 |
| Panel satırı (altyazı satırı) | 1234 (1189) | 2491 (2398) |
| WER (katı) | %7,2 (632/8734) | %6,9 |
| Kelime zamanı p95 başlangıç / bitiş | 238 / 271 ms | 228 / 264 ms |
| CSP ihlali / dış istek | 0 / 0 | 0 / 0 |

- **Bellek dosya uzunluğuyla büyümüyor** (10 dk: 1,0–1,3 GiB; 60 dk: 1,12; 120 dk: 1,18): iki
  geçişli ses akışı ve aralık başına çözme sınırlı kalıyor. Bu yüzden ayrı bir "yazıya dökme
  süresi sınırı" konmadı; geçerli sınır uygulamanın mevcut 120 dakikalık girdi sınırı.
- **120 dakikalık video 3000 satır sınırına sığdı** (2398 altyazı satırı; dakikada 20,0).
- İki ölçümün hız farkı makinenin o andaki yükünden (%71 / %31); ikisi de "konuşmanın süresinin
  yarısı kadar, yavaş cihazda daha uzun" cümlesinin içinde ya da hemen üstünde.
- Anlaşılamayan aralık oranı uzun dosyalarda ~%10 (aynı kliplerin 10 dakikalık ölçümleriyle aynı
  düzeyde): bu aralıklar "(anlaşılamadı)" olarak görünür, metin uydurulmaz; WER'e eksik kelime
  olarak girer.
- **Ölçülmeyen:** 60 ve 120 dakika Chrome, Edge ve Firefox'ta koşulmadı (bu tarayıcılarda en uzun
  ölçüm 10 dakika); `turbo` ile 60/120 dakika koşulmadı; telefonda hiçbir uzunluk ölçülmedi.
- İlk 120 dakika denemesinde test dosyasının görüntü izi 7201,2 s çıktı ve sihirbaz dosyayı
  "120 dakika sınırının üzerinde" diye dürüstçe reddetti; dosya 7190 s'ye kesilip yeniden koşuldu
  (`prepare-media.mjs` artık sınırın 10 s altında kesiyor).

### Satır sınırı: 500 → 3000

Ölçülen satır yoğunluğu (uygulamanın kendi satır kurallarıyla): dakikada 16,8–22,8 satır
(long-fleurs 16,9; long-a 19,9; long-c 21,0; müzik altı 22,4; `turbo` en çok 22,8). 500 satır
22–30 dakikayı karşılıyordu; **3000 satır dakikada 25 satırla 120 dakikayı** (girdi sınırı)
karşılar. Aşılırsa fazlası alınmaz ve kaç satırın alınmadığı söylenir (`caption_limit_exceeded`,
içe aktarma raporuyla aynı yol).

3000 satırın bedeli (`tests/unit/captionLimit.test.ts`; 120 dakikalık video, 3000 iki satırlı
altyazı, 20 kesit; aynı dolu makinede, Node 20):

| İş | Süre / boyut |
|---|---|
| Tarifin doğrulanması (her kayıt ve geri yüklemede) | 30 ms |
| Çıktı görünümü (`outputCues`: 20 kesit × 3000 satır) | 11,7 ms |
| Render planı (60 dk çıktı, 1500 satır düşer) | 19,4 ms |
| Dışa aktarma ön denetimi (1500 satırın yerleşimi; sentetik yazı ölçüsüyle) | 23,5 ms |
| Önizlemede "şu an hangi satır" (her zaman güncellemesinde) | 0,46 ms / çağrı |
| Panelin satır listesi / etkin satır (ikili arama) | 1,1 ms / 0,23 µs |
| Tarifin JSON'u (IndexedDB kaydı, yedek dosyası) | 382 KB |

Hepsi bir karenin (16 ms) çevresinde ya da çok altında; dışa aktarmada kare başına satır araması
zaten ikili aramaydı (ADR-015). Ön denetimin gerçek yazı tipiyle tarayıcıdaki süresi ayrıca
ölçülmedi (yerleşim başına birkaç `measureText`). Panel 3000 satırı sanallaştırmadan çizer;
120 dakikalık ölçümde sihirbazın sonuç ekranındaki panel 2491 satır ve 17 443 DOM düğümüyle
çizildi; baştan sona 60 adımda kaydırılırken kare süresi ortanca 16,8 ms, en uzun 18,1 ms
(başsız Chromium, masaüstü). Telefonda ve editördeki panelde bu uzunlukta ölçülmedi; yavaş
cihazda sorun çıkarsa sanallaştırma eklenir.

### Paket boyutu (önce: `24cb564`; sonra: bu çalışma; statik dışa aktarma, `bundle-sizes.mjs`)

Sayfanın HTML'inin adını verdiği betikler (tarayıcının sayfayı açarken indirdiği), ham / gzip bayt:

| Sayfa | Önce | Sonra | Fark |
|---|---|---|---|
| `/` (açılış ekranı) | 714 494 / 221 296 | 730 165 / 225 397 | +15,7 KB / **+4,1 KB** |
| `/editor/` | 948 570 / 291 781 | 1 008 080 / 310 660 | +59,5 KB / **+18,9 KB** |
| `/yap/kes/` (bütün sihirbazlar aynı paketi paylaşır; `/yap/yazi/` de bu) | 977 034 / 299 959 | 1 040 118 / 320 173 | +63,1 KB / **+20,2 KB** |

- **Tanıyıcı** (Transformers.js + onnxruntime-web'in JS'i): tek parça, **572 237 / 163 590 bayt**;
  hiçbir sayfanın HTML'inde yok, model indirirken de yüklenmez — yalnızca bir yazıya dökme
  başlayınca worker'ın içinden istenir (e2e `transcript-real.spec.ts`: açılış ekranı, sihirbaz
  sayfası ve video seçimi sonrasında bu betik için istek 0; "Yazıya dök"ten sonra ≥ 1).
- **Dürüst olan kısım:** "diğer işler hiçbir şey ödemiyor" değil. Açılış ekranı +4,1 KB gzip
  (tr + en mesaj tablosu ortak; yeni metinler), editör ve diğer sihirbazlar +19–20 KB gzip
  (yazı paneli, model deposu, satır kuralları, SHA-256 — sihirbazlar tek pakettir). Bunları
  ayrı parçaya almak yapılmadı.
- **Service worker'ın arka planda indirdiği çevrimdışı kopya:** 11 sayfa + 41 dosya, 2 061 615 /
  661 300 bayt → 12 sayfa + 45 dosya, **2 734 188 / 856 910** bayt (+672 KB ham, +196 KB gzip);
  farkın 572 / 164 KB'ı tanıyıcıdır — yazıya dökmenin internetsiz çalışması için listededir.
  Sayfa açılışını geciktirmez (kurulum arka plandadır) ama her ziyaretçi bir kez indirir.
- onnxruntime-web'in 26,9 MB'lık `.wasm`'ı ve 118 KB'lık kendi `.mjs` paketi (paketleyici
  `_next/static/media/`'ya kopyalar) çevrimdışı listesinde yok ve statik dışa aktarmadan silinir.
- Yayınlanan dışa aktarma: modelsiz 3 132 102 bayt; iki modelle **678 457 253 bayt**, 140 dosya.

## Telefon (Galaxy S23)

**Ölçülmedi.** Telefon USB ile bağlıydı ve yetkiliydi (`adb devices`: `RFCW20W2WFX device`),
ama Chrome çalışmıyordu: telefonda `chrome_devtools_remote` soketi yoktu (4 Ekim ~21:55, 5 Ekim
~00:00 ve 01:04'te bakıldı; ilk bakışta ekran açıktı). Görgü kuralı gereği tarayıcı telefonda uzaktan başlatılmadı,
hiçbir uygulama açılmadı, hiçbir sekme listelenmedi; `adb forward`/`reverse` eşlemeleri kaldırıldı,
telefonda hiçbir veri oluşturulmadı. Betik hazır ve kendi kendine temizler
(`web/scripts/android/phone-transcript.mjs`: yalnız kendi açtığı sekme, yerel derleme `adb
reverse` ile, sonunda model önbelleği dahil site verisini siler ve eşlemeleri kaldırır):

```
cd web && npm run build && npx next start -p 3321      # modeller public/models'ta
node scripts/android/phone-transcript.mjs --clips=en-01,neg-06,pause-01,long-fleurs
```

`base`/WASM'in telefonda yüklenip yüklenmediği, süresi, belleği ve sekmenin dayanıp dayanmadığı
**bilinmiyor**. Telefon için beklenti yazılmadı: masaüstü işlemcisinde konuşma süresinin
0,45–0,72 katı süren bir iş telefonda daha uzun sürer; ne kadar olduğu ölçülmeden söylenemez.

## Testler

Hepsi 4–5 Ekim 2026'da bu makinede, son kaynakla koşuldu.

- **Birim (vitest): 837 / 837** (55 dosya). Yeni: `transcriptModels` (14: akışlı SHA-256 Node'a
  karşı, sabit liste, çalışma zamanı dosyası `node_modules`'takiyle aynı, parçalar, kabul kuralı,
  worker listesinde model yok, CSP gevşetilmedi), `speechSpans` (23: VAD kuralları, uzun aralığı
  bölme, 16 kHz örnekleme), `transcript` (33: koruma kuralı, zaman düzeltmesi, iz eşlemesi, EDL
  v3 doğrulaması ve v2 geçişi, panel satırları, metin dosyası, yazıdan kesit), `subtitleSegmentation`
  (23: gerçek model çıktısıyla), `captionLimit` (1: 3000 satırın bedeli); `policy` (+1: v7),
  `fixtures` (v3; `legacy-v2/` 4 dosya; 2 yeni geçerli, 4 yeni geçersiz fixture).
- **e2e (Playwright Chromium, `CLIP_TEST_HOOKS=1` derlemesi, port 3321, kilit altında):** 273 test.
  Son derlemeden önceki tam koşu **271 geçti, 2 atlandı, 0 başarısız**. Son derlemeyle iki tam
  koşu: her biri **270 geçti, 2 atlandı, 1 başarısız** — başarısız olan iki koşuda **farklı** ve
  bu çalışmanın dokunmadığı testlerdi: `editor.spec.ts:170` (`page.goto: net::ERR_NO_BUFFER_SPACE`)
  ve `output-limits.spec.ts:224` (gerçek kota testi); ikisi tek başına yinelenince geçti (5/5 ve
  3/3). Makine o sırada başka ajanlarla doluydu; yine de "tam koşu temiz geçti" denemez, olan budur.
  Atlanan 2 test eskiden beri atlanan sessizlik ekran görüntüleridir.
  - Yeni: `transcript.spec.ts` 15 (test ikiziyle: açık indirme ve gerçek ilerleme, kendiliğinden
    indirme yok, sha256 reddi, kaldığı yerden devam, `Range`'siz sunucu, model silme, sihirbaz ve
    dört çıkışı, yerinde düzeltme ve geri alma, ses yok / konuşma yok / yalnız anlaşılamayan,
    durdurma, editörde panel, klavye, yazıdan kesit ve tek geri alma, 20 kesit sınırı, CSP ve ağ),
    `transcript-a11y.spec.ts` 11 (axe 360 / 390 / 1440: **0 bulgu**; 320 ve 640 px'te yana
    kayma yok; yazı aralığı; yalnız klavye, her durakta görünür odak; azaltılmış hareket; ekran
    okuyucu adları).
  - **Gerçek modelle koşan testler: 2 / 2 koştu ve geçti** (`transcript-real.spec.ts`; model
    dosyaları `public/models`'taydı): gerçek cümle yazıya döküldü (WER ≤ %12), satıra tıklama,
    altyazı karede (en parlak piksel > 200), origin dışı istek 0, CSP ihlali 0, tanıyıcı betiği
    yalnız yazıya dökmede, **çevrimdışı** ikinci koşu aynı metin ve 0 model isteği; konuşmasız
    müzikte kelime yok.
- **Pages duman testi (statik dışa aktarma, `/capcut/`, port 3104): 6 / 6.** Yeni iki test model
  dosyalarıyla koştu: yayınlanan 24 dosyanın baytı ve sha256'sı listeyle aynı (675 305 943 bayt),
  `Range` → 206, lisans dosyası; sihirbaz gerçek `base` modeliyle alt yolda (indirme yalnız
  `/capcut/models/…`'tan, 404 yok, origin dışı istek 0, ihlal 0, test kancası yok). Ayrıca:
  dışa aktarmada test ikizinin izi yok, `.wasm` yok.
- **Matris: Chromium 153 28 / 28, Chrome 154 28 / 28, Edge 154 28 / 28** (yeni satır **M22**:
  `origin: transcript` izi, iki satırlı İngilizce satırlar, bir `unclear` aralığı — her planlanan
  karede doğru satır, planlanmayan karede ve `unclear` aralığında altyazı yok; ekran görüntüsü
  `web/screenshots/caption-transcript-frame.png`). Firefox/WebKit matris sütunları yeniden
  koşulmadı (eski sonuçlar duruyor).
- `npx tsc --noEmit -p .` ve `npx eslint .` temiz; `npm audit --omit=dev`: 0 açık.
- **Firefox'ta "Yazıya dök":** çalışıyor (yukarıdaki ölçüm: 25 negatif + 10 dakika). Altyazılı
  **video** indirme Firefox'ta kapalı kalır (AAC kodlayıcı yok; mevcut uygunluk kapısı söyler);
  panel, düzeltme, TXT/SRT/VTT kodlayıcı istemez. Bunlar Firefox'ta ayrıca otomatik testle
  sınanmadı (e2e paketi Chromium'da koşar).
- Ekran görüntüleri: `docs/ux/2026-10-03-home/shots/80-yazi-…` – `87-yazi-…` (360, 390, 1440;
  gerçek modelle).

## Ölçülmeyen / yapılmayan

- **Gerçek GitHub Pages yayını** (yapıt boyutu, 10 dakikalık yayın süresi, `Range` ve
  sıkıştırma davranışı): yukarıda "ilk yayında bakılacaklar".
- **Türkçe.** Açılmadı. `turbo` için Türkçe negatif/koruma doğrulaması, uzun dosya ve kelime
  zamanı bu çalışmada da **ölçülmedi** (koruma eşiği İngilizce veriden seçildi); ölçülüp ADR-017
  eşiklerini geçmeden eklenmez.
- **Dizüstü ve boş makine.** Bütün hızlar dolu bir masaüstündendir.
- **Safari / WebKit / iOS.** Hiç denenmedi (CSP'nin worker'a uygulanıp uygulanmadığı dahil).
- **Vokalli müzik, kendiliğinden konuşma, üst üste konuşma, aksan, gerçek telefon mikrofonu:**
  veri denemeninkiyle aynı (okunmuş kitap ve okunmuş cümle).
- **VAD öncesi seviye eşitleme** (denemenin stres bulgusu: tek dosyada 40 dB düşüşte kısık
  bölümler konuşma sayılmıyor): yapılmadı; `long-fleurs-raw` uygulama yolunda koşulmadı.
- **`turbo`** Chrome/Edge'de ve uzun dosyada; **`base` WebGPU'da** (gönderilmiyor).
- **Yazıya dökerken sekmenin arka plana alınması**, pil ve ısınma.
- **İnsan değerlendirmesi:** altyazı satırlarının okunabilirliği, "(anlaşılamadı)"nın
  anlaşılırlığı — `docs/beta/USER_TEST_KIT.md` görev 4 ve 4b.
- **Ekran okuyucuyla gerçek oturum** (axe, klavye ve adlar otomatik sınandı).
- **Model kartı lisansı:** aşağıda.

## Açık sorular (kurucu)

1. **Lisans notu (hukuk).** `onnx-community/whisper-*_timestamped` depolarının model kartlarında
   lisans beyanı yok; üst modeller Apache-2.0 (`base`) ve MIT (`large-v3-turbo`). Dosyaları üst
   lisanslarla, atıf ve lisans metniyle (`models/LICENSES.txt`) kendi sitemizden yayınlıyoruz.
   Bu bir mühendislik okumasıdır; ayrıntı ve iki seçenek `docs/security/DEPENDENCIES.md` §5.
   Ayrıca depoda tek bir CC BY 4.0 konuşma kaydı var (FLEURS, 160 KB, yalnız testte; atıf
   `web/tests/media/SPEECH_SOURCE.md`).
2. **`'wasm-unsafe-eval'`:** onaylanmıştı, gerekmediği için eklenmedi. Safari desteklenecekse
   ya da başlık gönderebilen bir barındırıcıya geçilirse yeniden gündeme gelir.
3. **`base` varsayılan olarak kabul mü?** Uydurma metin yok, ama doğruluk eşiğin çevresinde
   (temiz konuşmada %4,9–12,4) ve gürültüde zayıf; hız konuşma süresinin yaklaşık yarısı.
   Seçenekler: olduğu gibi (taslak etiketiyle), ya da WebGPU'lu cihazda `turbo`'yu varsayılan
   önermek (596 MB indirme, 4,4 GiB bellek).
4. **`turbo`'nun Pages'te barındırılması** ilk yayında doğrulanmalı; olmazsa yalnız `base`.
5. **Türkçe:** `turbo` ile ölçüm yapılsın mı (negatif küme, uzun dosya, kelime zamanı)?
6. **Kelime zamanı eşiği:** bitiş p95 274–306 ms (eşik 250). Eşik aynen kalsın mı, yoksa
   denemenin önerdiği "başlangıç ≤ 250, bitiş ≤ 400" mi yazılsın?
7. **Uzun video süresi:** 60 ve 120 dakika masaüstü Chromium'da bitti (37,7 ve 54,5 dakika;
   bellek ~1,2 GiB). Ayrı bir sınır konmadı. Telefonda uzun video ölçülmedi: telefon için daha
   kısa bir sınır ya da "bu uzun sürecek" uyarısı istenir mi? (Önce gerçek cihaz ölçümü gerekir.)
