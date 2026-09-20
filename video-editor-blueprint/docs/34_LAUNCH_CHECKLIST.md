# 34 — Lansman Kontrol Listesi ve Go / No-Go

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Kullanım

Kutular başlangıçta boş kalır; doküman hazırlanmasıyla işaretlenmez. Her kritik kutu test raporu, ekran, provider kaydı veya onay bağlantısıyla kapanır. Alfa, ücretsiz beta ve ücretli yayın farklı kapılardır.

## A — Yerel alfa

- [ ] Kaynak video asla üzerine yazılmıyor; silme/undo/re-link testleri var.
- [ ] Seçili cihazlarda iki aralık + müzik gerçek dosya üretiyor.
- [ ] Orientation, crop, süre ve audio sync golden kontrolleri geçiyor.
- [ ] Unsupported/disk full/permission revoke/cancel anlaşılır ve güvenli.
- [ ] EDL otomatik kayıt ve kapanma sonrası kurtarma davranışı doğrulandı.
- [ ] Hesapsız Free akışında gereksiz network/ödeme engeli yok.
- [ ] Demo/fixture medyasının hakları temiz.

## B — Kamuya açık Free beta

- [ ] Desteklenen OS/browser/codec matrisi gerçek testlerle yazıldı.
- [ ] Türkçe temel metinler, hata açıklamaları ve erişilebilirlik test edildi.
- [ ] İsim/domain/iletişim bilgileri gerçek; geçici Clip adı yanlış tescil iddiasıyla sunulmuyor.
- [ ] Privacy/terms ve SDK veri envanteri gerçek davranışla eşleşiyor.
- [ ] App Store/Play beyanları ve test koşulları güncel konsolda doğrulandı.
- [ ] Hesap varsa silme akışları ve gerekli web yolu çalışıyor.
- [ ] Beta kullanıcı gözlemleri, destek yolu ve crash/export metrikleri hazır.
- [ ] Landing page/mağaza ekranları yalnızca mevcut özellikleri gösteriyor.
- [ ] Analytics ve marketing tercihleri kullanıcı için anlaşılır.

## C — Pro satışı

- [ ] Profiller, sürüm/kopya ve batch gibi gerçekten satılan değer çalışıyor.
- [ ] Uzun mobil limit gerçek cihazlarda test edildi; web farkı açık.
- [ ] Aylık/yıllık ürünler, yerel fiyatlar, vergi ve yenileme açıklamaları doğrulandı.
- [ ] Provider şirket/ürün kabulü ve payout tamamlandı.
- [ ] Purchase/restore/renew/cancel/expiry/grace/refund sandbox testleri geçti.
- [ ] Canonical account eşlemesi ve duplicate subscription uyarısı var.
- [ ] Webhook auth/signature/dedupe/out-of-order ve reconciliation testleri geçti.
- [ ] Offline Pro cache sınırı doğru; Free ve dosyalar expiry'de korunuyor.
- [ ] Dış ödeme CTA'sı yayın ülkesinde açıkça uygun; bilinmeyense kapalı.
- [ ] Ücret iadesi/yanlış hak ve destek prosedürü uygulanabilir.

## D — Cloud hizmeti

- [ ] Kullanıcı medya yükleme rotasını açıkça seçiyor; gizli fallback yok.
- [ ] Object bucket private; asset/job/download owner check testleri geçti.
- [ ] Probe/limit/sandbox/timeout/network isolation ve dependency güvenliği incelendi.
- [ ] Quote/reserve/commit/release yarış ve çift callback testleri geçti.
- [ ] Trial ve Pro grant dönemleri/expiry doğru; yıllık kota ay ay.
- [ ] Kaynak/çıktı retention ve gerçek fiziksel silme doğrulandı.
- [ ] Uluslararası aktarım, DPA ve veri sorumlusu metinleri uzmanla değerlendirildi.
- [ ] En pahalı izinli iş ve retry dahil gerçek unit cost ölçüldü.
- [ ] Paid kullanıcı hakkını karşılayacak kapasite/bütçe var; trial kill switch ayrı.
- [ ] Olay müdahalesi, restore ve deletion replay tatbikatı yapıldı.

## E — Büyüme

- [ ] İlk gerçek kullanıcı görevleri gözlendi; destek olmadan tıkanmalar anlaşıldı.
- [ ] Install yerine meaningful export ve tekrar kullanım ölçülüyor.
- [ ] Küçük reklamın mesaj/landing/attribution ve bütçe onayı hazır.
- [ ] İçeriklerde telif, kullanıcı izni ve gerçek özellik kanıtı var.
- [ ] Olmayan özellik/garanti/sahte yorum kullanılmıyor.

## Yayın kararı

Kaynak kaybı, yetkisiz özel medya erişimi, yanlış ücret, bozuk kota, temsil edilmeyen platform sınırı veya çalışmayan temel export **NO-GO**. Kozmetik kusur tek başına bütün ürünü süresiz erteletmez; etkisi ve bilinen sorun olarak açıklanıp açıklanamayacağı değerlendirilir.

Karar kaydı: yayın türü, build/commit, destek kapsamı, kanıtlar, açık riskler, onaylayan kişi ve tarih. Bu pakette henüz bir GO kararı verilmemiştir.
