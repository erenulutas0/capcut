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
| Chromium (Playwright) | 153.0.8010.12 | H.264 var · AAC var | 2026-09-21 00:09 UTC |
| Google Chrome | 153.0.0.0 | H.264 var · AAC var | 2026-09-21 00:09 UTC |
| Microsoft Edge | 153.0.0.0 | H.264 var · AAC var | 2026-09-21 00:10 UTC |
| Firefox (Playwright) | 155.0 | H.264 var · AAC yok | 2026-09-21 00:11 UTC |
| WebKit (Playwright) | 26.6 | WebCodecs yok | 2026-09-21 00:11 UTC |

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

## Uzun çıktı ölçümleri

Ortam: chromium, 2026-09-20 23:41 UTC.

| İstenen | Ölçülen süre | Kare | Dosya | Süren işlem | Gerçek zamana oran |
|---|---|---|---|---|---|
| 10 s | 10.005 s | 300 | 0.3 MB | 3.0 s | 3.3× |
| 30 s | 30.016 s | 900 | 0.7 MB | 7.2 s | 4.2× |
| 60 s | 60.011 s | 1800 | 1.5 MB | 12.9 s | 4.6× |
| 120 s | 120 s | 3600 | 2.9 MB | 24.0 s | 5.0× |
| 180 s | 180.011 s | 5400 | 4.4 MB | 37.0 s | 4.9× |

> Çıktı bellekte tutuluyor (BufferTarget + fastStart in-memory). UYARI: Chromium performance.memory değeri gizlilik için kabaca yuvarlanır; bütün koşularda aynı değeri verdiği için bu ölçümden bellek tavanı çıkarılamaz. Ayrıca fixture sentetik bir test deseni olduğu için encoder hedef bitrate’in çok altında kalıyor; gerçek kamera görüntüsünde dosya boyutu ve dolayısıyla bellek kullanımı belirgin şekilde yüksek olur.

## Bu matrisin kapsamadıkları

- Gerçek Safari (macOS/iOS) ve gerçek fiziksel telefon/tablet.
- Gerçek kamera/telefon kayıtları; bütün fixture’lar ffmpeg ile üretilmiş sentetik dosyalardır.
- Gerçek görüntüyle uzun çıktıda bellek tavanı: ölçülemedi (aşağıdaki nota bakın). Çıktı süresi politika gereği 5 dakika ile sınırlıdır.
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

