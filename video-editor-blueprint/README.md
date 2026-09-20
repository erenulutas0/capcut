# Clip — Mobil ve Web Video Editörü | Proje El Kitabı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

**Çalışma adı:** Clip. Bu isim için marka, alan adı veya mağaza uygunluğu araştırması yapılmadı; yayına çıkacak isim değildir.

**Ürün fikri:** Kullanıcı kendi videosunda saklamak istediği bölümleri işaretler, parçaları sıralar, görüntüyü yeniden çerçeveler, kendi ses dosyasını ekler ve kullanılabilir bir video çıkarır. Önce güvenilir, kolay bir klip oluşturucu; sonra düzenli üretim yapanlar için ücretli iş akışları.

## Paketi nasıl kullanacaksın?

1. Önce [Kurucu özeti](KURUCU_OZETI.md), [vizyon](docs/01_VISION_POSITIONING.md), [PRD](docs/04_PRD_SCOPE.md) ve [ücretsiz/Pro tasarımı](docs/15_PRICING_FREE_PRO.md) belgelerini oku. Bunlar neyi ve neden yapacağımızı tanımlar.
2. Kodlamadan önce [mimari](docs/07_ARCHITECTURE_ADR.md), [medya hattı](docs/09_MEDIA_PIPELINE.md), [proje sözleşmesi](docs/10_PROJECT_SCHEMA_CONTRACTS.md) ve [test matrisi](docs/22_QA_TEST_MATRIX.md) birlikte okunmalı.
3. Kod ajanını [AGENTS.md](AGENTS.md) ve [ilk kodlama görevi](docs/33_FIRST_PROMPT.md) ile başlat. İlk görev tüm uygulamayı yazmak değil; riskli medya işlemlerini çalışan küçük örneklerle doğrulamaktır.
4. Pazarlamayı sona bırakma. [Doğrulama görüşmeleri](docs/03_AUDIENCE_VALIDATION.md) ve [pazara giriş](docs/25_MARKETING_GTM.md), teknik prototiple paralel yürür.

## Başlangıç kararları

| Konu | Önerilen karar |
|---|---|
| Ana deneyim | İzle → başlangıç/bitiş işaretle → parçaları sırala → müzik ekle → dışa aktar |
| Mobil | Flutter arayüz; Android Media3 ve iOS AVFoundation adaptörleri |
| Web | React/Next.js; WebCodecs + Mediabunny adayı; gerçek codec testi zorunlu |
| İşleme | Önce cihaz üzerinde; bulut yalnızca açık kullanıcı seçimiyle ve ayrı kotayla |
| Veri | Tahribatsız düzenleme tarifi; kaynak dosya asla üzerine yazılmaz |
| İlk çıktı standardı | Doğrulanmış cihazlarda MP4, H.264/AAC, SDR, 1080p/30 fps |
| İlk ücret modeli | Alfa ücretsiz; değer ve güvenilirlik doğrulandıktan sonra Free + Pro |
| Yapay zekâ | İlk sürümün bağımlılığı değil; ayrı doğrulama ve maliyet kapısından geçen ileri faz |
| Platform sırası | Android dar alfa + masaüstü web teknik alfa; gerçek cihazla iOS doğrulaması; kademeli genel yayın |

## Belgelerdeki üç farklı bilgi türü

**Araştırma bulgusu:** Resmî bir kaynağa bağlıdır. Güncellik tarihi ve sınırları [kaynak kaydında](docs/35_SOURCES.md) bulunur.

**Ürün/mühendislik önerisi:** Henüz onaylanmış kurucu kararı veya ölçülmüş sonuç değildir. Örneğin 5 dakika ücretsiz proje süresi, 6,99 USD fiyat denemesi ve performans hedefleri bu gruptadır.

**Yayın engeli:** Hukuki onay, mağaza uygunluğu, gerçek cihaz testi veya ödeme sağlayıcısı kabulü gibi tamamlanmadan ilgili özelliğin açılmaması gereken kontroldür.

## Belgelerin yetki sırası

Güvenlik ve kullanıcı verisini koruyan hükümler → onaylı yeni ADR → PRD kapsamı → kanonik fiyat/kota belgesi → medya/proje sözleşmesi → platform uygulama detayları → görev tanımı. Çelişki sessizce çözülmez; karar kaydına yazılır. Bir belgenin mevcut olması, içindeki bütün fazların uygulanmasına izin vermez.

Kotaların tek gerçek kaynağı `docs/15_PRICING_FREE_PRO.md`; proje biçiminin kaynağı `docs/10_PROJECT_SCHEMA_CONTRACTS.md`; faz sırasının kaynağı `docs/29_ROADMAP_BACKLOG.md` olmalıdır. Kodda bunlardan sürümlü politika/sözleşme üretilir; üç ayrı platformda elle farklı sayı tutulmaz.

## Depo ve paylaşım

İlk çalışma için özel bir repo önerilir. Fiyat deneyleri ve iç maliyet varsayımları müşteriye verilmiş sözler değildir; public site metinleri yalnızca gerçekten çalışan özelliklerden ve onaylanmış koşullardan üretilir. Açık kaynak yayın kararı ayrıca verilir; bu MD paketi uygulama koduna otomatik bir açık kaynak lisansı atamaz.

## Neler bu pakette yok?

Üretim kodu, çalıştırılmış cihaz benchmark'ı, imzalanmış müzik lisansı, aktif ödeme hesabı, doğrulanmış pazar talebi ve yayına hazır şirket özelinde hukuki metin yoktur. Bunların yerine **neyin nasıl doğrulanacağı ve hangi kanıtla tamamlanmış sayılacağı** tanımlanmıştır.

Tam içerik: [doküman haritası](docs/00_DOCUMENT_MAP.md). Kaynaklar: [araştırma sicili](docs/35_SOURCES.md). Paket üzerinde yapılan kontroller: [paket kontrol raporu](PAKET_KONTROL_RAPORU.md).
