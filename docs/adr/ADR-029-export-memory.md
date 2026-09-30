# ADR-029 — Uzun dışa aktarmada bellek: nerede tutuluyor, ne düzeldi, ne doğası gereği

> Tarih: 2026-09-30 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine: Windows 11, Intel i5-12500,
> RTX 3070 Ti; Chrome 154.0.8037.58). Politika, sınır ve fiyat değişmez. ADR-028'in
> "düz değil, tam çözülmedi" bölümünün devamı.

## Bağlam

ADR-028: 60 dakikalık 1080p tam kodlamada (Chrome, OPFS yolu) süreç ağacının belleği düz
değil; ~781'den 874 MiB'a tırmanıyor, artış ses süresiyle ölçekleniyor gibi görünüyor,
sebep bulunamadı. ADR-020 ve ADR-021 ise "bellek düz" demişti (ADR-020 Chromium 476–506,
Chrome 720–736 MiB). Bu çalışmanın soruları: bellek **nerede** tutuluyor, bizden mi, ve
60 dakikanın bedeli ne?

Kural: tahmin yok; her iddia bir araçla ölçüldü. Çıktı aynı kalmalı.

## Yöntem ve araçlar (kalıcı, `web/scripts/`)

- **Süreç türüne göre dağılım** (`lib/process-memory.ps1`, beşinci sütun): süreç ağacının
  private bytes değeri Chromium süreç türüne bölünür (`browser`, `renderer`,
  `gpu-process`, `utility/<servis>`; `renderer-max` = sayfa ve worker'ların renderer'ı).
  `measure-export-memory.mjs` her onda bir için tepe **ve en düşük** değeri yazar (en
  düşük ≈ çöp toplamadan sonra kalan).
- **Worker ve sayfa yığını** (`--heap`, `lib/cdp-heap.mjs`): tarayıcı bir hata ayıklama
  portuyla açılır, ikinci bir CDP bağlantısı sayfaya ve `Target.setAutoAttach` ile
  dışa aktarma worker'ına bağlanır; `Runtime.getHeapUsage` (V8 kullanılan/ayrılan,
  ArrayBuffer içerikleri) 10 s'de bir. `--heap-gc`: her okumadan önce tam çöp toplama.
- **Yığın görüntüsü** (`--heap-snapshots=20,80,140,after`, `HeapProfiler.takeHeapSnapshot`)
  ve özeti (`heap-snapshot-summary.mjs`): kurucuya, düz nesneler özellik adlarına göre
  gruplanır; baskın ağaçtan tutulan boyut; görüntüler arası büyüme.
- **Ayırma örneklemesi** (`--heap-sampling`, `--heap-sampling=page`): toplanmış nesneler
  dahil, hangi fonksiyon ne kadar ayırıyor.
- **Chrome memory-infra** (`--memory-dumps=40,120,…`): renderer'ın ayırıcıları
  (PartitionAlloc, malloc, V8 ana/worker, Oilpan) — yığın görüntüsünün görmediği yerel bellek.
- `performance.measureUserAgentSpecificMemory` **kullanılamadı**: editör sayfası çapraz
  köken yalıtımlı değil (`crossOriginIsolated` yok); yerine CDP okumaları kullanıldı.
- Kaynaklar (git dışında, ölçümden sonra silindi): `generate-long-media.mjs --only=1080
  --seconds=1200` (20 dk 1080p30, 1,8 Mbit/s, mono AAC 48 kHz); 60 dk = aynısının üç
  kopyası 3599,9 s'de kesilmiş (ADR-028 ile aynı); ses izi çıkarılmış kopyaları
  (`-an`, akış kopyası). Hepsi `--persistent --whole --mode=encode`, Chrome.
- Ayrıca tarayıcıda küçük tezgâhlar (git dışında, ölçüm için): gerçek `SegmentAudioWriter`
  sahte kaynakla bir worker'da; Chrome'un AAC kodlayıcısı/çözücüsü tek başına 60 dk;
  dışa aktarmanın ses yolu tek başına (gerçek dosya, çözme + karıştırma + AAC + muxer);
  gerçek paketleri yeniden paketleyen muxer (normal ve `fragmented`).

## 1. Bellek nerede (düzeltmeden önce, `2a369a6`)

**Süreç:** artışın tamamı sayfanın ve worker'ın renderer'ında. GPU süreci (kodlayıcı)
başlangıçtan sonra düz (304–345), tarayıcı süreci düz (48–51), depolama/ağ/ses
servisleri düz (8–13 MiB). 60 dk, `--heap`: `renderer-max` onda bir tepeleri 353, 337, 349,
357, 360, 408, 391, 412, 437, **485**; en düşükler 185 → 328.

**Renderer'ın içi (60 dk, 10 s'de bir CDP):**

| | 40 s | ~200 s | ~370 s | bitiş |
|---|---|---|---|---|
| worker V8 yığını, ayrılan | 45 MiB | 83 | 94 | 97 (kapanışta 118) |
| sayfa V8 yığını, ayrılan | 25 MiB | 36 | 61 | 61 |
| worker ArrayBuffer içerikleri (dalgalanan) | 46 | 66 | 57 | 51 |

**Worker'da gerçekten tutulan (yığın görüntüsü, 20 dk, 20 → 80 → 140 s):** toplam 24,94 →
28,19 → 30,90 MiB. 20 → 140 s arasındaki 5,96 MiB büyümenin **tamamı** mediabunny'nin MP4
muxer'ının örnek kayıtları: `{timestamp, decodeTimestamp, duration, data, size, type,
timescaleUnitsToNextSample}` nesnesi +69 814 adet (2,66 MiB), bunların sayıları
(HeapNumber) +217 239 adet (2,44 MiB), dizi yuvaları 0,73 MiB, parça (chunk) nesneleri
0,16 MiB → **örnek başına ~90 bayt**. Başka büyüyen grup yok (açık okuyucular, akışlar,
çözücü istekleri sabit). Dışa aktarma bitince worker'ın yığını 3,66 MiB: hepsi bırakılıyor.

**Ayrılan ama tutulmayan (ayırma örneklemesi, 20 dk):** worker toplam **2 925 MiB** ayırdı;
bunun **2 316 MiB**'ı (%79) tek fonksiyon: `mixStreamInto`. Her çıkış örneği ve kanal için
`sampleAt` → `frameAt` çağrısı (ve bloklar üzerinde `for…of`) bir kutulanmış sayı ya da
yineleyici sonucu ayırıyordu; saatte ~7 GiB kısa ömürlü nesne. Sayfa da 20 dakikada
**768 MiB** ayırdı: worker 5 karede bir ilerleme olayı yolluyordu (1080p'de ~50/sn) ve her
olay editörün tamamını yeniden çiziyordu (React).

**Mekanizma:** V8 yığını canlı nesnenin birkaç katına kadar büyütür ve meşgul bir iş
parçacığında geri vermez; çöp ne kadar hızlı üretilirse ayrılan yığın o kadar büyür, ve
yerel (Oilpan'a bağlı) çöp de bir sonraki büyük toplamaya kadar bekler. Kanıt:

| Deney (60 dk, ADR-028 kodu + karıştırıcı düzeltmesi) | renderer en düşük (onda bir) | renderer tepe |
|---|---|---|
| 20 s'de bir **zorla tam toplama** | 166 → 185 (+19) | 267, 248 … 340, 358 |
| 30 s'de bir zorla tam toplama, **sessiz kaynak** | (ölçülmedi) | 196, 204, … 200, 220: düz |

Zorla toplamada kalan artış (en düşüklerde +19, toplam ağaçta 628 → 650, +22 MiB) muxer
tablosunun kendisi (30 s'de bir toplanan ayrı bir koşuda worker yığını 16,8 → 39,2 MiB).
Sessiz kaynakta muxer yalnızca video örneklerini tutar (10,9 → 19,5) ve renderer düz.
Zorla toplamada bile tepeler yükseliyor: iki toplama arasında biriken çöp koşu ilerledikçe
artıyor; bunun ayrıntısı (hangi yerel nesne) ölçülmedi, ama hepsi toplanabilir.

### Hipotezler

| | Sonuç | Kanıt |
|---|---|---|
| (a) muxer'ın `moov` için örnek başına tuttuğu kayıtlar | **Doğru, doğası gereği.** ~90 B/örnek; 30 fps + 48 kHz AAC'de saatte 108 000 + 168 750 = 276 750 örnek → **~24 MiB/saat** canlı | yığın görüntüsü farkı; zorla toplamada kalan tek artış |
| (b) kapatılmayan AudioSample / AudioData / EncodedAudioChunk | **Yanlış** | kod: bizde ve mediabunny'de hepsi `close()`; Chrome'un AAC kodlayıcısı 60 dk tek başına: renderer 45 → 86 (tepe 152) → **toplamadan sonra 44**; kodla + çöz: 43 → 89 → **42** |
| (c) ses çözücü / yeniden örnekleyici tamponları (`ensure`/`release`) | **Yanlış** | dışa aktarmanın ses yolu tek başına (gerçek 60 dk dosya): her %10'da toplamadan sonra renderer 103 → 114 (+11) = worker'ın muxer'ı (+11,8) |
| (d) OPFS eşzamanlı erişim tamponu | **Yanlış** | tarayıcı ve depolama süreçleri düz; renderer'ın toplama sonrası tabanı yalnızca muxer kadar artıyor |
| (e) sayfada (UI) büyüme | **Kısmen doğru**: sızıntı değil, çöp | sayfa V8 yığını 11 → 61 MiB (ayrılan), canlı 7–20; zorla toplamada 7,6 düz; kaynak ilerleme olayı başına yeniden çizim |
| ADR-028: "ses süresiyle ölçekleniyor" | **Doğru, ama sebep sesin kendisi değil** karıştırıcının ayırması | karıştırıcı düzeltilince worker yığını 20 dakikada 76 → 33 MiB |

## 2. Değişenler

**a) Ses karıştırıcısı kare başına ayırmıyor** (`src/domain/audioMix.ts`). `mixStreamInto`
artık her kanal için `PcmRingBuffer.mixChannelInto` → tek döngü (`mixFrames`): aynı
aritmetik (`a + (b − a) · kesir`, `hedef + değer · kazanç`), aynı sırada, çağrı ve
yineleyici olmadan; sabit kazanç ve kazanç eğrisi ayrı çağrılar. Tarayıcıdaki ölçüm
(gerçek `SegmentAudioWriter` bir worker'da, 20 dk ses, Chrome'un örnekleyici profili):

| Biçim | Karıştırıcının ayırdığı | Ses işi süresi |
|---|---|---|
| Önce (kare başına `sampleAt`) | 2 305–2 319 MiB | 6,4–6,9 s |
| Tek döngü, ama sabit kazanç ve eğri tek değişkende birleşik | 327–336 MiB | 6,1 s |
| **Şimdiki** | **0,9–1,2 MiB** | **5,0–5,3 s** |
| Müzikli (kazanç eğrisi), önce → şimdi | 5 943 → 2,5 MiB | 11,2 → 10,6 s |

Birim testi (`tests/unit/audioMix.test.ts`) eski biçimi referans olarak tutar ve 400
rastgele durumda (1–2 kanal, 48/44,1/32/22,05 kHz ve tuhaf oranlar, boşluklu ve kısa
bloklar, kırpılmış tampon, sabit/sıfır/eğri kazanç, kesirli konumlar) ve uçlarda (boş
tampon, negatif, NaN, ±∞ konum, kanalsız blok) her değeri `Object.is` ile karşılaştırır
(> 1 milyon değer). Bir formül değişikliği (ör. `a·(1−k) + b·k`) testi kırıyor (denendi).

**b) İlerleme olayı en çok 250 ms'de bir** (`exportWorker.ts`, `PROGRESS_INTERVAL_MS`).
İlk ve son olay her zaman gider; arada en çok saniyede dört. Hızlı kesim de aynı
yoldan geçer. Sayfanın 20 dakikada ayırdığı **768 → 70 MiB**; sayfa yığını 60 dakikada
8–10 MiB'da kalıyor (önce 61).

## 3. Önce / sonra (Chrome, 1080p, tam kodlama, OPFS)

Aynı gün, aynı makine. "Önce" = `2a369a6`; "sonra" = bu değişiklik (a + b). Bellek:
süreç ağacı, MiB; onda bir tepeleri (ve en düşükleri).

| Koşu | Süre | Taban | Onda bir tepeleri | En düşükler | Tepe |
|---|---|---|---|---|---|
| **60 dk, önce** (`--heap`) | 422,3 s | 517 | 810, 804, 817, 826, 826, 874, 854, 869, 903, 951 | 723 → 797 | **951** |
| **60 dk, sonra** (`--heap`) | 401,6 s | 526 | 777, 740, 734, 736, 826¹, 756, 767, 791, 802, 852 | 654 → 690 | **852** |
| 60 dk, önce (düz koşu) | 441,8 s | 529 | 822, 796, 801, 891, 844, 858, 864, 892, 885, 942 | — | 942 |
| 60 dk, yalnız (a) (düz) | 457,4 s | 534 | 854, 787, 806, 858, 818, 837, 841, 861, 899, 919 | — | 919 |
| 60 dk, sonra (düz) | 382,2 s | 509 | 784, 736, 723, 735, 943¹, 748, 755, 777, 797, 822 | 654, 637 … 665, 676 | 943¹ (yoksa 822) |
| 20 dk, önce (düz) | 179,6 s | 494 | 711, 750, 786, 738, 771, 768, 801, 812, 781, 987 | — | 987 |
| 20 dk, yalnız (a) (düz) | 145,9 s | 488 | 729, 752, 822, 807, 767, 742, 752, 776, 775, 783 | — | 822 |
| **20 dk, sonra** (düz) | 128,9 s | 481 | 689, 687, 701, 691, 677, 689, 684, 699, 691, 694 | 603–632 (düz) | **701** |

"Önce" ve "yalnız (a)" düz koşuları, en düşük değerleri henüz yazmayan betik sürümüyle
koşuldu.

¹ Tek örneklik tarayıcı süreci sıçraması (166–258 MiB, ≤ 400 ms, koşunun %40–50'sinde);
renderer'da değil. Karıştırıcı düzeltmesinden sonraki yedi 60 dakikalık koşunun üçünde
görüldü (birinde daha küçük, 106), öncekilerin ikisinde görülmedi; değişikliğin dokunduğu
hiçbir şey (worker'ın karıştırması, olay sıklığı) tarayıcı sürecinde çalışmıyor. Sebebi
**ölçülmedi**.

Aynı koşularda yığınlar: worker'ın ayrılan V8 yığını 60 dakikada önce 45 → 97 MiB,
sonra 37 → 61 MiB (+24 = muxer); sayfa önce 11 → 61, sonra 8 → 10 MiB.

- **20 dakika artık düz** (677–701).
- **60 dakikada tepe ~100 MiB düşük** (951 → 852) ve süre boyunca seviye 60–90 MiB aşağıda;
  ama **tam düz değil**: toplama sonrası taban saatte ~40–50 MiB yükseliyor, tepe son
  onda birde kapanışla (`moov` yazımı: worker yığını bir an 104 MiB, ArrayBuffer 124)
  yükseliyor.
- Süreler koşudan koşuya ±%10–20 oynuyor (ADR-028); hız iddiası yok. Ses işinin kendisi
  tezgâhta ~%20 hızlandı.

### Çıktı aynı mı

Önce ve sonra dosyaları `ffmpeg -c copy -f framemd5` ile paket paket karşılaştırıldı:
**60 dk: 108 000 video ve 168 750 ses paketinin hepsi aynı; 20 dk: 36 000 ve 56 250
paketin hepsi aynı**, çözülünce de 36 000 kare ve 56 250 ses karesi aynı. AAC akışı bit
bit aynı olduğuna göre karıştırıcının çıktısı da aynı. **Dosyanın baytları aynı değil**
(boyut aynı: 859 133 758 / 2 561 604 026 bayt): ilk fark 5,4 MB'ta, 313. ses paketinden
sonra ses parçalarının dosyadaki yeri farklı. ADR-028'den beri ses, videonun ilerlemesine
göre zamanla iç içe yazılıyor; parçaların yeri çalışma hızına bağlı. Aynı derlemenin iki
koşusunun bayt bayt farklı olup olmadığı **ölçülmedi**.

## 4. Doğası gereği olan: `moov` dizini

Sıkıştırılmamış bir MP4 (`fastStart: false`) sonunda her örneğin boyutunu, süresini ve
anahtar kare bilgisini yazmak zorunda; mediabunny 1.58.1 bunları kodlama boyunca örnek
başına bir JS nesnesinde tutuyor. Ölçülen **~90 B/örnek**:

| Çıktı (1 saat) | Örnek | Canlı dizin |
|---|---|---|
| 30 fps + 48 kHz AAC | 108 000 + 168 750 | **~24 MiB** |
| 60 fps + 48 kHz AAC (şu an politika en çok 30 fps) | 216 000 + 168 750 | ~33 MiB |
| sessiz, 30 fps | 108 000 | ~9 MiB |

Buna V8'in canlı yığının üstünde bıraktığı pay eklenir: sonra koşusunda worker'ın ayrılan
yığını muxer kadar büyüdü (+24 MiB), süreç ağacının onda bir en düşükleri 60 dakikada
+22…+52 MiB (637 → 676, 638 → 690).
**Yani 60 dakikalık 1080p'nin bedeli: ~24 MiB canlı dizin, süreç ağacında ~40–50 MiB
kalıcı artış, kapanışta kısa bir tepe.** Dışa aktarma bitince hepsi bırakılıyor (worker
3,7 MiB).

### Parçalı MP4 (`fastStart: 'fragmented'`) değer mi? — Hayır (öneri, uygulanmadı)

- mediabunny 1.58.1'de parçalı modda da örnek kayıtları kalıyor: her parça
  (`finalizedChunks`) kendi `samples` dizisiyle dosya sonundaki `mfra`/`tfra` dizini için
  tutuluyor. Ölçüm (gerçek 60 dk dosyanın 276 747 paketi yeniden paketlendi, her çeyrekte
  tam toplamadan sonra): normal **57,3 B/örnek**, parçalı **52,4 B/örnek** — saatte ~1 MiB
  fark. (Bu tezgâhta örnek başına bedel dışa aktarmadakinden düşük; zaman damgaları
  demuxer'dan geliyor. Göreli karşılaştırma için.)
- Bedelleri: oynatıcı/düzenleyici uyumluluğu (parçalı MP4'ü eski oynatıcılar ve bazı
  masaüstü uygulamaları daha zayıf açar; **denenmedi**), hızlı kesimin (ADR-027) ve
  `probeProduced`'ın doğrulama okumaları parçalı dosyada **sınanmadı**, ADR-023 boyut
  tahmini parça başına `moof` payıyla yeniden ölçülmeli.
- Asıl kazanç mediabunny'nin dizini tip dizilerinde tutmasıyla olur (örnek başına 12–16
  bayt yeterli; ~24 → ~4 MiB/saat). Bu kütüphane içi bir değişiklik; yukarı akışa
  önerilecek bir iş, bu depoda yama yok.

## 5. ADR-020 ve ADR-021'in "düz bellek" cümlesi

Doğru değildi; düzeltme: ADR-020'nin koşusunda eski kod parçanın sesini videonun
**arkasından** yazıyordu, bu yüzden karıştırıcının çöpü (yukarıdaki %79) son onda bire
yığılıyordu ("son dilimde 664 / 774 MiB") ve muxer dizininin saatlik ~24 MiB'ı ölçüm
gürültüsünün altında kaldı. Chromium satırı (476–506) ayrıca yazılım çizimi yüzünden
~3,5× gerçek zamanlıydı (çöp saniyede daha az) ve 480p kaynaktandı. Doğru ifade: **OPFS
yolunda bellek çıktı boyutuyla büyümez; çıktı süresiyle saatte ~24 MiB canlı dizin
(+ V8 payı) kadar büyür.**

## Test edilen

`web/` içinde, son kodla:

- `npx tsc --noEmit -p .` → hata yok; `npx eslint .` → 0 sorun (çıkış 0).
- `npx vitest run` → 37 dosya, **479 test geçti** (yeni: karıştırıcının bit bit
  eşdeğerliği, 2 test).
- `npm run build` → başarılı.
- `E2E_PORT=3211 npx playwright test` (tam) → **137 geçti, 2 atlandı** (sessizlik ekran
  görüntüsü testleri, yalnızca istenince), 3,6 dk.
- `node scripts/run-matrix.mjs` Chromium / Chrome / Edge (`next start -p 3100`) → **22 / 22 / 22
  PASS**; 66 satırın hepsinde durum, SSIM, süre, kare sayısı, yöntem ve ton seviyesi 24 Eylül
  koşusuyla (ADR-028 birleşimi) **aynı**.
- `node scripts/run-real-media.mjs --browser=chrome` → **15 PASS**; 15 satırın hepsi 24 Eylül
  koşusuyla aynı.
- Ölçüm dosyaları git dışında: `web/matrix-results/export-memory-1080-{before,after,final,diag,…}*.json`.
  Kaynaklar, çıktılar ve yığın görüntüleri ölçümden sonra silindi.

## Ölçülmeyenler

- Başka makineler ve tarayıcılar (Edge ve Chromium'da bellek eğrisi bu çalışmada koşulmadı;
  matris ve e2e koşuldu), düşük RAM'li cihaz.
- Müzikli ve altyazılı 60 dakikalık dışa aktarmanın bellek eğrisi (müzik yolunun
  karıştırıcısı tezgâhta ölçüldü: 5,9 GiB → 2,5 MiB ayırma).
- Tarayıcı sürecindeki tek örneklik sıçramanın sebebi.
- Aynı derlemenin iki koşusunda dosyanın bayt bayt aynı olup olmadığı.
- Parçalı MP4'ün oynatıcı uyumluluğu.

## Sonraki tek görev

mediabunny'ye örnek dizinini tip dizilerinde tutma önerisini (ölçümlerle) iletmek; kabul
edilirse sürüm yükseltip 60 dakikalık eğriyi yeniden ölçmek.
