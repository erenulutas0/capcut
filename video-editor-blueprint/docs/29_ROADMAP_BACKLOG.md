# 29 — Yol Haritası, Backlog ve Faz Kapıları

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Yönetim ilkesi

Fazlar süre tahmini veya yayın sözü değil, doğrulama sırasıdır. Tek geliştirici için paralel beş büyük özellik yerine bir gerçek kullanıcı işi bitirilir. Her hikâye test kanıtı ve sınırıyla kapanır. Aşağıdaki durumların hepsi başlangıçta **PLANNED**; bu dokümantasyon teslimi bunları DONE yapmaz.

## P0 — Teknik kanıt

| ID | İş | Ön koşul | Bitti sayılması için |
|---|---|---|---|
| P0-01 | Repo/ortam envanteri + EDL sözleşmesi | Yok | Shared valid/invalid fixture, süre hesabı; gerçek test raporu |
| P0-02 | Android tek kaynak iki aralık + ses export | P0-01 | Gerçek MP4; süre/sıra/ses/crop kanıtı; kaynak korunmuş |
| P0-03 | Web capability harness + küçük local export | P0-01 | H.264/AAC config testi, gerçek video/ses çıktı, unsupported yolu |
| P0-04 | iOS medya spike | P0-01 + macOS/iPhone erişimi | Composition+ses+rotation çıktısı; fiziksel test kaydı |
| P0-05 | Benchmark ve stack kararı | P0-02/03; iOS için P0-04 | Exact versions, cihaz/codec sınırları, lisans kaydı, ADR |

P0 çıkışında üç platformun hepsi geçmediyse başarısız platform genel destek vaadine alınmaz. Android dar alfa ve web teknik alfa, iOS kanıtı beklerken geliştirilebilir; “üçü de hazır” iddiası yapılamaz.

## P1 — İlk uçtan uca ürün

| ID | İş | Ön koşul | Bitti sayılması için |
|---|---|---|---|
| P1-01 | Kaynak seç/probe ve hata UX | İlgili motor spike | Dosya desteklenmezse erken açıklama |
| P1-02 | START/END ve klip kartları | P1-01 | Çoklu aralık ve doğru sıralı preview |
| P1-03 | Trim/split/remove/reorder | P1-02 | Undo ile geri alınan tahribatsız işlemler |
| P1-04 | Crop/oran/fit | P1-02 | Preview/export aynı semantik |
| P1-05 | Müzik segmenti/gain/fade | P1-02 | Offset ve senkron testleri |
| P1-06 | Otomatik kayıt/re-link | P1-01/02 | Kaynak izni kaybolunca EDL ve kurtarma |
| P1-07 | Export/preflight/cancel/save | İlgili özellikler | Gerçek çıktı ve kontrollü hata; source değişmez |
| P1-08 | Hesapsız akış + Türkçe/İngilizce anahtarlar | P1-07 | Yerel Free için auth/ağ gereksiz |

Dar alfa kapısı: kritik fixture'lar geçer, başka kullanıcı verisi riski yok, seçili cihazlarda en az 10 gerçek görev gözlemi için yeterince sağlam akış. Ödeme ve cloud bu fazda kapalıdır.

## P2 — Beta ve güvenilirlik

P2-01: iOS tam akış ve OS dosya izinleri. P2-02: cihaz/browser matrisini genişlet, bellek/termal/disk testleri. P2-03: erişilebilirlik ve gerçek kullanıcı tıkanmalarını düzelt. P2-04: privacy/support/domain kimliği ve yayın metadata'sı. P2-05: seçilen analytics ve consent; ilk cohort raporu. P2-06: kademeli mağaza beta/production hazırlığı.

Çıkış: tamamlanan gerçek işler ve tekrar ihtiyaç kanıtı; kritik fail açık değil; destek matrisi ve bilinen limitler yayınlanabilir. Ücretli özellik kullanıcıya gösterilmediyse bu faz “gelir modeli doğrulandı” demek değildir.

## P3 — Pro ve kontrollü hizmet

| ID | İş | Bağımlılık / kapı |
|---|---|---|
| P3-01 | Canonical account ve provider kabulü | Veri/ödeme sağlayıcıları onaylı |
| P3-02 | Profiller, kopya/snapshot, sıralı batch | Gerçek tekrar işine değer kanıtı |
| P3-03 | Uzun mobil yerel projeler | Limit/cihaz benchmark geçişi |
| P3-04 | Billing/restore/expiry/offline cache | Sandbox ve server testleri |
| P3-05 | Ledger/quote/reserve/commit | Yarış ve duplicate testleri |
| P3-06 | Cloud pipeline ve geçici saklama | İzolasyon, gerçek maliyet, silme testi |
| P3-07 | Paywall/plan görünümü ve fiyat testi | Satılan her özellik çalışır |
| P3-08 | Ücretli kontrollü lansman | Hukuk, support, provider ve marj kapıları |

Cloud hazır değilse cloud hakkı içeren Pro teklifi satılmaz. Sadece yerel Pro ile başlamaya karar verilirse teklif, fiyat ve belgeler yeni ADR/politika sürümüyle değiştirilir; sessizce 30 dakikalık cloud vaadi bırakılmaz.

## P4 — Yapay zekâ ve genişleme

Önce sessizlik önerisi veya konuşma metninden kesim gibi tek iş; ayrı maliyet ve veri işleme değerlendirmesi. 4K/HDR/60fps, ekip işleri ve kalıcı senkron başka backlog alanlarıdır. Müşteri kanıtı olmadan aynı anda hepsi açılmaz.

## Önceliklendirme

P0/P1 medya doğruluğu ve veri koruma > işi engelleyen UX > destek matrisi > gerçek tekrar kolaylığı > para kazanma > dekoratif efekt. Kullanıcı güvenliği/telif/satın alma hatası büyüme deneyinden önce çözülür.

Yeni öneri [feature şablonunda](../templates/FEATURE_SPEC_TEMPLATE.md) iş, kanıt, kapsam, maliyet ve test olarak yazılır. “Rakipte var” tek başına öncelik gerekçesi değildir. Puanlama kullanılacaksa örneklem belirsizliği ayrıca not edilir; sahte hassasiyetli skorla karar gizlenmez.
