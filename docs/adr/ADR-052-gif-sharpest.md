# ADR-052 — "GIF yap": her zaman en net olan — paylaşılabilen en büyük boyut ve "Video olarak (en net)"

> Tarih: 2026-10-21 · Durum: UYGULANDI (web; birim, e2e, kalite katmanı; sayılar aşağıda). Telefonda, Safari'de,
> Firefox'ta ve sohbet uygulamalarında **denenmedi**. Politika **değişmedi** (doc 15 `2026-10-18.v12`: GIF yap
> ücretsiz, cihazda, en çok 10 sn; video çıktısı olağan, ücretsiz, cihazda indirmenin aynısı ve aynı 10 sn'lik kısım);
> şema **değişmedi** (EDL v6; GIF ekranı proje saklamaz).
> Kaynak: kurucunun hedefi — "bence her zaman en neti vermeliyiz" — ve ana oturumun iki kararı (kurucu devretti).
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

## Kurucu kararları

1. **Bekleme:** ilk GIF, en net boyut bulunana dek bekler (bu masaüstünde 1,3–10,6 sn; telefonda ~3 katı, ölçülmedi).
   Alternatif: düğme hemen basılabilir ve o anda ölçülmüş en büyük sığan boyutla yapılır (ya da "Küçük"le).
2. **10 MB payı:** tahmin ±%10; seçim tahmin ≤ 10 MB. İstenirse ≤ 9 MB ile seçilir (bir boy küçük GIF daha sık).
3. **Varsayılan çıktı GIF.** İstenirse video varsayılan olur (kart adı "GIF yap" kalırken).
4. **Videonun boyutu:** masaüstünde yazılım kodlayıcıyla 1080p video ilk seçilen GIF'ten büyük olabiliyor (10 sn 18–21
   MB). İstenirse video çıktısı için bit hızı tavanı ya da 720p sınırı (netlikten verir).
5. Sesli seçenek yok (yukarıdaki gerekçe); istenirse bir onay kutusu.
