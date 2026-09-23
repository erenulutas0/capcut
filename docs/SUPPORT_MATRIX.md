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
| Chromium (Playwright) | 153.0.8010.12 | H.264 var · AAC var | 2026-09-23 11:34 UTC |
| Google Chrome | 153.0.0.0 | H.264 var · AAC var | 2026-09-23 11:37 UTC |
| Microsoft Edge | 153.0.0.0 | H.264 var · AAC var | 2026-09-23 11:41 UTC |
| Firefox (Playwright) | 155.0 | H.264 var · AAC yok | 2026-09-21 18:36 UTC |
| WebKit (Playwright) | 26.6 | WebCodecs yok | 2026-09-21 18:36 UTC |

Hepsi win32 x64 üzerinde, headless olarak çalıştırıldı. **Gerçek Safari, gerçek telefon ve fiziksel cihaz testi yapılmadı.** Playwright’ın WebKit derlemesi Safari değildir ve Safari sonucu yerine geçmez.

## Sonuçlar

| # | Durum | Chromium | Chrome | Edge | Firefox | WebKit |
|---|---|---|---|---|---|---|
| M01 | 20 s dikey H.264/SDR + iki aralık | ✅ | ✅ | ✅ | ⛔ | — |
| M02 | 90° rotation metadata | ✅ | ✅ | ✅ | ⛔ | — |
| M03 | Yatay kaynak → 9:16 crop | ✅ | ✅ | ✅ | ⛔ | — |
| M04 | Sessiz video + WAV müzik | ✅ | ✅ | ✅ | ⛔ | — |
| M05 | 44.1 kHz müzik + 48 kHz kaynak | ✅ | ✅ | ✅ | ⛔ | — |
| M06 | VFR kaynak | ✅ | ✅ | ✅ | ⛔ | — |
| M07 | 29.97 fps kaynak | ✅ | ✅ | ✅ | ⛔ | — |
| M08 | Müzik 5–15 s, timeline başlangıcı 2 s | ✅ | ✅ | ✅ | ⛔ | — |
| M09 | Klip sınırında ses | ✅ | ✅ | ✅ | ⛔ | — |
| M10-hevc | 4K HEVC kaynağı | ✅ | ✅ | ✅ | ✅ | — |
| M10-hdr | HDR (bt2020 / PQ, 10-bit) kaynağı | ✅ | ✅ | ✅ | ✅ | — |
| M10-hdr-hlg | HDR (bt2020 / HLG, 10-bit) kaynağı, 90° döndürmeli | ✅ | ✅ | ✅ | — | — |
| M11 | Bozuk/truncated MP4 | ✅ | ✅ | ✅ | ✅ | — |
| M12 | Çok kısa ve maksimum 20 klip | ✅ | ✅ | ✅ | ⛔ | — |
| M13 | Politika sınırını aşan büyük dosya | ✅ | ✅ | ✅ | ✅ | — |
| M14 | Kaynağa erişim kaybı ve yeniden bağlama | ✅ | ✅ | ✅ | ⛔ | — |
| M15 | Export sırasında sekme arka plana alınıyor | ✅ | ✅ | ✅ | ⛔ | — |
| M16 | Gain toplamı / fade sınırları | ✅ | ✅ | ✅ | ⛔ | — |
| M17 | Altyazı videoya işleniyor | ✅ | ✅ | ✅ | ⛔ | — |
| M18 | Görüntüye bağlı altyazı anlarla taşınıyor | ✅ | ✅ | ✅ | ⛔ | — |
| M18b | Kaynak → sonuç dönüşümü görünen altyazıyı değiştirmiyor | ✅ | ✅ | ✅ | ⛔ | — |

| Toplam | | 21✅ 0⛔ 0❌ 0💥 0— | 21✅ 0⛔ 0❌ 0💥 0— | 21✅ 0⛔ 0❌ 0💥 0— | 4✅ 16⛔ 0❌ 0💥 0— | 0✅ 0⛔ 0❌ 0💥 20— |

## Ölçülen değerler (Chromium)

| # | Süre | Kare | Çözünürlük | SSIM | Diğer ölçümler |
|---|---|---|---|---|---|
| M01 | 10.005333 s | 300 | 720x1280 | 0.9409 | an sesleri -22.1 / -22.1 dB |
| M02 | 5.013333 s | 150 | 720x1280 | 0.9413 | — |
| M03 | 5.013333 s | 150 | 720x1280 | 0.922 | — |
| M04 | 6.016 s | 180 | 1280x720 | — | 440 Hz -56.3 / 330 Hz -36.1 dB |
| M05 | 5.013333 s | 150 | 720x1280 | — | perde -36.1 / -55.4 dB |
| M06 | 6.016 s | 180 | 1280x720 | — | — |
| M07 | 10.005333 s | 300 | 1280x720 | — | — |
| M08 | 10.005333 s | 300 | 720x1280 | — | müzik önce -69.5 → sonra -36.1 dB |
| M09 | 6.016 s | 180 | 1280x720 | — | sınır -24.4 / genel -24.1 dB |
| M10-hevc | — | — | — | — | sonuç: import_rejected |
| M10-hdr | 3.008 s | 90 | 1280x720 | 0.9699 | HDR→SDR: en yakın ref-hable, ΔE00 3.074, kayma 3.619, doygunluk 1.004..1.005, ton 1.953°, kırpma -0.047 |
| M10-hdr-hlg | 3.008 s | 90 | 720x1280 | 0.9729 | HDR→SDR: en yakın placebo-spline, ΔE00 3.258, kayma 2.245, doygunluk 1.038..1.038, ton 2.345°, kırpma -0.001 |
| M12 | 4.010667 s | 120 | 1280x720 | — | — |
| M14 | 10.005333 s | 300 | 720x1280 | — | — |
| M15 | 6.016 s | 180 | 1280x720 | — | — |
| M16 | 6.016 s | 180 | 1280x720 | — | tepe -19.8 dB; fade -43 → -28.2 dB |
| M17 | 10.005333 s | 300 | 720x1280 | — | — |
| M18 | 12.010667 s | 360 | 720x1280 | — | — |
| M18b | 12.010667 s | 360 | 720x1280 | — | — |

## Matris çalıştırılamayan ortamlar

- **WebKit (Playwright):** Bu tarayıcı temel H.264 fixture'ını açamıyor, dolayısıyla matris burada çalıştırılamaz. Uygulamanın mesajı: "Bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu formatı oynatmıyor.".

## Uzun çıktı: süre, hız ve bellek

Ortam: chromium, kalıcı (disk destekli) profil, yoğun 1080p kaynak, 1080p çıktı. Tarayıcı süreç ağacının (ana süreç + renderer + GPU + yardımcılar) private bytes değeri işletim sisteminden ~400 ms aralıkla örneklendi. Encode worker renderer sürecinin içinde çalışır.

| Çıktı | Dosya | Kare | Süren işlem | Bellek yolu: tepe (artış) | OPFS yolu: tepe (artış) |
|---|---|---|---|---|---|
| 30 s | 19.9 MiB (5.44 Mbit/s) | 900 | 9.0 s | 597 MiB (+366) | 579 MiB (+354) |
| 60 s | 39.9 MiB (5.44 Mbit/s) | 1800 | 18.5 s | 605 MiB (+370) | 592 MiB (+351) |
| 120 s | 79.7 MiB (5.44 Mbit/s) | 3600 | 36.7 s | 659 MiB (+424) | 597 MiB (+366) |
| 180 s | 119.5 MiB (5.44 Mbit/s) | 5400 | 46.3 s | 706 MiB (+464) | 613 MiB (+375) |
| 300 s | 199.2 MiB (5.44 Mbit/s) | 9000 | 84.4 s | 1007 MiB (+754) | 630 MiB (+370) |

Bellek yolunda artış çıktı boyutuyla doğrusal büyür (çıktı hem muxer’da hem sayfadaki Blob’da tutulur). OPFS yolunda çıktı tarayıcının özel diskine akar ve artış uzunluktan bağımsız kalır. Uyarı: gizli pencerede Chromium OPFS’i RAM’de tutar; orada bu kazanç yoktur.

## Gerçek kayıtlar

### Chromium (Playwright) — 11 PASS, 4 REFUSED, 0 FAIL, 0 ERROR (2026-09-23 11:43 UTC)

| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | PASS | h264 | 854x480 | 0° | 24 | 1957.4 s | 257.7 MiB | — | aac | 0.9871 |
| R02 | PASS | h264 | 592x1280 | 0° | 40.588 (VFR?) | 29.5 s | 3.9 MiB | — | aac | 0.9872 |
| R03 | PASS | h264 | 720x1280 | 0° | 30.004 | 22.8 s | 2.8 MiB | — | aac | 0.9866 |
| R04 | PASS | h264 | 480x724 | 0° | 29.934 | 45.1 s | 1.7 MiB | — | aac | 0.9772 |
| R05 | PASS | h264 | 1080x1920 | 0° | 30 | 14.2 s | 1.3 MiB | bt709 | aac | 0.9967 |
| R06 | PASS | h264 | 1280x720 | 0° | 24.334 (VFR?) | 16.9 s | 21.7 MiB | bt709 | aac | 0.9285 |
| R07 | PASS | h264 | 1280x720 | 0° | 59.94 | 16.5 s | 24.1 MiB | — | aac | 0.9698 |
| R08 | PASS | h264 | 224x128 | 0° | 15 | 34.4 s | 0.7 MiB | bt709 | aac | 0.9867 |
| R09 | REFUSED | hevc | 3840x2160 | 0° | 29.024 | 1.1 s | 6.8 MiB | smpte2084 | aac | — |
| R10 | PASS | h264 | 1920x1080 | 0° | 29.974 | 341.2 s | 618.3 MiB | bt709 | aac | 0.9635 |
| R11 | REFUSED | hevc | 1920x1080 | -90° | 56.536 (VFR?) | 21.7 s | 33.3 MiB | arib-std-b67 | aac | — |
| R12 | PASS | h264 | 1920x1080 | -180° | 59.93 | 88.7 s | 249 MiB | bt709 | aac | 0.9633 |
| R13 | REFUSED | hevc | 3840x2160 | -90° | 29.83 | 10.4 s | 53.8 MiB | bt709 | aac | — |
| R14 | REFUSED | hevc | 1920x1080 | -90° | 30.017 | 11.8 s | 14.4 MiB | bt709 | aac | — |
| R15 | PASS | h264 | 1920x1080 | -90° | 60.042 | 4.4 s | 14.8 MiB | bt709 | aac | 0.8702 |

### Google Chrome — 15 PASS, 0 REFUSED, 0 FAIL, 0 ERROR (2026-09-23 11:49 UTC)

| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | PASS | h264 | 854x480 | 0° | 24 | 1957.4 s | 257.7 MiB | — | aac | 0.9898 |
| R02 | PASS | h264 | 592x1280 | 0° | 40.588 (VFR?) | 29.5 s | 3.9 MiB | — | aac | 0.9896 |
| R03 | PASS | h264 | 720x1280 | 0° | 30.004 | 22.8 s | 2.8 MiB | — | aac | 0.9934 |
| R04 | PASS | h264 | 480x724 | 0° | 29.934 | 45.1 s | 1.7 MiB | — | aac | 0.9806 |
| R05 | PASS | h264 | 1080x1920 | 0° | 30 | 14.2 s | 1.3 MiB | bt709 | aac | 0.9982 |
| R06 | PASS | h264 | 1280x720 | 0° | 24.334 (VFR?) | 16.9 s | 21.7 MiB | bt709 | aac | 0.9374 |
| R07 | PASS | h264 | 1280x720 | 0° | 59.94 | 16.5 s | 24.1 MiB | — | aac | 0.9743 |
| R08 | PASS | h264 | 224x128 | 0° | 15 | 34.4 s | 0.7 MiB | bt709 | aac | 0.9909 |
| R09 | PASS | hevc | 3840x2160 | 0° | 29.024 | 1.1 s | 6.8 MiB | smpte2084 | aac | 0.9347 |
| R10 | PASS | h264 | 1920x1080 | 0° | 29.974 | 341.2 s | 618.3 MiB | bt709 | aac | 0.9446 |
| R11 | PASS | hevc | 1920x1080 | -90° | 56.536 (VFR?) | 21.7 s | 33.3 MiB | arib-std-b67 | aac | 0.9473 |
| R12 | PASS | h264 | 1920x1080 | -180° | 59.93 | 88.7 s | 249 MiB | bt709 | aac | 0.9571 |
| R13 | PASS | hevc | 3840x2160 | -90° | 29.83 | 10.4 s | 53.8 MiB | bt709 | aac | 0.9101 |
| R14 | PASS | hevc | 1920x1080 | -90° | 30.017 | 11.8 s | 14.4 MiB | bt709 | aac | 0.9879 |
| R15 | PASS | h264 | 1920x1080 | -90° | 60.042 | 4.4 s | 14.8 MiB | bt709 | aac | 0.8607 |

- R09 HDR→SDR: en yakın ref-hable, ΔE00 5.316, kayma 1.049, doygunluk 1.082..1.092, ton 1.356°, kırpma 0.016
- R11 HDR→SDR: en yakın placebo-spline, ΔE00 5.287, kayma 1.103, doygunluk 1.019..1.154, ton 8.443°, kırpma 0

### Microsoft Edge — 11 PASS, 4 REFUSED, 0 FAIL, 0 ERROR (2026-09-23 11:52 UTC)

| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | PASS | h264 | 854x480 | 0° | 24 | 1957.4 s | 257.7 MiB | — | aac | 0.9898 |
| R02 | PASS | h264 | 592x1280 | 0° | 40.588 (VFR?) | 29.5 s | 3.9 MiB | — | aac | 0.9896 |
| R03 | PASS | h264 | 720x1280 | 0° | 30.004 | 22.8 s | 2.8 MiB | — | aac | 0.9934 |
| R04 | PASS | h264 | 480x724 | 0° | 29.934 | 45.1 s | 1.7 MiB | — | aac | 0.9806 |
| R05 | PASS | h264 | 1080x1920 | 0° | 30 | 14.2 s | 1.3 MiB | bt709 | aac | 0.9982 |
| R06 | PASS | h264 | 1280x720 | 0° | 24.334 (VFR?) | 16.9 s | 21.7 MiB | bt709 | aac | 0.9374 |
| R07 | PASS | h264 | 1280x720 | 0° | 59.94 | 16.5 s | 24.1 MiB | — | aac | 0.9743 |
| R08 | PASS | h264 | 224x128 | 0° | 15 | 34.4 s | 0.7 MiB | bt709 | aac | 0.9909 |
| R09 | REFUSED | hevc | 3840x2160 | 0° | 29.024 | 1.1 s | 6.8 MiB | smpte2084 | aac | — |
| R10 | PASS | h264 | 1920x1080 | 0° | 29.974 | 341.2 s | 618.3 MiB | bt709 | aac | 0.9446 |
| R11 | REFUSED | hevc | 1920x1080 | -90° | 56.536 (VFR?) | 21.7 s | 33.3 MiB | arib-std-b67 | aac | — |
| R12 | PASS | h264 | 1920x1080 | -180° | 59.93 | 88.7 s | 249 MiB | bt709 | aac | 0.9571 |
| R13 | REFUSED | hevc | 3840x2160 | -90° | 29.83 | 10.4 s | 53.8 MiB | bt709 | aac | — |
| R14 | REFUSED | hevc | 1920x1080 | -90° | 30.017 | 11.8 s | 14.4 MiB | bt709 | aac | — |
| R15 | PASS | h264 | 1920x1080 | -90° | 60.042 | 4.4 s | 14.8 MiB | bt709 | aac | 0.8607 |

## Bu matrisin kapsamadıkları

- Gerçek Safari (macOS/iOS) ve gerçek fiziksel telefon/tablet.
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

