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
| `react` | 19.3.1 | MIT | Her sayfa | Sayfalara giden kopya Next'in derlediği `19.3.0-canary-cbb046ab-20260731`'dir (App Router kendi React'ını paketler; `_next/static`'te başka sürüm yok, 2026-10-15). `node_modules`'taki sürüm birim testlerinde ve tiplerde çalışır |
| `react-dom` | 19.3.1 | MIT | Her sayfa | aynı |
| `scheduler` (react-dom bağımlılığı) | 0.28.0 | MIT | Her sayfa | |
| `@swc/helpers` (next bağımlılığı) | 0.5.23 | Apache-2.0 | Derleyici yardımcıları | |
| `mediabunny` | 1.58.1 | **MPL-2.0** | Yalnız editör: dosya açma/probe (sayfada, `import()` ile tembel), dışa aktarma ve sessizlik worker'ları | Değiştirilmeden kullanılıyor |
| Inter (yazı tipi, 700, latin + latin-ext `woff2`) | — | **SIL OFL 1.1** | Yalnız altyazı yakma/önizleme ve GIF yazısı, ihtiyaç olunca | Lisans metni dosyaların yanında yayınlanıyor: `web/public/fonts/caption/OFL.txt` |
| `gifenc` | 1.0.3 | MIT (© 2017 Matt DesLauriers) | Yalnız "GIF yap"ın worker'ında (ADR-046): renk seçimi (PnnQuant) ve GIF/LZW yazıcısı | 2026-10-17 eklendi. Bağımlılığı yok; pakete giren `dist/gifenc.esm.js` 9 KB (küçültülmüş). Son sürüm 1.0.3 (npm kaydı en son 2022-05'te değişmiş): bakımı **etkin değil**, ama yalnızca hesap yapar (ağ, dosya, `eval` yok) ve GIF89a biçimi donmuş bir biçimdir. Sarıldığı yer tek dosya (`web/src/adapters/gif/gifEncode.ts`): gerekirse kendi kodlayıcımızla değiştirilebilir. `npm audit --omit=dev` eklendikten sonra 0. Tipleri bizim (`web/src/types/gifenc.d.ts`) |

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

### 3.1 Yeniden tarama (2026-10-10)

| Komut | Sonuç |
|---|---|
| `npm audit --omit=dev` | `found 0 vulnerabilities` (değişmedi; yayınlanan siteye ve derlemeye giren ağaç temiz) |
| `npm audit` (dev dahil, 413 paket) | **5 high** — hepsi tek bir tavsiyenin zinciri, hepsi yalnız geliştirme aracı (lint) |

Zincir: `eslint-config-next@16.3.8` → `@next/eslint-plugin-next@16.3.8` → `fast-glob@3.3.1` →
`micromatch@4.0.8` → `braces@3.0.3`. Tavsiye: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
— `braces`, çok derin iç içe `{…}` kalıbında yığın taşmasıyla hizmet dışı kalır; etkilenen aralık `<=3.0.3`.
npm beş paketi (zincirin her halkasını) ayrı ayrı "high" sayar; açık tektir.

**Çözülemedi; nedeni tam olarak şu:**

- `braces`'in yayınlanmış en yeni sürümü **3.0.3**'tür ve tavsiye onu da kapsar: düzeltilmiş bir sürüm yok.
  Bu yüzden ne yükseltme ne de `overrides` ile gidilecek temiz bir sürüm var.
- `eslint-config-next`'in en yeni sürümü (16.4.0) ve canary'si (16.5.0-canary.7) hâlâ `fast-glob@3.3.1`'e bağlı;
  Next'i yükseltmek zinciri değiştirmez.
- npm'in önerdiği `npm audit fix --force`, `eslint-config-next`'i **14.2.35**'e indirir (eklentinin `fast-glob`
  kullanmaya başlamasından önceki sürüm). Bu, Next 16 / ESLint 9 düz yapılandırmasıyla (`eslint.config.mjs`)
  uyumlu olmayan iki ana sürüm geri gitmektir; uygulanmadı.
- `fast-glob`'u API'si farklı başka bir paketle `overrides` üzerinden değiştirmek (eklenti `globSync` çağırıyor)
  ya da Next'in lint kurallarını bırakmak lint'i sessizce zayıflatırdı; yapılmadı.

**Gerçek risk (mühendislik değerlendirmesi):** açık, saldırganın verdiği bir glob kalıbının `braces`'e ulaşmasını
gerektirir. Burada `fast-glob` yalnızca `@next/eslint-plugin-next` içinde, ESLint ayarındaki `rootDir` değerini
açmak için çağrılır (`dist/utils/get-root-dirs.js`); kalıp bizim `eslint.config.mjs` dosyamızdan gelir (ayar
verilmediği için varsayılan), kullanıcı girdisinden değil. Kod yalnız `npm run lint` sırasında, geliştirici
makinesinde ve CI'da çalışır; tarayıcı paketine ve derleme çıktısına girmez. Olası etki: lint sürecinin çökmesi.

**İzlenecek:** `braces` için düzeltilmiş sürüm ya da `@next/eslint-plugin-next`'in `fast-glob`'u bırakması;
ikisinden biri çıkınca tam kilitli sürümler yükseltilir ve bu bölüm güncellenir.

**Yeniden bakıldı (2026-10-15):** değişmedi. `npm audit` yine aynı 5 "high" (tek tavsiye), `npm audit --omit=dev`
0. `braces`'in en yeni sürümü hâlâ 3.0.3 (21 Mayıs 2024); `eslint-config-next@16.4.1` → `@next/eslint-plugin-next@16.4.1`
hâlâ `fast-glob@3.3.1`'e sabit (`npm view`), `fast-glob@3.3.3` de `micromatch@^4.0.8` → `braces@^3.0.3` ister.
Yükseltmenin zinciri değiştirmeyeceği görüldüğü için yükseltilmedi.
Aynı gün tek yama yükseltmesi: `react`/`react-dom` 19.3.0 → 19.3.1 (14 Ekim; kilit dosyasında yalnız bu iki paket
değişti, `scheduler` aynı). Yayınlanan pakete etkisi yok (yukarıdaki tablo notu).

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
- **Whisper ONNX dışa aktarımları (ADR-036) — açık lisans sorusu (not 10 Ekim 2026'da yeniden yazıldı).**
  Siteden yayınladığımız Whisper dosyaları OpenAI'nin kendi dosyaları değil, başkasının (Hugging Face'teki
  `onnx-community` hesabı) ONNX biçimine çevirdiği kopyalardır.
  - **Bilinen:** Whisper'ın kodu MIT lisanslıdır (github.com/openai/whisper `LICENSE`, © 2022 OpenAI).
    Ağırlıkların OpenAI'ye ait kartlarında `openai/whisper-base` için Apache-2.0,
    `openai/whisper-large-v3-turbo` için MIT yazar. Kullandığımız dosyalar
    `onnx-community/whisper-base_timestamped` @ `608c49e6…` ve
    `onnx-community/whisper-large-v3-turbo_timestamped` @ `b3f77bf9…` revizyonlarına sabitlidir
    (sha256 ile, `modelManifest.json`); kartları üst model olarak `openai/whisper-*` depolarını gösterir.
  - **Bilinmeyen:** bu iki dışa aktarım deposunun model kartında lisans alanı **boştu** (bakıldığı tarih:
    3 Ekim 2026, `docs/spikes/2026-10-03-asr-on-device-english.md`; 10 Ekim'de yeniden **bakılmadı**).
    Yani dışa aktaran, çevrilmiş dosyalar için bir koşul **beyan etmemiştir** — ne "üst lisans geçerlidir"
    demiştir ne başka bir şey. Kartın sonradan değişip değişmediği, sabitlediğimiz revizyon için ne anlama
    geleceği ve boş bir lisans alanının hukuken nasıl okunacağı bilinmiyor.
  - **Bizim yaptığımız ve dayanağı:** dosyaları, biçim dönüşümünün ağırlıkların lisansını taşıdığı
    okumasıyla, üst lisans metinleri ve atıfla birlikte (`models/LICENSES.txt`, aynı belirsizliği
    İngilizce yazar) kendi sitemizden yayınlıyoruz. Bu bir mühendislik okumasıdır; dışa aktaranın beyanı
    ya da hukuki görüş **değildir** ve bu belge dağıtımın lisansa uygun olduğunu iddia etmez.
  - **Belirsizliği kaldırmanın yolları (yapılmadı; kurucu kararı):** (a) `onnx-community` depolarında
    karta lisans eklenmesini istemek; (b) ağırlıkları `openai/*` depolarından kendi ONNX dışa
    aktarımımızla üretmek (torch + optimum kurulumu; çıktının bugünkü dosyalarla aynı doğrulukta olduğu
    yeniden ölçülmeli); (c) hukuki inceleme.
- **Apache-2.0 (Transformers.js, tokenizers, flatbuffers, long):** NOTICE/atıf yükümlülüğü yukarıdaki
  "üçüncü taraf bildirimleri" sayfası kararının kapsamına girer.
- **CC BY 4.0 (FLEURS, tek test kaydı):** atıf depoda; siteyle dağıtılmıyor.
- SBOM (belge 23 §5) üretilmiyor; `npm sbom --omit=dev --sbom-format=cyclonedx` yerel olarak üretebilir.
