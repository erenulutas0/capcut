# Destek matrisi — W2 ölçümleri

> Bu dosya `web/scripts/build-support-matrix.mjs` tarafından, `web/matrix-results/*.json` içindeki gerçek çalıştırma sonuçlarından üretilir. Elle düzenlenmez.

Her satır `video-editor-blueprint/docs/22_QA_TEST_MATRIX.md` içindeki bir fixture’dır. Sonuçlar gerçek tarayıcıda gerçek dosyalarla alınmış, çıktı ffprobe/ffmpeg ile ölçülmüştür.

## Ne anlama geliyor?

| Simge | Anlamı |
|---|---|
| ✅ PASS | Beklenen davranış gerçekleşti ve ölçümle doğrulandı. |
| ⛔ UNSUPPORTED | Tarayıcıda gerekli encoder yok. Uygulama bunu **açıkça reddetti**, sessizce başka codec’e düşmedi ve sahte başarı göstermedi. |
| ❌ FAIL | Beklenen davranış gerçekleşmedi. |
| 💥 ERROR | Çalıştırma sırasında beklenmeyen hata. |
| — NOT_RUN | Bu ortamda çalıştırılamadı; gerekçesi aşağıda. |

## Test edilen ortamlar

| Tarayıcı | Sürüm | Encoder kabiliyeti | Çalıştırma |
|---|---|---|---|
| Chromium (Playwright) | 153.0.8010.12 | H.264 var · AAC var | 2026-10-08 18:03 UTC |
| Google Chrome | 154.0.0.0 | H.264 var · AAC var | 2026-10-08 18:08 UTC |
| Microsoft Edge | 154.0.0.0 | H.264 var · AAC var | 2026-10-08 18:13 UTC |
| Firefox (Playwright) | çalıştırılmadı | çalıştırılmadı | — |
| WebKit (Playwright) | çalıştırılmadı | çalıştırılmadı | — |

Hepsi win32 x64 üzerinde, headless olarak çalıştırıldı. **Bu matris gerçek Safari’de ve fiziksel cihazda çalıştırılmadı;** tek bir gerçek telefonda elle yapılan denemeler aşağıda ayrı bölümde (“Gerçek telefon”). Playwright’ın WebKit derlemesi Safari değildir ve Safari sonucu yerine geçmez.

## Sonuçlar

| # | Durum | Chromium | Chrome | Edge | Firefox | WebKit |
|---|---|---|---|---|---|---|
| M01 | 20 s dikey H.264/SDR + iki aralık | ✅ | ✅ | ✅ | — | — |
| M02 | 90° rotation metadata | ✅ | ✅ | ✅ | — | — |
| M03 | Yatay kaynak → 9:16 crop | ✅ | ✅ | ✅ | — | — |
| M04 | Sessiz video + WAV müzik | ✅ | ✅ | ✅ | — | — |
| M05 | 44.1 kHz müzik + 48 kHz kaynak | ✅ | ✅ | ✅ | — | — |
| M06 | VFR kaynak | ✅ | ✅ | ✅ | — | — |
| M07 | 29.97 fps kaynak | ✅ | ✅ | ✅ | — | — |
| M08 | Müzik 5–15 s, timeline başlangıcı 2 s | ✅ | ✅ | ✅ | — | — |
| M09 | Klip sınırında ses | ✅ | ✅ | ✅ | — | — |
| M10-hevc | 4K HEVC kaynağı | ✅ | ✅ | ✅ | — | — |
| M10-hdr | HDR (bt2020 / PQ, 10-bit) kaynağı | ✅ | ✅ | ✅ | — | — |
| M10-hdr-hlg | HDR (bt2020 / HLG, 10-bit) kaynağı, 90° döndürmeli | ✅ | ✅ | ✅ | — | — |
| M11 | Bozuk/truncated MP4 | ✅ | ✅ | ✅ | — | — |
| M12 | Çok kısa ve maksimum 20 klip | ✅ | ✅ | ✅ | — | — |
| M13 | Politika sınırını aşan büyük dosya | ✅ | ✅ | ✅ | — | — |
| M14 | Kaynağa erişim kaybı ve yeniden bağlama | ✅ | ✅ | ✅ | — | — |
| M15 | Export sırasında sekme arka plana alınıyor | ✅ | ✅ | ✅ | — | — |
| M16 | Gain toplamı / fade sınırları | ✅ | ✅ | ✅ | — | — |
| M16b | Kesit yokken eklenen müzik, bütün videonun altında | ✅ | ✅ | ✅ | — | — |
| M19 | Hızlı kesim: 1080p30 H.264, anahtar kare dışında iki kesim | ✅ | ✅ | ✅ | — | — |
| M17 | Altyazı videoya işleniyor | ✅ | ✅ | ✅ | — | — |
| M20 | Hedef boyut: 8 s kırpılmış video 1 MB’a sığdırılıyor | ✅ | ✅ | ✅ | — | — |
| M20b | Hedef boyut: sığmayan hedef kodlamadan önce reddediliyor | ✅ | ✅ | ✅ | — | — |
| M20c | Hedef boyut: zaten sığan kaynak yeniden kodlanmıyor | ✅ | ✅ | ✅ | — | — |
| M21 | Yalnızca ses: iki kesit M4A olarak | ✅ | ✅ | ✅ | — | — |
| M21b | Yalnızca ses: sessiz videoda açık ret | ✅ | ✅ | ✅ | — | — |
| M18 | Görüntüye bağlı altyazı anlarla taşınıyor | ✅ | ✅ | ✅ | — | — |
| M18b | Kaynak → sonuç dönüşümü görünen altyazıyı değiştirmiyor | ✅ | ✅ | ✅ | — | — |
| M22 | Transkriptten gelen altyazı videoya işleniyor | ✅ | ✅ | ✅ | — | — |
| M23 | İyileştirilmiş çıktı: karanlık kamera görüntüsü, Otomatik, iki kesit | ✅ | ✅ | ✅ | — | — |

| Toplam | | 30✅ 0⛔ 0❌ 0💥 0— | 30✅ 0⛔ 0❌ 0💥 0— | 30✅ 0⛔ 0❌ 0💥 0— | — | — |

## Ölçülen değerler (Chromium)

| # | Süre | Kare | Çözünürlük | SSIM | Diğer ölçümler |
|---|---|---|---|---|---|
| M01 | 10.005333 s | 300 | 720x1280 | 0.9991 | an sesleri -22.1 / -22.1 dB |
| M02 | 5.013333 s | 150 | 720x1280 | 0.9993 | — |
| M03 | 5.013333 s | 150 | 720x1280 | 0.9219 | — |
| M04 | 6.016 s | 180 | 1280x720 | — | 440 Hz -56.3 / 330 Hz -36.1 dB |
| M05 | 5.013333 s | 150 | 720x1280 | — | perde -36.1 / -55.4 dB |
| M06 | 6.016 s | 180 | 1280x720 | — | — |
| M07 | 10.005333 s | 299 | 1280x720 | — | — |
| M08 | 10.005333 s | 300 | 720x1280 | — | müzik önce -69.5 → sonra -36.1 dB |
| M09 | 6.016 s | 180 | 1280x720 | — | sınır -24.4 / genel -24.1 dB |
| M10-hevc | — | — | — | — | sonuç: import_rejected |
| M10-hdr | 3.008 s | 90 | 1280x720 | 0.9698 | HDR→SDR: en yakın ref-hable, ΔE00 3.072, kayma 3.618, doygunluk 1.004..1.005, ton 1.95°, kırpma -0.047 |
| M10-hdr-hlg | 3.008 s | 90 | 720x1280 | 0.9729 | HDR→SDR: en yakın placebo-spline, ΔE00 3.257, kayma 2.241, doygunluk 1.038..1.038, ton 2.349°, kırpma -0.001 |
| M12 | 4.010667 s | 120 | 1280x720 | — | — |
| M14 | 10.005333 s | 300 | 720x1280 | — | — |
| M15 | 6.016 s | 180 | 1280x720 | — | — |
| M16 | 6.016 s | 180 | 1280x720 | — | tepe -19.8 dB; fade -43 → -28.2 dB |
| M16b | 12.010667 s | 360 | 1280x720 | — | — |
| M19 | 8.405333 s | 252 | 1920x1080 | 0.9842 | — |
| M17 | 10.005333 s | 300 | 720x1280 | — | — |
| M20 | 8 s | 240 | 720x1280 | 0.9219 | — |
| M20b | — | — | — | — | sonuç: refused_before_save |
| M20c | 20.010667 s | 600 | 720x1280 | — | — |
| M21 | 10 s | — | — | — | — |
| M21b | — | — | — | — | sonuç: refused_before_save |
| M18 | 12.010667 s | 360 | 720x1280 | — | — |
| M18b | 12.010667 s | 360 | 720x1280 | — | — |
| M22 | 12.010667 s | 360 | 720x1280 | — | — |
| M23 | 4.010667 s | 120 | 1280x720 | — | — |

## Gerçek kayıtlar

### Google Chrome — 15 PASS, 0 REFUSED, 0 FAIL, 0 ERROR (2026-10-08 18:23 UTC)

| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | PASS | h264 | 854x480 | 0° | 24 | 1957.4 s | 257.7 MiB | — | aac | 0.9898 |
| R02 | PASS | h264 | 592x1280 | 0° | 40.588 (VFR?) | 29.5 s | 3.9 MiB | — | aac | 0.9896 |
| R03 | PASS | h264 | 720x1280 | 0° | 30.004 | 22.8 s | 2.8 MiB | — | aac | 0.9967 |
| R04 | PASS | h264 | 480x724 | 0° | 29.934 | 45.1 s | 1.7 MiB | — | aac | 0.9806 |
| R05 | PASS | h264 | 1080x1920 | 0° | 30 | 14.2 s | 1.3 MiB | bt709 | aac | 0.9982 |
| R06 | PASS | h264 | 1280x720 | 0° | 24.334 (VFR?) | 16.9 s | 21.7 MiB | bt709 | aac | 0.9374 |
| R07 | PASS | h264 | 1280x720 | 0° | 59.94 | 16.5 s | 24.1 MiB | — | aac | 0.9743 |
| R08 | PASS | h264 | 224x128 | 0° | 15 | 34.4 s | 0.7 MiB | bt709 | aac | 0.9909 |
| R09 | PASS | hevc | 3840x2160 | 0° | 29.024 | 1.1 s | 6.8 MiB | smpte2084 | aac | 0.9347 |
| R10 | PASS | h264 | 1920x1080 | 0° | 29.974 | 341.2 s | 618.3 MiB | bt709 | aac | 0.9446 |
| R11 | PASS | hevc | 1920x1080 | -90° | 56.536 (VFR?) | 21.7 s | 33.3 MiB | arib-std-b67 | aac | 0.9472 |
| R12 | PASS | h264 | 1920x1080 | -180° | 59.93 | 88.7 s | 249 MiB | bt709 | aac | 0.9571 |
| R13 | PASS | hevc | 3840x2160 | -90° | 29.83 | 10.4 s | 53.8 MiB | bt709 | aac | 0.9101 |
| R14 | PASS | hevc | 1920x1080 | -90° | 30.017 | 11.8 s | 14.4 MiB | bt709 | aac | 0.9879 |
| R15 | PASS | h264 | 1920x1080 | -90° | 60.042 | 4.4 s | 14.8 MiB | bt709 | aac | 0.8607 |

- R09 HDR→SDR: en yakın ref-hable, ΔE00 5.316, kayma 1.049, doygunluk 1.082..1.092, ton 1.356°, kırpma 0.016
- R11 HDR→SDR: en yakın placebo-spline, ΔE00 5.278, kayma 1.123, doygunluk 1.019..1.154, ton 8.447°, kırpma 0

## Gerçek telefon

> Elle yazıldı (üretilmedi): `web/scripts/android/phone-run.mjs` ile adb + CDP üzerinden, kurucunun telefonunda. Tek cihaz, tek tarayıcı; ayrıntı ve kanıt [ADR-032](adr/ADR-032-android-samsung-media.md) (ses) ve [ADR-033](adr/ADR-033-android-stale-kesit-ends.md) (kare kimliği).

| Cihaz | Android | Tarayıcı | Tarih |
|---|---|---|---|
| Samsung Galaxy S23 (SM-S911B) | 16 | Chrome 154.0.8037.57 | 2026-09-30 / 2026-10-02 |
| aynı cihaz | 16 | Samsung Internet 30.0.0.67 | **ölçülmedi** (DevTools soketi kapalı; telefonun ayarı değiştirilmedi) |

Kaydetme penceresi betikte bir yer tutucuyla (OPFS dosyası) geçildi; uygulamanın yazma yolu gerçek. Kalite 1080p. “ADR-032’den önce”: canlı site, eylül sonu. “Canlı, ADR-032”: canlı site 2 Ekim (bu tablonun ADR-033’ten önceki hâli). “Bu dal, ADR-033”: kesit sonu düzeltmesinin yerel derlemesi (`next start` + `adb reverse`), 2 Ekim. Ses kayması ffmpeg ile, dosya baştan okunarak, kaynağın aynı anına karşı (+ = ses geç); tarayıcıların kendi oynatıcısında (telefonda Chrome dahil) de senkron (`player-sync.mjs`). “Kare”: her çıktı karesinin kaynağın doğru karesini gösterip göstermediği (yanlış / beklenen), N–R’de kare numarası barkodundan, A–M’de kaynağın kendi karelerine karşı.

| # | Kaynak, kesit | ADR-032’den önce | Canlı, ADR-032 | Bu dal, ADR-033 |
|---|---|---|---|---|
| A | add1.mp4 (1080×1920 30 fps H.264), 2–10 sn | ✅ 8,021 sn, 240 kare (kaynak sessiz) | ✅ 8,000 sn, 240 kare; kare 0/240 | ✅ aynı; kare 0/240 |
| B | R15 Samsung H.264 60 fps −90°, 0,5–4 sn | ❌ “süre uyuşmadı” | ✅ 3,520 sn, 105 kare, ses 0 ms; kare 0/105 (ilk koşuda **5 bayat**) | ✅ aynı; kare 0/105 |
| C | R14 Samsung HEVC ağır çekim −90°, 1–8 sn | ❌ “süre uyuşmadı” | ✅ 7,019 sn, 210 kare (ton); kare 0/210 (ilk koşuda **10 bayat**) | ✅ aynı; kare 0/210 |
| D | R11 iPhone 12 Pro HEVC HLG −90°, 2–10 sn | ✅ 8,021 sn, 240 kare, **ses +42,67 ms** | ✅ 8,000 sn, 240 kare, ses 0 ms; kare **1/240 bayat** (son) | ✅ aynı; kare 0/240 |
| E–G | 3 dk 1080×1920: hızlı kesim / tam kodlama / iki kesit | ✅ 180,032 / 180,032 / 60,032 sn | ✅ 180,011 / 180,011 / 60,011 sn, 5400 / 5400 / 1800 kare; kare 0 / **12 bayat** (F sonu) / 0 | ✅ aynı; kare 0 / 0 / 0 |
| H–J | R15: tüm dosya / 1,2–2,9 sn / iki kesit | çalıştırılmadı | ✅ 4,416 / 1,707 / 3,605 sn, 132 / 51 / 108 kare, ses 0 ms; kare **6** / 0 / **3 bayat** (kesit sonları; ilk koşuda I **3**) | ✅ aynı; kare 0 / 0 / 0 |
| K–M | R14: tüm dosya / 2,5–5,1 sn / iki kesit | çalıştırılmadı | ✅ 11,819 / 2,603 / 6,507 sn, 354 / 78 / 195 kare (ton); kare **5** / 0 / **3 bayat** (ilk koşuda L **11**) | ✅ aynı; kare 0 / 0 / 0 |
| N–Q | Senkron klibi (flaş + cıvıltı): hızlı kesim / tam kodlama / iki kesit / tümü | — | ✅ ses 0 ms, flaş–cıvıltı 0,08–0,10 ms; barkod 0 / 0 / 0 / **6 bayat** (Q: 354–359 → 353) | ✅ aynı; barkod 0 / 0 / 0 / 0 |
| R | 24 fps senkron klibi, iki kesit (ikincisi klibin sonuna), tam kodlama | — | ✅ 5,419 sn, 162 kare, ses 0 ms; barkod **21/162 bayat** (2. kesitin son 21 karesi → 270) | ✅ aynı; barkod 0/162 |

ADR-032’den önce telefondaki Chrome’un AAC kodlayıcısı sesin önüne 2048 hazırlık karesi koyuyordu: her çıktının sesi 42,7 ms geç, sonu eksikti; uzunluğu 1024 ses karesinin katını az geçen kesitler (30 fps uzunluklarının %37,5’i) “süre uyuşmadı” ile reddediliyordu. Artık gecikme her tarayıcıda ölçülüp dosyada geri alınıyor (ADR-032). Canlı derlemenin ilk telefon koşusunda görülen “−42,67 ms” ölçüm betiğinin hatasıydı (ffmpeg’in `-ss 0` okuması), dosyalar doğruydu.

ADR-033’ten önce telefonda tam kodlanan kesitlerin son 1–21 karesi bayattı (daha önceki bir karenin resmi; kare sayısı ve “eksik kare” sayacı doğru göründüğü için görülmüyordu; sayı koşudan koşuya değişiyordu, “ilk koşu” aynı günün başka bir canlı koşusu). Sebep: çözücü, önceden çözdüğü kareler çizilmeden kapanıyordu; telefondaki Chrome’da karenin resmi o ana kadar çözücünün tamponunda. Çözücü artık kesitin son karesi çizilene kadar açık; kapanmış bir çözücünün karesi eksik sayılıyor. Bu dalda telefonda üç koşuda 18/18 durumun hepsi 0 yanlış kare; masaüstü Chrome ve Edge (açılan durumlarda) önce de sonra da 0.

## Bu matrisin kapsamadıkları

- Gerçek Safari (macOS/iOS), tablet ve “Gerçek telefon” bölümündeki tek cihaz dışında fiziksel telefon; Samsung Internet (ölçülmedi).
- Gerçek kamera/telefon kayıtları, “Gerçek kayıtlar” bölümünde çalıştırılmadıysa.
- Bilinen sınır: yeniden sıralamayı SPS’te az bildiren H.264 akışları (R07) yazılım çözücüsünde kare atıyordu. Artık SPS düzeltilerek çözülüyor. Düzeltilemeyen durumda (paket içi SPS) dışa aktarma açıkça duruyor. Başka bir sebeple kare atan bir çözücü damgalardan hâlâ tespit edilemiyor. Ayrıntı ADR-014 §3.
- HDR (PQ/HLG) kaynaklar ADR-022 ile SDR’ye çevriliyor: tarayıcının dönüşümü + parlak renk yumuşak kırpma, çalışma anında sentetik bir kareyle doğrulanarak. Renkler standart ton eşleme operatörlerinden en yakınına karşı eşiklerle ölçülür (docs/spikes/2026-09-23-hdr-tonemap.md). HDR ekranda önizleme, Safari/Firefox’ta HDR ve AV1 HDR ölçülmedi. Edge ve Playwright Chromium’da bu makinede HEVC çözücüsü yok.
- Bellek ölçümü yalnızca Windows’ta ve Chromium’da yapıldı; macOS/Linux ve diğer tarayıcılar ölçülmedi.
- Düşük bellekli cihazlar ve bellek yetmediğinde davranış.
- Gerçekten dolu bir disk: yer ayırma ve yazma sırasında dolan disk yalnızca tarayıcının kota kısıtıyla (CDP) sınandı, ADR-023. Uzun süreli kararlılık ve termal davranış.
- Ekran okuyucu ve erişilebilirlik denetimi.

## Yeniden üretmek için

```bash
cd web
node scripts/generate-matrix-media.mjs
npm run build && npx next start -p 3100   # ayrı bir kabukta
node scripts/run-matrix.mjs --browser=chromium
node scripts/build-support-matrix.mjs
```

