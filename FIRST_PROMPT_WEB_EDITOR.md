# İlk geliştirme görevi — Web video editörü / W0

Bu depodaki projede ürün odaklı kıdemli frontend mühendisi olarak çalış. Görevin yalnızca öneri veya ekran görseli üretmek değil; mevcut belgeleri okuyup ilk web geliştirme aşamasını gerçekten uygulamak, çalıştırmak ve doğrulayabildiğin sonuçları raporlamak.

## 1. Ürünün amacı ve bu görevin sınırı

Vizyonumuz: Video düzenleme öğrenmemiş birinin, hangi bölümleri tutmak istediğini seçerek videosunu kolayca hazırlaması. Kullanıcı timeline, codec veya ses kanalı terminolojisini öğrenmek zorunda kalmamalı.

Temel akış:
**Videoyu seç → istediğin anları işaretle → sırala → görüntüyü ve müziği ayarla → çıktıyı hazırla.**

İlerleyen aşamalarda manuel altyazı, SRT/VTT, otomatik transkript ve altyazı çevirisi eklenecek. Mimari bunların eklenmesini engellemesin; fakat bu görevde bunları tamamen inşa etme.

Proje WEB-FIRST. Bu görev yalnızca W0: gerçek yerel video önizlemesi olan, etkileşimli ve özenli web editörü temeli. Android/iOS, gerçek video encode, backend, hesap sistemi, abonelik, bulut yükleme ve AI servisleri bu görevin dışında.

İlk aşamanın başarısı: Kendi videomu seçebilmem, oynatabilmem, birden fazla aralık oluşturup sıralayabilmem, değişiklikleri geri alabilmem ve ayarların hangi kısmının gerçekten çalıştığını anlayabilmem. Sadece güzel bir landing page bu görevi tamamlamaz.

## 2. Önce depoyu ve belgeleri incele

Çalışma dizinini, varsa git durumunu, mevcut uygulamayı, paket yöneticisini ve kullanılabilir araçları kontrol et. Kullanıcının değişikliklerini koru; çalışan bir projeyi baştan yazma. Belgeler bir alt klasördeyse gerçek proje kökünü bul, yanlışlıkla iç içe ikinci uygulama oluşturma.

Önce şunları oku:
- AGENTS.md
- README.md
- START_HERE_WEB_UI.md
- docs/33_FIRST_PROMPT.md
- docs/ui/07_ASTRA_UI_PROMPT.md

Ardından uygulama için ilgili sözleşmeleri oku:
- docs/04_PRD_SCOPE.md
- docs/07_ARCHITECTURE_ADR.md
- docs/10_PROJECT_SCHEMA_CONTRACTS.md
- docs/11_WEB_EDITOR.md
- docs/22_QA_TEST_MATRIX.md
- docs/29_ROADMAP_BACKLOG.md
- docs/ui/00_UI_START_HERE.md
- docs/ui/02_VISUAL_SYSTEM.md
- docs/ui/03_WEB_SCREENS.md
- docs/ui/04_INTERACTIONS_STATES.md
- docs/ui/08_ACCEPTANCE_TESTS.md
- docs/ui/09_COPY_EN_TR.md

`design-preview/` içindeki HTML, CSS ve ekran görüntülerini tasarım referansı olarak incele. Bunları çalışan üretim medya motoru veya test edilmiş uygulama olarak kabul etme; görselleri ekranın yerine koyma.

`research/captions-2026-09-20/` varsa README, altyazı spesifikasyonu ve geliştirme aktarımını oku. Başka yerdeyse dosya adıyla bul. Araştırma eki gelecekteki özelliklerin önerisidir; fiyat/kota/gizlilik veya proje şemasını kendiliğinden değiştirmez. İçindeki ayrı planlama prompt’unu bu W0 kodlama görevinin yerine çalıştırma.

Eski Android-first metinlerle çelişki varsa güncel web-first görevini esas al ve farkı raporla. Eksik dosyayı okumuş gibi davranma. Altyazı eki eksikse W0’ı durdurma; eksikliği belirt. Zorunlu sözleşme eksikse ona bağımlı kısmı tahminle üretme; bağımsız, güvenli işleri ilerlet.

En fazla 8 maddelik bir uygulama planı yaz ve aynı görevde kodlamaya başla. Yalnızca plan sunup durma. Küçük, geri alınabilir tercihlerde makul karar al; ücret, veri paylaşımı veya yıkıcı işlem gerektiren belirsizlikte ilgili özelliği kapalı tut.

## 3. Mimari ve geliştirme disiplini

Mevcut uygun teknoloji yığınını koru. Yeni projeyse belgelerdeki Next.js/React + TypeScript yönünü kullan. CSS değişkenleriyle tasarım token’larını uygula; mevcutsa Tailwind veya erişilebilir bileşen araçlarından yararlan. Paketleri sırf popüler oldukları için ekleme.

İlgili API’leri resmî dokümandan doğrula, kurulan gerçek sürümleri kilitle ve not et. Erişemediğin dokümanı doğrulanmış sayma.

UI, uygulama işlemleri, domain ve medya adaptörü sınırlarını ayır; tek ekran için gereksiz katman veya framework kurma. Domain React’e veya ileride seçilecek transkript sağlayıcısına bağımlı olmasın.

Mevcut EDL/proje sözleşmesini koru: tam sayı mikrosaniye, yarı açık zaman aralıkları, kararlı kaynak/klip kimlikleri ve kaynak zamanı–çıktı zamanı ayrımı. Aynı kaynak bölümünün iki kez kullanılması ve kliplerin yeniden sıralanması test edilebilir olsun.

Büyük medya dosyalarını uygulama state’ine kopyalama, localStorage’a base64 olarak yazma veya blob URL’lerini kalıcı dosya adresi sanma. Dosya referanslarını ve medya kaynaklarının yaşam döngüsünü yönet; gereksiz kaynakları temizle.

## 4. Tasarım: Quiet Studio

Editörü önce yap; sade tanıtım sayfası ikinci sırada.

Görsel yön: koyu kömür tonlarında sakin editör, okunaklı yazılar, ölçülü lime/yeşil vurgu; tanıtım sayfasında sıcak açık zemin. Mevcut token’ları ve ekran referanslarını takip et. “Clip” geçici çalışma adı olarak kalsın.

Masaüstünde:
- Üstte proje başlığı, geri al/ileri al ve dışa aktarma girişi.
- Solda kaynak video ve saklanan anlar.
- Ortada büyük video önizlemesi ve açık oynatma/seçim kontrolleri.
- Sağda seçilen işlemin görüntü/ses ayarları.
- Altta sade çıktı sırası ve toplam süre.

Dar ekranda paneller çekmeceye dönüşsün. Telefonda masaüstü sütunlarını küçültme; büyük önizleme ve alttan açılan araç paneli kullan. Responsive web arayüzü yapmak, native mobil uygulama geliştirmek değildir.

Genel SaaS dashboard’u yapma: KPI kartları, ekip avatarları, bildirim zili, AI sohbet kutusu, şablon mağazası, dev gradient’ler ve çalışmayan süs düğmeleri ekleme.

Türkçe varsayılan metinleri kullan, İngilizce yerelleştirmeye uygun yapı kur. Sürüklemeyle yapılan işlemlere düğme/klavye alternatifi ekle. Odak görünürlüğü, dialog odak yönetimi, Escape, okunaklı kontrast ve azaltılmış hareket tercihini gözet. Klavye kısayolları metin/zaman alanlarına yazmayı engellemesin.

## 5. W0’da gerçekten çalışacak etkileşimler

**Dosya ve oynatma:** Kullanıcı yerel video seçebilsin. Gerçek süre/boyut ve erişilebilen diğer metadata okunsun. Oynat/durdur/zamanda gezin çalışsın. Dosya seçimi iptali, okunamayan dosya ve desteklenmeyen önizleme anlaşılır durumlarla ele alınsın. Kaynak dosyayı değiştirme.

**An seçimi:** Başlangıç/bitiş işaretleme ve sayısal zaman alanları olsun. Geçersiz, ters veya kaynak dışı aralıklar reddedilsin. Kullanıcı birden fazla an ekleyebilsin, düzenleyebilsin, kaldırabilsin ve sıralayabilsin. Kartlarda kaynak aralığı ve süre gösterilsin; toplam çıktı süresi gerçekten hesaplansın.

**Önizleme:** “Kaynak” ve “Sonuç” ayrımı görünür olsun. Basit sıralı sonuç önizlemesi uygula; gerçek dosyaya dönüştürülmüş çıktı veya kare hassasiyetinde render gibi sunma. Gerçekten destekleyemediğin önizleme davranışını açıkça belirt.

**Görüntü:** 9:16, 16:9 ve 1:1 oranları ile merkezden fit/fill davranışı önizlemede çalışsın. Dışa aktarmada kullanılacak aynı dönüşüm tarifini domain tarafında temsil et. Sadece dekoratif CSS değişimini tamamlanmış video işlemi sayma.

**Ses:** Kullanıcı kendi ses dosyasını seçebilsin; süre, kullanılacak başlangıç/bitiş, çıktıda başlangıç noktası ve ses seviyesi düzenlenebilsin. Kaynak ses ile harici müziğin kontrollerini ayır. Karışık ses önizlemesi uygulanmadıysa bunu açıkça yaz; iki sesi yalnızca başlatıp senkron/miks sorunu çözülmüş gibi raporlama.

**Düzenleme güveni:** Domain değişikliklerinde undo/redo çalışsın. Yerel kayıt henüz yoksa “Bu oturumda” gibi dürüst durum göster. “Kaydedildi”, “Yedeklendi” veya “Senkronize” ifadelerini gerçek kalıcılık olmadan kullanma. Yapılabiliyorsa kayıt olmayan iş için tarayıcının izin verdiği çıkış uyarısını ekle; mutlak kurtarma garantisi verme.

**Çıktı paneli:** Gerçek ayarlara bağlı dışa aktarma özeti göster. W0’da encode motoru bağlı olmadığı için dosya oluşturma kapalı ve açıklamalı olsun. Sahte yüzde, başarılı export bildirimi veya MP4 adı verilmiş sahte dosya üretme.

## 6. Altyazıya hazırlık — bu görevde AI entegrasyonu yok

Kısa bir tasarım notu ve bağımlılık sıralı backlog önerisi oluştur:
1. W1: gerçek kesim + görüntü + ses çıktısı.
2. Ardından tek manuel altyazı satırının gerçek videoya işlenmesi.
3. SRT/VTT, manuel altyazı düzenleme ve zaman eşleme.
4. Kontrollü beta aşamasında otomatik transkript.
5. Ardından Türkçe–İngilizce altyazı çevirisi.

Transkript ile görüntülenen altyazının ayrılacağı sınırı, kaynak/çıktı zaman eşlemesini ve sonradan eklenecek sağlayıcı adaptörünü açıkla. Kullanılmayan büyük bir AI framework’ü veya uygulanmamış sağlayıcı için yığınla interface üretme.

EDL v1’i sessizce değiştirme; gerekiyorsa geriye uyumlu şema genişletme önerisini ayrı not et. Araştırmadaki dakika hakları ve fiyatları canlı politika olarak uygulama. Çalışmayan altyazı düğmesini ana kullanıcı akışına koyma.

## 7. Güvenlik, kapsam ve doğruluk

Video, ses, thumbnail veya transkriptleri dış servislere gönderme. Ücretli API çağırma, yeni abonelik açma, production deploy yapma veya ödeme entegrasyonu başlatma. Temel editörü giriş yapmaya bağlama.

Dosya adlarını güvenli metin olarak göster. Kaynak koduna secret veya gerçek kullanıcı medyası koyma. Test medyası gerekirse yerel olarak oluşturulmuş ya da açıkça izinli fixture kullan; telifli içerik indirme veya bulunmayan dosyayı var sayma.

HTML prototipinin daha önceki test sonuçlarını yeni uygulamanın testi olarak kopyalama. Yapmadığın testi yapılmış, desteklenmeyen cihazı destekli veya hazırlanmış arayüzü tamamlanmış ürün olarak sunma.

## 8. Doğrulama, teslim ve durma noktası

Ortamda mümkün olan typecheck, lint, domain testleri, build ve tarayıcı etkileşim testlerini çalıştır. Repo için tekrar çalıştırılabilir komutlar bırak.

Özellikle şunları doğrula:
- Aralık sınırları, toplam süre ve kaynak/çıktı zaman eşlemesi.
- Ekle/sil/sırala, tekrar kullanılan kaynak bölümü ve undo/redo.
- Video/dosya değişimi ve kaynak temizliği.
- Boş, yükleniyor, hatalı dosya, ses yok ve export-unimplemented durumları.
- Klavyeyle temel işlemler ve dialog açma/kapatma.
- Uzun Türkçe dosya adları ve dar ekranda taşma.

Araçlar izin veriyorsa 1440×900, 1366×768, 1024×768 ve 390×844 ekran görüntüleri al. Yüzde 200 yakınlaştırmayı kontrol et. Araç yoksa NOT_RUN yaz; ekran görüntüsü veya test sonucu uydurma. Gerçek telefon testiyle responsive tarayıcı testini ayır.

Görev sonunda Türkçe raporla:
- Ne uygulandı ve uygulamayı nasıl başlatacağım?
- Gerçek başlangıç komutu, gereken ortam sürümleri ve uygulama açıldıysa adresi.
- Değişen önemli dosyalar ve bağımlılıklar.
- Çalıştırılan komutlar; PASS / FAIL / NOT_RUN sonuçları.
- Oluşturulduysa ekran görüntüsü yolları.
- Bilinen eksikler ve uygulanmayan özellikler.
- Bir sonraki tek görev: W1 gerçek web video çıktısı kanıtı.

Tamamlanamayan bir iş varsa yaptığın güvenli ilerlemeyi koru ve engeli açıkça yaz. W0 sonunda dur; W1’e, mobil uygulamalara, ücretli servislere veya bütün roadmap’e kendiliğinden geçme.

Şimdi depoyu incele, kısa planını paylaş ve W0 uygulamasını kodlamaya başla.
