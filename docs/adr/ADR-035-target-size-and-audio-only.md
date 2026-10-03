# ADR-035 — "Küçült" (hedef boyuta indirme) ve "Sesini al" (yalnızca ses, M4A)

> Tarih: 2026-10-03 · Durum: UYGULANDI (motor, API ve testler; iş kartları ve sihirbazlar ayrı işte).
> Politika (`2026-09-24.v6`, belge 15) ve şema (EDL v2, belge 10) **değişmedi**. 720p'nin altına
> inme **kurucu sorusu olarak açık** (aşağıda "Belge 15 ile ilişki"). [ADR-024](ADR-024-software-encoder-bitrate.md)
> (yazılım kodlayıcıya 3 kat), [ADR-027](ADR-027-fast-cut.md) (hızlı kesim),
> [ADR-032](ADR-032-android-samsung-media.md) (AAC gecikmesi, düzenleme listesi) ve
> [ADR-033](ADR-033-android-stale-kesit-ends.md) (çözücü tutma) olağan indirmede aynen geçerli.

## Bağlam

Yeni açılış ekranındaki iki iş için motorda karşılık yoktu:

1. **Küçült:** "WhatsApp'a sığdır", "paylaşılabilir yap", "e-postaya sığdır". Kullanıcı bir hedef
   seçer; çıkan MP4 o boyutta ya da altında olmalı. Olağan indirme sabit bir kalite tablosuyla
   (~0,09 bit/piksel) kodluyor ve dosyanın boyutunu kimse seçemiyordu.
2. **Sesini al:** seçili kesitlerin sesi tek başına bir dosya olarak. WebCodecs'te MP3 kodlayıcı
   yok.

Kurucu kuralları: sahte dışa aktarma, sahte ilerleme, çalışmayan şeye başarı mesajı yok; hedefin
üstündeki dosyaya "sığdı" denmez; medya hiçbir yere gönderilmez.

## Karar

### 1. Hedef boyut

- **Saf planlayıcı** (`web/src/domain/targetSize.ts`, `planTargetSize`): çıktının süresi, çerçevesi,
  kare hızı, sesinin olup olmadığı, tarayıcının o boyuttaki H.264 kodlayıcısının sınıfı (donanım /
  yazılım) ve bayt cinsinden hedef verilir; **tek kare kodlanmadan** çözünürlüğü, video bit hızını,
  ses bit hızını ve beklenen dosya boyutunu (`plannedBytes`) söyler ya da reddeder. Ret, sığacak en
  küçük boyutu (`minBytes`) ve hedefe sığan en uzun süreyi (`maxDurationUs`) taşır: "Bu video bu
  boyuta sığmaz. Hedef 300 KB. En az 1,2 MB gerekir; ya da en çok 00:06 uzunluğunda bir kesit seç."
- **Çözünürlük merdiveni:** 1080 → 720 → 540 → 360 (kısa kenar). Projenin kalitesinden ve kaynağın
  gerçek piksel sayısından büyük basamak kullanılmaz (`maxTargetShortEdge`, `nativeShortEdge`: 9:16'ya
  kırpılmış yatay 1080p kaynakta karşıdan karşıya 608 gerçek piksel vardır; 720p'den büyüğü boşa bit).
  **480p yok:** donanım kodlayıcısında her ölçümde 540p aynı baytla daha iyi, 360p de ölçülen aralığın
  sonuna kadar eşit ya da daha iyi çıktı (854 piksel 16'nın katı değil).
- **Bit hızı, sonra çözünürlük:** önce bit hızı düşer; bir basamağın bit/piksel değeri ölçülen
  tabanın altına inecekse bir alt basamağa geçilir; en küçük basamakta taban ret eşiğidir. Olağan
  indirmenin bit hızı hiç aşılmaz: olağan indirme zaten sığıyorsa plan olağan indirmedir (`mode:
  'normal'`).
- **Ses:** 128 kbit/s; yalnızca hiçbir basamak 128 ile sığmıyorsa 96. 96'nın altı yok: Chrome, Edge
  ve Chromium (Windows) AAC için yalnızca 96, 128, 160, 192 kbit/s kabul ediyor (ölçüm aşağıda).
  İşçi, gecikmesini ölçemediği (ADR-032) ses bit hızıyla plan yapmaz: telefondaki Chrome 96 kbit/s'i
  "destekliyorum" diyor ama gecikme ölçümü tutmuyor; orada yalnızca 128 kullanılır.
- **ADR-024 ile ilişki:** hedef boyutta 3 kat kuralı **uygulanmaz** — bit hızını boyut belirler.
  Yazılım kodlayıcının farkı planlayıcıdadır: kendi tabanları (yazılım kodlayıcı az bitle aynı
  resmi veremez, bir alt çözünürlüğe iner) ve olağan indirmedeki 3 katlı bit hızı tavanı.
- **Sabit bit hızı:** hedef boyut kodlamasında kodlayıcıdan sabit bit hızı (`bitrateMode:
  'constant'`) istenir. Değişken modda donanım kodlayıcısı istenenin 1,07–1,30 katını (telefonda
  1,97 katını) yazdı; sabit modda 0,98–1,09 (telefonda 1,00). Aynı gerçek bit hızında SSIM aynı.
  Olağan indirme değişmedi (değişken).
- **Güvenlik payı:** hedefin %1'i boş bırakılır; video bütçesi kodlayıcı sınıfının ölçülen taşmasına
  bölünür (donanım 1,10, yazılım 1,02); MP4'ün resim ve ses olmayan baytları (tablolar) hesaba
  katılır.
- **Hızlı kesim (ADR-027):** hedef varken kaynağın kareleri yalnızca **kopya sığıyorsa** kopyalanır
  (boyutu bayt yazılmadan bilinir: kopyalanacak paketler + ses + tablolar). Sığıyorsa en iyi kalite
  odur (`mode: 'copy'`); sığmıyorsa tam kodlama çalışır ve sonuç sebebi söyler ("orijinal görüntü
  hedef boyuta sığmıyor").
- **Dosya ölçülür, gerekirse yeniden kodlanır:** yazılan video baytları kodlayıcıdan çıkarken
  sayılır. Dosya bitince boyutu, **kaydedilen dosya olmadan önce** okunur. Hedefin üstündeyse dosya
  atılır ve ölçülen oranla yeniden kodlanır (en çok 3 kodlama): az taşmışsa aynı çözünürlükte
  düzeltilmiş bit hızı (%3, sonra %6 pay); kodlayıcı istenenin 1,3 katından fazlasını yazmışsa
  (en kaba nicemlemesine dayanmış, daha az bit isteyemez) piksel sayısına göre sığacak en büyük alt
  basamak. Kodlama sürerken yazılan video tek başına hedefi geçtiyse o deneme hemen bırakılır.
  Son denemeden sonra dosya hâlâ büyükse **dosya kaydedilir ama "sığdı" denmez**: "55,1 MB — hedefin
  üstünde (hedef 52,4 MB). Dosya bu boyuta indirilemedi; daha kısa bir kesit ya da daha büyük bir
  hedef seç."
- Sonuç `result.targetSize` içinde planlananı ve gerçeği taşır (`plannedBytes`, `firstPlannedBytes`,
  `actualBytes`, `fits`, `attempts`, `shortEdge`, bit hızları, kodlayıcı sınıfı, `mode`).

### 2. Yalnızca ses

- Çıktı **M4A**: MP4 kabında AAC-LC, video izi yok, MIME `audio/mp4`, uzantı `.m4a`.
- Aynı miks (kesit kazancı, müzik ve zarfı, pay ve sınırlayıcı: `SegmentAudioWriter`), aynı hizalı
  AAC yolu (ADR-032: hazırlık kareleri 0'ın önünde, düzenleme listesi). **Görüntü hiç açılmaz**,
  çözülmez, çizilmez.
- **Süre örneğine kadar tam.** Video indirmesi 30 fps kare ızgarasındadır (6,75 sn'lik kesit 203
  kare = 6,7667 sn); ses dosyası için tarif örnek ızgarasında derlenir (`audioOnlyRecipe`: "kare
  hızı" = örnek hızı), 6,75 sn tam 324 000 örnek olur. Son AAC paketinin süresi sonda kesilir
  (`AacPacketAligner` `trimEnd`); paketin baytları değişmez, oynatıcı yazılan sürede durur. Video
  indirmesinin ses izi eskisi gibi tam AAC karesinde biter.
- **Paket kopyası yok**, her zaman yeniden kodlanır: kopya yalnızca AAC kare sınırında (48 kHz'te
  21 ms) kesebilir, kazanç ve müzik uygulanamaz; ses kodlaması zaten ucuz (60 sn ≈ 0,5–1 sn).
- Ses yoksa (kaynağın ses izi yok ya da bütün kesitler sessizde, müzik de yok) **kaydetme penceresi
  açılmadan** ret: "Bu videoda kaydedilecek ses yok…". İşçi aynı kontrolü dosyanın kendisinde yapar.
- Depolama tahmini video bit hızı 0 ile yapılır. Bellek yolunun 5 dakika sınırı ses dosyasına
  uygulanmaz (60 dakika ≈ 58 MB); çıktı sınırı (60 dakika) aynen geçerli.

### API (sihirbazın çağıracağı)

`useDownloads()` (`web/src/components/editor/useDownloads.ts`):

```ts
interface DownloadOptions {
  output?: 'video' | 'audio';                       // 'audio': .m4a
  targetSize?: { targetBytes: number; minShortEdge?: number }; // minShortEdge: 720 → 720p'nin altına inme
}
downloads.start(target, options?)                   // tıklamanın içinde, eşzamanlı çağrılmalı (ADR-026)
downloads.previewTargetSize(target, request)        // Promise<TargetSizePreview>; hiçbir şey kodlamaz
```

`SIZE_PRESETS` (`targetSize.ts`): `share` 52 428 800, `email` 25 000 000, `whatsapp` 16 000 000 bayt.
`previewTargetSize` → `{ ok: true, decision: { shortEdge, width, height, videoBitrate, audioBitrate,
plannedBytes, mode }, durationUs, estimatedSeconds }` ya da `{ ok: false, reason: 'target_too_small',
refusal: { minBytes, maxDurationUs, shortEdge } }`. `plannedBytes`, kodlayıcı bit hızının tamamını
kullanırsa çıkacak boyuttur; durağan içerik daha küçük çıkar.

İşçi isteği (`protocol.ts`): `output?: 'video' | 'audio'`, `targetSize?: { targetBytes,
minShortEdge?, maxShortEdge }`. Test kancası: `window.__clipExportOptions` (olağan indirme düğmesi bu
seçeneklerle çalışır; `forced` alanı yalnızca ölçüm içindir).

## Belge 15 ile ilişki (kurucu sorusu)

Belge 15'in ilgili satırı: **"720p / 1080p, SDR, en çok 30 fps | Desteklenen cihazda dahil"** ve v6
notunda "720p/1080p katmanındaki boyutlardan (1280×720, 720×1280, 720×720, 1920×1080, 1080×1920,
1080×1080) farklı her kaynak eskisi gibi seçilen çözünürlükte 30 fps'ye kodlanır." Bunlar hangi
kalitelerin **dahil** olduğunu ve hızlı kesimin hangi boyutlarda çalıştığını söylüyor; daha düşük
çözünürlükte çıktıyı **yasaklayan** bir cümle yok. Bu yüzden 540p/360p'ye inme planlayıcının
arkasında uygulandı ve varsayılan açık (`DEFAULT_MIN_SHORT_EDGE = 360`); belge 15'e dokunulmadı.
Kurucu "720p'nin altı olmaz" derse sihirbaz `minShortEdge: 720` geçer (ya da varsayılan 720
yapılır): o zaman 16 MB'a 720p'de en çok ~2 dk 27 sn (donanım kodlayıcısı, 0,025 bit/piksel ret
tabanı, 96 kbit/s ses) sığar, daha uzunu reddedilir; 360p'ye inilebildiğinde aynı hedefe ~7 dakika
sığar.

## Hazır hedefler ve kaynakları

| Hedef | Bayt | Kaynak |
|---|---|---|
| Paylaş | 52 428 800 (50 MiB) | Ölçüm, [ADR-031](ADR-031-phone-share-install-offline.md): Chromium `navigator.share` 50 MiB + 1 baytı reddediyor. |
| E-posta | 25 000 000 | Google Gmail yardımı (support.google.com/mail/answer/6584, 3 Ekim 2026'da okundu): "For personal Gmail accounts, the limit is 25 MB"; aşılırsa ek Drive bağlantısına çevriliyor. Sayfa MB'ın 10⁶ mı 2²⁰ mi olduğunu söylemiyor: küçük olan okuma kullanıldı. Ek, iletide base64 ile ~%37 büyür; Gmail'in 25 MB'ı dosya boyutuna mı iletiye mi uyguladığı **ölçülmedi** (Gmail'e dosya gönderilmedi). Başka sağlayıcıların sınırı farklıdır. |
| WhatsApp | 16 000 000 | Meta, WhatsApp Business Platform medya belgesi (developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media, 3 Ekim 2026'da okundu): Video "16 MB", ses "16 MB", belge "100 MB". WhatsApp yardım merkezi (faq.whatsapp.com/239536730601513) arama dizininde aynı 16 MB'ı veriyor; sayfanın kendisi bu oturumda açılamadı. Birim belirsizliği için küçük okuma. **Denenmedi:** WhatsApp uygulamasının kendisi (video olarak gönderince kendi yeniden kodlaması var; "belge" olarak gönderince sınır çok daha yüksek). |

Doğrulanamayan bir sayı hazır hedef yapılmadı (ör. Telegram, Discord, iMessage yok).

## Ölçüm

Tek makine (Windows 11, bu bilgisayarın GPU kodlayıcısı), n=1. Araç:
`web/scripts/measure-target-size.mjs` (gerçek uygulama üzerinden; `forced` kancasıyla tam o boyut ve
bit hızında tek kodlama). Kayıtlar (`tests/media/real`, dosya adları yerelde): **S21** 1080p60 telefon,
çok ayrıntılı ve hareketli, 4 sn; **IP11** 1080p30 telefon, 10 sn; **IP13** 1080p60 telefon, 10 sn;
**GOPRO** 720p60 aksiyon kamerası, 10 sn; **PIX4K** 4K HEVC telefon, 10 sn (Chromium ve Edge bu
dosyayı açamadı: HEVC çözücü yok). SSIM: çıktı, kaydın **en üst basamağına** (1080p ya da 720p)
büyütülüp aynı aralığın ffmpeg referansıyla karşılaştırıldı; yani küçük çözünürlük kaybettiği
ayrıntının bedelini öder.

### Donanım kodlayıcısı, sabit bit hızı (Edge 154; Chrome 154 aynı kodlayıcı, aynı sayılar)

Hücre: SSIM · gerçek kbit/s · gerçek/istenen.

| Kayıt, basamak | 0,025 bit/piksel | 0,04 | 0,06 | 0,09 |
|---|---|---|---|---|
| S21 1080 | 0,765 · 1657 · 1,07 | 0,810 · 2641 · 1,06 | 0,849 · 3918 · 1,05 | 0,887 · 5848 · 1,04 |
| S21 720 | 0,742 · 737 · 1,07 | 0,771 · 1172 · 1,06 | 0,801 · 1760 · 1,06 | 0,834 · 2641 · 1,06 |
| S21 540 | 0,727 · 416 · 1,07 | 0,748 · 673 · 1,08 | 0,771 · 992 · 1,06 | 0,799 · 1485 · 1,06 |
| S21 360 | 0,712 · 184 · 1,06 | 0,724 · 302 · 1,09 | 0,738 · 442 · 1,07 | 0,757 · 661 · 1,06 |
| IP11 1080 | 0,944 · 1551 · 1,00 | 0,959 · 2478 · 1,00 | 0,969 · 3717 · 1,00 | 0,978 · 5556 · 0,99 |
| IP11 720 | 0,926 · 687 · 0,99 | 0,939 · 1100 · 0,99 | 0,950 · 1650 · 0,99 | 0,960 · 2474 · 0,99 |
| IP11 540 | 0,913 · 386 · 0,99 | 0,924 · 619 · 1,00 | 0,934 · 931 · 1,00 | 0,944 · 1392 · 0,99 |
| IP11 360 | 0,893 · 170 · 0,98 | 0,900 · 275 · 0,99 | 0,906 · 412 · 0,99 | 0,914 · 620 · 1,00 |
| IP13 1080 | 0,872 · 1565 · 1,01 | 0,909 · 2526 · 1,02 | 0,932 · 3745 · 1,00 | 0,951 · 5702 · 1,02 |
| IP13 720 | 0,823 · 690 · 1,00 | 0,857 · 1109 · 1,00 | 0,881 · 1678 · 1,01 | 0,902 · 2517 · 1,01 |
| IP13 540 | 0,782 · 387 · 1,00 | 0,813 · 625 · 1,00 | 0,836 · 940 · 1,01 | 0,856 · 1409 · 1,01 |
| IP13 360 | 0,729 · 171 · 0,99 | 0,751 · 276 · 1,00 | 0,767 · 415 · 1,00 | 0,783 · 623 · 1,00 |
| GOPRO 720 | 0,961 · 686 · 0,99 | 0,971 · 1102 · 1,00 | 0,976 · 1629 · 0,98 | 0,979 · 2433 · 0,98 |
| GOPRO 540 | 0,949 · 386 · 0,99 | 0,962 · 620 · 1,00 | 0,969 · 924 · 0,99 | 0,974 · 1372 · 0,98 |
| GOPRO 360 | 0,924 · 171 · 0,99 | 0,941 · 275 · 0,99 | 0,951 · 413 · 0,99 | 0,958 · 613 · 0,99 |

**Taşma (gerçek/istenen video baytı):** sabit modda dört kayıtta 0,98–1,02, S21'de 1,04–1,09.
Değişken modda (Chrome 154, 168 kodlama): IP11/IP13/GOPRO/PIX4K 0,85–1,12 (ortanca 1,07), S21
1,15–1,47; Edge değişken: 1,07–1,27. → `VIDEO_OVERSHOOT.hardware = 1,10`, sabit mod.

**Basamak eşiği (alt basamağın aynı baytla eşit ya da daha iyi SSIM verdiği en yüksek bit/piksel,
üst basamağın pikseliyle; değişken mod ızgarası, 0,015–0,13 bit/piksel):**

| Geçiş | S21 | IP11 | IP13 | GOPRO | PIX4K |
|---|---|---|---|---|---|
| 1080 → 720 | ≥ 0,074 (ölçülen aralığın sonuna kadar) | 0,049 | 0,029 | — | 0,023 |
| 720 → 540 | ≥ 0,095 | 0,027 | 0,021 | ≥ 0,079 | 0,019 |

Eşik içeriğe bağlı: olağan telefon kaydında 0,02–0,05, çok ayrıntılı kayıtta 0,07'nin üstü.
1080 → 720 geçişlerinin ortancası 0,04 → `STEP_DOWN_BITS_PER_PIXEL.hardware = 0,04`. Sabit mod
ızgarasında aynı geçiş 0,031 (IP13) ile ≥ 0,040–0,042 (IP11, S21: ölçülen aralığın sonu) arasında.

**Ret tabanı (en küçük basamak):** 0,025 bit/piksel. Altında kalite eğrisi kırılıyor (IP13 1080p,
değişken: 0,035 → 0,025'te SSIM −0,023, 0,025 → 0,015'te −0,066; 720p: −0,019 ve −0,056) ve değişken
modda kodlayıcı hedefini tutmuyor (0,015'te 0,85–1,47). → `REFUSE_BITS_PER_PIXEL.hardware = 0,025`.
Bu bir "kabul edilebilir" eşiği, "iyi" değil: 360p'de 0,025 bit/pikselde SSIM (1080p referansa karşı)
0,71–0,89. Sonuç ekranı hangi çözünürlükte kodlandığını söyler.

**480p (854×480), donanım:** GOPRO'da 0,09 bit/pikselde 480p 0,945, 360p 0,960, 540p 0,975; IP11'de
480p 0,913, 360p 0,915; IP13'te 480p 0,784, 360p 0,784, 540p 0,856. 480p hiçbir ölçümde kazanmadı.

### Yazılım kodlayıcısı (Playwright Chromium 153, OpenH264; sabit ve değişken mod aynı)

| Kayıt, basamak | 0,025 bit/piksel | 0,045 | 0,06 | 0,09 |
|---|---|---|---|---|
| S21 1080 | 0,876 · 8686 · 5,59 | 0,877 · 8847 · 3,16 | 0,877 · 8883 · 2,38 | 0,880 · 9532 · 1,70 |
| S21 720 | 0,829 · 3873 · 5,60 | 0,830 · 3979 · 3,20 | 0,830 · 3969 · 2,39 | 0,832 · 4129 · 1,66 |
| S21 540 | 0,803 · 2358 · 6,06 | 0,804 · 2439 · 3,48 | 0,804 · 2436 · 2,61 | 0,806 · 2533 · 1,81 |
| S21 360 | 0,752 · 825 · 4,77 | 0,754 · 866 · 2,78 | 0,755 · 893 · 2,15 | 0,755 · 899 · 1,45 |
| IP11 1080 | 0,931 · 1802 · 1,16 | 0,947 · 2759 · 0,99 | 0,957 · 3661 · 0,98 | 0,969 · 5493 · 0,98 |
| IP11 720 | 0,915 · 757 · 1,10 | 0,930 · 1225 · 0,98 | 0,939 · 1625 · 0,98 | 0,952 · 2448 · 0,98 |
| IP11 540 | 0,905 · 436 · 1,12 | 0,917 · 693 · 0,99 | 0,925 · 917 · 0,98 | 0,936 · 1378 · 0,98 |
| IP11 360 | 0,891 · 177 · 1,02 | 0,902 · 311 · 1,00 | 0,908 · 415 · 1,00 | 0,916 · 621 · 1,00 |
| IP13 1080 | 0,894 · 3237 · 2,08 | 0,895 · 3299 · 1,18 | 0,903 · 3723 · 1,00 | 0,929 · 5579 · 1,00 |
| IP13 720 | 0,846 · 1427 · 2,06 | 0,847 · 1465 · 1,18 | 0,855 · 1657 · 1,00 | 0,880 · 2470 · 0,99 |
| IP13 540 | 0,814 · 943 · 2,42 | 0,815 · 970 · 1,39 | 0,816 · 980 · 1,05 | 0,834 · 1394 · 1,00 |
| IP13 360 | 0,758 · 363 · 2,10 | 0,761 · 387 · 1,24 | 0,764 · 421 · 1,01 | 0,781 · 622 · 1,00 |
| GOPRO 720 | 0,939 · 699 · 1,01 | 0,961 · 1232 · 0,99 | 0,967 · 1637 · 0,99 | 0,974 · 2450 · 0,98 |
| GOPRO 540 | 0,927 · 393 · 1,01 | 0,953 · 692 · 0,99 | 0,960 · 922 · 0,99 | 0,968 · 1379 · 0,99 |
| GOPRO 360 | 0,905 · 180 · 1,04 | 0,931 · 312 · 1,00 | 0,941 · 415 · 1,00 | 0,951 · 623 · 1,00 |

- Yazılım kodlayıcı, **içeriğe bağlı bir hızın altına inemiyor**: daha az bit istenince aynı baytı
  yazıyor (en kaba nicemleme). Ölçülen taban: 0,023–0,028 bit/piksel (IP11, GOPRO), 0,052 (IP13),
  0,14 (S21). Tabanın üstünde hedefi çok iyi tutuyor (0,98–1,00).
- Bu yüzden yazılımda hem "basamak eşiği" hem ret tabanı kodlayıcının tabanıdır:
  `STEP_DOWN_BITS_PER_PIXEL.software = REFUSE_BITS_PER_PIXEL.software = 0,07`. 10 sn'lik parçalarda
  taban 0,023–0,052 ölçüldü (1080 ↔ 720 SSIM geçişi 0,056–0,057'de), ama **kaydın tamamında** (IP11,
  5 dk 41 sn, 360p) kodlayıcı 0,062 bit/pikselin altına inemedi; 0,07 bunun hemen üstü (aşağıda
  "Hedefe karşı gerçek boyut"). `VIDEO_OVERSHOOT.software = 1,02`.
- Tabanı plandan yüksek olan kayıt (S21 gibi) ilk denemede taşar; düzeltme, ölçülen baytı piksel
  sayısıyla ölçekleyip sığacak basamağa iner (doymuş kodlayıcıda bayt piksel sayısını izliyor: S21
  1080 → 720 → 540 → 360: 8686 → 3873 → 2358 → 825 kbit/s; piksel oranları 0,44 / 0,25 / 0,11, bayt
  oranları 0,45 / 0,27 / 0,095).
- Doymuş hâlde bile kendi en üst basamağında SSIM 0,876–0,931 (ADR-014'ün 0,85 eşiğinin üstünde).

### Kap baytları

Dosya − (video paketleri + ses paketleri): 4 sn'de 2500–2502, 10 sn'de 4448–4454 bayt (30 fps,
48 kHz AAC) → ~325 bayt/sn + ~1200. Model: 1500 + 5 bayt/kare + 4 bayt/AAC paketi (10 sn: 4687 ≥
4454). AAC 128 kbit/s gerçekte 128,2–128,8 kbit/s.

### AAC bit hızları (`AudioEncoder.isConfigSupported`, AAC-LC 48 kHz stereo)

| kbit/s | 32 | 48 | 64 | 80 | 96 | 112 | 128 | 160 | 192 |
|---|---|---|---|---|---|---|---|---|---|
| Chrome 154, Edge 154, Chromium 153 (Windows) | hayır | hayır | hayır | hayır | evet | hayır | evet | evet | evet |
| Chrome 154 (Android, Galaxy S23) | evet | evet | evet | evet | evet* | evet | evet | evet | evet |

\* Telefonda 96 kbit/s ile kodlama "Bu tarayıcının ses kodlayıcısı sesi görüntüyle hizalı yazamadı"
ile reddedildi (ADR-032 gecikme ölçümü tutmadı; neden tutmadığı incelenmedi). İşçi artık böyle bir bit
hızıyla plan yapmıyor (`audioBitrates`). Sayfadaki ön izleme bunu bilmez: telefonda yalnızca 96
kbit/s ile sığan çok dar bir hedefte ön izleme "sığar" der, işçi "sığmaz, en az X" diye reddeder
(dosya yazılmaz).

## Hedefe karşı gerçek boyut

Gerçek hedef boyut indirmeleri (`measure-target-size.mjs --mode=targets`, uygulamanın kendisinden,
olağan indirme düğmesi + `__clipExportOptions`), 3–4 Ekim 2026, ölçüm kilidi altında. "Plan": kodlamadan
önce söylenen boyut (`firstPlannedBytes`). SSIM: 1080p (GOPRO'da 720p) referansa karşı; 90 sn'den
uzun çıktıda ölçülmedi.

**Chrome 154 (donanım kodlayıcısı). Edge 154: PIX4K dışındaki 17 satırın hepsi bayt bayt aynı** (aynı
GPU kodlayıcısı; Edge 4K HEVC dosyayı açamadı).

| Kayıt, süre | Hedef (bayt) | Plan | Gerçek | Hedefin | Çözünürlük | Deneme | Süre | SSIM |
|---|---|---|---|---|---|---|---|---|
| IP11 5 dk 41 sn | 52 428 800 | 47 692 496 | 47 532 650 | %90,7 | 540p | 1 | 26,3 sn | — |
| IP11 5 dk 41 sn | 25 000 000 | 23 006 568 | 22 932 374 | %91,7 | 360p | 1 | 24,5 sn | — |
| IP11 5 dk 41 sn | 16 000 000 | 14 906 582 | 14 795 584 | %92,5 | 360p | 1 | 25,4 sn | — |
| IP11 60 sn | 52 428 800 | 42 972 164 | 43 087 445 | %82,2 | 1080p (olağan indirme sığıyor) | 1 | 10,9 sn | 0,962 |
| IP11 60 sn | 16 000 000 | 14 489 249 | 14 513 978 | %90,7 | 720p | 1 | 7,3 sn | 0,921 |
| IP11 60 sn | 5 000 000 | 4 589 249 | 4 577 131 | %91,5 | 360p | 1 | 6,7 sn | 0,862 |
| IP11 60 sn | 2 000 000 | **ret** (31 ms): "En az 2,2 MB gerekir; ya da en çok 00:54.808…" | | | | | | |
| IP13 88 sn | 52 428 800 | 47 316 747 | 47 268 851 | %90,2 | 1080p | 1 | 15,6 sn | 0,930 |
| IP13 88 sn | 25 000 000 | 22 630 833 | 22 593 869 | %90,4 | 720p | 1 | 12,2 sn | 0,885 |
| IP13 88 sn | 16 000 000 | 14 530 829 | 14 507 220 | %90,7 | 720p | 1 | 9,9 sn | 0,852 |
| IP13 88 sn | 8 000 000 | 7 330 834 | 7 306 773 | %91,3 | 360p | 1 | 9,2 sn | 0,775 |
| S21 4 sn | 2 000 000 | 1 806 079 | 1 913 150 | %95,7 | 1080p | 1 | 1,9 sn | 0,843 |
| S21 4 sn | 1 000 000 | 906 079 | 956 850 | %95,7 | 720p | 1 | 1,3 sn | 0,802 |
| S21 4 sn | 500 000 | 456 079 | 482 745 | %96,5 | 540p | 1 | 1,1 sn | 0,760 |
| GOPRO 16 sn | 16 000 000 | 5 239 552 | 5 219 075 | %32,6 | 720p (olağan indirme sığıyor) | 1 | 2,7 sn | 0,971 |
| GOPRO 16 sn | 4 000 000 | 3 623 900 | 3 615 299 | %90,4 | 720p | 1 | 2,1 sn | 0,968 |
| GOPRO 16 sn | 2 000 000 | 1 823 900 | 1 823 290 | %91,2 | 540p | 1 | 1,8 sn | 0,958 |
| PIX4K 10 sn | 16 000 000 | 7 163 288 | 7 161 452 | %44,8 | 1080p (olağan indirme sığıyor) | 1 | 2,8 sn | 0,914 |
| PIX4K 10 sn | 3 000 000 | 2 714 990 | 2 715 153 | %90,5 | 720p | 1 | 1,8 sn | 0,857 |

Donanımda 18 indirmenin 18'i **ilk denemede** hedefin altında (bit hızı düşürülen 15'i hedefin
%90–97'sinde; plan ile gerçek
arasındaki fark en çok %5,9 — S21, kodlayıcı orada 1,06 yazıyor); yeniden kodlama hiç gerekmedi.

**Playwright Chromium 153 (yazılım kodlayıcısı, OpenH264), son tabanlarla (0,07 bit/piksel):**

| Kayıt, süre | Hedef (bayt) | Plan | Gerçek | Hedefin | Çözünürlük | Deneme | Süre | SSIM |
|---|---|---|---|---|---|---|---|---|
| IP11 5 dk 41 sn | 52 428 800 | 50 541 785 | 51 369 062 | %98,0 | 360p | 1 | 110,9 sn | — |
| IP11 5 dk 41 sn | 25 000 000 | **ret**: "En az 25,5 MB gerekir; ya da en çok 05:34.315…" | | | | | | |
| IP11 5 dk 41 sn | 16 000 000 | **ret**: "En az 25,5 MB gerekir; ya da en çok 03:33.954…" | | | | | | |
| IP11 60 sn | 52 428 800 | 50 406 782 | 50 710 746 | %96,7 | 1080p | 1 | 22,3 sn | 0,954 |
| IP11 60 sn | 16 000 000 | 15 402 993 | 15 988 569 | %99,9 | 720p | 1 | 19,5 sn | 0,909 |
| IP11 60 sn | 5 000 000 | 4 833 283 | 4 920 294 | %98,4 | 360p | 1 | 19,3 sn | 0,861 |
| IP11 60 sn | 2 000 000 | **ret**: "En az 4,5 MB gerekir; ya da en çok 00:26.726…" | | | | | | |
| IP13 88 sn | 52 428 800 | 50 420 233 | 44 740 250 | %85,3 | 720p | 2 | 73,9 sn | 0,902 |
| IP13 88 sn | 25 000 000 | 24 064 385 | 22 382 052 | %89,5 | 540p | 2 | 63,3 sn | 0,851 |
| IP13 88 sn | 16 000 000 | 15 416 440 | 13 259 582 | %82,9 | 360p | 3 | 97,6 sn | 0,800 |
| IP13 88 sn | 8 000 000 | 7 729 385 | 7 710 759 | %96,4 | 360p | 3 | 95,2 sn | 0,768 |
| S21 4 sn | 2 000 000 | 1 923 732 | 1 535 962 | %76,8 | 540p | 3 | 5,7 sn | 0,813 |
| S21 4 sn | 1 000 000 | 962 849 | 767 420 | %76,7 | 360p | 2 | 3,2 sn | 0,776 |
| S21 4 sn | 500 000 | 482 408 | **529 579** | **%105,9 — sığmadı** | 360p | 3 | 4,8 sn | 0,756 |
| GOPRO 16 sn | 16 000 000 | 15 043 533 | 14 966 471 | %93,5 | 720p (olağan, 3 kat bit hızı) | 1 | 5,5 sn | 0,975 |
| GOPRO 16 sn | 4 000 000 | 3 851 263 | 3 847 813 | %96,2 | 540p | 1 | 5,6 sn | 0,964 |
| GOPRO 16 sn | 2 000 000 | 1 929 496 | 1 948 553 | %97,4 | 360p | 1 | 5,5 sn | 0,950 |

PIX4K: Chromium dosyayı açamadı (HEVC çözücü yok). Yazılımda kodlanan 14 indirmenin 13'ü hedefin
altında; **6'sı yeniden kodlama gerektirdi** (2 ya da 3 deneme: kodlayıcı o çözünürlükte tabanına
dayandı, bir alt basamağa inildi) ve **1'i (S21, 500 KB) üç denemeden sonra da sığmadı**: dosya
kaydedildi, ekranda "530 KB — hedefin üstünde (hedef 500 KB). Dosya bu boyuta indirilemedi…" yazdı,
"sığdı" denmedi. Üç hedef kodlamadan önce reddedildi.

Yazılım tabanı ilk ölçümde 0,03 / 0,055 idi; o tabanlarla aynı koşuda IP11 5 dk 41 sn 16 MB hedefi
kabul edilip 132 sn kodlandı ve 23,7 MB çıktı (%148, "sığmadı"), 25 MB hedefi 251 sn'de 26,5 MB
(%106) çıktı. Tabanlar bu yüzden 0,07'ye çekildi ve tablo yeniden koşuldu; artık ikisi de kodlamadan
önce reddediliyor. Çok ayrıntılı kısa kayıtta (S21) taban 0,12–0,14: orada hâlâ kodlayıp dürüst sonuç
veriyor.

**Sentetik (matris ve e2e):** M20 (8 sn, 9:16 kırpma, hedef 1 MB): Chrome/Edge 526 761 bayt, 540p;
Chromium 593 057 bayt, 360p (SSIM 0,919) — durağan test deseni bit hızının tamamını kullanmıyor, bu
yüzden gerçek boyut planın (912 019 / 964 771) epey altında. M20c (20 sn, hedef 52,4 MB): kaynak
kopyalandı, 481 630 bayt. e2e (Chromium): 4/12/24 sn × 7 hedef, hepsi hedefin altında; gürültülü 8 sn
klip 6 MB hedefe 2 denemede 5 952 415 bayt.

## Yalnızca ses: ne oynatıyor

`measure-target-size.mjs --mode=audio` (gerçek kayıtlar, uygulamanın kendisinden) ve
`check-audio-playback.mjs` (oynatma). Dosyalar: 60 sn (IP11), 20,5 sn (IP13), 3,5 sn (S21), 8,2 sn
(GOPRO) — Chrome 154, Edge 154 ve Chromium 153'te üretildi; ayrıca telefonda üretilen iki dosya.

| Denetim | Sonuç |
|---|---|
| ffprobe | Kap `mov,mp4,m4a,…`, marka `isom`; tek iz `aac` (LC), 48 kHz stereo, ~128 kbit/s; video izi yok. İz ve dosya süresi **tam** 60 / 20,5 / 3,5 / 8,2 sn (0 örnek sapma). |
| ffmpeg çözme | 2 880 000 / 984 000 / 168 000 örnek: sürenin tam karşılığı. Kaynağın aynı aralığındaki sese göre kayma 0 ms (8 kHz çapraz ilinti, ±200 ms). |
| Chrome 154 `<audio>` | `canPlayType('audio/mp4; codecs="mp4a.40.2"')` = `probably`; `duration` tam; çalıyor, `ended` yazılan sürede; hata yok. `decodeAudioData`: örnek sayısı ffmpeg ile aynı, kayma 0 örnek. |
| Edge 154 `<audio>` | Aynı. |
| Windows Media Foundation (başsız, `mf-audio.ps1`: WAV'a çevirme) | Açıyor ve çözüyor; ses ffmpeg çözümüne göre 0 örnek kaymış. Sonda 64–608 örnek (1–13 ms) fazlası var: MF son AAC paketinin kısaltılmış süresini uygulamıyor. |
| Telefonda üretilen dosyalar (V, W) | ffprobe/ffmpeg/Chrome/Edge: süre tam (5,3 ve 3,5 sn), kayma 0 (düzenleme listesi 2048 hazırlık karesini atlatıyor). **Media Foundation düzenleme listesini uygulamıyor:** ses 2048 örnek (42,7 ms) geç başlıyor, sonda da fazlalık var. Yalnızca ses dosyasında eşlenecek görüntü olmadığı için duyulur bir kusur değil, ama kayıt altında. |
| Süre | 60 sn'lik ses dosyası masaüstünde 1,9 sn'de, telefonda 3,5–5,3 sn'lik dosyalar 0,5 sn'de üretildi (düğmeden "Kaydedildi"ye). |

**Denenmedi:** Windows Media Player / Groove'un kendisi (yalnızca aynı Media Foundation hattı,
başsız), VLC, iOS/macOS, Android'in müzik uygulamaları, WhatsApp'ın M4A'yı nasıl gösterdiği, telefonun
kendi `<audio>` oynatıcısı. Dosyanın `ftyp` markası `isom` (mediabunny `M4A ` yazmıyor); denenen hiçbir
oynatıcı buna takılmadı.

## Telefon (Galaxy S23, Android 16, Chrome 154; `phone-run.mjs` S–Z2, yerel derleme, adb reverse)

Kaydetme penceresi yer tutucuyla (OPFS) geçildi; kalite 1080p; dosyalar bilgisayarda ffprobe/ffmpeg
ile ölçüldü. Telefon ikinci oturumda bağlı değildi: aşağıdakiler ilk oturumun (birleştirme öncesi,
aynı motor kodu) sonuçlarıdır ve birleştirmeden sonra telefonda **yeniden koşulmadı**.

| # | Kaynak, kesit | İstek | Sonuç |
|---|---|---|---|
| S | S21 1080p60, 0,5–4 sn | hedef 1 000 000 bayt | 911 760 bayt (plan 905 337), 720×1280, 1 deneme, video gerçek/istenen 1,0009; 105/105 kare doğru; ses kayması 0 ms |
| T | 3 dk 1080×1920, tamamı | hedef 16 000 000 (WhatsApp) | 14 667 113 bayt (plan 14 667 464), 360×640, 1 deneme, oran 1,0000; 5400/5400 kare doğru; 26,6 sn. Kopya sığmadığı için tam kodlama ("orijinal görüntü hedef boyuta sığmıyor"). |
| U | 3 dk 1080×1920, 10–40 sn | hedef 4 000 000 | 3 646 053 bayt (plan 3 644 693), 540×960, 1 deneme, oran 0,9998; 900/900 kare doğru; 6,1 sn |
| X | S21, 0,5–4 sn | zorla 720p 1,5 Mbit/s **sabit** | video gerçek/istenen **1,0034** |
| Y | S21, 0,5–4 sn | zorla 720p 1,5 Mbit/s **değişken** | video gerçek/istenen **1,9735** |
| Z | 3 dk klip, 10–40 sn | zorla 720p 1,5 Mbit/s sabit | 0,9986 |
| Z2 | 3 dk klip, 10–40 sn | zorla 1080p 3 Mbit/s, ses 96 kbit/s | **Reddedildi:** "Bu tarayıcının ses kodlayıcısı sesi görüntüyle hizalı yazamadı…" (96 kbit/s'te gecikme ölçümü tutmuyor; dosya yazılmadı). Bunun üzerine işçi 96'yı yalnızca gecikmesi ölçülebiliyorsa planlıyor. |
| V | senkron klibi, 1,2–6,5 sn | yalnızca ses | M4A, 254 400 örnek = tam 5,3 sn; ilk paketler −2048, −1024, 0 (`skip_samples` 2048); kaynağa göre kayma 0 ms (ilinti 0,9999); 0,5 sn |
| W | S21, 0,5–4 sn | yalnızca ses | M4A, 168 000 örnek = tam 3,5 sn; kayma 0 ms; 0,5 sn |

Telefonun AAC kodlayıcısı 32–192 kbit/s'in hepsine "destekliyorum" diyor (`aac-bitrate-probe.mjs`);
H.264 kodlayıcısı 360p–1080p'de donanım, sabit ve değişken mod destekli görünüyor. Koşulardan sonra
betiğin açtığı sekmeler kapatıldı, site verisi (OPFS, IndexedDB, localStorage, servis çalışanı,
önbellekler) silindi, `adb reverse` ve `adb forward` eşlemeleri kaldırıldı.

## Testler

> **ARA KAYIT (4 Ekim 2026, oturum kapanırken):** bu bölüm henüz tamamlanmadı.
>
> **Biten ölçümler (ölçüm kilidi altında, main birleştirildikten sonraki derlemeyle):** matris
> Chromium 27/27 (son yazılım tabanlarıyla yeniden koşuldu), Chrome 27/27, Edge 27/27 (son iki
> koşu yazılım tabanı ve ret başlığı değişikliğinden önceki derlemeyle; donanım yolunu etkilemez);
> gerçek kayıtlar Chrome 15/15; hedef boyut tabloları Chrome, Edge (birleştirmeden önceki derleme,
> aynı motor kodu) ve Chromium (son tabanlarla); yalnızca ses Chrome/Edge/Chromium; sabit bit hızı
> ızgaraları; oynatma denetimi; telefon S–Z2 (ilk oturum).
> Birim testleri: 731/731 (50 dosya), `tsc`, `eslint` temiz, `npm run build` geçti.
> Yeni e2e dosyaları (`target-size.spec.ts`, `audio-only.spec.ts`): 9/9, ama **yazılım tabanı 0,07'ye
> çekilmeden önceki** derlemeyle.
>
> **Bitmeyen / yeniden koşulacak:** tam `npx playwright test` (E2E_PORT=3311) **hiç koşmadı** (kilit
> sırası beklenirken oturum kapandı) — yeni iki e2e dosyası da son derlemeyle yeniden koşulmalı;
> Chrome ve Edge matrisi ile `run-real-media --browser=chrome` son derlemeyle yeniden koşulmalı;
> telefon birleştirmeden sonra koşulmadı (bağlı değildi); CHANGELOG girdisi yazılmadı.

## Ölçülmeyen / denenmeyen

- **WhatsApp ve e-posta uygulamalarının kendisi:** dosya hiçbir yere gönderilmedi. 16 MB ve 25 MB
  belgelerden; WhatsApp'ın video olarak gönderirken yaptığı yeniden kodlama, iOS/Android
  WhatsApp'ın M4A'yı ses olarak mı belge olarak mı gösterdiği, Gmail'in 25 MB'ı nasıl saydığı
  denenmedi.
- **iOS / Safari / macOS** (hedef çıktı tarayıcısı değil), **Firefox** (AAC kodlayıcı yok), VLC,
  QuickTime, araba / hoparlör gibi cihazlar.
- **Başka GPU'lar:** donanım kodlayıcısının taşması ve basamak eşikleri tek masaüstü GPU'da ve tek
  telefonda ölçüldü. Başka kodlayıcı daha çok taşarsa ikinci deneme devreye girer; dosya yine
  ölçülür ve hedefin üstündeyse "sığdı" denmez.
- **Algısal kalite:** eşikler SSIM'e dayanıyor (VMAF yok: bu makinedeki ffmpeg'de libvmaf yok);
  kimse izleyip puanlamadı. Ses bit hızının 96'ya inmesinin duyulur etkisi ölçülmedi.
- **Uzun çıktılar:** en uzun hedef boyut ölçümü 5 dk 41 sn (masaüstü) ve 3 dk (telefon); 60 dakikalık
  hedef boyut indirmesi denenmedi (iki-üç kez kodlama gerekirse süre o kadar katlanır).
- **Tahmini süre** (`estimateEncodeSeconds`): bu masaüstünde ölçülen hızlardan kaba bir sayı;
  telefon ve başka makineler için ölçülmedi, ilerleme çubuğu bunu kullanmaz.
- Altyazılı (yakılan) hedef boyut indirmesi: altyazı her denemede o çözünürlükte yeniden yerleştirilir;
  birim/e2e ile değil yalnızca kod yoluyla kapsandı (ayrı ölçüm yapılmadı).

## Sonuçlar

- Olağan indirme (hedefsiz) bit bit aynı yoldan geçer: bit hızı, mod, hızlı kesim kuralları
  değişmedi. Tek ortak değişiklik: kaydetme penceresinde seçilen dosya artık muxer akışı kapatınca
  değil doğrulamadan hemen önce (`collect`) yerine taşınıyor; böylece hedefi aşan deneme, seçilen
  dosyaya hiç dokunmadan atılabiliyor.
- Yan bulgu (düzeltilmedi, ayrı iş): telefonda **olağan** indirmenin donanım kodlayıcısı değişken
  modda istenen bit hızının ~2 katını yazıyor (Y durumu: 1,5 Mbit/s istenen, 2,96 gerçek). Olağan
  indirmeler telefonda planın söylediğinden büyük çıkıyor (ADR-023 tahmini %10 pay + 32 MiB ile bunu
  kısa videolarda karşılıyor; uzun videoda ölçülmedi). Sabit moda geçmek kalite/boyut dengesini
  değiştireceği için kurucu kararı gerektirir.
