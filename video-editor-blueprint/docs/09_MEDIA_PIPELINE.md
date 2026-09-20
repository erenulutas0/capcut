# 09 — Medya Hattı, Zamanlama ve Doğru Çıktı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Amaç ve kapsam

Aynı düzenleme tarifinin Android, iOS ve desteklenen web ortamında anlam bakımından aynı sonucu vermesi. Dosyaların byte-byte aynı olması hedeflenmez; encoder ve platform farklılıkları nedeniyle görüntü/ses sonuçları ölçülebilir toleransla karşılaştırılır. İlk ürün standardı SDR MP4/H.264/AAC, 720p veya 1080p, 30 fps çıktıdır.

Android Transformer donanım codec'lerine dayanan düzenleme altyapısı sağlar; gerçek giriş/çıkış ve HDR kabiliyeti cihazla değişebilir. iOS tarafında composition, transform ve audio mix kavramları kullanılır; referans verilen eski Apple rehberi kavramsaldır, güncel API imzaları kodlama sırasında doğrulanır. [S01](35_SOURCES.md#s01) [S02](35_SOURCES.md#s02) [S04](35_SOURCES.md#s04)

## Hattın safhaları

**1. Kaynak edinme:** OS seçicisinden izinli dosya erişimi; kalıcı erişim mümkün değilse açık davranışla uygulamanın özel alanına kopya. URI/path platform adaptöründe kalır. Hatalı uzantı veya MIME tek doğrulama değildir.

**2. Probe:** Container, codec, profil/level, gerçek süre, çözünürlük, rotation/display matrix, piksel oranı, fps bilgisi, renk/HDR metadata'sı, ses kanalı ve sample rate okunur. VFR işareti ve PTS davranışı tanınır. Cloud probe sunucuda tekrarlanır.

**3. Kabul kontrolü:** Dosya türü, politika limiti, encoder/decode kabiliyeti, gerekli boş disk ve app durumunu denetle. Kullanıcı saatlerce düzenledikten sonra ilk defa uyumsuzluk öğrenmemeli.

**4. Hafif önizleme varlıkları:** Seyrek thumbnail ve gerekirse düşük çözünürlüklü dalga biçimi; CPU/bellek bütçesiyle arka planda. Thumbnail üretilememesi projeyi yok etmez. Bunlar varsayılan olarak yerelde kalır.

**5. Tarif düzenleme:** EDL değişir; her değişiklikte yeniden full video encode edilmez. UI komutları undo/redo geçmişine yazılır; otomatik kayıt ayrı seri iş kuyruğuyla yapılır.

**6. Render planı derleme:** EDL doğrulanır; kaynak rotasyonu, seçilen aralıklar, çıktı boyutu, crop, audio offset ve güvenli gain planı deterministik hale getirilir.

**7. Render ve finalize:** Decode → dönüşüm → encode → mux → çıktı probe → son dosya. Geçici dosya başarıdan önce kullanıcı dosyasıymış gibi sunulmaz. Atomic rename mümkünse kullanılır; farklı dosya sistemine kopya gerekiyorsa tamamlanma doğrulanır.

**8. Kullanıcıya teslim:** Sistem galeri/dosya kaydetme akışı veya web download. Başarı olayı ancak geçerli çıktı erişilebilir olduğunda üretilir. Kaydetme reddi ile render başarısızlığı ayrı olaydır.

## Zaman modeli

Tarif integer mikrosaniye kullanır; klipler `[sourceInUs, sourceOutUs)` aralığıdır. `out > in`, aralık kaynak süresinin içinde, her klip en az 100.000 µs olmalıdır. Bu minimum ürün kararıdır; codec'in fiziksel sınırı olduğu iddia edilmez. Geçiş/speed olmadığı için çıktı süresi klip süreleri toplamıdır.

Kaynak PTS değerleri korunarak seçilir; `frameIndex / roundedFPS` ile süre hesaplanmaz. VFR, 29.97/59.94 gibi rasyonel kaynak hızları, edit list ve AAC başlangıç gecikmeleri fixture'larla kontrol edilir. Sınırlar örnek/kare ızgarasına yalnızca render aşamasında ve belgelenen yuvarlamayla eşlenir; UI tarifini sessizce değiştirme.

İlk sürüm tam encode yolunu esas alır. Keyframe dışından keserken salt container copy'nin tam hassasiyet sağladığını varsayma. “Lossless trim” ve “orijinal kalitede sıfır kayıp” pazarlama vaadi yoktur. Copy/transmux optimizasyonu daha sonra ayrı kalite kanıtıyla eklenebilir.

## Crop ve orientation

Kaynak rotation/display transform'u bir kez uygulanır; normalize crop koordinatları bundan sonra görünen dik görüntü üzerindedir. Çıktıda dönüşüm piksellere işlenir; aynı rotasyon metadata'sı ikinci kez bırakılmaz.

`cover` seçili görünüm alanını çerçeveye doldurur; `contain` tüm görünüm alanını boşlukla sığdırır. Örnek arayüz crop'u hedef orana yönlendirir, fakat son `cover` hesabı preview ve export'ta aynı derleyiciden gelir. Encoder boyutları çift sayıya normalize edilir. Ön/arka kamera aynalama metadata'sı test edilir; kullanıcı komutu olmadan rastgele flip yapılmaz.

9:16 1080p → 1080×1920; 16:9 → 1920×1080; 1:1 → 1080×1080. 720p varyantları karşılık gelen kısa kenar boyutuna dayanır. Çözünürlük yükseltmek kaynakta yeni ayrıntı yaratıyor diye sunulmaz.

## Ses semantiği

Kaynak klip sesi ile tek harici müzik parçası vardır. Her klipte `sourceGainDb`; müzikte kaynak in/out, timeline başlangıcı, gain, fade in/out saklanır. Müzik kaynak in noktası çıktı timeline'ının sıfırı değildir: `musicSourceTime = sourceIn + (outputTime - timelineStart)` yalnızca geçerli aralıkta uygulanır.

Önizleme ve render ortak master timeline kullanır. Kullanıcı seek yaptığında hem video hem müzik yeniden konumlanır; sadece video player'ı seek edip eski şarkıyı yürütme. Farklı sample rate'ler açıkça ortak çıkış sample rate'ine çevrilir. Başlangıç önerisi stereo AAC/48 kHz'dir; desteklenen ayar capability testinden geçmelidir.

İlk gain aralığı mute veya −60…0 dB. İki sesin toplamı taşmasın diye derleyici en yüksek eşzamanlı lineer gain toplamını hesaplar; gerekirse her ikisine ortak sabit headroom indirimi uygular. Önerilen formül `safetyGain = 10^(-1/20) / max(1, maxConcurrentGainSum)`; arayüzde “Karışım için ses güvenliği uygulanıyor” bilgisi verilir. Bu öneri gerçek codec sonrası true-peak veya profesyonel loudness normalizasyonu garantisi değildir; çıktı clipping testleri yine yapılır. Ayrı LUFS normalizasyonu ilk sürümde yoktur.

Fade'ler müzik klibinin kendi geçerli aralığına göre uygulanır; toplam fade süresi klip süresini aşarsa validasyon reddeder. Kısa müzik kendiliğinden loop olmaz. Sesiz video için sahte ses kaynağı uydurulmaz; muxer'ın beklediği çıktı ses davranışı sabit test edilir.

## HDR ve codec stratejisi

P0: SDR H.264 girişler ve seçilmiş ses formatları. HEVC/HDR/Dolby Vision örnekleri özellikle negatif test setine eklenir. Destek “oynuyor” sonucuyla açılmaz; render sonrası renk kontrolü gerekir. Doğrulanmış tone mapping hattı yoksa anlaşılır biçimde reddet. “HDR → SDR her cihazda otomatik” sözü verilmez. [S02](35_SOURCES.md#s02)

## Kaynak bütçesi ve iptal

Decode kuyruğu sınırlı, frames kapatılıyor, backpressure aktif olmalı. Tüm video veya bütün PCM aynı anda belleğe alınmaz. Native ve webde bir kullanıcı için ilk etapta bir aktif encode; Pro batch sıralıdır. İptal sinyali worker/encoder'a taşınır, geçici çıktı temizlenir; EDL ve kaynak korunur.

Kapanmış uygulama sonrası encode'u gerçek checkpoint olmadan “devam ettirme” denmez. Tarif kurtarılır ve render yeniden başlatılır. Süre tahmini ölçülmeden sabit “10 saniyede hazır” mesajı yoktur.

## Çıkış kanıtı

Test çıktısı yeniden probe edilir; beklenen süre, boyut, frame timestamps ve audio stream doğrulanır. Görüntüde referans kareler, seste işaret darbeleri ve senkron sinyalleri kullanılır. Hedef toleranslar [QA belgesindedir](22_QA_TEST_MATRIX.md). UI tamamlandı ekranı tek başına bu hattın çalıştığına kanıt değildir.
