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
| Chromium (Playwright) | 153.0.8010.12 | H.264 var · AAC var | 2026-09-21 13:45 UTC |
| Google Chrome | 153.0.0.0 | H.264 var · AAC var | 2026-09-21 13:45 UTC |
| Microsoft Edge | 153.0.0.0 | H.264 var · AAC var | 2026-09-21 13:46 UTC |
| Firefox (Playwright) | 155.0 | H.264 var · AAC yok | 2026-09-21 13:47 UTC |
| WebKit (Playwright) | 26.6 | WebCodecs yok | 2026-09-21 13:47 UTC |

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
| M10-hdr | HDR (bt2020 / PQ) kaynağı | ✅ | ✅ | ✅ | ✅ | — |
| M11 | Bozuk/truncated MP4 | ✅ | ✅ | ✅ | ✅ | — |
| M12 | Çok kısa ve maksimum 20 klip | ✅ | ✅ | ✅ | ⛔ | — |
| M13 | Politika sınırını aşan büyük dosya | ✅ | ✅ | ✅ | ✅ | — |
| M14 | Kaynağa erişim kaybı ve yeniden bağlama | ✅ | ✅ | ✅ | ⛔ | — |
| M15 | Export sırasında sekme arka plana alınıyor | ✅ | ✅ | ✅ | ⛔ | — |
| M16 | Gain toplamı / fade sınırları | ✅ | ✅ | ✅ | ⛔ | — |

| Toplam | | 17✅ 0⛔ 0❌ 0💥 0— | 17✅ 0⛔ 0❌ 0💥 0— | 17✅ 0⛔ 0❌ 0💥 0— | 4✅ 13⛔ 0❌ 0💥 0— | 0✅ 0⛔ 0❌ 0💥 17— |

## Ölçülen değerler (Chromium)

| # | Süre | Kare | Çözünürlük | SSIM | Diğer ölçümler |
|---|---|---|---|---|---|
| M01 | 10.005333 s | 300 | 720x1280 | 0.9416 | an sesleri -22.1 / -22.1 dB |
| M02 | 5.013333 s | 150 | 720x1280 | 0.9409 | — |
| M03 | 5.013333 s | 150 | 720x1280 | 0.922 | — |
| M04 | 6.016 s | 180 | 1280x720 | — | 440 Hz -56.3 / 330 Hz -36.1 dB |
| M05 | 5.013333 s | 150 | 720x1280 | — | perde -36.1 / -55.4 dB |
| M06 | 6.016 s | 180 | 1280x720 | — | — |
| M07 | 10.005333 s | 300 | 1280x720 | — | — |
| M08 | 10.005333 s | 300 | 720x1280 | — | müzik önce -69.5 → sonra -36.1 dB |
| M09 | 6.016 s | 180 | 1280x720 | — | sınır -24.4 / genel -24.1 dB |
| M10-hevc | — | — | — | — | sonuç: import_rejected |
| M12 | 4.010667 s | 120 | 1280x720 | — | — |
| M14 | 10.005333 s | 300 | 720x1280 | — | — |
| M15 | 6.016 s | 180 | 1280x720 | — | — |
| M16 | 6.016 s | 180 | 1280x720 | — | tepe -19.8 dB; fade -43 → -28.2 dB |

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

### Chromium (Playwright) — 1 PASS, 0 REFUSED, 0 FAIL, 0 ERROR (2026-09-21 13:47 UTC)

| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | PASS | h264 | 854x480 | 0° | 24 | 1957.4 s | 257.7 MiB | — | aac | 0.9279 |

### Google Chrome — 1 PASS, 0 REFUSED, 0 FAIL, 0 ERROR (2026-09-21 13:48 UTC)

| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | PASS | h264 | 854x480 | 0° | 24 | 1957.4 s | 257.7 MiB | — | aac | 0.9395 |

### Microsoft Edge — 1 PASS, 0 REFUSED, 0 FAIL, 0 ERROR (2026-09-21 13:48 UTC)

| # | Durum | Codec | Boyut | Rotasyon | fps | Süre | Dosya | Renk | Ses | SSIM |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | PASS | h264 | 854x480 | 0° | 24 | 1957.4 s | 257.7 MiB | — | aac | 0.9395 |

## Bu matrisin kapsamadıkları

- Gerçek Safari (macOS/iOS) ve gerçek fiziksel telefon/tablet.
- Gerçek kamera/telefon kayıtları, “Gerçek kayıtlar” bölümünde çalıştırılmadıysa.
- Bellek ölçümü yalnızca Windows’ta ve Chromium’da yapıldı; macOS/Linux ve diğer tarayıcılar ölçülmedi.
- Düşük bellekli cihazlar ve bellek yetmediğinde davranış.
- Disk dolması, uzun süreli kararlılık ve termal davranış.
- Ekran okuyucu ve erişilebilirlik denetimi.

## Yeniden üretmek için

```bash
cd web
node scripts/generate-matrix-media.mjs
npm run build && npx next start -p 3100   # ayrı bir kabukta
node scripts/run-matrix.mjs --browser=chromium
node scripts/build-support-matrix.mjs
```

