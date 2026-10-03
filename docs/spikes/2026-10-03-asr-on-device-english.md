# Uygunluk denemesi 2 — cihaz üstü İngilizce transkript (ön filtre, uzun dosya, kelime zamanı)

> Tarih: 2026-10-03 · Bağlam: ADR-017, kurucu kararı (3 Ekim 2026): YouTube tarzı transkript paneli +
> otomatik altyazı, **şimdilik yalnız İngilizce**, bütçe 0, medya cihazdan çıkmaz.
> Önceki deneme: `docs/spikes/2026-09-21-asr-on-device.md` (geçmedi: uydurma metin, Türkçe WER, bellek).
> Bu belgedeki her sayı `web/spike-results/asr-2026-10-03-*.json` ham dosyalarından
> `node web/spike/asr/summarize-en.mjs` ile üretilmiştir; tahmin yoktur. Bitmeyen koşuların sayısı
> kullanılmadı. Ölçülmeyenler "Ölçülmeyenler" bölümünde.

> **DURUM: ARA KAYIT (4 Ekim 2026, 01:40) — belge bitmedi.** Bilgisayar kapatıldığı için deneme
> yarıda kesildi. Bölüm 1 (özet/karar), 6–7 (sonuç tabloları), 9 (Türkçe), 10 (hüküm), 12
> (ölçülmeyenler) henüz yazılmadı; Bölüm 11'deki `SEG-PER-MIN` / `SEG-MINUTES` yer tutucudur.
>
> **Biten ölçümler** (ham dosyalar `web/spike-results/asr-2026-10-03-chromium-webgpu-…json`,
> hepsinde `complete: true`; `node web/spike/asr/summarize-en.mjs` tablolarını üretir):
> - A (WebGPU + Silero): `base-silero`, `base-fp16-silero`, `turbo-silero`, `distil-small.en-silero`,
>   `distil-large-v3.5-silero`, `moonshine-base-silero`, `moonshine-tiny-silero`, `small-silero`
>   (Eylül ağırlıkları, kısa küme); yükleme hatası kaydı `distil-small.en-fp16dec-load-failed`.
> - B (ön filtresiz ve kendi bulucumuz): `base-none`, `small-fp16-none`, `turbo-none`,
>   `distil-small.en-none`, `moonshine-base-none`, `base-own`, `base-ownabs`, `small-fp16-own`,
>   `small-fp16-ownabs`.
> - E: `small-fp16-silero-leak`, `small-fp16-silero-segts`, `base-silero-segts`.
> - F (Türkçe): `turbo-silero-tr`, `turbo-none-tr`, `small-fp16-silero-tr`, `small-fp16-none-tr`.
> - G (gönderilecek bileşim, doğrulama kümesi dahil): yalnız `base-silero-ship`.
> - Tarayıcısız: `asr-2026-10-03-vad-dump.json` (eski kümeyle; `negv`/`val` ve seviye eşitlenmiş
>   long-fleurs eklendikten sonra **yeniden koşulmalı**).
>
> **Bitmeyen / hiç başlamayan — yeniden koşulacak** (`bash web/spike/asr/matrix-2026-10-04-final.sh`;
> bitmiş dosyaları atlar): `turbo` gönderilecek bileşim (koşu kilit sırasındayken durduruldu, dosyası
> yok), WASM'in tamamı (hız, bellek, 4 iş parçacığı, yalıtımsız tek iş parçacığı, WASM'de
> gönderilecek bileşim), Chrome / Edge / Firefox, `small-fp16` gönderilecek bileşim, Moonshine
> aralık başına, ve `small-fp16-silero` İngilizce koşusu (Türkçe koşu dosyasının üzerine yazmıştı;
> o sayılar kullanılmaz). Telefon: ölçülmedi (kilit sırası, sonra USB bağlantısı yok).
> `web/spike-results/aborted/` ve `asr-2026-10-03-summary.*` içindeki eski özetler kullanılmaz.
>
> **Biten sayılarla şimdiden söylenebilen (kesin hüküm değil):**
> - Ön filtresiz Whisper 11 negatifin 9–11'inde, ayrılmış 6'nın 5–6'sında metin uyduruyor (Eylül
>   bulgusu doğrulandı). Kendi sessizlik bulucumuz bunu çözmüyor (7–11/11).
> - Silero tek başına yetmiyor: gerçek müziğin bir kısmını konuşma sanıyor; base ve turbo 17
>   negatifin 2–4'ünde yine yazdı. Whisper'ın yayınlanmış kuralı (no-speech > 0,6 **ve** log-olasılık
>   < −1) base ve turbo'da 0'a inmiyor (turbo'nun no-speech olasılığı hep 0,00).
> - **Silero + her konuşma aralığını ayrı çözme + "ortalama log-olasılık < −0,75 ya da tekrar
>   döngüsü → at" kuralı, `base` ile: 11 + 6 + 8 (kural sabitlendikten sonra üretilen doğrulama)
>   negatifin 25'inde uydurma 0; duraklama kliplerinde boşluklara yazılan kelime 0.** Bedeli: 223
>   konuşma aralığının 37'si atıldı (301 kelime); 19'u pembe gürültü 5 dB'lik doğrulama klibinde
>   (o klipte WER %52,9), temiz ve müzikli konuşmada 1 gerçek aralık. `turbo` için aynı doğrulama
>   **henüz yok**.
> - İngilizce WER (katı ölçü, Silero, WebGPU): turbo uzun dosyalarda %2,0–5,0, müzik 0 dB'de %4,2;
>   base uzun dosyalarda %4,1–9,4, müzik 0 dB'de %14,3. Eylül'ün 6 kısa klibinde katı ölçü yine
>   eşik çevresinde (sayı biçimi cezası).
> - Kelime zamanı: ham hâliyle p95 ~370–450 ms (eşik 250 ms'yi **geçmiyor**); bütün kelimeler
>   ~0,2 s geç. long-a'da ölçülen sabit çıkarılınca diğer kliplerde başlangıç p95 185–284 ms,
>   bitiş p95 222–411 ms — base'de başlangıç eşiğin altında, bitiş sınırda; turbo'da sınırın üstü var.
> - Bellek: Eylül'deki 8,6 GiB bir sızıntıydı (kelime zamanı modunda decoder önbelleği hiç
>   bırakılmıyor): düzeltmesiz 10,3 GiB / ekran kartı 7,8 GB, düzeltmeyle 1,8–4,3 GiB.
> - Türkçe: turbo temiz kümede katı WER %7,2–7,7 (Eylül'de small %20,6) — 566 MB ve yalnız WebGPU.
> - Hız sayıları dolu bir makinede alındı (işlemci %60–84 dolu); WASM ve dizüstü yaklaşığı yok.

## 1. Özet ve karar

(Yazılacak — yukarıdaki ara kayda bakın.)

## 2. Ortam

- Makine: Eylül denemesiyle aynı (Windows 11 Pro 10.0.26200, Intel Core i5-12500, 12 mantıksal
  çekirdek, 64 GB RAM, NVIDIA RTX 3070 Ti 8 GB, sürücü 610.88). Dizüstü değil.
- **Makine boş değildi.** Aynı bilgisayarda başka ajanlar ve kurucunun kendi programları
  çalışıyordu. Her koşu, başlamadan önceki ve koşu sırasındaki toplam işlemci doluluğunu kaydetti
  (`cpuBefore`, `cpu`): koşudan önce %29–67, koşu sırasında %60–77 dolu. Ağır koşular
  `E:\capcut_better\.claude\measure-lock` kilidi altında yapıldı; kilit yalnızca kilide uyan
  ajanları dışarıda tutar. **Hız sayıları (RTF) bu yüzden kötümser tarafta okunmalıdır;** boş bir
  makinede ölçülmedi.
- Node 20.18.0, ffmpeg 9.0.1, Playwright 1.63.0 (Chromium 153.0.8010.12, başlıklı), sistem Chrome
  ve Edge (kanal), Playwright Firefox.
- `@huggingface/transformers` 4.3.0 (Apache-2.0), içindeki `onnxruntime-web`
  1.31.0-dev.20260914 (MIT). Sayfa COOP/COEP ile `crossOriginIsolated`; "yalıtımsız" satırlar
  başlıksız sunuldu (GitHub Pages'in bugünkü hâli).
- Python 3.13.9 yerel sanal ortam (`web/spike/asr/.venv`, gitignore): yalnızca `whisper-normalizer`
  0.1.15 (MIT) — puanlama için. Hizalama için Python/GPU aracı kurulmadı; referans kelime zamanları
  hazır veri setinden geldi (aşağıda).
- Telefon (Samsung S23): deneme sırasında önce kilit sırası yüzünden başlayamadı, sonra USB
  bağlantısı koptu (`adb devices` boş). **Telefonda hiçbir şey ölçülmedi**; sürücü hazır
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
  yeniden yapıldı (`matrix-2026-10-03-redo.sh`; small-fp16 tekrarında long-c ve long-fleurs-raw
  yok). Bu belgedeki sayılar yeniden koşulan dosyalardandır. `run-en.mjs` artık bitmiş bir sonucun
  üzerine yazmayı reddeder.

## 6–7. Sonuçlar

(Yazılacak. Tablolar `node web/spike/asr/summarize-en.mjs` çıktısından gelecek; bitmeyen koşular
tamamlanmadan hüküm yazılmaz.)

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
- **Sınır:** `maxCuesPerTrack` 500. Ölçülen hız dakikada ~SEG-PER-MIN satır; 500 satır ≈
  SEG-MINUTES dakika konuşma. Daha uzun kaynak için ya sınır yükseltilir ya da altyazı yalnız
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

## 13. Yeniden üretme

```
cd web/spike/asr
npm install                               # transformers 4.3.0, playwright 1.63.0, typescript 5.9.3 (yalnız bu klasör)
python -m venv .venv && .venv/Scripts/pip install whisper-normalizer   # yalnız puanlama
node prepare-speech.mjs && node prepare-english.mjs     # ~1 GB indirir (LibriSpeech + hizalamalar), klipleri kurar
node mirror-models.mjs --models=silero-vad,base,small,base-fp16,small-fp16,distil-small.en,moonshine-tiny,moonshine-base,turbo,distil-large-v3.5
bash matrix-2026-10-03.sh A               # WebGPU + Silero, bütün modeller
bash matrix-2026-10-03-rest.sh B|E|F|D|C  # ön filtresiz ve kendi bulucumuz; sızıntı ve kelime zamanı bedeli; Türkçe; gönderilecek bileşim; WASM
node vad-dump.mjs                         # Silero ayar taraması (tarayıcısız)
node summarize-en.mjs && node guard-margins.mjs
node segment-lines.mjs <sonuç.json> <klip> [başlangıç] [bitiş]
node run-phone.mjs                        # telefon bağlıysa
```
