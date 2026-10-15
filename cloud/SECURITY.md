# Bulut yazıya dökme yolu — güvenlik ve kötüye kullanım incelemesi (15 Ekim 2026)

> Kapsam: yayındaki vekil Worker (`cloud/worker/`, `https://lilocut-transcript-proxy.eerenulutass.workers.dev`),
> onun defteri (Durable Object), tarayıcı tarafı (`web/src/adapters/cloud/*`, `CloudRoute.tsx`), sitenin
> politikası (`web/scripts/lib/csp.mjs`) ve sağlayıcıya (AssemblyAI, AB) giden şey.
> Karar belgesi: [ADR-039](../docs/adr/ADR-039-cloud-transcript-route.md). Kurulum: [`worker/README.md`](worker/README.md).
>
> **Bu incelemede yayındaki Worker'a, Cloudflare'e ve AssemblyAI'ye tek bir istek gitmedi; `cloud/.env` ve
> `cloud/pass.txt` okunmadı; hiçbir şey yayınlanmadı.** Her kanıt yereldir: gerçek Worker kodu workerd içinde
> gerçek Durable Object'le ve sahte sağlayıcıyla (`worker/test/`), sahte Worker (`fake-worker/`), site Playwright
> ile sahte Worker'a karşı. Kanıtlanamayan her şey "kanıtlanmadı" diye yazılıdır; hiçbir tahmin kanıt diye sunulmadı.
> **Worker'da yapılan değişiklikler kurucu yeniden yayınlayana kadar yayında DEĞİLDİR** (aşağıda "Yeniden yayın").

## 1. Varsayımlar ve saldırgan

| Varlık | Değeri |
|---|---|
| Sağlayıcının ücretsiz kredisi (kart yok) | Kaybedilebilecek en çok şey: kalan kredi. Kart tanımlanmadığı sürece gerçek para çıkmaz ("API access is paused until you top up", ADR-039). |
| Kullanıcıların sesi ve yazısı | Ses Worker'dan akar, saklanmaz; yazı Worker'dan geçer, saklanmaz; sağlayıcıda silinene kadar durur. |
| Davet kodu | 60 dakikalık hak ≈ 0,23 $. Çalınırsa en çok bu kadar yakar (+ aşağıdaki "beyan yalanı" payı). |
| ADMIN_TOKEN ve ASSEMBLYAI_API_KEY | Yalnız Cloudflare'in sır kasasında. Worker'ın dışına hiçbir yanıtta, başlıkta, defter satırında çıkmaz (sınandı). |
| Sitenin kullanılabilirliği | Bulut yolu düşerse cihaz üstü yol çalışmaya devam eder; hiçbir mevcut özellik buluta bağlı değildir. |

Saldırgan: Worker'ın adresini bilen herkes (adres sitenin politikasında yazılıdır); bir davet kodunu çalmış
biri; sitenin kökeninde kod çalıştırabilen biri (XSS — bugün bilinen bir yüzey yok, aşağıda); sağlayıcıyı
yavaşlatan/durduran dış koşullar. CORS bir kimlik doğrulama **değildir**: `curl` istediği `Origin`'i gönderir;
asıl kapı davet kodudur. Cloudflare'in kendi ağı ve AssemblyAI'nin kendi sistemleri güvenilir sayılır
(onların politikalarına tabidir, bizim denetimimizde değildir).

## 2. Bulgular

Önem: **Yüksek** = para ya da başkasının verisi; **Orta** = sınırlı para / kullanılabilirlik; **Düşük** = bilgi
sızıntısı ya da kuralsızlık. "Kanıt" sütunundaki sınamalar `cloud/worker/test/security.test.ts` (S), `worker.test.ts`
(W), `contract/cases.mjs` (C, hem gerçek Worker'a hem sahteye koşar), `fake-worker/test/admin-script.test.mjs` (A).

| # | Konu | Önem | Kanıt | Durum |
|---|---|---|---|---|
| M1 | **Davet kodu tahmini, `/v1/quota` üzerinden sınırsızdı.** Başlatma (`POST /v1/jobs`) her denemeyi IP sayacına yazıyordu; kota sorgusu yazmıyordu ("Hız sınırına sayılmaz"). Kod 100 bit (32'lik alfabe × 20), tahmin pratikte olanaksız; ama her deneme Durable Object'e bir istek ve bir satır yazımıydı. | Orta (para için Düşük, kullanılabilirlik için Orta) | C "guessing codes through quota counts like guessing them through a start"; eski davranış `cases.mjs`'in önceki sürümünde | **Düzeltildi** (Worker, yeniden yayın gerekir): bilinmeyen/iptal kodla kota sorgusu sayaca yazılır, sınırın üstünde `429 rate_limited` + `Retry-After`. Bilinen kodun kotası sayılmaz ve sınırlanmaz (kart her açılışta sorar). Sayaç başlatmalarla ortaktır. |
| M2 | Tavan yarışı: aynı anda gelen başlatmalar tavanı geçebilir mi? | Yüksek (olsaydı) | S "twelve half-hour starts at once, exactly the eight that fit are accepted": 12 eşzamanlı 30 dk işten tam 8'i kabul (0,92 $ ≤ 1 $), 4'ü `monthly_cap_reached`; W aynı şey 5 × 2 saat. Defter tek Durable Object, `transactionSync` içinde "denetle + ayır". | **Kanıtlandı, aşım 0.** |
| M3 | Çalınmış davet kodu çok IP'den aynı anda | Orta | S "a stolen invite used from many addresses at once starts one job": 6 adresten 6 başlatma → 1 kabul, 5 `job_in_progress`; sağlayıcıya 1 yükleme. | **Kanıtlandı.** Davet başına tek iş + dakika hakkı. Kurucu `admin.mjs invites revoke` ile keser. |
| M4 | **Beyan yalanı** (`x-audio-duration-s` küçük, dosya uzun). Bayt sınırı: beyan × 8000 B/s + 64 KB. Sağlayıcıya `audio_end_at = beyan + 1 s` gönderilir; iş bitince sağlayıcının `audio_duration`'ı deftere yazılır, beyanı %2 + 3 sn'den çok aşan davet askıya alınır. | Orta | W "the provider's own length is what is charged; a file much longer than declared suspends the invite" | **Denetim var; en kötü durum ADR-039'daki gibi:** sağlayıcı `audio_end_at`'e göre faturalıyorsa aşım ≈ 1 sn; tüm dosyaya göre faturalıyorsa (kanıtlanmadı) davet başına en çok 10 sa × 0,23 $ = 2,30 $, sonra askı. |
| M5 | **Bitmeden silinen uzun dosya.** Beyan 1 sn, dosya uzun; kullanıcı sağlayıcı bitirmeden `DELETE` derse defter gerçek süreyi hiç göremez. Önceden yalnız ayrılan (1 sn) yazılıyordu, askı tetiklenmiyordu: "1 sn beyan et, 72 KB gönder, bitmeden sil" döngüsü 60 dakikalık davette **3600 tur** dönebilirdi; 72 KB, 6 kbit/s Opus'ta ≈ 98 sn ses → sağlayıcı tüm dosyayı faturalıyorsa davet başına ≈ 98 saat ≈ 22 $, defter 0,23 $ görürdü. | Orta — **ancak** sağlayıcı bitmemiş-silinmiş kaydı tüm dosya süresine göre faturalıyorsa; `audio_end_at`'e göre faturalıyorsa 0. Hangisi olduğu kanıtlanmadı. | S "M5: … charged the reservation plus the upload slack (89 s …)", S "M5 bound: … runs out of invite minutes after 41 rounds", S "M5 for honest users: … at most 88 s"; C "deleted before the provider finished …" | **Düzeltildi** (Worker, yeniden yayın gerekir): bitmeden silinen iş ayrılan süre + 64 KB'lık payın 6 kbit/s'deki karşılığını (**88 sn**) öder, ama baytlarının 6 kbit/s'de taşıyabileceğinden fazlasını değil (`earlyDeleteSeconds`). Tahmin askıya almaz (askı yalnız sağlayıcının kendi süresiyle). Döngü artık **41 turda** davetin dakikasını bitirir. Dürüst iptal en çok 88 sn (≈ 0,006 $) fazla öder. **Kalan:** beyan edilen kısmın bit hızı kaldıracı (beyan × 8000 B/s, 6 kbit/s'de ≈ 10,7 kat) — davetin dakikasıyla sınırlı, M4 ile aynı büyüklük (60 dk davette ≈ 10,7 sa ≈ 2,46 $, yalnız tüm-dosya faturalamasında). Öneri: kurucu tek gerçek işle `audio_end_at` ve bitmeden-silme faturalamasını doğrulasın (ADR-039 "doğrulanmayan"); faturalama tüm dosyaya göreyse `MAX_BYTES_PER_SECOND`'u sitenin gerçek hızına yaklaştırmak (site ≤ 32 kbit/s = 4000 B/s gönderir; 5000 kaldıracı ≈ 6,7'ye indirir; yayın gerekir) kurucu kararı. |
| M6 | Yavaş/bitmeyen sağlayıcı: ayrılan para sonsuza kadar bloke mi? | Orta | S "a provider that never finishes …": 24 saat sonra alarm ayrılanı harcanmış sayar, kaydı sağlayıcıda siler, daveti serbest bırakır. Yüklemesi 30 dk'da bitmeyen iş: S "an upload that stalls holds its reservation for 30 minutes at most" — geç gelen yükleme `job_canceled`, sağlayıcıda kayıt açılmaz. | **Kanıtlandı.** |
| M7 | Acil düğme | — | S "the kill switch refuses every new start and quota says off, while a job already running can still be finished and deleted"; C "the emergency switch". | **Kanıtlandı.** Süren iş bitirilir ve silinir (ADR kararı). Yayın gerekmez. |
| M8 | **Kısa ADMIN_TOKEN**: 24 karakterden kısaysa yönetim API'si yoktu (404) ama para yolu "kurulmuş" sayılıyordu. | Düşük (yayındaki belirteç uzun; tutarsızlık) | S "without the admin token nothing can be spent … missing or short" | **Düzeltildi** (Worker): tek kural `adminTokenOf` — kısa belirteç = kurulmamış = `cloud_off`. |
| M9 | IP sayacının tuzu ADMIN_TOKEN'dır | Düşük | kod: `index.ts` `ipHash` | Değişmedi. Özet 32 hex; tuz bilinmeden adrese dönmez. Belirteç döndürülünce o saatin sayaçları boşa düşer (en çok 1 saat gevşeme), zararsız. |
| D1 | Başkasının yazısını okumak: iş kimliği + davet bağı | Yüksek (olsaydı) | W/C "a job belongs to its invite"; S "a foreign origin holding a valid invite and a valid job id gets nothing" | **Kanıtlandı.** Kimlik UUID v4 (122 bit); durum/sonuç/silme `invite_hash` ile eşleşmeden 404. Var olan bir adı almak `job_id_taken` der (var/yok bilgisi; 122 bitte anlamsız). |
| D2 | Sonucun başka kökene sızması (CORS) | Yüksek (olsaydı) | S: kota, durum, sonuç, silme — yabancı ya da boş `Origin` ile 403 `origin_not_allowed`, `Access-Control-Allow-Origin` yok, kimlik bilgisi izni yok, ön uçuş 403. | **Kanıtlandı.** `ALLOWED_ORIGINS` tam eşleşme; joker yok. |
| D3 | Sırların günlüklere düşmesi | Yüksek (olsaydı) | S "neither the provider key nor the admin token appears in any answer, header or ledger row — including error paths"; kodda `console` yok; `wrangler.jsonc` `observability: false`. | **Kanıtlandı (bizim tarafta).** Cloudflare'in ağ işleme kayıtları (istek sayısı, hata oranı) onların politikasına tabidir; Workers Logs kapalı olduğu için istek başlıkları (ör. `Authorization: Bearer <davet>`) tarafımızca saklanmaz. Sağlayıcı yalnız kendi anahtarını görür, davet kodunu görmez. |
| D4 | Worker ADR'den fazlasını saklıyor mu | Orta | W "the ledger holds no audio, no text, no invite code, no IP address" (sütun listesi sabit) | **Kanıtlandı.** Davet özeti + etiket + dakika; iş satırı (kimlik, özet, sağlayıcı kimliği → silinince boş, saniyeler, bayt, durum, zaman); ay toplamları; IP özeti + sayaç (≤ ~70 dk). |
| D5 | Sekme kapanırken `keepalive` DELETE (özel başlıkla) | Düşük | kod: `CloudRoute.tsx` `pagehide` → `deleteRun(run, true)`; `cloudClient.ts` `keepalive`. | **Kanıtlanmadı** (gerçek telefon/tarayıcı; ADR-039 da "doğrulanmayan" sayıyor). Başarısız olursa zarar yok: temizlik alarmı sonuç hazır olduktan 60 dk sonra, her durumda 24 saatte siler. Ön uçuş önbelleği (`max-age 600`) aynı adrese daha önce gidilmiş olduğu için büyük olasılıkla isabet eder. |
| D6 | Sonuç olduğu gibi geçer: sağlayıcının nesnesindeki `audio_url` (yükleme adresi) ve kayıt kimliği tarayıcıya ulaşır | Düşük | kod: `provider.ts` `fetchResult` | Değişmedi: megabaytlık JSON'u ayrıştırmak Free planın 10 ms işlemci sınırını yer. `audio_url` sağlayıcının anahtarla erişilen özel adresidir; sonuç alınınca kayıt ve ses silinir. |
| D7 | Bir davetli, `remainingMinutes` üzerinden ayın küresel kalan tavanını çıkarabilir (`min(davet, tavan)`) | Düşük | kod: `ledger.ts` `quota` | Değişmedi (kart "Y dakikan kaldı" için gerekli). Kişisel veri değil. |
| D8 | **Kaydı açılmamış yükleme sağlayıcıda kalır.** Ses yüklendi ama kayıt (transcript) açılmadıysa — kullanıcı yükleme sürerken iptal etti (`job_canceled`), sağlayıcı kaydı reddetti (`502 create`) — silinecek bir kayıt yoktur; sağlayıcının API'sinde yalnız yüklemeyi silen uç yok. | Düşük (veri; para 0) | kod: `index.ts` `isReserved` → `job_canceled`; `catch` (kayıt açılamadı) | **Kalan risk:** o ses sağlayıcının saklama kuralıyla silinir ("deletion process begins at 24 hours and is at most 48 hours", ADR-039), AB bölgesinde. Kayıt açıp hemen silmek para yakar; yapılmadı. Gizlilik sayfasındaki "silinmezse 24–48 saat" cümlesi bu durumu da kapsar. |
| D9 | Sağlayıcı kaydı açtıktan hemen sonra defter yazılamazsa (`attachTranscript` hata verirse) kayıt kimliği deftere düşmez | Düşük | kod: `index.ts` `catch` → `waitUntil(deleteTranscript)` | Silme tek denemedir; o da başarısız olursa kayıt sağlayıcıda 30 gün durur ve `spend` onu göremez. Yalnız Durable Object'in kendisi hata verirken olur (ölçülmedi). Olay kılavuzu 4. adım: AssemblyAI panelindeki kayıt listesi ile `spend` karşılaştırılır. |
| A1 | Yönetim belirteci karşılaştırması zamana bağlı mı | Orta (olsaydı) | kod: `sameSecret` → iki taraf SHA-256 → `crypto.subtle.timingSafeEqual`; S "… 404 not_found" aynı uzunlukta yanlış belirteçle | **Kanıtlandı.** |
| A2 | Yönetim API'sinde hız sınırı yok | Düşük | — | Değişmedi: belirteç ≥ 24 rastgele karakter (öneri 32 bayt base64url = 43), 404 ile yanlış/boş ayırt edilmez, Durable Object'e dokunmaz (ucuz). Kaba kuvvet olanaksız. |
| A3 | Belirteç adreste taşınıyor mu | Yüksek (olsaydı) | kod: yalnız `Authorization: Bearer`; `admin.mjs` de öyle; iptal adresi özetin 12 karakteri (sır değil). | **Yok.** |
| A4 | Adresi bilen yabancı ne öğrenir | Düşük | S "the root, an unknown path, the admin API without the token … all look the same: 404 not_found" | Sürüm yok, rota listesi yok, `server` başlığı yok. Zamanlama: kodsuz istek defter'e gitmeden 401, yanlış kodla defter yolculuğu — kodun biçimi zaten ekranda yazılı, öğrenilecek sır yok. |
| A5 | **`admin.mjs` belirteci düz `http://` ile ya da bir yönlendirmenin ardından başka bir adrese gönderebilirdi** (`--url` / `CLOUD_WORKER_URL` yanlış yazılırsa ya da başkasının değeriyse). | Orta (belirteç = davet verme + acil düğme) | A "the token never travels in clear to another machine, and never follows a redirect" | **Düzeltildi** (yerel komut, yayın gerekmez): `http://` yalnız 127.0.0.1 / localhost / [::1]; başka her `http` adresi belirteç okunmadan, istek atılmadan reddedilir; `redirect: 'error'` — yönlendiren adresin hedefi hiç istek görmez (sınandı). |
| A6 | Davet iptali id **öneki** ile (`LIKE 'önek%'`, en az 8 hex) | Düşük | kod: `ledger.ts` `revokeInvite` | 8 karakterlik önek birden çok daveti iptal edebilir; `admin.mjs` `invites list`'in 12 karakterini kullanır (çakışma olasılığı ≈ davet² / 2⁴⁸). Yalnız kurucu yapabilir; yanlış iptal yeni davetle geri alınır. Değişmedi. |
| S1 | Sitede XSS yüzeyi (davet kodu `localStorage`'da) | Yüksek (olsaydı) | `grep`: `web/src` içinde `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` **yok**; SRT/VTT içe aktarma, yazı metni ve dosya adları React metin düğümü; tek satır içi betik sayfa bekçisidir (`page-watchdog.js`, kullanıcı verisi içermez) ve politikada özetiyle izinlidir; `script-src 'self' + özetler`, `object-src 'none'`, `base-uri 'self'`. | **Bilinen yüzey yok.** XSS olsa kayıp en çok davetin kalan dakikası (0,23 $) — kurucu iptal eder. |
| S2 | `github.io` kökeni başka Pages projeleriyle ortak: aynı kökendeki başka bir proje `clip.cloudInvite`'ı okuyabilir | Düşük–Orta | `docs/security/2026-09-30…` §"github.io origin'i" (önbellek için aynı not) | **Kalan risk.** Alan adı yok (kurucu kararı K01/K03). Kurucu aynı hesapta üçüncü taraf betik yükleyen bir Pages projesi yayımlamamalı. Kayıp sınırı yine davet dakikası. |
| S3 | CSP `connect-src` vekil kökenini doğru kazanıyor mu; başka köken sızıyor mu | Orta | `web/tests/pages/cloud-preflight.spec.ts` (her sayfa tam `'self' <vekil>`), `tests/e2e/cloud-off.spec.ts` (kapalıda hiçbir köken), `scripts/lib/cloudOrigin.mjs` (yol/joker/`http` derlemeyi durdurur) | **Kanıtlı (önceki çalışmalar), değişmedi.** |
| S4 | Service worker vekil yanıtlarını önbelleğe alıyor mu | Orta (olsaydı) | `web/scripts/lib/service-worker.js`: `url.origin !== self.location.origin → false` — başka köken hiç ele alınmaz; çalışırken ağdan gelen hiçbir yanıt yazılmaz (birim sınaması var). | **Yok.** Yazı Cache Storage'a girmez. |
| S5 | `ALLOWED_ORIGINS` yayında `http://localhost:3000` ve `http://127.0.0.1:3000` içeriyor | Düşük | `worker/wrangler.jsonc` | Değişmedi: CORS kimlik değil; `curl` zaten her kökeni gönderir. Yerel geliştirme için gerekli (README "Yerelde denemek"). İstenirse yayından çıkarılabilir (yeniden yayın). |
| P1 | Sağlayıcı ne alıyor | — | W "the right things are sent upstream": `authorization: <anahtar>`, ham baytlar `application/octet-stream` (dosya adı yok), JSON parametreler (`audio_url`, model, dil/algılama, konuşmacı, `audio_end_at`). Kullanıcı IP'si değil Cloudflare'in çıkış IP'si. | **Kanıtlandı.** Tarayıcının WebM'inde kaynak dosyadan hiçbir etiket kopyalanmaz (ADR-039 "Ses dosyası"). |
| P2 | Bölge sabitleme | Orta | `config.ts`: `eu`/`us` dışı her değer → `eu`; `PROVIDER_BASE_URL_OVERRIDE` yalnız tam `http://provider.mock`; sınamada başka bir konağa giden istek sınamayı düşürür (`leaks`). | **Kanıtlandı (kod).** Yayındaki `PROVIDER_REGION` değeri bu çalışmada okunmadı. |
| P3 | Silme doğrulaması | Orta | W/C: sonuç geçince, DELETE'te ve alarmla silinir; 404 "zaten yok" sayılır; başka hata alarmla 10 dakikada bir yeniden denenir; `admin.mjs spend` → "sağlayıcıda hâlâ duran kayıt" 0 olmalı. | **Kanıtlandı (sahte sağlayıcıyla).** Gerçek sağlayıcıda 11 Ekim ölçümünde 12/12 silindi. |
| P4 | `x-job-id` çakışması/tahmini | Düşük | W "a job name that is not a UUID is refused; a name already used is refused" | **Kanıtlandı.** Biçim UUID, var olan ad kimin olursa olsun 409. |
| V1 | İstek boyutu | — | `config.ts`: 95 MB üst sınır + beyan × 8000 B/s + 64 KB; `Content-Length` zorunlu (411). | **Kanıtlandı** (W "heavier than its declared length allows"). |
| V2 | Yavaş yükleme (slowloris) | Düşük | M6'daki S sınaması: 30 dk sonra ayrılan geri verilir; yalnız davetli yapabilir; davet başına tek iş olduğu için en çok 120 dk × 0,23 $/60 = 0,46 $ tavanı 30 dk bloke eder. | **Kanıtlandı.** |
| V3 | **Durable Object tek iş parçacığı + Free plan günlük sınırı (Worker 100 000 istek/gün, DO 100 000 istek/gün, 100 000 satır yazımı/gün)** | Orta (kullanılabilirlik; para 0) | — | **Kalan risk, kanıt gerekmez:** `Origin` başlığını bilen tek kişi bir günde sınırı doldurup o gün bulut yolunu herkese kapatabilir. Kapıda reddedilenler (yabancı köken, kodsuz, ses değil, uzunluk) defter'e dokunmaz (S "requests refused before the ledger"); yanlış kodla her deneme bir DO isteği + bir satır yazımı (sayaç için gerekli). `workers.dev` adresinde Cloudflare WAF/hız kuralı yok (alan adı ister). Sonuç: cihaz üstü yol çalışır, para harcanmaz; ertesi gün açılır. |
| V4 | Durum sorgusunun her çağrısı sağlayıcıya gider | Düşük | kod: `index.ts` `refresh()` | Sağlayıcının hız sınırı **hesap geneli**dir (tek anahtar; SSS: 5 dakikada 20 000 istek): süren işi olan bir davetli saniyede onlarca sorguyla birkaç dakikalığına **herkesin** durum/sonuç çağrısını `provider_error`'a düşürebilir. Para yok; davet gerekir; aynı kişi V3'teki günlük sınırı da zaten doldurabilir. Değişmedi (önbellek için DO'ya satır yazmak V3'ü kötüleştirir). Kötüye kullanan davet `invites revoke` ile kesilir. |
| V5 | Ortak IP (operatör NAT'ı, okul/iş ağı): saatlik sayaç adres başınadır | Düşük | kod: `ledger.ts` `countAttempt` | Aynı çıkış adresini paylaşan biri yanlış kodlarla saatte 10 deneme yaparsa, aynı adresteki dürüst davetli o saat **başlatamaz** (`429`, Retry-After ≤ 1 sa). Kotası (bilinen kod) sınırlanmaz. Kalan risk; sayaç kod tahminini yavaşlatmak için gerekli. |
| T1 | `npm run test:fake` / `test:harness` Node 22'de çalışmıyordu (`node --test <dizin>`) | — (araç) | kurucunun Node'u 22.23 | **Düzeltildi** (`package.json` glob). |

## 3. Denetimler (kod ve sınama ile)

Sıra, `POST /v1/jobs` için, ucuzdan pahalıya (hiçbiri defter'e ya da sağlayıcıya dokunmadan reddeder):
köken (`ALLOWED_ORIGINS`, tam eşleşme) → davet kodu var mı → `ENABLED`, tavan > 0, anahtar + uzun ADMIN_TOKEN
→ `Content-Type` ses türü → `Content-Length` (≤ 95 MB ve ≤ beyan × 8000 + 64 KB) → süre (≤ 120 dk) → dil
biçimi → iş adı biçimi. Sonra defter, **tek atomik adımda**: IP sayacı (10/saat yayında) → acil düğme → davet
geçerli → davette süren iş yok → davetin dakikası → aylık tavan (harcanan + ayrılmış + bu iş) → ayır. Sonra ilk
baytlar türe uyuyor mu; gövde belleğe alınmadan sağlayıcıya akar; `audio_end_at` beyanla sınırlar. Bitince
sağlayıcının süresi yazılır; beyanı aşan davet askıya alınır. Sonuç geçince / DELETE'te / alarmla silinir.

Tarayıcı: kod yalnız `Authorization` başlığında; `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`; her
derlemede tek köken (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`), politika `connect-src 'self' <köken>`; kapalı derlemede
bulut kodu **yoktur** (`apply-csp.mjs` durdurur). Rıza: hiçbir şey ön seçili değil; kayıtlı kod yokken ekran istek
atmaz; ses "Sesi gönder ve yaz"a basılmadan çıkmaz (`cloud-preflight.spec.ts`).

## 4. Kalan riskler (dürüst liste)

1. **Sağlayıcının faturalama kuralları** (`audio_end_at`, bitmeden silinen kayıt) belgelerden kanıtlanmadı → M4/M5.
   M5'in döngü kaldıracı kapatıldı (her tur ≥ 88 sn sayılır); kalan, beyan edilen kısmın bit hızı kaldıracıdır
   (≈ 10,7 kat, davetin dakikasıyla sınırlı: 60 dk davette ≈ 2,46 $, yalnız tüm-dosya faturalamasında).
   Mutlak sınır kart olmamasıdır. **Karta bağlanmadıkça** en kötü durum kalan kredi.
2. **Günlük Free plan sınırı** tek kişiyle doldurulabilir → V3 (davetliyse sağlayıcının hesap geneli hız
   sınırı da → V4). Para 0, kullanılabilirlik 1 gün / birkaç dakika.
3. **`github.io` ortak kökeni** → S2.
4. **Kaydı açılmamış yükleme** sağlayıcıda 24–48 saat kalır → D8. **Ortak IP**'de dürüst kullanıcı bir saat
   başlatamayabilir → V5.
5. **Gerçek Cloudflare'de ölçülmeyenler**: 10 ms işlemci sınırı, alarmın güvenilirliği, akıtılan gövde,
   `keepalive` DELETE (ADR-039 "doğrulanmayan"). Hepsi kullanılabilirlik/temizlik; para denetimi defterdedir.
6. **Bağımlılıklar**: `cloud/` yalnız geliştirme araçları (wrangler, vitest, workerd); siteye girmez.
   `@cloudflare/vitest-pool-workers` kullanımdan kalkıyor (yeni ad `@cloudflare/vitest-plugin`).

## 5. Kurucu için işletme

Komut: `node cloud/admin.mjs …` (bağımlılık yok). Belirteç `ADMIN_TOKEN` ortam değişkeninden, yoksa
`cloud/pass.txt`'den (ilk boş olmayan satır; `ADMIN_TOKEN=` öneki olabilir) **yalnız komut çalışırken** okunur;
hiçbir çıktıya yazılmaz. Adres varsayılan yayındaki vekildir; `--url=…` ya da `CLOUD_WORKER_URL` ile değişir.

| Ne | Nasıl |
|---|---|
| **Harcamayı okumak** | `node cloud/admin.mjs spend` → ay, tavan, harcanan, ayrılmış, kalan, süren iş, **sağlayıcıda duran kayıt (0 olmalı)**, davetler. Bu bizim defterimizdir; AssemblyAI panelindeki Billing ile ayda bir karşılaştır — ikisi uyuşmalı. |
| **Davet vermek** | `node cloud/admin.mjs invites add arkadas-3 60` → kod bir kez görünür; kişiye ver. Etikete gerçek ad yazma. |
| **Davet iptal** | `node cloud/admin.mjs invites list` → id; `node cloud/admin.mjs invites revoke <id>`. Anında: kota 401, yeni iş 401; süren iş biter ve silinir. |
| **Acil kapatma** | `node cloud/admin.mjs kill on` (saniyeler, yayın gerekmez). Geri: `kill off`. Kesin kapatma: `ENABLED=false` + yayın; kökten: AssemblyAI panelinden anahtarı iptal. |
| **API anahtarını döndürmek** | AssemblyAI panelinde yeni anahtar üret → `cd cloud && npx wrangler secret put ASSEMBLYAI_API_KEY --config worker/wrangler.jsonc` (değer ekrana yazılmaz) → eskisini panelde iptal et. Süren işler yeni anahtarla sürer (aynı hesap). |
| **ADMIN_TOKEN'ı döndürmek** | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` → parola yöneticisine ve `cloud/pass.txt`'ye yaz → `npx wrangler secret put ADMIN_TOKEN --config worker/wrangler.jsonc`. Yan etki: o saatin IP sayaçları sıfırlanır (zararsız). |
| **Yeniden yayın** (bu incelemenin Worker değişiklikleri için) | `cd cloud && npm ci && npm test && npx wrangler deploy --config worker/wrangler.jsonc`. Yayından sonra `node cloud/admin.mjs spend` ile defterin okunduğunu doğrula (Durable Object ve sırlar yayınla değişmez). |

### Olay kılavuzu: kredi eriyor / beklenmeyen harcama

1. **Durdur:** `node cloud/admin.mjs kill on`. (Komut çalışmıyorsa Cloudflare panelinden `ENABLED` → `false`;
   o da olmuyorsa AssemblyAI panelinden anahtarı iptal et — en kesin yol.)
2. **Bak:** `node cloud/admin.mjs spend` — hangi davet kaç dakika kullanmış, ayrılmış ne kadar, sağlayıcıda duran
   kayıt var mı. AssemblyAI Billing sayfasıyla karşılaştır: defterin görmediği harcama varsa (M4/M5 ya da anahtar
   sızıntısı) fark oradadır.
3. **Kes:** şüpheli davetleri `invites revoke`. Defterin görmediği harcama varsa **anahtarı döndür** (yukarıda) —
   sızmış bir anahtar bizim Worker'ımızı hiç kullanmadan harcar; defter onu göremez. `invites list`'te senin
   vermediğin bir etiket varsa **ADMIN_TOKEN sızmıştır**: önce belirteci döndür (yukarıda), sonra o davetleri
   iptal et (eski belirteçle yeni davet açılamaz olur).
4. **Kayıtları temizle:** `spend` → "sağlayıcıda hâlâ duran kayıt" > 0 ise alarm 10 dakikada bir dener; 24 saat
   sonra hâlâ > 0 ise AssemblyAI panelinden kayıtları elle sil.
5. **Yeniden aç:** nedeni anladıktan sonra `kill off`; gerekirse `MONTHLY_CAP_USD`'yi düşür (yayın gerekir).
6. **Yaz:** ADR-039'a bir ek (ne oldu, ne kadar, ne değişti). Kart **eklenmez** (ADR-039 kurucu kararı 11).

## 6. Sınamalar

```bash
cd cloud && npm ci
npm run test:worker     # vitest + workerd, gerçek Durable Object, sahte sağlayıcı — 60 (25 + 20 sözleşme + 15 güvenlik)
npm run test:fake       # node:test — 32 (aynı 20 sözleşme + 5 sahteye özgü + 7 admin.mjs)
npm run test:harness    # 39
npm run typecheck
```

Son kodda koşulanlar (15 Ekim 2026, Node 22.23): `test:worker` **60/60**, `test:fake` **32/32**,
`test:harness` **39/39**, `typecheck` temiz. (`node --test harness/test/` biçimi Node 22'de dizini kabul etmez —
T1; bu yüzden betikler glob kullanır.) Web: `tsc --noEmit` ve `eslint .` temiz, `vitest run` **1458/1458**;
bulut paketi (`CLIP_TEST_HOOKS=1 NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL=http://127.0.0.1:38197 npm run build`, sonra
`npx playwright test -c playwright.cloud.config.ts`, sahte Worker'a karşı) **55 geçti, 4 atlandı, 0 başarısız**.
Bu incelemede web koduna dokunulmadı; olağan e2e paketi ve `web/tests/pages/cloud-preflight.spec.ts` bu yüzden
yeniden koşulmadı (son sonuçları ADR-039'da).
