# Bağımlılıklar ve lisanslar — web editörü

> Tarih: 2026-09-30 · Durum: KODDAN VE `node_modules`'TAN ÇIKARILDI, HUKUKİ İNCELEME YOK
> Kaynak: `web/package.json`, `web/package-lock.json` (npm 11, `npm ci` ile kurulur; sürümler tam kilitli, `^`/`~` yok).
> İlgili: belge 18 "Tedarik zinciri", belge 23 §5 (lisans/NOTICE, SBOM), belge 11 "Gizlilik ve dağıtım".

## 1. Tarayıcıya giden kod

Yayınlanan sitede (`out/`, GitHub Pages) çalışan üçüncü taraf kod yalnızca bunlardır. Hepsi
derleme sırasında sitenin kendi dosyalarına paketlenir; çalışma anında başka bir adresten script,
yazı tipi veya stil yüklenmez (CSP `default-src 'self'`, e2e "nothing leaves the machine").

| Paket | Sürüm | Lisans | Nerede çalışır | Not |
|---|---|---|---|---|
| `next` (istemci çalışma zamanı, yönlendirici) | 16.3.8 | MIT | Her sayfa | |
| `react` | 19.3.0 | MIT | Her sayfa | |
| `react-dom` | 19.3.0 | MIT | Her sayfa | |
| `scheduler` (react-dom bağımlılığı) | 0.28.0 | MIT | Her sayfa | |
| `@swc/helpers` (next bağımlılığı) | 0.5.23 | Apache-2.0 | Derleyici yardımcıları | |
| `mediabunny` | 1.58.1 | **MPL-2.0** | Yalnız editör: dosya açma/probe (sayfada, `import()` ile tembel), dışa aktarma ve sessizlik worker'ları | Değiştirilmeden kullanılıyor |
| Inter (yazı tipi, 700, latin + latin-ext `woff2`) | — | **SIL OFL 1.1** | Yalnız altyazı yakma/önizleme, ihtiyaç olunca | Lisans metni dosyaların yanında yayınlanıyor: `web/public/fonts/caption/OFL.txt` |

Arayüz yazı tipi yok: arayüz sistem yazı tiplerini kullanır (`--font-ui`, `--font-time`, `web/src/app/globals.css`).

### 1.1 "Yazıya dök" ile gelenler (2026-10-04, ADR-036)

Yalnızca transkript worker'ında, yalnızca bir yazıya dökme başladığında yüklenir (ayrı bir
parça; açılış ekranı ve diğer işler bunu indirmez — ölçüm ADR-036 "Paket boyutu").

| Paket | Sürüm (tam kilitli) | Lisans | Not |
|---|---|---|---|
| `@huggingface/transformers` | 4.3.0 | Apache-2.0 | Whisper ön/son işleme, kelime zamanı. Değiştirilmeden; bir kütüphane sızıntısı çağıran tarafta gideriliyor (`engine.ts`, `trackDecoderCaches`) |
| `onnxruntime-web` (transformers bağımlılığı) | 1.31.0-dev.20260914-8d85527a0 | MIT | JS yapıştırıcısı pakete girer; WebAssembly dosyası (aşağıda) paketten değil model deposundan çalışır |
| `onnxruntime-common` | 1.31.0-dev.20260911-2a43ec07e | MIT | |
| `@huggingface/jinja`, `@huggingface/tokenizers` | 0.5.10, 0.2.0 | MIT, Apache-2.0 | transformers bağımlılıkları |
| `flatbuffers`, `long`, `protobufjs` (+ `@protobufjs/*`), `guid-typescript`, `platform` | 25.9.23, 5.3.2, 7.6.6, 1.0.9, 1.3.6 | Apache-2.0, Apache-2.0, BSD-3-Clause, ISC, MIT | onnxruntime-web bağımlılıkları |

`@huggingface/transformers` ayrıca `onnxruntime-node` 1.30.0 (MIT) ve `sharp`'ı kurar; ikisi de
yalnız Node içindir, tarayıcı paketine girmez (paket `default` koşuluyla `transformers.web.js`'i
seçer).

**Model dosyaları (uygulama dosyası; git'te değil).** `web/src/domain/modelManifest.json` her
dosyayı kaynağı, tam revizyonu, bayt sayısı ve sha256'sıyla sabitler; `web/scripts/fetch-models.mjs`
derlemede bunları indirip doğrular ve siteye (`/models/…`) koyar; tarayıcı indirdiği her dosyayı
aynı sha256 ile yeniden doğrular. Yanlarında `models/LICENSES.txt` yayınlanır.

| Grup | Kaynak @ revizyon | Dosya | Bayt | sha256 | Lisans dayanağı |
|---|---|---|---|---|---|
| Çalışma zamanı | npm `onnxruntime-web@1.31.0-dev.20260914-8d85527a0`, `dist/` | `ort-wasm-simd-threaded.asyncify.wasm` | 26 861 777 | `49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082` | MIT (Microsoft) |
| Konuşma bulucu | `onnx-community/silero-vad` @ `e71cae966052b992a7eca6b17738916ce0eca4ec` | `onnx/model.onnx` | 2 243 022 | `a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808` | MIT (Silero Team; github.com/snakers4/silero-vad `LICENSE`) |
| `base` | `onnx-community/whisper-base_timestamped` @ `608c49e61301901684bc36cac8f74b95ff6b5a8e` | `onnx/encoder_model_quantized.onnx` | 23 159 167 | `2714484ebe1bae7c1646e8eadb768bb9d415cf11763466d21f23039a29c62e6f` | **Kartta lisans beyanı yok.** Üst model `openai/whisper-base`: kartında Apache-2.0; Whisper kodu MIT |
| | | `onnx/decoder_model_merged_quantized.onnx` | 53 712 708 | `cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db` | aynı |
| | | 9 yapılandırma/tokenizer dosyası (`config.json` … `quantize_config.json`) | 2 869 152 | manifestte tek tek | aynı |
| `turbo` | `onnx-community/whisper-large-v3-turbo_timestamped` @ `b3f77bf9a8c4d5ea3415827033d1ffea7955fd9a` | `onnx/encoder_model_q4f16.onnx` | 370 035 242 | `65261f977474ce30e46ed2c2b885e8ef68ef917941f78af48b098b86fad1adaa` | **Kartta lisans beyanı yok.** Üst model `openai/whisper-large-v3-turbo`: kartında MIT |
| | | `onnx/decoder_model_merged_q4f16.onnx` | 193 566 135 | `617e5b4f91ca190c43fa4d3bd2e671cfbee19c9a6ac4890f0a4bbaf658f00cf4` | aynı |
| | | 9 yapılandırma/tokenizer dosyası | 2 858 740 | manifestte tek tek | aynı |

Toplam indirme: `base` 108 845 826 bayt (model 79 741 027 + bulucu + çalışma zamanı), `turbo`
595 564 916 bayt. Depodaki tek gerçek konuşma kaydı `web/tests/media/speech-fleurs-en-01.mp4`
(FLEURS, CC BY 4.0; atıf `web/tests/media/SPEECH_SOURCE.md`) yalnız testlerde kullanılır, siteye
girmez.

## 2. Yalnız derleme/sunucu tarafında (tarayıcıya gitmez)

`npm ls --omit=dev --all` bu ağacı "üretim" sayar, ama statik dışa aktarmada bunlar yalnızca
`next build` sırasında çalışır:

| Paket | Sürüm | Lisans |
|---|---|---|
| `@next/env` | 16.3.8 | MIT |
| `@next/swc-win32-x64-msvc` (platforma göre) | 16.3.8 | MIT |
| `postcss`, `nanoid`, `picocolors`, `source-map-js` | 8.5.23, 3.3.19, 1.1.1, 1.2.1 | MIT, MIT, ISC, BSD-3-Clause |
| `styled-jsx`, `client-only` | 5.1.6, 0.0.1 | MIT |
| `caniuse-lite`, `baseline-browser-mapping` | 1.0.30001810, 2.11.25 | CC-BY-4.0, Apache-2.0 |
| `sharp`, `@img/colour`, `detect-libc`, `semver` (next/image; statik dışa aktarmada kullanılmıyor) | 0.35.4, 1.1.0, 2.1.2, 7.8.5 | Apache-2.0, MIT, Apache-2.0, ISC |
| `@img/sharp-win32-x64`, `@img/sharp-wasm32` (sharp'ın yerel ikilisi) | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later (libvips) |
| `@emnapi/runtime`, `tslib` | 1.11.3, 2.8.1 | MIT, 0BSD |
| `@types/dom-webcodecs`, `@types/dom-mediacapture-transform` (mediabunny tipleri) | 0.1.13, 0.1.12 | MIT |

Geliştirme bağımlılıkları (test, lint, tip): `@playwright/test` 1.63.0 (Apache-2.0),
`@axe-core/playwright` 4.13.0 (MPL-2.0), `eslint` 9.39.1 (MIT), `eslint-config-next` 16.3.8 (MIT),
`typescript` 5.9.3 (Apache-2.0), `vitest` 4.1.11 (MIT), `picomatch` 4.0.7 (MIT), `@types/*` (MIT).
Hiçbiri yayınlanan siteye girmez.

## 3. Güvenlik taraması (2026-09-30)

| Komut | Sonuç |
|---|---|
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
| `npm audit` (dev dahil, 492 paket) | `found 0 vulnerabilities` (info/low/moderate/high/critical: 0) |

Güncelleme gerekmedi; hiçbir sürüm değiştirilmedi. `npm ci` uyarıları: `eslint@9.39.1` için
"no longer supported" (yalnız geliştirme aracı), yerel Node 20.18.0 bazı geliştirme paketlerinin
istediği `^20.19` altında (`EBADENGINE`, uyarı; CI `setup-node` 20'nin güncel alt sürümünü kurar).

## 4. Kaynak haritası ve kaynak dosyalar (belge 11 "private source map")

- `productionBrowserSourceMaps` kapalı (varsayılan; `web/next.config.ts` içinde açıkça yazıldı).
- Ölçüm (2026-09-30, önce): `out/` içinde **1** `.map` dosyası vardı
  (`_next/static/chunks/*.js.map`, 53 bayt, `{"sections": []}` — içerik yok, hiçbir chunk ona
  bağlanmıyor) ve Turbopack'in `new Worker(new URL('./x.ts', import.meta.url))` için varlık olarak
  kopyaladığı **2 TypeScript kaynak dosyası** (`_next/static/media/exportWorker.*.ts` 44 KB,
  `silenceWorker.*.ts` 7,6 KB). Worker'lar bu dosyalardan değil derlenmiş chunk'lardan çalışıyor.
- Sonra: `scripts/apply-csp.mjs` statik dışa aktarmada `*.map` ve `_next/static/media/*.ts(x)`
  dosyalarını siler. Yayın duman testi (dışa aktarma + sessizlik worker'ları, alt yol) bu silmeden
  sonra geçiyor. Depo herkese açık olduğu için bu bir sır sızıntısı değildi; amaç yalnızca yayınlanan
  sitenin derlenmiş koddan ibaret olması.

## 5. Açık lisans işleri (kurucu / hukuki)

- **MPL-2.0 (mediabunny):** yürütülebilir biçimde dağıtımda (§3.2) alıcıya kaynak kodun nereden
  alınabileceği ve lisans bildirilmeli. Kaynak değiştirilmedi ve herkese açık
  (npm `mediabunny@1.58.1`, github.com/Vanilagy/mediabunny), ama sitede bu bildirim henüz yok.
- **MIT/Apache-2.0 (Next, React):** küçültülmüş paketlerde telif bildirimleri kalmıyor
  (paketlerde `@license` yorumu bulunmadı). Yaygın çözüm: sitede bir "üçüncü taraf bildirimleri"
  sayfası/dosyası. Bu belge o dosyanın kaynağı olarak kullanılabilir; eklenip eklenmeyeceği
  metin/hukuk kararıdır, bu çalışmada eklenmedi.
- **SIL OFL 1.1 (Inter):** yazı tipi dosyaları değiştirilmeden, lisans metniyle birlikte yayınlanıyor.
- **Whisper ONNX dışa aktarımları (ADR-036) — kurucu/hukuk notu:** `onnx-community/whisper-base_timestamped`
  ve `…-large-v3-turbo_timestamped` depolarının model kartlarında lisans alanı **boş**. Ağırlıkların
  kaynağı olan `openai/whisper-base` (Apache-2.0) ve `openai/whisper-large-v3-turbo` (MIT) serbest
  yeniden dağıtıma izin veriyor ve dışa aktarım bunların biçim dönüşümü; bu yüzden dosyaları üst
  lisanslarla, atıf ve lisans metniyle (`models/LICENSES.txt`) kendi sitemizden yayınlıyoruz. Bu bir
  mühendislik okumasıdır, hukuki görüş değil: dışa aktaranın (Transformers.js ekibi) ayrı bir koşul
  koymadığı varsayılıyor. İstenirse (a) Hugging Face'te karta lisans eklenmesi istenir ya da (b)
  ağırlıklar `openai/*` depolarından kendi ONNX dışa aktarımımızla üretilir (torch + optimum kurulumu
  gerekir; yapılmadı).
- **Apache-2.0 (Transformers.js, tokenizers, flatbuffers, long):** NOTICE/atıf yükümlülüğü yukarıdaki
  "üçüncü taraf bildirimleri" sayfası kararının kapsamına girer.
- **CC BY 4.0 (FLEURS, tek test kaydı):** atıf depoda; siteyle dağıtılmıyor.
- SBOM (belge 23 §5) üretilmiyor; `npm sbom --omit=dev --sbom-format=cyclonedx` yerel olarak üretebilir.
