# Uygunluk denemesi 2 — cihaz üstü İngilizce transkript (ön filtre, uzun dosya, kelime zamanı)

> Tarih: 2026-10-03 · Bağlam: ADR-017, kurucu kararı (3 Ekim 2026): YouTube tarzı transkript paneli +
> otomatik altyazı, **şimdilik yalnız İngilizce**, bütçe 0, medya cihazdan çıkmaz.
> Önceki deneme: `docs/spikes/2026-09-21-asr-on-device.md` (geçmedi: uydurma metin, Türkçe WER, bellek).
> Bu belgedeki her sayı `web/spike-results/asr-2026-10-03-*.json` ham dosyalarından
> `node web/spike/asr/summarize-en.mjs` ile üretilmiştir; tahmin yoktur. Bitmeyen koşuların sayısı
> kullanılmadı. Ölçülmeyenler "Ölçülmeyenler" bölümünde.

## 1. Özet ve karar

**Hüküm: SHIP — cihaz üstü İngilizce transkript, "taslak" etiketiyle, aşağıdaki bileşimle ve
aşağıdaki açık koşullarla.** Eylül'de özelliği durduran bulgu (sessizlikte ve müzikte uydurma metin)
bu bileşimle ölçülen her kümede sıfıra indi; bellek sorunu bir kütüphane sızıntısıymış ve giderildi.
İki eşik *olduğu gibi* tutmuyor ve bunlar gizlenmiyor: kelime zamanı (ham hâliyle geçmiyor, sabit
düzeltmeyle sınırda) ve küçük modelin WER'i (eşiğin hemen çevresinde). Telefon ve dizüstü ölçülmedi.

**Gönderilecek bileşim** (ayarlar doğrulama klipleri üretilmeden önce sabitlendi):
1. Silero VAD, yayınlanmış varsayılan ayarlarıyla → konuşma aralıkları;
2. her aralık **tek başına** modele verilir (30 s'den uzunsa en sessiz yerinden bölünür);
3. bir aralığın çıktısı, ortalama token log-olasılığı **−0,75'in altındaysa** ya da metni bir tekrar
   döngüsüyse (zlib oranı > 2,4) **atılır** (arayüzde "anlaşılamadı" olarak görünür);
4. kütüphanenin sızdırdığı decoder önbelleği her aralıktan sonra bırakılır;
5. kelime zamanlarından model başına ölçülmüş sabit (~0,2 s) çıkarılır.

| Eşik (ADR-017) | `base` (80 MB WASM / 113–209 MB WebGPU) | `turbo` (566 MB, yalnız WebGPU) |
|---|---|---|
| Temiz İngilizce WER ≤ %10 (katı ölçü) | **Sınırda.** Eylül'ün 6 klibi %9,3; uzun dosyalar %4,1–9,4; doğrulama konuşması %8,9 (WebGPU), **%10,5 (WASM q8)** | **Geçti.** %7,8; %2,0–5,0; %4,1 |
| Negatiflerde görünür uydurma yok | **Geçti:** 25/25 klipte 0 (11 + 6 ayrılmış + 8 doğrulama); Chromium, Chrome, Edge (WebGPU), Chromium ve Firefox (WASM). Duraklamalarda boşluğa yazılan kelime 0 | **Geçti:** 25/25 klipte 0; boşluklarda 0 (yalnız Chromium/WebGPU) |
| Kelime zamanı p95 ≤ 250 ms | Ham: **geçmedi** (başlangıç 369–427 ms). Sabit çıkarılınca: başlangıç 185–242 ms (**geçti**), bitiş 222–294 ms (sınırda) | Ham: **geçmedi** (416–449 ms). Sabitle: başlangıç 205–284 ms, bitiş 260–411 ms (**sınırın üstü var**) |
| Bellek ve hız | WASM: 1,1–1,5 GiB; gerçek zamanın 0,19 katı (12 iş parçacığı), 0,20 (4), **0,28 (tek iş parçacığı, yalıtımsız — GitHub Pages'in bugünkü hâli)**. WebGPU: 1,8–3,9 GiB, 0,19–0,27 | 3,7 GiB + ~1,4–1,7 GB ekran kartı belleği; 0,20–0,25 |

Sayılar bu masaüstündendir ve makine ölçüm sırasında %40–84 doluydu.

**Kullanıcının ödediği:** bir kerelik indirme 80 MB (`base`, her cihaz) ya da 566 MB (`turbo`,
WebGPU'lu masaüstü) + 2,2 MB VAD + uygulama dosyası olarak ~15–28 MB çalışma zamanı; 10 dakikalık
konuşma için bu masaüstünde ~2–3 dakika işlem; 1,1–3,7 GiB bellek.

**Öneri:** varsayılan `base` (WASM q8, 80 MB — WebGPU gerektirmez, tek iş parçacığında da çalışır);
WebGPU ve `shader-f16` olan cihazlarda isteğe bağlı "daha doğru" seçenek `turbo`. Yalnız `turbo`
göndermek kaliteyi kesin geçirir ama WebGPU'suz her cihazı (Firefox dahil) dışarıda bırakır.

**Kurucunun vermesi gereken kararlar:**
1. `script-src`'ye `'wasm-unsafe-eval'` eklenmesi (onnxruntime-web onsuz çalışmaz; kaçınılmaz).
2. Model nerede duracak: (a) kendi sitemizde, CI ile Pages yapıtına eklenerek (öneri; yeni dış istek
   yok; bir yayınla henüz denenmedi) ya da (b) Hugging Face'ten (yeni üçüncü taraf isteği, gizlilik
   metni değişir). Bölüm 8.
3. WebGPU'suz cihaz özelliği alacak mı: ölçüme göre alabilir (`base`, WASM, tek iş parçacığı 0,28×) —
   ama bu bir masaüstü işlemcisinde ölçüldü; dizüstü ve telefon ölçülmeden "evet" bir tahmindir.
4. Kelime zamanı eşiği: ham çıktı eşiği geçmiyor. Sabit düzeltme kabul edilirse `base` başlangıçta
   geçiyor, bitişte sınırda; `turbo` bir dosyada 284 / 411 ms. Eşik p95 ≤ 250 ms olarak kalsın ve
   altyazı "taslak, kaydırılabilir" olarak mı çıksın, yoksa eşik başlangıç için tutulup bitiş için
   gevşetilsin mi (satır zaten son kelimeden 0,15 s sonra kalkıyor) — Bölüm 10'da ayrı tartışıldı.
5. `base`'in doğruluğu (yaklaşık her 10–25 kelimede bir hata; gürültüde çok daha kötü) varsayılan
   olarak kabul mü, yoksa yalnız `turbo` mu.
6. Şema: `transcripts[]`, `origin: 'transcript'`, 500 satır sınırı (Bölüm 11) — ayrı ADR.

**Ücretli yedek (çağrılmadı, hesap açılmadı; fiyatlar görev tanımındaki 3 Ekim 2026 değerleri):**
AssemblyAI Universal-2 0,15 $/saat (50 $ ücretsiz kredi ≈ 333 saat); OpenAI gpt-4o-mini-transcribe
0,003 $/dk = 0,18 $/saat. 10 dakikalık video ≈ 0,025–0,03 $. Bedeli para değil: ses cihazdan çıkar.

## 2. Ortam

- Makine: Eylül denemesiyle aynı (Windows 11 Pro 10.0.26200, Intel Core i5-12500, 12 mantıksal
  çekirdek, 64 GB RAM, NVIDIA RTX 3070 Ti 8 GB, sürücü 610.88). Dizüstü değil.
- **Makine boş değildi.** Aynı bilgisayarda başka ajanlar ve kurucunun kendi programları
  çalışıyordu. Her koşu, başlamadan önceki ve koşu sırasındaki toplam işlemci doluluğunu kaydetti
  (`cpuBefore`, `cpu`): koşudan önce %15–68, koşu sırasında %37–95 dolu. Ağır koşular
  `E:\capcut_better\.claude\measure-lock` kilidi altında yapıldı; kilit yalnızca kilide uyan
  ajanları dışarıda tutar. **Hız sayıları (RTF) bu yüzden kötümser tarafta okunmalıdır;** boş bir
  makinede ölçülmedi.
- Node 20.18.0, ffmpeg 9.0.1, Playwright 1.63.0 (Chromium 153.0.8010.12, başlıklı), sistem Chrome
  154.0.8037.93 ve Edge 154.0.4258.53 (kanal), Playwright Firefox 155.0.
- `@huggingface/transformers` 4.3.0 (Apache-2.0), içindeki `onnxruntime-web`
  1.31.0-dev.20260914 (MIT). Sayfa COOP/COEP ile `crossOriginIsolated`; "yalıtımsız" satırlar
  başlıksız sunuldu (GitHub Pages'in bugünkü hâli).
- Python 3.13.9 yerel sanal ortam (`web/spike/asr/.venv`, gitignore): yalnızca `whisper-normalizer`
  0.1.15 (MIT) — puanlama için. Hizalama için Python/GPU aracı kurulmadı; referans kelime zamanları
  hazır veri setinden geldi (aşağıda).
- Telefon (Samsung S23): 3 Ekim'de kilit sırası yüzünden başlayamadı; sonrasında ve 4 Ekim'de
  USB bağlantısı yoktu (`adb devices` boş). **Telefonda hiçbir şey ölçülmedi**; sürücü hazır
  (`web/spike/asr/run-phone.mjs`).

## 3. Veri seti ve hakları

Hepsi açık lisanslı, girişsiz indirilen veri ve ffmpeg ile üretilen sentetik ses. Kullanıcı medyası
yok; `web/tests/media/real/` dokunulmadı; hiçbir ses makineden çıkmadı. Klasör gitignore'lu;
`node web/spike/asr/prepare-speech.mjs && node web/spike/asr/prepare-english.mjs` yeniden üretir ve
`web/tests/media/speech/SOURCES.md`'yi yazar.

| İndirilen | Kaynak | Lisans | Bayt | Doğrulama |
|---|---|---|---|---|
| LibriSpeech `test-clean.tar.gz` | openslr.org/12 | CC-BY-4.0 | 346 663 984 | md5 `32fa31d27d2e1cad72775fee3f4849a9` (yayınlanan değerle aynı), sha256 `39fde525e59672dc…` |
| LibriSpeech Alignments `librispeech_alignments.zip` | zenodo.org/records/2619474 (DOI 10.5281/zenodo.2619474) | CC-BY-4.0 | 623 023 332 | md5 `2bab567d0ace651a4ba254e813629f46` (Zenodo'nun verdiği değerle aynı), sha256 `6ac1d003cf54dbf7…` |
| FLEURS `en_us` test arşivinin ilk 48 MB'ı + `test.tsv` | huggingface.co/datasets/google/fleurs, revizyon `70bb2e84…` | CC-BY-4.0 | 48 000 000 | sha256 `b5d0419e4d7d74ca…` |
| "Scheming Weasel (faster)", Kevin MacLeod | Wikimedia Commons | CC-BY-4.0 | 15 723 002 | sha256 `b184f59bbe34b20e…` |
| Chopin, Nocturne Op. 15 no. 1 | Wikimedia Commons | CC0 | 3 512 797 | sha256 `8102e39f17629e0e…` |
| "Robot Gypsy Jazz", John Bartmann | Wikimedia Commons | CC0 | 1 703 564 | sha256 `c78740cc7185844a…` |
| "Calmant", Kevin MacLeod (yalnız doğrulama setinde) | Wikimedia Commons | CC-BY-3.0 | 3 836 395 | sha256 `71568ce48eaf180d…` |
| "Windswept", Kevin MacLeod (yalnız doğrulama setinde) | Wikimedia Commons | CC-BY-3.0 | 4 811 499 | sha256 `392d4f79aad70e06…` |

TED-LIUM kullanılmadı: lisansı CC BY-NC-ND 3.0 (ticari olmayan, türev yok); karışım ve kırpma
türev sayılabileceği için dışarıda bırakıldı. Common Voice yine giriş arkasında.

**Klipler** (16 kHz mono 16-bit; `web/tests/media/speech/manifest-en.json` her klibin doğru cevabını
tutar: referans metin, varsa referans kelime zamanları, konuşma olmayan bölgeler):

| Set | Klipler | Ne |
|---|---|---|
| `neg` (11) | neg-01…11, toplam 335 s | Doğru çıktı **boş**. Eylül'ün üçü (dijital sessizlik, çok kısık pembe gürültü, sentetik akor) + pembe gürültü −30 dBFS, beyaz gürültü −25 dBFS, **gerçek müzik**: solo piyano 30 s, enstrümantal grup 30 s, vlog fon müziği 30 s ve 80 s, tık + 50 Hz uğultu, 60 s oda tonu |
| `negh` (6) | negh-01…06, 185 s | Aynı üç parçanın başka bölümleri, kısık müzik, kahverengi gürültü. Süzgeç ayarları seçilirken bakılmaması için ayrılmıştı; kural seçiminde yine de görüldü (aşağıda açıkça yazıyor) |
| `negv` (8) | negv-01…08, 295 s | **Doğrulama:** kural sabitlendikten *sonra* üretildi. Hiçbir modele çalınmamış iki parça (Calmant, Windswept), piyanonun kullanılmamış bölümü, hızlandırılmış vlog müziği, iki parçanın üst üste çalınması |
| `pause` (2) | pause-01 (74 s), pause-02 (106 s) | LibriSpeech cümleleri arasında 6–20 s boşluk: dijital sessizlik, oda tonu, vlog müziği, piyano; pause-02 20 s müzik girişi ve 15 s oda tonu çıkışıyla. Boşluklarda yazı olmamalı |
| `mix` (7) | mix-clean ve altı karışım, 150 s | Aynı LibriSpeech pasajı: temiz; vlog müziği altında SNR 20 / 10 / 5 / 0 dB; pembe gürültü altında 10 / 5 dB |
| `long` (4) | long-a 483 s (tek erkek okuyucu), long-b 481 s (tek kadın), long-c 1101 s (dört okuyucu art arda), long-fleurs 609 s | Uzun dosya. long-fleurs: 60 FLEURS cümlesi, her biri başka konuşmacı, aralarında 0,7 s oda tonu; **noktalama, büyük harf ve sayı içeren referans**; her kayıt −3 dBFS tepeye getirildi |
| `stress` (1) | long-fleurs-raw 609 s | Aynı 60 kayıt kendi seviyeleriyle (tepe −0,2 … −53,8 dBFS) |
| `val` (3) | val-clean, val-pink-5, val-music-5, 254 s | **Doğrulama konuşması:** başka yerde kullanılmamış iki okuyucu; temiz, pembe gürültü 5 dB, "Calmant" 5 dB |
| `short` (7) | Eylül'ün en-01…06 + noisy-04 | Kısa FLEURS klipleri (süreklilik için) |
| `tr` (15) | Eylül'ün tr-01…12 + üç gürültülü | Türkçe (yalnız Bölüm 9) |

**Referans kelime zamanları.** LibriSpeech Alignments: Montreal Forced Aligner ile üretilmiş,
LibriSpeech'in her cümlesi için kelime başlangıç/bitiş zamanları (TextGrid). Klipler cümlelerin uç
uca eklenmesiyle kurulduğu için her kelimenin zamanı örnek hassasiyetinde kaydırıldı. Bu bir
*zorla hizalama* çıktısıdır, elle işaretleme değil; hizalayıcının kendi hatası (tipik olarak
onlarca ms) ölçülen sapmanın içindedir. long-fleurs için kelime zamanı yoktur.

## 4. Modeller, dosyalar, lisanslar

Hepsi Hugging Face'te girişsiz. Boyut = tarayıcının indirdiği ağırlık dosyaları + ~3–4 MB
yapılandırma/tokenizer; 1 MB = 10⁶ bayt. Dosya sha256'ları `web/spike/asr/models/manifest.json`'da
(gitignore; `node mirror-models.mjs` yeniden üretir ve LFS özetiyle doğrular).

| Anahtar | Repo @ revizyon | Cihaz: encoder / decoder | İndirme |
|---|---|---|---|
| base | `onnx-community/whisper-base_timestamped` @ `608c49e6` | WASM: q8 / q8 | 80 MB |
| | | WebGPU (Eylül): fp32 / q4 | 209 MB |
| base-fp16 | aynı | WebGPU: fp16 / q4f16 | 113 MB |
| small | `onnx-community/whisper-small_timestamped` @ `65caa70f` | WASM: q8 / q8 | 252 MB |
| | | WebGPU (Eylül): fp32 / q4 | 589 MB |
| small-fp16 | aynı | WebGPU: fp16 / q4f16 | 325 MB |
| turbo | `onnx-community/whisper-large-v3-turbo_timestamped` @ `b3f77bf9` | WebGPU: q4f16 / q4f16 | 566 MB |
| distil-small.en | `onnx-community/distil-small.en` @ `69be759f` | WebGPU: fp16 / q4; WASM: q8 / q8 | 364 MB; 175 MB |
| distil-large-v3.5 | `onnx-community/distil-large-v3.5-ONNX` @ `d908cd7f` | WebGPU: q4f16 / q4f16 | 538 MB |
| moonshine-tiny | `onnx-community/moonshine-tiny-ONNX` @ `a6da1241` | WebGPU: fp32 / q4; WASM: q8 / q8 | 79 MB; 32 MB |
| moonshine-base | `onnx-community/moonshine-base-ONNX` @ `b1e9b6aa` | WebGPU: fp32 / q4; WASM: q8 / q8 | 157 MB; 67 MB |
| silero-vad | `onnx-community/silero-vad` @ `e71cae96` (`onnx/model.onnx`) | WASM fp32 | 2,2 MB |

Uygulamayla birlikte gelmesi gereken çalışma zamanı ayrıca: `onnxruntime-web` WASM dosyası
(14–28 MB, derlemeye göre) ve Transformers.js (~1,1 MB).

`distil-small.en`'in fp16 decoder dosyası onnxruntime-web 1.31'de **yüklenmiyor** ("invalid model:
subgraph output (logits) is an outer scope value"; kayıt:
`asr-2026-10-03-chromium-webgpu-distil-small.en-fp16dec-load-failed.json`); 4-bit decoder ile ölçüldü.

**Lisanslar** (`node web/spike/asr/licenses.mjs` model kartlarından ve paketlerden okur; GitHub
LICENSE dosyaları ayrıca açılıp okundu):

| Bileşen | Lisans | Nereden doğrulandı |
|---|---|---|
| Whisper kodu | MIT (© 2022 OpenAI) | github.com/openai/whisper `LICENSE`. Dosya ağırlıklardan söz etmiyor |
| Whisper ağırlıkları | base/small: model kartında `apache-2.0`; large-v3-turbo: `mit` | huggingface.co/openai/* kartları. İkisi de serbest dağıtıma izin verir; atıf ve lisans metni gerekir |
| `onnx-community/whisper-*_timestamped` dışa aktarımları | kartta lisans **beyan edilmemiş**; `base_model` openai/whisper-* | Türev olarak üst lisansı taşır; yine de kartta yazmıyor — kendi sunucumuza koyarken lisans metnini biz ekleriz |
| distil-whisper (small.en, large-v3.5) | MIT | huggingface.co/distil-whisper/* kartları |
| Moonshine (tiny, base) | MIT | UsefulSensors/moonshine ve onnx-community kartları |
| Silero VAD | MIT (© 2020– Silero Team) | github.com/snakers4/silero-vad `LICENSE`, onnx-community kartı |
| Transformers.js 4.3.0 | Apache-2.0 | paket |
| onnxruntime-web 1.31.0-dev | MIT | paket |
| Deneme araçları: Playwright 1.63.0 (Apache-2.0), TypeScript 5.9.3 (Apache-2.0), whisper-normalizer 0.1.15 (MIT) | | yalnız `web/spike/asr/`; uygulamanın `web/package.json`'ına hiçbir bağımlılık eklenmedi |

## 5. Yöntem

- **Düzenek:** `web/spike/asr/` (uygulama paketinin dışında). `engine.js` Web Worker'da çalışır;
  `run-en.mjs` Playwright ile sürer, her (tarayıcı, cihaz, model, ön filtre) için bir ham JSON
  yazar: tam çıktı metni, her kelimenin zamanı, ön filtrenin geçirdiği aralıklar, her pencerenin
  güven sayıları. Bellek: tarayıcı süreç ağacının özel baytları (400 ms'de bir) ve `nvidia-smi` ile
  ekran kartının toplam kullanılan belleği (1 sn'de bir; başka programlar dahil, bu yüzden "taban →
  tepe" olarak verilir).
- **Ön filtreler:**
  - `none`: bütün dosya modele gider. 30 s'ye kadar tek pencere (Eylül'ün yolu); uzun dosyada
    kütüphanenin kendi uzun dosya yolu (30 s parça, 5 s bindirme).
  - `silero`: Silero VAD (v5 ONNX, WASM, 32 ms'lik adımlar) worker'da çalışır. Ayarlar yayınlanmış
    varsayılanlar: eşik 0,5, bitiş eşiği 0,35, en kısa konuşma 0,25 s; duraklama 0,5 s'den kısaysa
    aralık bölünmez; her iki yana 0,2 s pay. **Ayar taraması yapıldı ama ayar değiştirilmedi.**
  - `own`: kendi sessizlik bulucumuz (ADR-018, `web/src/domain/silence.ts` olduğu gibi
    derlenip çağrıldı). Sessizlik bulur; "konuşma" onun tümleyenidir. Bulucu "öneri yok" derse
    (müzik, gürültü, baştan sona sessizlik) her şey geçer — bulucunun bugünkü hâli budur.
  - `ownabs`: `own` + tek ek kural (yüksek seviye −45 dBFS'in altındaysa dosyada konuşma yok).
- **Pencereleme:** konuşma aralıkları en çok 30 s'lik pencerelere paketlenir; pencere yalnızca
  konuşma parçalarının uç uca eklenmiş hâlidir, aradaki ses modele hiç girmez; kelime zamanları
  parça parça kaynağın saatine geri taşınır. 30 s'den uzun aralık, ikinci yarısındaki en düşük
  VAD olasılığından bölünür ("zorunlu kesim"). `--per-span`: her aralık tek başına çözülür.
- **Whisper'ın kendi korumaları.** Transformers.js 4.3.0'da `no_speech_threshold`,
  `logprob_threshold`, `compression_ratio_threshold` ve sıcaklık yedeği **yoktur**; önceki metne
  koşullama da yoktur (her pencere bağımsız çözülür — `condition_on_previous_text` fiilen kapalı).
  Bu yüzden ikisi düzenekte ölçüldü: (1) ortalama token log-olasılığı — çözücünün seçtiği her
  token'ın log-olasılığı bir logits işleyicisiyle kaydedildi; (2) no-speech olasılığı —
  `<|startoftranscript|>` sonrası ilk adımda `<|nospeech|>` token'ının olasılığı (pencere başına
  bir ek encoder geçişi; süresi hız sayısından ayrı tutuldu). Sıkıştırma oranı (zlib) metinden
  hesaplandı. Kurallar önce ham sayılardan çevrimdışı denendi, sonra seçilen kural motorun içinde
  uygulanıp yeniden koşuldu.
- **WER/CER:** iki ölçü yan yana. *Katı* = Eylül'ün ölçüsü (küçük harf, noktalama → boşluk; sayı
  biçimi normalize edilmez). *Normalize* = İngilizce ASR'nin standart ölçüsü: OpenAI'nin
  `EnglishTextNormalizer`'ı iki tarafa da uygulanır (sayılar rakama, kısaltmalar açılır, İngiliz →
  Amerikan yazımı). Parantez içini silen kuralı referansı bozduğu için parantezler önce boşluğa
  çevrildi. **Eşik kararı katı ölçüyle verilir** (ADR-017 eşiği Eylül'de onunla sınandı);
  normalize ölçü yanında durur.
- **Kelime zamanı:** çıktı kelimeleri referans kelimelerle Levenshtein hizalanır; birebir eşleşen
  kelimelerde başlangıç ve bitiş farkı alınır (ortanca, p95, işaretli ortalama, ±250 ms içinde
  kalanların payı). Eşik: **ADR-017'nin p95 ≤ 250 ms'si**; altyazı pratiğiyle uyumlu (bir satırın
  sözden çeyrek saniyeden fazla önce ya da sonra gelmesi fark edilir).
- **Uydurma:** negatif klipte boşluk/noktalama dışında bir karakter = uydurma (Eylül'le aynı).
  Yalnız noktalama ("." gibi) ayrıca sayıldı. Duraklamalı kliplerde: referansta olmayan ve zamanı
  bir boşluğun içine düşen kelimeler.
- **Sonuçların üzerine yazma olayı:** Türkçe koşular (F) önce sonek verilmeden başlatıldı ve aynı
  iki modelin İngilizce sonuç dosyalarının (small-fp16 ve turbo; `silero` ve `none`) üzerine yazdı.
  Türkçe dosyalar `-tr` olarak yeniden adlandırıldı, dört İngilizce koşu aynı argümanlarla
  yeniden yapıldı (`matrix-2026-10-03-redo.sh`, `matrix-2026-10-04-final.sh`; small-fp16
  tekrarında long-c ve long-fleurs-raw yok). Bu belgedeki sayılar yeniden koşulan dosyalardandır. `run-en.mjs` artık bitmiş bir sonucun
  üzerine yazmayı reddeder.

## 6. Sonuçlar

Tabloların tamamı (her koşu, her klip) `web/spike-results/asr-2026-10-03-summary.md` dosyasındadır
(T1–T13; `summarize-en.mjs` üretir). Aşağıda karara giren satırlar var. WER hücreleri
"normalize / katı". Aksi yazmıyorsa Chromium 153, WebGPU.

### 6.1 Uydurma metin: ön filtresiz, ön filtreyle, korumayla

Negatif klipler (doğru çıktı boş): `neg` 11, `negh` 6, `negv` 8.

| Ön filtre / koruma | base | small-fp16 | turbo | distil-small.en | moonshine-base |
|---|---|---|---|---|---|
| Yok (`none`) | neg 10/11, negh 6/6 | 11/11, 5/6 | 9/11 (+2 yalnız noktalama), 6/6 | 6/11, 2/6 | 0/11, 1/6 |
| Kendi bulucumuz (`own`) | 10/11, 6/6 | 11/11, 5/6 | — | — | — |
| Kendi bulucumuz + mutlak seviye kuralı (`ownabs`) | 7/11, 6/6 | 7/11, 5/6 | — | — | — |
| Silero | 2/11, 2/6 | 1/11 (+1 "."), 2/6 | 1/11 (+1 "."), 1/6 (+1 ".") | 2/11, 2/6 | 0/11, 1/6 |
| Silero + Whisper'ın yayınlanmış kuralı (no-speech > 0,6 **ve** log-olasılık < −1), çevrimdışı | 1/11, 1/6 | 0/11, 0/6 | 1/11, 1/6 | 2/11, 2/6 | uygulanamaz |
| **Silero + aralık başına + (log-olasılık < −0,75 ya da döngü), motorda** | **0/11, 0/6, 0/8** | **0/11, 0/6, 0/8** | **0/11, 0/6, 0/8** | ölçülmedi | korumasız aralık başına: 0/11, 1/6 |

Aynı bileşim `base` ile Chrome 154 ve Edge 154'te (WebGPU), Chromium ve Firefox 155'te (WASM q8),
`small` ile Chromium WASM'de: hepsinde 0/11, 0/6, 0/8.

- **Ön filtresiz** çıktı Eylül'dekiyle aynı türden: "Thank you.", "Thank you for watching!",
  "I'm sorry.", "you"; müzikte tekrar döngüleri ("I'm not a bad guy, I'm not a bad guy…", 317
  kelime, ortalama log-olasılık −0,09 — yani model döngüden *emin*).
- **Kendi sessizlik bulucumuz bu iş için uygun değil.** Sessizlik arar, konuşma değil: müzikte,
  gürültüde ve baştan sona sessiz dosyada "öneri yok" der, her şey modele gider. Gerçek okuma
  seslerinde de (LibriSpeech) duraklamaların seviyesi dalgalandığı için çoğu dosyada vazgeçti.
  Yalnız temiz boşluklu `pause` kliplerinde 94 s boşluğun 39 s'sini eledi.
- **Silero tek başına yetmez.** Dijital sessizliği, oda tonunu, gürültüyü, piyanoyu, sentetik
  müziği tamamen eler; ama ritimli gerçek müziğin (vlog fon müziği, grup) bir kısmını konuşma
  sanar: 335 s negatifin 15,1 s'si, ayrılmış 185 s'nin 4,5 s'si geçti. Eşiği 0,9'a çekmek de
  bitirmiyor (hâlâ 6,4 s geçiyor) ve müzik altındaki konuşmadan kelime kaybettiriyor
  (`vad-dump.mjs` taraması) — bu yüzden ayar varsayılanda bırakıldı.
- **Whisper'ın kendi kuralı bu modellerde eksik kalıyor:** turbo'nun no-speech olasılığı her
  pencerede 0,00 çıktı (kural hiç tetiklenmez); base'de bir uydurma −0,95 log-olasılıkla −1
  eşiğinin üstünde kaldı. Ayıran sayı ortalama log-olasılık: A koşularında gerçek konuşmanın
  435 penceresinde en düşük değer −0,51; negatiflerde metin üreten 16 pencerede en yüksek −0,95
  (base, base-fp16, small-fp16, turbo; model model: base −0,51 / −0,95, small-fp16 −0,47 / −1,28,
  turbo −0,32 / −1,13). Eşik bu aralığın ortasına, −0,75'e kondu. **Bu seçim `neg` ve `negh`
  görülerek yapıldı;** bu yüzden kural sabitlendikten sonra hiç kullanılmamış iki parçayla `negv`
  ve yeni konuşmacılarla `val` üretildi. Sonuç yukarıdaki son satır.
- **Distil modellerde bu ayrım yok** (distil-large-v3.5: uydurma "Thank you." −0,41, gerçek
  konuşmanın en düşüğü −0,34) ve bu dışa aktarımlar kelime zamanı vermiyor → aday değiller.
  **Moonshine**: log-olasılığı aralık başına çözmede anlamsız değerler verdi (−11), koruma
  kurulamadı; ayrılmış kümede 1 klipte uydurdu ("Thank") → aday değil.

**Duraklamalı klipler** (pause-01/02; 94 s boşluk, Silero bunun 25,3 s'sini — müziği — geçirdi):
boşluklara yazılan, referansta olmayan kelime sayısı. Silero + 30 s paketleme: base 3 ("I'm sorry",
+1), small-fp16 3 ("Thanks for watching"), turbo 1 ("so"). Gönderilecek bileşim: **base 0,
small 0, small-fp16 0, turbo 0** (Chromium; base ayrıca Chrome, Edge, Firefox'ta 0).

### 6.2 Korumanın ve ön filtrenin bedeli (kaybedilen gerçek konuşma)

- **Silero'nun dışarıda bıraktığı referans kelimeler** (modelden bağımsız): temiz LibriSpeech
  (long-a/b/c, mix-clean, pause) 5 799 kelimede **0**; müzik altında 20/10/5 dB'de 0/375, 0 dB'de
  1/375; pembe gürültü 10 dB'de 3/375, 5 dB'de 9/375.
- **Seviye düşmesi (stres):** 60 FLEURS kaydı kendi seviyeleriyle art arda konunca (tepe −0,2 …
  −53,8 dBFS) Silero 567 s konuşmanın yalnızca **178 s**'sini geçirdi: yüksek sesli bir kayıttan
  sonra gelen 40 dB daha kısık kayıtların tamamı 0 olasılık aldı (aynı kayıtlar tek başına
  %50–90 konuşma olarak işaretleniyor). Her kayıt −3 dBFS'e getirilince 474 s geçti. Gerçek bir
  videoda tek dosya içinde 40 dB düşüş olağan değil, ama mikrofondan uzaklaşan ya da ikinci,
  kısık bir konuşmacı için risk gerçektir → uygulamada VAD'dan önce kaba seviye eşitleme
  denenmeli (ölçülmedi).
- **Korumanın attığı gerçek aralıklar** (gönderilecek bileşim, konuşma klipleri; boşluklardaki
  doğru atmalar hariç):

  | Model | Atılan gerçek aralık | Nerede |
  |---|---|---|
  | turbo | 5 aralık, 10 kelime, 6,3 s (4 279 referans kelimelik kümede) | val-pink-5'te 2 kısa aralık; long-a'da 3 kısa aralık ("The University of", "Words.", "again") |
  | base (Chromium/WebGPU) | 31 aralık, 296 kelime, 110 s (4 279 kelimede) | 19'u val-pink-5 (o klipte WER %52,9: model zaten anlamıyor); long-a 7, mix-clean 2, val-music-5 1, en-02 1, noisy-04 1 |
  | base (Chrome, Edge) | 2 aralık, 2 kelime (388 kelimede) | en-02 ve noisy-04'te 1,2 s'lik "August." aralığı |
  | base, small (Chromium/WASM q8) | 0 (874 kelimede) | — |
  | base (Firefox/WASM) | 3 aralık, 18 kelime (388 kelimede) | aynı ikisi + noisy-04'ün 6,6 s'lik ana aralığı |
  | small-fp16 | 14 aralık, 329 kelime, 36 s (kelimelerin çoğu müzik 0 dB'deki döngü metni) | long-a 6, val-pink-5 3, mix-clean 2 ("Lake!", "That?"), val-music-5 1, mix-music-0 1 (döngü), noisy-04 1 |

  Yani koruma `turbo` ile neredeyse bedelsiz; `base` ile temiz okumada da kısa aralıklar
  kaybediyor (long-a'da 7) ve ağır gürültüde (SNR 5 dB pembe gürültü) çok aralık atıyor. Bu, sessizce kaybolmamalı: atılan aralık transkriptte "(anlaşılamadı)" olarak
  kalır (Bölüm 11). 1–2 s'lik tek başına kalan kısa aralıklar en kırılgan olanlar.
- **Tekrar döngüsü:** small-fp16 müzik 0 dB'de bir pencerede döngüye girdi (298 kelime, zlib
  oranı 7,5, log-olasılık −0,27; WER %77,7). Log-olasılık bunu yakalamaz; zlib kuralı yakalar
  (gönderilecek bileşimde aynı klip %18,3). base ve turbo'da konuşma kliplerinde döngü görülmedi.
  Sıcaklık yedeği (Whisper'ın döngüden çıkma yolu) Transformers.js'te yok; denenmedi.

### 6.3 İngilizce doğruluk (Silero, 30 s paketleme; katı ölçü parantez dışında normalize)

| Klip | base | small-fp16 | turbo | distil-large-v3.5 | moonshine-base |
|---|---|---|---|---|---|
| Eylül'ün 6 temiz FLEURS klibi | 7,7 / **9,3** | 7,7 / 8,5 | 6,2 / **7,8** | 6,9 / 7,8 | 11,5 / 17,8 |
| long-a (8 dk, tek okuyucu) | 3,4 / 4,1 | 2,5 / 2,9 | 1,4 / 2,0 | 2,1 / 2,7 | 1,9 / 2,3 |
| long-b (8 dk) | 5,7 / 5,4 | 3,9 / 3,6 | 2,3 / 2,2 | — | — |
| long-c (18 dk, dört okuyucu) | 5,5 / 5,9 | — | — | — | — |
| long-fleurs (10 dk, 60 konuşmacı, noktalamalı) | 9,0 / 9,4 | 7,9 / 8,4 | 4,5 / 5,0 | 6,6 / 7,4 | 9,1 / 9,8 |
| mix-clean | 5,7 / 6,4 | 3,6 / 5,3 | 2,6 / 3,7 | 3,3 / 4,2 | 4,9 / 5,6 |
| müzik altında 20 / 10 / 5 dB (katı) | 9,0 / 8,8 / 9,3 | 5,6 / 6,1 / 6,4 | 3,4 / 3,7 / 3,7 | — / 3,7 / — | — / 5,8 / — |
| müzik altında 0 dB (katı) | 14,3 | 77,7 (döngü) | **4,2** | 6,4 | 8,8 |
| pembe gürültü 10 / 5 dB (katı) | 11,1 / 20,7 | 6,1 / 12,7 | 6,1 / 9,3 | — | — |

Gönderilecek bileşimle (aralık başına + koruma), doğrulama konuşması dahil (katı ölçü):

| Klip | base WebGPU | base WASM q8 | small WASM q8 | small-fp16 | turbo |
|---|---|---|---|---|---|
| Eylül'ün 6 temiz klibi | 9,3 | 9,3 (Firefox; koruma Chrome/Edge/Firefox'ta en-02'de 3 kelime attı) | — | 8,5 | 7,8 |
| long-a | 4,5 | — | — | 3,3 | 2,3 |
| mix-clean | 6,9 | — | — | 5,0 | 4,0 |
| müzik 0 dB | 14,3 | — | — | 18,3 | 4,2 |
| pause | 5,3 | 6,1 | 4,5 | 2,9 | 1,2 |
| **val-clean** (doğrulama) | **8,9** | **10,5** | 7,5 | 6,7 | **4,1** |
| val-music-5 | 11,0 | — | — | 7,9 | 4,8 |
| val-pink-5 | 52,9 | — | — | 18,3 | 9,8 |

Aralık başına çözme, paketlemeye göre WER'i biraz yükseltiyor (base long-a 4,1 → 4,5; turbo
2,0 → 2,3): kısa aralık bağlamını kaybediyor. Bedeli bu, kazancı uydurmanın sıfırlanması.

**Noktalama, büyük harf, sayılar** (long-fleurs + 7 kısa klip; referans → çıktı): cümle sonu
77 → base 79, small-fp16 74, turbo 81; virgül 77 → 75 / 77 / 83; referansta büyük harfle başlayan
ve doğru tanınan kelimelerde büyük harfin korunması %93 / %92 / %95; eşleşen kelimelerde aynı
yazım %98–99. Sayılar rakamla yazılıyor (referans 26 sayı → 25 / 28 / 31); katı ölçüdeki farkın
çoğu buradan ("25 to 30" ↔ "25 -30", "15 August" ↔ "August 15"). Moonshine noktalamada belirgin
zayıf (cümle sonu 77 → 50).

**Uzun dosyada kayma ve dikiş yerleri.** Kayma yok: kelime başlangıcının işaretli ortanca
hatası dosyanın ilk / orta / son üçte birinde base long-c'de +200 / +195 / +160 ms, turbo
long-b'de +188 / +212 / +271 ms (sabit gecikme, birikmiyor; her pencere kendi saatinde).
Dikişler (referans kelime hatası, dikişe ±1 s yakınken / uzakken): Silero paketlemede zorunlu
kesimler seyrek (base: 5 dosyada 12 kesim, 46 kelimede 2 hata, %4,3; uzakta %4,8); kütüphanenin
kendi 30 s / 5 s bindirmeli yolunda (`none`) dikiş çevresi daha kötü: base %7,0'e karşı %4,3,
turbo %4,7'ye karşı %1,6.

### 6.4 Kelime zamanı (referans: Montreal Forced Aligner, LibriSpeech)

Eşik: p95 ≤ 250 ms (ADR-017). Eşleşen kelimeler üzerinden.

| Model | Ham: başlangıç ortanca / p95 / işaretli ort. | Ham: ±250 ms içinde | long-a'da ölçülen sabit çıkarılınca, **diğer** kliplerde: başlangıç p95 | bitiş p95 | ±250 ms içinde (başlangıç / bitiş) |
|---|---|---|---|---|---|
| base (n = 4 964 uzun dosya kelimesi) | 184 ms / 408 ms / +209 ms | %70 | long-b+c 228; mix-clean 185; müzik 10 dB 194; müzik 0 dB 189; pause 242 ms | 294; 230; 244; 248; 259 ms | %96–99 / %93–95 |
| base, gönderilecek bileşim | 183 / 381 / +205 | %69 | mix-clean 186; müzik 0 dB 191; pause 240 | 222; 244; 235 | %96–99 / %95–98 |
| base WASM q8 | 190 / 399 / +213 | %67 | mix-clean 198 | 266 | %98 / %94 |
| small-fp16 (n = 2 304; "long-b+c" yalnız long-b) | 205 / 411 / +224 | %64 | 229; 186; 193; 189; 207 | 343; 286; 274; 241; 269 | %97–99 / %90–95 |
| turbo (n = 2 325) | 211 / 449 / +236 | %60 | long-b 284; 219; 218; 215; 243 | 411; 328; 288; 265; 305 | %94–98 / %84–94 |
| turbo, gönderilecek bileşim | 204 / 431 / +231 | %61 | mix-clean 218; müzik 0 dB 215; pause 239 | 304; 263; 283 | %96–98 / %93–94 |

- **Ham çıktı eşiği geçmiyor:** bütün kelimeler ~0,2 s geç (işaretli ortalama +205…+236 ms,
  model, gürültü ve dosya boyunca neredeyse sabit). Ön filtresiz yolda da aynı (base +207, turbo
  +233 ms): gecikme bizim pencere eşlememizden değil, bu dışa aktarımların çapraz-dikkat tabanlı
  kelime zamanından geliyor.
- **Sabit düzeltme:** sabit yalnız long-a'da ölçüldü (base 183–190 ms, small 198–200 ms, turbo
  204 ms) ve başka kliplerde yargılandı. `base`: başlangıç p95 185–242 ms → eşik altında; bitiş
  222–294 ms → 4 ölçümün 2'si üstünde. `turbo`: başlangıç 215–284 ms, bitiş 263–411 ms → eşik
  üstünde kalanlar var. Ortanca hata düzeltmeyle 60–90 ms.
- Segment zamanı (kelime zamanı kapalı; distil modellerin tek verebildiği): segment bitişi p95
  ~1,1 s — altyazı için yetersiz. Kelime zamanının hız bedeli küçük: base long-a 0,215 → 0,166,
  small-fp16 0,328 → 0,305 (kapalıyken).
- Moonshine zaman vermez; yalnız kendisine verilen aralığın sınırları bilinir.

### 6.5 Bellek: Eylül'deki 8,6 GiB'ın açıklaması

Transformers.js 4.3.0, `return_dict_in_generate` açıkken (kelime zamanı bunu açar) decoder'ın
anahtar/değer önbelleğini çağırana geri verir ve **hiç bırakmaz**; WebGPU'da bunlar ekran kartı
arabellekleridir ve her `generate()` çağrısında bir tane sızar. Ölçüm (small-fp16, WebGPU, 13 dk
ses): olduğu gibi **10 332 MiB** özel bayt, ekran kartı belleği 1 443 → **7 764 MiB** (8 GB kart
doldu); önbellek her pencereden sonra bırakılınca aynı model 56 dk seste **4 218 MiB**, ekran
kartı 1 527 → 3 410 MiB. Düzeltme düzenekte (`engine.js`, `trackDecoderCaches`); uygulamaya
taşınmalı ve kütüphaneye bildirilmeli.

### 6.6 Boyut, hız, bellek

Hız = işlem süresi / ses süresi (RTF), VAD dahil (VAD payı sesin %0,8–1,8'i), no-speech ölçüm
adımı hariç. "Uzun" = long-* klipleri (sık konuşma). Bellek: tarayıcı süreç ağacı, taban → tepe.

| Model | Cihaz | İndirme | Yükleme soğuk / sıcak (yerel aynadan) | RTF uzun | Bellek | Ekran kartı belleği |
|---|---|---|---|---|---|---|
| base | WASM q8, 12 iş parçacığı | 80 MB | 1,8 s / 1,0 s | 0,185 | 321 → 1 544 MiB | — |
| base | WASM q8, 4 iş parçacığı | 80 MB | 1,8 / 1,1 | 0,200 (mix-clean) | 321 → 1 546 MiB | — |
| base | **WASM q8, yalıtımsız (tek iş parçacığı)** | 80 MB | 2,0 / 1,7 | **0,280** (mix-clean) | 318 → 1 082 MiB | — |
| base | WebGPU fp32/q4 | 209 MB | 4,6 / 2,2 | 0,215 | 318 → 3 038 MiB | 1 667 → 3 049 MiB |
| base | WebGPU fp32/q4, yalıtımsız | 209 MB | 2,8 / 2,2 | 0,195 (mix-clean) | 318 → 2 905 MiB | 1 314 → 2 179 MiB |
| base-fp16 | WebGPU fp16/q4f16 | 113 MB | 3,9 / 1,7 | 0,187 | 327 → 1 843 MiB | 1 949 → 2 515 MiB |
| small | WASM q8, 12 iş parçacığı | 252 MB | 3,5 / 1,7 | 0,413 | 319 → 2 556 MiB | — |
| small | WASM q8, 4 iş parçacığı | 252 MB | 3,1 / 1,7 | 0,421 (mix-clean) | 346 → 2 660 MiB | — |
| small (Eylül ağırlıkları) | WebGPU fp32/q4 | 589 MB | 6,8 / 5,6 | 0,412 | 324 → 4 308 MiB | 1 743 → 3 817 MiB |
| small-fp16 | WebGPU fp16/q4f16 | 325 MB | 4,7 / 3,9 | 0,328 | 342 → 4 218 MiB | 1 527 → 3 410 MiB |
| turbo | WebGPU q4f16 | 566 MB | 10,6 / 7,4 (ikinci koşuda 4,1 / 3,8) | 0,204 (bileşimle 0,249) | 324 → 3 776 MiB | 1 877 → 3 573 MiB |
| distil-small.en | WebGPU fp16/q4 | 364 MB | 4,8 / 2,7 | 0,077 | 322 → 3 620 MiB | 1 950 → 3 091 MiB |
| distil-large-v3.5 | WebGPU q4f16 | 538 MB | 5,7 / 4,7 | 0,095 | 319 → 3 698 MiB | 1 596 → 3 484 MiB |
| moonshine-base | WebGPU fp32/q4 | 157 MB | 3,2 / 1,9 | 0,097 | 327 → 2 495 MiB | 1 683 → 2 998 MiB |
| moonshine-base | WASM q8 | 67 MB | 3,8 / 2,8 | 0,190 | 324 → 949 MiB | — |
| moonshine-tiny | WebGPU fp32/q4 | 79 MB | 2,4 / 1,5 | 0,084 | 320 → 2 104 MiB | 2 042 → 2 756 MiB |

- **WASM iş parçacığı sayısı neredeyse fark etmiyor:** base 12 → 4 → 1 iş parçacığında 0,19 →
  0,20 → 0,28; small 12 → 4'te 0,41 → 0,42. Süreyi decoder'ın tek tek token adımları belirliyor.
  Sonuç: `crossOriginIsolated` olmayan bir sitede (GitHub Pages) WASM yolu **kullanılabilir**.
  Bu "dizüstü yaklaşığı" değildir: tek bir i5-12500 çekirdeği çoğu dizüstü çekirdeğinden
  hızlıdır; dizüstünde 2–3 kat yavaş olması beklenir, **ölçülmedi**.
- WebGPU bu kütüphanede WASM'den hızlı değil (base 0,19–0,27'ye karşı 0,19): her token adımında
  ekran kartından geri okuma var. WebGPU'nun getirdiği şey `turbo`'yu mümkün kılması.
- Yükleme süreleri yerel aynadandır; ağ süresi yok. Aynalarken Hugging Face'ten ~10 MB/s görüldü
  (80 MB ≈ 8 s, 566 MB ≈ 1 dk — bu makinenin hattında).
- Chrome 154 ve Edge 154 (WebGPU, base, gönderilecek bileşim) Chromium ile aynı WER'i verdi
  (6 temiz klip %9,3, pause %5,3); bellek tepe 3 938 / 2 804 MiB. Firefox 155 (Playwright
  derlemesi, WASM): %9,3 / %6,1, 1 653 MiB. Firefox WebGPU ölçülmedi (Eylül'de 17 kat yavaştı).

### 6.7 Sonuçların güvenilirliği üzerine notlar

- Makine doluluğu: koşu öncesi %15–68, koşu sırasında %37–95 (WASM koşularında bir kısmı kendi yükümüz). Hızlar kötümser.
- Müzik çeşitliliği dar: beş parça (ikisi yalnız doğrulamada), biri sentetik. Vokalli müzik
  (şarkı sözü) negatif olarak ölçülmedi — orada "uydurma" tanımı da değişir.
- Konuşma verisi okunmuş kitap (LibriSpeech) ve okunmuş cümle (FLEURS): kendiliğinden konuşma,
  üst üste konuşma, aksanlı İngilizce, telefon mikrofonu yok.
- `negh` kümesi kural seçilirken görüldü; kuralın bağımsız sınaması `negv` ve `val`'dır.

### 6.8 Gerçek çıktıdan altyazı satırı ve transkript satırı örnekleri

turbo, long-fleurs, 0–34 s (`node segment-lines.mjs …turbo-silero.json long-fleurs 0 34`):

```
Altyazı satırları (2 × 32 karakter):
00:01.38 → 00:04.57  However, due to the slow / communication channels,
00:04.82 → 00:09.05  styles in the West could / lag behind by 25 -30 years.
00:12.05 → 00:16.49  All nouns alongside the world / say for you always begin with a
00:16.49 → 00:19.24  capital letter, even in / the middle of a sentence.
00:21.14 → 00:24.18  To the north and within easy / reach is the romantic and
00:24.18 → 00:27.84  fascinating town of Sintra / and which was made famous to
00:27.84 → 00:30.42  foreigners after a glowing / account of its splendorous
00:30.42 → 00:31.75  recorded by Lord Byron.

Transkript satırları:
00:01.38  However, due to the slow communication channels, styles in the West could lag behind by 25
00:08.06  -30 years.
00:12.05  All nouns alongside the world say for you always begin with a capital letter, even in the
00:18.09  middle of a sentence.
00:21.14  To the north and within easy reach is the romantic and fascinating town of Sintra and
```

Örnekler taslak kuralların eksiklerini de gösteriyor: "25 / -30 years." gibi bir sayının ortasından
bölme ve 90 karakterde kör kesme düzeltilmeli (sayı ve kısa son parça bir önceki satıra
bağlanmalı); "the word Sie" → "the world say" bir tanıma hatası. Bütün dosyada: turbo long-fleurs
1 260 kelime → 167 satır (dakikada 16,5), süre ortanca 2,75 s, en uzun 5,51 s, 0,8 s'den kısa 3
satır, 32 karakteri aşan satır 0; base long-a (gönderilecek bileşim) 1 238 kelime → 159 satır
(dakikada 19,7); turbo long-a 167 satır (dakikada 20,7).

## 7. Görevdeki sorulara kısa yanıtlar

1. **Uydurmayı ne öldürür?** Tek başına hiçbiri: kendi bulucumuz (hayır), Silero (çoğunu),
   Whisper'ın yayınlanmış kuralı (bu modellerde hayır). Üçlü gerekir: Silero + aralık başına
   çözme + log-olasılık/döngü kuralı. `condition_on_previous_text` bu kütüphanede zaten yok.
2. **Gerçekçi uzunlukta İngilizce:** 8–18 dakikalık dosyalarda kayma yok, dikişler sorun değil;
   turbo %2–5, base %4–9 (katı).
3. **Zamanlama:** Bölüm 6.4.
4. **Modeller:** Bölüm 6.6; distil ve Moonshine elendi (zaman yok, koruma kurulamıyor).
5. **Telefon:** ölçülmedi.
6. **Türkçe:** Bölüm 9.
7. **Model nereden:** Bölüm 8.

## 8. Model dosyası nereden gelecek?

Uygulamanın CSP'si (`default-src 'self'`, `connect-src 'self'`, `script-src 'self' + hash`,
`worker-src 'self' blob:`) bugün dışarıya hiçbir isteğe izin vermez. Üç seçenek:

| | (a) Model dosyaları uygulamayla aynı adreste (GitHub Pages) | (b) Hugging Face'ten, açık kullanıcı eylemiyle | (c) GitHub Release dosyası / başka ücretsiz barındırıcı |
|---|---|---|---|
| Çalışır mı? | Evet, ama **git'e konamaz**: GitHub 100 MiB üstü dosyayı reddeder (50 MiB üstünde uyarır); turbo'nun encoder'ı 370 MB, small'unki 176 MB. Git LFS dosyalarını Pages sunmaz (görev tanımındaki bilgi; ayrıca doğrulanmadı). Yol: CI, derleme sırasında dosyaları sabit revizyondan indirip sha256'sını doğrular ve Pages yapıtına (`out/`) ekler — yayın zaten `upload-pages-artifact` ile yapılıyor, yapıt git deposu değil. **Bir yayınla denenmedi.** | Evet. Bu oturumda ölçüldü: `huggingface.co/.../resolve/<revizyon>/...` isteği `Origin: https://erenulutas0.github.io` ile 302 → `us.aws.cdn.hf.co`; ilk yanıt `Access-Control-Allow-Origin: https://erenulutas0.github.io`, dosya yanıtı `Access-Control-Allow-Origin: *`. | **Release dosyası çalışmaz.** Ölçüldü: `github.com/.../releases/download/...` → `release-assets.githubusercontent.com`, yanıtta `Access-Control-Allow-Origin` yok; sayfadan `fetch` CORS'a takılır. Başka barındırıcı (Cloudflare R2/Pages vb.) hesap açmayı gerektirir — kapsam dışı. |
| Sınırlar | Pages: yayınlanan site ≤ 1 GB; ayda 100 GB "yumuşak" bant genişliği sınırı; yayın 10 dk'da bitmeli (GitHub belgeleri, 3 Ekim 2026). 100 GB/ay ≈ base-fp16 (113 MB) için ~880 indirme, turbo (566 MB) için ~175 indirme. Tek model + site 1 GB'a sığar; iki büyük model sığmaz. | Bizim sınırımız yok; Hugging Face'in anonim indirme sınırı ve sürekliliği bizim elimizde değil. Dosya adresleri değişebilir (HF belgeleri: "These hostnames may change") — CSP istisnası `*.hf.co` olmak zorunda. | — |
| Gizlilik | Yeni dış istek **yok**. Gizlilik sayfasında değişen tek şey: tarayıcıda saklananlar listesine "konuşma modeli" eklenir. | **Yeni üçüncü taraf:** kullanıcının IP adresi, istek zamanı ve tarayıcı bilgisi Hugging Face'e ve onun CDN sağlayıcısına (AWS/GCP) gider. Medya ve metin gitmez. Gizlilik sayfası ve `connect-src` değişir; kurucu kararı. | — |
| Bütünlük | Aynı origin; yine de sha256 doğrulaması ucuz. | Revizyon sabitlenir ve indirilen her dosyanın sha256'sı uygulamadaki listeyle karşılaştırılır; tutmazsa kullanılmaz. | — |
| CSP | `connect-src` değişmez. | `connect-src 'self' https://huggingface.co https://*.hf.co` | — |

**İki seçenekte de zorunlu olan, barındırmadan bağımsız CSP değişikliği:** onnxruntime-web WebAssembly
derler; `script-src`'ye **`'wasm-unsafe-eval'`** eklenmeden çalışmaz (bu yalnızca WebAssembly
derlemesine izin verir, `eval`'e değil). ORT'nin `.wasm`/`.mjs` dosyaları da jsDelivr'den değil
kendi adresimizden sunulur (`env.backends.onnx.wasm.wasmPaths`), yoksa o da bir dış istek olur.
Bunlar bu denemede **yapılmadı** (CSP'ye dokunulmadı); uygulamanın ilk adımıdır ve güvenlik
belgesine yazılmalıdır.

**Çok iş parçacıklı WASM, GitHub Pages'te bugün yok.** `SharedArrayBuffer` için sayfanın
`crossOriginIsolated` olması, onun için de COOP/COEP *başlıkları* gerekir; Pages başlık gönderemez.
WebGPU yolu bundan etkilenmez; WASM yolu tek iş parçacığına düşer (ölçüm Bölüm 6.6). Çare: mevcut
service worker'ın yanıtlarına COOP/COEP eklemesi (yaygın bir yöntem) — ayrı bir güvenlik kararı,
ölçülmedi.

**Öneri: (a).** Uygulamanın en değerli sözü "hiçbir şey dışarı çıkmaz, başka hiçbir yere istek
atılmaz"; (a) onu bozmadan kalır ve tek bir modelle Pages sınırlarına sığar. Beta ölçeğinde
100 GB/ay yeter; aşılırsa (b)'ye geçmek tek satırlık bir adres değişikliğidir (aynı dosyalar, aynı
sha256). (a)'nın gerektirdiği metin değişiklikleri:

- `script-src`: `'self' 'wasm-unsafe-eval' 'sha256-…'` (gerekçe satırı: "konuşma modeli
  WebAssembly ile çalışır").
- Gizlilik sayfası, "tarayıcında saklananlar" listesine: *"Konuşma modeli: 'Modeli indir'e
  bastığında bu sitenin sunucusundan indirilen model dosyaları (yaklaşık X MB). Videon ya da sesin
  değil; yalnızca uygulamanın kendi dosyası. Ayarlardan silebilirsin."* ve ağ bölümüne: *"Yazıya
  çevirme bu cihazda yapılır; ses, görüntü ya da metin hiçbir yere gönderilmez."*
- (b) seçilirse ek olarak: *"Modeli indirirken tarayıcın huggingface.co'ya bağlanır; bu sırada IP
  adresin ve tarayıcı bilgin Hugging Face'e görünür. Videon, sesin ve metnin gitmez."*

**Kurucunun vermesi gereken karar:** (1) `'wasm-unsafe-eval'` eklenmesi (kaçınılmaz); (2) model
(a) kendi sitemizden mi (öneri), (b) Hugging Face'ten mi; (3) hangi model(ler) — Bölüm 10.

## 9. Türkçe (kısa; engel değil)

Eylül'ün Türkçe kümesi (12 temiz + 3 gürültülü FLEURS klibi), katı ölçü, WebGPU:

| Model | Ön filtre | WER temiz | CER temiz | WER gürültülü | RTF |
|---|---|---|---|---|---|
| small-fp16 | yok | %22,5 | %5,2 | %43,1 | 0,44 |
| small-fp16 | Silero | %20,6 | %4,9 | %35,3 | 0,47 |
| **turbo** | yok | **%7,7** | %2,0 | %17,6 | 0,27 |
| **turbo** | Silero | **%7,2** | %1,8 | %15,7 | 0,29 |

`whisper-large-v3-turbo` (q4f16, 566 MB, WebGPU) Türkçe temiz kümede %10 eşiğinin altında —
Eylül'ün en iyi sonucu %20,6'ydı. **Türkçe cihaz üstünde erişilebilir, ama yalnız turbo ile:**
566 MB indirme, WebGPU + `shader-f16` şart, WASM yolu yok. Kayıtlar: küme küçük (12 klip)
ve okunmuş cümle; Türkçe için negatif/koruma doğrulaması, uzun dosya ve kelime
zamanı **ölçülmedi** (koruma eşiği İngilizce veriden seçildi). Türkçeye ince ayarlı model:
`selimc/whisper-large-v3-turbo-turkish` (MIT) var, fakat tarayıcıya uygun dışa aktarımı yok
(`OpenVoiceOS/…-turkish-onnx`: fp32 3,3 GB, int8 842 MB, Transformers.js düzeninde değil); yerel
dışa aktarma torch + optimum kurulumu ister, **yapılmadı**.

## 10. Eşiklere karşı hüküm ve bir eşik tartışması

ADR-017 eşikleri değiştirilmedi. Sonuç Bölüm 1'deki tablodadır; gerekçeler:

- **WER ≤ %10 (temiz İngilizce).** `turbo` her temiz kümede geçiyor (katı %2,0–7,8). `base`
  sınırda: temiz kümelerde %4,1–10,5; biri eşiğin üstünde (doğrulama konuşması, WASM q8: %10,5), dördü
  %9'un üstünde. "Geçti" demek için `base`'e güvenmiyorum; "taslak olarak kullanılabilir" diyorum.
- **Negatiflerde uydurma yok.** Gönderilecek bileşimle üç modelde ve dört tarayıcıda 0. Bu,
  Eylül'ün engelleyici bulgusuydu. Sınırı: beş müzik parçası; vokalli müzik yok.
- **Kelime zamanı p95 ≤ 250 ms.** Ham çıktı geçmiyor (369–449 ms). Sabit düzeltme dürüst bir
  mühendislik adımıdır (ayrı dosyada ölçülüp ayrı dosyalarda sınandı), ama eşiği *tam* tutturan
  yalnız `base`'in başlangıç zamanlarıdır.
  **Ayrı öneri (eşiği sessizce oynatmıyorum):** eşik iki işe hizmet ediyor — satıra tıklayınca
  doğru yere gitmek ve altyazının sözle birlikte görünmesi. İkisi de *başlangıç* zamanına bağlı;
  bitiş zamanı altyazıda zaten "son kelimeden 0,15 s sonra" kuralıyla yumuşatılıyor. Eşiğin
  "başlangıç p95 ≤ 250 ms, bitiş p95 ≤ 400 ms" olarak yazılması ölçülen kullanıma daha uygun
  olur; bu hâliyle `base` geçer, `turbo` başlangıçta bir dosyada (284 ms) ve bitişte bir dosyada
  (411 ms) dışarıda kalır. Karar kurucunun; kabul edilmezse altyazı "taslak, toplu kaydırılabilir"
  (ADR-016 `shiftCaptions`) olarak çıkar.
- **Bellek ve hız.** `base`/WASM 1,1–1,5 GiB ve 0,19–0,28× — 8 GB'lık bir dizüstünün
  kaldırabileceği bir yük; `turbo` 3,7 GiB + ~1,5 GB ekran kartı belleği — ayrık ekran kartlı ya
  da 16 GB'lık makineler için. İkisi de bu masaüstünde ölçüldü.

**Cihazlara göre:**

| Cihaz | Hüküm | Dayanak |
|---|---|---|
| WebGPU'lu masaüstü (Chrome/Edge) | **SHIP**: `turbo` (kalite) ya da `base` | ölçüldü |
| WebGPU'suz masaüstü, Firefox | **SHIP**: `base` WASM | Chromium ve Firefox'ta ölçüldü; yalıtımsız tek iş parçacığı dahil |
| Dizüstü | **bilinmiyor** — `base` WASM'in çalışması beklenir | ölçülmedi; iş parçacığı sayısına duyarsızlık lehte bir işaret |
| Telefon (S23) | **bilinmiyor** | ölçülmedi |

Bilinmeyen cihazlarda özellik, ilk çalıştırmada kısa bir ölçümle (örn. 10 s'lik sesi çözme süresi)
kendini sınayıp yavaşsa "bu cihazda önerilmez" demeli; sessizce yavaş çalışmamalı.

## 11. Uygulama planı (karar SHIP ise; bu bir plan, uygulama değil)

**1. Worker mimarisi.** Yeni adaptör `web/src/adapters/transcript/` (sessizlik adaptörünün
kalıbı): `protocol.ts`, `transcriptClient.ts`, `transcriptWorker.ts`. Worker şunları yapar:
(1) seçilen kaynağın sesini `mediabunny` `AudioSampleSink` ile akış hâlinde çözer (sessizlik
worker'ındaki gibi, kesin okuma), 16 kHz mono'ya indirger; (2) Silero VAD'ı çalıştırır;
(3) her konuşma aralığını tek tek modele verir; (4) koruma kuralını uygular; (5) kelimeleri kaynak
mikrosaniyesine çevirip parça parça ana iş parçacığına yollar (`progress`, `words`, `done`,
`failed`). İptal = `terminate()`; kısmi sonuç kaydedilmez (ADR-017). Transformers.js ve
onnxruntime-web yalnızca bu worker'ın dinamik `import()`'unda yüklenir; editörün ilk paketine
girmez. Düzenekteki iki düzeltme aynen taşınır: **decoder önbelleğinin her pencereden sonra
bırakılması** (yoksa bellek sızar, Bölüm 6.5) ve logits kaydedici (güven sayısı için).
Cihaz seçimi: `navigator.gpu` + `shader-f16` varsa WebGPU, yoksa WASM; hangisinin seçildiği
arayüzde yazar. Bellek korkuluğu: `navigator.deviceMemory` düşükse yalnızca küçük model önerilir.

**2. Model indirme.** Otomatik indirme yok. Transkript panelinde: "Yazıya çevirmek için konuşma
modeli gerekir. **Modeli indir, ~X MB**" düğmesi; ilerleme (bayt / toplam, iptal); bitince
her dosyanın sha256'sı doğrulanır. Saklama yeri: **Cache Storage'da ayrı bir önbellek**
(`clip-models-v1`), service worker'ın `clip-app-*` önbelleğinden bağımsız (ADR-031: worker yalnız
uygulama dosyalarını saklar ve yalnız kendi önbelleklerini siler — model önbelleğine dokunmaz, ön
yükleme listesine model girmez). `navigator.storage.persist()` istenir; kalan alan
`storage.estimate()` ile indirmeden önce denetlenir (ADR-023 payı). "Kısayollar ve sınırlar"
penceresinde "Konuşma modelini sil (X MB)". Çevrimdışıyken model önbellekteyse özellik çalışır.

**3. Veri şekli.** Transkript, gösterilen altyazıdan ayrıdır (ADR-009 §1). Öneri (şema değişikliği
ayrı ADR ve kurucu onayı ister):

```ts
interface TranscriptWord { startUs: Micros; endUs: Micros; text: string }        // kaynak saati
interface TranscriptSegment { segmentId: string; startUs: Micros; endUs: Micros; words: TranscriptWord[]; state: 'ok' | 'unclear' }
interface TranscriptV1 { transcriptId: string; assetId: string; language: 'en'; model: string; modelRevision: string; createdBy: 'on-device'; segments: TranscriptSegment[] }
```

- Bir `TranscriptSegment` = bir konuşma aralığı (VAD). Koruma kuralının attığı aralık atılmaz,
  `state: 'unclear'` ve boş `words` ile tutulur: panelde "(anlaşılamadı)" satırı olarak görünür,
  kullanıcı dinleyip elle yazabilir. Sessizce yok etmek yerine görünür kılmak, korumanın gerçek
  konuşmayı atması hâlinde tek güvencedir.
- **Altyazı izi:** `toCues(transcript)` → `CaptionTrackV2 { timeBase: 'source', assetId, origin, language: 'en', cues }`.
  `origin` için yeni değer (`'transcript'`) gerekir (bugün `'manual' | 'imported'`). Aynı iz,
  mevcut `outputCues` üzerinden önizlemeye, videoya işlemeye ve SRT/VTT dışa aktarmaya gider —
  yeni bir zaman eşlemesi yazılmaz (ADR-016).
- **Sınır:** `maxCuesPerTrack` 500. Ölçülen: dakikada 16,5–20,7 satır (Bölüm 6.8); 500 satır ≈
  24–30 dakika sık konuşma. Daha uzun kaynak için ya sınır yükseltilir ya da altyazı yalnız
  tutulan kesitler için üretilir (ADR-017'nin varsayılanı zaten "yalnız tutulan anların sesi").
- **Sabit zaman düzeltmesi:** bu dışa aktarımların kelime zamanları ~0,2 s geç (Bölüm 6.4);
  model başına ölçülmüş sabit, kelimeler transkripte yazılırken çıkarılır (aralığın kendi
  sınırlarının dışına taşmadan).

**4. Altyazı satırı kuralları** (`web/spike/asr/segment-lines.mjs` taslağı; gerçek çıktı örnekleri
Bölüm 6.8):
- en çok 2 satır × 32 karakter (9:16 kare; uygulamanın 120 karakter / 2 satır sınırının içinde);
- satır cümle sonunda (. ? !), ≥ 0,5 s duraklamada, sığmayınca ya da 6 s'yi aşınca biter; yarıdan
  fazlası doluysa virgülde de biter;
- satır, son kelimesinden 0,15 s sonra kalkar, bir sonrakinin üstüne binmez; arası elveriyorsa en
  az 0,8 s görünür (uygulamanın alt sınırı 0,2 s);
- iki satıra bölme: en dengeli yerden, noktalama sonrası tercih edilir;
- satır hiçbir zaman bir VAD aralığının dışına uzatılmaz.

**5. Transkript paneli.** Videonun yanında (dar ekranda altında) yukarıdan aşağı akan satırlar:
`0:12  metin`. Satır = cümle (0,8 s duraklamada ya da 90 karakterde erken kesilir).
- Satıra tıklama → oynatma o satırın başlangıcına gider (kaynak zamanı → `mapSourceToOutput`;
  satır hiçbir kesitte değilse kaynak önizlemesinde gösterilir, soluk yazılır).
- Etkin satır oynatmayı izler: oynatma kafasının altındaki satır vurgulanır ve görünür alana
  kaydırılır; kullanıcı elle kaydırırsa otomatik kaydırma "Şimdiye dön" düğmesine kadar durur.
- Satır seçme (tıkla, Shift ile aralık) → **"Seçilenlerden kesit yap"**: bitişik seçili satırlar
  tek kesit olur (ilk kelimenin başı − 0,15 s … son kelimenin sonu + 0,15 s); tek geri alma adımı;
  20 kesit sınırı aynen geçerli (aşılırsa sayısı söylenir).
- Metin düzeltme: satıra çift tıklayınca düzenlenir; düzeltme transkripti değiştirir, kelime
  zamanları satır içinde orantılı dağıtılır. "Altyazıya çevir" ayrı, açık bir eylemdir.
- Dürüstlük: panel başlığında "Taslak — bu cihazda üretildi, hata olabilir"; `unclear` satırlar
  ayrı renkte; model ve süre bilgisi görünür.

**6. Sıra.** (i) CSP + model barındırma kararı ve Pages'te bir deneme yayını; (ii) worker +
indirme arayüzü, `web/spike/asr` ölçümleriyle aynı çıktıyı veren bir e2e (aynı klip, aynı metin);
(iii) şema ADR'si (`transcripts[]`, `origin: 'transcript'`, satır sınırı); (iv) panel; (v) altyazıya
çevirme; (vi) telefon ve dizüstü ölçümü (bu denemede yok) — sonuç kötüyse o cihazlarda özellik
"desteklenmiyor" der, sessizce yavaş çalışmaz.

## 12. Ölçülmeyenler

- **Telefon** (S23) ve **dizüstü**: hiç. İş parçacığı kısıtlaması (4 ve 1) masaüstü işlemcisinde
  yapıldı; dizüstü yaklaşığı değildir.
- **Boş makinede hız:** bütün RTF'ler dolu bir makinede (koşu sırasında %37–95) alındı.
- **Ağdan gerçek indirme süresi** ve Hugging Face'in anonim indirme sınırları.
- **(a) barındırmanın bir Pages yayınıyla denenmesi**, 100 MB üstü dosyanın Pages yapıtında
  sorunsuz sunulması, Git LFS'in Pages'te sunulmadığı bilgisi.
- **CSP altında çalışma:** `'wasm-unsafe-eval'` ile uygulamanın gerçek CSP'si altında deneme
  yapılmadı (düzenek sayfasında CSP yok); service worker ile COOP/COEP ekleme denenmedi.
- **Sıcaklık yedeği / döngüden çıkma** (kütüphanede yok), VAD öncesi seviye eşitleme.
- **Vokalli müzik, kendiliğinden konuşma, üst üste konuşma, aksan, telefon mikrofonu, video
  dosyasından (AAC) çözülen ses** — bütün ses 16 kHz WAV'dı.
- **20 dakikadan uzun dosya** (en uzun 18,4 dk); `turbo` için long-c koşulmadı.
- **Gönderilecek bileşimle** `base-fp16` (113 MB WebGPU dosyaları), Chrome/Edge'de `turbo`,
  Firefox WebGPU.
- **Türkçe:** koruma/negatif doğrulaması, uzun dosya, kelime zamanı, ince ayarlı model.
- **Elle işaretlenmiş kelime zamanı:** referans zorla hizalamadır.
- **İnsan değerlendirmesi:** altyazı satırlarının okunabilirliği, "anlaşılamadı" satırlarının
  kabul edilebilirliği.
- **Ücretli hizmetler:** çağrılmadı; karşılaştırma ölçümü yok.

## 13. Yeniden üretme

```
cd web/spike/asr
npm install                               # transformers 4.3.0, playwright 1.63.0, typescript 5.9.3 (yalnız bu klasör)
python -m venv .venv && .venv/Scripts/pip install whisper-normalizer   # yalnız puanlama
node prepare-speech.mjs && node prepare-english.mjs     # ~1 GB indirir (LibriSpeech + hizalamalar), klipleri kurar
node mirror-models.mjs --models=silero-vad,base,small,base-fp16,small-fp16,distil-small.en,moonshine-tiny,moonshine-base,turbo,distil-large-v3.5
bash matrix-2026-10-03.sh A               # WebGPU + Silero, bütün modeller
bash matrix-2026-10-03-rest.sh B|E|F      # ön filtresiz ve kendi bulucumuz; sızıntı ve kelime zamanı bedeli; Türkçe
bash matrix-2026-10-04-final.sh           # gönderilecek bileşim (doğrulama kümesiyle), WASM, diğer tarayıcılar
node vad-dump.mjs                         # Silero ayar taraması (tarayıcısız)
node summarize-en.mjs && node guard-margins.mjs && node report-facts.mjs
node segment-lines.mjs <sonuç.json> <klip> [başlangıç] [bitiş]
node run-phone.mjs                        # telefon bağlıysa
```
