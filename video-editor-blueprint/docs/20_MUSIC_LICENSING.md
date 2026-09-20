# 20 — Müzik, Medya Hakları ve Lisans Operasyonu

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## İlk sürüm kararı

Kullanıcı kendi yerel ses dosyasını seçer; ürünün demosunda yalnızca bize ait, açıkça uygun lisanslı veya bizim için üretilmiş ses kullanılır. Spotify/Apple Music/YouTube kataloğu entegrasyonu ve popüler şarkı indirme ilk kapsamda yoktur.

Spotify'ın geliştirici politikası, kayıtların görsel medya ile senkronizasyonunu uygulama üzerinden genel olarak serbest bırakmaz. Bir streaming aboneliği veya API erişimi, videoya müzik koymak için senkronizasyon lisansı anlamına gelmez. [S33](35_SOURCES.md#s33)

Kullanıcının MP3'e sahip olması da her türlü yayın/ticari kullanım hakkını kanıtlamaz. Bu belge telif konusunda ülke özelinde hukuki görüş değildir; ürünün hak kazanmadığı şeyleri vaat etmesini önler.

## Kullanıcıya sunulacak açıklama

> Kendi ses dosyanı ekleyebilirsin. Videonda ve paylaşacağın platformda bu müziği kullanmak için gerekli haklara sahip olduğundan emin ol. Bir dosyayı yükleyebilmen, o dosyanın her kullanım için lisanslı olduğu anlamına gelmez.

Bu metin kullanıcıyı her ekranda korkutan uzun bir engel olarak değil, müzik seçimi ve yardım bölümünde açık bilgi olarak kullanılır. “Her şarkıyı telifsiz kullan”, “copyright sorunu olmaz” gibi vaat yoktur. Platformun paylaşımı sessize alması/engellemesi halinde lisans sağlanmış gibi destek yanıtı verilmez.

## Uygulama içine müzik kataloğu ekleme şartları

Stock/royalty-free, haklardan tamamen bağımsız demek değildir. Sözleşmede uygulama içinde yeniden dağıtım, son kullanıcıya senkronizasyon kullanım hakkı, ticari/social platform kullanımı, ülke/süre, attribution, indirebilir dosya, subscription sona erince önceki çıktının hak durumu ve Content ID ihtilaf desteği netleşmeli.

“Siteden indirilebiliyor” veya “YouTube'da kullanabiliyorum” gerekçesiyle o parçayı bütün müşterilere dağıtan bir kütüphane oluşturma. İlgili eser ve ses kaydı hakları farklı sahiplerde olabilir; gerçek lisans zinciri uzman tarafından incelenir.

## Lisans sicili

Her demo/stock varlık için `asset_id`, eser/ses kaydı sahibi, kaynak URL, lisans belgesi/sürümü, edinim tarihi, izin verilen kullanım, dağıtım hakkı, attribution metni, ülke/süre, iptal/itiraz kişisi saklanır. Satın alma makbuzu lisans kapsamı açıklamasının yerine geçmez.

Marketing videolarındaki müzik, font, görüntü, kişinin yüzü ve şirket logosu da bu kontrole girer. Kullanıcının videosunu “ürün demosu” diye izin almadan sosyal medyada paylaşma. Ürün geri bildirimi vermek kamuya açık referans izni değildir.

## Yerel içerik ve bulut içerik ayrımı

Yerel editörde özel dosyalar otomatik incelenmez veya moderasyon amacıyla sunucuya gönderilmez. Bulutta gizlilik ve kötüye kullanım yükümlülükleri ayrıca vardır; ürün sosyal feed olmaması bütün yükümlülükleri yok etmez. Hak sahibi bildirimi için geçerli iletişim kanalı ve kimlik/doğruluk kontrolü içeren süreç hazırlanır.

Şikâyette ilgili cloud erişimi geçici kısıtlanabilir; kullanıcıya uygun bildirim ve itiraz yolu değerlendirilir. Kalıcı saklama/takip ancak uygun hukuki çerçevede. Otomatik “her şikâyet doğru” veya “hiçbir talebi işlemeyiz” politikası yoktur.

## Kabul kapısı

İlk yayın için demo dosyalarının lisansları, kullanıcı müzik açıklaması, private cloud erişimi ve bildirim yolu yeterli seviyede tamamlanır. Katalog satışı için ayrıca gerçek dağıtım/senkronizasyon lisansı imzalanır. Bu pakette böyle bir lisans edinilmiş değildir.
