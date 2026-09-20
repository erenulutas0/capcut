# ADR-011 — W2: dosya matrisi, tarayıcı testleri ve destek sınırları

> Tarih: 2026-09-21 · Durum: UYGULANDI ve ÖLÇÜLDÜ
> Sonuçlar: [`docs/SUPPORT_MATRIX.md`](../SUPPORT_MATRIX.md) (üretilen dosya)

## Bağlam

W1 tek bir sentetik dosyayla gerçek MP4 üretebildiğimizi kanıtladı. Açık kalan
soru şuydu: **bu, gerçek dosya çeşitliliğinde ve başka tarayıcılarda da doğru
mu?** Doc 22 bunun için M01–M16 fixture listesini tanımlıyor; W2 o listeyi
gerçek dosyalarla ve gerçek tarayıcılarda çalıştırmakla ilgilidir.

## Karar 1 — Fixture'lar üretilir, indirilmez

`scripts/generate-matrix-media.mjs` bütün matrisi ffmpeg ile yerelde üretir:
dikey/yatay kaynak, 90° display matrix, sessiz video, 44.1 kHz müzik, VFR,
29.97 fps, 4K HEVC, HDR10, truncated MP4 ve 250 MiB üstü dosya. Telifli içerik
indirilmez, gerçek kullanıcı medyası kullanılmaz.

Dosyalar repoya **alınmaz** (toplamda yarım GB'ı aşıyor); komutla yeniden
üretilir ve `manifest.json` ile kaydedilir.

Ölçüm için tonlar bilinçli seçildi: kaynak videolarda 440 Hz, müzikte 220 Hz,
WAV müzikte 330 Hz, sınır testinde 880 Hz. Böylece çıkan dosyada hangi sesin
mikse girdiği bant ölçümüyle ayırt edilebiliyor.

## Karar 2 — Her satır uygulamayı gerçekten sürer, sonra bağımsız ölçülür

`scripts/run-matrix.mjs` her vaka için gerçek editörü açar, dosyayı seçer,
anları ekler, çerçeveyi ve müziği ayarlar, export eder, dosyayı indirir ve
**ffprobe/ffmpeg** ile ölçer. Görüntü doğruluğu için aynı kesim ffmpeg ile
ayrıca kurulup SSIM karşılaştırması yapılır.

Sonuçlar `matrix-results/matrix-<tarayıcı>.json` dosyalarına yazılır;
`scripts/build-support-matrix.mjs` destek matrisini yalnızca bu dosyalardan
üretir. Destek matrisi elle yazılmaz.

## Karar 3 — Dört ayrı sonuç durumu

| Durum | Anlamı |
|---|---|
| PASS | Beklenen davranış ölçümle doğrulandı |
| UNSUPPORTED | Tarayıcıda encoder yok; uygulama **açıkça reddetti** |
| FAIL | Beklenen davranış gerçekleşmedi |
| NOT_RUN | Bu ortamda çalıştırılamadı, gerekçesiyle |

`UNSUPPORTED`, `FAIL`'den ayrıldı çünkü ikisi farklı şeyler: Firefox'ta AAC
encode yok ve uygulamanın doğru davranışı reddetmektir. Bu ayrımın kötüye
kullanılmaması için `UNSUPPORTED` yalnızca **uygunluk kapısı ilgili aşamanın
geçmediğini kendisi raporladığında** ve sahte başarı gösterilmediği
doğrulandığında verilir.

## Karar 4 — HDR kaynağı artık açıkça reddediliyor

Doğrulanmış bir HDR→SDR tone mapping hattımız yok. W1'e kadar HDR bir dosya
sessizce yanlış renklerle işlenebilirdi. Artık uygunluk kapısı kaynağın
transfer fonksiyonunu okuyor; PQ veya HLG ise `hdr_source_unsupported` ile
reddediyor (doc 09: "Doğrulanmış tone mapping hattı yoksa anlaşılır biçimde
reddet").

Test için HDR fixture'ı **H.264** olarak da üretildi: HEVC dosyalar zaten
içe aktarmada reddedildiği için HDR kapısına hiç ulaşmıyordu.

## W2'de bulunan gerçek hatalar

1. **`checkCapability` zaman aşımsızdı.** Worker modülü yüklenemeyip `error`
   olayı da tetiklenmezse dialog sonsuza kadar "kontrol ediliyor" durumunda
   kalırdı. 60 saniyelik zaman aşımı eklendi; süre dolarsa worker kapatılıp
   `worker_unavailable` ile dürüst bir ret üretiliyor.
2. **HDR sessizce işleniyordu** (yukarıda).

Matris koşusundaki üç "başarısızlık" ise üründe değil **ölçüm yönteminde**
çıktı ve düzeltildi. Kayda değer, çünkü aynı hatayı tekrar yapmamak gerekiyor:

- Bir bandpass filtresinin kenar geçirgenliği sonsuz değildir. 330 Hz'lik saf
  bir ton, 440 Hz bandında yaklaşık 20 dB aşağıda görünür. "440 Hz yok"
  iddiası mutlak eşikle değil, diğer tona göre kurulmalıydı.
- 220 Hz ile 239.5 Hz arasındaki farkı ölçmek için 25 Hz genişliğinde filtre
  kullanılamaz; genişlik 4 Hz'e indirildiğinde marj 4.7 dB'den 19 dB'ye çıktı.
- Müziğin 2. saniyeden önce sessiz olduğunu ölçerken 25 dB daha gürültülü
  kaynak tonu önce notch ile çıkarılmalıydı; çıkarılınca marj 10.8 dB yerine
  33 dB oldu.

Ayrıca runner'ın ilk sürümü `Promise.race` ile "önizleme mi hata mı" beklediği
için kararsızdı (yakalanan bir reddetme de yarışı bitiriyor). Sayım tabanlı
bekleme ile değiştirildi; yayımlanan bir matrisin kararsız bir sürücüden
çıkması kabul edilemez.

## Ölçülen sonuç

Chromium 153, Chrome 153, Edge 153: **16 PASS, 0 FAIL**.
Firefox 155: **4 PASS, 12 UNSUPPORTED, 0 FAIL** — H.264 encode var, AAC encode
yok; uygulama her seferinde açıkça reddetti ve hiçbir zaman sahte başarı
göstermedi. Bu, doc 11'deki "H.264 var, AAC yoksa export destekli denmez"
kuralının gerçek bir tarayıcıda doğrulanmasıdır.

Playwright'ın WebKit derlemesi (Windows) temel H.264 fixture'ını bile
açamadığı için matris orada **çalıştırılamadı**; 17 satır NOT_RUN olarak
kaydedildi. Bu derleme Safari değildir ve Safari sonucu yerine geçmez.

Uzun çıktı (Chromium): 10 / 30 / 60 / 120 / 180 saniyelik çıktılar sorunsuz
tamamlandı, kare sayıları tam (300 / 900 / 1800 / 3600 / 5400) ve hız gerçek
zamanın 4.5–5.1 katı.

## Ölçülemeyen: bellek tavanı

`performance.memory` Chromium'da gizlilik için kabaca yuvarlanıyor; bütün
koşularda aynı değeri verdiği için bundan bellek tavanı çıkarılamaz. Ayrıca
fixture sentetik bir test deseni olduğundan encoder hedef bitrate'in çok
altında kaldı (180 s çıktı yalnızca 4.4 MB). Gerçek kamera görüntüsünde dosya
boyutu ve dolayısıyla bellek kullanımı belirgin şekilde yüksek olacaktır.

Bu yüzden `BufferTarget` → `StreamTarget` geçişi **yapılmadı**: elimizde onu
gerektirdiğini gösteren bir ölçüm yok ve ölçmeden mimari değiştirmek W2'nin
amacına aykırı olurdu. 5 dakikalık politika sınırı yürürlükte kalıyor.

## Sonraki tek görev

**W3 — gerçek kullanıcı medyası ve kalıcılık:** gerçek telefon/kamera
kayıtlarıyla matrisi tekrarlamak (gerçek VFR, rotation, HEVC, 4K), buradan
çıkacak bellek ölçümüyle `StreamTarget` kararını vermek ve projenin sekme
kapanınca kaybolmaması için yerel kaydı (IndexedDB + re-link) uygulamak —
bu aynı zamanda M14'ü çalıştırılabilir hale getirir.
