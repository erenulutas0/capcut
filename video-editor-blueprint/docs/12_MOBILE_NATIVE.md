# 12 — Flutter, Android ve iOS Uygulama Planı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Platform hedefleri

Ürün başlangıç önerisi Android 10/API 29+ ve iOS 17+. Bunlar kütüphanelerin minimum gereksinimini ifade etmez; test yükünü azaltmak için seçilmiş ürün varsayımlarıdır. Gerçek cihaz dağılımı ve kabul edilen maliyetle revize edilir. Mağaza target SDK/Xcode gereklilikleri release gününde yeniden kontrol edilir; bugünden tahminî sürüm yazılmaz.

## Flutter modülleri

`features/import`, `features/editor`, `features/export`, `features/projects`, P3'te `features/account`, `features/billing`. Paylaşılan `domain`, `application`, `platform_ports`, `design_system`. State yönetimi için ekipçe seçilen tek yaklaşım; domain framework'e bağlanmaz. Aynı görev için birden fazla state framework kurma.

Native köprü typed mesajlaşma ile tasarlanır. Komutlar: `probeAsset`, `openPreview`, `updatePreviewRecipe`, `seek`, `startExport`, `cancelExport`, `releaseSession`. Event'ler attempt/session/revision ID taşır; progress throttled gelir. Platform köprülerinin temel yaklaşımı resmî Flutter dokümantasyonuna dayanır. [S05](35_SOURCES.md#s05)

## Android adaptörü

Media3 Transformer birincil aday. Import için sistem picker/SAF kullan; broad storage erişimi varsayılan çözüm değildir. Persistable izin mümkün değilse app-private copy ve kullanıcıya alan bilgisi. Content URI'yi rastgele filesystem path'e çevirme; provider stream/file descriptor kullanımı test edilir.

Orientation, kaynak in/out, composition ve audio mixing gerçek fixture ile denenir. Native executor, codec kaynağı ve cancel yaşam döngüsünü sahiplenir. Flutter UI isolate'ı encode işi yapmaz. Çıktı galeriye MediaStore gibi uygun sistem mekanizmasıyla, yalnızca kullanıcı eylemi sonrası kaydedilir.

Uzun işlem için foreground service gerekirse o OS sürümünün servis türü, izin ve süre sınırlarıyla tasarlanır. Android'in arka plan media processing süre kısıtları vardır; “arka planda süresiz çalışır” varsayılmaz. [S14](35_SOURCES.md#s14)

## iOS adaptörü

AVFoundation composition/export ve audio mix üzerinden çözüm adayı. Photos/file picker erişimi, security-scoped kaynak veya app-private copy açık sahiplikle yönetilir. Preview ve export orientation/crop hesabı aynı recipe compiler'dan gelir. Photos'a yazma izni editörün başlangıcında gereksiz istenmez.

Uygulama aktifken export ilk garantili akıştır. App pasifleşmesi, telefon kilidi, belleğe baskı, telefon görüşmesi/ses oturumu ve izin değişikliği test edilir. iOS 26'nın kullanıcı başlattığı uzun işler için BGContinuedProcessingTask seçeneği vardır; bu ileri iyileştirme bütün desteklenen eski sürümlerde çalışan sınırsız arka plan garantisi değildir. [S15](35_SOURCES.md#s15)

Mac/Xcode derleme, signing, provisioning ve fiziksel iPhone testi planın zorunlu parçasıdır. Windows üzerinde Dart kodunun derlenmesi iOS export'u doğrulamaz. macOS CI kullanılabilir; fiziksel test yine ayrıdır. [S06](35_SOURCES.md#s06)

## Dosya yaşam döngüsü

Kaynak → erişim izni/adaptör kaydı; proje → EDL yerel veritabanı; thumbnails → temizlenebilir cache; export temp → uygulama özel alanı; çıktı → kullanıcı seçimine göre kalıcı kopya. “Projeyi sil” ve “Üretilen videoyu sil” farklı işlemlerdir. Cihazdaki galeri orijinali otomatik silinmez.

Boş disk preflight'ta kontrol edilir; tam gerekli alan encoder'a göre ölçülüp güvenlik marjıyla tahmin edilir. “2× video boyutu her durumda yeterli” varsayımı yoktur. Kopyalanan kaynakların disk kullanımını UI gösterir. Cache temizleme aktif preview/render'ın dosyasını kaldırmaz.

## Sıralı batch ve kaynak yönetimi

P3 batch en çok 10 çıktı varyantını sırayla işler; aynı anda 10 native encoder başlatılmaz. Her varyant bağımsız attempt ve dosya adı alır. Birisi başarısız olursa diğerlerinin durumu görünür; kullanıcının onayıyla sıraya devam edilebilir. Termal/bellek uyarısında sıra duraklatılır, mevcut dosyalar korunur.

## Offline ve haklar

Free yerel düzenleme için sunucu gerekmez. Pro'da son doğrulanmış hakkın kısa ömürlü imzalı önbelleği kullanılabilir; ödemeyle ilgili server truth ve expiry kuralları [billing belgesinde](16_BILLING_ENTITLEMENTS.md). Hak süresi dolunca kaynak/proje silinmez. Profilin projeye uygulanmış temel crop/gain ayarları normal düzenleme verisidir.

## Kabul testleri

En az düşük/orta sınıf Android ve gerçek bir iPhone; döndürülmüş video, sesiz dosya, 44.1 kHz müzik, 60 fps girişten 30 fps çıktı, arka plan kesilmesi, disk dolması, permission revoke, save iptali, uzun dosyanın limite takılması. Bu paket hazırlanırken bu cihaz testleri yapılmamıştır; sonuçlar P0/P2'de doldurulur.
