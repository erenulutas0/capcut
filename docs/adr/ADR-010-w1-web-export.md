# ADR-010 — W1: tarayıcıda gerçek MP4 çıktısı

> Tarih: 2026-09-21 · Durum: UYGULANDI ve ÖLÇÜLDÜ
> Kapsam: yerel web export. Bulut, hesap, ödeme, native ve altyazı hâlâ kapsam dışı.

## Bağlam

W0'da düzenleme tarifi ve arayüz çalışıyordu; çıktı motoru yoktu. W1'in tek
sorusu şuydu: **seçilen anlar, doğru çerçeve ve doğru sesle gerçek bir MP4
oluyor mu?** Cevap doğrulanmış bir dosyayla verilmeliydi, ekran görüntüsüyle değil.

## Karar 1 — Mediabunny + WebCodecs, ffmpeg.wasm değil

`mediabunny@1.58.1` (MPL-2.0, runtime bağımlılığı yok) demux/mux için,
WebCodecs tarayıcının kendi H.264/AAC encoder'ı için kullanıldı. Doc 07
ADR-003 ve doc 08 zaten bu adayı işaret ediyordu; W1 onu doğruladı.

ffmpeg.wasm alınmadı: birkaç MB WASM indirmesi, yazılım encode'un yavaşlığı ve
dağıtılan core'un lisans incelemesi bu iş için gereksiz. Karar geri alınabilir;
tarayıcı encode'un yetmediği bir dosya matrisi çıkarsa ayrı ADR ile bakılır.

**Lisans notu:** MPL-2.0 dosya bazlı copyleft'tir. Mediabunny kaynak dosyaları
değiştirilmedi, yalnızca paket olarak kullanıldı; bu kullanımda MPL-2.0'ın
kaynak açma yükümlülüğü kendi kodumuza geçmez. Paket değiştirilirse
değiştirilen dosyaların kaynağı yayımlanmalıdır.

## Karar 2 — Domain "render planı" derler, worker yalnızca uygular

`src/domain/renderPlan.ts` EDL'i deterministik bir plana çevirir: sabit fps
ızgarasında kare aralıkları, piksel cinsinden crop, lineer kazançlar, güvenlik
kazancı ve bir fingerprint. Worker hiçbir zamanlama kararı vermez.

Kazanç: bütün zamanlama Node'da test edilebilir; motor değişse bile aynı plan
aynı kareleri tarif eder. Fingerprint kanonik tarifi kapsar, `projectId` ve
`revision` gibi semantiği etkilemeyen alanları kapsamaz (doc 10).

Kare ızgarası: `frame = round(us * fpsNum / (fpsDen * 1e6))`. Klip sınırları bu
kuralla hesaplandığı için çıktıda boşluk veya örtüşme oluşamaz; toplam kare
sayısı son segmentin bitiş karesidir.

## Karar 3 — Kaynak kareleri sabit fps ızgarasına örneklenir

Her çıktı karesi için kaynak zamanı hesaplanır ve `samplesAtTimestamps()` ile o
kare çekilir. Kaynağın kendi PTS'i aynen çıkışa kopyalanmaz.

Gerekçe: çıktı sözleşmesi 30 fps sabit diyor (doc 09). Kaynağın değişken kare
hızı, 29.97 gibi rasyonel hızlar veya klip başlangıcının keyframe'e denk
gelmemesi bu yolla çıktı süresini kaydırmaz. Bedeli: kaynak 60 fps ise kareler
seyreltilir, 24 fps ise tekrarlanır.

## Karar 4 — Ses miksi worker içinde, Web Audio olmadan

Worker'da `AudioContext`/`AudioBuffer` yoktur. Bu yüzden miks `AudioSampleSink`
üzerinden gelen f32 PCM üzerinde elle yapılır (`src/domain/audioMix.ts`):

- akış başına kayan pencere (`PcmRingBuffer`) — tüm iz belleğe alınmaz;
- yeniden örnekleme **lineer interpolasyon**;
- kanal eşlemesi `i % kaynakKanalSayısı` (mono → stereo çoğaltma);
- müzik zarfı `mapOutputToMusic` ile aynı formülden, ses kare ızgarasında;
- doc 09 güvenlik kazancı `10^(-1/20) / max(1, eşzamanlıKazançToplamı)`;
- sonda sert limiter.

**Açıkça sınır:** lineer interpolasyon polyphase/sinc yeniden örnekleyici
değildir ve kanal indirgeme matrisli bir downmix değildir. 44.1 kHz → 48 kHz
dönüşümünde ölçülmemiş bir miktar yüksek frekans bozulması olabilir. W2'de
gerçek kullanıcı dosyalarıyla ölçülecek.

## Karar 5 — Uygunluk kapısı beş aşamalı, sessiz fallback yok

Doc 11'deki A–E aşamaları uygulandı:

| Aşama | Ne yapılır | Nerede |
|---|---|---|
| A | güvenli bağlam, Worker, WebCodecs, OffscreenCanvas | `exportCapability.checkEnvironment` |
| B | hedef H.264 ve AAC ayarı için `canEncodeVideo/Audio` | worker `runSelfTest` |
| C | 320×240 sentetik video + 1 sn sessizlik encode → mux → **yeniden aç** | worker `runSelfTest` |
| D | kullanıcının kendi dosyasının izleri ve `canDecode()` | `exportCapability.probeSource` |
| E | yalnızca A–D geçerse düğme açılır | `ExportDialog` |

H.264 var ama AAC yoksa export açılmaz; başka codec'e düşülmez ve ses atılarak
"başarılı" gösterilmez. Kapı sonuçları kullanıcıya satır satır gösterilir.

## Karar 6 — Başarı yalnızca yeniden açılıp ölçülen dosya için

`finalize()` sonrası üretilen byte'lar yeni bir `Input` ile açılır; süre,
çözünürlük ve codec'ler oradan okunur. Süre, plandaki ızgaradan bir kareden
fazla saparsa `output_duration_mismatch` ile **başarısız** sayılır.

Arayüzdeki bütün sayılar bu ölçümden gelir, plandan değil. İlerleme yüzdesi
yalnızca kodlanan kare sayısından hesaplanır; `finalizing` ve `verifying`
aşamalarında yüzde gösterilmez.

## Karar 7 — `BufferTarget` + `fastStart: 'in-memory'`

Çıktı bellekte tutulur. 5 dakikalık politika sınırında 1080p için kabaca
200 MB tepe bellek demektir. Bu, mevcut 5 dakikalık web sınırıyla bilinçli
olarak kabul edildi. Daha uzun çıktı için `StreamTarget` + File System Access
API'ye geçilmesi gerekir; bu W2 işidir.

## W0'da bulunan ve burada düzeltilen iki hata

1. **`webkitAudioDecodedByteCount` yanlış okunuyordu.** `loadedmetadata`
   anında bu sayaç 0'dır; bu "ses yok" diye yorumlanıyordu. Sonuç: sesi olan
   dosyalar editörde "Kaynak sesi: Yok" görünüyordu ve W1'de kaynak sesi
   mikse hiç girmiyordu. Sayaç artık yalnızca **varlık** kanıtı sayılıyor ve
   kesin cevap demuxer'dan alınıyor.
2. **İkinci ve sonraki anların sesi kayboluyordu.** `AudioStreamReader.open()`
   tamponu sıfırlıyor ama `sampleRate`'i bırakıyordu; hazırlama adımı
   `sampleRate === 0` koşuluna bağlı olduğu için atlanıyor, tampon hiç
   dolmuyordu. `open()` artık tam sıfırlama yapıp ilk örneği kendisi çekiyor.
   İkinci hata, yalnızca dosyayı açıp "ses var" demekle yakalanamazdı; an
   başına bant ölçümü eklendiği için yakalandı.

Ayrıca `renderPlan` artık "kullanıcı kaynak sesini istiyor mu" ile "dosyada ses
izi var mı" sorularını ayırıyor: ikincisini yalnızca demuxer cevaplayabilir.

## Ölçülen sonuç

`npm run verify:export` — Playwright gerçek editörü sürer, gerçek export alır,
dosyayı indirir ve **ffprobe** ile ölçer. Kaynak: yerel üretilmiş sentetik
24 sn 1280×720 H.264/AAC; anlar `[0,3)` ve `[12,16)`; 9:16, 720p; müzik eklendi.

| Ölçüm | Playwright Chromium 153 | Google Chrome 153.0.8010.52 |
|---|---|---|
| süre | 7.018667 s (hedef 7 s, +18.7 ms) | 7.018667 s |
| kare | 210 (= 7 × 30) | 210 |
| görüntü | h264 720×1280, High profile | aynı |
| ses | aac 48 kHz 2 kanal | aynı |
| ffmpeg referansına SSIM | 0.9224 | 0.9788 |
| 440 Hz (kaynak sesi) | −24.1 dB | −24.1 dB |
| 220 Hz (eklenen müzik) | −35.7 dB | −35.7 dB |
| 3 kHz (kontrol bandı) | −82.2 dB | −82.2 dB |
| an 1 / an 2 kaynak sesi | −24.1 / −24.1 dB | −24.1 / −24.1 dB |

`+18.7 ms` sapma son AAC paketinin (1024 örnek ≈ 21.3 ms) video karesinin
ötesine taşmasından gelir ve bir kare toleransının (33.3 ms) içindedir.

SSIM karşılaştırması bağımsızdır: aynı kesim, aynı crop ve aynı sıra ffmpeg ile
ayrıca kurulur. Yanlış aralık, yanlış sıra veya yanlış crop bu skoru çökertirdi.

Kaynak sesi seviyesi ayrıca müziksiz bir çıktıyla kalibre edildi: kaynak
−21.09 dB → çıktı −22.11 dB, yani tam olarak beklenen −1.0 dB güvenlik kazancı.

## Ölçülmeyenler

Gerçek telefon, Safari, Firefox, Edge; kullanıcıların gerçek kamera dosyaları;
VFR kayıt, 90° rotation metadata, HEVC/HDR kaynak, 4K, 29.97/59.94 fps,
44.1 kHz müzik ile 48 kHz kaynak karışımı, uzun (dakikalarca) çıktı, düşük
bellekli cihaz, disk dolması. Doc 22'deki M02, M05–M07, M10, M13, M15
fixture'ları **NOT_RUN**.

## Sonraki tek görev

**W2 — dosya matrisi ve dayanıklılık:** doc 22'deki fixture'ları gerçek
dosyalarla çalıştır, Safari/Firefox/Edge sonucunu kaydet, uzun çıktı için
`StreamTarget` yoluna geç ve destek matrisini yayımla.
