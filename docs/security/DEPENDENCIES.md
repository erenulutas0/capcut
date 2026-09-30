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
| `next` (istemci çalışma zamanı, yönlendirici) | 16.3.5 | MIT | Her sayfa | |
| `react` | 19.3.0 | MIT | Her sayfa | |
| `react-dom` | 19.3.0 | MIT | Her sayfa | |
| `scheduler` (react-dom bağımlılığı) | 0.28.0 | MIT | Her sayfa | |
| `@swc/helpers` (next bağımlılığı) | 0.5.23 | Apache-2.0 | Derleyici yardımcıları | |
| `mediabunny` | 1.58.1 | **MPL-2.0** | Yalnız editör: dosya açma/probe (sayfada, `import()` ile tembel), dışa aktarma ve sessizlik worker'ları | Değiştirilmeden kullanılıyor |
| Inter (yazı tipi, 700, latin + latin-ext `woff2`) | — | **SIL OFL 1.1** | Yalnız altyazı yakma/önizleme, ihtiyaç olunca | Lisans metni dosyaların yanında yayınlanıyor: `web/public/fonts/caption/OFL.txt` |

Arayüz yazı tipi yok: arayüz sistem yazı tiplerini kullanır (`--font-ui`, `--font-time`, `web/src/app/globals.css`).

## 2. Yalnız derleme/sunucu tarafında (tarayıcıya gitmez)

`npm ls --omit=dev --all` bu ağacı "üretim" sayar, ama statik dışa aktarmada bunlar yalnızca
`next build` sırasında çalışır:

| Paket | Sürüm | Lisans |
|---|---|---|
| `@next/env` | 16.3.5 | MIT |
| `@next/swc-win32-x64-msvc` (platforma göre) | 16.3.5 | MIT |
| `postcss`, `nanoid`, `picocolors`, `source-map-js` | 8.5.23, 3.3.19, 1.1.1, 1.2.1 | MIT, MIT, ISC, BSD-3-Clause |
| `styled-jsx`, `client-only` | 5.1.6, 0.0.1 | MIT |
| `caniuse-lite`, `baseline-browser-mapping` | 1.0.30001810, 2.11.25 | CC-BY-4.0, Apache-2.0 |
| `sharp`, `@img/colour`, `detect-libc`, `semver` (next/image; statik dışa aktarmada kullanılmıyor) | 0.35.4, 1.1.0, 2.1.2, 7.8.5 | Apache-2.0, MIT, Apache-2.0, ISC |
| `@img/sharp-win32-x64`, `@img/sharp-wasm32` (sharp'ın yerel ikilisi) | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later (libvips) |
| `@emnapi/runtime`, `tslib` | 1.11.3, 2.8.1 | MIT, 0BSD |
| `@types/dom-webcodecs`, `@types/dom-mediacapture-transform` (mediabunny tipleri) | 0.1.13, 0.1.12 | MIT |

Geliştirme bağımlılıkları (test, lint, tip): `@playwright/test` 1.63.0 (Apache-2.0),
`@axe-core/playwright` 4.13.0 (MPL-2.0), `eslint` 9.39.1 (MIT), `eslint-config-next` 16.3.5 (MIT),
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
- SBOM (belge 23 §5) üretilmiyor; `npm sbom --omit=dev --sbom-format=cyclonedx` yerel olarak üretebilir.
