# ADR-051 — Ekim 2026 bağımlılık turu: Next 16.4.0, mediabunny 1.61.3, TypeScript 6; büyük sürümlerin çoğu bekliyor

> Tarih: 2026-10-21 · Durum: UYGULANDI (web/ ve cloud/ kilit dosyaları; yayınlanmadı, birleştirilmedi).
> Politika ve şema değişmedi. Kural: npm'in resmî kaydından, **en az iki haftalık** sürüm (yayın zamanı
> 2026-10-07T10:05Z'den önce), her sürümün notları okunarak; bir yükseltme bütün denetimler geçerse kalır.
> İlgili: [docs/security/DEPENDENCIES.md](../security/DEPENDENCIES.md) §3.2, [ADR-033] (kod çözücü tutucusu,
> mediabunny iç fabrikası), [ADR-036] (onnxruntime-web sabiti), [ADR-039] (cloud/ vekili).

## Bağlam

`npm outdated` (web/): `@axe-core/playwright` 4.13.0 → 4.14.0, `@huggingface/transformers` 4.3.0 → 4.3.1,
`@playwright/test` 1.63.0 → 1.64.1, `@types/node` 20.19.9 → 26.6.5, `eslint` 9.39.1 → 10.13.0,
`eslint-config-next`/`next` 16.3.8 → 16.4.2, `mediabunny` 1.58.1 → 1.62.0, `typescript` 5.9.3 → 7.0.2,
`vitest` 4.1.11 → 5.0.5. React 19.3.1, `@types/react*` 19.3.0, `picomatch` 4.0.7, `gifenc` 1.0.3 zaten en yeni.
`npm outdated` (cloud/): `@cloudflare/vitest-pool-workers` 0.22.0 → 0.23.0, `@cloudflare/workers-types`
5.20261010.1 → 5.20261021.1, `typescript` 5.9.3 → 7.0.2, `vitest` 4.1.9 → 5.0.5, `wrangler` 4.124.0 → 4.151.3.

## Karar

### Yükseltilen (her grup ayrı commit)

| Paket | Önce → sonra | Yayın (npm) | Neden güvenli |
|---|---|---|---|
| `@huggingface/transformers` | 4.3.0 → 4.3.1 | 2026-10-06 | Yalnız yeni model (EmbeddingGemma 2). `onnxruntime-web` sabiti aynı (`1.31.0-dev.20260914-8d85527a0`), yani `modelManifest.json`'daki WASM sha256'sı geçerli |
| `eslint` | 9.39.1 → 9.39.5 | 2026-07-10 | 9.x yaması |
| `@types/node` | 20.19.9 → 20.19.43 | 2026-06-10 | Node 20 çizgisinde kalır (CI Node 20) |
| `vite` (kilitte, vitest'in altında) | 6.4.3 → 6.4.4 | 2026-10-06 | `launch-editor` açıkları (npm audit'te dev "high"); `npm update vite` 8.3.3'e atlıyordu, kilit 6.4.4'e elle yazıldı, `npm ci` bütünlüğü doğruladı |
| `next`, `eslint-config-next` | 16.3.8 → 16.4.0 | 2026-10-06 | Aşağıda |
| `mediabunny` | 1.58.1 → 1.61.3 | 2026-10-05 | Aşağıda |
| `typescript` (web ve cloud/) | 5.9.3 → 6.0.3 | 2026-04-16 | Aşağıda |
| `vitest` (cloud/) | 4.1.9 → 4.1.11 | 2026-08-18 | web ile aynı; `@vitest/mocker` "moderate" tavsiyesi gider |

**Next 16.4.0.** Sürüm yazısında ve notlarında bizi etkileyen kırıcı değişiklik yok: `output: 'export'`, `basePath`,
`trailingSlash`, `experimental.globalNotFound` aynı; Cache Components varsayılan değil (yalnız yeni uygulamalarda).
Yeni `experimental.agentUpgrade` varsayılanı `'security'`: `next build` sırasında güvenlik yükseltmesini hatırlatır;
yayınlanan siteye bir şey eklemez. Sayfalara giden React kopyası `19.3.0-canary-278794d7-20261002` oldu
(16.3.8'de `cbb046ab-20260731`). `build-sw.mjs`'in dayandığı `.next/server/app/sw.js.body` ve `route-cache` hâlâ
aynı yerde. e2e derlemesinin önbellek listesi 4,43 → 4,31 MB (Turbopack çıktısı küçüldü); `/capcut` dışa
aktarmasınınki 4,30–4,31 MB.

**mediabunny 1.61.3.** 1.59.0–1.61.3 notlarında kırıcı değişiklik yok. Bizi ilgilendirebilecek düzeltmeler: ses
yeniden örneklemenin çıkışı erken boşaltması (1.59.0), GOP zaman kuralını çiğneyen ses izlerinde dönüştürme hatası
(1.59.1), eklenti worker'ı hatalarının hiç dönmeyen sözlere dönüşmesi (1.59.1), boşta kalınca geri alınan video
kodlayıcının yenilenmesi (1.61.0), `pasp` kutusu olmayan MP4'te piksel oranının SPS'ten okunması (1.61.1), `trun`
bileşim ofsetlerinin işaretli okunması (1.61.3). ADR-033'ün tutucusu ve dışa aktarma notu mediabunny'nin iç
`VideoSampleSink._createDecoder` fabrikasını sarar: `dist/modules/src/media-sink.js` 1.58.1 ile 1.61.3 arasında
yalnız alfa kanalının renk aralığında değişti; fabrika ve sarmalayıcının `close()`/`decoder` alanları aynı.

**TypeScript 6.0.3.** 6.0'ın yeni varsayılanları (strict, `module: esnext`, `types: []`,
`noUncheckedSideEffectImports`) ve kaldırdıkları (`baseUrl`, `moduleResolution node`, `esModuleInterop: false`,
`target: es5`, `outFile`) bizim `tsconfig.json`'larımızı etkilemiyor: zaten strict, esnext, bundler, esModuleInterop,
cloud/'da `types` açıkça yazılı. web'de denetlenen kendi dosyalarımız aynı (436; `@types/node` importlarla giriyor).
`typescript-eslint` 8.70.1 `>=4.8.4 <6.1.0` destekler.

### Alınmayan

| Paket | Aday | Neden |
|---|---|---|
| `next`, `eslint-config-next` | 16.4.1, 16.4.2 | İki haftalık değil (14 ve 15 Ekim). **Not:** 16.4.1 üç Next.js tavsiyesini düzeltir (aşağıda "Güvenlik") — 28 Ekim'den sonra alınmalı |
| `@playwright/test` | 1.64.0, 1.64.1 | 1.64.0 npm'de 2026-10-07T20:44Z: sınırı ~11 saatle geçmedi. 1.64.1 14 Ekim |
| `@axe-core/playwright` | 4.14.0 | 15 Ekim, iki haftalık değil |
| `mediabunny` | 1.61.4–1.62.0 | 12–20 Ekim, iki haftalık değil (1.61.5'te yeni kod çözücülere fazla paket baskısı düzeltmesi, 1.61.6'da Firefox AVC/zaman damgası geçici çözümleri var — sırası gelince alınmalı) |
| `eslint` | 10.12.0 | Denendi: lint geçti ve kurallar çalıştı (deneme dosyasında `rules-of-hooks`, `no-img-element`, `alt-text`), ama `eslint-config-next` 16.4.0'ın getirdiği `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0, `eslint-plugin-jsx-a11y` 6.10.2 ESLint 10'u desteklediklerini söylemiyor (`npm ls`: "invalid" eş bağımlılık). Desteklenmeyen birleşim; geri alındı. ESLint 9 artık desteklenmiyor (npm uyarısı): Next'in eklentileri 10'a geçince alınmalı |
| `typescript` | 7.0.2 | Denendi: `tsc --noEmit` geçti, `npm run lint` düştü: "typescript-eslint does not support TS 7.0." Geri alındı |
| `vitest` (web, cloud/) | 5.0.3 | Node `^22.12.0 \|\| ^24 \|\| >=26` ister (CI Node 20), eş bağımlılık `@types/node` `^22 \|\| >=24` (bizde Node 20 tipleri), `vite` artık eş bağımlılık. Denendi: "Cannot find package 'vite'" ile başlamadı. CI'nın Node sürümünü yükseltmek ayrı karar; geri alındı |
| `@types/node` | 21+ (26.6.5) | Çalışma zamanı Node 20 (CI); daha yeni tipler olmayan API'leri gösterir |
| `@cloudflare/vitest-pool-workers` | 0.23.0 | 2026-10-07T16:45Z, iki haftalık değil; paket `@cloudflare/vitest-plugin` adına taşındı (geçiş ayrı iş, cloud/worker/README.md) |
| `wrangler` | 4.148.0 | Yalnız yayın ve `wrangler dev` için; ikisi de burada çalıştırılmadı (hesaba dokunmamak için). Sınama düzeneği kendi sabit wrangler 4.124.0'ını kullanır |
| `@cloudflare/workers-types` | — | İki haftalık en yeni (5.20261007.1) bizdekinden (5.20261010.1) eski |

### Güvenlik: npm audit'in görmediği Next.js tavsiyeleri

14 Ekim'de yayımlanan GHSA-673q-mjm6-r5xr (kritik; `'use cache'` işlevi birden çok tipli dizi döndürünce uzaktan kod
çalıştırma), GHSA-2464-fhr4-w9xw (kritik; görüntü iyileştirmede, glibc Linux'ta, `sharp` < 0.35.5 ile) ve
GHSA-p3m5-59mp-jv5r (yüksek; Server Actions ile işlemci tüketme) `next` `>=16.0.0 <=16.4.0`'ı kapsar; düzeltme 16.4.1.
21 Ekim'de bunlar GitHub'ın genel tavsiye veritabanında yoktu: `npm audit --omit=dev` 0 dedi (16.3.8'de de, 16.4.0'da
da). Bizi etkilemediği değerlendirmesi: yayınlanan site statik dosyadır, Next sunucusu yoktur; yerel `next start`
(e2e) için de `src/`'de `'use cache'` ve `'use server'` yoktur, kilitte `sharp` 0.35.5'tir ve geliştirme makinesi
Windows'tur. İki hafta kuralını burada çiğnemedik; 16.4.1 ya da 16.4.2'ye (LTS çizgisi) 28/29 Ekim'den sonra
geçilmeli. Kurucu daha erken isterse istisna onun kararıdır.

## Sınamalar

Hepsi yerelde (Windows 11, Node 22.23.2, npm 11.6.2), gerçekten koşuldu:

| Ne | Önce (main a7ed854) | Her gruptan sonra | Son durum |
|---|---|---|---|
| `npm run typecheck` (web) | geçti | geçti | geçti (TS 6.0.3) |
| `npm run lint` (web) | temiz | temiz | temiz |
| `vitest run` (web) | 93 dosya / 1614 geçti | 93 / 1614 | 93 / 1614 |
| `npm run build` (`CLIP_TEST_HOOKS=1`, e2e yapısı) | — | geçti (yama, Next, TS) | geçti |
| `STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/capcut npm run build` | — | geçti (Next, mediabunny, TS) | geçti |
| `playwright test -c playwright.pages.config.ts` (son durum) | — | — | **10 geçti, 6 atlandı** (4 bulut ön kontrolü: yol kapalı; 2 model dosyası: `out/models` yok) |
| `playwright test` (bütün varsayılan e2e, son durum, port 3198, ölçüm kilidiyle) | — | — | **527 geçti, 4 atlandı, 0 düştü** (30,7 dk). Atlananlar: 2 sessizlik ekran görüntüsü, 2 gerçek Whisper modeli (model dosyası yok) |
| cloud/: `typecheck`, `npm test` | geçti; 39 + 32 + 60 | — | geçti; node --test 39 + 32, vitest (workerd) 3 dosya / 60 |
| `npm audit --omit=dev` (web, cloud/) | 0, 0 | 0 | 0, 0 |

e2e'de bekçinin (ADR-044) bir sayfa yüklemesini kendiliğinden yeniden yüklemesi: 1 (`/yap/gif`, "the GIF screen —
no axe finding…" sınamasında); sınama geçti, ölü sayfa 0. Bu tek koşudan bunun yükseltmeye bağlı olup olmadığı
söylenemez.

Denenip geri alınanlar (kilit dosyası her seferinde `git checkout` + `npm ci` ile geri döndü): ESLint 10.12.0
(lint geçti, eş bağımlılık geçersiz), TypeScript 7.0.2 (lint düştü), vitest 5.0.3 (başlamadı).

## Doğrulanmayanlar

- CI'da koşu (Linux denetim işi, Windows e2e işi); yayın.
- Bütün e2e takımı ve sayfalar sınaması yalnız son durumda koşuldu, grup grup değil (gruplar ayrı ayrı tsc, eslint,
  vitest ve derlemeden geçti).
- `npm run quality`, `playwright.cloud.config.ts`, fuzz, soak, tarayıcı matrisi koşulmadı.
- Gerçek telefon (S23), Safari, Firefox: mediabunny'nin kod çözme/kodlama davranışı yalnız masaüstü Chromium'da sınandı.
- Model dosyalı sınamalar (gerçek Whisper modeli, sayfalar sınamasındaki model dosyaları): model dosyaları bu
  çalışma kopyasında yoktu, indirilmedi; bu sınamalar kendilerini "NOT RUN" diye atladı.
- `wrangler dev` / `wrangler deploy`: çalıştırılmadı.

## Ek — 22 Ekim 2026: Next 16.4.1 (güvenlik düzeltmesi, iki hafta kuralından önce)

Yukarıdaki üç Next.js tavsiyesi (GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r; `>=16.0.0 <=16.4.0`)
22 Ekim'de GitHub'ın genel tavsiye veritabanına girdi: `npm audit --omit=dev` 1 kritik dedi ve Next 16.4.0'ın kendisi
`next build`'i `SecurityFatalError` ile durdurdu (yayın kontrolü bu yüzden düştü; derlenmeyen bir yapıyla sınama
anlamsızdı). Karar: `next` ve `eslint-config-next` **16.4.1**'e (npm'de 14 Ekim 2026, 8 günlük). Neden 16.4.2 değil:
16.4.1 üç tavsiyeyi kapatan en eski sürüm; 16.4.2 bir gün daha yeni. İki hafta kuralı bu kez çiğnendi: kural yeni
sürümün kendi hatalarına karşı bir bekleme; burada beklemek eski sürümle derlenemeyen bir depo demekti ve düzeltme
bir yama sürümü. Yükseltme Next'in derleme çıktısında önerdiği `next upgrade --agent=security …` komutuyla değil,
resmi kayıttan `npm install --save-exact next@16.4.1 eslint-config-next@16.4.1` ile yapıldı; kilitte yalnız `next`,
`@next/*` ve `eslint-config-next` değişti. Sonuç: `npm audit --omit=dev` 0. Sınamalar bu ekle birlikte yayın
kontrolünde koşulur (CHANGELOG).
