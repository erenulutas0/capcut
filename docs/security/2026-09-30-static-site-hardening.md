# Statik site sertleştirmesi — GitHub Pages (2026-09-30)

> Durum: UYGULANDI, TESTLİ (Chromium, Chrome, Edge; Windows). Hukuki/üretim kararı içermez.
> Kapsam: yayınlanan site https://erenulutas0.github.io/capcut/ ve e2e'nin kullandığı `next start`.
> İlgili: belge 11 "Gizlilik ve dağıtım", belge 18 (XSS, tedarik zinciri), belge 19, belge 23.

## 1. Neden bu şekilde

GitHub Pages yanıt başlığı ayarlatmaz. Bu yüzden:

- **Content-Security-Policy** bir `<meta http-equiv>` olarak her HTML dosyasının içine yazılır.
- `<meta>` ile verilemeyen yönergeler (`frame-ancestors`, `report-uri`/`report-to`, `sandbox`) ve
  başlık-yalnız korumalar (HSTS'in ayarı, `X-Content-Type-Options`, `X-Frame-Options`,
  `Permissions-Policy`, COOP/COEP, `Referrer-Policy` başlığı) burada **yapılamaz**; §5'e bakın.

## 2. Yapılanlar

### 2.1 Content-Security-Policy

Yayınlanan politika (editör sayfası; hash'ler her derlemede yeniden hesaplanır):

```
default-src 'self';
script-src 'self' 'sha256-…' 'sha256-…';
style-src 'self' 'unsafe-hashes' 'sha256-…' (sayfadaki her style="" değeri için bir tane);
img-src 'self' data: blob:;
media-src 'self' blob:;
font-src 'self';
connect-src 'self';
worker-src 'self' blob:;
manifest-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'none'
```

**Nasıl yazılıyor.** `npm run build` = `next build && node scripts/apply-csp.mjs`.
Betik (`web/scripts/apply-csp.mjs`, mantık `web/scripts/lib/csp.mjs`) her HTML'deki satır içi
`<script>` gövdelerini ve `style` değerlerini SHA-256 ile özetler ve etiketi `<meta charset>`'in
hemen ardına koyar (meta politika yalnızca kendisinden sonra ayrıştırılanı kapsar; Next
`<script src>` etiketlerini `<head>`'in başına yazar). Statik dışa aktarmada `out/**/*.html`,
sunucu derlemesinde `next start`'ın olduğu gibi sunduğu `.next/server/app/**/*.html` işlenir.

**Neden kök layout'ta değil.** Next 16 statik çıktısında script olarak yalnızca iki tür satır içi
betik var: `(self.__next_f=self.__next_f||[]).push([0])` ve React Server Component yükü
(`self.__next_f.push([1,"…"])`). Bu yük render edilmiş `<head>`'i de taşır; layout'a yazılan bir
politika kendi hash'ini içermek zorunda kalırdı (döngü). Nonce statik sitede imkânsız (her
istekte değişmeli). Derleme sonrası ekleme yükü değiştirmez; React 19 `<head>`'deki fazladan
etiketi hidrasyonda yok sayar (e2e'de hidrasyon hatası yok). Layout'ta yalnızca
`referrer: 'no-referrer'` var ve oradan politikanın nerede yazıldığı anlatılıyor.

**Ölçülen satır içi içerik (Next 16.3.5, 2026-09-30):**

| Sayfa | Satır içi `<script>` | `style=""` değeri | Satır içi `<style>` |
|---|---|---|---|
| `/` | 2 | 1 | 0 |
| `/editor` | 2 | 7 farklı | 0 |
| `/gizlilik`, `/gizlilik/en` | 2 | 0 | 0 |
| 404 | 2 | birkaç | 1 (Next'in hazır 404 sayfası) |

**Her gevşetmenin nedeni:**

| Yönerge | Neden |
|---|---|
| `script-src` hash'leri | Next'in iki satır içi başlatma betiği. `'unsafe-inline'` ve `'unsafe-eval'` **yok**; `'strict-dynamic'` gereksiz (bütün chunk'lar aynı origin'den). |
| `style-src 'unsafe-hashes'` + hash'ler | Sunucu tarafında yazılmış `style` öznitelikleri (ikon boyutu `width:16px;height:16px`, `--canvas-aspect`, oynatma çizgisi `left:0%`, 404 sayfası). Yalnız bu **tam değerler** izinli. React'in sonradan DOM üzerinden (CSSOM) koyduğu stiller CSP'ye tabi değildir. `'unsafe-inline'` yok. `style=""` olmayan sayfada `'unsafe-hashes'` de yazılmaz. |
| `img-src data: blob:` | Sayfada üretilen küçük resimler ve kare görüntüleri. |
| `media-src blob:` | Seçilen dosya önizlemede `URL.createObjectURL` ile oynar. |
| `worker-src 'self' blob:` | Dışa aktarma ve sessizlik worker'ları aynı origin'den (`turbopack-worker-*.js`); mediabunny küçük yardımcı worker'larını (zamanlayıcı, renk/alfa birleştirme) `blob:` ile başlatır. |
| `connect-src 'self'` | Uygulama dışarıya istek atmaz. Next'in istemci gezinmesi aynı origin'den RSC yükü okur. GitHub Issues bağlantısı bir gezinmedir, istek değil. |
| `form-action 'none'` | Tek `<form>` (altyazı kaydırma) `preventDefault` ile gönderilmez; hiçbir şey post edilmez. |

Tarayıcı desteği: `'unsafe-hashes'` Chromium 69+, Firefox 111+, Safari 15.4+. Daha eski bir
tarayıcı yalnızca o `style` özniteliklerini uygulamaz (ikon boyutu gibi görünüm); script
tarafı etkilenmez.

**`next dev`'de politika yok:** hot reload `eval` ve değişen satır içi betik ister. Testler ve
yayın her zaman derlemeyi kullanır.

### 2.2 Doğrulama

- Birim: `web/tests/unit/csp.test.ts` (7 test): hash'ler bayt bayt, `style` değerleri çözülmüş
  hâliyle, script içindeki metin öznitelik sayılmıyor, etiket charset'ten hemen sonra ve tek,
  yeniden çalıştırma kararlı, script için `'unsafe-inline'`/`'unsafe-eval'` yok.
- e2e: `web/tests/e2e/csp.spec.ts` + `web/tests/e2e/cspWatch.ts`. İhlal üç ayrı kanaldan
  toplanır: sayfadaki `securitypolicyviolation` olayı, tarayıcının konsol mesajı (sayfa ve
  worker), Chromium DevTools "ContentSecurityPolicyIssue". Testler:
  1. her sayfada (`/`, `/editor`, `/gizlilik`, `/gizlilik/en`, 404) politika var, `<head>`'de
     charset'ten hemen sonra, tek; **negatif kontrol**: sonradan eklenen satır içi betik
     çalışmıyor, `blob:` worker'da `eval` `EvalError` veriyor ve izleyici ihlali görüyor;
  2. tam oturum: tanıtım sayfası → istemci gezinmesiyle editör; video aç (önizleme `blob:`,
     küçük resimler), **hızlı kesim** indirmesi (`copy`/`smart`), ikinci kesit + altyazı ile
     **tam encode** (worker'da yazı tipi), SRT indirme, sessizlik analizi, proje yedeği indir ve
     **geri yükle**, tanı dosyası, gizlilik sayfası yeni sekmede, sayfayı yeniden yükle ve
     **HDR** kaynağı SDR'ye encode — sıfır ihlal, sıfır sayfa hatası;
  3. örnek dosya açılıp oynuyor, ihlal yok.
- Yayın duman testi (`web/tests/pages/pages-smoke.spec.ts`, `/capcut/` altında statik çıktı):
  aynı izleyici; politika tanıtım ve gizlilik sayfasında; ayrıca `out/` içinde `.map` ve
  `.ts/.tsx` dosyası olmadığını denetler.

Sonuçlar (2026-09-30, Windows 11): bkz. §6.

Bilinen boşluk: URL'den başlayan worker'lar (dışa aktarma, sessizlik, HDR) statik sunucuda
politikasız çalışır — worker'ın politikası kendi yanıt başlığından gelir, Pages başlık
göndermez. `blob:` worker'lar sayfanın politikasını devralır ama içlerindeki bir ihlal sayfaya
raporlanmaz; bunlar işlerini bitirmelerinden (başarılı dışa aktarmalar) denetlenir.

### 2.3 Referrer

`<meta name="referrer" content="no-referrer">` (kök layout, Next `metadata.referrer`). Sitenin
kendi origin'i Referer okumaz (statik dosya), dışarı giden bağlantılar (GitHub Issues,
barındırıcının gizlilik bildirimi) sayfa adresini taşımaz. GitHub Issues bağlantısı zaten
`target="_blank" rel="noopener noreferrer"` (`ReportDialog.tsx`); `/gizlilik` bağlantıları aynı
origin, `rel="noopener"`.

### 2.4 Bağımlılıklar ve kaynak haritası

`docs/security/DEPENDENCIES.md`: `npm audit --omit=dev` ve `npm audit` 0 açık; runtime lisansları
(MIT, Apache-2.0, **MPL-2.0 mediabunny**, **OFL Inter**). `productionBrowserSourceMaps: false`
açıkça yazıldı; dışa aktarmada bulunan boş `.map` ve iki worker `.ts` kaynak kopyası artık
yayınlanmıyor. CI `checks` işine `npm audit --omit=dev --audit-level=high` eklendi (yüksek/kritik
bir açık yayını durdurur; deploy hâlâ bütün işlerin geçmesine bağlı).

`next start` artık `X-Powered-By` göndermiyor (`poweredByHeader: false`; yalnız yerel/e2e sunucu).

## 3. GitHub Pages'in kendisinin gönderdikleri (ölçüm)

`curl -sI https://erenulutas0.github.io/capcut/editor/` (2026-09-30 11:47 UTC):

| Başlık | Değer | Yorum |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31556952` | HSTS var (1 yıl); `includeSubDomains`/`preload` yok — `github.io` zaten tarayıcıların HSTS ön yükleme listesinde. |
| HTTP → HTTPS | `http://…/capcut/editor/` → `301 Location: https://…` | Zorunlu HTTPS. |
| `Access-Control-Allow-Origin` | `*` | Herkese açık statik dosyalar; çerez/kimlik yok, sızacak kişisel veri yok. |
| `Cache-Control` | `max-age=600` | 10 dk; chunk adları içerik hash'li. |
| `Content-Type` | `text/html; charset=utf-8` | |
| `Server`, `Via`, `X-Served-By`, `X-GitHub-Request-Id`, `X-Fastly-Request-ID` | GitHub / Fastly | CDN tanıtıcıları. |
| **Yok** | `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy` | Başlık ayarı olmadığı için; CSP ve referrer meta ile kapatıldı. |

`/capcut/editor` (eğik çizgisiz) `301` ile `/capcut/editor/`'a gider. Kök `robots.txt`
(`https://erenulutas0.github.io/robots.txt`) 404.

## 4. Kalan riskler

| Risk | Etki | Neden kapatılamadı / not |
|---|---|---|
| Başka site editörü `<iframe>` içine alabilir (clickjacking) | Düşük: dosya seçimi kullanıcı hareketi ister, medya zaten cihazdan çıkmaz, çerçeveleyen site içeriği okuyamaz | `frame-ancestors` ve `X-Frame-Options` meta ile çalışmaz. JS "frame-buster" zayıf bir önlemdir, eklenmedi. |
| `X-Content-Type-Options: nosniff` yok | Düşük: bütün dosyalar doğru `Content-Type` ile ve aynı origin'den | Başlık gerekir. |
| URL worker'ları politikasız | Düşük: worker kodu sitenin kendi derlenmiş chunk'ları; dışarıdan kod yüklemez (Turbopack önyükleyicisi yabancı origin'i reddediyor) | Başlık gerekir. |
| `'unsafe-hashes'` ile izinli stil değerleri | Çok düşük: yalnız birkaç sabit değer (ikon boyutu gibi) | Next'in sunucu tarafı `style` özniteliği üretmesi. |
| CSP ihlal raporu toplanmıyor | Yayındaki bir kırılma kullanıcı bildirene kadar görünmez | `report-uri` meta'da çalışmaz; ayrıca bir rapor sunucusu dışarıya istek demektir (bilerek yok). e2e ve duman testi yerine geçer. |
| `github.io` alt alan adı | Aynı kullanıcının başka Pages projeleri aynı origin'i paylaşır (`erenulutas0.github.io`): IndexedDB/OPFS ve CSP `'self'` bu origin'in tamamını kapsar | Kendi domain'i (K01) ile kalkar. |
| Lisans bildirimleri sitede yok | Hukuki (MPL-2.0 §3.2, MIT bildirimi) | Bkz. `DEPENDENCIES.md` §5; kurucu/hukuk kararı. |

## 5. Başlık ayarlanabilen bir barındırıcıda eklenecekler

Örnek: Cloudflare Pages `_headers` (veya Netlify `_headers`, kendi sunucusu). Hiçbiri kurulmadı;
barındırıcı değişikliği kurucu kararıdır.

```
/*
  Content-Security-Policy: <meta'daki politika> ; frame-ancestors 'none'; report-to <yerel olmayan rapor ucu yalnız kararla>
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload   (kendi domain'inde)
```

- **COOP + COEP** sayfayı "cross-origin isolated" yapar: `SharedArrayBuffer` ve daha hassas
  `performance.measureUserAgentSpecificMemory()` açılır (çok iş parçacıklı encode/bellek ölçümü
  için ileride işe yarayabilir). Önce doğrulanmalı: `blob:` worker'lar ve indirme akışı COEP ile
  çalışıyor mu.
- CSP başlıkta verilirse worker'lara da kendi yanıtlarıyla uygulanır (URL worker boşluğu kapanır)
  ve hash'ler yine derleme sonrası hesaplanır (aynı `scripts/lib/csp.mjs`).

## 6. Sonuçlar (2026-09-30, Windows 11, bu makine)

Çalıştırılan komutlar ve çıktıları (`web/` içinde):

| Komut | Sonuç |
|---|---|
| `npx playwright test tests/e2e/csp.spec.ts` (Playwright Chromium 153.0.8010.12) | 3 passed |
| aynı, `E2E_CHANNEL=chrome` (Chrome 154.0.8037.58) | 3 passed — tam oturumda 0 ihlal |
| aynı, `E2E_CHANNEL=msedge` (Edge 154.0.4258.37) | 3 passed — tam oturumda 0 ihlal |
| `npx playwright test` (tam e2e, `E2E_PORT=3221`) | 140 passed, 2 skipped (isteğe bağlı ekran görüntüsü testleri), 0 failed |
| `npx playwright test -c playwright.pages.config.ts` (CI ortam değişkenleriyle statik çıktı) | 2 passed |
| `node scripts/run-matrix.mjs --browser=chromium` | 22 PASS, 0 FAIL |
| `node scripts/run-matrix.mjs --browser=chrome` | 22 PASS, 0 FAIL |
| `npx vitest run` | 38 dosya, 484 test passed |
| `npx tsc --noEmit -p .`, `npx eslint .` | hatasız |
| `npm audit --omit=dev`, `npm audit` | 0 açık |

Politikanın bulduğu tek sorun bir testteydi: erişilebilirlik testinin WCAG 1.4.12 metin aralığı
denetimi sayfaya `<style>` enjekte ediyordu (`page.addStyleTag`) ve CSP bunu engelledi (ilk tam
e2e: 6 başarısız). Test artık aynı kuralları, bir kullanıcı stili/eklentisi gibi, oluşturulmuş
stil sayfasıyla (`adoptedStyleSheets`) uyguluyor; CSP bunu kapsamaz. Kullanıcının kendi
eklentileri ve tarayıcı stil ayarları CSP'den etkilenmez; sayfaya `<style>` ekleyen bir yer imi
betiği (bookmarklet) ise tarayıcıya göre engellenebilir (denenmedi).

Firefox ve Safari'de politika bu çalışmada denenmedi (Firefox dışa aktarmayı zaten açıkça
reddediyor; Safari için Mac yok, K04).

## Güncelleme 2026-09-30: Next.js 16.3.5 → 16.3.8

CI'a eklenen `npm audit --omit=dev --audit-level=high` kapısı aynı gün yeni yayımlanan
kritik bir uyarıyı yakaladı: GHSA-vcvr-r3jv-pc5j, "Next.js: Remote Code Execution in
next/og ImageResponse" (16.2.0–16.3.5). Uygulama `next/og` kullanmıyor ve GitHub Pages'te
sunucu kodu çalışmıyor (statik çıktı), yani yayındaki site bu yoldan etkilenmiyordu; yine
de yayın kapı geçene kadar durdu. `next` ve `eslint-config-next` 16.3.8'e (yama sürümü,
tam sabit) yükseltildi; `npm audit` 0 açık. Yükseltmeden sonra tam doğrulama: tsc, eslint,
vitest 509/509, derleme (CSP hash'leri yeniden hesaplandı), e2e 155 geçti / 2 atlandı
(CSP testi dahil), matris Chromium/Chrome/Edge 22/22, statik çıktı ve Pages duman testi 2/2.
Satır içi betik sayısı (2) ve CSP biçimi değişmedi.

## Güncelleme 2026-09-30: service worker, manifest, paylaşma (ADR-031)

**CSP değişmedi.** Yeni parçaların hepsi mevcut politikanın içinde:

| Parça | Hangi yönerge | Not |
|---|---|---|
| `<base>/sw.js` kaydı (`navigator.serviceWorker.register`) | `worker-src 'self' blob:` | Aynı origin; `blob:` gerekmez. |
| `<base>/manifest.webmanifest` (`<link rel="manifest">`, Next yazar) | `manifest-src 'self'` | Önceden de politikadaydı. |
| Simgeler (`/icons/*.png`, `/apple-icon.png`) | `img-src 'self'` | |
| Worker'ın kurulum istekleri | Worker'ın kendi politikası yok (Pages başlık göndermez; URL worker'larıyla aynı boşluk, §2.2) | Kod bizim şablonumuz (`web/scripts/lib/service-worker.js`): `importScripts`, `eval`, başka origin'e istek yok; yalnızca derleme anındaki listeyi aynı origin'den ister. |
| Önbellekten sunulan sayfalar | Aynı `<meta>` politika | Önbellekteki HTML, derlemenin CSP yazılmış HTML'inin aynısı (build-sw, apply-csp'den sonra çalışır). |

`next dev` worker'ı kaydetmez (hot reload ile önbellek önce çalışan worker karışmasın); dev'deki
`/sw.js` rotası boş bir yer tutucudur. `csp.spec.ts` tam oturumunda editörün ikinci yüklemesi artık
worker'ın kontrolünde (`navigator.serviceWorker.controller` doğrulanıyor) ve HDR dışa aktarmasının
worker betikleri önbellekten geliyor: 0 ihlal (sonuçlar ADR-031'de).

**Worker neyi yapmaz (kodla ve testle):** çalışırken ağdan gelen hiçbir yanıtı önbelleğe yazmaz
(önbellek yalnızca kurulumda listeyle `Cache.addAll` ile dolar, hep ya da hiç); POST'a, `Range`
isteklerine, başka origin'e ve `<base>/` dışına dokunmaz; bilinmeyen sayfayı eski bir sayfayla
karşılamaz (tarayıcının kendi hata sayfası). Bu yüzden "önbellek zehirlenmesi" için kullanıcının
etkileyebileceği bir adres önbelleğe giremez. Birim testi (`tests/unit/serviceWorker.test.ts`)
worker'ı sahte `caches`/`fetch` ile çalıştırıp bunları tek tek dener; e2e önbelleği listeyle
karşılaştırır.

**Kalan riskler:**

| Risk | Etki | Not |
|---|---|---|
| Kalıcı worker: hatalı bir yayın kullanıcının tarayıcısında kalır | Orta: çevrimiçiyken sayfalar ağdan gelir (network-first), yani düzeltilmiş yayın bir sonraki çevrimiçi açılışta sayfaya ulaşır; worker betiği HTTP önbelleği atlanarak (`updateViaCache: 'none'`) her gezinmede denetlenir. Çevrimdışıyken eski kopya açılır. | **Acil durum yolu (uygulanmadı, gerekirse):** şablonu `install`'da `skipWaiting()`, `activate`'te `clip-app-*` önbelleklerini silip `self.registration.unregister()` çağıran bir worker'la değiştirip yayınlamak. Sayfa kodu değişmeden bütün kopyalar ilk çevrimiçi açılışta kalkar. |
| `github.io` origin'i başka Pages projeleriyle paylaşılır | Düşük: aynı kullanıcının başka projeleri bu Cache Storage'ı okuyup silebilir; içinde yalnızca herkese açık uygulama dosyaları var. Worker yalnız `/capcut/` altını ele alır ve yalnız `clip-app-*` önbelleklerini siler. | Kendi domain'i (K01) ile kalkar. |
| Paylaşma menüsü | Kullanıcının seçtiği uygulamaya dosya gider (kullanıcının kararı). Uygulama `navigator.share` dışında bir şey çağırmaz; menüyü tıklama açar. | Paylaşılan hedefin ne yaptığı uygulamanın dışında. |
