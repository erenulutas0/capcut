# Uygunluk denemesi — cihaz üstü (tarayıcıda) otomatik transkript

> Tarih: 2026-09-21 · Bağlam: ADR-017 "uygulamadan önce, ücretsiz" denemesi · Bütçe: 0 TL
> Sonuç: bu belgenin sonundaki **Karar önerisi** bölümü. Sayılar aşağıda; hiçbiri tahmin değildir,
> hepsi `web/spike-results/asr-2026-09-21-*.json` dosyalarındaki ham çıktılardan üretilmiştir
> (`node web/spike/asr/summarize.mjs --tag=2026-09-21`).

## Ne ölçüldü, ne ölçülmedi (kısa)

| Ölçüm | Durum |
|---|---|
| Model indirme boyutu (tam dosya listesi, sha256) | ölçüldü |
| Yükleme süresi, soğuk (Cache API boş) / sıcak (Cache API dolu) | ölçüldü, **yerel aynadan** (ağ süresi hariç; bkz. Yöntem) |
| WER / CER, Türkçe ve İngilizce, temiz | ölçüldü (12 TR + 6 EN FLEURS klibi) |
| WER gürültülü | ölçüldü (4 sentetik karışım) |
| Negatif kliplerde uydurma metin | ölçüldü (3 klip: dijital sessizlik, oda tonu, yalnız müzik) |
| Hız (gerçek zamana oran, RTF) | ölçüldü |
| Tepe bellek (işletim sisteminden, tüm tarayıcı süreç ağacı) | ölçüldü |
| WebGPU / WASM × Chromium / Chrome / Edge / Firefox | ölçüldü; Firefox/WebGPU yalnızca tiny ile (base/small orada ~17× yavaş olacağı için atlandı), Firefox/WASM üç modelle |
| Web Worker içinde çalışma | evet, tüm ölçümler Worker'da |
| **Kelime zaman sapması (p95) referans kelime zamanlarına karşı** | **ÖLÇÜLMEDİ** — FLEURS kelime zamanı vermez. Yerine ffmpeg `silencedetect` sınırlarına karşı bir *vekil* ölçüm var (aşağıda). |
| Türkçe/İngilizce geçişli konuşma | ÖLÇÜLMEDİ — hakları temiz, girişsiz bir korpus bulunamadı |
| Çok konuşmacılı kayıt | ÖLÇÜLMEDİ |
| Kurucunun kendi sesi | ÖLÇÜLMEDİ (bu oturumda kayıt yok; ADR-017'deki istek açık kalıyor) |
| whisper-large-v3-turbo | ÖLÇÜLMEDİ — en küçük tarayıcı varyantı (q4f16) 537 MB, ADR-017'nin ~40–250 MB aralığının dışında |
| Ağdan gerçek indirme süresi | ölçülmedi (yalnızca Node ile aynalarken görülen ~10–12 MB/s kaydedildi) |

## Ortam

- Makine: Windows 11 Pro 10.0.26200, Intel Core i5-12500 (12 mantıksal çekirdek), 64 GB RAM,
  NVIDIA GeForce RTX 3070 Ti (sürücü 32.0.16.1088). Dizüstü değil; ADR-017'nin "dizüstü CPU'da
  WASM 1–5×" öngörüsü burada **doğrulanmadı**, WASM sayıları bu masaüstü CPU içindir.
- Node 20.18.0, ffmpeg 9.0.1, Playwright 1.63.0 (Chromium 153.0.8010.12 derlemesi, Firefox
  155.0 derlemesi), sistem Chrome 153.0.8010.52, Edge 153.0.4234.48 (sistem Firefox 143
  Playwright ile sürülemediği için kullanılmadı).
- Kütüphane: `@huggingface/transformers` 4.3.0 (Apache-2.0), içine gömülü `onnxruntime-web`
  1.31.0-dev.20260914. Sayfa COOP/COEP ile `crossOriginIsolated` (çok iş parçacıklı WASM).
- Tarayıcılar başlıklı (headed) açıldı; WebGPU adaptörü her koşuda doğrulandı (yazılım
  fallback'i değil). Aşağıdaki Ortam tablosu koşulardan gelir.

#### Ortam (koşulardan)

| Tarayıcı | Sürüm | WebGPU | Adaptör | shader-f16 | crossOriginIsolated | Worker |
|---|---|---|---|---|---|---|
| chromium | 153.0.8010.12 | evet | nvidia / ampere | true | true | evet |
| chrome | 153.0.8010.52 | evet | nvidia / ampere | true | true | evet |
| msedge | 153.0.4234.48 | evet | nvidia / ampere | true | true | evet |
| firefox | 155.0 | evet | (boş) / (boş) | true | true | evet |

Not: Firefox satırı Playwright'in kendi Firefox derlemesidir (155.0, sistemdeki Firefox 143 sürülmedi). WebGPU adaptör kimliğini Firefox açıklamaz; Firefox/WebGPU yalnızca tiny ile ölçüldü (aşağıda).

## Veri seti ve hakları

`web/tests/media/speech/SOURCES.md` (gitignore'lu klasörle birlikte; `node web/spike/asr/prepare-speech.mjs` yeniden üretir).

- **Google FLEURS** — Hugging Face `google/fleurs`, revizyon `70bb2e84…`, **girişsiz (ungated)**,
  lisans **CC-BY-4.0**. Test bölümünün ses arşivleri 290–464 MB olduğundan yalnızca arşivin
  **ilk 26 MB'ı (tr_tr) ve 16 MB'ı (en_us)** HTTP Range ile alındı; gzip akışı sıralı açıldığı
  için ilk 42 + 36 WAV eksiksiz çıktı. Referans metinler bölümün `test.tsv` dosyasından.
  Seçim: her cümleden tek konuşmacı, 4–20 s, sayı/özel isim içerenler öne alındı.
- 12 temiz Türkçe (`tr-01…12`), 6 temiz İngilizce (`en-01…06`); 16 kHz mono, 16-bit PCM'e
  yeniden kodlandı. Not: `en-01` ve `en-05` FLEURS'ün kendisinde çok sessiz kayıtlar (tepe
  −42 / −47 dBFS); olduğu gibi bırakıldı (gerçek kullanıcı kaydı da böyle olabilir).
- 4 gürültülü (`noisy-01…04`): temiz kliplere ffmpeg ile pembe gürültü (SNR 10 / 5 dB) ya da
  sentetik akor müziği (SNR 5 / 10 dB) karıştırıldı; SNR klip geneli ortalama seviyeden,
  karışım öncesi 6 dB pay bırakıldı (kırpma yok).
- 3 negatif (`neg-01…03`): 15 s dijital sessizlik, 15 s −55 dBFS pembe "oda tonu", 15 s yalnız
  sentetik müzik. Doğru çıktı: boş.
- Kullanılmayan: Common Voice (giriş/şart kabulü arkasında), LibriSpeech (FLEURS İngilizce
  yeterli oldu), geçişli/çok konuşmacılı kayıt (bulunamadı).
- Kullanıcı medyası yok; `web/tests/media/real/` dokunulmadı; hiçbir ses makineden çıkmadı
  (model dosyaları yerel aynadan, sayfa `127.0.0.1:3103`).

## Modeller (tam kimlik)

Hepsi Hugging Face'te girişsiz, Apache-2.0 (openai/whisper ağırlıkları, Transformers.js
ekibinin ONNX dışa aktarımı). `web/spike/asr/models/manifest.json` her dosyanın byte ve sha256
değerini tutar (LFS oid ile doğrulandı).

| Anahtar | Repo | Revizyon | Param | WebGPU dosyaları (dtype) | WASM dosyaları (dtype) |
|---|---|---|---|---|---|
| tiny | `onnx-community/whisper-tiny_timestamped` | `51724429…` | 39M | encoder fp32 31.4 MB + decoder_merged q4 82.8 MB = **114 MB** | encoder q8 9.6 MB + decoder q8 29.3 MB = **39 MB** |
| base | `onnx-community/whisper-base_timestamped` | `608c49e6…` | 74M | fp32 78.6 + q4 118.0 = **197 MB** | q8 22.1 + q8 51.2 = **73 MB** |
| small | `onnx-community/whisper-small_timestamped` | `65caa70f…` | 244M | fp32 336.4 + q4 222.6 = **559 MB** | q8 88.0 + q8 149.5 = **238 MB** |

Artı ~2.9 MB yapılandırma/tokenizer dosyası. Dtype seçimi: WASM'de Transformers.js varsayılanı
q8; WebGPU'da resmî whisper-webgpu örneğinin kullandığı fp32 encoder + q4 decoder (tamsayı
nicemlenmiş operatörler WebGPU'da çalışmaz). İki cihazın WER'i bu yüzden birebir aynı ağırlık
değildir; tablo ikisini ayrı gösterir.

**Neden `_timestamped`:** düz `onnx-community/whisper-tiny/base/small` dışa aktarımları
decoder'dan çapraz-dikkat çıktısı vermez; `return_timestamps: 'word'` istenince Transformers.js
"Model outputs must contain cross attentions to extract timestamps" hatası verir (bu oturumda
doğrulandı). Kelime zamanı ADR-017'nin özü olduğu için ölçülen adaylar `_timestamped`
sürümlerdir. Bedeli: aynı ağırlıkla RTF yaklaşık 2× (tiny/WebGPU'da 0.05 → 0.10).

## Yöntem

- Harness: `web/spike/asr/` (kendi `package.json`'ı var; ana uygulamaya bağımlılık eklenmedi,
  `web/src` değişmedi). `index.html` + `bench.js` sayfa; `worker.js` → `engine.js` Web Worker
  içinde `pipeline('automatic-speech-recognition')`. `run-asr.mjs` Playwright ile üç Chromium
  tabanlı tarayıcı ve Firefox'u sürer; `serve.mjs` 3103 portunda COOP/COEP ile statik sunar;
  model dosyaları `models/` aynasından `{model}/resolve/{revision}/` düzeniyle gelir.
- Soğuk yükleme = Cache API temizlenmiş + yeni Worker; sıcak = aynı context, yeni Worker.
  Yerel aynadan olduğu için **ağ süresi dahil değil**; gerçek ilk indirme kullanıcının hattına
  bağlıdır (boyutlar yukarıda).
- WER/CER: kendi Levenshtein'ımız (`metrics.mjs`). Aynı normalizasyon hipotez ve referansa:
  NFC, Türkçe için `toLocaleLowerCase('tr')` (İ→i, I→ı), noktalama ve tire → boşluk, kelime
  içi kesme işareti korunur. Sayı biçimi normalize **edilmez** ("40.000'in" ↔ "kırk binin",
  "15 August" ↔ "August 15" hata sayılır); bu WER'i olduğundan kötü gösterir, örnekler aşağıda.
- Uydurma: negatif klipte boşluk/noktalama dışında herhangi bir karakter = o koşu için başarısız.
- RTF = işlem süresi / ses süresi (WAV çözme dahil değil, `pipeline` çağrısı).
- Bellek: `web/scripts/lib/process-memory.ps1` 400 ms'de bir tüm tarayıcı süreç ağacının özel
  baytlarını örnekler; "taban" model yüklenmeden önceki 2 s, "tepe" klipler işlenirken.
- Zaman vekili: klip peak'e göre normalize edilip `silencedetect=-35dB:0.2s` çalıştırıldı;
  öndeki sessizliğin bitişi ile ilk kelimenin başlangıcı ("başlangıç"), 250 ms'den uzun iç
  duraklamaların bitişi ile en yakın kelime başlangıcı ("duraklama") arasındaki fark. Bu,
  kelime zaman doğruluğunun **yerine geçmez**; yalnızca zamanların kabaca doğru yerde olup
  olmadığını gösterir.

## Sonuçlar

#### Ana tablo (model × cihaz × tarayıcı)

WER sütunları: ham değer; parantez içinde klip başına %100 ile kesilmiş değer ve tekrar döngüsüne giren klip sayısı (yalnızca döngü varsa). Bellek: tarayıcı süreç ağacının özel baytları, model yüklenmeden önceki taban → klipler işlenirken tepe. Zaman vekili: referans kelime zamanı **yoktur**; ffmpeg sessizlik sınırlarına uzaklık (p50 / p95).

| Model | Cihaz | Tarayıcı | Ağırlık | Yükleme soğuk / sıcak | WER TR temiz | WER EN temiz | CER TR / EN | WER gürültülü | RTF ort. / en kötü | Bellek taban → tepe | Negatif uydurma | Zaman vekili duraklama p50 / p95 | Durum |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tiny | webgpu | chromium | 114 MB | 2.2 s / 1.2 s | 50.7% | 18.6% | 15.1% / 10.0% | 62.1% | 0.12 / 0.20 | 371 → 3069 MiB | 2/3 | 274 ms / 1040 ms |  |
| tiny | webgpu | chrome | 114 MB | 2.3 s / 1.3 s | 50.7% | 18.6% | 15.1% / 10.0% | 62.1% | 0.13 / 0.22 | 303 → 2737 MiB | 2/3 | 274 ms / 1040 ms |  |
| tiny | webgpu | msedge | 114 MB | 2.2 s / 1.1 s | 50.7% | 18.6% | 15.1% / 10.0% | 62.1% | 0.12 / 0.25 | 281 → 2981 MiB | 2/3 | 274 ms / 1040 ms |  |
| tiny | webgpu | firefox | 114 MB | 2.1 s / 1.6 s | 50.7% | 18.6% | 15.1% / 10.0% | 62.1% | 1.99 / 3.33 | 638 → 2898 MiB | 2/3 | 274 ms / 1040 ms |  |
| tiny | wasm | chromium | 39 MB | 1.4 s / 0.7 s | 163.2% (63.6%, 2 döngü) | 20.2% | 77.2% / 12.4% | 71.2% | 0.16 / 1.01 | 693 → 1435 MiB | 3/3 | 283 ms / 1158 ms |  |
| tiny | wasm | chrome | 39 MB | 1.6 s / 0.8 s | 163.2% (63.6%, 2 döngü) | 20.2% | 77.2% / 12.4% | 71.2% | 0.17 / 1.03 | 588 → 1468 MiB | 3/3 | 283 ms / 1158 ms |  |
| tiny | wasm | msedge | 39 MB | 1.7 s / 0.9 s | 163.2% (63.6%, 2 döngü) | 20.2% | 77.2% / 12.4% | 71.2% | 0.17 / 1.08 | 559 → 1351 MiB | 3/3 | 283 ms / 1158 ms |  |
| tiny | wasm | firefox | 39 MB | 1.1 s / 1.0 s | 163.2% (63.6%, 2 döngü) | 20.2% | 77.2% / 12.4% | 71.2% | 0.17 / 1.03 | 640 → 1640 MiB | 3/3 | 283 ms / 1158 ms |  |
| base | webgpu | chromium | 197 MB | 2.7 s / 1.6 s | 33.5% | 10.8% | 8.4% / 5.9% | 54.5% | 0.16 / 0.30 | 2828 → 3888 MiB | 3/3 | 129 ms / 978 ms |  |
| base | webgpu | chrome | 197 MB | 2.8 s / 1.8 s | 33.5% | 10.8% | 8.4% / 5.9% | 54.5% | 0.17 / 0.30 | 1549 → 3903 MiB | 3/3 | 129 ms / 978 ms |  |
| base | webgpu | msedge | 197 MB | 2.8 s / 1.7 s | 33.5% | 10.8% | 8.4% / 5.9% | 54.5% | 0.17 / 0.30 | 1513 → 3875 MiB | 3/3 | 129 ms / 978 ms |  |
| base | wasm | chromium | 73 MB | 1.7 s / 1.0 s | 33.5% | 10.8% | 9.0% / 6.7% | 43.9% | 0.20 / 0.40 | 918 → 1618 MiB | 3/3 | 151 ms / 998 ms |  |
| base | wasm | chrome | 73 MB | 1.8 s / 1.0 s | 33.5% | 10.8% | 9.0% / 6.7% | 43.9% | 0.21 / 0.46 | 880 → 1620 MiB | 3/3 | 151 ms / 998 ms |  |
| base | wasm | msedge | 73 MB | 1.8 s / 1.0 s | 33.5% | 10.8% | 9.0% / 6.7% | 43.9% | 0.21 / 0.41 | 837 → 1591 MiB | 3/3 | 151 ms / 998 ms |  |
| base | wasm | firefox | 73 MB | 4.9 s / 1.3 s | 33.5% | 10.8% | 9.0% / 6.7% | 43.9% | 0.21 / 0.41 | 736 → 1545 MiB | 3/3 | 151 ms / 998 ms |  |
| small | webgpu | chromium | 559 MB | 4.9 s / 4.0 s | 22.5% | 7.8% | 5.2% / 4.7% | 34.8% | 0.29 / 0.51 | 1912 → 8619 MiB | 3/3 | 148 ms / 998 ms |  |
| small | webgpu | chrome | 559 MB | 5.1 s / 4.7 s | 22.5% | 7.8% | 5.2% / 4.7% | 34.8% | 0.30 / 0.54 | 2720 → 8624 MiB | 3/3 | 148 ms / 998 ms |  |
| small | webgpu | msedge | 559 MB | 5.0 s / 4.3 s | 22.5% | 7.8% | 5.2% / 4.7% | 34.8% | 0.29 / 0.52 | 1743 → 8715 MiB | 3/3 | 148 ms / 998 ms |  |
| small | wasm | chromium | 237 MB | 3.1 s / 1.6 s | 20.6% | 10.1% | 4.6% / 5.6% | 34.8% | 0.49 / 1.03 | 989 → 2582 MiB | 3/3 | 148 ms / 978 ms |  |
| small | wasm | chrome | 237 MB | 3.8 s / 2.1 s | 20.6% | 10.1% | 4.6% / 5.6% | 34.8% | 0.51 / 1.06 | 1008 → 1959 MiB | 3/3 | 148 ms / 978 ms |  |
| small | wasm | msedge | 237 MB | 4.7 s / 2.1 s | 20.6% | 10.1% | 4.6% / 5.6% | 34.8% | 0.49 / 1.13 | 909 → 1919 MiB | 3/3 | 148 ms / 978 ms |  |
| small | wasm | firefox | 237 MB | 3.5 s / 2.5 s | 20.6% | 10.1% | 4.6% / 5.6% | 34.8% | 0.49 / 1.07 | 683 → 2828 MiB | 3/3 | 148 ms / 978 ms |  |

#### Tarayıcılar arası çıktı farkı

- tiny/webgpu: referans chromium; chrome: 0 klip farklı, msedge: 0 klip farklı, firefox: 0 klip farklı
- tiny/wasm: referans chromium; chrome: 0 klip farklı, msedge: 0 klip farklı, firefox: 0 klip farklı
- base/webgpu: referans chromium; chrome: 0 klip farklı, msedge: 0 klip farklı
- base/wasm: referans chromium; chrome: 0 klip farklı, msedge: 0 klip farklı, firefox: 0 klip farklı
- small/webgpu: referans chromium; chrome: 0 klip farklı, msedge: 0 klip farklı
- small/wasm: referans chromium; chrome: 0 klip farklı, msedge: 0 klip farklı, firefox: 0 klip farklı

#### ADR-017 eşikleri

WER: klip başına %100 ile kesilmiş değer; "en iyi" = o model için en iyi tarayıcı/cihaz koşusu, eşik en iyi koşuya uygulanır (modelin lehine). Zaman: referans kelime zamanı olmadığından yalnızca vekil; eşik kararına **girmez**.

| Model | WER TR temiz (en iyi–en kötü) | ≤ %10? | WER EN temiz (en iyi–en kötü) | ≤ %10? | Negatiflerde uydurma / koşu×klip | Yok mu? | Zaman vekili p95 duraklama (en iyi koşu) | Sonuç |
|---|---|---|---|---|---|---|---|---|
| tiny | 50.7%–63.6% | HAYIR | 18.6%–20.2% | HAYIR | 20/24 | HAYIR | 1040 ms | GEÇMEDİ |
| base | 33.5%–33.5% | HAYIR | 10.8%–10.8% | HAYIR | 21/21 | HAYIR | 978 ms | GEÇMEDİ |
| small | 20.6%–22.5% | HAYIR | 7.8%–10.1% | evet | 21/21 | HAYIR | 978 ms | GEÇMEDİ |

#### Negatif kliplerde üretilen metin (tarayıcılar aynı çıktıyı verdiğinde tek satır)

| Model | Cihaz | Tarayıcı(lar) | neg-01 dijital sessizlik | neg-02 oda tonu | neg-03 yalnız müzik |
|---|---|---|---|---|---|
| tiny | webgpu | chromium, chrome, msedge, firefox | boş | **"Bu videoda"** | **"Bu videoda"** |
| tiny | wasm | chromium, chrome, msedge, firefox | **"Bu dizinin betimlemesi ve gülüyoruz."** | **"Bu videonun bir şey yapayım."** | **"Bu videonun bir şey yapayım."** |
| base | webgpu | chromium, chrome, msedge | **"İnanılmaz."** | **"Çalıştı."** | **"İlk videonunize iyi bakın."** |
| base | wasm | chromium, chrome, msedge, firefox | **"Bu dizinin betimlemesi TRT-8'ne yaptırılmıştır."** | **"Bu dizinin betimlemesi TRT-8'ne yaptırılmıştır."** | **"Bence bu videonunize iyi bakın."** |
| small | webgpu | chromium, chrome, msedge | **"Bir daha."** | **"Abone olmayı unutmayın."** | **"Abone olmayı unutmayın."** |
| small | wasm | chromium, chrome, msedge, firefox | **"Bu videoyu izlediğiniz için teşekkürler."** | **"Abone olmayı unutmayın."** | **"abone olmayı unutmayın"** |

#### Klip bazında WER (Chromium koşuları; diğer tarayıcılar için üstteki fark listesine bakın)

| Klip | s | tiny/webgpu | tiny/wasm | base/webgpu | base/wasm | small/webgpu | small/wasm |
|---|---|---|---|---|---|---|---|
| tr-01 | 10.2 | 71.4% | 78.6% | 64.3% | 57.1% | 57.1% | 50.0% |
| tr-02 | 13.3 | 52.9% | 58.8% | 29.4% | 35.3% | 23.5% | 17.6% |
| tr-03 | 9.5 | 40.0% | 60.0% | 30.0% | 30.0% | 15.0% | 20.0% |
| tr-04 | 19.2 | 88.9% | 61.1% | 33.3% | 33.3% | 22.2% | 22.2% |
| tr-05 | 12.1 | 53.3% | 1473.3% | 40.0% | 26.7% | 20.0% | 6.7% |
| tr-06 | 14.4 | 38.9% | 44.4% | 11.1% | 16.7% | 5.6% | 0.0% |
| tr-07 | 14.2 | 30.0% | 60.0% | 30.0% | 35.0% | 25.0% | 30.0% |
| tr-08 | 12.4 | 64.3% | 71.4% | 64.3% | 57.1% | 42.9% | 42.9% |
| tr-09 | 15.8 | 53.8% | 61.5% | 26.9% | 38.5% | 15.4% | 30.8% |
| tr-10 | 4.2 | 66.7% | 133.3% | 50.0% | 50.0% | 33.3% | 0.0% |
| tr-11 | 13.3 | 45.8% | 66.7% | 29.2% | 16.7% | 12.5% | 4.2% |
| tr-12 | 9.9 | 23.5% | 35.3% | 23.5% | 29.4% | 23.5% | 17.6% |
| en-01 | 9.6 | 3.5% | 3.5% | 3.5% | 3.5% | 3.5% | 3.5% |
| en-02 | 10.1 | 20.0% | 33.3% | 20.0% | 20.0% | 20.0% | 20.0% |
| en-03 | 10.6 | 5.3% | 21.1% | 5.3% | 5.3% | 5.3% | 5.3% |
| en-04 | 11.0 | 39.1% | 26.1% | 17.4% | 21.7% | 13.0% | 13.0% |
| en-05 | 4.8 | 46.7% | 60.0% | 33.3% | 26.7% | 13.3% | 33.3% |
| en-06 | 13.9 | 10.7% | 3.6% | 0.0% | 0.0% | 0.0% | 0.0% |
| noisy-01 | 10.2 | 100.0% | 100.0% | 57.1% | 57.1% | 57.1% | 57.1% |
| noisy-02 | 13.3 | 94.1% | 100.0% | 82.3% | 58.8% | 47.1% | 41.2% |
| noisy-03 | 9.5 | 40.0% | 55.0% | 50.0% | 40.0% | 20.0% | 25.0% |
| noisy-04 | 10.1 | 20.0% | 33.3% | 26.7% | 20.0% | 20.0% | 20.0% |

#### Zaman vekili ayrıntısı (temiz klipler, Chromium)

| Model/cihaz | Kelime zamanı olan klip | Monoton | Aralık içinde | Başlangıç p50 / p95 (n) | Bitiş p50 / p95 (n) | Duraklama p50 / p95 (n) |
|---|---|---|---|---|---|---|
| tiny/webgpu | 18/18 | 18 | 17 | 277 ms / 817 ms (13) | 269 ms / 852 ms (12) | 274 ms / 1040 ms (25) |
| tiny/wasm | 18/18 | 17 | 17 | 266 ms / 917 ms (13) | 278 ms / 10486 ms (12) | 283 ms / 1158 ms (25) |
| base/webgpu | 18/18 | 18 | 17 | 159 ms / 717 ms (13) | 233 ms / 494 ms (12) | 129 ms / 978 ms (25) |
| base/wasm | 18/18 | 18 | 18 | 159 ms / 717 ms (13) | 153 ms / 526 ms (12) | 151 ms / 998 ms (25) |
| small/webgpu | 18/18 | 18 | 18 | 162 ms / 717 ms (13) | 153 ms / 593 ms (12) | 148 ms / 998 ms (25) |
| small/wasm | 18/18 | 18 | 17 | 159 ms / 717 ms (13) | 103 ms / 593 ms (12) | 148 ms / 978 ms (25) |

#### Türkçe özel isim / sayı / İ-ı-ğ-ş örnekleri (referans → çıktı, temiz TR, Chromium)

**small / webgpu** — özel isimler: `apia` ✓, `samoa'nın` ✓, `upolu`→`upul`, `filistin'in`→`felistin`, `arap` ✓, `israil` ✓, `müttefikler` ✓, `fransa'yı`→`fransayı`, `meşhed'deki`→`etteki`, `goethe`→`göte`, `fichte`→`pihte`, `schlegel`→`gel`, `avrupa` ✓, `luna'ya`→`lunaya`, `romantizm`→`romantizin`

- Sayı içeren hata: 3 (tr-01 `40`→`ve`, tr-01 `000'in`→`kirtbin'in`, tr-07 `yedi`→`17`)
- Yalnızca ç/ğ/ı/ö/ş/ü farkı olan hata: 0 (—)
- Toplam kelime hatası: 47 = 42 değiştirme + 2 silme + 3 ekleme

**small / wasm** — özel isimler: `apia` ✓, `samoa'nın` ✓, `upolu`→`upol`, `filistin'in`→`felistin`, `arap` ✓, `israil`→`ısrael`, `müttefikler` ✓, `fransa'yı` ✓, `meşhed'deki`→`etteki`, `goethe`→`göte`, `fichte`→`pihte`, `schlegel`→`gel`, `avrupa` ✓, `luna'ya` ✓, `romantizm`→`romantizin`

- Sayı içeren hata: 3 (tr-01 `40`→`∅`, tr-01 `000'in`→`kirtbin'in`, tr-07 `yedi`→`17`)
- Yalnızca ç/ğ/ı/ö/ş/ü farkı olan hata: 0 (—)
- Toplam kelime hatası: 43 = 34 değiştirme + 3 silme + 6 ekleme

**base / webgpu** — özel isimler: `apia`→`apiya`, `samoa'nın`→`samoğunun`, `upolu`→`upu`, `filistin'in`→`felistinin`, `arap`→`arab`, `israil` ✓, `müttefikler` ✓, `fransa'yı`→`günefranca'yı`, `meşhed'deki`→`meşetteki`, `goethe`→`romantiz'in`, `fichte`→`göte`, `schlegel`→`veşle`, `avrupa` ✓, `luna'ya`→`ya`, `romantizm`→`∅`

- Sayı içeren hata: 4 (tr-01 `000'in`→`binin`, tr-05 `1940`→`alustos`, tr-05 `tarihinde`→`1940'nde`, tr-07 `yedi`→`17`)
- Yalnızca ç/ğ/ı/ö/ş/ü farkı olan hata: 0 (—)
- Toplam kelime hatası: 70 = 59 değiştirme + 6 silme + 5 ekleme

**base / wasm** — özel isimler: `apia`→`apiya`, `samoa'nın`→`samoğan'ın`, `upolu`→`upu`, `filistin'in`→`felistinin`, `arap`→`arab`, `israil` ✓, `müttefikler` ✓, `fransa'yı`→`günefranca'yı`, `meşhed'deki`→`meşetteki`, `goethe`→`göte`, `fichte`→`pikte`, `schlegel`→`şile`, `avrupa` ✓, `luna'ya`→`ya`, `romantizm`→`romantiz'in`

- Sayı içeren hata: 3 (tr-01 `000'in`→`binin`, tr-04 `1967'de`→`1967'e`, tr-07 `yedi`→`17`)
- Yalnızca ç/ğ/ı/ö/ş/ü farkı olan hata: 0 (—)
- Toplam kelime hatası: 70 = 61 değiştirme + 3 silme + 6 ekleme

**tiny / webgpu** — özel isimler: `apia`→`apaya`, `samoa'nın`→`samonun`, `upolu`→`uplu`, `filistin'in`→`yedi`, `arap`→`arab`, `israil`→`isra'yı`, `müttefikler`→`üttekler`, `fransa'yı`→`fransa`, `meşhed'deki`→`ki`, `goethe`→`göte`, `fichte`→`pihte`, `schlegel`→`gel`, `avrupa` ✓, `luna'ya`→`yayısıyla`, `romantizm`→`tizim`

- Sayı içeren hata: 11 (tr-01 `40`→`küt`, tr-01 `000'in`→`binin`, tr-02 `2011`→`2021`, tr-02 `mart`→`2021'yi`, tr-02 `2017'ye`→`diye`, tr-03 `100`→`yüz`)
- Yalnızca ç/ğ/ı/ö/ş/ü farkı olan hata: 1 (`özelliği`→`ozelliği`)
- Toplam kelime hatası: 106 = 86 değiştirme + 1 silme + 19 ekleme

**tiny / wasm** — özel isimler: `apia`→`apa`, `samoa'nın`→`ya`, `upolu`→`şiir`, `filistin'in` ✓, `arap`→`arab`, `israil`→`issriaylı`, `müttefikler`→`000`, `fransa'yı`→`000`, `meşhed'deki`→`ay`, `goethe`→`göte`, `fichte`→`pikte`, `schlegel`→`şilegel`, `avrupa`→`neyse`, `luna'ya`→`saygılarınız`, `romantizm`→`tizim`

- Sayı içeren hata: 231 (tr-01 `40`→`küt`, tr-01 `000'in`→`binin`, tr-02 `2011`→`2021`, tr-02 `2017'ye`→`2020'yi`, tr-03 `100`→`yüz`, tr-04 `∅`→`19`)
- Yalnızca ç/ğ/ı/ö/ş/ü farkı olan hata: 0 (—)
- Toplam kelime hatası: 341 = 109 değiştirme + 5 silme + 227 ekleme

#### Tam çıktı örnekleri (small / webgpu / Chromium)

- **tr-01** (WER 57.1%)
  - ref: Apia, Samoa'nın başkentidir. Şehir Upolu adasındadır ve 40.000'in biraz altında bir nüfusa sahiptir.
  - hyp: Apia Samoa'nın başkendidir. Şihir Upul adası nedir ve Kirtbin'in biraz altında bir nüfosa sahiptir.
- **tr-02** (WER 23.5%)
  - ref: Köprünün altındaki dikey açıklık 15 metredir. İnşaat 2011 yılı Ağustos ayında tamamlandı, Mart 2017'ye kadar trafiğe açılmadı.
  - hyp: Köprünün altındaki dike açıklık 15 metredir. İnşaat 2011 yılı Avustu sayında tamamlandı. Mart 2017'ye kadar trafiği açılmadı.
- **tr-05** (WER 20.0%)
  - ref: 15 Ağustos 1940 tarihinde Müttefikler güney Fransa'yı işgal etti, işgal için "Dragoon Operasyonu" ismi kullanıldı.
  - hyp: 15 avustos 1940 tarihinde müttefikler güney fransayı işgal etti. İşgal için dragon operasyonu ismi kullanıldı.
- **tr-08** (WER 42.9%)
  - ref: Romantizm; Goethe, Fichte ve Schlegel gibi yazarlardan geçen geniş bir kültürel determinizm özelliği taşıyordu.
  - hyp: Romantizin, göte, pihte ve şile gel gibi yazarlardan geçen geniş bir kültürel determinizin özelliği taşıyordu.
- **tr-10** (WER 33.3%)
  - ref: Güreşçi arkadaşları da Luna'ya saygılarını sundular.
  - hyp: Gürreşçi arkadaşları da Lunaya saygılarını sundular.
- **en-02** (WER 20.0%)
  - ref: On 15 August 1940, the Allies invaded southern France, the invasion was called "Operation Dragoon".
  - hyp: On August 15, 1940, the Allies invaded southern France, and the invasion was called Operation Dragoon.
- **en-04** (WER 13.0%)
  - ref: The aspect ratio of this format (dividing by twelve to obtain the simplest whole-number ratio) is therefore said to be 3:2.
  - hyp: The aspect ratio of this format, dividing by 12 to obtain the simplest whole number ratio, is therefore said to be free to 2.
- **noisy-02** (WER 47.1%)
  - ref: Köprünün altındaki dikey açıklık 15 metredir. İnşaat 2011 yılı Ağustos ayında tamamlandı, Mart 2017'ye kadar trafiğe açılmadı.
  - hyp: Çöpçülün altınlaki bir kez açıklık 15 metredir. İnşaat 2011 yılı altılu sayında tamamlandı. Mark 2017'ye kadar trafiği açılmadı.

## Yorum

**Doğruluk.** Hiçbir model ADR-017'nin üç eşiğini birlikte geçmiyor; Türkçe eşiğini hiçbiri
yaklaşık bile geçmiyor. Temiz Türkçe WER: tiny %51 (WASM'de 2 klipte tekrar döngüsü, ham %163),
base %33.5, small %20.6 (WASM q8) / %22.5 (WebGPU). İngilizce: small %7.8 (WebGPU) ve %10.1
(WASM) eşiğin kıyısında, base %10.8, tiny %19–20. Sayı biçimi normalize edilmediği için
Türkçe biraz cezalı ("40.000'in" ↔ "kırk binin", "15 August" ↔ "August 15"); ama sayı içeren
hata small'da 12 klipte 3 kelime, geri kalan hatalar gerçek: özel isimler (Goethe→"göte",
Fichte→"pihte"/"pikte", Schlegel→"şile gel"/"veşle", Upolu→"uplu"/"upu"/"Upul",
Meşhed'deki→"meşetteki"/"meşetli"),
ek ve kelime sınırı bozulmaları ("başkentidir"→"başkanlığı"/"başkendidir", "nüfusa"→"nüfosa"),
İ/ı/ğ/ş yalnızca harf düzeyinde değil kelime düzeyinde kayboluyor. Chromium, Chrome ve Edge
birebir aynı çıktıyı verdi (0 klip farklı; aynı motor), Firefox WASM için aşağıdaki nota bakın.

**Uydurma (en ağır bulgu).** Her model, her cihazda negatif kliplere metin yazdı: 18 Chromium
tabanlı koşunun 18'inde, 3 negatifin 3'ünde ya da 2'sinde. Üretilen metin YouTube kapanış
cümleleri: "Abone olmayı unutmayın.", "Bu videoyu izlediğiniz için teşekkürler.", "Bu videoda",
"Bu dizinin betimlemesi TRT-8'ne yaptırılmıştır." Tek "boş" sonuç tiny/WebGPU'nun dijital
sessizlikte ürettiği "..." idi. Bu, Whisper'ın bilinen davranışıdır; Transformers.js pipeline'ı
`no_speech_prob` vermediği için ürün tarafında filtrelenemez. Uydurulan kelimelerin zamanı çoğu
kez 30 s penceresinin sonunda (29.98 s, klip 15 s) — aralık dışı bir işaret — ama small/WASM
müzikte 11.2–12.0 s'ye de düştü, yani bu işaret güvenilir bir filtre değil. Enerji eşikli bir
VAD dijital sessizliği ve oda tonunu modele hiç vermeyerek çözer, **müziği çözmez**; kullanıcı
videosunda müzik yaygındır.

**Kelime zamanı.** Referans kelime zamanı yok; ADR'nin "p95 ≤ 250 ms" eşiği bu veriyle
**doğrulanamadı**. Kaba ölçek doğru: zamanlar monoton ve 17–18/18 klipte aralık içinde.
Sessizlik sınırı vekilinde duraklama p50 130–150 ms (base/small), p95 ~1 s; p95'i şişiren,
yanlış tanınan/atlanan kelimelerin olduğu yerlerdeki eşleşmeler. Elle bakılan 3 klipte (small/WebGPU):
`tr-05` başlangıç sapması 270 ms, iç duraklamalar 120 / 170 ms, bitiş 70 ms; `tr-01` 160 / 130 / 100 / 125 ms;
`en-02`'de model kelime sırasını değiştirdi ("On 15 August" → "On August 15") ve "August"
1.66–3.44 s'ye yayıldı: sıra değiştiren ya da kelime birleştiren her yerde kelime zamanı
250 ms'yi aşar. Ölçüm için kelime zamanlı bir referans (ör. kurucunun kendi sesiyle elle
işaretlenmiş 3–5 klip) gerekir; bu deneme onu üretmedi.

**Hız ve bellek.** Chromium/WebGPU (RTX 3070 Ti): small RTF 0.29, base 0.16, tiny 0.12.
WASM (i5-12500, 12 iş parçacığı, q8): small 0.49, base 0.20, tiny 0.16; en kötü klipte 1.0–1.1.
Dizüstü CPU'da 2–4× daha yavaş beklenir, **ölçülmedi**. Firefox WebGPU: tiny RTF 2.0–3.3
(Chromium'un ~17 katı yavaş), adaptör kimliği boş; base/small Firefox WebGPU'da bilerek
çalıştırılmadı (small için ~70 dk sürecekti). Firefox WASM: tiny/base/small çıktıları Chromium ile birebir aynı (0 klip farklı), RTF 0.17 / 0.21 / 0.49, tepe bellek 1.6 / 1.5 / 2.8 GiB — WASM yolu dört tarayıcıda da aynı davranıyor.
Bellek: small/WebGPU tepe **8.6 GiB** (taban ~2 GB) — 8 GB RAM'li makinede çalışmaz;
base/WebGPU 3.9 GiB; small/WASM 1.9–2.6 GiB; base/WASM 1.6 GiB; tiny/WASM 1.4 GiB.
Yükleme yerel aynadan soğuk 1–5 s, sıcak 0.7–4.7 s; gerçek ilk indirme kullanıcı hattına
bağlıdır (small/WebGPU 559 MB, small/WASM 237 MB, base/WASM 73 MB, tiny/WASM 39 MB).

**`_timestamped` dışa aktarımlarının bedeli.** Düz dışa aktarımlar kelime zamanı veremiyor;
`_timestamped` sürümler aynı ağırlıkla yaklaşık 2× yavaş (tiny/WebGPU 0.05 → 0.10–0.12 RTF).
Kelime zamanı ADR-017'nin özü olduğu için bu bedel kaçınılmaz.

**Boyut.** ADR-017'nin "~40–250 MB" aralığına WASM q8 tiny/base/small ve WebGPU tiny/base
sığıyor; small/WebGPU (fp32 encoder) 559 MB ile sığmıyor. fp16 encoder (168 MB) denenmedi.

## Karar önerisi

1. **ADR-017 eşikleri: hiçbir model geçmedi.** ADR'nin kendi kuralı gereği uygulama
   **başlamaz**; "çalışmayan özellik ana akışa konmaz". Bu belge o kaydın kendisidir.
2. En az kötü aday **small / WASM q8** (237 MB, TR %20.6, EN %10.1, masaüstü CPU'da RTF 0.5,
   2.6 GiB): Türkçede her 5 kelimeden biri yanlış ve negatiflerde uydurma var. "Taslak"
   olarak sunulsa bile düzeltme yükü, elle yazmaya yakın; sunulmamalı.
3. Ücretsiz kalan yollar, kurucu isterse **tek bir ek deneme günü** olarak (harness hazır,
   yeni model `models.mjs`'de bir satır):
   - Türkçeye ince ayarlı açık Whisper ONNX dışa aktarımları (Hugging Face'te var; lisans ve
     kelime zamanı desteği tek tek doğrulanmalı — çoğu `_timestamped` değildir).
   - `whisper-large-v3-turbo_timestamped` q4f16 (537 MB, yalnız WebGPU): boyut ADR aralığının
     dışında; ancak kurucu boyutu kabul ederse ölçülür. Firefox ve 8 GB makineler dışarıda kalır.
   - Ön-VAD (ör. Silero VAD ONNX, ~2 MB) ile sessiz bölümleri modele hiç vermemek: dijital
     sessizlik/oda tonu uydurmasını keser, **müzik uydurmasını ve WER'i düzeltmez**.
   - Kelime zamanlı küçük referans seti (kurucunun sesi, elle işaretli) — p95 eşiğini gerçekten
     ölçebilmek için şart.
4. Bulut rota ADR-017 gereği kapalı (bütçe); bu sonuç onu açmaz.
5. **Şimdi yapılacak:** transkript adımını beklemeye alıp altyazı hattında (elle satır, SRT/VTT,
   görüntüye işleme) kullanıcı testine dönmek. Tek sonraki görev: kurucudan 3. maddedeki ek
   denemeye evet/hayır kararı; evetse önce Türkçe ince ayarlı modellerin listesi ve lisansları.

## Yeniden üretme

```
cd web/spike/asr
npm install                       # @huggingface/transformers 4.3.0 + @playwright/test 1.63.0 (yalnızca bu klasöre)
node prepare-speech.mjs           # FLEURS'ten ~42 MB, ffmpeg ile türevler → web/tests/media/speech/
node mirror-models.mjs            # tiny/base/small _timestamped (ve --models=tiny-plain,… için düz sürümler)
node run-asr.mjs --tag=2026-09-21 # 4 tarayıcı × 2 cihaz × 3 model, sonuçlar web/spike-results/
node summarize.mjs --tag=2026-09-21
```
