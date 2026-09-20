# Şablon — Pull Request ve Tamamlanma Kanıtı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖRNEK ŞABLON — PR AÇILMADI
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Örnek PR: P1-03 Klip yeniden sıralama

**Amaç:** Kullanıcı mevcut seçilmiş klipleri kaynak dosyasını değiştirmeden sıralayabilsin. **Kapsam:** domain komutu + UI eylemi + undo + ilgili testler. **Durum:** Örnek taslak; kod değişikliği yapılmış değildir.

## Değişiklik özeti

Gerçek PR'da dosyalar ve davranış farkı yazılır. Örnek beklenen fark: `ReorderClips` komutu dizi sırasını değiştirir; clip ID sabit kalır; toplam süre korunur. Yeni ödeme/cloud/AI altyapısı yok.

## Kabul kanıtı

- [ ] [A,B,C] → [C,A,B] sonucu ve süre invariants.
- [ ] Undo eski sırayı geri getiriyor.
- [ ] Keyboard/screen-reader alternatifi çalışıyor.
- [ ] Otomatik kayıt sonrası sıra korunuyor.
- [ ] Gerçek export doğru klip sırasıyla oluşuyor.

Kutular gerçek test kanıtıyla doldurulur. Bu şablonda hiçbir test çalıştırılmadı.

## Çalıştırılan kontroller

Format/lint/type; unit/contract; integration; ilgili native/browser build; golden media; fiziksel cihaz. Her satırda **gerçek komut**, exit status, kısa sonuç ve artefact referansı bulunur. “Not run: fiziksel cihaz yok” geçerli dürüst rapordur; “muhtemelen geçer” test sonucu değildir.

## Güvenlik ve gizlilik

Kaynak üzerine yazma yok mu? Seçilmeyen medya okunuyor mu? Yeni network/SDK var mı? Log alanları kişisel veri taşıyor mu? Cloud/ownership etkisi var mı? Yoksa açıkça “bu değişiklikte uygulanmıyor” yaz, şablondaki bütün soruları otomatik Evet yapma.

## Dependency ve lisans

Yeni bağımlılık yoksa belirt. Varsa exact version, official URL, SPDX/build flags, binary boyutu, security değerlendirmesi ve kaldırma yolu. Orijinal FFmpegKit gibi bakım kararı değişmiş bağımlılık sırf eski örnekte var diye eklenmez.

## Rollout/rollback

Hangi feature flag/fazı etkilediği, veri migration olup olmadığı, geri dönüşte kullanıcı projesinin durumu. Kırıcı schema değişikliği varsa migration/backup testleri ayrı kanıt.

## Bilinen eksikler

Gerçek eksik/platform blokajı listelenir. Kapsam dışı gereksiz özellikleri “eksik” diye ekleyip PR'ı sonsuz büyütme. Sonraki tek backlog işi belirtilir.
