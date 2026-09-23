# Ölçüm — HDR kaynağı SDR'ye tonlama (ADR-022 kapısı)

> Tarih: 2026-09-23 · Bütçe: 0 TL, tamamen yerel, yeni npm bağımlılığı yok
> Ham çıktılar: `web/hdr-spike-results/` (gitignore'lu). Betikler: `web/scripts/hdr-spike/`,
> `web/scripts/lib/color-metrics.mjs`, `web/scripts/lib/hdr-check.mjs`.
> Sonuç: **Karar** bölümü.

## Kısa sonuç

- **Neden reddediliyordu (tarayıcı başına, ölçüldü):**
  - **Chrome 153:** iki dosyayı da çözebiliyor (HEVC Main 10, yalnızca donanım çözücüsü:
    `prefer-software` desteklenmiyor; kareler GPU'da, `format: null`). Ret tamamen
    **bilinçli politikaydı**: `exportCapability.ts` PQ/HLG gördüğü an
    `hdr_source_unsupported` ile kapıyı kapatıyordu (ADR-011, doc 09).
  - **Edge 153 ve Playwright Chromium 153:** bu makinede **HEVC çözücüsü yok**
    (`VideoDecoder.isConfigSupported` üç ivme tercihinde de `false`,
    `canPlayType('hev1…')` boş; Windows'ta "HEVC Video Extensions" kurulu değil,
    Playwright Chromium HEVC içermiyor). Dosyalar HDR yüzünden değil, **codec
    yüzünden içe aktarmada** reddediliyor. Renk alanı doğru okunuyor
    (`bt2020 / pq`, `bt2020 / hlg`); HDR kapısına hiç gelinmiyor.
- **Tarayıcının kendi dönüşümü (8-bit 2D tuval ve `<video>`):** gerçek bir ton eşleme
  yapıyor (PQ/HLG çözülüyor, bt2020 → bt709, parlaklar yuvarlanıyor; nötr eğri
  hable'a çok yakın). **HLG dosyası eşiklerin hepsini geçti. PQ dosyası geçmedi:**
  karenin **%15.8'inde** kırmızı kanal 255'te kesiliyor (turuncu/kırmızı/sarı/pembe
  kartlar ve sıcak renkli duvar; referansta %0). Tanı: ton eğrisinden sonra
  parlak doygun sıcak renklerin kırmızısı 1.0'ı aşıyor ve 8-bit tuvalde kesiliyor.
- **Düzeltme:** kare float16 tuvale çiziliyor (aynı dönüşüm, taşma korunuyor: PQ'da
  piksellerin %14'ü 1.0'ın üstünde, en çok 1.137) ve taşma, tonu koruyan yumuşak
  bir eğriyle (`softClipToRgba8`) 1.0'ın altına yuvarlanıyor. Eğrinin iki sabiti
  ölçümden değil ilkeden: diz 0.9 (doğrusal), üst sınır 1.660491 (BT.2087
  matrisinin en büyük pozitif satır toplamı: ton eşlenmiş ışığın bt709'da
  ulaşabileceği en büyük değer). **Aynı, önceden sabitlenmiş eşiklerle yeniden
  ölçüldü: PQ geçti (kırpma farkı 0.158 → −0.001), HLG değişmeden geçti.**
- **Özel ton eşleme (kendi shader'ımız) Chrome'da mümkün değil:** HEVC donanım
  karelerinin ham düzlemleri okunamıyor (`copyTo`/`allocationSize`:
  "format is null"), float16 tuvalde `toneMapping: {mode: 'extended'}` yok
  sayılıyor (öznitelik `standard` kalıyor), WebGL2 yarı-float yükleme 203 cd/m²'de
  sert kesiyor (400 ve 1000 cd/m² → 1.0), WebGPU `importExternalTexture` ne ham
  sinyali ne de ton eşlenmiş değeri veriyor (belgesiz bir ara kodlama). Tek
  kullanılabilir yol tarayıcının 2D tuval dönüşümü; üstüne yalnızca taşma
  düzeltmesi eklendi.
- **Çalışma anı kontrolü:** her dışa aktarmadan önce worker, sentetik bir PQ/HLG
  karesini (9 yama: siyah, 20/203/400/1000 cd/m² nötr, bt709 kırmızı/yeşil/mavi,
  600 cd/m² kırmızılı parlak turuncu) aynı yoldan çizip `judgeHdrProbe` ile
  yargılıyor. Chrome, Edge ve Chromium'da PQ ve HLG için **geçti**; aynı kontrol
  8-bit tuvalde (düzeltmesiz) üçünde de `bright_colour_clipped` ile **kaldı** —
  yani kontrol ölçülen kusuru görüyor. float16 tuval ya da float okuma olmayan
  tarayıcıda sonuç `api_missing` ve HDR reddedilir.
- **Dışa aktarılan dosyalar (Chrome, uygulama üzerinden):** R09 PQ **PASS**, R11 HLG
  **PASS** — R11 ancak kalibrasyondaki 7 operatörlük setle; önceden yazılan 5 CPU operatörlü
  setle bir karede ton açısı 9.37° (> 9°) ile **kaldı** (ayrıntı ve bu değişikliğin sonradan
  yapıldığı aşağıda açıkça yazılı; kurucuya açık soru). SDR kayıtlarında gerileme yok.
  Sentetik M10-hdr / M10-hdr-hlg: Chromium, Chrome, Edge'de PASS (süre ve kare sayısı tam,
  dönüş doğru, ses var, siyah kare yok).
- **Önizleme ile tutarlılık:** önizleme `<video>` öğesi, yani tarayıcının aynı
  dönüşümü (düzeltmesiz). Önizleme ekran görüntüsü ile dışa aktarma yolu arasında
  PQ ΔE00 ort. 0.72 (p95 2.10), HLG 0.48 (p95 1.28), SSIM Y 0.995 / 0.998. Fark
  yalnızca önizlemede kesilen parlak sıcak renklerde (PQ'da %16 piksel), ölçüm
  başsız (SDR) ekranda.

## Ölçülen sayılar

### Neden reddediliyordu — tarayıcı yetenekleri (`run-hdr-spike.mjs`, 2026-09-23)

| | Chrome 153.0.8010.53 | Edge 153.0.4234.48 | Chromium 153.0.8010.12 (Playwright) |
|---|---|---|---|
| `VideoDecoder.isConfigSupported` HEVC Main 10 (R09 `hev1.2.4.L30.B0`, R11 `hev1.2.4.L123.B0`) | evet (donanım; `prefer-software` hayır) | hayır | hayır |
| `<video>.canPlayType` / MSE | `probably` / evet | boş / hayır | boş / hayır |
| Çözülen kare biçimi | `null` (GPU), renk alanı bt2020/pq ve bt2020/hlg korunuyor | — | — |
| Eski davranış (21 Eylül koşusu) | kapıda `hdr_source_unsupported` | içe aktarmada ret (codec) | içe aktarmada ret (codec) |
| VP9 profil 2 10-bit HDR (sentetik) | çözülüyor (donanım, `null`) | çözülüyor (donanım, `null`) | çözülüyor (yazılım, `I420P10`) |
| Float16 2D tuval + `rgba-float16` okuma | var | var | var |
| Çalışma anı kontrolü, 8-bit tuval (düzeltmesiz) | PQ ve HLG `bright_colour_clipped` | aynı | aynı |
| Çalışma anı kontrolü, float16 + yumuşak kırpma (uygulama) | PQ ve HLG geçti | geçti | geçti |

### Kare düzeyi (birincil ölçüm, 7 meşru operatör, örnek karelerin en kötüsü)

Chrome 153 (`analyze.mjs --stage=browsers`). Edge ve Chromium bu dosyaları çözemediği için
ölçülemedi.

| Dosya | Yol | En yakın | SSIM Y | ΔE00 | kayma | doygunluk | ton | kırpma Δ | luma | Sonuç |
|---|---|---|---|---|---|---|---|---|---|---|
| PQ | p1 8-bit tuval (eski düz dışa aktarma çizimi) | hable | 0.934 | 4.70 | 0.65 | 1.086–1.088 | 1.3° | **0.158** | 122 | **kaldı** |
| PQ | p2 önizleme (`<video>` ekran görüntüsü) | hable | 0.936 | 4.62 | 0.65 | 1.085–1.087 | 1.3° | **0.159** | 122 | **kaldı** |
| PQ | p6 float16 + yumuşak kırpma (uygulama) | hable | 0.934 | 4.51 | 0.71 | 1.089–1.092 | 1.4° | −0.001 | 121 | geçti |
| HLG | p1 8-bit tuval | libplacebo spline | 0.982 | 5.07 | 1.15 | 1.049–1.097 | 3.9° | 0 | 127 | geçti |
| HLG | p2 önizleme | libplacebo spline | 0.983 | 5.06 | 1.22 | 1.054–1.097 | 3.9° | 0 | 127 | geçti |
| HLG | p6 float16 + yumuşak kırpma (uygulama) | libplacebo spline | 0.982 | 5.06 | 1.15 | 1.049–1.096 | 3.9° | 0 | 127 | geçti |

Kare hizası: tarayıcının çözdüğü 8 karenin 8'i ffprobe'daki beklenen kareyle aynı
(PQ 2/14/29, HLG 119/359/599/839/1078). Önizleme ile dışa aktarma yolu (p2 ↔ p6): PQ
ΔE00 ort. 0.72, p95 2.10, SSIM Y 0.995; HLG 0.48 / 1.28 / 0.998.

Yalnızca CPU operatörleriyle (libplacebo hariç, 5 operatör) aynı kareler: PQ p6 geçti,
HLG p6 geçti (en yakın hable npl 203, ton 3.4°).

Görsel (`2026-09-23-hdr-tonemap-pq.png`, 256 renge indirildi; sayılar ham karelerden):
sol üst ffmpeg hable referansı, sağ üst Chrome 8-bit tuval, sol alt uygulamanın yolu
(float16 + yumuşak kırpma), sağ alt kırmızı = 8-bit tuvalde R=255'te kesilen pikseller.
`2026-09-23-hdr-tonemap-pq-zoom.png`: turuncu ve mavi kart, soldan sağa referans, 8-bit
tuval, uygulama. Kaynak: androidx/media test verisi (Apache-2.0), ColorChecker; kişi yok.

### Dışa aktarılan dosya — gerçek kayıtlar (`run-real-media.mjs`, 9:16 720×1280, iki an)

| Tarayıcı | Dosya | Durum | Süre | Tüm klip SSIM | En yakın | ΔE00 | kayma | doygunluk | ton | kırpma Δ | siyah kare |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Chrome | R09 PQ 4K | **PASS** | 1.045 s (beklenen 1.023, ±1 kare içinde) | 0.9347 | hable | 5.32 | 1.05 | 1.082–1.092 | 1.36° | 0.016 | 0 |
| Chrome | R11 HLG −90° VFR | **PASS** | 8.000 s | 0.9472 | libplacebo spline | 5.28 | 1.10 | 1.02–1.154 | **8.44°** | 0 | 0 |
| Edge, Chromium | R09, R11 | REFUSED (içe aktarma, HEVC çözücüsü yok) | | | | | | | | | |

Ses: R09 kaynak −49.0 / çıktı −50.2 dB, R11 −22.8 / −23.8 dB (±3 dB içinde). Dönüş:
R11 çıktısı dikey 720×1280, referansla SSIM 0.947.

**Açık not — R11'in ilk ölçümü kaldı.** Önceden yazılan dışa aktarma yöntemi yalnızca 5 CPU
operatörünü kullanıyordu ("CI'da Vulkan yok" gerekçesiyle). O setle R11 iki koşuda da aynı
sayıyla **kaldı**: en yakın hable npl 203, 6 karenin birinde ton açısı **9.37° > 9°** (diğerleri
2.0–6.3°; ΔE00 6.65, kayma 0.64, kırpma 0.001 — geri kalan her ölçüt geçti). Kare hizası
kontrol edildi (±1 kare ΔE00'ı 6.5'ten 13'e çıkarıyor, yani hizalı). Farkın yeri: düşük
doygunluklu grimsi-mavi yüzeyler (ızgara, cephe); C* 8'in biraz üstündeki piksellerde ton açısı
çok oynak. Sonra dışa aktarma kontrolüne, eşiklerin kalibre edildiği **tam** operatör seti
(libplacebo BT.2390 ve spline dahil, Vulkan varsa) eklendi; eşikler değişmedi. O setle en
yakın operatör libplacebo spline oldu ve R11 geçti (ton 8.44°). Bu değişiklik R11'in
sonucunu gördükten **sonra** yapıldı; karar kurucuya açık soru olarak yazıldı. Vulkan olmayan
makinede (CI) kontrol hâlâ 5 operatörle (daha sıkı) çalışır ve sonuçta hangi setin
kullanıldığı yazılır (`operatorSet`).

### Dışa aktarılan dosya — sentetik matris satırları (`run-matrix.mjs`)

M10-hdr: 1280×720 VP9 profil 2 PQ, 0.5–3.5 s. M10-hdr-hlg: 1280×720 VP9 profil 2 HLG,
90° döndürme matrisi, 0–3 s. İkisinde de 1000 cd/m² nötr kutu.

| Tarayıcı | Satır | Durum | Süre / kare | Çözünürlük | Tüm klip SSIM | Operatör seti | En yakın | ΔE00 | kayma | doygunluk | ton | kırpma Δ | 440 Hz |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Chromium | M10-hdr | PASS | 3.008 s / 90 | 1280×720 | 0.9673 | 5 CPU | hable | 3.09 | 3.55 | 1.005–1.006 | 1.95° | −0.047 | −24.1 dB |
| Chromium | M10-hdr-hlg | PASS | 3.008 s / 90 | 720×1280 | 0.9333 | 5 CPU | hable | 4.76 | 4.14 | 0.962–0.963 | 1.75° | −0.047 | −24.1 dB |
| Chrome | M10-hdr | PASS | 3.008 s / 90 | 1280×720 | 0.9815 | 7 | hable | 2.27 | 0.77 | 1.008–1.009 | 0.91° | −0.046 | −24.1 dB |
| Chrome | M10-hdr-hlg | PASS | 3.008 s / 90 | 720×1280 | 0.9819 | 7 | libplacebo spline | 3.54 | 2.77 | 1.047–1.048 | 1.73° | 0 | −24.1 dB |
| Edge | M10-hdr | PASS | 3.008 s / 90 | 1280×720 | 0.9815 | 7 | hable | 2.27 | 0.77 | 1.008–1.009 | 0.91° | −0.046 | −24.1 dB |
| Edge | M10-hdr-hlg | PASS | 3.008 s / 90 | 720×1280 | 0.9819 | 7 | libplacebo spline | 3.54 | 2.77 | 1.047–1.048 | 1.73° | 0 | −24.1 dB |
| Firefox 155 | ikisi | PASS (kapıda açık ret: AAC kodlayıcı yok; HDR gerekçesi de listede) | | | | | | | | | | | |
| WebKit | ikisi | NOT_RUN (temel H.264 fixture'ı açılmıyor) | | | | | | | | | | | |

Chromium'da kareler yazılım çözücüsünden (`I420P10`) gelir ve renk kayması eşiğe daha
yakındır (HLG 4.14 / 4.5); Chrome ve Edge aynı dosyayı donanımla çözer (0.77 / 2.77).
Chromium satırları daha önceki koşudan (5 CPU operatörü).

### Önce / sonra — gerçek kayıtlar (15 dosya)

"Önce": 21 Eylül koşusu (main'in `web/matrix-results/real-media-*.json` dosyaları).
"Sonra": bu dal, 22–23 Eylül. SDR dosyalarında durum değişmedi; SSIM farkları ≤ 0.0006.

| # | Chrome önce → sonra | Edge önce → sonra | Chromium önce → sonra |
|---|---|---|---|
| R01 | PASS 0.9898 → PASS 0.9898 | PASS 0.9898 → PASS 0.9898 | PASS 0.9837 → PASS 0.9837 |
| R02 | PASS 0.9896 → PASS 0.9896 | PASS 0.9896 → PASS 0.9896 | PASS 0.9831 → PASS 0.9832 |
| R03 | PASS 0.9934 → PASS 0.9934 | PASS 0.9934 → PASS 0.9934 | PASS 0.9858 → PASS 0.9857 |
| R04 | PASS 0.9806 → PASS 0.9806 | PASS 0.9806 → PASS 0.9806 | PASS 0.977 → PASS 0.977 |
| R05 | PASS 0.9982 → PASS 0.9982 | PASS 0.9982 → PASS 0.9982 | PASS 0.9964 → PASS 0.9965 |
| R06 | PASS 0.9374 → PASS 0.9374 | PASS 0.9374 → PASS 0.9374 | PASS 0.9138 → PASS 0.9139 |
| R07 | PASS 0.9743 → PASS 0.9743 (*) | PASS 0.9743 → PASS 0.9743 | PASS 0.969 → PASS 0.969 |
| R08 | PASS 0.9909 → PASS 0.9909 | PASS 0.9909 → PASS 0.9909 | PASS 0.9863 → PASS 0.9862 |
| R09 PQ | REFUSED (kapı, politika) → **PASS 0.9347** | REFUSED (HEVC) → REFUSED (HEVC) | REFUSED (HEVC) → REFUSED (HEVC) |
| R10 | PASS 0.9446 → PASS 0.9446 | PASS 0.9446 → PASS 0.9446 | PASS 0.9251 → PASS 0.9252 |
| R11 HLG | REFUSED (kapı, politika) → **PASS 0.9472** (**) | REFUSED (HEVC) → REFUSED (HEVC) | REFUSED (HEVC) → REFUSED (HEVC) |
| R12 | PASS 0.9571 → PASS 0.9571 | PASS 0.9571 → PASS 0.9571 | PASS 0.9145 → PASS 0.9139 |
| R13 | PASS 0.9101 → PASS 0.9101 | REFUSED (HEVC) → REFUSED | REFUSED (HEVC) → REFUSED |
| R14 | PASS 0.9879 → PASS 0.9879 | REFUSED (HEVC) → REFUSED | REFUSED (HEVC) → REFUSED |
| R15 | PASS 0.8607 → PASS 0.8607 | PASS 0.8607 → PASS 0.8607 | FAIL 0.8252 → FAIL 0.8252 (bilinen, ADR-014 §3) |
| **Toplam** | 13 PASS, 2 REFUSED → **15 PASS** | 11 / 4 → 11 / 4 | 10 / 4 / 1 FAIL → 10 / 4 / 1 FAIL |

(*) Chrome'un bu daldaki ilk tam koşusunda R07 bir kez **FAIL** verdi: süre 6.741 s
(beklenen 6.593, 148 ms fazla), 202 kare, SSIM 0.894. Uygulamanın kendi süre kontrolü geçtiği
için planın kendisi uzundu, yani anlar farklı girilmişti. Aynı dosya iki kez daha koşuldu
(tekil tekrar ve son tam koşu): ikisinde de 6.613 s, SSIM 0.9743, önceki sonuçla birebir.
R07 bir SDR dosyası; bu değişiklik SDR çizim yoluna dokunmuyor. Sürücüde (an alanlarına
yazma) aralıklı bir yarış olarak kayda geçti; kök nedeni aranmadı.

(**) Son koşu 7 operatörlü setle; 5 operatörlü setle iki koşuda da kaldı (yukarıdaki açık not).

## Karar

- **HDR'yi, HEVC'yi çözebilen tarayıcıda aç (bu makinede Chrome), çalışma anı kontrolü
  geçtiği sürece.** Yol: tarayıcının kendi dönüşümü, float16 tuval, parlak renk yumuşak
  kırpma. PQ ve HLG gerçek kayıtları dışa aktarmada geçti (HLG için yukarıdaki açık notla).
- Önizleme aynı dönüşüm; tek fark önizlemede kesilen parlak sıcak renkler (ölçüldü, küçük).
- Edge ve Chromium'da telefonun HEVC HDR kaydı yine içe aktarmada, **HDR yüzünden değil
  HEVC çözücüsü olmadığı için** reddedilir; 10-bit VP9 HDR orada da çalışır.
- Tam kendi ton eşlememiz (BT.2390 shader) Chrome'da donanım HEVC karesi okunamadığı için
  yapılamadı; bu bir sonraki adım değil, platform sınırı.

## Ne ölçüldü, ne ölçülmedi

| | Durum |
|---|---|
| Ret sebebi, üç tarayıcı | ölçüldü |
| Kare düzeyi renk (7 operatöre karşı) | Chrome'da ölçüldü; Edge/Chromium dosyaları çözemiyor |
| Dışa aktarılan dosya, gerçek kayıtlar | Chrome, Edge, Chromium (Edge/Chromium'da içe aktarma reddi) |
| Dışa aktarılan dosya, sentetik 10-bit HDR | Chromium, Chrome, Edge; Firefox (açık ret), WebKit (çalışmıyor) |
| Önizleme = dışa aktarma | başsız (SDR) ekran görüntüsüyle ölçüldü; **HDR ekranda ölçülmedi** |
| Süre maliyeti | yalnızca spike sayfasında kare başına (960×540); dışa aktarma süresi ölçülmedi |
| Safari, fiziksel telefon, macOS/Linux, AV1 HDR, Dolby Vision RPU uygulaması | **ölçülmedi** |
| Parlak ve doygun içerikli ikinci bir gerçek HLG kaydı | **yok** (tek HLG kaydı) |

## Ortam

Windows 11 Pro 10.0.26200, NVIDIA RTX 3070 Ti, Node 20.18.0, ffmpeg 9.0.1 (gyan.dev full:
zimg, libplacebo/Vulkan), Chrome 153.0.8010.53, Edge 153.0.4234.48, Playwright Chromium
153.0.8010.12, hepsi başsız (headless). Windows "HEVC Video Extensions" kurulu değil.
Makine ortak: gerçek dosyalı tarayıcı koşuları, gerçek kayıt koşuları, matris ve e2e ölçüm
kilidi alınarak yapıldı; ffmpeg kalibrasyonu ve birkaç saniyelik sentetik öz-test koşuları
kilitsiz yapıldı (süre ölçümü içermiyorlar).

## Yöntem

### Dosyalar ve örnek kareler

| Etiket | Dosya | Özellik | Örnek anlar (s) | Ölçüm boyutu |
|---|---|---|---|---|
| pq | `web-android-hevc-hdr10plus-pq-4k.mp4` (R09) | HEVC Main 10, 3840×2160, bt2020 / PQ, HDR10+, MaxCLL 1000, ColorChecker | 0.1, 0.5, 1.0 | 960×540 |
| hlg | `web-iphone12pro-hevc-hlg-dv-rot90.mov` (R11) | HEVC Main 10, 1920×1080 −90°, bt2020 / HLG, Dolby Vision 8.4, VFR | 2, 6, 10, 14, 18 | 540×960 (dikey) |

Kaynak ve lisans: `web/tests/media/real/SOURCES-web.md`. Yeni medya indirilmedi.

Her anda tarayıcının çözdüğü karenin zaman damgası kaydedildi ve ffprobe'un kare listesinde
aynı kareye düştüğü kontrol edildi (`browsers.json` → `frameAlignment`).

### Tarayıcı tarafında ölçülen yollar (`run-hdr-spike.mjs`)

- **p1 — dışa aktarma yolu:** mediabunny `VideoSampleSink` ile çözülen kare, worker içinde
  `VideoSample.draw` ile sRGB 2D `OffscreenCanvas`'a çizilir. Dışa aktarmanın her karede
  yaptığı çağrının aynısı.
- **p2 — önizleme:** aynı an `<video>` öğesinde; Playwright öğenin ekran görüntüsünü alır
  (kullanıcının gördüğü birleştirici çıktısı).
- **p3:** `<video>` öğesinin `drawImage` ile tuvale çizilmesi (bilgi için).
- **Öz-test:** uygulamanın `src/domain/hdr.ts` modülü (TypeScript'ten dönüştürülüp aynen)
  sentetik bir PQ ve bir HLG karesi (`I420P10`) üretir, p1 ile aynı çağrıyla çizer ve
  `judgeHdrProbe` karar verir.

### Referans ve "meşru fark"

Referans: görevin verdiği ffmpeg zinciri
`zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`.

Ton eşleme operatörleri meşru olarak farklıdır (özellikle orta tonların ne kadar parlak
eşlendiği). Tek bir referansla piksel eşitliği aramak doğru bir tarayıcıyı reddeder. Bu
yüzden:

1. Yedi **meşru** operatör: hable (npl 100, birincil), hable npl 203, mobius, reinhard,
   mobius npl 203, libplacebo BT.2390, libplacebo spline (libplacebo Vulkan ile, bu
   makinede RTX 3070 Ti).
2. On **bozuk** dönüşüm, bilerek: ton eşlemesiz (sinyal SDR gibi gösterilir), gamut
   dönüşümsüz (bt2020 değerleri bt709 gibi), 203 cd/m²'de sert kırpma, doğrusal ışık,
   yeşil/mor renk kayması (±40 ve ±16 / 1023 kroma), U/V yer değiştirmiş.
3. Aday, **en yakın meşru operatöre** (örnek karelerin ortalama ΔE00'ı en küçük olan) karşı
   ölçülür. Eşikler, meşru operatörlerin birbirine göre dağılımı (her biri kendisi hariç en
   yakınına karşı: "leave-one-out") ile bozuk dönüşümlerin en yakın meşruya uzaklığı
   arasına kondu.

### Ölçütler (`scripts/lib/color-metrics.mjs`)

Her iki görüntü 8-bit sRGB olarak okunur (bt709 SDR çıktının sıradan ekrandaki hali).

| Ölçüt | Neyi yakalar |
|---|---|
| SSIM (Y) | siyah/bozuk/kaymış kare, yanlış dönüş |
| ortalama ΔE00 (CIEDE2000) | genel renk uzaklığı |
| renk kayması: ortalama (Δa*, Δb*) vektörünün boyu | tüm kareyi aynı yöne iten yeşil/mor kayma |
| doygunluk oranı: ort. C*/√(C*²+L*²) çıktı ÷ referans | yıkanmış (ton eşlemesiz) veya yanlış gamut; aşırı doygunluk |
| ton açısı hatası: C*-ağırlıklı ort. \|Δh\| (C*>8 pikseller) | gamut / matris hatası, U/V takası |
| kırpma farkı: bir kanalı ≥254 piksel oranı çıktı − referans | sert kırpılmış parlaklar |
| ortalama luma ≥ 20 | siyah kare |

### Eşikler — tarayıcı ölçümünden ÖNCE sabitlendi

Kalibrasyon yalnızca ffmpeg ile yapıldı (`analyze.mjs --stage=calibrate`). Tarayıcı
çıktısında hiçbir sayı hesaplanmadan önce `scripts/lib/hdr-check.mjs` içine yazıldı. (Açık
not: ilk deneme çalıştırmasında Chrome'un tek bir p1 karesine göz atıldı; sayı
hesaplanmadı.)

| Ölçüt | Eşik | Meşru en kötü (LOO) | Bozukların en yakını | Gerekçe |
|---|---|---|---|---|
| SSIM Y | ≥ 0.90 | 0.966 | 0.355 / 0.496 (doğrusal) | yapı; kodlanmış çıktıda bunun yerine tüm klip SSIM ≥ 0.85 (aşağıda) |
| ΔE00 ort. | ≤ 8 | 5.53 (BT.2390, PQ) | 10.8 (ton eşlemesiz PQ), ≥ 12.3 (kaymalar) | kaba sınır; tek başına gamut hatasını yakalamaz |
| renk kayması | ≤ 4.5 | 3.60 (BT.2390, PQ) | 5.09 (ton eşlemesiz HLG), 5.14 (U/V takası HLG), ≥ 16.6 (±4 kod kayma) | |
| doygunluk oranı | 0.78 … 1.30 | 0.827 … 1.209 | 0.48 / 0.56 (ton eşlemesiz), 0.697 (gamutsuz HLG), ≥ 1.48 (kaymalar, doğrusal) | |
| ton açısı | ≤ 9° | 8.30° (BT.2390, PQ; diğerleri ≤ 5°) | 9.36 / 12.4 (ton eşlemesiz), 11.6 (gamutsuz HLG), ≥ 14.5 (kaymalar) | |
| kırpma farkı | ≤ 0.045 | 0.033 | 0.061 / 0.065 (sert kırpma) | |
| ort. luma | ≥ 20 | 107 | 33 (doğrusal) | siyah kare koruması |

Sonuç (ffmpeg kalibrasyonu): 7 meşru operatörün 14 dosya-ölçümünün hepsi geçer; 10 bozuk
dönüşümün 20 ölçümünden **19'u** en az bir ölçütte reddedilir. **Tek kör nokta:** PQ
ColorChecker'da *yalnızca* gamut dönüşümü atlanırsa (ΔE00 3.5, doygunluk 0.835, ton 6.7°)
eşiklerin içinde kalır. Aynı hata HLG dosyasında yakalanır (doygunluk 0.697, ton 11.6°) ve
uygulamanın öz-testi saf bt709 ana renkleriyle ayrıca yakalar (birim testi:
`tests/unit/hdr.test.ts`, "rejects a missing bt2020 -> bt709 conversion"). Bir tarayıcı bu
hatayı yalnızca PQ'da yapsa bu ölçüm onu kaçırabilirdi; açık risk olarak yazılıdır.

Tam kalibrasyon tablosu (leave-one-out, her aday kendisi hariç en yakın meşru operatöre karşı,
dosyadaki örnek karelerin en kötüsü):

**pq**

| aday | en yakın | SSIM Y | ΔE00 | ΔE00 p95 | ΔL* | kayma | doygunluk | canlı doygunluk | ton° | kırpma Δ | luma | sonuç |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ref-hable (primary) | mobius-npl203 | 0.986 | 3.246 | 7.548 | -3.765 | 0.203 | 1.004..1.005 | 1.003..1.003 | 0.449 | 0.001 | 130.255 | geçer |
| hable-npl203 (legit) | placebo-spline | 0.974 | 3.894 | 7.986 | 0.429 | 0.276 | 0.958..0.96 | 1.018..1.02 | 1.436 | -0.002 | 107.782 | geçer |
| mobius (legit) | reinhard | 0.991 | 1.724 | 4.518 | 1.991 | 0.135 | 0.998..1 | 0.999..0.999 | 0.39 | 0.003 | 158.092 | geçer |
| reinhard (legit) | mobius | 0.991 | 1.724 | 4.518 | -1.991 | 0.135 | 1..1.002 | 1.001..1.001 | 0.39 | -0.002 | 152.858 | geçer |
| mobius-npl203 (legit) | ref-hable | 0.986 | 3.246 | 7.548 | 3.765 | 0.203 | 0.995..0.996 | 0.997..0.998 | 0.449 | 0 | 139.749 | geçer |
| placebo-bt2390 (legit) | mobius-npl203 | 0.966 | 5.526 | 15.591 | 3.276 | 3.598 | 0.937..0.938 | 0.895..0.896 | 8.302 | 0.033 | 150.876 | geçer |
| placebo-spline (legit) | hable-npl203 | 0.974 | 3.894 | 7.986 | -0.429 | 0.276 | 1.042..1.044 | 0.981..0.983 | 1.436 | 0.003 | 108.532 | geçer |
| broken-no-tonemap (broken) | hable-npl203 | 0.943 | 10.805 | 16.69 | 4.124 | 5.601 | 0.477..0.479 | 0.498..0.499 | 9.355 | 0 | 120.874 | **red**: ΔE00 10.805 > 8; cast 5.601 > 4.5; saturation 0.477 < 0.78; hue 9.355° > 9° |
| broken-no-gamut (broken) | ref-hable | 0.987 | 3.544 | 8.524 | 1.186 | 2.334 | 0.835..0.837 | 0.855..0.856 | 6.726 | 0 | 136.501 | geçer |
| broken-clip (broken) | mobius-npl203 | 0.986 | 2.405 | 7.093 | 3.23 | 0.308 | 0.994..0.995 | 0.995..0.995 | 0.488 | 0.061 | 148.244 | **red**: clipΔ 0.061 > 0.045 |
| broken-linear (broken) | placebo-spline | 0.496 | 26.301 | 52.464 | -30.633 | 3.474 | 1.477..1.486 | 1.33..1.336 | 9.544 | -0.002 | 33.471 | **red**: ssimY 0.496 < 0.9; ΔE00 26.301 > 8; saturation 1.486 > 1.3; hue 9.544° > 9° |
| broken-green-cast (broken) | placebo-bt2390 | 0.932 | 23.638 | 36.074 | -4.512 | 50.138 | 2.263..2.29 | 1.104..1.108 | 38.968 | 0 | 128.37 | **red**: ΔE00 23.638 > 8; cast 50.138 > 4.5; saturation 2.29 > 1.3; hue 38.968° > 9° |
| broken-purple-cast (broken) | hable-npl203 | 0.943 | 25.31 | 37.947 | 4.196 | 49.72 | 2.164..2.193 | 1.102..1.11 | 35.208 | 0.231 | 107.675 | **red**: ΔE00 25.31 > 8; cast 49.72 > 4.5; saturation 2.193 > 1.3; hue 35.208° > 9°; clipΔ 0.231 > 0.045 |
| broken-green-cast-mild (broken) | placebo-bt2390 | 0.967 | 14.305 | 19.783 | -5.872 | 19.284 | 1.728..1.741 | 1.055..1.057 | 14.508 | -0.03 | 132.474 | **red**: ΔE00 14.305 > 8; cast 19.284 > 4.5; saturation 1.741 > 1.3; hue 14.508° > 9° |
| broken-purple-cast-mild (broken) | ref-hable | 0.987 | 15.972 | 29.112 | -2.21 | 21.768 | 1.573..1.588 | 1.035..1.037 | 16.557 | 0.067 | 122.562 | **red**: ΔE00 15.972 > 8; cast 21.768 > 4.5; saturation 1.588 > 1.3; hue 16.557° > 9°; clipΔ 0.067 > 0.045 |
| broken-uv-swap (broken) | ref-hable | 0.986 | 18.042 | 46.522 | 0.887 | 13.341 | 0.946..0.95 | 0.928..0.929 | 86.8 | 0.001 | 129.973 | **red**: ΔE00 18.042 > 8; cast 13.341 > 4.5; hue 86.8° > 9° |

**hlg**

| aday | en yakın | SSIM Y | ΔE00 | ΔE00 p95 | ΔL* | kayma | doygunluk | canlı doygunluk | ton° | kırpma Δ | luma | sonuç |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ref-hable (primary) | mobius-npl203 | 0.975 | 5.316 | 8.052 | -6.493 | 1.04 | 1.016..1.02 | 1.007..1.013 | 3.16 | 0.001 | 141.018 | geçer |
| hable-npl203 (legit) | placebo-spline | 0.977 | 3.294 | 6.359 | -3.492 | 0.803 | 1.113..1.174 | 1.07..1.172 | 4.986 | 0 | 114.656 | geçer |
| mobius (legit) | reinhard | 0.984 | 2.884 | 4.811 | 3.743 | 0.555 | 0.993..0.996 | 0.993..0.996 | 2.576 | 0.001 | 178.698 | geçer |
| reinhard (legit) | mobius | 0.984 | 2.884 | 4.811 | -3.743 | 0.555 | 1.004..1.007 | 1.004..1.006 | 2.576 | 0 | 170.592 | geçer |
| mobius-npl203 (legit) | placebo-bt2390 | 0.972 | 2.033 | 4.328 | -1.859 | 1.49 | 1.141..1.209 | 1.101..1.173 | 4.59 | -0.008 | 154.303 | geçer |
| placebo-bt2390 (legit) | mobius-npl203 | 0.972 | 2.033 | 4.328 | 1.859 | 1.49 | 0.827..0.876 | 0.812..0.894 | 4.59 | 0.017 | 156.776 | geçer |
| placebo-spline (legit) | hable-npl203 | 0.977 | 3.294 | 6.359 | 3.492 | 0.803 | 0.852..0.898 | 0.85..0.921 | 4.986 | 0.002 | 123.451 | geçer |
| broken-no-tonemap (broken) | ref-hable | 0.992 | 4.798 | 9.215 | 0.893 | 5.093 | 0.56..0.619 | 0.49..0.718 | 12.407 | 0 | 142.621 | **red**: cast 5.093 > 4.5; saturation 0.56 < 0.78; hue 12.407° > 9° |
| broken-no-gamut (broken) | ref-hable | 0.997 | 3.172 | 6.673 | 0.275 | 3.523 | 0.697..0.774 | 0.799..0.85 | 11.562 | 0 | 142.095 | **red**: saturation 0.697 < 0.78; hue 11.562° > 9° |
| broken-clip (broken) | mobius-npl203 | 0.943 | 3.111 | 7.694 | 4.5 | 0.544 | 0.994..0.998 | 0.992..0.997 | 2.269 | 0.065 | 160.993 | **red**: clipΔ 0.065 > 0.045 |
| broken-linear (broken) | hable-npl203 | 0.355 | 33.965 | 50.885 | -39.936 | 1.803 | 2.197..3.327 | 1.439..1.951 | 5.208 | 0 | 32.934 | **red**: ssimY 0.355 < 0.9; ΔE00 33.965 > 8; saturation 3.327 > 1.3 |
| broken-green-cast (broken) | ref-hable | 0.97 | 24.596 | 28.913 | -1.428 | 40.964 | 2.639..5.781 | 1.313..1.563 | 79.714 | 0.018 | 131.645 | **red**: ΔE00 24.596 > 8; cast 40.964 > 4.5; saturation 5.781 > 1.3; hue 79.714° > 9° |
| broken-purple-cast (broken) | placebo-spline | 0.91 | 27.375 | 37.63 | 4.962 | 39.145 | 2.005..6.651 | 0.645..1.504 | 132.409 | 0.208 | 127.553 | **red**: ΔE00 27.375 > 8; cast 39.145 > 4.5; saturation 6.651 > 1.3; hue 132.409° > 9°; clipΔ 0.208 > 0.045 |
| broken-green-cast-mild (broken) | ref-hable | 0.992 | 15.352 | 19.886 | -0.747 | 16.839 | 1.843..2.871 | 1.077..1.274 | 58.882 | 0.002 | 137.795 | **red**: ΔE00 15.352 > 8; cast 16.839 > 4.5; saturation 2.871 > 1.3; hue 58.882° > 9° |
| broken-purple-cast-mild (broken) | ref-hable | 0.993 | 15.944 | 23.457 | -2.586 | 16.588 | 0.845..3.068 | 0.682..1.06 | 63.191 | 0.08 | 136.866 | **red**: ΔE00 15.944 > 8; cast 16.588 > 4.5; saturation 3.068 > 1.3; hue 63.191° > 9°; clipΔ 0.08 > 0.045 |
| broken-uv-swap (broken) | ref-hable | 0.983 | 12.29 | 26.186 | -0.179 | 5.142 | 0.995..1.026 | 1.042..1.119 | 132.132 | 0 | 140.165 | **red**: ΔE00 12.29 > 8; cast 5.142 > 4.5; hue 132.132° > 9° |

### Kodlanmış çıktı (dışa aktarma, matris, gerçek kayıtlar)

`assessHdrExport` (`scripts/lib/hdr-check.mjs`): aynı kurgu ffmpeg'le beş CPU operatörüyle
(hable, hable npl 203, mobius, reinhard, mobius npl 203) ayrı ayrı üretilir, çıktıya en
yakın olan seçilir; 6 örnek karede renk eşikleri uygulanır. İki kez kayıplı kodlandığı için
kare başına SSIM eşiği burada uygulanmaz; yapı, en yakın operatörün referansına karşı tüm
klip SSIM ile ölçülür (gerçek kayıtlar ≥ 0.85, sentetik ≥ 0.90, mevcut koşucu eşikleri).
Ayrıca `blackframe` ile tek bir siyah kare bile olmamalı; süre ±1 kare, sentetikte kare sayısı
tam, ses izi ve ton (sentetikte 440 Hz) kontrol edilir; eksik kare politikası
(ADR-014, %2) uygulamanın kendisindedir. İlk yazıldığı haliyle libplacebo burada
kullanılmıyordu (CI'da Vulkan yok). **Sonradan değişti:** Vulkan olan makinede iki libplacebo
operatörü de eklenir, böylece set kalibrasyondakiyle aynı olur (7). Sebep ve etkisi yukarıda,
"R11'in ilk ölçümü kaldı" notunda.
