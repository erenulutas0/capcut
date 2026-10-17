# ADR-024 — Yazılım H.264 kodlayıcısına 3 kat bit hızı (R15)

> Tarih: 2026-09-23 · Durum: UYGULANDI ve ÖLÇÜLDÜ (Windows; Chromium, Chrome, Edge).

## Bağlam

Gerçek kayıt koşusunda R15 (Samsung S21, 1920×1080, −90°, 60 fps, 4,4 s,
14,8 MiB, çok ayrıntılı ve hareketli) yalnızca Playwright Chromium'da FAIL
veriyordu: SSIM 0,8252. Chrome ve Edge'de 0,8607 (eşik 0,85; ADR-014 §3).
Donanım kodlayıcısı olmayan Chromium tabanlı tarayıcılar da bu kaliteyi alır:
Linux'ta VA-API'siz Chrome, Brave, sanal makineler, eski GPU'lar.

## Kök neden (ölçüldü)

Uygulamanın çözme → çizme → kodlama yolunu birebir yeniden üreten ayrı bir
deney sayfası kuruldu: aynı mediabunny, aynı an ızgarası ve aynı kırpma. Bu
sayfa uygulamanın skorlarını tekrar etti (Chromium 0,8251, Chrome 0,8607).
Kodlayıcı yapılandırmasının tek tek etkisi:

| Deney (720×1280, 30 fps çıktı) | Chromium | Chrome | Edge |
|---|---|---|---|
| Uygulamanın ayarı (2,49 Mbit/s, VBR, `quality`, 2 s anahtar kare) | 0,8251 · 4,75 Mbit/s | 0,8607 · 3,81 | 0,8607 · 3,81 |
| `hardwareAcceleration: 'prefer-software'` | 0,8252 · 4,73 | **0,8209** · 4,10 | 0,8209 · 4,09 |
| `prefer-hardware` desteği (`isConfigSupported`) | **yok** | var | var |
| 50 Mbit/s (kodlama kaybı neredeyse sıfır) | **0,9683** | 0,9731 | 0,9731 |
| `bitrateMode: 'constant'` (yazılım) | 0,8252 | 0,8208 | — |
| `latencyMode: 'realtime'` (yazılım) | 0,8252 | 0,8210 | — |
| Anahtar kare 5 s (yazılım) | 0,8252 | 0,8209 | — |
| `quantizer` (sabit kalite) | desteklenmiyor | yalnız donanımda | yalnız donanımda |

- **Sebep kodlayıcı.** Chromium'da donanım H.264 kodlayıcısı yok. WebCodecs
  yazılım kodlayıcısına (OpenH264) düşüyor. Chrome ve Edge'e yazılım kodlayıcısı
  zorlanınca aynı düşük sınıfa iniyorlar (0,821).
- **Çözme, döndürme ve 60→30 fps sebep değil.** Aynı yolda 50 Mbit/s ile
  Chromium 0,968 veriyor. Kareler doğru, hizalı ve doğru yönde.
- **Bit hızı modu, gecikme modu ve anahtar kare aralığı etkisiz.**
- Yazılım kodlayıcı bu içerikte 2,49 Mbit/s hedefini tutamıyor. 4,75 Mbit/s
  üretiyor ve yine de daha kötü. Donanım kodlayıcısıyla aynı kalite için
  hedefin ~3 katına ihtiyacı var:

| Yazılım hedefi | Chromium SSIM · gerçek | Chrome `prefer-software` SSIM · gerçek |
|---|---|---|
| 1× (2,49) | 0,8252 · 4,75 | 0,8209 · 4,10 |
| 1,5× (3,73) | 0,8281 · 5,14 | 0,8252 · 4,69 |
| 2× (4,98) | 0,8332 · 5,53 | 0,8463 · 5,59 |
| 2,5× (6,22) | 0,8511 · 6,39 | — |
| **3× (7,46)** | **0,8706 · 7,57** | **0,8882 · 8,31** |
| 4× (9,95) | 0,8972 · 10,01 | 0,9154 · 10,82 |

`contentHint: 'detail'` bit hızını yok sayıyor (10,7 Mbit/s): uygun değil.

## Karar

- Worker, kodlamadan önce `canEncodeVideo(..., hardwareAcceleration:
  'prefer-hardware')` ile planın ayarına bir **donanım** kodlayıcısı olup
  olmadığını soruyor. Tarayıcı hangi kodlayıcıyı seçtiğini söylemez, ama
  donanım kodlayıcısı olup olmadığını söyler. Yoksa `no-preference` yazılım
  kodlayıcıdır.
- Donanım: **hiçbir şey değişmez** (aynı ayar, aynı dosya).
- Yazılım: video bit hızı planın **3 katı** (`src/domain/encoderBitrate.ts`).
  720p30'da 7,46, 1080p30'da 16,80 Mbit/s. 3×, ölçülen en zor gerçek kayıtta
  donanımın kalitesine paylı ulaşan en küçük adım. 2,5× eşiğin 0,001 üstünde
  kalıyordu. Tarayıcı bu bit hızını reddederse plan bit hızına dönülür.
- Depolama tahmini (ADR-023) kodlayıcının gerçek hedefini kullanır.
- SSIM eşiği (0,85) ve eksik kare kapısı değişmedi.

## Sonuç

Gerçek kayıtlar (15 dosya):

| Tarayıcı | Önce | Sonra | Dosya boyutu (çıkan klipler toplamı) |
|---|---|---|---|
| Chromium | 10 PASS, 4 REFUSED, **1 FAIL** | **11 PASS**, 4 REFUSED, 0 FAIL | 24,1 MB → 65,8 MB (**×2,73**) |
| Chrome | 13 PASS, 2 REFUSED | 13 PASS, 2 REFUSED | birebir aynı bayt (×1,00) |
| Edge | 11 PASS, 4 REFUSED | 11 PASS, 4 REFUSED | birebir aynı bayt (×1,00) |

Chromium, dosya başına SSIM (önce → sonra) ve boyut katı: R01 0,9837→0,9871
×2,87 · R02 0,9831→0,9872 ×2,89 · R03 0,9858→0,9866 ×2,82 · R04 0,9770→0,9772
×2,58 · R05 0,9964→0,9967 ×1,05 · R06 0,9138→0,9285 ×2,88 · R07 0,9690→0,9698
×2,92 · R08 0,9863→0,9867 ×2,77 · R10 0,9251→0,9635 ×2,72 · R12 0,9145→0,9635
×2,91 · **R15 0,8252→0,8703 ×1,57**. Chrome ve Edge'de 13/11 dosyanın SSIM'i
ve boyutu değişmedi.

Sentetik matris: üç tarayıcıda 20/20 PASS. Boyut: Chromium ×1,02 (sentetik
desen bitleri harcamıyor), Chrome ve Edge ×1,00 (M12/M14/M15'te ±16 bayt,
koşudan koşuya muxer zaman damgası farkı). Chromium M01–M03 SSIM
0,9416/0,9410/0,9221 → 0,9412/0,9413/0,9219.

Hız: 15 dk 1080p Chromium'da 257,6 s (×3,49 gerçek zaman). ADR-020'nin 3 kat
düşük bit hızlı ×3,47'siyle aynı.

## Bedel ve açık soru (kurucu)

Yazılım kodlayıcılı kullanıcının dosyası gerçek görüntüde ~2,7–2,9 kat büyüyor:
60 dk 1080p ~7,1 GiB (donanımda ~2,4 GiB). Karşılığında bu kullanıcılar
donanımla aynı kalite sınıfına çıkıyor (R10 0,925 → 0,964, R12 0,915 → 0,964).
Seçenekler: 3× (şimdiki), 2,5× (R15 eşikte: 0,851, ~2,3 kat büyüklük) veya 1×
(küçük dosya, R15 eşiğin altında). Ölçüm yalnızca bu makinedeki OpenH264
içindir.

**Kurucu kararı 2026-09-23:** 3× kalır. Kurucu, yazılım kodlayıcılı kullanıcının
dosyasının ~2,7–2,9 kat büyümesini (60 dk 1080p ~7,1 GiB) donanımla aynı kalite
sınıfı karşılığında bilerek kabul etti. Açık soru kapandı.

## Ölçülmeyenler

- Linux/macOS'ta yazılım kodlayıcısı, Brave ve gerçek bir donanımsız makine.
  Chromium'un Windows derlemesi yerine geçti.
- 4 GiB'ı aşan çıktı: 60 dk 1080p yazılım yolunda ~7,1 GiB. mediabunny `mdat`
  için 64 bit boyutu baştan ayırıyor ama böyle bir dosya üretilmedi.
- Donanım kodlayıcısının oturum sınırı dolunca yazılıma düşmesi (tespit
  "donanım" der, dosya yazılımla kodlanır).

Deney betikleri git dışında tutuldu (oturum not defteri); sonuç dosyaları
`web/matrix-results/real-media-*.json`, `matrix-*.json`.

## Ek — 10 Ekim 2026: yeniden işleme, kaynağın kendi bit hızıyla sınırlı

**Bulgu (kalite raporu, 10 Ekim):** 24 saniyelik 1280 × 720'lik 0,47 MB'lık örnekten kesilen 3 saniye
1920 × 1080 ve 1,5 MB olarak kaydedildi. İki ayrı neden vardı:

1. **"Kes" sihirbazı videoyu editörün 1080p varsayılanıyla açıyordu** (`importVideo(file)`, öteki
   sihirbazların kullandığı `ownSizeRecipe` olmadan). Boyut kaynağınkinden farklı olunca hızlı kesim
   (ADR-027) `resolution` ile devre dışı kalıyor, her kare 1080p'ye büyütülüp yeniden kodlanıyordu.
   Düzeltme: sihirbaz artık videonun kendi boyutuyla açar; aynı örnekte kesit `smart` / `copy` ile,
   1280 × 720 olarak çıkar (`tests/e2e/wizards.spec.ts`, Kes).
2. **Plan bit hızı kaynağa bakmıyordu.** Tablo (~0,09 bit/piksel) kamera görüntüsü için doğru; zaten küçük
   bir kaynakta (ekran kaydı, slayt, sıkı sıkıştırılmış klip) o bitlerin gösterecek bir şeyi yok ve bu
   kuralın 3 katı da üstüne biniyordu (1080p: 5,6 → 16,8 Mbit/s).

**Karar (`web/src/domain/encoderBitrate.ts`, `sourceBoundedBitrate`):** olağan (hedefsiz) tam kodlamada
kodlayıcıdan istenen bit hızı planınkidir, ama **kaynağın kendi bit hızının 2 katını aşmaz** (dosya baytı
÷ süre: ses dahil, yani cömert yanda) ve 500 kbit/s'in altına inmez. **Bu ADR'nin 3 katı aynen geçerlidir
ve bu değerin üstüne uygulanır**; kaynak bit hızı bilinmiyorsa (süre 3 saniyede okunamadıysa) plan
değişmez. Kamera kayıtlarında (10–28 Mbit/s) sınır devreye girmez: R15 ölçümü ve yukarıdaki tablolar
aynı kalır. "İyileştir" sınırın dışındadır (aydınlatma ve keskinleştirme, kaynağın bitlerinin taşımadığı
ayrıntıyı ortaya çıkarır). Hedef boyut yolu (ADR-035) zaten kaynağın bit hızını tavan sayıyordu; hızlı
kesim kopyası kaynağın kendi baytlarıdır.

**Neden 2 kat:** tarayıcının gerçek zamanlı H.264 kodlayıcısı, dosyayı üreten kodlayıcıdan (telefonun
HEVC'si, ekran kaydedicinin VP9'u, yavaş ön ayarlı x264) aynı resim için daha çok bit ister ve resim
yolda büyütülmüş olabilir. 2 kat bu payı bırakır. **Bu sayı bir ölçümden değil, bu gerekçeden gelir:**
düşük bit hızlı gerçek kayıtlarda SSIM ile ölçülmedi (aşağıda).

**Ölçülmeyen:** düşük bit hızlı (≤ 2 Mbit/s) gerçek kayıtlarda 2 katın görüntü kalitesine etkisi; matris
(`run-matrix.mjs`) ve gerçek kayıt koşucusu bu değişiklikten sonra yeniden koşulmadı. Kalite katmanının
kamera benzeri kaynakları 16 Mbit/s'tir: orada sınır devreye girmez, o sayılar bu kuralı sınamaz.

## Güncelleme — 14 Ekim 2026 (ADR-045)

"Donanım: hiçbir şey değişmez" kuralı bit hızı için geçerli kalır (planın bit hızı, 3 kat yalnızca
yazılımda). Bit hızı **modu** değişti: olağan indirmede donanım kodlayıcısı artık `constant` ister
([ADR-045](ADR-045-constant-bitrate-ordinary-download.md)); yazılım kodlayıcısı `variable` kaldı. Yukarıdaki
"bit hızı modu etkisiz" bulgusu yazılım kodlayıcısı içindi ve 14 Ekim ölçüsünde de öyle çıktı (kalite iki modda
aynı, boyut farkı koşudan koşuya gürültü içinde).

## Ek — 17 Ekim 2026: hiçbir indirme 4 GiB − 1 bayttan büyük olmaz

**Bulgu (uzun dışa aktarma raporu, [`docs/perf/2026-10-15-long-export.md`](../perf/2026-10-15-long-export.md) §8.1):**
60 dakikalık 1080p tam yeniden kodlama yazılım kodlayıcısında (Playwright Chromium, donanım kodlayıcısı yok)
**4958 MiB** yazdı: bu ADR'nin 3 katı (kaynağın 2 katı tavanıyla 11,43 Mbit/s). Uygulamanın kendi girdi sınırı
4 GiB (doc 15, `maxTotalSourceBytes`); kullanıcı kendi indirdiği dosyayı LiloCut'ta yeniden açamıyordu, FAT32 bir
belleğe de yazamıyordu. **Kurucu kararı (17 Ekim):** bir indirme uygulamanın kendi girdi sınırından büyük olamaz.

**Karar (`web/src/domain/outputStorage.ts`):**

1. **Tavan: `OUTPUT_FILE_LIMIT_BYTES` = 4 GiB − 1 bayt = 4 294 967 295 bayt.** 4 GiB'lık girdi sınırı ile FAT32'nin en
   büyük dosyasının (4 GiB − 1) küçüğü. Politika değişmedi: girdi sınırı aynı, bu onun çıktıdaki karşılığı.
2. **Planlanan bit hızı tavanın altında tutulur** (`fileLimitedVideoBitrate`): olağan tam kodlamanın video bit hızı,
   dosyanın **üst tahmini** (ADR-023: nominal × 1,1 + 32 MiB, bit hızları × süre, ses dahil) tavanı geçmeyecek en büyük
   değerle sınırlanır. Yani planlanan (nominal) dosya ≤ (4 GiB − 1 − 32 MiB) / 1,1 ≈ **3,61 GiB (3,87 GB)**; 60 dakika,
   128 kbit/s sesle videoya **8 480 913 bit/s** kalır. Sıra: plan → kaynağın 2 katı (10 Ekim eki) → yazılımda 3 kat
   (bu ADR; tarayıcı reddederse plan) → **bu tavan, en sonda**. Kısa çıktıya dokunmaz: tutma yalnızca tahmin tavanı
   geçecekken devreye girer (birim testi, 7 bit hızı × 240 uzunluk). 1080p30 donanımda (5,6 Mbit/s) 60 dakikada da
   dokunulmaz; yazılımda (16,8 Mbit/s) ~30,5 dakikadan, kaynağın 2 katıyla 11,43'te ~45 dakikadan sonra.
   720p yazılımda (7,46) bir saat de sığar. İyileştir (ADR-037, kaynak tavanı yok) aynı kurala girer. Hedef boyut
   (Küçült, ≤ 50 MB) zaten çok altında. Sonuç satırı söyler: `videoEncoding.heldForFileLimit`, yöntem satırında
   `data-file-limit-held`.
3. **Pay neden ADR-023'ün 1,1'i:** ayrı bir sayı uydurmak yerine uygulamanın zaten ölçülmüş ve diskte yer ayırırken
   kullandığı üst tahmin tavana oturtuldu; böylece ayrılan yer de ≤ 4 GiB olur. Ölçülen taşma bu payın çok
   altında (aşağıda): tutulan bit hızında yazılan ÷ istenen **0,994–1,004**, dosya ÷ planlanan en çok **1,0036**;
   1,1 ölçülmemiş içerik ve donanım için kalır.
4. **Kopya da tavanı geçmez:** hızlı kesim / kopya (ADR-027) kaynağın kendi baytlarıdır ve boyutu yazmadan önce
   bilinir. Tavanı geçecek bir kopya (ör. aynı yeri tekrar eden kesitler, 4 GiB'a yakın bir kaynağın sesinin 128
   kbit/s'e kodlanması) tam kodlamaya döner, tutulan bit hızıyla (`FastCutFallback('output_size')`; "neden" cümlesi:
   "görüntü olduğu gibi kopyalansaydı dosya 4,29 GB'tan büyük olurdu").
5. **Son bekçi (disk yolları):** yine de bir yazma dosyayı tavanın ötesine taşıyacaksa (kodlayıcı istenenin çok
   üstünü yazarsa: ADR-035'in ölçtüğü "en düşük hızında" OpenH264, ör. çok ayrıntılı 1080p60 kaynak) OPFS ve
   kaydetme penceresi yolu yazmayı orada durdurur (`OutputTooLargeError` → `output_too_large`): yarım dosya silinir,
   "Video 4,29 GB'tan büyük olacaktı; LiloCut bu kadar büyük bir dosyayı yeniden açamaz. Yarım dosya silindi. Daha
   kısa bir kesit indir ya da Ayarlar'da “En çok 720p”yi seç." Bellek yolunda bekçi yok: orada en çok 5 dakika var
   (doc 15 v3), uygulamanın istediği her bit hızında tavanın küçük bir kesri. Bu ölçümlerde bekçi hiç konuşmadı.
6. **Ölçüm kancası** `window.__clipOutputLimitBytes` (her derlemede; tavanı yalnızca **düşürebilir**, uygulama
   kurmaz): kısa bir çıktının uzun bir çıktı gibi tutulması ve durdurulması için (e2e ve aşağıdaki ölçüm).

**Kanıt — 60 dakika, aynı kaynak, aynı makine** (`long-120min-1080p-3600s.mp4`, 817,6 MiB; Playwright Chromium
153.0.8010.12, OpenH264, değişken bit hızı; `measure-long-export.mjs --task=editor --mode=encode`, kaydetme penceresi
yolu):

| | Önce (15 Ekim raporu) | Sonra (bu ek) |
|---|---|---|
| İstenen video bit hızı | 11,43 Mbit/s | **8,481 Mbit/s** (tutuldu) |
| Dosya | **4958 MiB** (4 GiB'ın üstünde) | **3 877 248 423 bayt = 3697,6 MiB** (3,88 GB; tavanın 417,7 MB altında) |
| Dosya ÷ planlanan | ~1,00 | **1,0008** |
| Baştan ayrılan yer (profil tepe − taban) | 5488 MiB | 4096,1 MiB (= tahmin, ≤ tavan) |
| Süre | 923,5 s (×3,90) | 808,6 s (×4,45) |
| Doğruluk | 3600,000 s, 108 000 kare, 5/5, 0,1 ms | 3600,000 s, 108 000 kare, kare kimliği 5/5, ses kayması 0,1 / 0,1 / 0,1 ms |
| Bellek (ağaç tepe) | 794 MiB | 812 MiB |
| Konsol hatası, bekçi | yok | yok; artık dosya 0 (profil 18,6 → 18,6 MiB) |

**Kanıt — taşma, tutulan bit hızında, 5 dakikalık parçalarda** (`scripts/measure-file-limit.mjs`: aynı uygulama,
kanca ile 5 dakika tam 60 dakikanın 8 480 913 bit/s'ine tutuldu; sonuç satırının bildirdiği bit hızı birebir buydu).
"Yazılan ÷ istenen": videonun paket baytları ÷ (istenen × süre); "dosya ÷ planlanan": dosya ÷ ((video + ses) × süre).

| Parça (1080p30, 300 s) | Tutulmadan (5 dk'nın kendi bit hızı) | Tutulunca (60 dk'nın bit hızı) |
|---|---|---|
| DESEN: uzun kaynağın ilk 5 dakikası (test deseni + barkod) | 11,43 Mbit/s · 0,9992 · dosya 433,1 MB | 8,48 · **1,0004** · dosya ÷ plan **1,0007** · 323,1 MB |
| GÜRÜLTÜ: 10,5 Mbit/s gürültülü 1080p (`--only=big`) | 16,80 · 0,9999 · 634,7 MB | 8,48 · **1,0006** · **1,0009** · 323,1 MB |
| GERÇEK: iPhone 11 kaydı (15 Mbit/s, özel, depoda değil), ilk 5 dakika | 16,80 · 0,9937 · 630,8 MB | 8,48 · **1,0033** · **1,0036** · 324,0 MB |

**Kalite — evet, 60 dakikalık yazılım kodlamasında görünür biçimde düşer** (aynı 5 dakikalık parçalar, kayıpsız ffmpeg
referansına karşı; SSIM kare kare, iki akış kare numarasıyla eşlendi — `settb=1/30,setpts=N`, ±1 karelik kaydırma her
dosyada kontrol edildi, en iyisi 0; VMAF libvmaf varsayılan modeli). Karşılaştırma için aynı parçalar Chrome 155'in
**donanım** kodlayıcısında (RTX 3070 Ti, plan 5,6 Mbit/s, sabit mod; 60 dakikada da tutulmaz):

| Parça | Yazılım, tutulmadan (16,80 / 11,43) | Yazılım, 60 dk'nın 8,48'i | Donanım (Chrome), 5,60 |
|---|---|---|---|
| GERÇEK (iPhone 11) — SSIM ort. / en kötü kare · VMAF ort. | 0,9726 / 0,8586 · **93,22** | 0,9481 / 0,8480 · **80,19** | 0,9483 / 0,8264 · 82,23 |
| GÜRÜLTÜ | 0,9377 / 0,7871 · 75,34 | 0,9318 / 0,7858 · 74,10 | 0,9501 / 0,8840 · 76,27 |
| DESEN (11,43 → 8,48) | 0,9795 / 0,9772 · 75,12 | 0,9792 / 0,9767 · 74,93 | — |

- Gerçek kayıtta 60 dakikalık yazılım kodlaması **VMAF −13,0** ve **SSIM −0,025** kaybeder (93,2 → 80,2; 0,973 → 0,948):
  bu bir göz farkıdır. Ama vardığı yer, bu ADR'nin hedeflediği sınıf: aynı parçada **donanım kodlayıcısının** olağan
  indirmesi (5,6 Mbit/s) SSIM 0,948 / VMAF 82,2. Yani tutma, yazılım kodlayıcılı kullanıcıyı 60 dakikada donanımın
  kalite sınıfının biraz altına (VMAF −2,0, SSIM aynı) indiriyor; 3 katın donanımın **üstüne** çıkardığı fazlalık gidiyor.
  ADR-014'ün SSIM eşiği (0,85) her durumda üstte.
- Gürültüde fark küçük (VMAF −1,2), test deseninde yok (−0,2): bu içerikte kodlayıcı zaten istenenden az bit harcıyor.
- Kısa çıktılarda (~30 dakikanın altında, 1080p yazılım) hiçbir şey değişmez.

**Kurucuya:** 60 dakikalık yazılım kodlamasında kalite donanım sınıfına iner (yukarıda). Kararınız "indirme girdi
sınırından büyük olmasın"dı; bedel bu ölçüldü. Alternatifler (uygulanmadı): tavanı FAT32'den vazgeçip yalnızca girdi
sınırına (4 GiB) koymak +1 bayt kazandırır, anlamlı değil; uzun yazılım çıktısını 720p'ye indirmek (7,46 Mbit/s bir saate
sığar) pikseli feda eder.

**Ölçülmeyen:** donanım kodlayıcısında tutma (bugünkü politika içinde 1080p30 donanımda hiç tutulmuyor; sabit mod
istenenin 0,95–1,00'ını yazıyor, ADR-045); tutulan bit hızının altına inemeyen "doymuş" bir kodlayıcı (çok ayrıntılı
1080p yazılımda 0,14 bit/piksel, ADR-035 — 8,48 Mbit/s 1080p30'da 0,136 bit/piksel; bu durumda bekçi durdurur, ölçülmedi
çünkü böyle bir 60 dakikalık kaynak üretilmedi); telefon; Edge / Chrome'un yazılım kodlayıcısı (`prefer-software`);
4 GiB'a yakın gerçek bir kaynağın kopyası (kopyanın tam kodlamaya dönüşü yalnızca küçük tavanlı e2e'de koşuldu, orada
bekçi durdurdu; dönüşün sebep satırı ayrıca doğrulanmadı).
