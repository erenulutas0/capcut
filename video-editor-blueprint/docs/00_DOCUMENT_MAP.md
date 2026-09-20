# 00 — Doküman Haritası ve Okuma Sırası

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Kısa okuma yolları

**Kurucu kararı:** kökteki Kurucu Özeti → 01 Vizyon → 03 Doğrulama → 04 PRD → 15 Fiyat/Kota → 17 Birim ekonomi → 25 GTM.

**İlk kodlama:** AGENTS → 07 Mimari → 08 Bağımlılık → 09 Medya → 10 Sözleşme → 12 Mobil → 22 Test → 33 İlk Prompt.

**Web geliştirme:** 09/10 sözleşmeleri → 11 Web → 18 Güvenlik → 22 QA.

**Ücretli yayın:** 13 Backend → 14 Cloud → 15/16 Fiyat/Billing → 17 Ekonomi → 18/19/20 Güvenlik/Gizlilik/Müzik → 34 Lansman.

**Kullanıcı bulma:** 03 Görüşme → 25 GTM → 26 İçerik → 27 Landing/ASO → 28 Retention → 21 Analitik.

## Kapsam ve kullanım

Belgeler yazılımın ilerlemesiyle güncellenecek başlangıç spesifikasyonlarıdır. Fiyat/kota için 15, EDL için 10, faz sırası için 29 tek gerçek kaynak olmalıdır. Anahtar sağlayıcılar adaydır; ücreti ve cihaz performansı kanıtlanmadan onaylı sayılmaz.

## Kök belgeler

- [README.md](../README.md)
- [KURUCU_OZETI.md](../KURUCU_OZETI.md)
- [AGENTS.md](../AGENTS.md)
- [CLAUDE.md](../CLAUDE.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [SECURITY.md](../SECURITY.md)
- [CHANGELOG.md](../CHANGELOG.md)
- [PAKET_KONTROL_RAPORU.md](../PAKET_KONTROL_RAPORU.md)

## Numaralı proje belgeleri

| Belge | İlk ilgili aşama | Kullanım |
|---|---|---|
| [01_VISION_POSITIONING.md](01_VISION_POSITIONING.md) | Karar | Tek cümlelik konum, ürün ilkeleri ve kapsam dışı kimlik. |
| [02_MARKET_COMPETITIVE_RESEARCH.md](02_MARKET_COMPETITIVE_RESEARCH.md) | Araştırma | Resmî rakip gözlemleri, doğrulanmayanlar ve görev bazlı karşılaştırma. |
| [03_AUDIENCE_VALIDATION.md](03_AUDIENCE_VALIDATION.md) | P0 | Hedef segment, görüşme/gözlem ve tekrar kullanım deneyi. |
| [04_PRD_SCOPE.md](04_PRD_SCOPE.md) | P0–P3 | Somut gereksinimler ve faz kapsamı. |
| [05_USER_FLOWS_UX.md](05_USER_FLOWS_UX.md) | P1 | Ekranlar, mutlu/olumsuz akışlar ve kullanıcı metinleri. |
| [06_DESIGN_ACCESSIBILITY.md](06_DESIGN_ACCESSIBILITY.md) | P1/P2 | UI sistemi, erişilebilirlik ve yerelleştirme. |
| [07_ARCHITECTURE_ADR.md](07_ARCHITECTURE_ADR.md) | P0 | Motor sınırları, domain ve başlangıç ADR önerileri. |
| [08_TECH_STACK_DEPENDENCIES.md](08_TECH_STACK_DEPENDENCIES.md) | P0 | Teknoloji adayları, exact-version ve lisans disiplini. |
| [09_MEDIA_PIPELINE.md](09_MEDIA_PIPELINE.md) | P0 | PTS, crop, audio, decode/encode ve dosya güvenliği. |
| [10_PROJECT_SCHEMA_CONTRACTS.md](10_PROJECT_SCHEMA_CONTRACTS.md) | P0 | Parse edilebilir EDL örneği ve ortak port/invariant sözleşmesi. |
| [11_WEB_EDITOR.md](11_WEB_EDITOR.md) | P0/P1 | Web codec testi, Worker, storage ve açık fallback. |
| [12_MOBILE_NATIVE.md](12_MOBILE_NATIVE.md) | P0/P2 | Flutter/Kotlin/Swift uygulama ve cihaz izinleri. |
| [13_BACKEND_DATA_API.md](13_BACKEND_DATA_API.md) | P3 | Kanonik hesap, veri tabloları, API ve transaction. |
| [14_CLOUD_JOBS_STORAGE.md](14_CLOUD_JOBS_STORAGE.md) | P3 | Job yaşam döngüsü, timeout, saklama ve cloud kontrolü. |
| [15_PRICING_FREE_PRO.md](15_PRICING_FREE_PRO.md) | Karar/P3 | Tek fiyat/kota kaynağı; Free/Pro ve platform sınırları. |
| [16_BILLING_ENTITLEMENTS.md](16_BILLING_ENTITLEMENTS.md) | P3 | Satın alma, restore, grace, webhook, aylık grant ve ledger. |
| [17_UNIT_ECONOMICS.md](17_UNIT_ECONOMICS.md) | Karar/P3 | Ölçülmemiş maliyet senaryoları ve doğrulanacak marj. |
| [18_SECURITY_THREAT_MODEL.md](18_SECURITY_THREAT_MODEL.md) | P0/P3 | Tehditler, owner checks, parser izolasyonu ve yayın engelleri. |
| [19_PRIVACY_COMPLIANCE.md](19_PRIVACY_COMPLIANCE.md) | P2/P3 | Veri envanteri, silme, tedarikçi/aktarım ve hukuki kapı. |
| [20_MUSIC_LICENSING.md](20_MUSIC_LICENSING.md) | P1/P3 | Kendi ses dosyası, demo/katalog lisansı ve hak operasyonu. |
| [21_ANALYTICS_METRICS.md](21_ANALYTICS_METRICS.md) | P2 | Olay şeması, aktivasyon, tekrar ve gelir ölçümü. |
| [22_QA_TEST_MATRIX.md](22_QA_TEST_MATRIX.md) | P0+ | Golden fixtures, gerçek cihaz, ödeme yarışı ve kabul hedefleri. |
| [23_CICD_RELEASE.md](23_CICD_RELEASE.md) | P0+ | Depo, ortam, CI, signing ve kademeli yayın. |
| [24_OBSERVABILITY_OPERATIONS.md](24_OBSERVABILITY_OPERATIONS.md) | P2/P3 | Alarmlar, runbook, silme ve restore tatbikatı. |
| [25_MARKETING_GTM.md](25_MARKETING_GTM.md) | P0+ | İlk kullanıcılar, kanallar, deney bütçesi ve durdurma kuralları. |
| [26_CONTENT_SOCIAL_PLAN.md](26_CONTENT_SOCIAL_PLAN.md) | P2+ | Dört haftalık içerik deneyi ve hazır sosyal demo metinleri. |
| [27_SEO_ASO_LANDING.md](27_SEO_ASO_LANDING.md) | P2+ | Landing/FAQ/ASO taslakları ve gerçek araç sayfası SEO yaklaşımı. |
| [28_RETENTION_SUPPORT.md](28_RETENTION_SUPPORT.md) | P2/P3 | Tekrar kullanım, destek formları ve yanıt örnekleri. |
| [29_ROADMAP_BACKLOG.md](29_ROADMAP_BACKLOG.md) | P0+ | Bağımlılıklı backlog ve faz çıkış kapıları. |
| [30_RISKS_DECISIONS.md](30_RISKS_DECISIONS.md) | Karar | Riskler, açık kurucu kararları ve varsayım sicili. |
| [31_AI_FEATURES.md](31_AI_FEATURES.md) | P4 | AI deneylerinin veri, kalite, kontrol ve maliyet sınırları. |
| [32_AI_CODING_WORKFLOW.md](32_AI_CODING_WORKFLOW.md) | P0+ | Kod ajanı görev/review döngüsü ve kullanım prompts. |
| [33_FIRST_PROMPT.md](33_FIRST_PROMPT.md) | İlk görev | Sınırlı, uygulanabilir ilk kodlama promptu. |
| [34_LAUNCH_CHECKLIST.md](34_LAUNCH_CHECKLIST.md) | Her yayın | Alfa/Free/Pro/cloud için kanıtla işaretlenecek kontrol listesi. |
| [35_SOURCES.md](35_SOURCES.md) | Araştırma | 42 resmî/birincil ve yardımcı kaynak, sınırları ve tarihlemesi. |

## İş şablonları

Şablonlar boş başlık dosyaları değildir; proje için doldurulmuş, henüz uygulanmamış örnekler içerir. Gerçek sonuçlar üretildiğinde örnek durum bilgisi ve kanıt alanları güncellenir.

- [ADR_TEMPLATE.md](../templates/ADR_TEMPLATE.md)
- [BUG_REPORT_TEMPLATE.md](../templates/BUG_REPORT_TEMPLATE.md)
- [EXPERIMENT_TEMPLATE.md](../templates/EXPERIMENT_TEMPLATE.md)
- [FEATURE_SPEC_TEMPLATE.md](../templates/FEATURE_SPEC_TEMPLATE.md)
- [LEGAL_COPY_DRAFT.md](../templates/LEGAL_COPY_DRAFT.md)
- [PR_TEMPLATE.md](../templates/PR_TEMPLATE.md)
- [RESEARCH_INTERVIEW.md](../templates/RESEARCH_INTERVIEW.md)

## Açık doğrulama sınırı

Bu paketin otomatik kontrolü belge bağlantıları/JSON örnekleri/matematik ve dosya bütünlüğü içindir. Ürünün kodu, cihazı, veri güvenliği, lisansı veya gelir modeli test edilmiş sayılmaz.
