# 07 — Mimari ve Başlangıç Kararları

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Mimari şekli

```text
Flutter mobil UI ── application/domain ── MediaEngine port
                                      ├─ Android: Media3/Kotlin
                                      └─ iOS: AVFoundation/Swift

React web UI ───── application/domain ── WebMediaEngine
                                      └─ Worker + WebCodecs + mux/demux

Ortak sözleşme: EDL JSON + validation fixtures + export policy

İsteğe bağlı P3 hizmetleri:
Client → Auth/API (FastAPI, modüler monolit) → PostgreSQL
                         ├─ Billing provider adapters/webhooks
                         └─ Job queue → isolated FFmpeg workers → private object store
```

Yerel edit ve export backend ayakta olmasa da çalışmalıdır. Webin ilk dosyalarını internetten yüklemesi ve PWA offline cache desteği ayrı konudur; ilk sürüm için ilk yüklemeden itibaren sınırsız offline garanti verilmez.

## ADR-001 — Ortak tarif, ayrı motor

Karar önerisi: Dart ve TypeScript arayüzleri aynı sürümlü EDL sözleşmesini kullanır; render kodu platformlara göre farklıdır. Ortak fixture'lar görsel/audio semantiğini kontrol eder. Kazanç: platform araçlarından yararlanma. Bedel: üç motorun davranış uyumu için gerçek test yükü.

Alternatif: Tüm cihazlarda tek WASM/FFmpeg motoru. Neden başlangıç değil: dağıtım, bellek, performans, lisans ve native deneyim riskleri. Bir motor seçerek bütün codec risklerinin yok olduğunu varsaymayız.

## ADR-002 — Native köprü

Flutter sadece dosya kimliği, komut, proje tarifi ve durum mesajı taşır. Büyük video kareleri/ses PCM'i kanaldan geçirilmez. Kotlin/Swift kaynak yaşam döngüsünün sahibidir. Resmî platform kanalları bu entegrasyon sınırını sağlar; köprünün tasarımı bizim sorumluluğumuzdur. [S05](35_SOURCES.md#s05)

## ADR-003 — Web kabiliyet kontrolü

React/Next.js pazarlama sayfaları ve web UI için; medya kodu client-only ve Worker tabanlıdır. Mediabunny, mux/demux ve dönüşüm için adaydır; lisansı ve gerçek H.264/AAC encode kabiliyeti doğrulanmadan ürün garantisine dönüşmez. [S09](35_SOURCES.md#s09) [S10](35_SOURCES.md#s10)

Browser adı allowlist'i yalnız başına yeterli değildir. Desteklenen yapılandırma testi + küçük gerçek render + cihaz matrisine göre rota seçilir.

## ADR-004 — Yerel önce, geçici bulut

Kalıcı bulut dosya kütüphanesi MVP dışında. Bulut, sınırlı işlem hizmetidir; medyayı açık rızayla/uygun hukuki temelde işlemek ayrı, saklamak ayrı ürün kararıdır. Genel “videolar hiç yüklenmez” vaadi verilip sonra sessiz fallback yapılmaz.

## ADR-005 — Modüler monolit

FastAPI içinde `identity`, `billing`, `entitlements`, `media_jobs`, `usage`, `support` modülleri. İlk etapta tek deploy, tek ilişkisel veri kaynağı. Render işçisi ayrı güvenlik/işlem sınırında. Modüller arası çağrıları gereksiz mikroservislere çevirmeden uygulama servisleri üzerinden yap.

Queue teknolojisi P3 spike'ında seçilip kilitlenir; iş kuyruğunun kendisi muhasebe kaynağı değildir. PostgreSQL job/usage kayıtları esas kayıttır. At-least-once teslimata dayanıklı tasarım gerekir.

## ADR-006 — Sağlayıcıdan bağımsız hak modeli

Mobil satın almalar için RevenueCat aday adaptörü, web için kabul edilen bir merchant-of-record adaptörü; içeride kanonik entitlement ve kota defteri. UI satın alma SDK'sı doğrudan bulut haklarını yetkilendirmez. Sağlayıcı değişiminde canonical account ve dönem kayıtları korunur.

## ADR-007 — Aşamalı destek matrisi

Android dar alfa ve desktop web destek matrisi önce; iOS gerçek donanımla doğrulanır. Aynı gün bütün platformları yayınlama zorunluluğu yoktur. Mac/Xcode ve gerçek iPhone doğrulama maliyeti planlanır. [S06](35_SOURCES.md#s06)

## Bağımlılık yönü ve kod sınırları

Domain: `Project`, `Clip`, `AudioTrack`, `ExportPolicy`, `QuotaQuote`; I/O yok. Application: `ImportAsset`, `AddRange`, `ReorderClips`, `SaveProject`, `PrepareExport`. Port: `AssetRepository`, `ProjectRepository`, `MediaEngine`, `BillingGateway`. Adapter: yerel disk, platform codec, browser storage, HTTP.

SOLID'i her nesneye interface üretmek gibi uygulama. Tek sorumluluk medya tarifiyle UI durumunu ayırmak; bağımlılık ters çevrimi test edilebilir motor portu kurmak; açık/kapalı prensibi kontrollü encoder adaptörü eklemek içindir. Kullanılmayan soyut fabrika ve gereksiz DI katmanları kurma.

## Karar değişikliği

Her ADR şu kanıtla yeniden açılır: ölçülen cihaz başarısızlığı, belirgin toplam maliyet, lisans engeli veya kullanıcı talebi. “Yeni teknoloji çıktı” tek başına göç gerekçesi değildir. Şablon: [ADR](../templates/ADR_TEMPLATE.md).
