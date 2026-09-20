# Katkı ve Değişiklik Süreci

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Küçük, kanıtlanabilir değişiklikler

Her iş bir backlog kimliğine bağlanır. Bir PR tercihen tek kullanıcı davranışını veya tek risk azaltımını kapsar. İlk ürün küçük olduğu için ağır süreç değil; regresyonu görünür kılan disiplin hedeflenir.

Dal örnekleri: `feat/P1-04-keep-segments`, `fix/MEDIA-012-audio-offset`, `docs/ADR-006-export-route`. Ana dal korumalıdır; kaynak medyalar ve gizli anahtarlar repoya alınmaz. Bu isimler komut çalıştırma talimatı değildir.

## Tamamlanma tanımı

Kodun biçim/lint/type kontrolü; ilgili unit ve contract testleri; olumsuz senaryo; kullanıcı verisinin korunması; erişilebilir durum mesajları; güvenlik/analitik etkisi; güncellenmiş belge ve changelog bulunmalı. Render değişikliğinde en az ilgili golden fixture ve gerçek cihaz regresyonu ayrıca gerekir.

Sadece snapshot/görsel ekran testi export doğruluğunu kanıtlamaz. Sadece yüksek coverage yüzdesi de doğru ses/video üretildiğini kanıtlamaz.

## Bağımlılık ekleme

Amaç, alternatif, resmi repo, bakım durumu, tam sürüm, lisans, binary/codec etkisi, minimum OS, paket büyüklüğü ve kaldırma stratejisi PR'a yazılır. Kritik medya veya billing dependency'si küçük otomatik güncelleme diye doğrudan birleştirilmez.

## Review soruları

Kullanıcı aynı işlemi iki kez tetiklerse ne olur? Uygulama kapanırsa ne kalır? Network yoksa ücretsiz iş akışı sürer mi? Yanlış kullanıcı başka hesabın kaynağına ulaşabilir mi? Dosya bir codec hatası çıkarırsa uygulama kaynak dosyayı korur mu? İlgili kota/fiyat/platform farklılığı açık mı?

Doldurulmuş örnek için [PR şablonu](templates/PR_TEMPLATE.md), yeni teknik karar için [ADR şablonu](templates/ADR_TEMPLATE.md).
