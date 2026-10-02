# ADR-032 — Gerçek Android telefonda "süre uyuşmadı": AAC kodlayıcısının gecikmesi

> Tarih: 2026-10-01 · Durum: UYGULANDI. Politika (`2026-09-24.v6`, belge 15) ve şema
> (EDL v2, belge 10) **değişmedi**. [ADR-014](ADR-014-w5-real-media-decoding.md)'ün kare
> politikası, [ADR-027](ADR-027-fast-cut.md)'nin hızlı kesimi ve bir karelik süre toleransı
> (belge 22) aynen geçerli; hiçbir kontrol gevşetilmedi.
>
> **Düzeltme, 2 Ekim 2026:** canlı derleme (aa5c9ea) telefonda koşturulunca `phone-run.mjs`
> sesi **−42,67 ms (erken)** okudu. Dosyalar sağlam çıktı; yanlış olan **ölçümdü** (ffmpeg'in
> `-ss 0` girdi aramasının düzenleme listesindeki hazırlık karelerini ikinci kez atması).
> Uygulama kodu değişmedi; ölçüm düzeltildi, oynatıcılarda doğrulandı. Ayrıntı:
> [Düzeltme: canlı derlemede telefonda −42,67 ms](#düzeltme-canlı-derlemede-telefonda-4267-ms).

## Bağlam

Kurucunun telefonunda (Samsung Galaxy S23, SM-S911B, Android 16, Chrome 154.0.8037.57)
canlı site `web/scripts/android/phone-run.mjs` ile sürüldü (adb + CDP; ayrıntı betiğin
başında). İki Samsung kaydı masaüstünde (Chrome/Edge, gerçek kayıtlar 15/15) geçerken
telefonda ~1,5–2,5 sn'de "Çıktı alınamadı. Oluşan dosyanın süresi beklenen süreyle
uyuşmadı." ile reddediliyordu:

- R15 `web-samsung-s21-h264-60fps-rot90.mp4` (H.264 1920×1080 60 fps, −90°, 4,4 sn), kesit 0,5–4 sn;
- R14 `web-samsung-hevc-slowmo-sef-rot90.mp4` (HEVC 1080p ağır çekim SEF, −90°, 11,8 sn, 12 kHz ses), kesit 1–8 sn.

## Kanıt

Dışa aktarma profili (ADR-028 kancası `window.__clipExportProfile`) bu iş için genişletildi:
yalnızca ölçüm açıkken işçi, çözücünün verdiği kare damgalarını ve oluşan dosyanın her
izini paket paket günlüğe yazıyor (`describeProduced`, `recordTimes`; kullanıcıda hiç
çalışmaz). `phone-run.mjs --profile` bunları ve işçinin aşama olaylarını satıra ekliyor.

**Görüntü sağlam.** Telefonda R15 kesiti: çözücü 209 kare verdi, 0,499833 → 3,963711 sn,
adım 16,5–16,7 ms, geriye giden ya da tekrar eden damga yok; çıktı 105 kare, 0 → 3,5 sn
tam, eksik kare 0. R14: 210 kare, eksik 0. Hızlı kesim denenmedi (R15 "fps" — 60 fps >
30; R14 "codec" — HEVC), düşüş sebebi değil. Döndürme doğru.

**Sorun ses izinde.** Aynı kesit, telefonda ve masaüstü Chrome'da (aynı derleme):

| | Görüntü izi | Ses izi | Dosya süresi | Plan | Fark |
|---|---|---|---|---|---|
| Telefon (önce) | 105 paket, 0 → 3,5 sn | 166 paket, 0 → 3,541333 sn | 3,541333 sn | 3,5 sn | **+41,3 ms > 34,3 ms tolerans → ret** |
| Masaüstü Chrome | 105 paket, 0 → 3,5 sn | 165 paket, 0 → 3,520021 sn | 3,520021 sn | 3,5 sn | +20,0 ms |

WebCodecs `AudioEncoder`'ın kendisi ölçüldü (AAC-LC 48 kHz stereo 128 kbit/s, uygulamanın
ayarı; bilinen bir gürültü parçası konup tarayıcının kendi `AudioDecoder`'ıyla geri
çözüldü):

| n giriş karesi | Telefon: paket / işaretin kayması | Masaüstü Chrome: paket / kayma |
|---|---|---|
| 168 000 | 166 / **2048** | 165 / 0 |
| 336 000 | 330 / **2048** | 329 / 0 |
| 48 000 | 48 / **2048** | 47 / 0 |
| 49 152 | 49 / **2048** | 48 / 0 |
| 40 961 | 42 / **2048** | 41 / 0 |

Telefon `ceil((n + 1024) / 1024)` paket veriyor ve sesin önüne **2048 hazırlık karesi**
(priming) koyuyor, ilk paketin damgası yine 0; masaüstü `ceil(n / 1024)` paket, kayma 0.
Masaüstünde kodlanmış paketler telefonun çözücüsüyle çözülünce kayma 0 çıktı: çözücü
standart, gecikme **kodlayıcının**. WebCodecs'te bu gecikmeyi bildiren bir alan yok ve
mediabunny paketleri kodlayıcının damgalarıyla yazıyor; dosyada düzenleme listesi (edit
list) olmadığı için oynatıcı hazırlık karelerini de çalıyor.

**Sonuçları (ffmpeg ile, kaynağa karşı çapraz ilinti):**

- Telefonda "geçen" iPhone HLG kesiti (2–10 sn, gerçek ses) görüntüden **42,67 ms
  geride** ve son 1024 ses karesi eksik; masaüstü Chrome'da aynı kesit kayma 0, eksiksiz.
  Kodlayıcı her dışa aktarmada aynı olduğu için telefondaki her sesli çıktı böyleydi: 3 dk
  tam video (hızlı kesim ve tam kodlama) ve iki kesit de `ceil((n + 1024) / 1024)` paket
  taşıyor (8439 / 2814); o kaynağın sesi sürekli 440 Hz ton olduğundan kayması ilintiyle
  tek bir değere okunamıyor.
- Ses izi = `ceil((n + 1024) / 1024) × 1024` kare. `n mod 1024` 1…447 arasındaysa fazlalık
  1600 kareyi (30 fps'te bir çıktı karesi, 34,3 ms) aşıyor ve dosya reddediliyor: 30 fps'lik
  kesit uzunluklarının **%37,5'i** (3,5 sn ve 7 sn bunlardan). 8 sn, 60 sn, 180 sn
  tesadüfen tolerans içinde kaldı. Sorun Samsung kayıtlarına özgü değil; 60 fps, SEF,
  döndürme ya da 12 kHz ses değil, **kesitin uzunluğu** belirliyordu.

## Karar

Gecikme dışa aktarmanın yapıldığı tarayıcıda **ölçülür** ve **geri alınır**; ölçülemezse
dışa aktarma reddedilir.

1. **Ölçme** (`web/src/adapters/export/alignedAac.ts`, saf kurallar
   `web/src/domain/audioEncoderDelay.ts`): dışa aktarmanın ses ayarıyla (48 kHz, 2 kanal,
   plan bit hızı) 32 768 karelik bir sinyal kodlanıp tarayıcının kendi çözücüsüyle geri
   çözülür. Sinyalde iki işaret var (Hann pencereli 500 Hz → 8 kHz tarama, 2048 kare;
   ton olsaydı her periyotta eşleşirdi). İkisi de −1024…8192 kare aralığında aranır;
   **ikisinin de** normalize ilintisi ≥ 0,9 olmalı ve aynı kaymada (en çok 1 kare fark)
   bulunmalı. Değilse `audio_encoder_misaligned` ("Bu tarayıcının ses kodlayıcısı sesi
   görüntüyle hizalı yazamadı; sesi kayık bir dosya kaydedilmedi."), çıktı dosyası
   oluşmadan. Sonuç işçi başına önbellekte. Telefonda ölçülen: 2048 kare, ilinti 0,99991;
   masaüstü Chrome: 0.
2. **Geri alma**: AAC kodlayıcısı artık mediabunny'nin `AudioSampleSource`'u yerine bizde
   çalışıyor (mediabunny'nin kurduğu ayarın aynısı: `mp4a.40.2`, ham AAC), paketler
   `EncodedAudioPacketSource`'a veriliyor. Her paket ölçülen gecikme kadar geri alınır; ilk
   hazırlık paketleri negatif zamana düşer ve mediabunny'nin MP4 yazıcısı bunları gizleyen
   düzenleme listesini yazar (`elst` media_time = 2048). Çözücü bu paketlerle ısınır,
   oynatıcı onları çalmaz.
3. **Sonu tamamlama**: son gerçek kareden sonra `gecikme + 2048` kare sessizlik verilip
   kodlayıcı boşaltılır (telefonun kodlayıcısı son kareleri tutuyordu); kaydırıldıktan sonra
   başı kesitin sonunda ya da sonrasında olan paketler atılır. Kalan paketler kesitin
   sonuna kadar gelmiyorsa (`AacPacketAligner.complete`) dosya reddedilir
   (`audio_encoder_misaligned`), iki yolda da (tam kodlama ve hızlı kesim).
4. Ses izi sonuçta en çok bir AAC paketi (1023 kare, 21,3 ms) uzun olabilir, masaüstünde
   de hep böyleydi; süre toleransı (bir çıktı karesi) **değişmedi**.
5. WebKit'in bozuk AAC açıklaması için mediabunny'nin yaptığı düzeltme bizim kodlayıcıda
   da var (`aacDescriptionInvalid`, `aacLcAudioSpecificConfig`).

Gecikmenin 0 olduğu masaüstünde paketler mediabunny'nin koyduğu yerde; tek fark kodlayıcının
sonu artık sessizlikle boşaltılıp fazlası atılıyor (önce kodlayıcı son paketi kendisi
dolduruyordu). Masaüstü çıktılarının süreleri aynı (ör. 3,5 sn kesit 3,520 sn).

### Neden bu yol

- **Tolerans gevşetmek** yanlış dosyayı kabul ederdi: ses yine 42,7 ms geride kalırdı.
- **Cihaza göre sabit 2048** (Android'de şu kadar kaydır) başka telefonların, başka
  kodlayıcıların (Apple AAC 2112 kare) ve Chrome'un ileride değişmesinin önünde kör kalırdı.
  Ölçüm her tarayıcıda gerçeği okur; masaüstünde 0 ölçüp hiçbir şeyi değiştirmez.
- **Hazırlık paketlerini atmak** (düzenleme listesi yerine) ilk paketi örtüşmesiz çözdürür,
  sesin ilk 21 ms'si bozulur.

### Maliyet

Ölçme masaüstü Chrome'da 79–143 ms (9 dışa aktarma); telefonda ayrı ölçülmedi, R15 kesitinin
toplam süresi 1,35 → 1,55 sn (tek koşu, önce/sonra). İşçi başına bir kez; her dışa aktarma
yeni işçi açtığı için dışa aktarma başına bir kez. Sessiz dolgu en çok `gecikme + 2048` kare.

## Telefonda sonuç

> Bu tablo 30 Eylül/1 Ekim koşusunun; tüm durumlar ve düzeltilmiş ses ölçümü için
> [Düzeltme](#düzeltme-canlı-derlemede-telefonda-4267-ms) bölümündeki tabloya bakın.

Galaxy S23 (SM-S911B), Android 16, Chrome 154.0.8037.57; 30 Eylül 2026. "Önce": canlı site
(düzeltmesiz derleme). "Sonra": bu dalın derlemesi, `next start` + `adb reverse`
(`phone-run.mjs --url=http://localhost:<port>/editor`). Kalite 1080p. Ses kayması ffmpeg ile,
kaynağın aynı anına karşı (+ = ses geç).

| # | Kaynak, kesit | Önce | Sonra |
|---|---|---|---|
| A | add1.mp4 (1080×1920 30 fps H.264), 2–10 sn | ✅ tam kodlama (aralıkta anahtar kare yok), 8,021 sn, 240 kare; kaynak sessiz | — telefon bağlı değildi, **ölçülmedi** |
| B | R15 Samsung S21 H.264 60 fps −90°, 0,5–4 sn | ❌ "süre uyuşmadı" (1,5 sn) — ses izi 3,541 sn, görüntü 3,5 sn | ✅ 3,520 sn, 105 kare, eksik 0, ses kayması **0 ms** (2,0 sn) |
| C | R14 Samsung HEVC ağır çekim SEF −90°, 1–8 sn | ❌ "süre uyuşmadı" (2,0 sn) | ✅ 7,019 sn, 210 kare, eksik 0, ses kayması **0 ms** (2,5 sn) |
| D | R11 iPhone 12 Pro HEVC HLG −90°, 2–10 sn | ✅ 8,021 sn, 240 kare, ses **+42,67 ms**, son 1024 kare eksik | — telefon bağlı değildi, **ölçülmedi** |
| E–G | 3 dk 1080×1920 (tam video hızlı kesim / zorla tam kodlama / iki kesit) | ✅ (ana oturumun koşusu) 180,032 / 180,032 / 60,032 sn; ses paketleri `ceil((n+1024)/1024)` | — telefon bağlı değildi, **ölçülmedi** |
| H–M | R15 ve R14, başka aralıklar (tüm dosya, kısa, iki kesit) | çalıştırılmadı (telefon arka plana geçti, sonra bağlantı kesildi) | — telefon bağlı değildi, **ölçülmedi** |

Masaüstü Chrome'da (aynı derleme, `phone-run.mjs --desktop=chrome`) B, C, D ve H–M hepsi ✅,
ölçülen gecikme 0, ses kayması 0 ms (tüm dosyada +1,9–2 ms: kaynağın sesi görüntüden 2 ms
sonra başlıyor, çıktı bunu koruyor).

## Düzeltme: canlı derlemede telefonda −42,67 ms

> 2 Ekim 2026. Yukarıdaki "Sonra" sütunu ve masaüstü notu aşağıdaki ölçümle yeniden okunmalı.

**Ne görüldü.** ADR-032 canlıya çıktıktan sonra ana oturum `phone-run.mjs`'i (A–M) canlı siteye
karşı telefonda koşturdu (sekme ağdan yüklenen derlemeyi çalıştırdı, `2mmpezlrfmbu5.js`). Her
durum kaydedildi, kare sayıları tam; ama `audioSync` B, D, I, J'de **−42,67 ms**, H'de −40,67 ms
okudu (ses erken). Aynı B ve D masaüstü Chrome'da 0 ms. İlk akla gelen: telefonda hazırlık iki kez
atılıyor (paket kaydırma + düzenleme listesi).

**Kök neden: ölçüm.** Dosyalar doğru; `audioSync` çıktıyı `ffmpeg -ss 0 -i <dosya>` ile okuyordu.
ffmpeg 9.0.1'in `-i`'den önceki `-ss`'i, sesinin düzenleme listesi hazırlık karelerini gizleyen bir
dosyada, arama noktası hazırlığın içine düşünce (`-ss 0` … hazırlık süresi) o kareleri **ikinci
kez** atıyor. Kanıt (telefonun B çıktısı, canlı derleme):

| Okuma | Çözülen kare | Baştan çözüme göre kayma |
|---|---|---|
| `ffmpeg -i` (arama yok) | 168 960 (= 3,52 sn) | — |
| `-ss 0` | 166 912 | **2048 kare erken** |
| `-ss 0.01` | 166 912 | 1568 kare erken |
| `-ss 0.05`, `0.5`, `1` | beklenen | 0 |

ffmpeg'in kendi AAC kodlayıcısıyla yazdığı bir dosya da aynı (1024 kare hazırlık; `-ss 0` ile 96 000
yerine 94 976 kare): tuzak ffmpeg'in arama yolunda, bizim dosyada değil. Telefonun çıktısının yapısı
(ffprobe ve `elst` kutusu): ses paketleri −2048, −1024, 0, … (ilk pakette `skip_samples=2048`),
düzenleme listesi `media_time = 2048`, segment 3,52 sn; görüntü izi düzenleme listesiz 0'dan.
ffmpeg'in kendi AAC dosyalarıyla aynı biçim. Ölçülen gecikme her dışa aktarmada 2048 kare (ilinti
0,99991, ölçme 121–158 ms).

**Ölçüm düzeltildi** (`web/scripts/lib/av-sync.mjs`): 1 sn'den önceki her okuma baştan çözülüp
burada kesiliyor; kaynağın sesi 0'dan sonra başlıyorsa (Samsung kayıtları 2 ms) başlangıç zamanına
yerleştiriliyor (eski okuma bunu atıyordu, tüm dosyada +2 ms görünüyordu); pencere 0,25 → 1 sn.
Canlı koşunun dosyaları (ana oturumun kaydettikleri) yeni ölçümle yeniden okundu: B, D, H, I, J
**0 ms**; C, E–G, K–M kaynakları sürekli ton (ölçülemez). Masaüstü çıktılarında (düzenleme listesi
yok) eski ve yeni okuma B ve D'de aynı (0 ms); tüm dosyada eski okumanın +2 ms'si artık 0.

**Oynatıcılar ne yapıyor.** Kullanıcı oynatıcının çaldığını duyar; ffmpeg yetmez. Yeni senkron
klibi (`av-sync.mjs`: 1080×1920 30 fps, düzensiz aralıklarla tek karelik beyaz flaş ve aynı anda
başlayan 30 ms'lik cıvıltı, kare numarası barkodu) canlı derlemeyle telefonda ve masaüstünde dışa
aktarıldı (N hızlı kesim, O zorla tam kodlama, P iki kesit, Q tüm klip). `player-sync.mjs` her
dosyayı tarayıcının kendi `<video>`'sunda oynatıp her flaşın ekrana geliş anını
(`requestVideoFrameCallback`) ve cıvıltının çalınış anını (Web Audio, `getOutputTimestamp`) aynı
saatte karşılaştırıyor; her oynatmada cihazın sabit bir gecikmesi de var, bu yüzden her
düzenleme listeli dosyanın bir de `media_time = 0` ikizi (aynı baytlar; düzenleme listesini yok
sayan bir oynatıcının göreceği dosya) çalınıyor. Üç tur, turların ortancası (ms, ses − görüntü):

| Oynatıcı | Masaüstü çıktısı N/O/P/Q | Telefon çıktısı N/O/P/Q | Aynı dosya, `media_time = 0` | ffmpeg AAC kaynağı / ikizi |
|---|---|---|---|---|
| Chrome 154 masaüstü | 23 / 21 / 20 / 25 | 24 / 25 / 21 / 17 | 65 / 61 / 65 / 57 | 14 / 45 |
| Edge masaüstü | 21 / 16 / 22 / 24 | 17 / 25 / 22 / 20 | 61 / 66 / 63 / 66 | 21 / 44 |
| Firefox (Playwright) | −17 / −18 / −14 / −17 | −20 / −12 / −20 / −19 | 23 / 26 / 26 / 32 | −18 / 1 |
| Telefonda Chrome 154 (2 Ekim) | 8 / 0 / −9 / 0 | canlı 22 / 13 / 14 / 1; yerel derleme 1 / −14 / −5 / 4 | canlı 33 / 59 / 46 / 44; yerel 53 / 61 / 39 / 31 | −8 / 37 |

Tüm turlar birlikte (ortalama ± standart hata, ms): masaüstü Chrome'da masaüstü çıktısı
23,5 ± 1,2, telefon çıktısı 21,1 ± 1,8, ikizi 61,3 ± 1,5; Edge 22,2 ± 1,5 / 21,1 ± 1,1 / 62,6 ± 1,3;
Firefox −17,4 ± 0,9 / −19,4 ± 1,9 / 27,6 ± 1,5; **telefonun kendi Chrome'unda** −1,0 ± 3,4 (12
oynatma) / 5,1 ± 2,9 (24) / 44,8 ± 2,8 (24). Telefonun oynatıcısı daha gürültülü (kare atlıyor,
oynatma başına sabit ±20 ms oynuyor), ama aynı tablo: dört oynatıcının dördünde de telefon çıktısı
masaüstü çıktısıyla aynı yerde (fark ≤ 6 ms, gürültünün içinde), `media_time = 0` ikizi 40–46 ms
geç (hazırlık 42,67 ms): **düzenleme listesine uyuyorlar.** Mutlak değerler oynatıcının kendi
gecikmesidir, karşılaştırılan farktır.
ffmpeg (baştan okuyarak) iki çıktıda da flaş ile cıvıltı arası **0,08–0,10 ms** (kaynağın kendisi
0,08 ms: eşik cıvıltının 4. örneğinde aşılıyor).

**Karar: dosya biçimi değişmedi.** Hazırlık paketleri negatif zamanda, düzenleme listesi onları
gizliyor; ffmpeg'in kendi AAC dosyalarında (1024 kare) ve iPhone kaydında (R11, 2112 kare) de
aynı biçim var. Hazırlığı paket olarak
atmak (düzenleme listesiz) düzenleme listesini yok sayan oynatıcıda da senkron verirdi, ama ilk
paketi örtüşmesiz çözdürür (ilk 21 ms bozuk) ve denenen oynatıcıların hepsi zaten uyuyor.
Senkron eşiği: |kayma| ≤ bir AAC çerçevesi (1024 / 48 000 = 21,3 ms) — kodlayıcının paket adımı;
her ölçüm bunun çok altında (ffmpeg ≤ 0,1 ms, oynatıcı karşılaştırmasında masaüstü/telefon farkı
turların oynamasının içinde).

**Neden önceki "0 ms" farklıydı.** Bu ADR'deki B ve C "Sonra 0 ms" satırları (30 Eylül gecesi,
yerel derleme) `phone-run.mjs`'teki `audioSync`'ten gelmedi: o fonksiyon sonraki işlemde eklendi
(25b1b88, 23:59), sürekli tonu "ölçülemez" sayan kontrol daha sonra (c2f7eff); C'nin kaynağı
sürekli ton olduğu için bugünkü ölçüm onu ölçemez. O koşunun dosyaları ve ölçüm komutu silinen
çalışma ağacında kaldı, yeniden üretilemiyor; büyük olasılıkla çıktı baştan (aramasız) okundu ve
doğru sonucu verdi. Canlı koşudaki −42,67 ms, `audioSync`'in `-ss 0` okumasının ilk kez düzenleme
listeli (telefon) bir dosyaya uygulanmasıydı. **Uygulama kodu aa5c9ea'dan bu yana değişmedi**; aynı
dosyalar iki farklı okumayla iki farklı sayı verdi.

**Uygulamada değişiklik gerekiyor mu: hayır** (ses için). Telefon da masaüstü de senkron, süreler
tam; bu düzeltmede yalnızca ölçüm betikleri değişti. (Aşağıdaki donmuş kareler ayrı bir sorun.)

### Telefonda tüm durumlar, düzeltilmiş ölçümle (2 Ekim 2026)

Galaxy S23, Android 16, Chrome 154.0.8037.57. "Canlı": ana oturumun 1 Ekim koşusu (canlı site,
aa5c9ea) — süre ve kare sayısı o koşudan, ses kayması aynı dosyaların yeniden okunması; N–Q
canlıya karşı 1 Ekim'de bu oturumda. "Yerel": aynı uygulama kodunun yerel derlemesi (`next start`
+ `adb reverse`, sekme ağdan yüklenen `2mmpezlrfmbu5.js`'i çalıştırdı — canlıyla aynı parça adı),
`phone-run.mjs --profile`, 2 Ekim. Her durumda ölçülen gecikme 2048 kare (ölçme 112–165 ms), ses
izi −2048, −1024, 0 … ve `skip_samples = 2048`, `framesMissing` 0. Ses: kaynağa karşı (+ = geç);
N–Q ayrıca flaş ile cıvıltı arası (ffmpeg, dosyanın kendi görüntüsüne karşı).

| # | Kaynak, kesit | Canlı (aa5c9ea) | Yerel derleme |
|---|---|---|---|
| A | add1.mp4 2–10 sn | ✅ 8,000 sn, 240 kare; kaynak sessiz | ✅ 8,000 sn, 240 kare; kaynak sessiz |
| B | R15 Samsung H.264 60 fps, 0,5–4 sn | ✅ 3,520 sn, 105 kare; eski okuma −42,67, düzeltilmiş **0 ms** | ✅ 3,520 sn, 105 kare, **0 ms** |
| C | R14 Samsung HEVC ağır çekim, 1–8 sn | ✅ 7,019 sn, 210 kare; ton, ölçülemez | ✅ 7,019 sn, 210 kare; ton |
| D | R11 iPhone HEVC HLG, 2–10 sn | ✅ 8,000 sn, 240 kare; −42,67 → **0 ms** | ✅ 8,000 sn, 240 kare, **0 ms** |
| E | 3 dk, hızlı kesim | ✅ 180,011 sn, 5400 kare; ton | ✅ 180,011 sn, 5400 kare; ton |
| F | 3 dk, zorla tam kodlama | ✅ 180,011 sn, 5400 kare; ton | ✅ 180,011 sn, 5400 kare; ton |
| G | 3 dk, iki kesit | ✅ 60,011 sn, 1800 kare; ton | ✅ 60,011 sn, 1800 kare; ton |
| H | R15 tüm dosya | ✅ 4,416 sn, 132 kare; −40,67 → **0 ms** | ✅ 4,416 sn, 132 kare, **0 ms** |
| I | R15 1,2–2,9 sn | ✅ 1,707 sn, 51 kare; −42,67 → **0 ms** | ✅ 1,707 sn, 51 kare, **0 ms** |
| J | R15 iki kesit | ✅ 3,605 sn, 108 kare; −42,67 → **0 ms** | ✅ 3,605 sn, 108 kare, **0 ms** |
| K | R14 tüm dosya | ✅ 11,819 sn, 354 kare; ton | ✅ 11,819 sn, 354 kare; ton |
| L | R14 2,5–5,1 sn | ✅ 2,603 sn, 78 kare; ton | ✅ 2,603 sn, 78 kare; ton |
| M | R14 iki kesit | ✅ 6,507 sn, 195 kare; ton | ✅ 6,507 sn, 195 kare; ton |
| N | Senkron klibi 1,2–6,5 sn, hızlı kesim | ✅ 5,312 sn, 159 kare; 0 ms; flaş–cıvıltı 0,08–0,10 ms (16/16) | ✅ aynı; 0 ms; 0,08–0,10 ms (16/16); barkod 159/159 doğru |
| O | aynı, zorla tam kodlama | ✅ 5,312 sn; 0 ms; 0,08–0,10 ms (15/15) | ✅ 0 ms; 0,08–0,10 ms (16/16); barkod: **son 2 kare bayat** |
| P | iki kesit, hızlı kesim | ✅ 4,907 sn, 147 kare; 0 ms; 0,08–0,10 ms (16/16) | ✅ aynı; barkod 147/147 doğru |
| Q | tüm klip, zorla tam kodlama | ✅ 12,011 sn, 360 kare; 0 ms; 0,08–0,10 ms (36/36) | ✅ 0 ms; 0,08–0,10 ms (36/36); barkod: **son 9 kare bayat** |

Masaüstünde aynı yerel derleme (`--desktop=chrome` / `--desktop=msedge`, 1 Ekim gecesi): Chrome
A–Q hepsi ✅, süreler telefondakiyle aynı, ses 0 ms, N–Q flaş–cıvıltı 0,08–0,10 ms, barkod
hatasız; ses izi 0, 1024, … (gecikme 0, düzenleme listesi yok). Edge A, B, E–J, N–Q ✅ aynı
değerlerle; C, D, K, L, M (HEVC kaynaklar) açılmadı: bu bilgisayardaki Edge'de HEVC çözücüsü yok
(`VideoDecoder.isConfigSupported` hev1 → false), uygulama "HEVC Video Uzantıları" ipucunu gösterdi.

### Yan bulgu: telefonda kesit sonlarında donmuş kareler (bu ADR'nin konusu değil, düzeltilmedi)

Canlı koşunun telefon çıktıları aynı derlemenin masaüstü Chrome çıktılarıyla kare kare
karşılaştırıldı (36×64 gri, ortalama mutlak fark): masaüstünde görüntü değişirken telefonda bir
önceki karenin aynısı kalan kareler var, hep **bir kesitin sonunda**: D son 1 kare (239), I son
kareler (48, 50), J birinci kesitin sonu (36–38) ve ikincinin sonu (104–107), L son 2 kare, M
birinci kesitin son 10 karesi (80–89). Senkron klibinde O'nun 151. karesindeki (sondan 8.) ve Q'nun
347. karesindeki flaş telefon çıktısında yok (siyah), masaüstünde var. Kare sayıları ve
`framesMissing` 0; çözücünün verdiği zaman damgaları tam. Yani kareler zamanında geliyor ama
içerikleri bayat: büyük olasılıkla Android'in donanım çözücüsünün son kareleri boşaltırken
(flush) verdiği `VideoFrame`'ler çizilmeden önce tamponları geri alınıyor (varsayım, ölçülmedi).
2 Ekim'de yerel derlemeyle tekrarlandı ve barkodla doğrulandı: O'nun son 2 karesi kaynağın 193 ve
194. kareleri yerine 192'yi, Q'nun son 9 karesi (351–359) 350'yi gösteriyor; N ve P (hızlı kesim)
hatasız. Masaüstüyle karşılaştırmada D son 2, F son ~11, H son 5, I son 4, J ikinci kesitin son 4,
L son 1, M birinci kesitin son 8 karesi; sayı koşudan koşuya değişiyor (O canlıda sondan 8.
kareden, yerelde son 2). Ayrı bir iş olarak ele alınmalı; ADR-014'ün kare politikası bunu "eksik"
saymıyor, `framesMissing` 0.

## Test edilen

- Birim: `tests/unit/audioEncoderDelay.test.ts` (22 test): işaretin bulunması, 0/64/1024/2048/2112/−64
  karelik gecikmeler, sessizlik/gürültü/aralık dışı/kayan gecikmede ret, Android ve masaüstü
  paket zamanlaması (telefonda ölçülen 170 paket → 167 tutulan, 3 atılan), 1–300 karelik her
  uzunlukta toleransın içinde kalma ve düzeltmesiz hâlin 3,5 sn / 7 sn'de reddi, AAC
  açıklaması, `audioEndFrame`. Tümü: vitest 548/548 (main birleşiminden sonra).
- Masaüstü (main birleşiminden önce ve sonra ayrı ayrı): matris Chromium 22/22, Chrome 22/22,
  Edge 22/22 — 66 durumun hepsinde süre ve kare sayısı önceki koşuyla aynı; gerçek kayıtlar
  Chrome 15/15. e2e: birleşimden sonra 170 geçti, 2 atlandı; birleşimden önceki koşuda
  154 geçti, 1 kaldı (`kesit.spec.ts:1024` telefon çubuğu odak testi, ses koduyla ilgisiz;
  tek başına 4/4 geçti, sonraki tam koşuda da geçti — kararsız test), 2 atlandı.
- `tsc --noEmit`, `eslint .`, `npm run build` temiz.
- Düzeltme (1–2 Ekim): birim `tests/unit/avSync.test.ts` (12 test: senkron klibinin olayları,
  başlangıç bulma, baştan okumanın dosya zamanına yerleştirilmesi — Samsung'un 2 ms'lik ses
  başlangıcı dahil —, flaş/cıvıltı eşleştirme, ses izinin düzenleme listesini okuma ve ikizini
  yazma); vitest 560/560. Masaüstü: matris Chromium 22/22, Chrome 22/22, Edge 22/22; gerçek
  kayıtlar Chrome 15/15; e2e 170 geçti, 2 atlandı (`E2E_PORT=3261`). Telefon: yukarıdaki tablo.
- Telefon betikleri artık `cdp-own-tabs.mjs` üzerinden bağlanıyor: 2 Ekim'de Chrome yeni
  açılmışken Playwright'ın `connectOverCDP`'si, hiç yüklenmemiş (tembel geri yüklenen) bir
  sekmeyi beklediği için zaman aşımına düştü. Ara katman betiğe yalnızca kendi açtığı sekmeleri
  gösteriyor; kurucunun sekmelerine bağlanılmıyor, listelenmiyor.

## Ölçülmeyenler

- ~~Telefonda düzeltmeden sonra A, D, E–G ve H–M çalıştırılmadı.~~ 2 Ekim'de A–Q hepsi
  telefonda yerel derlemeyle ve (1 Ekim) canlı siteyle koşturuldu; bkz. "Düzeltme" bölümü.
- Telefonun **kendi galeri/video oynatıcısı** (Samsung Galeri, Android `MediaPlayer`/ExoPlayer)
  ve Windows'un Filmler ve TV / Media Foundation, VLC, QuickTime denenmedi: telefona dosya
  koymak ya da uygulama açmak kurucunun telefonunda yapılmadı. Denenen dört oynatıcı (Chrome,
  Edge, Firefox masaüstü, telefonda Chrome) ve ffmpeg düzenleme listesine uyuyor.

- **Samsung Internet** (v30.0.0.67): telefonda çalışmıyordu, DevTools soketi
  (`/proc/net/unix`'te tarayıcı olarak yalnızca Chrome'un `chrome_devtools_remote` soketi vardı)
  açık değildi. Soketi açmak Samsung Internet'in ayarlarında "USB ile web sayfası hata
  ayıklama"yı açmayı gerektirir; kurucunun telefonunda ayar değiştirilmedi. Samsung
  Internet Chromium tabanlı, aynı `AudioEncoder`'ı kullanması beklenir; ölçüm her
  tarayıcıda çalıştığı için düzeltme onda da gecikmeyi okur, ama **ölçülmedi**.
- Başka Android telefonlar ve başka AAC kodlayıcıları (Qualcomm/Exynos farkı, Android
  sürümleri), iOS Safari, macOS Safari/Chrome (AudioToolbox kodlayıcısı).
- Telefonda HDR ekran, telefonun kendi kaydetme penceresi (betik OPFS'e yazan bir
  yer tutucu kullanıyor, ADR-026), uzun (> 3 dk) kaynaklar, termal davranış.
- Telefonda sessiz kaynaklarda (add1.mp4) ses kayması ölçülemez; yalnızca süre ve paket
  sayısı karşılaştırıldı.
