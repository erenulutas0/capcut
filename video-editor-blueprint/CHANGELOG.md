# Değişiklik Kaydı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## HDR kaynaklar SDR'ye çevriliyor — 23 Eylül 2026 (ADR-022)

**Eklenen:** HDR (PQ / HLG, bt2020) videolar artık reddedilmek yerine SDR H.264 olarak dışa aktarılır — ama yalnızca, dışa aktarmadan hemen önce worker'da sentetik bir 10-bit HDR karesiyle yapılan kontrol **bu tarayıcıda** geçerse. Dönüşüm tarayıcının kendi HDR→SDR dönüşümüdür; parlak doygun renklerin kesilmesi (ölçüldü: PQ ColorChecker karesinin %16'sı) float16 tuval ve tonu koruyan bir yumuşak kırpmayla giderilir. Dialog'da yeni satır ("HDR → SDR dönüşümü bu tarayıcıda doğru") ve not: "Bu video HDR. İndirilen dosya SDR olacak; renkler telefondaki görüntüden biraz farklı görünebilir." Ölçüm: `docs/spikes/2026-09-23-hdr-tonemap.md`; eşikler tarayıcı çıktısı ölçülmeden sabitlendi.

**Değişen:** HDR ret mesajı sebebi söylüyor (bu tarayıcı HDR'yi SDR'ye doğru çeviremedi, deneme karesiyle test edildi). Matris satırı M10-hdr artık gerçek 10-bit içerik (VP9 profil 2, PQ) kullanıyor ve reddi değil doğru renkli çıktıyı (ya da HDR gerekçeli açık reddi) kontrol ediyor; yeni M10-hdr-hlg satırı (HLG, 90° döndürmeli). Eski 8-bit "PQ etiketli" H.264 fixture'ı kaldırıldı.

Sınır: HEVC çözücüsü olmayan tarayıcıda (bu makinede Edge ve Playwright Chromium) telefonun HEVC HDR kaydı yine içe aktarmada, codec yüzünden reddedilir. Fiyat, kota ve politika sınırları değişmedi.

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
