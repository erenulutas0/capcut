# 17 — Birim Ekonomi, Bütçe ve Fiyat Deneyleri

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Modelin sınırları

Bu bir tahmin modeli değil, varsayımları görünür kılan **senaryo hesabıdır**. Gerçek encode benchmark'ı, satın alma dönüşümü, ülke vergi karması, retention veya destek süresi ölçülmedi. USD değerler farklı kanalları kıyaslayan iç analizdir; Türkiye'de şirket/muhasebe/tahsilat uygunluğu ayrıca değerlendirilir.

## Bilinen dış fiyatlar ile iç varsayımı ayır

Apple Small Business kapsamında uygunluk/onay varsa açıklanan komisyon %15; hesap onayı varsayılmaz. Google'ın güncel fee sayfası bölge ve program ayrımı yapar; 30 Haziran 2026 sonrası EEA/UK/US tablolarında abonelik servis ücreti ve Google billing bileşeni ayrı gösterilir. Bu nedenle modeldeki %15 **baz senaryodur**, evrensel sabit oran değildir; %30 stres senaryosu da çalıştırılır. [S22](35_SOURCES.md#s22) [S23](35_SOURCES.md#s23)

RevenueCat'ın incelenen fiyatında aylık izlenen gelir 2.500 USD eşiğine kadar ücretsiz yapı, eşik sonrası izlenen gelir üzerinden %1 fiyat yer alır. Gerçek sözleşme ve kapsanan gelir tanımı doğrulanır. Aşağıdaki model, eşik aşılmış gibi %1'i muhafazakâr dahil eder. [S26](35_SOURCES.md#s26)

Lemon Squeezy'nin açıklanan temel ücreti %5 + 0,50 USD; abonelik, uluslararası ödeme ve payout ekleri olabilir. Fee bazı durumlarda vergi dahil sipariş tutarı üstünden alınır. Sadece “%5 komisyon” diye modellemek yetersizdir. [S28](35_SOURCES.md#s28) [S29](35_SOURCES.md#s29)

## Ölçülecek compute maliyeti

`c = (worker CPU/RAM + idle allocation + geçici disk + storage/istek + ilgili transfer + retry maliyeti) / başarıyla teslim edilen çıktı dakikası`.

Başarısız/iptal işler paya eklenir; başarılı çıktı sayısından saklanmaz. Girdi süresi, çözünürlük, codec, klip sayısı, queue beklemesi ve aktif encode süresi ayrı kaydedilir. 15 dakikalık kaynaktan 10 saniye almak ile 10 saniyelik kaynaktan 10 saniye almak aynı maliyeti garanti etmez.

İlk örneklerde `c=0,03 USD/çıktı dakikası`, stres için `c=0,12` tamamen **ölçülmemiş varsayımdır**. Fiyat tablosu veya worker sağlayıcısı teklifi değildir.

## Mobil satış baz hesabı

Vergi hariç fiyat P; mağaza fee %15; billing altyapısı %1; refund/chargeback beklenen kayıp rezervi %2; değişken destek/servis payı 0,25 USD/kullanıcı-ay. Bu kalemler tahminîdir; founder emeği burada tam ücretlendirilmemiştir.

`Aylık katkı = P × (1 - 0.15 - 0.01 - 0.02) - 0.25 - cloudDakika × c`.

Yıllık planın P değeri `49,99/12`; bu tahsilat takvimi değil dönemsel analizdir. Dört ondalık hesap gösterimi, girdilerin bu kesinlikte bilindiği anlamına gelmez.

| Senaryo | Kullanılan cloud dk/ay | Varsayılan c (USD/dk) | P (USD/ay) | Sabit gider/kurucu maaşı öncesi katkı (USD/ay) |
|---|---:|---:|---:|---:|
| Aylık plan | 0 | 0.03 | 6.9900 | 5.4818 |
| Aylık plan | 6 | 0.03 | 6.9900 | 5.3018 |
| Aylık plan | 30 | 0.03 | 6.9900 | 4.5818 |
| Aylık plan | 30 | 0.12 | 6.9900 | 1.8818 |
| Yıllık planın aylık eşdeğeri | 0 | 0.03 | 4.1658 | 3.1660 |
| Yıllık planın aylık eşdeğeri | 6 | 0.03 | 4.1658 | 2.9860 |
| Yıllık planın aylık eşdeğeri | 30 | 0.03 | 4.1658 | 2.2660 |
| Yıllık planın aylık eşdeğeri | 30 | 0.12 | 4.1658 | -0.4340 |

Stres senaryosunda yıllık planın yoğun cloud kullanıcısı negatif katkıya düşebilir. “Aylık ortalama kullanıcı az kullanıyor” diyerek bütün planın güvenli olduğu varsayılmaz. P95/P99 ve en yüksek izinli iş maliyeti izlenir; yeni müşterilere verilen cloud hakkı gerçek testten sonra onaylanır. Mevcut kullanıcı hakları habersiz azaltılmaz.

## Ek mağaza ücreti stres kontrolü

Aynı formülde yalnızca mağaza ücretini %30 alıp diğer varsayımları korursak, 6 dakika cloud ve c=0,03 senaryosunda aylık plan katkısı 4.2533 USD, yıllık planın ay eşdeğeri katkısı 2.3611 USD olur. 30 dakika cloud ve c=0,12 birleşik stresinde değerler sırasıyla 0.8333 USD ve -1.0589 USD'dir. Bunlar gerçek uygulanmış ücret değil, marj hassasiyetini gösteren dört ek hesap sonucudur.

## Web ödeme örneği — vergi yok varsayımı

Kartla uluslararası abonelik için örnek toplam yüzde %7 (=5 +1,5 +0,5), sabit 0,50 USD ve kalan payout üzerinden %1 kullanılmıştır. Bu her ülke/işlemde uygulanacak gerçek oran değildir. PayPal ve diğer opsiyonel ücretler dahil değildir.

6,99 USD aylık satışta platform ücreti sonrası 6.0007 USD, örnek payout sonrası 5.9407 USD kalır. 49,99 USD yıllık satışta aynı yöntemle 45.5308 USD, ay eşdeğeri 3.7942 USD kalır. Bunlardan compute, refund, destek, vergi yükümlülükleri ve diğer altyapı giderleri henüz çıkarılmamıştır.


Vergi dahil checkout bedeli varsa önce vergi/fee tabanı gerçek muhasebe akışıyla modellenir; vergi hariç fiyatın yüzdesi alınarak yanlış kâr çıkarılmaz. Merchant-of-record kullanımı şirketin tüm yerel vergi/beyan yükümlülüklerini yok saymak değildir.

## Sabit gider ve başabaş

Başlangıç sabit altyapı için 60 USD/ay yalnızca örnek varsayım. Gerçek teklif; domain, e-posta, API/DB, yedek, monitoring, macOS build ve diğer sabitleri kapsayacak şekilde toplanmalı. Fiziksel test cihazı, Apple/Play üyeliği, hukuk/muhasebe ve kurucu emeği ayrı nakit/ekonomik maliyettir.

Ortalama katkı 3 USD/kullanıcı-ay olsaydı 60 USD sabit altyapı için 20 ödeyen kullanıcı gerekir. Bu **işletmenin kârlı olduğu eşik değildir**; maaş, edinim, vergi ve risk tamponu dışarıdadır. Ortalama katkı ölçülmeden bu örnek hedef gelir tahmini diye kullanılmaz.

## CAC ve retention

`Paid CAC = kanalın toplam edinim harcaması / atfedilebilir yeni ödeyen müşteri`. Install veya e-posta kaydı payda değildir. `Aktivasyon maliyeti = harcama / ilk anlamlı export`. Organik founder zamanı da ayrı saat kaydıyla izlenir.

İlk aylarda sonsuz ömürlü `ARPU/churn` hesabıyla LTV uydurma. Gözlenen 30/60/90 günlük cohort katkısı, geri ödeme ve retention ile sınırlı rapor üret. Ücretli reklamın geri dönüş hesabı ancak yeterli ödeme/yenileme verisiyle değerlendirilir.

## Bütçe kapıları

P0: Ücretsiz/local deneme, gerekirse küçük kontrollü test compute bütçesi. P1/P2: kullanıcı araştırması ve cihaz doğrulama maliyeti öncelik. P3: provider onayı ve birim maliyet ölçümü olmadan cloud satışı yok. Pazarlama deney bütçesi [GTM belgesinde](25_MARKETING_GTM.md); buna bütçe onayı verilmiş sayılmaz.

Aylık kontrol: net tahsilat, tanınan dönem geliri, fee, refund, total cloud cost, paid/free maliyet ayrımı, aktif user başına destek süresi, retention, gider tahmini sapması. Nakit ile muhasebe geliri ayrı tablolanır.
