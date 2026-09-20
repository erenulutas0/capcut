# 23 — Geliştirme Ortamı, CI/CD ve Yayın

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Depo düzeni önerisi

```text
apps/mobile/                  Flutter uygulaması
apps/web/                     Next.js pazarlama + editör
services/api/                 P3 FastAPI, erken fazda zorunlu değil
services/render-worker/       P3 izole render, erken fazda zorunlu değil
packages/contracts/           JSON Schema + ortak valid/invalid fixture'lar
packages/web-media/           Browser motor adaptörü
fixtures/media/manifest.md    Sentetik/lisanslı test dosyalarının sicili
benchmarks/                   Gerçek sonuçlar ve cihaz bilgisi
infra/                        Onay sonrası deployment tanımları
docs/                        Ürün/teknik kaynak belgeler
```

Boş mikroservis klasörleri, yüzlerce placeholder dosya veya hayali pipeline başlangıçta üretilmez. İlk prompt yalnızca gerekli spike/contract dosyalarını açar. Monorepo tüm dillerin aynı package manager'ı kullanması anlamına gelmez.

## Yerel hazırlık

Git ve bağımlılık sürümlerini doğrula; Flutter doctor, Android toolchain, node/package manager, gerektiğinde Python sanal ortam. macOS/Xcode yoksa iOS çalışma `BLOCKED_MACOS` olarak kaydedilir; kodun doğrulandığını söyleme. OS shell farkları için README'de gerçek çalıştırılmış komutlar tutulur.

`.env.example` yalnızca anahtar adları ve açıklamalar; gerçek secret yok. Örnek veri sentetik. Provider test anahtarları production'dan ayrı. Paket lockfile, formatter ve type config ilk çalışır dilimde eklenir.

## Pull request kontrolleri

1. Secret scan, formatter/lint/typecheck ve unit/contract testleri.
2. Değişen platformun build/test'i; web smoke ve security dependency scan.
3. Media engine değişmişse ilgili golden corpus; ağır cihaz kontrolleri etikete/schedule'a bağlanabilir ama release öncesi zorunludur.
4. Billing/ledger değişmişse yarış ve duplicate/out-of-order testleri.
5. Lisans/NOTICE ve SBOM farkı; kaynak/binary sürümü kaydı.

Coverage threshold, başlangıç baseline'ından sonra anlamlı kritik kapsamı korumak için belirlenir. Test çalıştırmayıp “coverage 90” yazılmaz. Flaky test karantinaya alınırsa sorumlusu ve son tarihi görünür; sessiz ignore kalıcı olmaz.

## Ortamlar

Dev sentetik veri; staging ayrı DB/bucket/provider sandbox; production gerçek kullanıcı. Production signing ve deployment için manual environment approval. PR/fork job'ları secret okuyamaz. Web preview deployment'ları private medyaya veya canlı webhook secret'ına erişemez.

Migration expand/contract yaklaşımıyla geri alınabilir hazırlanır. DB backup restore testi olmadan şema değişikliği production'a uygulanmaz. Worker versiyonu job recipe/engine sürümüne yazılır; uyumsuz eski job deterministik reddedilir veya desteklenen worker'a yönlenir.

## Mağaza yayını

Android signing/keystore sahipliği, Play App Signing, package ID, test tracks, target SDK, Data Safety, hesap silme URL'si ve gerekli reviewer bilgileri gerçek konsolda kontrol edilir. Bazı yeni kişisel hesaplar production erişimi öncesi kapalı test koşullarına tabidir; kullanıcının hesabına uygulanıp uygulanmadığı konsoldan doğrulanır. Sayı/gün şartları ezberden değil güncel yönergeden alınır. [S34](35_SOURCES.md#s34)

iOS bundle ID, provisioning, izin metinleri, privacy beyanı, IAP ürünleri ve reviewer erişimi hazırlanır. Yerel Free iş akışı reviewer hesabı olmadan denenebilir; Pro sandbox yönergesi ayrı verilir. Hesap silme/restore tuşları saklanmaz.

## Dağıtım ve geri alma

Kademeli rollout önerisi: küçük beta kohortu → ölçüm → daha geniş oran. Platformun izin verdiği gerçek dağıtım mekanizması kullanılır. Mobil binary geri alma her durumda web deploy rollback'i kadar hızlı değildir; server flag, minimum version gerektiren güvenlik durumu ve kullanıcı açıklaması planlanır.

Flags: `cloud_export`, `billing_sale`, `web_local_export`, `pro_batch`, `ai_beta`. Free yerel çekirdeği gelir deneyleri için uzaktan keyfî kapatma yok. Güvenlik nedeniyle riskli codec/engine sürümü kapatılırsa medya/proje erişimi korunur ve açık neden verilir.

## Yayın sonrası

İlk yeni sürüm cohort'unda error ve export failure karşılaştır; billing ve usage reconcile et; destek kuyruğunu incele. “App store'a yüklendi” ürünün bütün testleri geçti demek değildir. Detaylı nihai kapı [lansman listesinde](34_LAUNCH_CHECKLIST.md).
