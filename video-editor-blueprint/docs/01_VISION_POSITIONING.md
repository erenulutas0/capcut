# 01 — Vizyon, Konumlandırma ve Ürün İlkeleri

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Vizyon

Video düzenlemeyi öğrenmek istemeyen bir kişinin kendi görüntülerinden paylaşmaya hazır kısa bir hikâye oluşturmasını sağlamak. Ürün “en fazla özellik” yarışına değil, **en az tereddütle doğru sonuç** yarışına girer.

Ana iş: “Çektiğim videoda yalnızca iyi bölümler kalsın; gereksiz kısmı çıkarayım, ekrana uygun kırpayım, kendi müziğimi yerleştireyim ve temiz bir dosya alayım.” Bu iş kullanıcı araştırmasıyla doğrulanacak; ifadeler araştırma sonucu değildir.

## Bir cümlelik konumlandırma

> Saklamak istediğin anları seç. Müziğini ekle. Videonu oluştur.

Daha açıklayıcı sürüm: “Kendi videolarından kısa içerik üretmek isteyenler için, karmaşık bir kurgu ekranı gerektirmeyen parça seçme ve birleştirme uygulaması.”

Ücretli ürünün tezi farklıdır: “Aynı düzeni her seferinde yeniden kurmadan, düzenli paylaşımlarını daha kısa sürede hazırlamak.” Tek seferlik basit kırpmadan düzenli üretim değerine geçemiyorsak aboneliği zorlamayız.

## Tasarım ilkeleri

**Önce parçayı koru.** Varsayılan işlem gereksiz kısımları tek tek silmek değil, iyi anları işaretlemektir. Gelişmiş silme/ayırma seçenekleri aynı tahribatsız modele bağlanır.

**Kaynak ve sonuç ayrıdır.** Kullanıcının yüklediği/orijinal dosyası değişmez; düzenleme bir tariftir. Bir hata yaşandığında çalışmanın tamamını kaybetmek kabul edilmez.

**Ücretsiz çıktı gerçek çıktıdır.** Son adımda filigran veya sürpriz ödeme engeli yok. Pro özelliği seçilmeden önce fark gösterilir; geri dönmek çalışmayı silmez.

**Yerel önce, gizli bulut yok.** İşleme rotası dışa aktarmadan önce görünür. “Cihazında” iddiası medya işleme için geçerlidir; izinli analitik ve ödeme ağ trafiği ayrı açıklanır.

**Desteklenmeyeni erken söyle.** Bir dosyanın açılması, düzgün dışa aktarılacağı anlamına gelmez. Uzun düzenleme başlamadan codec/kapasite kontrolü yapılır.

## Savunulabilir değer nereden gelebilir?

Başlangıçta teknik tekel veya yeni algoritma iddiamız yok. Kullanıcıların zorlandığı seçim davranışları, gerçek cihaz regresyon seti, iyi geri alma/geri yükleme deneyimi ve belirli bir işin tekrarına uygun profiller zamanla birikim yaratabilir. Bunlar kanıtlanmış rekabet avantajı değil; yatırım yapılacak aday alanlardır.

Temel ücretsiz özellikleri rakiplerden ilk biz getiriyormuşuz gibi sunmayacağız. Clipchamp'ın açıklanan ücretsiz teklifi, bu alandaki minimum beklentinin zaten yüksek olduğunu gösterir. [S16](35_SOURCES.md#s16)

## Kapsam dışı kimlikler

Bu ürün ilk sürümde sosyal ağ, film kurgu yazılımı, TikTok müzik arşivi, video indirme aracı, telif kaldırıcı, bulut arşiv hizmeti veya her platforma otomatik paylaşım botu değildir. “AI” etiketi, çalışmayan bir otomasyonu pazarlamak için eklenmez.

## Kuzey yıldızı

Bir haftada **en az bir anlamlı düzenleme içeren videoyu başarıyla dışa aktarıp aynı hafta ikinci bir farklı proje üreten kullanıcı** sayısı. Bu ileri hedefin ön koşulu ilk başarılı export'tur. Salt app açma, kayıt olma, preview oynatma veya reklam izlenmesi ürün değerinin yerine geçmez.

Ölçümler yalnızca izin verilen/ölçülebilen kitleyi temsil edebilir; yerel anonim kullanıcının bütün cihazlardaki davranışını bildiğimizi varsaymayız. Tanımlar [analitikte](21_ANALYTICS_METRICS.md).
