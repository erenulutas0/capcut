# 05 — Kullanıcı Akışları, Ekranlar ve Mikro Metinler

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

> **Güncelleme 2026-09-22 — yeni ana akış:** İlk gerçek kullanıcı testinden sonra
> web editörünün ana kesme akışı **tek zaman çizgisi** oldu (CapCut benzeri): açılan
> video (≤ 5 dk) tek parça olarak zaman çizgisine gelir; tek oynatma çizgisi çıktı
> zamanındadır; "Böl" oynatma çizgisinin altındaki parçayı böler, "Sil" seçili
> parçayı siler, kenarlar sürüklenerek kısaltılır. Aşağıdaki F01 "aralık seç ve
> ekle" akışı artık ikincil yoldur (Kaynak önizlemesi / "Aralık seçerek ekle").
> Birim adı "an" değil "parça". Ayrıntı ve gerekçe:
> [ADR-019](../../docs/adr/ADR-019-single-timeline-editing.md).

## Ekran sistemi

Açılışta büyük “Video seç” eylemi, aşağıda mevcut yerel projeler. Kayıt ol modalı yok. “Örnekle dene” yalnızca bize ait kısa bir demo dosyası kullanır. İlk başarılı çıktıdan sonra Pro reklamı zorunlu gösterilmez; değer oluşturan davranış beklenir.

Editörün üç adımı: **Parçalar**, **Görünüm ve ses**, **Çıktı**. Preview üstte, seçili parçalar kart olarak altta; ayrıntı ayarı ihtiyaca göre açılır. Varsayılan ekran profesyonel çok katmanlı timeline değildir.

## F01 — İyi anları seç

Kaynak açılınca gerçek süre ve işlenebilirlik kontrolü gösterilir. Kullanıcı oynatır, “Başlangıcı işaretle” ve “Buraya kadar al” der. Aralık listeye eklenir; preview seçilen bölümden oynar. Kullanıcı bir daha işaretler. Klip kartlarında süre, küçük önizleme ve sıradaki numara görünür.

İşaretlenmemiş açık aralık varsa başka kaynağa geçerken “Bu seçimi ekle / Vazgeç / Düzenlemeye dön” sunulur. Başlangıcın öncesinde bitiş seçilirse değer sessizce değiştirilmez; anlaşılır hata ve düzeltme verilir.

Dokunmatik tam kare hassasiyeti zor olduğundan ±küçük adım kontrolleri ve zaman girişi bulunur. Kare adımı, kaynak fps değişkense “1/fps” varsayımıyla gerçek frame bilgisi olmadan hesaplanmaz.

## F02 — Sıralama ve geri alma

Kart sürükleme yanında “Öne al / Arkaya al” erişilebilir alternatifleri bulunur. Silme, “Klip kaldırıldı — Geri al” mesajı verir. Kaynağı projeden kaldırırken ondan üretilmiş klipler varsa etki açıkça söylenir; kaynak cihazdan silinmez.

Undo/redo komut geçmişi düzenlemeyi geri alır, orijinal dosyayı değil. Uygulama çöktükten sonra son kaydedilmiş tarif bulunur; kaybolabilecek son küçük değişiklik aralığı hakkında yanlış garanti verilmez.

## F03 — Görüntü ve müzik

Oran seçimi: “Dikey 9:16”, “Yatay 16:9”, “Kare 1:1”. “Çerçeveyi doldur” görüntüyü kesebilir; “Tam görüntüyü göster” boş alan ekleyebilir. Önizlemede kesilen alan görünür. Otomatik kişi takibi yoktur.

Müzik paneli dosya seçimi, müzikte başlangıç/bitiş, videoda başlayacağı nokta ve ayrı ses seviyelerini içerir. Kaynak ses varsayılan 0 dB; müzik eklendiğinde önerilen ilk değer −12 dB'dir, bu evrensel ideal ses seviyesi iddiası değildir. Müzik konuşmayı örtüyorsa kullanıcı preview'da kısabilir. İlk sürümde otomatik ducking yok.

Müzik kısaysa kalan bölümün sessiz olacağı gösterilir; kendiliğinden tekrar edilmez. Fazla uzunsa çıktı sonunda kesilir. Kullanıcının açık seçimi olmadan şarkıyı başka videodan çekme veya platformdan indirme yapılmaz.

## F04 — Çıktı

Özet: süre, oran, çözünürlük, tahmini dosya boyutu aralığı ve işlem rotası. Boyut tahmini kesin sonuç değildir. Seçilen ayarlar cihazda desteklenmiyorsa başlamadan belirtilir.

Yerel: “Video bu cihazda hazırlanacak. Bu işlem için videon yüklenmeyecek.” Web uygulamasının ağdaki diğer servisleri ayrıca gizlilik açıklamasına bağlıdır.

Bulut P3: “Bu çıktı için videon ve seçtiğin ses dosyası sunucuya yüklenecek. Kullanılacak hak: 42 saniye. Kaynaklar 24 saat, çıktı 48 saatlik saklama planına tabidir.” Bu metin ancak gerçek altyapı ve onaylanan politika aynıysa kullanılır. Kullanıcı yerel rotaya geri dönebilir.

İlerleme safhaları “Hazırlanıyor / Kodlanıyor / Dosya tamamlanıyor / Kaydediliyor”. Gerçek ilerleme ölçülemeyen safhada yapay yüzde artışı yapılmaz. Render başarısı ancak çıktı dosyası doğrulanıp erişilebilir olduğunda gösterilir. Native kaydetme sonucu ayrıca doğrulanır; browser indirmesinin kullanıcının diskinde tamamlandığını doğrulayamıyorsak “İndirme başlatıldı” denir, “Dosya kaydedildi” denmez.

## F05 — Hatalar ve kurtarma

| Kod | Kullanıcı metni | Eylem |
|---|---|---|
| UNSUPPORTED_CODEC | Bu dosya bu cihazda hazırlanamıyor. Düzenlemen silinmedi. | Desteklenen dosya seç; uygun ise açık bulut seçeneği |
| SOURCE_MISSING | Kaynak videoya erişim kayboldu. | Dosyayı yeniden seç ve eşleştir |
| DISK_FULL | Çıktı için yeterli boş alan yok. | Alan aç; daha küçük desteklenen çıktı seç |
| EXPORT_INTERRUPTED | İşlem tamamlanmadı. Projen kayıtlı. | Yeniden başlat; “kaldığı kareden sürer” iddiası yok |
| CLOUD_QUOTA_LOW | Bu işlem için bulut hakkın yeterli değil. | Yerel rota, daha kısa çıktı veya mevcut plan bilgisi |
| NETWORK_LOST | Bağlantı kesildi; durum yeniden kontrol ediliyor. | Aynı işlem kimliğiyle sorgula, yeni job yaratma |

## F06 — Pro dönüşümü

Yükseltme, Pro profil kaydetme veya batch özelliği seçilince bağlam içinde gösterilir. “Şimdi değil” belirgin; çalışma korunur. Fiyat, yenileme dönemi, yıllık toplam, geri yükle ve abonelik yönetimi görünür. Free'ye dönmek kullanıcının dosyasına filigran eklemez; plan limiti üstü proje salt okunur/aşağıdaki limitlere uyarlanabilir kalır, silinmez.
