# 27 — Landing Page, Arama ve Mağaza Metinleri

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Landing page akışı

1. Kullanıcının işini anlatan başlık + gerçek demo + “Video seç” / “Örnekle dene”.
2. Üç adım: iyi anları seç, görünüm/sesi ayarla, dosyanı al.
3. Yerel işleme ve Free limitleri açık bilgi.
4. Desteklenen platform/dosya matrisi; Pro özellikleri yalnızca hazırsa.
5. Sık sorular, veri/hesap silme, destek, privacy/terms ve gerekiyorsa şeffaf fiyat.

E-posta toplamak için işi yapma düğmesini saklama. Beta sadece bekleme listesi aşamasındaysa “hemen edit et” düğmesiyle yanıltma; “Betadan haber al” denir.

## Türkçe ana sayfa taslağı

**Başlık:** Videondaki iyi anlar kalsın.

**Açıklama:** İstediğin bölümleri seç, sırala, görüntüyü kırp ve kendi müziğini ekle. Karmaşık bir kurgu ekranına girmeden kısa videonu hazırla.

**Ana eylem:** Video seç

**İkincil eylem:** Örnek videoyla dene

**Güven bilgisi:** Desteklenen cihazlarda yerel dışa aktarma. Filigransız 1080p. Ücretsiz projelerde 5 dakikaya kadar çıktı. Dosya ve tarayıcı sınırlarını başlamadan gösteriyoruz.

Bu metin ürün davranışı doğrulanmadan canlı vaade dönüştürülmez. Web dosya limiti ve gerçek destek matrisi bir tıklama uzağında değil, dosya seçme bağlamında da görünür olmalıdır.

## Sık sorular — taslak cevaplar

**Videom yükleniyor mu?** Yerel rotada seçilen medya video hazırlama amacıyla sunucuya gönderilmez. Bulut rotasını ayrıca seçersen kullanılacak dosyalar ve saklama süreleri önce açıklanır. Hesap/ödeme ve izinli analitik trafiği farklıdır.

**Filigran var mı?** Planlanan temel Free çıktıda yoktur. Pro, filigranı kaldırmak için değil, tekrar edilen işleri kolaylaştırmak için tasarlanmıştır.

**İstediğim şarkıyı ekleyebilir miyim?** Desteklenen kendi ses dosyanı ekleyebilirsin. Videoda kullanma/yayımlama hakkını ayrıca sağlamalısın; streaming platformundan indirme hizmeti sunmuyoruz.

**Telefon ve webde aynı projem açılır mı?** Hesap üzerinden Pro hakkı tanınabilir; kaynak videoların ve projelerin otomatik bulut senkronizasyonu ilk sürümde yoktur.

**Abonelik bitince videolarım silinir mi?** Oluşturduğun yerel dosyalar silinmez. Yerel projelerin korunur; yeniden çıktı almak o anki plan/platform limitlerine tabidir. Geçici bulut çıktıları açıklanan süre sonunda silinir.

## SEO araç sayfaları

İlk adaylar: `/tr/video-kirp`, `/tr/video-parcalarini-birlestir`, `/tr/videoya-muzik-ekle`. İngilizce eşdeğerleri gerçek çeviri ve aynı görev desteği hazırsa eklenir. Bunlar arama hacmi doğrulanmış anahtar kelimeler değil, araştırılacak kullanıcı işi sayfalarıdır.

Her sayfa gerçekten çalışan araç, özgün küçük örnek, adım açıklaması, desteklenen limitler ve ilgili soruyu cevaplar. Aynı metnin yüzlerce anahtar kelime varyasyonu üretilmez. Google'ın insan odaklı faydalı içerik yaklaşımı, gerçek görev faydasını öncelemek için kaynak olarak kullanılır. [S42](35_SOURCES.md#s42)

Teknik: anlamlı title/description, canonical ve dil eşlemesi, sitemap, robots, hızlı pazarlama sayfası, indexlenmemesi gereken özel editor/job URL'leri, erişilebilir HTML. Review/rating structured data ancak gerçek uygun veri varsa; sahte yıldız yok.

## ASO taslağı — isim henüz seçilmedi

Kısa açıklama: “İstediğin anları seç, videonu kırp, kendi müziğini ekle.”

Uzun açıklama girişi:

> Kendi videolarından paylaşmaya hazır kısa içerikler oluştur. Saklamak istediğin bölümleri işaretle, parçaları sırala, görüntünü dikey veya yatay çerçeveye uyarla ve kendi ses dosyanı yerleştir. Temel düzenlemeye hesap açmadan başlayabilirsin.

Ardından yalnızca canlı özellikler, Free/Pro ve platform sınırları, müzik hakları notu ve destek bilgisi gelir. Mağazanın güncel karakter/metadata kuralları yayımlama sırasında doğrulanır. “Resmî TikTok editörü” gibi ilişki ima edilmez.

## Ekran görüntüsü sırası

İyi anları işaretle → parçaları sırala → çerçeveyi seç → müziğin istediğin bölümünü ekle → gerçek çıktı. Her ekran mevcut build'den veya açıkça işaretli demo durumundan gelir; rakip UI kopyalanmaz. Tablet/telefon boyutları gerçek cihaz sınıfına uygun hazırlanır.

## Yorum ve destek

Başarılı işten sonra uygun sıklıkta sistem review akışı düşünülebilir. Yalnızca memnun kullanıcılara puan isteme filtresi, yorum karşılığı ödül veya eleştireni destekten mahrum bırakma yok. Olumsuz yorumlar cihaz/codec ve UX sorunlarını sınıflandırmak için kullanılır; kullanıcıdan özel medyasını herkese açık yorumda isteme.
