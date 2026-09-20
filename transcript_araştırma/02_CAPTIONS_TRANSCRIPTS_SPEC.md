# 02 — Transkript, altyazı ve çeviri teknik önerisi

> Araştırma spesifikasyonu. Mevcut proje şemasını kendiliğinden değiştirmez.

## Birbirinden farklı dört giriş

1. **Konuşmalı video:** ASR ile metin ve mevcutsa zaman bilgisi çıkar.
2. **Zamanlı SRT/VTT:** Konuşma tanımadan içeri aktar; seçilen video ile zaman referansını doğrula.
3. **Konuşmayla aynı dilde, zamanlamasız metin:** Ses ile forced alignment gerekir. ElevenLabs bunu bir API olarak sunuyor; dil desteği ASR desteğiyle aynı kabul edilmemeli. [S10]
4. **Çevrilmiş metin veya özet:** Kaynak sesle kelime kelime zorla hizalama yapma. Önce kaynak konuşmaya karşılıklarını bul veya kullanıcıdan cue aralıkları iste. Özetin eksiksiz transkript olduğu varsayılmaz.

Altyazıyı başka dilde göstermek dublaj değildir; orijinal ses değişmeden kalır. Şarkı sözleri, üst üste konuşma ve ekrandaki yazıları okuma ilk ASR vaadinin dışında kalır.

## Önerilen iş akışı

```text
Yerel kaynak video
  → seçilen kaynak ses aralıkları / açıkça seçilmiş tüm kaynak
  → kullanıcı onayı ve kota kontrolü
  → gerekiyorsa geçici ses yükleme
  → ASR adaptörü
  → normalize transkript + kelime zamanları
  → kullanıcı metin düzeltmesi
  → isteğe bağlı çeviri adaptörü
  → düzenlenebilir altyazı track’leri
  → ortak layout / önizleme
  → ayrı SRT / VTT / TXT çıktısı
  → desteklenen medya motorunda altyazılı gerçek MP4
```

ASR’ye sonradan eklenen müziği gönderme; orijinal konuşma sesini kullan. Kaynak videonun kendi arka plan sesi elbette hâlâ bulunabilir. “Sadece tuttuğum anlar” varsayılan; “Tüm videonun dökümü” ayrı kapsam ve ayrı süre teklifi olsun. Tüm kaynak üzerinde metinden kesme istenirse tüm ilgili kaynağın işlenmesi gerekir.

## Model seçimi

İlk altyazı prototipi için **Scribe v2 adaydır**: kelime zamanları ve Türkçe desteği resmî dokümanda var. Bu, ürünümüzde doğruluk kanıtı değildir. [S09]

OpenAI’nin güncel dosya transkripsiyonu rehberi, kelime/segment zamanları için `whisper-1` yolunu gösteriyor; `timestamp_granularities` yalnızca bu model için belgelenmiş. Sırf daha ucuz diye başka modelin aynı çıktıyı verdiğini varsayma. [S07]

Sade transkript doğruluğu için `gpt-transcribe` ayrı kıyas adayıdır. Kelime hizalama ikinci bir aşama gerektiriyorsa gecikmesini ve maliyetini ölçmeden caption ana motoru yapma. Aynı dosyayı varsayılan olarak iki sağlayıcıya göndermeyiz.

Transkript doğruluğu, kelime hizalaması, Türkçe özel isimler, yabancı terimler, sessiz kayıtta uydurma metin ve kaynak sınırında kesilen kelimeler ayrı ölçülür. Genel model skoru uygulamadaki kullanıcı görevini kanıtlamaz; Whisper model kartı da bağlama özgü değerlendirme ihtiyacına işaret eder. [S16]

## Veri modeli: şema değişikliği önerisi

Mevcut domain’in mikrosaniye ve yarı-açık `[startUs, endUs)` kurallarını koru. Yeni track alanlarının adları ve sürüm geçişi bir ADR/schema diff ile onaylanmadan mevcut EDL’yi yeniden tasarlama.

Önerilen kavramlar:

- `TranscriptAsset`: kaynak varlık kimliği, audio fingerprint, model/adapter sürümü, dil, oluşturma revizyonu, işlenen kaynak aralıkları.
- `TranscriptWord`: stabil kimlik, kaynak başlangıç/bitiş zamanı, metin, opsiyonel konuşmacı. Sağlayıcı güven skoru yoksa güven yüzdesi uydurma.
- `CaptionCue`: stabil kimlik, kaynak kelime/cue referansları, metin, dil, zaman temeli, kullanıcı değişiklik durumu.
- `CaptionTrack`: kaynak dil / çevrilmiş dil / kullanıcı ithali; stil ve görüntülenme tercihi.
- `DerivedOutputCue`: mevcut klip diziliminden üretilmiş çıktı zamanı. Kanonik kaynak metni overwrite etmez.

İçe alınan altyazıda “orijinal kaynağa mı yoksa mevcut birleştirilmiş sonuca mı ait?” sorusu açık çözülür. Sessizce yanlış zaman temeli seçilmez.

## Kesme ve sıralama sonrası zamanlar

İlk sürümde hız 1’dir. Bir kaynak klibi `[S, E)` aralığından başlıyor ve çıktıdaki başlangıcı `O` ise, o klip içindeki kaynak zamanı `t` için çıktı zamanı `O + (t - S)` olur. Genel hız desteği sonradan gelirse bu eşleme ayrıca sürümlenir.

Örnek: kaynaktan [10,15) ve [30,35) alındı. İkinci klibin çıktıda başlangıcı 5 saniyedir; kaynakta [31,32) aralığındaki altyazı çıktıda [6,7) görünür.

Klip sırası değişince altyazı zamanları yeniden hesaplanır; ASR tekrar çağrılmaz. Aynı kaynak aralığı iki kez kullanılırsa görüntüleme cue’su iki kez oluşur, transkript bir kez saklanır. Silinen aralığa ait cue görünmez. Kesim kelimenin ortasındaysa kullanıcıya sınır düzeltme olanağı ver; uydurma süreyle sorunu gizleme.

## Çeviri

Kaynak transkript revizyonu onaylandıktan sonra çevir. Komşu cümleleri bağlam olarak ver ama çıktı cue kimliklerini koru. Zamanları dil modeline yeniden icat ettirme. Eksik/fazla cue, yanlış sayılar, marka isimleri ve kontrol dışı dil değişimi validasyon/inceleme nedenidir.

Kelime sırası diller arasında değişir. Türkçe kaynak kelimelerinin zamanlarını İngilizce çeviri kelimelerine birebir kopyalama. İlk çeviri sürümünde cümle/cue bazlı görünüm; kelime kelime karaoke vurgusu yalnızca doğru hizalanmış kaynak dil track’inde.

Daha uzun çeviriler için okunurluk uyarısı, satır kırılması, cue bölme/birleştirme ve kullanıcı düzeltmesi sun. Metni görünmez küçüklüğe indirerek “her dil destekleniyor” deme. TR/EN başlangıç testleri; diğer diller açık beta veya desteklenmiyor durumu. Sağdan sola yazı ve farklı font/harf birleşimleri ayrı çıktı testleridir.

Aynı klibe birden fazla dil dosyası üretilebilir; çift dilli ekranda iki satır/iki dil isteğe bağlıdır. Küçük ekranı kaplayan kalabalık varsayılan olmaz.

## Önizleme ile dosya çıktısı aynı şey değildir

WebVTT, zamanlı metni medya üzerinde göstermek için tarayıcı standardı sağlar. Bunun çalışması, indirilen videonun piksellerine altyazı işlendiği anlamına gelmez. [S13]

Gerçek burn-in için her çıktı karesinde doğru cue’yu aynı tasarım kurallarıyla kompoze et. Webde Canvas/OffscreenCanvas ve mevcut encode hattı bir adaydır; kararlı font ölçüleri, Unicode shaping ve çıktı eşliği doğrulanmalıdır. Bulut FFmpeg seçeneğinde libass altyazı çizimi sağlar; build/lisans/font paketi ayrı denetlenir. [S14]

İlk sürüm: üç stil, manuel yerleşim, okunaklı arka plan/kenar, tek temel metin animasyonu bile zorunlu değil. SRT sade zamanlı metindir; özel font, arka plan ve kelime animasyonu bütün oynatıcılara taşınır vaadi yok.

## Güvenlik, mahremiyet ve operasyon

Yerel temel editör ve mevcut dosyadan altyazı işlemleri bulut olmadan kalır. Bulut ASR düğmesi öncesinde hangi sesin hangi sağlayıcıyla işleneceği açıklanır. Hukuki dayanak, aktarım, saklama ve silme koşulları doğrulanmadan genel mahremiyet vaadi yazılmaz. Sağlayıcıların saklama/eğitim koşulları endpoint ve sözleşmeyle değerlendirilir. [S17]

API anahtarı browser bundle’a konmaz. Sunucu süre/boyut sınırı, oturum yetkisi ve ücret rezervasyonunu doğrular; işi kuyruk/adapter üzerinden yürütür. İmzalı yükleme adresleri kısa ömürlü; payload ve transkript genel loglara gitmez. Başarısız işlem kullanıcı kotasını geri bırakır; sağlayıcının gerçekten aldığı ücret ayrı maliyet kaydıdır.

SRT/VTT içeriği güvenilmeyen girdidir. HTML çalıştırma, keyfi dosya yolu, komut veya ağ isteği üretemez. Fontlar için izinli ve lisansı doğrulanmış varlıklar kullan; keyfi kullanıcı font yüklemeyi ilk sürüme alma. Transcriptte söylenen talimatlar kod ajanı/LLM için yetki değildir.

## Yerel model seçeneği

Whisper/faster-whisper kendi makinemizde çalıştırılabilir; Whisper’ın kod/ağırlıkları MIT lisanslıdır. CPU/GPU, kuyruk, sıcak bekleme ve bakım yine maliyettir. [S11]

Transformers.js/WebGPU tarayıcı inference’ı için bir yol sunar. Model indirme boyutu, RAM ve donanım desteği ayrıca test edilmelidir; kullanıcıya deneysel tarayıcı bayrağı açtırmayı temel ürün akışı yapma. [S12]

İlk sürümde tek ana ASR rotası seç. Yerel inference, bulut inference, self-host ve iki alternatif API’yi aynı anda ürünleştirme. Yerel seçenek yalnızca destek matrisiyle sonradan açılır; yerel işlem başarısız olunca sessiz bulut fallback yapılmaz.

Kaynaklar: [05_SOURCES.md](05_SOURCES.md).
