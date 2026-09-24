# 11 — Web Editörü ve Tarayıcı Uygunluk Stratejisi

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Kapsam

Web sürümü telefon uygulamasının sadece landing page'i değildir; desteklenen masaüstü tarayıcıda gerçek yerel düzenleme ve çıktı vermeyi hedefler. Bununla birlikte her tarayıcı/telefon/dosya için eşdeğer export desteği vaat edilmez. Mobil web ilk etapta örnek deneme/uyumluluk kontrollü beta olabilir; desteklenmeyene uygulama veya P3 açık bulut rotası sunulur.

## Uygulama ayrımı

Next.js pazarlama, yardım, fiyatlandırma ve SEO sayfalarını sunar. Editör client-only modüldür; sunucu render'ı içinde `File`, `VideoEncoder`, browser storage ve medya bağımlılıklarına erişilmez. Ağır medya paketleri route bazında lazy yüklenir. Landing page yükleme maliyetine full encoder eklenmez.

Domain ve komut modeli React'ten bağımsız TypeScript modülüdür. UI state: seçili kart, panel açıklığı, playback state; domain state: EDL ve undo/redo. Her video kare güncellemesi bütün React ağacını yeniden render etmemeli.

## Capability gate

Mediabunny üzerinden demux/mux ve WebCodecs kullanımı adaydır. Kütüphanenin bir container'ı okuyabilmesi, cihazın o codec'i encode edebildiğini garanti etmez; resmi rehber de codec kullanılabilirliğinin ortama göre değiştiğini belirtir. [S09](35_SOURCES.md#s09) [S10](35_SOURCES.md#s10)

Aşama A: HTTPS/Worker/storage ve gerekli API'leri kontrol et. Aşama B: gerçek codec/config ile decode/encode destek sorgusu. Aşama C: seçilen output ayarında küçük sentetik video+ses render edip dosyayı yeniden aç. Aşama D: gerçek dosyanın baş/orta/son probe ve örnek decode işlemi. Aşama E: yalnızca matrisi geçen rotayı sun.

H.264 encode var, AAC encode yoksa “export destekli” denmez. Ayrı AAC encoder uzantısı düşünülecekse boyut/lisans/performans ayrıca değerlendirilir; sessizce paket eklenmez. Sadece videoyu sessiz çıkarmak kullanıcı talebinin karşılığı değildir.

## Worker ve bellek

Demux/decode/transform/encode mümkün olan kısımlarda worker'da çalışır. Transfer edilebilir nesneler doğru aktarılır; VideoFrame/AudioData yaşam döngüleri kapanır. Tüm File'ı `arrayBuffer()` ile belleğe almak başlangıç tasarımı değildir. Bounded queue ve backpressure zorunludur.

OffscreenCanvas veya worker encoder kabiliyeti olmayan ortam ayrı sonuç verir. Fallback performansı ölçülmeden destek listesine alınmaz. SharedArrayBuffer gerektiren opsiyonel bileşen varsa cross-origin isolation, üçüncü taraf script ve checkout etkileri ayrı ADR ister.

P0 sonrası test edilmiş limit yükseltilene kadar web yerel işlerde **tüm planlarda 4 GiB toplam kaynak (video ve müzik birlikte), 120 dakika toplam video girdi süresi, 60 dakika çıktı** (politika `2026-09-24.v6`) başlangıç koruması vardır. Girdi sınırına sığan video zaman çizgisine her zaman tek parça olarak gelir; çıktı sınırı tarifin kuralı değil, indirmenin kapısıdır: sonuç sınırdan uzunsa kullanıcı böler ve siler, "Videoyu indir" kodlamadan önce sonucun ne kadar uzun olduğunu ve en az ne kadar silinmesi gerektiğini söyler (ADR-021). 4 GiB sınırı 2 GiB ve 4 GiB byte ofsetlerini geçen dosyalarla Chrome, Edge ve Chromium'da ölçüldü (ADR-025); arayüz sınırı ve dosya boyutlarını kontrolün birimiyle (GiB) söyler. Çıktı sınırı yola bağlıdır: 60 dakika yalnızca çıktı dosyası tarayıcının özel diskine (OPFS) akıtılabildiğinde geçerlidir; tarayıcı diske yazamıyor ve dosya bellekte tutulmak zorundaysa çıktı en fazla **5 dakika**dır ve daha uzun bir çıktı kodlama başlamadan açık bir mesajla reddedilir (ADR-013, ADR-020). Depolama tahmini dosyaya yetmiyorsa da uzun çıktı baştan reddedilir. Bir abonelik tarayıcının bellek/codec sınırını ortadan kaldırmaz. Sayılar kanonik [politika belgesinde](15_PRICING_FREE_PRO.md) bulunur.

## Önizleme

Master output time, hangi kaynak klibin oynadığını ve sesin konumunu belirler. Hızlı seek'lerde istekler birleştirilir; eski decode sonucu yeni seçimi ezmez. HTML video preview kullanılıyorsa crop/gain/zaman hesabı export sözleşmesiyle aynı olmalı; yalnızca güzel görünen farklı bir preview sistemi kurulmaz.

Klip sınırında görülen kısa bekleme, final videoya girecek boşlukmuş gibi modellenmez. UI buffering ile EDL gap ayrı durumdur. Kaynak ilk yüklenirken playback promise reddi ve autoplay sınırlaması yakalanır.

## Yerel saklama

EDL ve küçük metadata IndexedDB'de; büyük geçici medya OPFS veya uygun storage adaptöründe, mevcutsa ve test edilmişse. Blob URL sadece oturumluk handle'dır, kalıcı proje alanı değildir. Browser storage temizlenebilir/evict edilebilir; “bulut yedekli” izlenimi verilmez.

Dosya handle'ına yeniden izin gerekebilir. Kaynak eksikse EDL kalır ve kullanıcıdan dosyayı yeniden seçmesi istenir. Boyut/süre/yerel fingerprint kontrolüyle yanlış eşleşme önlenir; farklı dosya yeni kaynak olarak eklenir. Private browsing ve düşük storage olumsuz testlerdir.

## Gizlilik ve dağıtım

Editör route'unda session replay/ekran görüntüsü yakalayan analitik yok. CSP, dependency locking, private source map, veri maskeleme ve minimum üçüncü taraf script hedeflenir. Pazarlama cookie/analitik izni ayrı ele alınır. Videoyu “yükle” yerine “seç” demek, dosyanın yerelde kaldığı akışta daha doğru olabilir.

Büyük video Next.js API route/serverless request üzerinden geçirilmez. P3 upload yalnızca kısa ömürlü yetkili URL üzerinden ve açık kullanıcı seçimiyle olur. Bulut fallback ayrı bir opt-in ekranıdır.

## Kabul kanıtı

Güncel masaüstü Chrome/Edge/Safari/Firefox kombinasyonları listelenir; her biri için sürüm/OS/donanım/codec ve test sonucu kayıtlıdır. “Son iki sürüm” destek hedefi olabilir, tek başına test kanıtı değildir. Desteklenmeyen browser için bütün işlevleri açık gösterip export'ta kaybettirme.

Web local-first başarısız olursa ürünün web ayağı iptal olmak zorunda değildir; dar dosya matrisi veya açık ücret/kota kontrollü cloud modeli ayrı ADR ile değerlendirilebilir. Bu alternatif otomatik devreye alınmaz.
