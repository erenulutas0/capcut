# Şablon — Yeniden Üretilebilir Hata Raporu

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖRNEK ŞABLON — GERÇEK HATA KAYDI DEĞİL
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Örnek senaryo — gerçek gözlemlenmiş hata değildir

**Kimlik:** SAMPLE-BUG-001. **Başlık:** Müzik başlangıç offset'i klip sırası değişince kayıyor. **Önerilen öncelik:** Veri kaybı yoksa SEV2; kullanıcıya yanlış çıktı üretiyor. **Durum:** NOT_REPRODUCED.

**Ortam:** Gerçek raporda cihaz modeli, OS, browser varsa sürümü, app build/commit, engine version ve export rotası yazılır. Bu taslakta ortam varmış gibi değer verilmedi.

**Fixture:** Hakları temiz 20 saniyelik video ve 30 saniyelik ses; sözleşme örneği kullanılabilir. Gerçek fixture path/hash'i oluşturulduktan sonra eklenir; hayali dosya konumu kanıt değildir.

## Adımlar

1. Videodan [0s,4s) ve [8s,14s) aralıklarını ekle.
2. Müziğin [5s,13s) aralığını çıktı timeline'ında 2s'de başlat.
3. İkinci video klibini başa taşı.
4. Preview oynat ve gerçek dosya dışa aktar.

**Beklenen:** Çıktı 10 saniye; ilk 2 saniye müzik yok; 2. saniyede ses kaynağının 5. saniyesi çalmalı. Video klip sırası değişmesi müziğin global timeline başlangıcını değiştirmez.

**Gözlenen:** Gerçek hata raporunda duyulan/görülen davranış ve ölçülen offset yazılır. Şu an gözlem yok; örnek bug gerçekleşmiş gibi doldurulmaz.

## Güvenli ekler

EDL'nin asset ID'leri ve teknik ayarları; sanitize log/error code; sentetik output; cihaz bilgisi. Özel video, erişim token'ı, gerçek filename veya ödeme receipt'i public issue'ya eklenmez. Destek için kişisel video göndermek zorunlu değildir.

## Tanı hipotezleri

Preview audio seek'i eski timeline'dan hesaplıyor olabilir; recipe compiler müzik offset'ini klip-local zamanla karıştırıyor olabilir; sample rate dönüşümü/PTS hesapları farklı olabilir. Bunlar araştırma olasılıklarıdır, doğrulanmış kök neden değildir.

## Kapanış koşulu

Tekrarlanabilir örnek + değişiklik öncesi fail kanıtı mümkünse + regression test + ilgili preview/render sonuçları. Sadece sesini kısarak hatayı gizlemek veya kullanıcıya offset'i elle düzelt demek kalıcı fix sayılmaz.
