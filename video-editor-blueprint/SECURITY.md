# Güvenlik Politikası ve Bildirim Süreci

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: YAYIN ÖNCESİ POLİTİKA TASLAĞI
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

Bu belge yayın öncesi güvenlik süreci tasarımıdır. Henüz doğrulanmış bir güvenlik e-posta adresi, şirket kimliği veya ödül programı yoktur. Gerçek ürün domain'i ve alıcı mailbox doğrulanmadan bu belge kamuya dönük iletişim politikası olarak yayımlanmaz.

## Bildirilecek kapsam

Başka kullanıcı medyasına erişim, receipt/entitlement ele geçirme, cloud kota atlatma, dosya parser'ında kod çalıştırma, imzalı URL sızıntısı, hesabın yetkisiz silinmesi ve üretim secret sızıntısı kritik kapsamdadır.

Özel bildirim formu canlı olmadan hassas açıkları public issue'ya koymayın. Gerçek kullanıcı dosyalarını paylaşmak yerine mümkünse sentetik küçük bir PoC ve etkilenen sürümü verin. Test için veri çalmak, hesapları taramak veya servisi düşürmek yetkili değildir.

## İç müdahale hedefleri — henüz taahhüt edilmiş SLA değil

Aktif sızıntı veya key compromise: ilk incelemede ilgili endpoint/anahtar kapatılır, etki çevresi belirlenir, kanıt korunur. Kritik rapor için aynı iş günü inceleme hedefi; diğer raporlar için iki iş günü ilk dönüş hedefi önerilir. Tek geliştiricinin 7/24 destek sözü vermesi yerine gerçek kapasiteye uygun süreç kurulur.

Anahtar rotasyonu, olay kaydı, bildirim değerlendirmesi ve geri dönüş planı [operasyon belgesinde](docs/24_OBSERVABILITY_OPERATIONS.md); ayrıntılı tehditler [tehdit modelinde](docs/18_SECURITY_THREAT_MODEL.md) bulunur.
