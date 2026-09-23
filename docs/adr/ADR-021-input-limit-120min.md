# ADR-021 — Web girdi sınırı 120 dakika; çıktı sınırı indirmenin kapısı (politika `2026-09-23.v4`)

> Tarih: 2026-09-23 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine; Chromium, Chrome ve
> Edge; sentetik kaynak). [ADR-019](ADR-019-single-timeline-editing.md)'un "çıktı
> sınırından uzun video" satırını değiştirir. [ADR-020](ADR-020-output-limit-60min.md)'nin
> ölçüm yöntemini kullanır.

## Bağlam

Kurucu, web yerel **girdi** sınırını (toplam video kaynak süresi) 60 dakikadan
**120 dakikaya** çıkardı. Hedefi kendi sözleriyle: *2 saate kadar video ekle, en
fazla 60 dakikaya indir, indir.* Değişmeyenler: çıktı sınırı (disk/OPFS yolunda
60 dakika, bellek yolunda 5 dakika), 2 GiB toplam boyut, 5 video kaynağı, 20
parça, 1 müzik, mobil ve cloud satırları, fiyatlar.

Bu karar tek başına kötü bir akış doğururdu. ADR-019'dan beri çıktı sınırından
uzun bir video zaman çizgisine **konmuyordu**: zaman çizgisi boş kalıyor,
"İlk N dakikayı ekle" veya "Aralık seçerek ekle" (Kaynak önizlemesi, ikinci
saat) soruluyordu. Politika v3'te (girdi = çıktı = 60 dk) bu ekrana tarayıcıdan
ulaşılamıyordu. v4'te 60–120 dakikalık her video bu ekrana düşer ve bu, kurucunun
ADR-019'da kafa karıştırıcı bulduğu kaynak aralığı / iki saat modelinin ta
kendisi.

## Karar

1. **Politika `2026-09-23.v4`:** `maxTotalSourceDurationUs` = 120 dk. Doc 15
   satırı: "60 dakika çıktı (diske yazamayan tarayıcıda 5 dakika) / 120 dakika
   video girdi / 2 GiB toplam". `policy.test.ts` sayıları belgeden okur, v4
   değişiklik notunu ve v3/v2 notlarının yerinde durduğunu denetler.
2. **Açılan video her zaman tek parça gelir.** `initialPlacement` artık yalnızca
   "tamamı" veya "çok kısa" der; "çok uzun" dalı, `leadingRange`,
   `addLeadingSource`, "İlk N dakikayı ekle" düğmesi ve metinleri kaldırıldı.
3. **Zaman çizgisi (tarif) en çok girdi sınırı kadar uzun olabilir.**
   `maxTimelineDurationUs(policy)` = `maxTotalSourceDurationUs`. Belgeye yeni bir
   sayı eklenmedi: sınırı girdi sınırına bağlamak, açılabilen hiçbir videonun
   zaman çizgisine sığmamasının mümkün olmadığı anlamına gelir; bu yüzden eski
   "çok uzun" yolu yapısal olarak ulaşılamaz, kod olarak da kaldırıldı.
4. **Çıktı sınırı tarifin kuralı değil, indirmenin kapısı.** Çıktı sınırını tarif
   kuralı olarak kullanan her yer tek tek karara bağlandı:

   | Yer | Önce (v3) | Şimdi (v4) |
   |---|---|---|
   | `domain/renderPlan.ts` `compileRenderPlan` | 60 dk üstü reddedilir | **Aynı — kapı burası.** Plan 60 dakikadan uzun olamaz; 1 µs fazlası reddedilir (birim testi). Plan reddedilince worker hiç başlamaz. |
   | `application/commands.ts` `addClip`, `updateClipRange` | toplam > 60 dk reddedilir | toplam > zaman çizgisi sınırı (120 dk) reddedilir, kod `timeline_duration_exceeds_policy` |
   | `domain/trim.ts` `trimBounds` / `resolveTrimTarget` | kenar 60 dk'yı geçecek kadar uzayamaz | kenar zaman çizgisi sınırına kadar uzayabilir |
   | `domain/validation.ts` | `output_duration_exceeds_policy` (60 dk) | `timeline_duration_exceeds_policy` (120 dk); **girdi sınırı** (`source_duration_exceeds_policy`) aynen denetleniyor |
   | `domain/timelineEdit.ts` `initialPlacement`, `leadingRange`, `resolveEdgeTrim` | "çok uzun" seçimi | her zaman tek parça; `leadingRange` kaldırıldı |
   | Bellek yolu (worker, `outputRouteRefusal`) | 5 dk üstü kodlamadan önce ret | aynı; mesaja aynı "Sonuç … sil" cümlesi eklendi |

   Doğrulama zayıflatılmadı, yer değiştirdi: tarifin toplam süresi hâlâ sınırlı
   (120 dk), girdi sınırı hâlâ tarif doğrulamasında, çıktı sınırı render planında.
5. **Fixture'lar** (`web/fixtures/edl`, Dart/Python ile ortak sözleşme):
   - Eski `invalid/output-duration-exceeds-policy.json` (40 dk kaynak, iki kez →
     65 dk) **aynı içerikle** `valid/timeline-over-output-limit.json` oldu. Artık
     geçerli bir projedir; manifest'te `"exportRejection":
     "output_duration_exceeds_policy"` taşır ve `fixtures.test.ts` render planının
     onu reddettiğini denetler. Diğer diller aynı iki kararı vermeli.
   - Yeni `valid/whole-input-limit-video.json`: 120 dk video tek parça (geçerli,
     indirilemez).
   - Yeni `invalid/timeline-duration-exceeds-policy.json`: 100 dk kaynaktan
     100 + 25 = 125 dk; yalnızca zaman çizgisi kuralı kırılır.
   - Yeni `invalid/source-duration-exceeds-policy.json`: 121 dk kaynak; girdi
     sınırı tarifte de reddedilir (dosya seçicinin yanı sıra).
6. **Mevcut projeler ve yedekler:** v3'te geçerli olan her tarif v4'te de
   geçerli (60 → 120 genişleme). 60 dakikadan uzun zaman çizgisi yüklenir,
   kaydedilir, geri alınır, yedek dosyasından geri gelir ve yeniden bağlanır
   (e2e ve ölçüm). Eski yedekler ve legacy v1 fixture'ları değişmeden geçiyor.

## Kullanıcının gördüğü

- **İçe aktarma bildirimi** sınırı hemen söyler: "Video zaman çizgisine tek
  parça olarak eklendi (90 dk 0,0 sn). İndirilen video en fazla 60 dakika
  olabilir: fazlasını Böl ve Sil ile çıkar · Geri al: Ctrl+Z".
- **Zaman çizgisi:** 60:00'da kesik kırmızı bir çizgi ve "60 dk sınırı"
  etiketi (şerit o noktaya uzandıkça görünür; silme sonrası şerit ölçeği
  korunduğu için sınır altına inince de yerinde kalır); sonucun sınırı aşan
  kısmı kırmızı taralı; özet ("1 parça · 90:00 dk") kırmızı ve kalın; altında
  bir cümle: **"Sonuç 1:30:00. İndirmek için en az 30:00 sil — sınır 60
  dakika."** (İngilizce: "The result is 1:30:00. To download it, delete at
  least 30:00 — the limit is 60 minutes.") Saatler yukarı yuvarlanır: yarım
  saniye fazlası "en az 0:01 sil" der, "0:00" demez.
- **"Videoyu indir" görünür kalır.** Sonuç sınırdan uzunsa pencere "Video
  indirmek için çok uzun." başlığıyla aynı cümleyi ve ne yapılacağını söyler;
  uygunluk kontrolü ve worker çalışmaz, "Videoyu oluştur" kapalı, "Sorun
  bildir" gösterilmez (hata değil), OPFS'te dosya oluşmaz.
- **Bellek yolu** (diske yazamayan tarayıcı): kurucunun cümlesi aynen kaldı, altına
  aynı biçimde "Sonuç 5:10. İndirmek için en az 0:10 sil — sınır 5 dakika."
  eklendi.
- Yardım penceresi: "Açılan video en fazla 120 dakika ve 2 GiB. İndirilen video
  en fazla 60 dakika; tarayıcı videoyu diske yazamıyorsa en fazla 5 dakika.
  Daha uzun videoyu zaman çizgisinde böl ve fazlasını sil."
- Reddedilen dosya (121 dk): "“cok-uzun-video.mp4” açılamadı: video bu
  sürümdeki 120 dakika sınırının üzerinde. Açık olan videon değişmedi."

Ekran görüntüleri: `web/screenshots/timeline-over-limit-desktop-1440x900.png`,
`timeline-over-limit-phone-390.png`, `timeline-over-limit-export-gate.png`.

## Değerlendirilen seçenekler

| Seçenek | Neden seçilmedi |
|---|---|
| "Çok uzun" seçimini 60–120 dk için korumak (İlk 60 dakikayı ekle / Aralık seçerek ekle) | v4'te sık durum olur ve kurucunun ADR-019'da reddettiği iki ayrı saatli (kaynak ve sonuç) akıştır. |
| İlk 60 dakikayı sessizce koymak | Sessiz kesme; ADR-019 "sessizce kesilmez" dedi. Kullanıcı istediği 60 dakikayı videonun sonundan seçmek isteyebilir. |
| İndirirken ilk 60 dakikayı almak | Sessiz kesme, önizleme ile dosya farklı olur. |
| Tarifte ayrı bir "zaman çizgisi sınırı" sayısı (belge 15'e yeni satır) | Kurucu kararı olmayan yeni bir sayı. Girdi sınırına bağlamak yeterli ve açıklanabilir. |
| Zaman çizgisini sınırsız bırakmak | Aynı aralık tekrar kullanılabildiği için (belge 10) tarif sınırsız büyüyebilirdi; doğrulama bir üst sınır istiyor. |
| **Tamamı tek parça, çıktı sınırı indirme kapısı (seçilen)** | Kurucunun hedefiyle birebir: ekle → böl/sil → indir. Tek saat, tek oynatma çizgisi kalır. |

## Ölçüm

Yöntem ADR-013/ADR-020 ile aynı: kalıcı profil (disk destekli OPFS), tarayıcı
süreç ağacının private bytes değeri işletim sisteminden ~400 ms aralıkla
(`scripts/lib/process-memory.ps1`). Yeni script `scripts/measure-long-source.mjs`
gerçek editörü klavye ve fareyle sürer: aç → "Videoyu indir" kapısı → 1:59:00'a
git ve oynat → sessizlik önerileri (tüm 2 saat) → oynatma çizgisiyle 4 kez böl,
3 parçayı sil (0:20:00–0:50:00 ve 1:10:00–1:40:00 kalır; sonucun ortasında bir
kesim var) → 60 dakikayı 1080p (720p kaynakta 720p) indir → yeniden yükle ve
yeniden bağla → yedek dosyasıyla boş profile geri yükle ve yeniden bağla.

Kaynaklar `scripts/generate-long-media.mjs` ile ffmpeg'de üretildi (git dışında,
`web/tests/media/long/`; ölçümden sonra silindi): 120 dk, 30 fps, `testsrc2`
hareketli desen; her karenin numarası sol üstte 20 bitlik bir çubuk kod ve
yazılı zaman olarak gömülü; ses 13 saniyelik döngüde konuşmaya benzer patlamalar
ve 1,5 sn / 0,3 sn / 1,5 sn duraklamalar; indeks (moov) telefon kaydı gibi
dosyanın **sonunda**. 1080p: 1,60 GiB (1 714 459 418 byte); 720p: 1,01 GiB.
Makine: Windows 11, Intel i5-12500 (12 mantıksal çekirdek).

Kare doğruluğu makineyle okundu: indirilen dosyadan ffmpeg ile kare çıkarılıp
çubuk kod okundu (`scripts/lib/frame-barcode.mjs`); her parçanın ilk iki,
orta ve son iki karesi, beklenen kaynak kare numarasıyla karşılaştırıldı.

Tarayıcılar: Playwright Chromium 153.0.8010.12, Chrome 153.0.8010.53 (kararlı),
Edge 153.0.4234.48. Her sütun tek koşu (n=1). Bellek: süreç ağacı, MiB.

| Ölçüm | Chromium · 1080p kaynak | Chrome · 1080p kaynak | Chrome · 720p kaynak (720p çıktı) | Edge · 1080p kaynak |
|---|---|---|---|---|
| **1. Açma** — zaman çizgisinde tek parça | 194 ms | 191 ms | 194 ms | 199 ms |
| ilk önizleme karesi | 222 ms | 208 ms | 212 ms | 419 ms |
| bellek: boş editör → açtıktan sonra | 104 → 251 | 299 → 554 | 302 → 539 | 278 → 509 |
| film şeridi / küçük resim / dalga formu | yok (editör hiçbirini çizmiyor; kaynağın tamamı üzerinde iş yok) | yok | yok | yok |
| **2. 1:59:00'a git** (End, 60 × 1 sn geri) — ilk kare | 11 ms | 11 ms | 10 ms | 7 ms |
| ekrandaki kare (çubuk kod) | 214200 | 214200 | 214200 | 214200 |
| oynat — ilk yeni kare / 3 sn sonra ilerleme | 89 ms / 3,04 sn | 90 ms / 3,03 sn | 78 ms / 3,03 sn | 89 ms / 3,07 sn |
| **3. Sessizlik önerileri** (2 saatin tamamı) | 20,3 sn | 18,9 sn | 23,8 sn | 24,2 sn |
| öneri sayısı | 1107 (20 parça sınırı: 19 seçildi, 1088 dışarıda, söyleniyor) | 1107 (aynı) | 1107 (aynı) | 1107 (aynı) |
| bellek: başlangıç → tepe → pencere kapanınca | 481 → 708 → 296 | 808 → 970 → 541 | 769 → 840 → 542 | 727 → 855 → 504 |
| analiz boyunca onda birlik dilimlerin tepeleri | 597, 653, 658, 660, 643, 648, 620, 625, 559, 568 | 934, 970, 923, 825, 811, 796, 809, 805, 783, 851 | 801, 814, 837, 770, 767, 751, 769, 758, 743, 720 | 855, 850, 800, 726, 732, 723, 731, 738, 711, 752 |
| **4. 2 saatlik sonuçta "Videoyu indir"** — mesaj | 51 ms, "Sonuç 2:00:00. İndirmek için en az 1:00:00 sil — sınır 60 dakika." | 41 ms, aynı | 47 ms, aynı | 40 ms, aynı |
| "Videoyu oluştur" / kodlama / OPFS'te dosya | kapalı / başlamadı / 0 | kapalı / başlamadı / 0 | kapalı / başlamadı / 0 | kapalı / başlamadı / 0 |
| **5. Böl ve sil** (4 bölme, 3 silme; ~6000 klavye adımı dahil) | 18,4 sn → "20:00–50:00", "1:10:00–1:40:00", 3 600 000 000 µs | 27,9 sn, aynı | 31,5 sn, aynı | 36,6 sn, aynı |
| **60 dk çıktı** — süre (gerçek zaman katsayısı) | 722 sn = 12 dk 2 sn (×4,98) | 418 sn = 6 dk 58 sn (×8,61) | 291 sn = 4 dk 51 sn (×12,36) | 439 sn = 7 dk 19 sn (×8,20) |
| bellek: kodlama öncesi → tepe | 461 → 945 | 927 → 1173 | 935 → 1118 | 986 → 1198 |
| kodlama boyunca onda birlik dilimlerin tepeleri | 938, 798, 797, 799, **945**, 882, 879, 881, 879, 919 | 1077, 1072, 1079, 1076, **1173**, 1109, 1111, 1100, 1133, 1132 | 1050, 985, 989, 1050, **1118**, 1095, 1092, 1101, 1110, 1084 | 1144, 1016, 1001, 1009, 1096, **1179**, 1194, 1191, 1178, 1198 |
| dosya | 2461 MiB, 1920×1080, 5,60 Mbit/s | 2443 MiB, 5,56 Mbit/s | 1150 MiB, 1280×720, 2,55 Mbit/s | 2443 MiB, 5,56 Mbit/s |
| ffprobe: biçim / video / ses süresi, kare | 3600,000 / 3600,000 / 3600,000 sn, **108000** | aynı, 108000 | aynı, 108000 | aynı, 108000 |
| kare doğruluğu (çubuk kod, 10 kare: başlangıç, kesimin iki yanı, son) | **10/10** (0→36000, 53999→89999, 54000→126000, 107999→179999) | 10/10 | 10/10 | 10/10 |
| çözülemeyen kare / yol | 0 / OPFS | 0 / OPFS | 0 / OPFS | 0 / OPFS |
| geçici dosya: sunulurken / pencere kapanınca | 1 / **0** | 1 / 0 | 1 / 0 | 1 / 0 |
| **6. Yeniden yükle → geri yükleme istemi → aynı dosyayı bağla** | 75 ms + 194 ms | 111 + 193 ms | 122 + 203 ms | 114 + 205 ms |
| yedek dosyası (1,2 KB) → boş profile içe aktar → bağla | 32 ms + 83 ms | 18 + 192 ms | 22 + 100 ms | 14 + 191 ms |

- **Bellek düz mü?** Çoğunlukla. Her koşuda tepe, sonucun ortasındaki **kesimde**
  (ikinci parçaya geçişte, 5.–6. dilim) bir kez +70…+170 MiB basamak yapıyor ve
  sonra orada kalıyor; kodlama boyunca büyümüyor. Basamağın parça sayısıyla
  birikip birikmediğini görmek için ayrıca **20 parçalı** bir 60 dakika indirildi
  (Chrome, 1080p kaynak, 2 saate yayılmış 20 × 3 dk; tarif yedek dosyasıyla
  kuruldu, 19 kesim): 527 sn (×6,83), kodlama öncesi 742 → tepe 1076 MiB,
  dilimler 1013, 967, 964, 1002, 992, 1013, 1020, 1025, 1076, 1068; ffprobe
  3600,000 sn, 108000 kare; **100/100** kare kontrolü doğru. 19 kesim 19 basamak
  yapmadı; baştan sona ~60 MiB kayma var.
- **ADR-020'ye göre** bellek taban ve tepe olarak daha yüksek: kaynak 1080p (ADR-020'de
  480p), ve bu koşularda kodlamadan önce sessizlik analizi, 6000 önizleme
  araması yapılmıştı (Chrome/Edge taban ~930–990 MiB). Kodlama sırasındaki artış
  +183…+484 MiB; en büyük tepe 1198 MiB (Edge).
- **Önizleme:** klavyeyle End'e gidildiğinde oynatma çizgisi sonun 1 µs öncesinde
  durur; 60 × 1 sn geri 1:58:59,999999'dur. Dört tarayıcı da o anda 1:59:00,000
  karesini (214200) gösterdi; ofsetin tabanı 214199'dur. Bu, önizleme
  öğesinin mikrosaniyelik seek yuvarlaması; çıktıda kare kayması yok (bütün
  kare kontrolleri doğru: 4 × 10 + 100, byte deneyinde 2 × 10).
- **Sessizlik analizi** 2 saatlik sesi 19–24 saniyede tarıyor; bellek analiz
  boyunca düz (dilimler), dosya uzunluğuyla büyümüyor; tepe ya analizin
  başında ya da 1107 önerinin pencerede listelendiği anda, +70…+230 MiB, ve
  pencere kapanınca geri veriliyor. Düzeltme veya kapı gerekmedi. 20 parça sınırı
  yüzünden 1107 öneriden en uzun 19'u seçiliyor ve bu söyleniyor (ADR-018).
- **Yeniden bağlama dosyayı okumaz:** parmak izi yalnızca boyut + değişiklik
  zamanı + süre (`projectRecord.computeFingerprint`); süre `<video>` meta
  verisinden (moov dosya sonunda olsa da ~0,2 sn).
- Kodlama süresi Chrome'da 60 dakikalık 1080p için ~7 dakika, Playwright
  Chromium'da ~12 dakika (ADR-020'deki fark gibi; hangi kodlayıcının kullanıldığı
  ölçülmedi).

Kanıt dosyaları git dışında: `web/matrix-results/long-source-*.json`. Çıktı
dosyaları ölçüldükten sonra silindi.

## Byte sınırı kanıtı (politika değişikliği YOK)

Kurucu kararı olmadığı için 2 GiB toplam boyut sınırı **değişmedi**. Yalnızca
kurucunun sonra karar verebilmesi için kanıt toplandı.

**Neden önemli (hesap, ölçüm değil):** 2 GiB, 120 dakikada ortalama ~2,4 Mbit/s
demek. 17 Mbit/s'lik bir 1080p H.264 kayıt 2 GiB'a ~17 dakikada, 9 Mbit/s'lik
bir HEVC kayıt ~32 dakikada ulaşır. Yani gerçek telefon kayıtlarında bugün
bağlayıcı olan sınır büyük olasılıkla 120 dakika değil, **2 GiB**.

Kaynak: `generate-long-media.mjs --only=big` — 60 dk, 1080p30, gürültülü desen,
10,5 Mbit/s, **4 778 036 528 byte (4,45 GiB)**, indeks (moov) dosyanın sonunda
(~4,45 GiB ofsetinde).

1. **Gerçek politikayla** (2 GiB): Chrome 153.0.8010.53 ve Chromium
   153.0.8010.12 dosyayı 52 / 28 ms'de, hiçbir byte okumadan reddetti:
   "“big-60min-1080p-4gib.mp4” açılamadı: dosya bu sürümdeki 2 GiB (yaklaşık
   2,15 GB) sınırının üzerinde."
2. **Yerel deney derlemesi:** yalnızca `maxTotalSourceBytes` 8 GiB yapılarak
   ayrı bir statik derleme alındı ve `serve-static.mjs` ile ayrı portta
   sunuldu; `policy.ts` derlemeden hemen sonra geri alındı (depoya girmedi,
   deney derlemesi silindi). Aynı ölçüm scripti, kalıcı profil, OPFS yolu.
   Sonuç, byte ofseti 2 GiB'ı (≈27:00) geçen **26:00–28:30** ve 4 GiB'ı
   (≈53:56) geçen **52:30–55:00** parçalarından oluşan 5 dakika:

   | | Chrome | Chromium |
   |---|---|---|
   | Aç: zaman çizgisi / ilk önizleme karesi | 115 / 274 ms | 116 / 176 ms |
   | Bellek açtıktan sonra | 377 MiB | 180 MiB |
   | 59:00'a git (dosyanın ~4,4 GiB'ı): ilk kare, doğru kare | 18 ms, 106199 ✓ | 56 ms, 106199 ✓ |
   | 5 dk 1080p indir | 40,6 sn (×7,38) | 73,7 sn (×4,07) |
   | Bellek: kodlama öncesi → tepe | 939 → 1176 MiB | 460 → 913 MiB |
   | ffprobe | video 300,000 sn, 9000 kare, 1920×1080 | aynı |
   | Kare doğruluğu (çubuk kod; iki parçanın başı, ortası, sonu) | 10/10 | 10/10 |
   | Yeniden yükle → bağla / yedekten → bağla | 101 + 92 ms / 17 + 92 ms | 151 + 88 ms / 36 + 101 ms |
   | Geçici dosya, pencere kapanınca | 0 | 0 |

   Ses süresi 300,0107 sn (10,7 ms fazla): 300 sn × 48 kHz, 1024 örneklik AAC
   çerçevesine tam bölünmüyor (14 062,5 çerçeve); dosya boyutuyla ilgisi yok,
   60 dakikada (168 750 tam çerçeve) fark yok.

**Sonuç (kanıt, karar değil):** bu iki tarayıcıda, bu makinede `<video>`
meta veri okuması ve mediabunny'nin `BlobSource` üzerinden `File` okuması 2 GiB
ve 4 GiB byte ofsetlerini geçerek doğru çalıştı; bellek dosya boyutuna değil
çıktıya bağlı (dosya gerektikçe diskten okunuyor). **Denenmeyenler:** Edge,
Safari, Firefox; 4,45 GiB'tan büyük dosya; gerçek (değişken bitrate, HEVC)
büyük telefon kaydı; 2 GiB'ı aşan dosyada sessizlik analizi ve müzik. Byte
sınırını yükseltmek ayrı bir kurucu kararıdır (doc 15).

## Test edilen

`web/` içinde, bu değişikliğin son hâliyle:

- `npx tsc --noEmit -p .` → hata yok; `npx eslint .` → 0 sorun.
- `npx vitest run` → 23 dosya, **340 test geçti**.
- `npm run build` → başarılı.
- `E2E_PORT=3111 npx playwright test` (tam) → 134 test: **132 geçti, 2 atlandı**
  (sessizlik ekran görüntüsü testleri, yalnızca istenince çalışır), 2,8 dk.
- `node scripts/run-matrix.mjs --browser=chromium` → 20 PASS, 0 FAIL.

Yeni testler:

- Birim: `outputOverrun` sınır değerleri; "Sonuç … sil" cümlesi tr/en, yukarı
  yuvarlama ("0:01"), bellek yolu (5 dk); `formatClock`; zaman çizgisi sınırı =
  girdi sınırı; 60 dk, 60 dk + 1 µs, 90 dk ve 120 dk video tek parça; 90 dk
  tarif geçerli ama render planı reddeder; 2 saati 40:00 ve 1:40:00'da bölüp iki
  ucu silince plan tam 3600 sn / 108000 kare, 1 µs fazlası reddedilir; kenar
  sürükleme 60 dakikayı geçebilir, 120'yi geçemez; fixture'lar
  (`exportRejection`, yeni geçerli/geçersiz dosyalar).
- e2e (`tests/e2e/timeline.spec.ts`): 90 dakikalık video tek parça gelir, şerit
  sınır çizgisini ve fazlasını 2/3 noktasında gösterir; "Videoyu indir" kodlamadan
  önce reddeder, OPFS'te dosya yok; böl + sil ile ~50 dakikaya inince uygunluk
  kontrolü geçer, sonra kaynağın son 3 saniyesi gerçekten indirilir; geri al /
  ileri al ve yedek dosyası → boş profil → yeniden bağlama sınır üstü zaman
  çizgisini korur (390 px); telefon genişliğinde çizgi, etiket ve taralı alan
  şeridin içinde, yatay kaydırma yok; 121 dakikalık video dosya adıyla reddedilir.
  `output-limits.spec.ts`: bellek yolundaki retin altında "Sonuç 5:10. İndirmek
  için en az 0:10 sil — sınır 5 dakika." Sentetik e2e medyası küçük: 64×64,
  1 kare/sn (90 dk ≈ 5400 kare), ilk kullanımda ffmpeg ile üretilir.
- a11y (`tests/e2e/a11y.spec.ts`): sınır üstü zaman çizgisi ve indirme penceresi
  axe'te masaüstünde ve 390 px'te 0 ihlal; 320/640 px reflow'da sınır üstü
  durumda yatay kaydırma yok; metin aralığı (WCAG 1.4.12) 1440 ve 390 px'te
  kırpılan denetim yok.

Bilerek değiştirilen testler: `policy.test.ts` (v4 kimliği ve notu, 120/60/2
sayıları, kaldırılan mesaj anahtarları), `timelineEdit.test.ts` ("çok uzun" ve
"İlk N dakika" testleri yerine yukarıdakiler), `trim.test.ts` (kenar sınırı
artık zaman çizgisi sınırı), `timeline.spec.ts` (reddedilen dosya 121 dk,
yeni ad `cok-uzun-video.mp4`; eski 61 dakikalık `uzun-video.mp4` artık açılır),
`a11y.spec.ts` (5:10 video yerine 90 dk video ile tek parça durumu). Axe'in
telefon genişliğinde, açık pencerenin kenarı arkadaki bildirimin kapatma
düğmesini kısmen örttüğünde o düğmeyi "küçük hedef" saymasını önlemek için bu
tek durumda bildirim pencereden önce kapatılıyor (modal açıkken arkadaki sayfa
kullanılamaz).

## Ölçülmeyenler

- **Başka makineler.** Tek Windows masaüstü (i5-12500). Düşük RAM'li (4–8 GB)
  dizüstüler, yavaş diskler, pil tasarrufu ölçülmedi. Burada tepe ~1,2 GiB olan
  bir oturumun 8 GB'lık bir dizüstünde nasıl davrandığını bilmiyoruz.
- **Gerçek 2 saatlik kayıtlar.** Kaynaklar sentetik (`testsrc2`, 1,8 / 1,1
  Mbit/s). Gerçek telefon kaydı (daha yüksek bitrate, HEVC, değişken kare hızı,
  döndürme) 2 saat uzunlukta denenmedi; 2 saatlik 1080p telefon kaydı çoğunlukla
  2 GiB'ı aşar ve bugün zaten reddedilir (aşağıdaki byte kanıtı).
- **Safari ve Firefox.** Firefox'ta çıktı kapalı (AAC encode yok); Safari
  denenmedi. Gizli pencere denenmedi (OPFS orada RAM'dedir, ADR-013).
- **Uzun sessizlik analizinin arayüzü.** 1107 önerinin listelendiği pencerenin
  kaydırma/erişilebilirlik deneyimi ölçülmedi; yalnızca süre ve bellek ölçüldü.
- **Ekran okuyucu ve gerçek dokunmatik cihaz** (ADR-019'daki gibi) yok. Axe ve
  klavye/reflow/metin aralığı denetimleri yeni durumlar için eklendi.
- Her ölçüm tek koşu (n=1); ADR-013'te koşudan koşuya ~%15 oynama görülmüştü.
- Oynatma çizgisini 1 sn adımlarla 20–100. dakikalara taşımak (ölçümdeki
  ~6000 tuş basışı) 18–37 sn sürdü; bu klavye yolunun uzun videoda kullanışlı
  olduğu anlamına gelmez. Uzun zaman çizgisinde yakınlaştırma yok (ADR-019
  sınırı): 1440 px'lik ekranda 1 px ≈ 5,5 sn.

## Sonraki tek görev

Gerçek bir 2 saatlik telefon kaydıyla (kurucunun kendi videosu, dosya
bilgisayardan çıkmadan) ekle → böl/sil → 60 dakika indir akışını
`scripts/measure-long-source.mjs` ile tekrarlamak; kaydın 2 GiB'ı aşıp
aşmadığına göre byte sınırı kararını (aşağıdaki kanıtla) kurucuya sunmak.
