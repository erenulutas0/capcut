# 28 — Tekrar Kullanım, Müşteri Desteği ve İletişim

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Retention tezi

Ürün insanları bildirimle geri çağırdığı için değil, benzer bir video işi tekrar oluştuğunda kolay çözüm olduğu için kullanılmalı. İlk başarıyı hızlandır, son projeyi bulunabilir tut, gerçek tekrar işinde profil/kopya değerini göster. Rastgele daily streak veya uygulama açma ödülü video işinin yerine geçmez.

## Tekrar kullanım özellikleri

Yerel son projeler, düzgün isimlendirme, otomatik kurtarma, açık kaynak re-link, hazır temel oranlar, P3'te kullanıcı profili ve batch. Kayıtlı profil crop/çıktı/gain gibi ayarları saklar; önceki videonun özel dosyası yeni cihazda varmış gibi davranmaz.

İlk tamamlanan video sonrası “Bir sonraki videoda aynı ayarları kullan” bağlamı Pro hazırsa gösterilebilir. Fakat ilk çıktıyı indirebilmek için abonelik mesajını kapatma zorunluluğu veya e-posta kaydı yoktur.

## İletişim ayrımı

Hizmet mesajları: satın alma durumu, hesap güvenliği, cloud çıktısının hazır olması/expiry. Pazarlama mesajları: yeni özellik, kullanım önerisi, kampanya. Kullanıcının uygun tercihi olmadan pazarlama maili gönderilmez. Local guest kullanıcıdan sırf retention için e-posta istenmez.

Örnek izinli beta e-postası:

> Konu: İlk videonu hazırlarken nerede takıldın?
>
> Betayı denediğin için teşekkürler. Şu anda özellikle istediğin bölümleri seçme ve çıktı alma adımlarını iyileştiriyoruz. Bir yerde kaldıysan hata kodunu ve kullandığın cihazı yazman yeterli. Videonu göndermek zorunda değilsin. Bu beta haberlerini almak istemezsen abonelikten çıkabilirsin.

Bu bir şablondur; gönderilmiş e-posta veya otomasyon değildir.

## Destek formu

Gerekli: app/build, OS/browser, sorun türü, correlation/attempt ID varsa, kısa açıklama. İsteğe bağlı: yeniden üretme adımları, kişisel bilgi içermeyen ekran görüntüsü. Video/şarkı dosyası zorunlu değil. Otomatik log paketi sanitize edilir ve kullanıcı gönderilen alanları görür.

Yanıt önceliği: veri/hesap güvenliği → yanlış ücret/hak → çalışma kaybı → export → kullanım sorusu. Önerilen beta ilk yanıt hedefi iki iş günü; gerçek personel kapasitesi olmadan 7/24 canlı destek satılmaz. Kritik olaylar ayrı iç escalation'dır.

## Hazır destek cevapları

**Export yarıda kaldı:** “Bu denemede çıktı tamamlanmamış görünüyor. Proje tarifin korunmuş olmalı; önce projeyi yeniden açıp kaynakların erişilebilir olduğunu kontrol edelim. Hata kodu ve cihaz modelin yeterli, videonu göndermene gerek yok. Bulut işi başarısızsa ayrılan hakkın serbest bırakılmasını da kontrol edeceğiz.”

“Korunmuş olmalı” ancak durumu tam göremediğimizde kullanılır; kesin veri kurtarma iddiası değil. Sistemde kayıt görünüyorsa gerçek bilgiyle yanıt güncellenir.

**Pro görünmüyor:** “Aynı uygulama hesabında olduğunu kontrol edip Satın alımları geri yükle seçeneğini kullan. Yeniden ödeme yapma. Satın aldığın mağaza ve işlem zamanı ile doğrulamayı inceleyebiliriz; kart numaranı göndermene gerek yok.”

**Müzik paylaşımda susturuldu:** “Uygulamada ses dosyası eklemek, paylaşacağın platformda kullanım hakkı sağlamaz. Elindeki lisansın ilgili kullanımı kapsayıp kapsamadığını kontrol et. Dosyanı telifsiz hâle getirdiğimizi söyleyemeyiz.”

## İptal ve kayıp kullanıcı araştırması

İptal basit ve engellenmez. Sebep sorusu isteğe bağlı: az kullanıyorum, ihtiyaç karşılanmıyor, fiyat, teknik hata, başka araç. Kullanıcı vazgeçince projeleri silme; önceki ödenmiş dönemi politika gereği koru. “Son şans” sahte sayaçlar yok.

Teknik hata yüzünden ayrılanlara sorun gerçekten düzelince ve iletişim izni varsa tek bir dürüst güncelleme yapılabilir. Otomatik yoğun geri kazanım mesajı uygulanmaz. Retention sonucu yalnızca henüz silinmemiş hesap sayısı değildir.

## Haftalık destekten ürüne döngü

En sık üç tıkanma, etkilenen platform/codec, çözüm süresi ve tekrar eden kullanıcı sayısı çıkarılır. Kritik iş çözülmeden aynı soruya yardım makalesi eklemek yeterli sayılmaz. Feature talebi ilk segment ve PRD ile değerlendirilir; her isteyen için ayrı kapsam açılmaz.
