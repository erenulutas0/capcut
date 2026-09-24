# ADR-028 — Yeniden kodlayan dışa aktarmanın hızı: zaman nereye gidiyor, ne değişti

> Tarih: 2026-09-24 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine: Windows 11, Intel i5-12500,
> RTX 3070 Ti; Chrome 153, Edge 153, Playwright Chromium 153). Politika, sınır ve fiyat
> değişmez. Kopyalayarak kesen hızlı yol ayrı bir çalışmadır; bu belge yalnızca kırpma,
> altyazı, müzik, HDR ve kare değişikliği gibi yeniden kodlama gereken yol içindir.

## Bağlam

Kurucu "indirme hızlandırılabilir mi" diye sordu. Ölçülen: 60 dakikalık 1080p çıktı
Chrome'da 455,9 s (×7,90 gerçek zaman), Playwright Chromium'da 1038,7 s (×3,47), Edge'de
439 s, Chrome 720p'de 240,7 s (×14,96) (ADR-020, ADR-021). Ayrıca ADR-025'te Chrome'un
dışa aktarma tepesi 1265 MiB'a (ADR-021'de en çok 1198) ve sessizlik analizi tepesi
989–1183 MiB'a (ADR-021'de 708–970) çıkmıştı; sebebi bilinmiyordu.

İki kural: çıktı kalitesi ve kare doğruluğu aynı kalacak (eksik kare politikası, SSIM
eşiği 0,85, birebir süre ve kare sayısı), ve tahmin edilen kazanç ölçülmüş gibi
yazılmayacak.

## Yöntem

- **Aşama profili (yeni, kalıcı).** `src/adapters/export/exportProfile.ts`: worker, kare
  döngüsünün her adımının sınırında saat okur ve süreyi adlı aşamaya ekler (kare başına
  kayıt yok; 108 000 karelik çıktıda da yalnızca toplam, sayı ve en uzun adım tutulur).
  Varsayılan kapalı; `window.__clipExportProfile` test kancası worker'ın adına bir ek
  koyar, uygulama bunu hiç yapmaz. Sonuç worker konsoluna tek satır JSON yazılır;
  `scripts/measure-export-memory.mjs --profile` onu satıra ekler.
- Aşamalar: `decodeWait` (sonraki çözülmüş kareyi beklemek: demux + çözme + kare seçimi),
  `draw` (arka plan + kırpma/sığdırma/döndürme çizimi), `hdrRead` / `hdrClip` /
  `hdrWrite` (HDR yolu, ADR-022), `captions`, `frameCapture` (tuvalden `VideoFrame`),
  `encode` (kodlayıcıya verme; kuyruk ve muxer geri basıncı dahil), `progress`,
  `audioDecode` / `audioMix` / `audioEncode`, `setup`, `finalize`, `probe`.
- Bellek ve süre ADR-013/020 yöntemiyle: kalıcı profil (OPFS diskte), süreç ağacının
  private bytes değeri ~400 ms aralıkla.
- Kaynaklar (git dışında, `generate-long-media.mjs --seconds=1200`; ölçümden sonra
  silindi): 20 dk 1080p30 1,8 Mbit/s (`long-120min-1080p-1200s`), aynısının 90°
  döndürme bilgili hâli (yeni `--only=rot90`: kodlu 1920×1080, gösterim dikey), 20 dk
  720p, 20 dk 1080p 10,5 Mbit/s gürültülü (`big`, 1,48 GiB), 2 dk 1080p HDR PQ
  (VP9 profil 2, M10-hdr tarifi), 60 dk 1080p (20 dk kaynağın üç kez akış kopyasıyla
  birleştirilip 3599,9 s'de kesilmiş hâli; 108 000 çıktı karesi). Kısa denemeler için
  `l01-dense-1080p.mp4`.
- Çıktı karşılaştırması: `ffmpeg -f framemd5` ile çözülmüş video ve ses karelerinin
  özetleri önce/sonra birebir karşılaştırıldı.

## 1. Zaman nereye gidiyor (önce; 20 dk çıktı, tek koşu)

Kare başına ortalama süre ve duvar saatindeki payı. "Kırpma" = yatay kaynak → 9:16.

| Tarayıcı · durum | Süre (katsayı) | decodeWait | draw | frameCapture | encode | ses (çöz+miks+kodla) |
|---|---|---|---|---|---|---|
| Chrome · 1080p yatay | 172,1 s (×6,97) | 0,16 ms (3%) | 0,34 ms (7%) | 0,08 ms (2%) | **3,87 ms (81%)** | 0,31 ms (7%) |
| Chrome · 1080p kırpma 9:16 | 180,2 s (×6,66) | 0,11 ms (2%) | 0,33 ms (7%) | 0,07 ms (2%) | **4,17 ms (83%)** | 0,29 ms (6%) |
| Chrome · 1080p dikey (90° döndürmeli) | 174,1 s (×6,89) | 0,10 ms (2%) | 0,28 ms (6%) | 0,07 ms (1%) | **4,10 ms (85%)** | 0,26 ms (5%) |
| Chrome · 1080p kaynak → 720p | 101,7 s (×11,8) | 0,09 ms (3%) | 0,25 ms (9%) | 0,05 ms (2%) | **2,10 ms (74%)** | 0,31 ms (11%) |
| Chrome · 720p kaynak → 720p | 146,9 s (×8,17) | 0,11 ms (3%) | 0,36 ms (9%) | 0,08 ms (2%) | **3,24 ms (80%)** | 0,27 ms (8%) |
| Chromium · 1080p yatay | 321,9 s (×3,73) | 0,51 ms (6%) | **7,99 ms (89%)** | 0,08 ms (1%) | 0,07 ms (1%) | 0,26 ms (3%) |
| Chromium · 1080p kırpma 9:16 | 540,4 s (×2,22) | 0,52 ms (4%) | **14,03 ms (93%)** | 0,07 ms | 0,09 ms (1%) | 0,29 ms (2%) |
| Chromium · 1080p dikey (90°) | 676,0 s (×1,78) | 0,48 ms (3%) | **17,90 ms (95%)** | 0,07 ms | 0,07 ms | 0,24 ms (1%) |
| Chromium · 1080p kaynak → 720p | 329,4 s (×3,64) | 0,35 ms (4%) | **8,41 ms (92%)** | 0,06 ms | 0,06 ms | 0,24 ms (3%) |
| Chromium · 720p → 720p | 169,4 s (×7,08) | 0,32 ms (7%) | **4,01 ms (85%)** | 0,06 ms | 0,06 ms | 0,23 ms (5%) |
| Chrome · 2 dk 1080p **HDR PQ** | 177,8 s (×0,67) | 0,12 ms | 0,27 ms | 0,08 ms | 2,75 ms (6%) | 0,24 ms |

HDR satırında float16 okuma + yumuşak kırpma + 8-bit yazma kare başına **45,8 ms (%93)**.
Kurulum, kapanış ve doğrulama (`setup` + `finalize` + `probe`) her koşuda < 0,4 s.
İlerleme mesajları (5 karede bir) kare başına 0,01 ms. OPFS yazımı muxer'ın içinde, 4 MiB
parçalarla (ADR-013); `encode` aşamasının içinde ayrı görünmüyor ve 3 kat bit hızlı
Chromium çıktısında bile `encode` 0,07 ms, yani yazma darboğaz değil.

Not: aynı makinede aynı durum saatler arasında %10–20 oynadı (ör. Chrome 1080p yatay bu
tabloda 172 s, aşağıdaki önce/sonra koşularında 153–155 s; 720p kaynak 147 → 75 s).
Paylar koşudan koşuya tutarlı, mutlak süreler değil.

### Darboğazı ayırma denemeleri (60 s 1080p, yoğun L01 kaynağı, tek koşu)

| Deneme | Chrome kare/sn | Chromium kare/sn | Anlamı |
|---|---|---|---|
| Normal | 195–200 | 67–90 | |
| Kodlayıcıya hiç vermeden (yalnız çöz + çiz) | 439 | 127 | Chrome'da boru hattının geri kalanı kodlayıcıdan 2,2 kat hızlı |
| Çizmeden (yalnız kodla) | 217 | 136 | Chrome'da tavan donanım kodlayıcısı |
| Aynı anda 2 / 3 ayrı dışa aktarma (toplam) | 212 / 293 | 123 / 140 | Tek kodlayıcı akışı ~210 kare/sn'de doyuyor |

**Sonuç:** Chrome ve Edge'de süre neredeyse tamamen donanım H.264 kodlayıcısının tek
akıştaki hızı (1080p'de ~4 ms/kare, 720p'de ~2 ms/kare). Çözme, çizim ve kare kopyası
toplam %10–13. Playwright'ın Chromium'unda (varsayılan "headless shell": GPU yok, yazılım
2D tuval, OpenH264) süre **tuvale çizmek**: YUV → RGB dönüşümü ve ölçekleme CPU'da;
döndürme ve kırpmada 14–18 ms/kare. Kodlayıcı orada darboğaz değil.

Yan bulgu: Playwright'ın "chromium" kanalı (tam Chromium, yeni headless) aynı makinede
GPU ve donanım kodlayıcısı kullanıyor: 60 s 1080p'de 179 kare/sn, 5,68 Mbit/s (Chrome ile
aynı sınıf). ADR-020'deki "Chromium 1038,7 s, yazılım kodlayıcı" sayısı test tarayıcısı
kabuğunun sayısıdır; GPU'lu bir Chromium kullanıcısını temsil etmez. GPU'suz makine
(sanal makine, eski/bozuk sürücü) bu yavaş sınıftadır.

## 2. Değişenler

### a) HDR: yumuşak kırpma tablo tabanlı ve yardımcı iş parçacığında (en büyük kazanç)

- `softClipHalfToRgba8` (`src/domain/hdr.ts`): float16 okumanın ham 16 bitlik
  değerlerinden çalışır. Diz altındaki kanal için sonuç ve "diz üstü mü" cevabı 65 536
  girdili tablolardan gelir; diz üstündeki nadir pikseller aynı aritmetikten geçer,
  sRGB kodlaması `pow` yerine eşik tablosuyla (eşikler aynı fonksiyonla ikiye bölerek
  bulunur). **Sonuç float döngüsüyle bayt bayt aynı:** birim testi her 65 536 half
  değerini her kanalda iki komşu değerle, 200 000 rastgele pikseli (negatif, NaN, sonsuz
  dahil) ve sRGB kodlamanın 255 basamağının her iki yanında 2000'er ardışık double'ı
  karşılaştırır (`tests/unit/hdrHalfClip.test.ts`).
- 8 MB'lık 8-bit resim her karede yeniden ayrılmıyor.
- Kırpma, dışa aktarma worker'ının **ikinci bir örneğinde** (`clip-hdr` adıyla)
  çalışıyor (`hdrClip.ts`). Worker N. karenin kırpmasını yardımcıya verip N+1'i çizer ve
  okur; kareler kodlayıcıya kesin sırayla gider (en çok 2 kare yolda). Ayrı bir worker
  dosyası denendi, uygulamanın paketleyicisi worker içinden açılan worker'ı paketlemedi
  (dosya ham kopyalandı), bu yüzden aynı betik yeniden açılıyor. Yardımcı önce bilinen
  bir pikselle sınanır; açılmazsa, yanlış ya da hiç cevap vermezse kırpma eskisi gibi
  worker'ın kendisinde yapılır (daha yavaş, sonuç aynı). Yardımcının bir kareyi
  kırpamaması dışa aktarmayı `internal_error` ile durdurur, tahmin yok. Çalışma anı
  kontrolü (hdrProbe) aynı fonksiyonu çağırır.

| 2 dk 1080p HDR PQ, Chrome | Süre (katsayı) | HDR adımları kare başına |
|---|---|---|
| Önce | 177,8 / 155,6 / 158,5 s (×0,67–0,77) | 45,8 ms |
| Tablo, aynı iş parçacığında | 116,1 s (×1,03) | okuma 12,0 + kırpma 16,6 + yazma 0,9 ms |
| **Tablo + yardımcı (şimdiki)** | **68,8 / 62,1 s (×1,75–1,93)** | okuma 11,6 ms; kırpmayı bekleme 5,5 ms |

Önce/sonra dosyaları çözülünce **3600 video karesinin ve bütün ses karelerinin özeti
birebir aynı** (framemd5). Kalan süre çoğunlukla tarayıcının float16 okumasının kendisi
(~12 ms/kare; Chrome'da bir float16 1080p `getImageData` tek başına 38 ms'ye kadar
ölçüldü).

### b) Parçanın sesi, kareleriyle birlikte yazılıyor

Eskiden bir parçanın sesi, o parçanın **bütün kareleri** kodlandıktan sonra yazılıyordu;
tek parçalı 60 dakikada ses işi (~%5–7) sona ekleniyordu ve bu sürede video kodlayıcısı
boştu. Artık ses, kareler kodlanırken, worker'ın kodlayıcıyı beklediği aralarda
işleniyor. `MediaPacer` (`exportPacing.ts`, birim testli) sesi karelerin en çok
**1 saniye** önünde tutar; parça bitmeden ses de bitirilir, sonraki parçaya ancak o
zaman geçilir, iki taraftan birinin hatası ya da iptal diğerini durdurur ve ses işi
beklenmeden çıktı kapatılmaz. Sesin kendisi (çözme, miks, AAC) değişmedi; dosyada ses ve
video parçaları artık iç içe (önce: ses videonun arkasında toplu). ffprobe süreleri ve
kare sayıları aynı; 20 dk 720p Chrome çıktısı önce/sonra çözülünce 36 000 video karesi ve
bütün ses kareleri birebir aynı (framemd5), dosya boyutu aynı (402 978 948 bayt).

### c) Sessizlik analizi: tam aralık okuma, 4 parça aynı anda

Bellek bölümünde (4) anlatılan sebep yüzünden sessizlik worker'ı dosyayı artık
`BlobSource(file, { useStreamReader: false })` ile, yalnızca istenen aralıkları okuyarak
açıyor. Tek başına bu, 10,5 Mbit/s kaynakta analizi yavaşlattı (4,1–5,0 s → 13,2 s), çünkü
her okuma diski beklerken sırayla gidiyordu. Bu yüzden 60 saniyeden uzun bir aralık, kendi
10 ms ızgarasında en çok 4 parçaya bölünüp aynı anda çözülüyor ve zarflar uç uca
ekleniyor (`splitMeterRange`, `src/domain/loudness.ts`). Birim testi, parçaların birleşik
zarfının bütün aralığın zarfıyla aynı olduğunu gösteriyor; tarayıcıda da **zarflar bit bit
aynı** çıktı (2 kaynak × Chrome/Chromium × 2 koşu, 120 000'er değer, en büyük fark 0 dB).

### d) Ölçüm araçları

`measure-export-memory.mjs` (main'in kesit akışıyla): `--profile`, `--aspect=9-16`
(Ayarlar'dan çerçeve seçer; yatay kaynakta kırpma durumu), `--mode=encode` (hızlı kesimi
kapatır), `--browser-args`, `--keep-output=<yol>`; satıra yöntem (`copy`/`smart`/`encode`)
yazılıyor ve süre, video meta verisi gelince okunuyor.
`generate-long-media.mjs --only=rot90`.

## 3. Önce / sonra (20 dk çıktı, önce ve sonra sırayla aynı saatte koşuldu)

"Önce" = HEAD mantığı + aşama saati (`CanvasSource` yerine aynı işi yapan
`VideoSampleSource` + `new VideoSample(canvas)`); "sonra" = bu değişiklik. Önce ve sonra
aynı oturumda art arda koşuldu. Bellek: kodlama boyunca süreç ağacının tepesi, MiB.

| Tarayıcı · durum (20 dk çıktı) | Önce | Sonra | Tepe bellek önce → sonra |
|---|---|---|---|
| Chrome · 1080p yatay | 154,6 / 152,8 s (×7,76 / ×7,85) | 142,4 / 171,0 s (×8,43 / ×7,02) | 728 / 740 → 772 / 729 |
| Chrome · 1080p kaynak → 720p | 78,4 / 84,0 s (×15,31 / ×14,29) | 73,7 / 71,3 s (×16,27 / ×16,83) | 720 / 708 → 691 / 710 |
| Edge · 1080p yatay | 127,7 / 133,2 s (×9,39 / ×9,01) | 120,5 / 122,6 s (×9,96 / ×9,79) | 718 / 734 → 757 / 734 |
| Chrome · 1080p kırpma 9:16 | 165,3 s (×7,26) | 152,9 s (×7,85) | 758 → 776 |
| Chrome · 1080p dikey (90°) | 147,3 s (×8,15) | 144,6 s (×8,30) | 751 → 786 |
| Chrome · 720p → 720p | 75,4 s (×15,92) | 72,5 s (×16,56) | 681 → 682 |
| Chrome · 1080p, **10,5 Mbit/s** kaynak | 152,5 s (×7,87) | 146,2 s (×8,21) | **927 → 799** |
| Chromium (headless kabuk) · 1080p | 249,4 s (×4,81) | 255,7 s (×4,69) | 725 → 714 |
| Chromium (headless kabuk) · 720p | 285,5 s (×4,20) | 285,5 s (×4,20) | 552 → 551 |
| **Chrome · 60 dk 1080p** (1,8 Mbit/s kaynak) | 468,4 s (×7,69) | **441,2 s (×8,16)** | 873 → 874 |
| **Chrome · 2 dk 1080p HDR PQ** | 155,6 s (×0,77) | **62,1 s (×1,93)** | 818 → 742 |

- **SDR'de kazanç küçük**: Chrome ve Edge'de çoğu durumda %2–12 (ses işinin artık
  kodlayıcı beklerken yapılması); 60 dakikada 468 → 441 s (%6). Chrome 1080p yatayın
  ikinci "sonra" koşusu (171 s) makinenin o anki yüküyle yavaşladı (çizim ve çözme
  adımları da iki katına çıktı); iki koşunun ortalamasında fark yok. Donanım kodlayıcı
  tavanı (1080p'de ~210–245 kare/sn) değişmedi; ondan hızlı olmak mümkün değil.
- **Chromium headless kabuğunda değişiklik yok**: orada iş parçacığını çizim dolduruyor,
  sesin girebileceği bekleme yok.
- **HDR 2,5 kat hızlı.**
- 60 dakikalık koşuların ikisinde de ffprobe: 3600,000 sn, **108 000 kare**; OPFS yolu;
  pencere kapanınca geçici dosya 0. Çıktı 2443,4 MiB, 5,56 Mbit/s (ADR-021'deki 2443 MiB ile
  aynı).
- **Çıktılar aynı**: 20 dk 720p (36 000 kare) ve 2 dk HDR (3600 kare) önce/sonra dosyaları
  çözülünce video ve ses karelerinin özetleri birebir aynı.

### Matris ve gerçek kayıtlar (son kodla, `next start -p 3100`)

| | Önce (23 Eylül, `6a91285`) | Sonra |
|---|---|---|
| Matris Chromium / Chrome / Edge | 21 / 21 / 21 PASS | **21 / 21 / 21 PASS** |
| Matris SSIM, süre, kare sayısı | — | 63 satırın hepsinde **birebir aynı** |
| Gerçek kayıt Chromium | 11 PASS, 4 REFUSED | **11 PASS, 4 REFUSED** |
| Gerçek kayıt Chrome | 15 PASS | **15 PASS** |
| Gerçek kayıt Edge | 11 PASS, 4 REFUSED | **11 PASS, 4 REFUSED** |
| Gerçek kayıt SSIM, en kötü fark | — | −0,0002 (Chromium), −0,0001 (Chrome), 0 (Edge); süreler ve kareler aynı |

### Birleşimden sonra (main `f761911`: kesit listesi ADR-026, hızlı kesim ADR-027)

Değişiklikler main'in yeni yapısına taşındı: `produceOutput`'un **tam kodlama** dalında
ses kareleriyle birlikte (`SegmentAudioWriter.advanceTo` ile, aynı 4096'lık parçalar),
HDR kırpma yardımcıda, `VideoSampleSource` + aşama saati. **Hızlı kesim** kendi ses
iç içeliğini kullanmaya devam ediyor (kopyalanan videonun ardından `advanceTo`); ona
dokunulmadı. Görüntüsü değişmeyen H.264 kaynak artık hızlı kesimle kopyalandığı için
tam kodlamanın ölçümü `--mode=encode` (test kancası `window.__clipExportMode`) ile
yapıldı. "Önce" = main `f761911`, "sonra" = birleşim; art arda, aynı oturumda, Chrome.
Makine bu oturumda öncekinden yavaştı (aynı durumun "önce"si 155 → 202 s); oranlar
karşılaştırılabilir, mutlak süreler değil.

| Durum | Önce (main) | Sonra (birleşim) | Tepe bellek |
|---|---|---|---|
| 20 dk 1080p, tam kodlama | 183,7 / 175,7 s | 176,6 / 170,3 s (%3–4) | 761 / 789 → 792 / 790 |
| 2 dk 1080p HDR PQ | 202,0 s (×0,59) | **97,7 s (×1,23)**, yardımcı iş parçacığında | 756 → 734 |
| 10 dk kesit, hızlı kesim (`smart`, 50 kare kodlandı) | 16,1 (ilk, soğuk önbellek) / 11,5 / 8,9 s | 8,9 / 10,4 / 8,5 s | 738–771 → 764–786 |

- Çıktılar main'inkiyle **birebir aynı** (framemd5): 20 dk 1080p 36 000 kare, HDR 3600
  kare, video ve ses.
- Hızlı kesim ikisinde de aynı dosyayı verdi: 18 000 kare, 600,000 s, 120 denetlenen
  kareden 70'i kaynakla bit bit aynı (geri kalanı kesim yerlerindeki 50 kodlanan kare,
  SSIM ≥ 0,9988), ses 0,06 ms içinde; yavaşlama yok.
- Matris üç tarayıcıda **22/22 PASS** (hızlı kesim ajanının 24 Eylül 21:45–21:51 koşusuyla
  aynı), her satırda SSIM, süre, kare sayısı ve yöntem (`copy`/`smart`/`encode`) aynı.
  Gerçek kayıt Chrome 15/15 (en kötü SSIM farkı −0,0001), Chromium 11 PASS 4 REFUSED,
  Edge 11 PASS 4 REFUSED.
- Tam e2e: main 136 geçti, 1 kaldı, 2 atlandı; birleşim de 136 / 1 / 2 (ikinci koşu;
  ilk koşuda 135 / 2 / 2). Kalan `kesit.spec.ts:63` main'de de kalıyor: test
  "Kodlandı" bekliyor, hızlı kesimden beri "Kodlandı (çözünürlük kaynağınkinden farklı)"
  yazıyor. İlk koşudaki ikinci hata `a11y.spec.ts:483` main'de de oynak (main: 1 geçti,
  sonra 3/3 kaldı; birleşim: 1/3 geçti).

## 4. Bellek artışının sebebi

### Sessizlik analizi (ADR-025: 989–1183 MiB)

**Sebep bizde: kaynağın okunma şekli.** mediabunny'nin `BlobSource`'u varsayılan olarak
dosyayı `blob.slice(konum).stream()` okuyucularıyla, konumdan **dosya sonuna kadar**
okur. Okuma, açık bir okuyucunun konumundan 128 KiB'tan uzağa düşerse yeni bir okuyucu açar
(en çok 4, en eskisi iptal edilir). Sessizlik analizi yalnızca sesi okur. Ses, dosyada
video parçalarının arasında durur. 1,8 Mbit/s'lik kaynakta aradaki video ~110 KiB
(eşiğin altında): tek okuyucu dosyayı baştan sona akıtır. 10,5 Mbit/s'lik kaynakta
aradaki video ~650 KiB: **her ses parçasında yeni bir önden okuma akışı** açılıp
kapanıyor. ADR-025'in kaynağı ~6 kat bit hızlıydı; ADR-025 "okunan byte miktarı" diye
tahmin etmişti, sebep bu akışların açılıp kapanmasıydı.

Ölçüm (20 dk kaynak, analiz tek başına, kalıcı profil; iki koşu):

| Kaynak · tarayıcı | Önce: süre, başlangıç → tepe → kapattıktan sonra | Sonra |
|---|---|---|
| 10,5 Mbit/s · Chrome | 4,5 / 4,5 s; 413 → **952 / 983** → 931 / 958 | 9,1 / 9,0 s; 415 → **723 / 724** → 748 / 728 |
| 10,5 Mbit/s · Chromium | 4,0 / 4,0 s; 197 → **857 / 852** → 861 / 856 | 9,6 / 9,6 s; 197 → **585 / 578** → 588 / 566 |
| 1,8 Mbit/s · Chrome | 3,4 / 3,5 s; 405 → 612 / 607 → 567 / 502 | 3,5 / 3,5 s; 401 → 641 / 636 → 624 / 621 |
| 1,8 Mbit/s · Chromium | 3,4 / 3,5 s; 181 → 427 / 460 → 367 / 462 | 3,4 / 3,5 s; 182 → 464 / 478 → 466 / 477 |

Ara denemeler (Chrome, 10,5 Mbit/s): yalnız tam aralık okuma: tepe 558 / 550, ama 13,2 s.
Ağ profilli önden okumayla (`CustomSource`, 16 MiB önbellek) okuma: tepe 791 / 849, 5,8–7,7 s
(yetmedi).

**Bedel:** yüksek bit hızlı kaynakta analiz ~2 kat uzun (20 dakikada 4,5 → 9 s; ADR-025'in
53 dakikalık 4 GiB dosyasında 13 s yerine tahminen ~25 s, **ölçülmedi**). Düşük bit
hızlı kaynakta süre aynı, tepe +20…+30 MiB (4 çözücü aynı anda).

### Dışa aktarma (ADR-025: 1265 MiB, ADR-021: ≤ 1198)

- ADR-025'teki Chrome koşusunda artış dışa aktarmanın kendisinden değil **başlangıçtan**
  geliyordu: kodlama öncesi 996 MiB (ADR-021'de 927), kodlama sırasında artış +269
  (ADR-021'de +246). O koşuda dışa aktarmadan hemen önce yüksek bit hızlı dosyada
  sessizlik analizi yapılmıştı; yukarıdaki ölçümde bu analiz, pencere kapandıktan sonra
  +500 MiB'a yakın tutuyordu. Yani 1265'in fazlası büyük ölçüde sessizlik analizinin
  bıraktığı bellek. ADR-025'in tam akışı (analiz → 3300 önizleme araması → dışa aktarma)
  bu değişiklikle **yeniden ölçülmedi**.
- Dışa aktarmanın kendisinde aynı mekanizmanın ikinci yeri vardı: eski kodda bir parçanın
  sesi, videosu bittikten sonra **tek başına** okunuyordu. 10,5 Mbit/s kaynakta 20 dk:
  kodlama boyunca 704–750 MiB, son onda birde **927**. ADR-021'de "kesimde basamak"
  diye görülen artış da buydu (ilk parçanın ses geçişi). Ses artık karelerle birlikte
  okunuyor ve bu sıçrama yok: aynı dosyada tepe **799** (−128 MiB).
- **Düz değil, tam çözülmedi:** 60 dakikada tepe aynı (873 → 874), ama biçim değişti.
  Önce: kodlama boyunca 727–760, sonda 873 sıçrama. Sonra: 781'den 874'e yavaş tırmanış
  (onda birler: 796, 781, 785, 798, 806, 819, 852, 868, 863, 874). İki sürümde de artış
  ses süresiyle ölçekleniyor (20 dakikada ~+40–50, 60 dakikada ~+120 MiB); ses işinin
  artışı eskiden sona toplanıyordu, şimdi yayılıyor. Dışa aktarmadaki sesi ayrı, tam
  aralık okuyan bir girdiden okumak denendi: değiştirmedi (20 dk tepe 787 vs 773; 60 dk
  782 → 903), geri alındı. Muxer'ın örnek başına tuttuğu tablolar hesapla ~17 MiB/saat;
  kalanın nerede tutulduğu (tarayıcının AAC çözücü/kodlayıcısı, V8'in toplamadığı
  ArrayBuffer'lar) **ölçülmedi**. ADR-020'nin "düz" ölçümünde de son onda bir 774 (öncesi
  720–736) idi; o da aynı ses geçişiydi.

## 5. İşe yaramayanlar (ölçüldü, alınmadı)

| Deneme | Ölçülen | Neden alınmadı |
|---|---|---|
| Kodlayıcı kuyruğu 4 → 16 kare (özel `CustomVideoEncoder` ile) | Chrome 60 s 1080p: 195 kare/sn (değişmedi); tepe bellek 759 → 1032 MiB | Kodlayıcı zaten dolu; kuyruk yalnızca bellek tutuyor |
| `latencyMode: 'realtime'` | 205 vs 197–200 kare/sn (gürültü içinde) | ADR-024: yazılım kodlayıcıda kalite etkisi ölçüldü, kazanç yok |
| `hardwareAcceleration: 'prefer-hardware'` | 187 kare/sn | Aynı kodlayıcı zaten seçiliyor; donanımsız tarayıcıda ret riski |
| Tuvali atlayıp çözülmüş kareyi doğrudan kodlayıcıya vermek (kırpma/döndürme/altyazı yokken) | Chrome 90,6 kare/sn (**yarıya düştü**); Chrome + yazılım kodlayıcı 76–82 (106'dan düştü); yalnız headless Chromium'da 112 (90'dan) | Donanım kodlayıcıya GPU tuvalinden gelen kare, çözücünün karesinden hızlı gidiyor. Ayrıca piksel sonucu değişir (renk dönüşümü atlanır), "aynı çıktı" kuralına aykırı |
| Tuvali `transferToImageBitmap` ile `VideoFrame`'e çevirmek | 185 kare/sn, tepe +400 MiB | Daha yavaş ve bellek |
| Arka plan dolgusunu atlamak (cover) | Chromium 54 kare/sn (gürültü; artış yok) | Kazanç yok |
| Tek dışa aktarmayı iki kodlayıcıya bölmek | Deney: aynı anda 2 dışa aktarma toplamda 212 kare/sn (tek: 210); 3'te 293 | 2 akışta kazanç yok; 3 akışta %40 ama birleşim noktasında zorunlu anahtar kare ve iki bağımsız SPS/PPS: aynı dosyayı vermez. Yapılmadı |

| Sessizlik analizinde tam aralık okuma, bölmeden | 10,5 Mbit/s 20 dk: 13,2 s (önce 4,5 s) | Çok yavaş; 4 parçaya bölmeyle birlikte alındı |
| Sessizlik analizinde ağ profilli önden okuma | Tepe 791 / 849 MiB | Artışın yarısı kalıyordu |
| Dışa aktarmada sesi ayrı, tam aralık okuyan girdiden okumak | 20 dk 1080p tepe 787 (ortak girdi 773); 60 dk 782 → 903 | Bellek eğrisi değişmedi; geri alındı |
| Sesi videonun 0,5 s arkasından okumak (önde yerine) | 10,5 Mbit/s 20 dk: tepe 815 (önde: 799), aynı süre | Fark yok |

## Test edilen

Birleşimden sonra (main `f761911` ile), `web/` içinde:

- `npx tsc --noEmit -p .` → hata yok; `npx eslint .` → 0 sorun.
- `npx vitest run` → 37 dosya, **477 test geçti**.
- `npm run build` → başarılı.
- `E2E_PORT=3171 npx playwright test` → 136 geçti, 1 kaldı (main'de de kalan
  `kesit.spec.ts:63`), 2 atlandı. Main'in kendi ağacında aynı komut: 136 / 1 / 2.
- `run-matrix.mjs` Chromium / Chrome / Edge → 22 / 22 / 22 PASS.
- `run-real-media.mjs` Chrome 15 PASS; Chromium 11 PASS 4 REFUSED; Edge 11 PASS 4 REFUSED.

Birleşimden önce, `web/` içinde, son kodla:

- `npx tsc --noEmit -p .` → hata yok; `npx eslint .` → 0 sorun.
- `npx vitest run` → 34 dosya, **437 test geçti** (yeni: `exportProfile`, `exportPacing`,
  `hdrHalfClip`, `hdrClip`, `loudnessSplit`).
- `npm run build` → başarılı.
- `E2E_PORT=3171 npx playwright test` (tam) → **140 geçti, 2 atlandı** (sessizlik ekran
  görüntüsü testleri, yalnızca istenince), 4,0 dk.
- `node scripts/run-matrix.mjs` Chromium / Chrome / Edge → 21 / 21 / 21 PASS.
- `node scripts/run-real-media.mjs` Chromium / Chrome / Edge → 11 PASS 4 REFUSED / 15 PASS /
  11 PASS 4 REFUSED, 0 FAIL.

Ölçüm dosyaları git dışında: `web/matrix-results/export-memory-*-{base,fin,mem,last,final,before}-*.json`.
Kaynaklar ve çıktılar ölçümden sonra silindi.

## Ölçülmeyenler

- Başka makineler (dizüstü, düşük RAM, AMD/Apple, entegre GPU'suz), macOS/Linux,
  Safari/Firefox (çıktı desteklenmiyor).
- GPU'suz gerçek bir Chromium kullanıcısı; burada yalnızca Playwright'ın headless
  kabuğu var.
- Altyazılı ve müzikli uzun çıktının aşama profili (yalnız kod yolu değişmedi; matris ve
  e2e altyazı/müzik satırları koşuldu).
- HDR'de HLG ve 4K telefon kaydının süresi (yalnız 2 dk 1080p PQ sentetik; gerçek R09/R11
  matriste).
- Her satır tek ya da iki koşu; saatler arası %10–20 oynama görüldü.
- 60 dakikada ses işiyle ölçeklenen ~+120 MiB'ın nerede tutulduğu.
- ADR-025'in tam akışı (4 GiB dosya, analiz + aramalar + dışa aktarma) yeni kodla.
- Edge'de sessizlik analizi ve HDR (Edge'de HEVC yok; VP9 HDR matriste PASS).

## Sonraki tek görev

60 dakikalık dışa aktarmada ses işiyle birlikte büyüyen belleği yerinde bulmak: ses
kapalı bir dışa aktarmayla karşılaştırmak ve worker belleğini
`performance.measureUserAgentSpecificMemory` (çapraz köken yalıtımlı test sayfasında) ile
tarayıcının süreç belleğinden ayırmak.
