# Kurucu Özeti — Neyi Yapıyoruz, Neyi Yapmıyoruz?

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Esas öneri

Genel amaçlı bir video editörüyle bütün rakiplerin özelliklerini karşılamaya çalışma. Kullanıcının “Bu videonun şu üç kısmı kalsın, dikey olsun, arkaya kendi müziğimi koyayım” işini hızlı ve güvenilir çöz. Başarıyı özellik sayısı değil, **yardımsız tamamlanan gerçek video işi ve ikinci kullanım** belirlesin.

İlk hedef kitle önerim, kendi ürününü veya yaptığı işi telefonuyla çeken ve haftada birkaç kısa paylaşım yapmak isteyen tek kişilik işletme/üretici. Bu, doğrulanmış müşteri segmenti değil; görüşmelerle sınanacak dar başlangıç hipotezidir. Aile anıları, profesyonel kurgu, oyun montajı ve podcast kırpma ilk pazarlama mesajında karıştırılmayacak.

## Araştırmanın kararı değiştiren tarafı

Clipchamp ücretsiz planda filigransız 1080p dışa aktarma sunduğunu belirtiyor. Bu nedenle “1080p ücretsiz” tek başına savunulabilir farklılaşma değil. Kullanıcının parça seçme kolaylığı, hatasız sonuç alması ve tekrar eden işinde zaman kazanması üzerine deney kurulmalı. [S16](docs/35_SOURCES.md#s16)

Mobilde Flutter bilgini kullanmak mantıklı; fakat medya motorunu Flutter'a yazdırmak veya dev video karelerini Dart kanalından geçirmek değil. Android/iOS motorları ayrı, proje tarifi ortak olmalı. Web tarafında aynı arayüzü açmak ile aynı dosyayı aynı güvenilirlikte dışa aktarmak farklı işlerdir. Codec uygunluğu dosya ve tarayıcı bazında ölçülür. [S01](docs/35_SOURCES.md#s01) [S05](docs/35_SOURCES.md#s05) [S10](docs/35_SOURCES.md#s10)

## Parayı nereden kazanacağız?

Temel düzenleme işe yarar bir ücretsiz ürün olarak kalır. Önerilen ücretli değer: tekrar kullanılabilir çalışma profilleri, sürüm kopyaları, sıralı toplu çıktılar, daha uzun yerel projeler ve sınırlı bulut işlemesi. Hiçbiri çalışmıyorken Pro satışı açılmaz.

Başlangıç fiyat hipotezi **aylık 6,99 USD / yıllık 49,99 USD**. Bunlar vergi hariç analitik karşılaştırma tutarlarıdır; gerçek mağaza fiyatları ülke/para birimi/vergiye göre ayrıca belirlenir. Yıllık plan “ayda 4,17 USD öde” diye sunulmaz; tahsilat yıllık ve peşindir. Fiyatların ödeme isteği veya kârlılık kanıtı yoktur.

Yerel dışa aktarma adedi Free'de sınırsızdır; proje süre/boyut güvenlik sınırları vardır. Free bulut hakkı doğrulanmış hesap için bir defalık 3 dakika, Pro aylık dönem için 30 dakika önerilir. Bulut her platformda her uzunlukta video demek değildir; işlem başına ayrıca girdi/çıktı sınırı vardır. [Kanonik tablo](docs/15_PRICING_FREE_PRO.md)

## İlk başta harcama yapmayacağımız şeyler

Kubernetes, GPU kümesi, stok müzik kataloğu, bütün video formatları, gelişmiş efekt motoru, sosyal ağ, bulutta kalıcı proje senkronizasyonu ve viral büyüme için büyük reklam bütçesi yok. Logo ve animasyon polish'i, ses senkronu ve dışa aktarma başarısızlığının önüne geçmez.

Bir Mac'e veya yetkili macOS derleme ortamına erişim ile fiziksel iPhone testini iOS bütçesine koy. Flutter kodunun derlenmesi iOS medya davranışını doğrulamaz. [S06](docs/35_SOURCES.md#s06)

## Devam et / düzelt / dur kararları

| Kanıt | Önerilen karar |
|---|---|
| İnsanlar gerçek videolarıyla görevi bitiremiyor | Yeni özellik durur; import/seçim/çıktı akışı düzeltilir |
| Görev kolay ama bir daha ihtiyaç duymuyorlar | Abonelik tezi zayıf; segment veya yerel tek-seferlik satın alma denenir |
| Tekrar ediyorlar fakat Pro değerine ihtiyaç yok | Ücretsiz çekirdeği bozmak yerine ücretli iş akışı yeniden tasarlanır |
| Web dışa aktarma seçili matriste kararsız | Web beta sınırı açıkça gösterilir; desteklenen mobil akış önerilir |
| Kullanıcı var, bulut maliyeti taşınamıyor | Yeni bulut promosyonları durur; mevcut haklara şeffaf destek ve çözüm sunulur |

## Senden onay gerektiren kararlar

Bu paket **Android öncelikli, Türkçe ve İngilizceye hazır, yerel işlemeyi esas alan** başlangıç varsayımıyla yazıldı. İsim, şirket/vergi yapısı, gerçek bütçe, ilk müşteri alt grubu ve mağaza fiyatları henüz onaylı değil. Bunlar teknik spike'ı engellemez; ücretli yayın öncesi çözülür.

İlk eylem: `AGENTS.md` ve `docs/33_FIRST_PROMPT.md` ile küçük medya prototipini başlat; aynı sırada [görüşme rehberini](templates/RESEARCH_INTERVIEW.md) kullanarak gerçek iş akışı gözlemi topla.
