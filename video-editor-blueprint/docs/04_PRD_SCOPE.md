# 04 — Ürün Gereksinimleri ve Kapsam Sözleşmesi

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Fazlar

P0 teknik kanıt; P1 dar Android ve masaüstü web alfa; P2 güvenilirlik/iOS/beta; P3 doğrulanmış ücretli iş akışları ve isteğe bağlı bulut; P4 ayrı AI deneyleri. Fazlar takvim taahhüdü değildir. Kod ajanı sadece kendisine verilen fazı uygular.

## Çekirdek kullanıcı hikâyesi

“Kendi videomdan istediğim anları seçip yeniden sıralayabileyim; istediğim görüntü alanını ve müziğin istediğim kısmını belirleyip kaynak dosyamı bozmadan çıktı alayım.”

## P1 / P2 için zorunlu davranışlar

| ID | Gereksinim | Kabul kriteri |
|---|---|---|
| R01 | Yerel kaynak seçimi | Galeri/dosya seçici; izin reddi anlaşılır; desteklenmeyen dosya editten önce belirlenir. |
| R02 | Başlangıç–bitiş seçimi | Seçilen aralık preview'da doğrulanır; minimum/maximum kuralları tutarlıdır. |
| R03 | Çoklu aralık ve sıralama | En çok 20 klip; kart taşıma veya erişilebilir yukarı/aşağı düğmeleri; çıktı sırası aynıdır. |
| R04 | Kırpma ve silme | Baştan/sondan trim, ortadan split+remove; orijinal değişmez; undo çalışır. |
| R05 | Yeniden çerçeveleme | 9:16, 16:9, 1:1; fill/crop ve fit seçenekleri; crop her klip için saklanır. |
| R06 | Tek harici müzik katmanı | Yerel dosya; sesin başlangıç/bitişi ve timeline başlangıcı seçilebilir. |
| R07 | Ses karışımı | Orijinal klip sesi + müzik; ayrı seviye ve mute; basit fade; preview/export uyumlu. |
| R08 | Tahribatsız proje | Otomatik kayıt, undo/redo, dosya yeniden bağlama; uygulama kapanınca tarif korunur. |
| R09 | Dışa aktarma | Desteklenen matriste MP4/H.264/AAC/SDR 720p veya 1080p/30; cancel ve hata geri dönüşü. |
| R10 | Kaydetme/paylaşma | Gerçek dosya oluşturulur; kullanıcı seçimiyle sisteme kaydet/share sheet. |
| R11 | Açık rota ve sınırlar | Cihaz/bulut etiketi; kota, uyumluluk ve süre sınırlamaları başlamadan görünür. |
| R12 | Hesapsız temel kullanım | Ücretsiz yerel ana iş için giriş veya internet gerekmez; web ilk yükleme/offline desteği ayrıca belirtilir. |

P1'de önce tek kaynak ve iki aralıkla yürüyen dikey dilim tamamlanır. Tablonun bütünü ilk PR değildir. Bir projede başlangıç sınırı beş video kaynağı ve bir harici ses kaynağıdır; sayılar testlerle revize edilebilir.

## Görüntü “kırpma” kavramını ayır

**Süreyi kısalt:** Videonun bir zaman bölümünü al. **Bölümü kaldır:** Ortadaki aralığı çıkar. **Görüntüyü kırp:** Kare içinde görülecek alanı seç. Kullanıcıya üç farklı eylem aynı “kırp” düğmesi altında karışık sunulmaz.

## P3 Pro kapsamı — satış öncesi tamamlanacak

Kaydedilebilir tekrar kullanım profili; proje kopyalama ve açık sürüm anlık görüntüleri; tek projeden en çok 10 yerel çıktının sırayla hazırlanması; test edilen platformda daha uzun yerel proje limiti; açıkça sınırlı bulut hizmeti. Bir ücretli profil kaynak URI'si, kişinin müzik dosyası veya özel medyasını sunucuya taşımaz.

Pro için satın al, geri yükle, iptal durumu, süre sonu, hesap silme ve offline hak önbelleği gereklidir. Henüz hazır olmayan hak paywall'da gizlenir; gelecekte yapılacak diye ücret alınmaz.

## Kapsam dışı

4K/8K, HDR çıktı, 60 fps çıktı, speed ramp, çok katmanlı video, keyframe animasyon, geçiş kataloğu, otomatik yüz takibi, altyazı, stok şarkı kataloğu, URL'den video indirme, canlı yayın, içerik feed'i, ekip ortak çalışması, kalıcı bulut proje senkronizasyonu, otomatik sosyal paylaşım. Bunlardan biri eklenirse ADR, test ve maliyet etkisi gerekir.

## Kalite ve kabul hedefleri — ölçülmemiş

Desteklenen 1080p test setinde temiz ses/görüntü; klip birleşimlerinde beklenmedik siyah kare/sessizlik olmaması; senkron hatasının seçilen testlerde 40 ms altında tutulması; kullanıcı iptalinde kaynakların korunması; kaynak medyanın sessizce yüklenmemesi; ilk görev testinde 8/10 yardımsız tamamlama hedefi.

Gerçek zamanın altında export, her tarayıcı desteği veya bütün HEVC dosyalarını açma gibi sözler benchmark olmadan verilmez. Standart süre, miktar ve bulut limitleri yalnızca [15_PRICING_FREE_PRO](15_PRICING_FREE_PRO.md) içinde tanımlanır.
