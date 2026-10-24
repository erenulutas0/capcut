# ADR-052 — "GIF yap": her zaman en net olan — paylaşılabilen en büyük boyut ve "Video olarak (en net)"

> Tarih: 2026-10-21 · Durum: UYGULANDI (web; birim, e2e, kalite katmanı; sayılar aşağıda). Telefonda, Safari'de,
> Firefox'ta ve sohbet uygulamalarında **denenmedi**. Politika **değişmedi** (doc 15 `2026-10-18.v12`: GIF yap
> ücretsiz, cihazda, en çok 10 sn; video çıktısı olağan, ücretsiz, cihazda indirmenin aynısı ve aynı 10 sn'lik kısım);
> şema **değişmedi** (EDL v6; GIF ekranı proje saklamaz).
> Kaynak: kurucunun hedefi — "bence her zaman en neti vermeliyiz" — ve ana oturumun iki kararı (kurucu devretti).
> **Ek (aynı gün, en altta):** ana oturumun beş kararı — bekleme en çok 8 sn, ilk seçim tahmin ≤ 9 MB, varsayılan GIF,
> videonun kendi bit hızı (planınki; kopya ancak ondan küçükse), ses yok.
> **Ek 2 (aynı gün, en altta):** bütün boyutlar tek çözmeden ölçülür (tahminler bayt bayt aynı; 10 sn'lik aramada
> süre yarıya), süre dolunca ölçülmüş büyük boyuttan ×1,3 tahmin, videoda yazılım kodlayıcıya 1,5 kat.
> **Ek 3 (22 Ekim, en altta):** videoda yine 1 kat; 8 sn'de hiçbir boyut yoksa ilk gelen boyut karar verir, en çok
> 20 sn, ancak hiçbir şey gelmezse Küçük.
> **Ek 4 (24 Ekim, en altta; S23 ölçümünden sonra):** tahmin payı ×1,15 ve tahminle seçilen boyut kendi ölçümüyle
> doğrulanır (9 MB'ı geçerse bir küçüğü, ekran söyler); süren ölçüm bırakılmaz; "dosyası da çoğu zaman daha küçük"
> yerine videonun beklenen boyutu; yazı yoksa "yazısıyla" yok. Aynı gün GIF kareleri keskinleşti (ADR-046 Ek 3).
> İlgili: [ADR-046](ADR-046-gif.md) (GIF yap; ekleri: tahmin ±%10, 10 MB uyarısı, bellek, "Çok büyük"),
> [ADR-041](ADR-041-never-upscale.md) (büyütme yok), [ADR-042](ADR-042-export-failure-detail.md) (hata ayrıntısı,
> bekçi), [ADR-045](ADR-045-constant-bitrate-ordinary-download.md) (donanım kodlayıcıda sabit bit hızı),
> [ADR-027] (hızlı kesim), [ADR-034](ADR-034-task-first-home.md) (sihirbaz çatısı).

## Bağlam

GIF'in 256 renkli, kareler arası sıkıştırmasız biçimi yüksek çözünürlüğü çok büyük yapar (ADR-046 Ek 2: 4 sn
ortanca 11,5 MB 960'ta, 20 MB 1280'de, 39,5 MB 1920'de; 1280 ve 1920 boyut ve bellek yüzünden sunulmadı). Varsayılan
"Orta" (480) sabitti (kurucu kararı, 20 Ekim). Kurucu her zaman en neti istiyor. İki değişiklik:

1. Varsayılan boyut sabit değil: **paylaşılabilen en net boyut** — ölçülen tahmini 10 MB'ı geçmeyen en büyük boyut.
2. GIF kartında ikinci çıktı: **"Video olarak (en net)"** — aynı kısım, aynı yazı, videonun kendi çözünürlüğünde
   kısa bir H.264 video. 20 Ekim'de "şimdilik yok" denmişti (ADR-046 ek, kurucu kararı 3); bu ADR onu açar.

## Karar 1 — İlk seçilen boyut: 10 MB'ı geçmeyen en büyük boyut, ölçülerek

- **Kural** (`sharpestShareableGifSize`, `domain/gif.ts`, saf ve birim sınamalı): videonun sunduğu boyutlar (hiçbiri
  videodan büyük değil, ADR-041) **en büyükten aşağı, birer birer ölçülür**; tahmini `GIF_LARGE_FILE_BYTES`
  (10 000 000 bayt — ekranın "10 MB"ı, uyarının sınırı) içinde kalan ilk boyut seçilir. Hiçbiri sığmazsa en küçüğü
  ("Küçük") seçilir ve 10 MB uyarısı görünür; bir ölçüm başarısız olursa da "Küçük" (sığdığını söyleyemeyiz; Küçük
  gerçek kayıtların hepsinde sığdı: 10 sn en çok 5,1 MB).
- **Tahmin değişmedi** (ADR-046: 8 yerden 3'er kare, GIF'in kendi yoluyla kodlanır; ±%10). Hiçbir boyut tahmin
  edilmeden, başka bir boyuttan çıkarılarak ya da piksel sayısıyla oranlanarak atlanmaz.
- **Ekran beklerken dürüst:** ölçüm sürerken hiçbir boyut işaretli değildir, boyutun altındaki satır "En net boyut
  ölçülüyor…" der ve **"GIF'i indir" bekler** (`aria-describedby` bu satır) — tahmin edilmemiş bir boyutta GIF
  yapılmaz. Kullanıcı bu sırada bir boyuta dokunursa arama biter, o boyut seçilir. Seçilince aynı satır: **"Paylaşması
  kolay olsun diye 10 MB'ı geçmeyen en net boyutu seçtik."**; kullanıcı kendisi seçince yine eski satır ("Büyüdükçe
  GIF telefonda daha net görünür; dosyası da büyür."). Tek satır, çünkü telefonda (390 × 844) iki satır seçenekleri
  ana düğme çubuğunun altına itiyordu (axe `target-size`; aşağıda).
- **Arama ne zaman yeniden başlar:** kısım ya da yazı değişince (tahminin anahtarı değişir), kullanıcı bir boyut
  seçmedikçe; yeni bir video açılınca kullanıcının seçimi unutulur. Bir kez ölçülen her seçim (kısım, boyut, yazı)
  ekranda saklanır ve **yeniden ölçülmez** (`useGifEstimatesDone`): geri seçilen boyut anında bilinir. Aramanın
  sonraki adımı 0,45 sn'lik bekleme olmadan başlar (kimse bir şey değiştirmiyor).
- **10 MB üstü uyarısı aynen** (engellemez). Seçilen boyut zaten en küçüğüyse cümle "Küçük seçebilirsin" yerine
  "Süreyi kısaltabilir ya da video olarak kaydedebilirsin." der (`wizard.gif.tooLargeSmallest`).
- **Bellek güvenliği aynen** (ADR-046 bellek eki): 8 GB'tan az ya da belleğini söylemeyen cihazda kareler 32 MiB'ı
  geçerse iki geçiş. Kural artık 4 sn'lik telefon videosunda sık sık "Büyük" ya da "Çok büyük" seçer: 4 sn Çok büyük
  (960 × 540 × 4 × 50 = 104 MB kare) ve 4 sn Büyük (46 MB) böyle bir cihazda **iki geçişle, hiç kare tutmadan**
  yapılır (birim sınaması `gifSharpest.test.ts`). 8 GB ve üstü cihazda 128 MiB bütçe aynen (4 sn Çok büyük tek
  geçişte 104 MB tutar — kullanıcı onu eskiden de seçebiliyordu).

### Ölçülen: ne seçiliyor, ne kadar bekletiyor (uygulamada, bu masaüstü, Playwright Chromium)

`web/scripts/gif-eval/video-vs-gif.mjs`; kısım baştan 4 sn ya da 10 sn; "bekleme" = video seçilip ekran hazır
olduktan sonra aramanın bitmesine kadar; × = gerçek dosya ÷ seçimdeki tahmin. Gerçek kayıtlar R1–R6 (yalnızca
yerel `web/tests/media/real/`; bu ADR'nin kendi numaraları, ADR-046'nınkilerle aynı değil): R1 iPhone 1080p 60 kare/sn,
R2 Samsung 1080p 60 kare/sn dikey (4,4 sn), R3 iPhone 1080p 30, R4 eski iPhone 720p, R5 sosyal medya videosu 720 ×
1280 (düşük bit hızı), R6 neredeyse kıpırdamayan dikey 1080p. S1–S4: ADR-046'nın yapay kaynakları (1280 × 720).

| Kaynak | 4 sn: seçilen · × · bekleme | 10 sn: seçilen · × · bekleme |
|---|---|---|
| R1 | Büyük 640 × 360 · 4,87 MB · ×1,00 · 4,4 sn | Orta 480 × 270 · 7,53 MB · ×0,99 · 10,6 sn |
| R2 | Büyük 360 × 640 · 7,77 MB · ×1,00 · 4,4 sn | (4,4 sn'lik video) |
| R3 | Büyük 640 × 360 · 5,98 MB · ×1,02 · 3,9 sn | Orta · 8,38 MB · ×1,01 · 10,6 sn |
| R4 | Büyük 640 × 360 · 5,90 MB · ×1,02 · 2,9 sn | Orta · 7,92 MB · ×1,00 · 6,5 sn |
| R5 | Çok büyük 540 × 960 · 5,70 MB · ×1,05 · 1,4 sn | Büyük 360 × 640 · 7,73 MB · ×1,08 · 2,9 sn |
| R6 | Çok büyük 540 × 960 · 0,17 MB · ×1,15 · 1,3 sn | — |
| S1 desen | Çok büyük · 1,49 MB · ×1,01 · 1,3 sn | — |
| S2 yumuşak | Büyük · 6,86 MB · ×1,00 · 3,4 sn | — |
| S3 kaydırma | Büyük · 7,21 MB · ×0,99 · 6,5 sn | — |
| S4 yoğun kumlu | Orta · 5,06 MB · ×0,99 · 18,7 sn | — |

- Önceki varsayılan (Orta) yerine 4 sn'lik telefon videosunda **bir ya da iki boy büyük** GIF (Büyük; az ayrıntılı
  videoda Çok büyük); 10 sn'de çoğunlukla yine Orta. Seçilen hiçbir GIF 10 MB'ı geçmedi (en büyüğü 8,38 MB).
- Tahmin, seçilen 14 GIF'in 13'ünde ±%10 içinde; dışındaki R6 (×1,15; ADR-046'nın bildiği neredeyse kıpırdamayan
  video). **Not:** tahmin ±%10 olduğu için 10 MB'a çok yakın tahminle
  seçilen bir GIF gerçekte 10 MB'ı biraz geçebilir; uyarı tahmine bakar (eskisi gibi). Bir pay (ör. 9 MB) kurucu
  kararına açık.
- **Bedel — bekleme:** arama 1–3 boyut ölçer; ekran hazır olduktan sonra "GIF'i indir" bu masaüstünde **1,3–10,6 sn**
  bekledi (yoğun kumlu yapayda 18,7 sn). Telefonda ~3 katı varsayılır (ölçülmedi: 10 sn'lik bir kısımda ~30 sn).
  Kullanıcı bir boyuta dokunarak beklemeyi bitirebilir. Kurucu kararına açık (aşağıda).
- **Bedel — yapma süresi ve bellek:** daha büyük GIF daha uzun sürer; düşük bellekli cihazda iki geçiş (+%40–70 süre,
  ADR-046). Telefonda ölçülmedi.

## Karar 2 — "Video olarak (en net)": aynı kısım, aynı yazı, olağan MP4 indirmesiyle

- **Ekran:** boyutun altında "Nasıl kaydedilsin?" ve iki seçenek: **"GIF"** (varsayılan) ve **"Video olarak (en
  net)"**. GIF seçiliyken altında: "Video çok daha net ve akıcı olur. Sohbet uygulamaları kısa, sessiz videoları çoğu
  zaman GIF gibi gösterir." Video seçilince boyut seçimi ve GIF tahmini kalkar; görünen: "Video: 1280 × 720, sessiz,
  yazısıyla." (render planının kendi ölçüsü) ve **"Durmadan dönmesine videoyu gösteren uygulama karar verir. Discord
  ve bazı siteler gerçek GIF ister; oraya göndereceksen GIF'i seç."** Düğme "Videoyu indir". Önizleme aynı kısmı
  döndürür; yazı kutuları videonun çerçevesinde, videonun boyutunda dizilir.
- **Varsayılan GIF.** Kartın adı "GIF yap"; GIF her yerde GIF olarak açılan tek dosya (Discord gömmeleri, birçok site,
  e-posta); kullanıcının istediğini ilk basışta vermek. Video, en net seçenek olarak hemen GIF'in yanında.
- **Yol: ikinci kodlayıcı yok.** Video, öbür sihirbazların indirmesiyle (`WizardFlow` → `useDownloads` → export
  worker) yapılır: kaydetme penceresi, yetenek denetimi, gerçek ilerleme (kare sayısı), İptal, "Kaydedildi" + ölçülen
  dosya, Paylaş, hata kartı ve "Ayrıntılar" / "Sorun bildir" (ADR-042; bekçi aynen) — hepsi aynı kod. Tarif
  `gifVideoRecipe` (`application/taskRecipes.ts`): seçilen kısım tek kesit, **sessiz** (kesit susturulur, müzik
  yok → dosyada hiç ses izi yok), videonun kendi boyutu en çok Full HD (`ownSizeRecipe`, ADR-041: 640 × 360 video
  640 × 360 kalır, 4K 1920 × 1080 olur), önceki bir oturumdan altyazı / iyileştirme / ses düzeltme taşınmaz. Dosya adı
  `<video>_gif.mp4`.
- **Yazı GIF'in yazısının aynısı:** yeni istek alanı `overlayText` (`ExportExtras` → istemci → protokol → worker).
  Worker her karede, altyazının yerinde, `layoutGifText` + `drawGifText` ile çizer (GIF worker'ının kendi işlevleri;
  Inter Bold, beyaz harf, koyu kenar, yükseklik payları aynı) — çıktının boyutunda dizilerek. Yazı tipi işçide
  yüklenemezse dosya açılmadan önce ret (`caption_font_unavailable`). Yazı her resmi değiştirdiği için hızlı kesim
  (kaynağın resimlerini kopyalama, ADR-027) denenmez; sebep yeni değer **`text`** ("yazın görüntünün üstüne yazıldı").
  Yazısız video olağan indirme gibi: kaynak uygunsa resimler kopyalanır (en net — hiç yeniden kodlanmaz).
- **Ses kapalı, seçenek yok.** Gerekçe: GIF'in sesi yok; kart GIF yerine geçen bir şey veriyor; sohbet uygulamaları
  (bilinen örnek Telegram) **sessiz** kısa videoyu GIF gibi oynatır, sesliyi olağan video sayar. Sesli kısa video
  isteyen için "Kes" kartı var.
- **Döngü dosyada değil.** MP4'te GIF'in NETSCAPE döngü bloğunun eşi yok; durmadan dönmesine videoyu gösteren
  uygulama karar verir. Ekran bunu söyler; "durmadan döner" denmez (GIF'in sonuç satırı yalnızca GIF'te).
- **Çerçeve:** öbür indirmelerin çerçevesi (16:9, 9:16, kare); bu biçimlerin dışındaki bir video (ör. 4:3) videoda
  ortalanıp kenarlarından kırpılır, GIF'te kendi biçimindedir. Önizleme video seçiliyken aynı kırpmayı gösterir
  (`object-fit: cover`). Kare hızı videonunki (en çok 30), GIF'in 12,5'i değil.

### Ölçülen: dosya boyutu, GIF'e karşı (uygulamada, bu masaüstü, Playwright Chromium — **yazılım H.264 kodlayıcısı**)

Aynı kısım (baştan 4 sn ya da 10 sn), yazısız. "960 kopya": kaynağın 960 uzun kenara Lanczos ile küçültülmüş kopyası
(yalnızca yerel) — GIF'in "Çok büyük"ü ile video **aynı çözünürlükte** (960 × 540 / 540 × 960). Hücre: MB.

| Kaynak | Aynı çözünürlük, 4 sn: GIF 960 · video 960 · oran | 10 sn: GIF 960 · video 960 · oran | Asıl çözünürlük, 4 sn: seçilen GIF · video (boyut) |
|---|---|---|---|
| R1 | 10,54 · 2,90 · **0,28** | 27,61 · 7,89 · **0,29** | 4,87 · 8,38 (1920 × 1080) |
| R2 | 16,13 · 10,36 · 0,64 | — | 7,77 · 9,37 (1080 × 1920) |
| R3 | 12,79 · 3,99 · **0,31** | 28,68 · 8,24 · **0,29** | 5,98 · 7,45 (1920 × 1080) |
| R4 | 11,71 · 3,83 · **0,33** | 28,17 · 10,84 · **0,38** | 5,90 · 5,37 (1280 × 720) |
| R5 | 5,95 · 0,63 · **0,11** | 14,43 · 1,76 · **0,12** | 5,70 · 0,36 (720 × 1280) |
| R6 | 0,16 · 0,08 · 0,50 | — | 0,17 · 0,22 (1080 × 1920) |
| S1 desen | 1,42 · 1,16 · 0,82 | 3,51 · 2,91 · 0,83 | 1,49 · 2,38 (1280 × 720) |
| S2 yumuşak | 4,30 · 0,44 · 0,10 | 10,39 · 1,14 · 0,11 | 6,86 · 9,15 (1280 × 720) |
| S3 kaydırma | 10,22 · 6,39 · 0,63 | 25,20 · 16,22 · 0,64 | 7,21 · 22,56 (1280 × 720) |
| S4 yoğun kumlu | 18,67 · 18,17 · 0,97 | — | 5,06 · 45,79 (1280 × 720) |

- **Aynı çözünürlükte video her kaynakta GIF'ten küçük:** gerçek kayıtlarda GIF'in 0,11–0,64'ü (ortanca ~0,3).
- **Ama asıl çözünürlüğünde (1080p'ye kadar) video, ilk seçilen GIF'ten çoğu zaman büyük ya da ona yakın**
  (gerçek kayıtlarda 4 sn 0,06–1,72 kat, 10 sn 0,13–2,77 kat; 10 sn R1 20,85 MB, R3 18,45 MB). Sebep: bu masaüstünün kodlayıcısı yazılım
  kodlayıcısı; olağan indirme ona planın 3 katı bit hızı verir (`SOFTWARE_ENCODER_BITRATE_FACTOR`, 1080p30 ≈ 16,8
  Mbit/sn) ve değişken hız yoğun kumda isteneni çok aşar (S4: 45,8 MB / 4 sn — olağan indirmenin bugünkü hali; bu
  ADR'nin konusu değil). Donanım kodlayıcıda (telefonların çoğu) sabit bit hızı planın 1080p30'da ≈ 5,6 Mbit/sn'si
  (ADR-045: 0,999–1,003) → 4 sn ≈ 2,8 MB, 10 sn ≈ 7 MB — **hesap, telefonda ölçülmedi.**
- Bu yüzden ekran **dosya boyutu için bir şey vaat etmez** (önce yazılan "dosyası da daha küçük" ölçümden sonra
  çıkarıldı); netliği ve akıcılığı söyler. Gerçek boyut kaydedince sonuç kartında yazar.
- Videoyu yapmak 0,3–6,0 sn sürdü (bu masaüstü).

## Değişen dosyalar

- `domain/gif.ts` (`sharpestShareableGifSize`, `GifOutput`), `application/taskRecipes.ts` (`gifVideoRecipe`),
  `components/gif/GifWizard.tsx`, `components/gif/useGif.ts` (ölçülenlerin kaydı, bekleme süresi),
  `components/wizard/WizardFlow.tsx` (`againSame`: video sonrası da "Bir GIF daha yap"), `app/wizard.css`,
  `domain/fastPath.ts` (`text`), `adapters/export/{protocol,exportClient,exportWorker}.ts` (`overlayText`),
  mesajlar (TR + EN). Yeni ölçüm aracı `scripts/gif-eval/video-vs-gif.mjs`.
- Dokunulmayan: GIF worker'ı ve kodlayıcısı, tahmin yöntemi, boyutlar, 10 MB sınırı, bellek bütçesi.

## Sınamalar (yerel, Windows, Playwright Chromium, port 3195, ölçüm kilidi altında)

- `tsc`, `eslint` temiz; birim **1665 / 1665** (96 dosya; yeni `gifSharpest.test.ts` 9: en büyükten aşağı ölçme,
  tam 10 MB sığar, hiçbiri sığmazsa / ölçüm düşerse Küçük, videonun boyutları, düşük bellekte Çok büyük iki geçiş,
  tarif: kısım, ses yok, büyütme yok, eski oturumdan bir şey taşınmaz, dosya adı).
- e2e: `gif.spec.ts` + `gif-a11y.spec.ts` + `gif-memory.spec.ts` + `wizard-phone-action.spec.ts` **58 / 58**;
  `english.spec.ts` **23 / 23**; dışa aktarma worker'ı değiştiği için `fast-cut`, `export-failure`, `worker-failure`,
  `share-target`, `captions-export` **31 / 31**. `PAGE-RECOVERED-TOTAL 0`.
  - Eski sınamaların beklentileri yalnızca **ilk seçilen boyut** için değişti (Orta → kuralın seçtiği; her biri bu
    ADR'yi anar); hiçbir eşik gevşemedi. 10 MB sınamasında artık ilk seçilenin tahmini ≤ 10 MB ve uyarısız olduğu da
    sınanıyor (yoğun kumlu 640 × 360, 10 sn: Orta, 9,47 MB tahmin; Büyük 17,9 MB).
  - Yeni: video çıktısı (H.264, ses izi yok, 1280 × 720, 4,0 sn, kısım 6. saniyeden, yazı resmin içinde: üst bantta
    kaynaktan fark 54, ortada 6,4 — H.264'ün test deseninde kendi kaybı; beyaz ve siyah piksel, `data-fallback="text"`),
    ADR-042 hatası (kodlayıcı 12. karede düşer: düz cümle, "Ayrıntılar", "Sorun bildir", dosya kalmaz, sonra kaydedilir),
    İngilizce, telefonda iki seçenek tek satırda ≥ 44 × 44 (320 / 390 px, TR / EN).
  - İlk koşuda `gif-a11y` 390 × 844'te düştü: yeni satırlar boyut seçeneklerini (sonra çıktı seçeneklerini) ana düğme
    çubuğunun altına itiyordu (axe `target-size`, kısmen örtülü). Çıktı seçimi boyutun altına alındı ve boyutun iki
    açıklama satırı tek satır yapıldı; sonra geçti.
- Kalite katmanı (yalnız `visual`, `a11y`, `text`, `walkthrough`; geçmişe yazılmadan, rapor depoya konmadı): ilk
  koşuda 757 ölçüden 700 bütçe içinde, **5 dışında** — farklı ekran 4 (`sihirbaz-gif-secim` dört görünüm: "Çok büyük"
  seçili, yeni satır, "Nasıl kaydedilsin?") ve dört GIF yürüyüşünde "dosya çıktı ve doğru" hayır (yürüyüş 480 × 270
  bekliyordu; artık kuralın seçtiği 960 × 540 ve aramanın bitmesini bekler, `tests/quality/lib/walk.ts`). Fark
  resimlerine bakılıp yalnız bu dört taban yenilendi; sonra **705 bütçe içinde, 0 dışında, farklı ekran 0**,
  erişilebilirlik 34 / 34, dosyası doğrulanan görev 11 / 11 · 11 / 11. Not: telefon tabanının tam sayfa görüntüsünde
  yapışkan düğme çubuğu "Nasıl kaydedilsin?" seçeneklerinin üstünde çizilir (tam sayfa yakalamanın yapışkan öğeyi ilk
  ekranın altında tutması); sayfa kaydırılınca seçenekler çubuğun üstünde görünür.

## Doğrulanmayanlar

- **Sohbet uygulamaları:** WhatsApp, Instagram, Telegram, Discord'a hiçbir dosya gönderilmedi; hangisinin videoyu
  döngüyle gösterdiği denenmedi (mesaj göndermek kurucunun izni ister). Ekran yalnızca "çoğu zaman" der.
- **Telefon** (S23 ve düşük bellekli Android), Safari, Firefox: ne bekleme, ne GIF'in yapılma süresi, ne videonun
  boyutu (donanım kodlayıcı) ölçüldü.
- 4:3 gibi çerçeve dışı bir videoda videonun kırpılması e2e'de sınanmadı (birim: tarif; görsel: önizleme kuralı).
- Gerçek kayıtlarda yazılı video (ölçüm yazısızdı; yazı yalnızca test deseninde).

## Kurucu kararları (ilk hali — ana oturum aynı gün karar verdi, aşağıdaki ek)

1. ~~Bekleme~~ → Ek, karar 1. 2. ~~10 MB payı~~ → Ek, karar 2. 3. ~~Varsayılan çıktı~~ → GIF kalır.
4. ~~Videonun boyutu~~ → Ek, karar 4. 5. ~~Ses~~ → şimdilik yok (sessiz).

---

## Ek — 21 Ekim 2026 (aynı gün): ana oturumun beş kararı (kurucu devretti)

Yukarıdaki iki bölüm ve tablolar ilk halin ölçümüdür; değiştirilmedi. Bu ek onları şu kararlarla günceller.

1. **Bekleme sınırlı: en çok 8 sn** (`GIF_AUTO_PICK_LIMIT_MS`). Arama 8 sn'de bitmezse, o ana dek ölçülmüş ve sığan
   en büyük boyut (yoksa "Küçük") seçilir ve aynı satır söyler: "Ölçmek uzun sürdü; 10 MB'ı geçmediği ölçülen en büyük
   boyutu seçtik." ya da "Ölçmek uzun sürdü; en küçük boyutu seçtik. Daha büyüğünü kendin seçebilirsin." Seçim **bir
   daha kendiliğinden değişmez** (o anki seçim bu kısım ve yazı için dondurulur; sonradan gelen ölçüm onu değiştirmez).
   Sınama derlemesinde süre kısaltılabilir (`window.__clipGifPickLimitMs`); e2e: 0 ms → "Küçük", satır, düğme açık,
   3 sn sonra hâlâ Küçük. Telefondaki süre S23'te sonra ölçülecek.
2. **Pay: ilk seçim tahmin ≤ 9 MB** (`GIF_AUTO_PICK_MAX_BYTES`; ekran "10 MB'ı geçmeyen" der, tahmin ±%10). Uyarı eşiği
   10 MB kaldı.
3. **Varsayılan çıktı GIF** (değişmedi).
4. **Videonun kendi bit hızı:** "Video olarak" artık olağan indirmenin yazılım kodlayıcıya verdiği 3 katı değil, planın
   kendi bit hızını ister (her kodlayıcıda; 0,09 bit/piksel: 1080p30 ≈ 5,6 Mbit/sn, 720p30 ≈ 2,5 — telefonun donanım
   kodlayıcısının aldığı; kaynağın 2 katıyla sınırlı, 1080p tavanı ve büyütmeme aynen). Hız denetimi ADR-045'inki
   (donanım: sabit, yazılım: değişken). Yeni istek alanı `planBitrateOnly` (`exportVideoBitrate`). Kaynağın kendi
   resimleri (hızlı kesim, yazısız video) **ancak bu kodlamadan büyük değilse** tutulur; büyükse kodlanır, sebep yeni
   değer **`clip_size`** ("görüntü olduğu gibi kopyalansaydı dosya gereğinden büyük olurdu"). Yazılıysa yine `text`.
5. **Ses yok, seçenek yok** (değişmedi).

### Ölçülen (aynı kaynaklar, bu masaüstü, yazılım kodlayıcı; yazısız; `video-vs-gif.mjs --no-xlarge`)

İlk seçilen GIF (kuralın seçtiği, 9 MB ve 8 sn ile) · video (öncesi → şimdi) · netlik: VMAF (v0.6.1) ve SSIM, ikisi
de **videonun çerçevesinde** kaynağa karşı (GIF bikübik büyütülerek — telefonda göründüğü gibi; 12,5 kare/sn, baştan),
`GIF / video`. Yerel betik, depoya girmedi.

| Kaynak, süre | Seçilen GIF | Video: önce → şimdi (çözünürlük) | VMAF GIF / video | SSIM GIF / video |
|---|---|---|---|---|
| R1, 4 sn | Büyük 640 · 4,87 MB | 8,38 → **2,80 MB** (1920 × 1080) | 20,9 / **53,4** | 0,842 / **0,884** |
| R2, 4,4 sn | Büyük 360 × 640 · 7,77 | 9,37 → **5,14** (1080 × 1920) | 5,7 / **27,5** | 0,648 / **0,722** |
| R3, 4 sn | Büyük · 5,98 | 7,45 → **2,78** (1920 × 1080) | 4,3 / **26,3** | 0,750 / **0,782** |
| R4, 4 sn | Büyük · 5,90 | 5,37 → **1,22** (1280 × 720) | 16,2 / **61,7** | 0,760 / **0,848** |
| R5, 4 sn | Çok büyük · 5,70 | 0,36 → **0,36** (kopya; 720 × 1280) | 69,8 / **99,7** | 0,975 / **1,000** |
| R6, 4 sn | Çok büyük · 0,17 | 0,22 → 0,22 (kopya) | — | — |
| S1, 4 sn | Çok büyük · 1,49 | 2,38 → **1,24** (1280 × 720) | — | — |
| S2, 4 sn | Büyük · 6,86 | 9,15 → **1,24** | **79,0** / 75,3 | **0,959** / 0,956 |
| S3, 4 sn | Büyük · 7,21 | 22,56 → **1,22** | 35,6 / **81,8** | 0,745 / **0,794** |
| S4, 4 sn | Küçük (8 sn doldu) · 2,12 | 45,79 → 2,30 | 24,8 / **55,1** | 0,397 / **0,452** |
| R1, 10 sn | Küçük (8 sn doldu) · 3,57 | 20,85 → 6,95 | 0,2 / **55,3** | 0,802 / **0,879** |
| R3, 10 sn | Küçük (8 sn doldu) · 4,03 | 18,45 → 6,98 | — | — |
| R4, 10 sn | Orta · 7,92 | 13,55 → **3,05** | 17,2 / **58,7** | 0,748 / **0,826** |
| R5, 10 sn | Büyük · 7,73 | 0,98 → **0,98** (kopya) | — | — |
| S2, 10 sn | Orta · 7,71 | — → **3,10** | — | — |
| S3, 10 sn | Küçük (8 sn doldu) · 3,53 | — → **3,06** | — | — |

- **Video artık 16 durumun 12'sinde ilk seçilen GIF'ten küçük;** büyük kalan dördü: GIF'in 8 sn dolup "Küçük"e düştüğü
  üç durum (S4 4 sn, R1 ve R3 10 sn) ve neredeyse kıpırdamayan R6 (0,22 / 0,17 MB). 1080p 4 sn ≈ 2,8 MB, 10 sn ≈ 7 MB
  (R2 değişken hızda isteneni ×1,65 aştı: çok ayrıntılı 60 kare/sn kaynak). Ekrana bu yüzden yeniden "dosyası da çoğu
  zaman daha küçük" yazıldı.
- **Netlik:** ölçülen 9 durumun 8'inde video GIF'ten açıkça net (VMAF +22 ile +55, SSIM +0,03 ile +0,09); tek istisna
  yapay yumuşak geçiş S2 (VMAF −3,7, SSIM −0,003: düz renk alanlarında GIF'in paleti iyi, yazılım kodlayıcının düşük
  bit hızı az geride). Not: yazılım kodlayıcıda planın bit hızı mutlak olarak orta bir netlik veriyor (1080p'de VMAF
  26–53); ADR-024 bu yüzden olağan indirmeye 3 kat verir. Donanım kodlayıcıda (telefon) aynı bit hızıyla netlik
  daha yüksek beklenir — **ölçülmedi.**
- **8 sn sınırının bedeli:** 10 sn'lik 1080p kayıtta (R1, R3) arama 8 sn'de bitmedi (960 ve 640 ölçülüp 9 MB'ı geçti,
  480 sürerken) ve GIF eskiden seçilecek "Orta" yerine **"Küçük"** oldu; ekran bunu söyler. Telefonda bu daha sık olur
  (ölçüm ~3 kat yavaş varsayılır). S23 ölçümünden sonra sınır ya da arama sırası (ör. 10 sn'lik kısımda Orta'dan
  başlamak) yeniden düşünülmeli.

### Sınamalar (ek; yerel, port 3195, kilit altında)

- `tsc`, `eslint` temiz; birim **1666 / 1666** (`gifSharpest.test.ts` 10: tam 9 MB sığar, 9,5 MB seçilmez, süre doldu:
  ölçülüp sığan en büyük ya da en küçük, ölçülmemiş boyut sayılmaz).
- e2e **113 / 113:** `gif` (yeni: 8 sn sınırı; video sınaması artık dosyanın planın bit hızını ×1,1'den fazla
  geçmediğini ve GIF'ten küçük olduğunu da sınar: 1280 × 720, 4 sn, 246 KB, GIF 839 KB), `gif-a11y`, `gif-memory`,
  `wizard-phone-action`, `english`, `fast-cut`, `export-failure`, `worker-failure`, `share-target`, `captions-export`.
  `PAGE-RECOVERED-TOTAL 0`.
- Kalite katmanı (`visual`, `a11y`, `text`, `walkthrough`): ilk koşuda farklı ekran 3 (`sihirbaz-gif-secim` telefon
  TR / EN ve masaüstü EN: yalnız değişen açıklama cümlesi); fark resimlerine bakılıp bu üç taban yenilendi; sonra
  **705 bütçe içinde, 0 dışında, farklı ekran 0.**

### Hâlâ açık (kurucuya) — ikisi de Ek 2'de ele alındı

1. ~~8 sn sınırı 10 sn'lik telefon videosunda GIF'i "Küçük"e düşürebiliyor~~ → Ek 2: arama ucuzladı, tahminle düşüş.
2. ~~Yazılım kodlayıcıda planın bit hızı~~ → Ek 2: yazılım kodlayıcıda 1,5 kat.

---

## Ek 2 — 21 Ekim 2026 (aynı gün): aramayı ucuzlatmak, süre dolunca tahmin, yazılım kodlayıcıda 1,5 kat

Ana oturumun kararları: 8 sn sınırının 10 sn'lik 1080p kısmı "Küçük"e düşürmesi "her zaman en net" hedefine aykırı —
sınırı değil sebebi düzelt.

### A. Bütün boyutlar tek çözmeden

- **Önce:** her boyut kendi tahminini yapıyordu (kısmın 8 yerinden 3'er kare **yeniden çözülür**); arama en büyükten
  aşağı 1–3 tahmin = 1–3 çözme.
- **Şimdi** (`gifWorker.ts` `estimate`, `sizes`): arama **bütün boyutları tek istekte** ister; örnek anlar **bir kez
  çözülür**, her çözülen kare her boyuta, o boyutun GIF'inin çizdiği gibi (`VideoSample.draw` doğrudan o boyuta) çizilir;
  sonra her boyut kendi paletiyle kodlanır ve sonucu **hemen** gönderilir (büyükten küçüğe), en sonda `estimateDone`.
  Kareler birlikte cihazın kare bütçesine (`gifFramesBudget`: 32 / 128 MiB) sığmazsa boyutlar sığan gruplara bölünür
  (büyükten başlayarak, grup başına bir çözme): 8 GB'lık cihazda 4 boyut ~90 MB, tek grup; az bellekli cihazda
  Çok büyük / Büyük / Orta+Küçük — eskisinden yine az çözme. Arama sürerken istek değişmez (yarıda kesilip yeniden
  başlamaz); kullanıcı bir boyut seçerse yalnızca o ölçülür.
- **Tahmin değişmedi — bayt bayt:** aynı kareler, aynı çizim, aynı palet, aynı kodlama. 16 kaynak/süre durumunun
  hepsinde seçilen boyutun tahmini eskisiyle **aynı bayt sayısı**; önceki turlarda ölçülen öbür boyutlar da (ör. R1 4 sn
  Çok büyük 10 353 924, Büyük 4 883 629; R3 10 sn Çok büyük 28 641 174, Orta 8 302 166). Ön kayıttaki ±%10 ölçümü (ADR-046, R6 istisnası) bu yüzden aynen geçerli; yeniden ölçülmesi gerekmedi.
- **Arama süresi, önce → sonra** (bu masaüstü, sınırsız; ekran hazır olunca "seçildi"ye kadar):

| Durum | Bütün çekirdekler | 2 çekirdek (telefon yerine) |
|---|---|---|
| R1 10 sn | 12,7 → **5,9 sn** | 38,1 → **17,6 sn** |
| R3 10 sn | 12,2 → **5,5 sn** | 27,4 → **10,6 sn** |
| R4 10 sn | 6,0 → **3,9 sn** | 10,1 → **5,0 sn** |
| S3 10 sn | 14,1 → **9,0 sn** | — |
| S2 10 sn | 6,4 → **3,9 sn** | — |
| R1 4 sn | 3,3 → 3,4 sn | 11,8 → 12,6 sn |
| R3 4 sn | 3,3 → 3,4 sn | 7,6 → **6,6 sn** |
| S3 4 sn | 6,4 → **5,4 sn** | 16,1 → **10,4 sn** |
| S4 4 sn (yoğun kumlu) | 15,5 → **14,2 sn** | — |
| S1, R5, R6 4 sn (ilk boyut sığar) | 1,3 → 1,8–1,9 sn | — |

  10 sn'lik kısım yarıya iner (3 tahmin yerine 1 çözme); 4 sn'de çoğunlukla 2 tahmin olduğu için kazanç küçük; ilk
  boyutun sığdığı durumda dört boyutu birden çizmek ~0,5 sn ekler. Yoğun kumda zamanın çoğu kodlama (LZW), çözme değil.
- **Telefon yerine:** CDP'nin `Emulation.setCPUThrottlingRate` (3 kat) GIF işleyicisine ulaşmıyor — ölçüldü: 16 durumun
  süreleri değişmedi. Bunun yerine tarayıcı **2 çekirdeğe** sınırlandı (Windows işlemci yakınlığı; sonradan başlayan
  süreçler devralır): süreler ~2–3 kat. Bir telefonun gerçek hızı değil; S23 ölçümü yerine geçmez.

### B. Süre dolunca: ölçülmüş daha büyük boyuttan tahmin

- 8 sn dolduğunda, ölçülmemiş bir boyut **ölçülmüş en yakın büyük boyuttan** tahmin edilir: bayt × piksel oranı ×
  `GIF_PREDICT_FACTOR` (**1,3**). İlişki ölçüldü: 5 gerçek kayıt ve 3 yapay kaynak, 4 ve 10 sn, 19 komşu boyut
  çiftinde küçük boyutun tahmini, büyüğünün piksele göre küçültülmüşünün **0,83–1,25** katı (ortanca 1,06); 1,3 hepsinin
  üstünde (en büyüğü R5 10 sn, Büyük / Çok büyük: 1,25). Büyükten küçüğe: ölçülüp sığan boyut ya da tahmini ≤ 9 MB olan
  ölçülmemiş boyut seçilir; ikisi de yoksa Küçük. Satır: "Ölçmek uzun sürdü; ölçtüğümüz daha büyük boyuttan tahminle
  10 MB'ı geçmemesi beklenen en net boyutu seçtik." Seçim yine donar.
- Gerçek 8 sn sınırıyla ölçülen: bütün çekirdeklerde R1 / R3 10 sn artık **Orta, ölçülerek** (5,9 / 5,5 sn; önceki
  turda Küçük'e düşüyordu). S3 10 sn (yapay, kaydırma + kum) 8 sn'de Çok büyük ve Büyük ölçülmüştü → tahminle Küçük
  (Orta tahmini 13,2 MB; gerçek tahmini 8,7 — pay ihtiyatlı). S4 4 sn: tahminle Orta (Büyük ölçülmeden; Orta'nın
  tahmini sonra 5,1 MB çıktı).
- **2 çekirdekte** R1, R3, S3 10 sn: 8 sn'de hiçbir boyut bitmemişti (çözme sürüyordu) → **Küçük** ("en küçük boyutu
  seçtik"). Telefonda 10 sn'lik 1080p kısım bu yüzden hâlâ Küçük'e düşebilir; S23 ölçümü belirleyecek. (Kısa yol olarak
  düşünülebilecek: önce yalnız Orta'yı ölçmek — bu ek bunu yapmadı.)

### C. "Video olarak": yazılım kodlayıcıda planın 1,5 katı

Donanım kodlayıcı planın bit hızında (sabit, ADR-045), yazılım kodlayıcı **1,5 katında** (`SHORT_CLIP_SOFTWARE_BITRATE_FACTOR`);
kopya bütçesi (`clip_size`) aynı bit hızıyla. Ölçüm (bu masaüstü, yazılım kodlayıcı, yazısız; ilk seçilen GIF · video ·
VMAF / SSIM videonun çerçevesinde):

| Durum | Seçilen GIF | Video: 1 kat → **1,5 kat** | VMAF GIF / video (1,5 kat) | SSIM GIF / video |
|---|---|---|---|---|
| R1 4 sn | Büyük · 4,87 MB | 2,80 → **4,18 MB** (1080p) | 20,9 / **55,6** (1 katta 53,4) | 0,842 / 0,889 |
| R2 4,4 sn | Büyük · 7,77 | 5,14 → **5,52** | 5,7 / **27,8** (27,5) | 0,648 / 0,722 |
| R3 4 sn | Büyük · 5,98 | 2,78 → **4,18** | 4,3 / **28,8** (26,3) | 0,750 / 0,785 |
| R4 4 sn | Büyük · 5,90 | 1,22 → **1,81** (720p) | 16,2 / **64,7** (61,7) | 0,760 / 0,854 |
| R5 4 sn | Çok büyük · 5,70 | 0,36 (kopya) | — | — |
| R6 4 sn | Çok büyük · 0,17 | 0,22 (kopya) | — | — |
| S1 4 sn | Çok büyük · 1,49 | 1,24 → **1,87** | — | — |
| S2 4 sn | Büyük · 6,86 | 1,24 → **1,86** | **79,0** / 76,4 (75,3) | 0,959 / 0,957 |
| S3 4 sn | Büyük · 7,21 | 1,22 → **1,85** | 35,6 / **82,9** (81,8) | 0,745 / 0,797 |
| S4 4 sn | Orta (tahminle) · 5,06 | 2,30 → **3,10** | — | — |
| R1 10 sn | Orta · 7,53 | 6,95 → **10,42** | 14,2 / **57,7** | 0,821 / 0,885 |
| R3 10 sn | Orta · 8,38 | 6,98 → **10,48** | — | — |
| R4 10 sn | Orta · 7,92 | 3,05 → **4,51** | 17,2 / **61,6** | 0,748 / 0,831 |

- 1,5 kat videoyu ~%50 büyütüyor, netliği ölçüde az artırıyor (VMAF +0,3–3,0). Video 13 durumun **9'unda** ilk seçilen
  GIF'ten küçük; büyük olanlar: 10 sn'lik 1080p (R1, R3: 10,4–10,5 MB / GIF 7,5–8,4), S1 (düz test deseni) ve R6
  (neredeyse kıpırdamayan). Ekranın "dosyası da çoğu zaman daha küçük"ü bu ölçümde de doğru; kalıyor.
- Netlik: ölçülen 8 durumun 7'sinde video açıkça net (VMAF +22–48); istisna yine yapay yumuşak geçiş S2.

### Sınamalar (Ek 2; yerel, port 3195, kilit altında)

- `tsc`, `eslint` temiz; birim **1667 / 1667** (`gifSharpest.test.ts` 11: tahmin en yakın büyük boyuttan ×1,3,
  ölçülüp sığan büyük boyut tahminden önce gelir, piksel bilgisi yoksa tahmin yok).
- e2e **113 / 113** (aynı on dosya; video sınaması artık planın 1,5 katını ×1,1 sınır alır: 1280 × 720, 4 sn, 371 KB,
  GIF 839 KB). `PAGE-RECOVERED-TOTAL 0`.
- Kalite katmanı (`visual`, `a11y`, `text`, `walkthrough`): **705 bütçe içinde, 0 dışında, farklı ekran 0** — taban
  yenilenmedi.
- Ölçüm betiği `scripts/gif-eval/video-vs-gif.mjs`: `--pick-only`, `--cores=2`, `--cpu=3`, `--limit-ms`; ekranın
  `data-measured`'ı her boyutun bilinen tahminini verir. Gerçek kayıtlardan türeyen hiçbir şey depoya girmedi.

### Hâlâ açık (kurucuya) — ikisi de Ek 3'te karara bağlandı

1. ~~Telefonda 10 sn'lik 1080p kısım Küçük'e düşebilir~~ → Ek 3. 2. ~~1,5 kat~~ → Ek 3: 1 kata dönüldü.

---

## Ek 3 — 22 Ekim 2026: ana oturumun son iki kararı

1. **Yazılım kodlayıcıda yine planın bit hızı (1 kat).** 1,5 kat dosyayı ~%50 büyütüp VMAF'ı yalnızca +0,3–3 artırdı
   (Ek 2, C) — değmez. Ek 2'deki 1 kat sayıları geçerli (4 sn 1080p ≈ 2,8 MB, 10 sn ≈ 7 MB; video 16 durumun 12'sinde
   ilk seçilen GIF'ten küçük). e2e: 1280 × 720, 4 sn, 248 KB (sınır planın bit hızı × 4 sn × 1,1; GIF 839 KB).
2. **8 sn'de hiçbir boyut bitmemişse Küçük'e düşülmez.** Arama sürer — ekran yine "En net boyut ölçülüyor…" der, düğme
   bekler — ve **ilk gelen boyut** karar verir: sığıyorsa (≤ 9 MB) o, sığmıyorsa Ek 2'nin aşağı doğru tahmini (en yakın
   ölçülmüş büyük boyuttan, piksel oranı × 1,3); seçim donar. Bütününde en çok **20 sn** (`GIF_AUTO_PICK_HARD_LIMIT_MS`):
   o ana dek hiçbir boyut gelmediyse ancak o zaman Küçük, ekran söyler ("Ölçmek uzun sürdü; en küçük boyutu seçtik…").
   8 sn'de bir boyut zaten ölçülmüşse Ek 2'deki gibi hemen karar verilir. Sınama derlemesinde iki süre de kısaltılabilir
   (`__clipGifPickLimitMs`, `__clipGifPickHardLimitMs`).

### Ölçülen: 2 çekirdek (telefon yerine), 10 sn'lik kısım, gerçek süreler (8 sn / 20 sn)

| Kaynak | İlk gelen boyut | Sonuç | Süre (ekran hazır → seçilen boyutun tahmini görünür) | Ek 2'de (8 sn'de Küçük) |
|---|---|---|---|---|
| R1 (1080p 60) | Çok büyük 27,3 MB | **Orta**, tahminle (27,3 × 0,25 × 1,3 = 8,9 MB; Orta'nın kendi tahmini sonra 7,6 MB) | 21,8 sn | Küçük, 19,6 sn |
| R3 (1080p 30) | Çok büyük 28,6 MB | Küçük, tahminle (Orta 9,3 MB > 9; kendi tahmini 8,3 — pay ihtiyatlı) | 15,8 sn | Küçük, 16,8 sn |
| S3 (yapay, kaydırma + kum) | Çok büyük 35,8 MB | Küçük, tahminle (Orta 11,6 MB) | 18,6 sn | Küçük, 18,6 sn |

- Üçünde de ilk boyut 8 ile 20 sn arasında geldi; hiçbiri 20 sn'ye kalmadı. Süre, seçilen boyutun kendi tahmininin de
  gelmesini içerir: seçim donunca yarım kalan ölçüm bırakılır, seçilen boyut yeniden ölçülür (bir çözme daha) — boşa
  giden iş; seçilen boyut ilk ölçümün içinde zaten varsa onu beklemek bir sonraki iyileştirme olabilir.
- Bütün çekirdeklerde (bu masaüstü) R1 ve R3 10 sn 8 sn içinde Orta, ölçülerek (Ek 2, 5,5–5,9 sn) — değişmedi.
- R3 ve S3'te pay (×1,3) Orta'yı kaçırdı (tahmini 8,3 / 8,7 MB, sığıyordu). İlk gelen boyut her zaman en büyüğü
  olduğu için tahmin en uzak boyuttan yapılıyor; telefonda S23 ölçümü bunu gösterecek.

### Sınamalar (Ek 3; yerel, port 3195, kilit altında)

- `tsc`, `eslint` temiz; birim **1667 / 1667**.
- e2e **113 / 113** (aynı on dosya; sınır sınaması yeniden yazıldı: 8 sn 0 ms → ilk gelen Çok büyük sığar, seçilir;
  yoğun kumlu 640 × 360 10 sn'de ilk gelen Büyük ~18 MB → tahminle Küçük ve tahmin cümlesi; iki süre de 0 → Küçük ve
  cümlesi; hiçbiri sonradan kendiliğinden değişmez). `PAGE-RECOVERED-TOTAL 0`.
- Kalite katmanı koşulmadı: hiçbir ekran ya da cümle değişmedi (yalnızca sürelerin davranışı ve bit hızı).

### Hâlâ açık (kurucuya)

1. S23'te 10 sn'lik 1080p kısım: ilk boyut kaç saniyede geliyor, tahmin Orta'yı mı Küçük'ü mü veriyor.
2. Pay ×1,3, en büyük boyuttan iki basamak aşağı tahminde Orta'yı kaçırabiliyor (R3, S3); istenirse 10 sn'lik kısımda
   arama önce Orta'yı tek başına ölçebilir.

(İkisi de 24 Ekim'de S23'te ölçüldü — `docs/phone/2026-10-24-s23.md` — ve Ek 4'te ele alındı.)

---

## Ek 4 — 24 Ekim 2026: S23'ten sonra — pay ×1,15 ve doğrulama, süren ölçüm bırakılmaz, videonun boyutu söylenir

Kaynak: S23 ölçümü (`docs/phone/2026-10-24-s23.md`, canlı b4d544a) ve ana oturumun kararları (kurucu devretti).
Telefonda 10 sn'lik 1080p (üretilmiş kliplerde): Çok büyük 7,2–7,9 sn'de ölçüldü; 8 sn'de ×1,3 pay Büyük'ü 10,4 MB
"tahmin etti" → Orta (masaüstünde aynı klipte Büyük 8,55 MB ölçülüp sığıyordu; oran 1,07); sonra seçilen Orta
**yeniden ölçüldü** (süren çok boyutlu ölçüm bırakıldığı için; bir çözme daha) → seçilen boyutun tahmini 13,8–14,5
sn'de. Ve GIF'in altındaki "Video … dosyası da çoğu zaman daha küçük" 10 sn'lik 1080p'de tutmadı (video GIF'in
1,19–1,43 katı).

### Kararlar (uygulandı)

1. **Süren ölçüm bırakılmaz** (`useGifEstimate`'in yeni `keepRunning`'i): kullanıcıya bir boyut seçildiğinde, bütün
   boyutların ölçümü sürüyorsa ve seçilen boyutu da ölçecekse, kesilmez; seçilen boyutun sonucu oradan gelir. Kullanıcı
   kendisi bir boyut seçerse eskisi gibi yalnız o ölçülür.
2. **Pay ×1,15** (`GIF_PREDICT_FACTOR`; ölçülen komşu oranı 0,83–1,25, ortanca 1,06) **ve doğrulama**
   (`verifyPredictedGifSize`): tahminle seçilen boyutun kendi tahmini gelene kadar "GIF'i indir" bekler (satır tahmin
   cümlesini söyler, `data-verifying`); gelince ≤ 9 MB ise kalır, değilse **bir küçük boyut** seçilir ve satır der ki
   "Tahminle seçtiğimiz boyut ölçülünce 10 MB’ı geçecekti; bir küçüğünü seçtik." (yeni sebep `timeout_stepped_down`;
   o boyut da aynı biçimde doğrulanır, en küçükte durur). Daha büyük bir boyutun ölçümü sonradan ≤ 9 MB gelse de seçim
   **kendiliğinden değişmez** (sürpriz yok). Sınama derlemesinde pay değiştirilebilir (`__clipGifPredictFactor`).
3. **Videonun boyutu söylenir, "çoğu zaman daha küçük" sözü kalktı:** GIF seçiliyken: "Video çok daha net ve akıcı
   olur; video olarak yaklaşık 7 MB. …"; video seçiliyken: "Video: 1920 × 1080, sessiz, yaklaşık 7 MB." Hesap
   (`gifVideoExpectedSize`): dışa aktarmanın bu indirmeye istediği bit hızı — planınki, kaynağınkinin 2 katıyla sınırlı
   (`sourceBoundedBitrate`, export worker'ının aynı işlevi) — × kısmın süresi. Donanım kodlayıcıda (sabit hız) S23
   planın ×1,001–1,012'sini ölçmüştü. **Yazılım kodlayıcıda** (değişken hız; sayfa sorar, `videoEncoderKindFor`) "yaklaşık
   … (bu tarayıcıda daha büyük çıkabilir)". **Yazısız ve kaynağın kendi bit hızı bundan düşükse** kaynağın resimleri
   tutulabilir (ADR-027, `clip_size`): "en çok …".
4. **Yazı yoksa "yazısıyla" yok** (ayrı işlem, `gifHasText`; export işçisinin kuralıyla aynı).

### Ölçülen (bu masaüstü; ADR-046 Ek 3'ün keskin kareleriyle; `video-vs-gif.mjs --pick-only`, artık seçimin anı ve
"GIF'i indir"in açıldığı an ayrı, seçimden 4 sn sonra yeniden bakılır; her durum 2 koşu)

Klipler: telefon ölçümünün üretilmiş `land10` (1920 × 1080) ve `port10` (1080 × 1920), bu ADR'nin R1 (iPhone 1080p
60) ve R3 (iPhone 1080p 30), yapay S3; hepsi 10 sn. "Seçildi" = boyut işaretlendi; "açık" = seçilen boyutun tahmini
ekranda ve düğme açık.

| Durum | Bütün çekirdekler: sonuç · seçildi · açık | 2 çekirdek: sonuç · seçildi · açık | 2 çekirdek, süren ölçüm bırakılsaydı: açık | Ek 3'te (2 çekirdek) |
|---|---|---|---|---|
| land10 | **Büyük, ölçülerek** (8,20 MB) · 8,0 · 8,0 sn | Orta, tahminle · 10,3–12,8 · 17,9–18,4 sn | 18,0–18,4 sn | (yok; S23: Orta, 13,8 sn) |
| port10 | Orta, tahminle (Büyük ölçülünce 9,83 MB: doğru) · 8,0–9,5 · 11,9–14,5 | Orta, tahminle · 11,2–13,7 · 20,3–21,8 | 19,3–19,4 | (yok; S23: Orta, 14,5 sn) |
| R1 | Orta, ölçülerek · 5,4 · 5,4 | Orta, tahminle · 11,3–11,9 · **12,7–12,8** | 21,7–21,9 | Orta, 21,8 sn |
| R3 | Orta, ölçülerek · 4,9 · 4,9 | **Orta**, tahminle · 8,7–8,8 · **9,5–9,6** | 16,3–16,5 | **Küçük**, 15,8 sn |
| S3 | Küçük, tahminle (Orta 9,10 MB) · 8,0–8,5 · 8,8 | Küçük, tahminle · 10,3–11,3 · 14,3–14,7 | 18,3–19,0 | Küçük, 18,6 sn |

- **Doğrulama hiçbir koşuda boyut düşürmedi** (tahminle seçilen her boyutun kendi tahmini ≤ 9 MB: Orta 5,0–8,5 MB,
  Küçük 3,9); seçimden 4 sn sonra hiçbiri değişmemişti. Boyut düşürme e2e'de pay 0,5 yapılarak sınandı (aşağıda).
- **Süren ölçümü bırakmamak** 2 çekirdekte R1'de 9 sn, R3'te 7 sn, S3'te 4 sn kazandırdı; kumlu üretilmiş kliplerde
  kazandırmadı (land10 aynı, port10 1–2 sn kötü): ölçüm boyutları büyükten küçüğe kodlar, kumlu karede Büyük'ün
  kodlanması (artık gereksiz) yeni bir çözme kadar sürüyor. Seçilen boyutu öne alan bir kodlama sırası yapılmadı.
- **×1,15 bir boy kazandırdı:** 2 çekirdekte R3 Küçük → Orta (Orta tahmini 29,50 × 0,25 × 1,15 = 8,48 MB; ×1,3'le
  9,59). **Ama land10'da hâlâ Orta:** keskin karelerle Çok büyük 18,59 MB → Büyük tahmini 18,59 × 0,444 × 1,15 = **9,50
  MB** > 9, oysa Büyük'ün kendi tahmini 8,20 MB (oran 0,99). Bu klipte Büyük'ü yakalamak için pay ≤ 1,09 olmalıydı;
  doğrulama artık var olduğu için daha düşük bir pay (ör. ortanca 1,06) güvenli olurdu — kurucu / ana oturum kararı.
- Telefonda ölçülmedi; 2 çekirdek bir telefonun hızı değil (land10'da S23 13,8 sn, burada 17,9–18,4).

**Videonun söylenen boyutu:** e2e'de (1280 × 720 test kartı, 157 kbit/sn kaynak, 4 sn, yazılı, yazılım kodlayıcı)
söylenen 250 000 B, dosya 247 625 B (**×0,99**). Gerçek kayıtlarda masaüstünde ölçülmedi; donanım kodlayıcıda telefonun
×1,001–1,012'si (S23, Ek 4'ün kaynağı) bu hesabın aynısı.

### Sınamalar (Ek 4; ADR-046 Ek 3 ile aynı son kod ve koşu — sayılar orada)

- Birim: `gifSharpest.test.ts` (×1,15 ve S23'ün durumu, doğrulama: sığar / bir küçüğe iner / en küçükte durur / ölçüm
  düşerse kalır / büyük boyut sonradan sığsa da değişmez; videonun boyutu: 10 sn 1080p ≈ S23'ün 7,04 MB'ının
  ×0,98–1,01'i, kaynağın 2 katıyla sınır, yazısızda "en çok"), `gif.test.ts` (cümleler, "daha küçük" sözü yok).
- e2e `gif.spec.ts`: 8 sn sınırı sınaması doğrulamayı da sınar (tahminle Küçük, kendi tahmini ≤ 9 MB, düğme açık);
  yeni adım — pay 0,5 (sınama kancası): Orta ~5 MB tahminle seçilir, kendi tahmini > 9 MB → Küçük,
  `timeout_stepped_down` ve cümlesi, 3 sn sonra değişmemiş. "Video olarak": satırda boyut (yazılı: "yaklaşık 250 KB
  (bu tarayıcıda daha büyük çıkabilir)", `data-bytes` 250 000, dosya 247 625 B, ×0,99; yazısız: "en çok …"),
  `english.spec.ts` aynı İngilizce.
- `gif-a11y` (telefonda 44 px, yatay kaydırma yok) yeni, daha uzun çıktı satırıyla geçti.

### Doğrulanmayanlar (Ek 4)

- S23'te yeni kural (×1,15, doğrulama, süren ölçüm) ve videonun söylenen boyutu **denenmedi**.
- Yazılım kodlayıcıda ayrıntılı gerçek kayıtta videonun söylenen boyuttan ne kadar büyük çıktığı (ADR-052 Ek 2:
  R2'de ×1,65) yeniden ölçülmedi; ekran yalnızca "daha büyük çıkabilir" der.
- "En çok" durumunda (yazısız, düşük bit hızlı kaynak) kaynağın resimleri kopyalanamazsa (ör. HEVC kaynak) video
  kaynağın 2 katı bit hızıyla kodlanır ve "en çok" sayısına kadar çıkabilir; kopyalanamayan düşük bit hızlı bir
  kaynakla sınanmadı.

### Hâlâ açık

1. land10'da Büyük'ü kaçıran pay (×1,15 → 1,06?); doğrulama artık bir alt güvence.
2. Süren ölçümde seçilen boyutu öne almak (kumlu kaynakta 5–8 sn bekleme).
