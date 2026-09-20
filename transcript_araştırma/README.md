# Video editörü — Altyazı, transkript ve ürün araştırması eki

**Araştırma tarihi:** 20 Eylül 2026  
**Durum:** ÖNERİ / uygulanmamış araştırma eki  
**Kapsam:** Web-first ürün; sonrasında native mobil.

## Ana karar önerisi

Ürünü “her şeyi yapan küçük video editörü” değil, “video düzenleme öğrenmeden kısa bir videoyu paylaşılabilir hâle getiren araç” olarak konumlandır. İlk güçlü web sürümüne düzeltilebilir altyazıyı al; dublaj, dudak senkronu ve üretken video özelliklerini ertele.

Otomatik transkript, altyazı zamanlama ve altyazı çevirisi uygulanabilir. Sıfırdan konuşma tanıma modeli eğitmek gerekmiyor. Buna karşılık doğru zamanlama, hatayı düzeltme, gerçek video çıktısı, Türkçe kalite ve maliyet kontrolü ayrıca geliştirilmelidir.

Pazar boş değildir. Microsoft Clipchamp, CapCut, VEED, Kapwing, Descript ve Submagic benzer işlerin önemli bölümünü sunmaktadır. Farklılaşma varsayımımız, belirli bir kullanıcı grubunun belirli görevini daha az çaba ve daha az sürprizle tamamlamasıdır; bunu henüz ölçmedik.

## Dosyalar

- [01_MARKET_AND_FEATURES.md](01_MARKET_AND_FEATURES.md): Rakipler, kullanıcı ihtiyacı hipotezleri, özellik öncelikleri ve konumlandırma.
- [02_CAPTIONS_TRANSCRIPTS_SPEC.md](02_CAPTIONS_TRANSCRIPTS_SPEC.md): Altyazı sistemi, transkript, çeviri, zaman eşleme, web entegrasyonu ve riskler.
- [03_COSTS_AND_USAGE_PROPOSAL.md](03_COSTS_AND_USAGE_PROPOSAL.md): Doğrulanan API fiyatları, örnek hesaplar ve Free/Pro önerisi.
- [04_VALIDATION_AND_ASTRA_HANDOFF.md](04_VALIDATION_AND_ASTRA_HANDOFF.md): Deneyler, kabul ölçütleri, web-first faz değişikliği önerisi ve Astra planlama prompt’u.
- [05_SOURCES.md](05_SOURCES.md): Kaynaklar, gözlem sınırları ve yeniden doğrulama notları.

## Eski paketle ilişkisi

Bu ZIP **tam proje paketinin yerine geçmez**. İçeriği proje içinde `research/captions-2026-09-20/` klasörüne koyabilirsin. Eski dosyaları otomatik olarak ezme.

Mevcut `docs/15_PRICING_FREE_PRO.md`, başlangıç aboneliğinde AI olmadığını belirtiyor. Buradaki 120 dakika ASR / 30 dil-dakika çeviri, bu politikanın **onaylanmamış revizyon önerisidir**. Mevcut 30 dakikalık bulut render hakkına ek veya onun yerine otomatik uygulanmaz. Mevcut web boyut/süre sınırları değişmemiştir.

W0 ve W1 değiştirilmez: önce çalışan arayüz ve gerçek web video çıktısı. Ücretli servis, production deploy, gerçek kullanıcı medyasını buluta gönderme veya ödeme alma yetkisi bu belgeden çıkmaz.

## Kanıt sınırı

Resmî ürün sayfaları ve teknik dokümanlar incelendi. Rakipler aynı görevle canlı test edilmedi; gerçek kullanıcı görüşmesi, ASR kıyaslaması, üretim maliyeti veya gelir doğrulaması yapılmadı. API fiyatları ürün kârlılığının tamamını göstermez. Hesapların aritmetiği ve ekin yerel bağlantıları kontrol edildi; çalışan altyazı motoru teslim edilmiyor.
