# Değişiklik Kaydı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Politika 2026-09-23.v4 — 23 Eylül 2026

**Değişen:** Web yerel girdi limiti (toplam video kaynak süresi) 60 dakika → 120 dakika (doc 15, doc 11). Girdi sınırına sığan video artık çıktı sınırından uzun olsa da zaman çizgisine tek parça olarak gelir; çıktı sınırı (60 dakika; diske yazamayan tarayıcıda 5 dakika) tarifin kuralı olmaktan çıktı ve indirmenin kapısı oldu: sonuç sınırdan uzunsa "Videoyu indir" kodlamadan önce sonucun uzunluğunu ve en az ne kadar silinmesi gerektiğini söyler, zaman çizgisi sınırı çizgiyle ve fazlasını taralı gösterir (ADR-021). "İlk 60 dakikayı ekle" seçimi kaldırıldı. Çıktı limiti, 2 GiB toplam boyut, 5 video kaynağı, 20 parça, 1 müzik, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-021 ölçümleri.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen her video ve geçerli her proje/yedek geçerli kalır; tarif doğrulamasındaki süre kuralı artık çıktı sınırını değil girdi sınırını (120 dakika) uygular (`timeline_duration_exceeds_policy`), çıktı sınırı render planında (`output_duration_exceeds_policy`) kaldı.

## Politika 2026-09-22.v3 — 22 Eylül 2026

**Değişen:** Web yerel çıktı limiti 5 dakika → 60 dakika, yalnızca çıktının tarayıcının özel diskine (OPFS) akıtılabildiği yolda. Diske yazamayan tarayıcıda (bellek yolu) çıktı 5 dakikada kaldı ve daha uzun çıktı kodlamadan önce açık bir mesajla reddedilir; depolama tahmini dosyaya yetmiyorsa da uzun çıktı baştan reddedilir (doc 15, doc 11). Girdi limiti (60 dakika / 2 GiB), 20 parça sınırı, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-013 ve ADR-020 bellek ölçümleri.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden indirilebilen hiçbir çıktı reddedilmez; bellek yolundaki tarayıcılar için sınır aynı kaldı.

## Politika 2026-09-21.v2 — 21 Eylül 2026

**Değişen:** Web yerel girdi limiti 20 dakika / 250 MiB → 60 dakika / 2 GiB (doc 15, doc 11). Çıktı limiti 5 dakika, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-013 bellek ölçümü.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen hiçbir proje kapanmaz.

## 0.1 — 19 Eylül 2026

Araştırmaya dayalı ürün, mimari, medya sözleşmesi, ücretsiz/Pro politika önerisi, ödeme ve kota tasarımı, pazarlama deneyleri, test matrisi, yayın kapıları ve ilk kodlama görevi oluşturuldu.

Bu sürüm yalnızca dokümantasyondur. Uygulama sürümü, test sonucu veya canlı hizmet duyurusu değildir.

Sonraki değişiklikler `Eklenen`, `Değişen`, `Düzeltilen`, `Güvenlik`, `Kırıcı değişiklik` başlıklarıyla kaydedilir. Fiyat/kota değişiklikleri mevcut kullanıcı haklarına etkisiyle birlikte yazılır.
