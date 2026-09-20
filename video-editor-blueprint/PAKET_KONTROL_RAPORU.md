# Paket Kontrol Raporu

> Kontrol tarihi: 19 Eylül 2026 · Paket sürümü: 0.1
> Bu rapor **belge paketine** aittir; uygulama testi, hukuki onay veya güvenlik sertifikası değildir.

## Oluşturulan içerik

- **51 Markdown dosyası**: 8 kök belge (bu rapor dahil), 36 numaralı proje belgesi ve 7 iş şablonu.
- Türkçe ürün/teknik/pazarlama belgeleri; kod ajanı için İngilizce görev blokları ve parse edilebilir JSON örnekleri.
- **42 kaynak kaydı**; her birinde kaynak türü, hangi bilgiyi desteklediği ve sınırı.

## Otomatik kontroller

| Kontrol | Sonuç |
|---|---|
| UTF-8 dosyalar ve ana başlıklar | Geçti |
| Kod bloklarının açılış/kapanışı | Geçti |
| Paket içi bağlantılar | 164 bağlantı kontrol edildi; eksik hedef yok |
| Kaynak anchor'ları | 60 yerel kaynak atfı; bulunamayan anchor yok |
| Kaynak kimlikleri | S01–S42 tekil ve mevcut |
| Numaralı belge dizisi | 00–35 arasında eksik/çift numara yok |
| JSON örnekleri | 3 blok standart JSON parser ile açıldı |
| EDL örneği | Asset/range/crop/fade kontrolleri; beklenen 10.000.000 µs sonuç doğrulandı |
| Ekonomi tablosu | 8 baz kullanım/maliyet satırı ve 4 ek ücret stresi sonucu Python ile yeniden hesaplandı |
| Canonical policy | Fiyat, 180/1.800 saniye ve platform boyut değerlerinin varlığı kontrol edildi |

## İçerik tutarlılığı incelemesi

Cloud ile local export ayrımı; Free 5 dakika/Pro mobil 30 dakika; webde her iki plan için başlangıç 5 dakika ve 250 MiB; Pro aylık 30 dakika cloud; Free tek seferlik 3 dakika cloud; tek job sınırları; yıllık kotanın ay ay tahsisi; yalnızca yerel batch; source korunması; AAC/capability kapısı; offline entitlement sınırı; README/ilk prompt kapsamı gözden geçirildi.

Bu kontrol formal verification değildir. Gerçek ürün oluşurken sözleşmeler kod ve test fixture'larına taşınmalıdır. Belge içindeki şirket/domain, ödeme kabulü ve cihaz erişimi gibi bilinmeyenler bilinçli olarak tamamlanmış gösterilmedi.

## Yapılmayan kontroller

Uygulama kodu derlenmedi; Android/iOS cihazda render çalıştırılmadı; web codec/memory benchmark'ı yapılmadı; ödeme sandbox veya webhook sunucusu kurulmadı; gerçek cloud dosya silme testi yapılmadı; kullanıcı görüşmesi/reklam deneyi yapılmadı; lisans ve hukuki onay alınmadı. Şablonlardaki örnekler gerçek bug, PR veya araştırma sonucu değildir.

Harici kaynakların her birinde gerçek URL bulunur, ancak paket denetimi bütün bağlantıların gelecekte de erişilebilir kalacağını garanti etmez. Araştırma tarihindeki sınırlamalar kaynak sicilinde yazılıdır.

## Sonraki gerçek doğrulama

`AGENTS.md` ve `docs/33_FIRST_PROMPT.md` ile P0 görevini çalıştır; test edilemeyen ortamları açıkça raporla. Fiyat/kota, cihaz performansı ve pazarlama hedefleri başlangıç önerisidir, ölçülmüş sonuç değildir.
