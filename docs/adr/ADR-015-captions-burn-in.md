# ADR-015 — Altyazı: şema v2 ve videoya işleme

> Tarih: 2026-09-21 · Durum: KABUL EDİLDİ (şema değişikliği kurucu onaylı)
> Önceki karar: ADR-009 (altyazı ve transkript sınırı). Bu ADR onun backlog'undaki 2. adımdır.

## Karar

Kullanıcının elle yazdığı altyazı satırları, dışa aktarılan MP4'ün
**piksellerine** işlenir. Yalnızca bir altyazı dosyası üretmek ya da
yalnızca oynatıcıda göstermek bu adımda yeterli sayılmaz. Bulut yok,
transkript yok, çeviri yok, ücretli servis yok.

### Şema: EDL v2

- `captionTracks` alanı eklendi; ayrıntılar belge 10'da.
- Transkript ile görüntülenen altyazı ayrı kalır (ADR-009 §1). Bu iz
  transkript değil, ekranda görünen metindir.
- `timeBase: "output"` açıkça yazılır. İleride kaynak zamanına bağlı ya da
  içe aktarılan satırlar `"source"` ile, şema geçişi gerekmeden eklenebilir.
- v1 → v2 geçişi kayıpsız ve mekaniktir (`web/src/domain/migration.ts`).
  Tek giriş `loadProject`'tir: IndexedDB kaydı, `.clip.json` yedeği ve
  fixture'lar hep bu yoldan okunur. v1 fixture'ları
  `fixtures/edl/legacy-v1/` altında geçiş testi olarak duruyor.

### Görünüm: hazır stiller, gömülü font

- Stil yalnızca hazır değerlerden seçilir:
  - biçim: `box` (yarı saydam siyah kutu) veya `outline` (siyah kontur);
  - konum: alt, orta veya üst;
  - boyut: küçük, orta veya büyük.
- Serbest renk ya da font yok. Böylece önizlemenin gösterdiği şeyi dosya da
  garanti eder.
- Font gömülü: Inter Bold, SIL OFL 1.1. Kaynağı `@fontsource/inter` 5.3.0;
  yalnızca latin ve latin-ext alt kümeleri alındı, Türkçe ve İngilizce için
  yeterli. Dosyalar `web/public/fonts/caption/`, lisans metni `OFL.txt`.
  Sistem fontu kullanılmıyor, çünkü makineden makineye değişir.
  Inter'de olmayan glifler (emoji) tarayıcının kendi fontuna düşer; bu hem
  önizlemede hem dışa aktarmada aynı şekilde olur.
- Yerleşim saf bir fonksiyonda hesaplanır (`domain/captionLayout.ts`) ve bütün
  değerler tam piksele yuvarlanır. Önizleme ve export worker aynı çizim
  modülünü kullanır (`adapters/captionRender.ts`).
- Güvenli alan: 9:16 videoda alttan %16 ve üstten %10 boş bırakılır, çünkü
  uygulamaların kendi düğmeleri oraya biner. Diğer oranlarda bu pay %8.
- Metin sığmıyorsa küçültülmez. Üçüncü bir satır gerekecekse bu bildirilir ve
  kullanıcı metni kısaltır.

### Zaman

- Satırlar çıktı zamanındadır ve videoyla aynı yuvarlamayla çıktı kare
  ızgarasına oturtulur (`frameAtUs`).
- Anlar kısaltılınca, çıktının dışına düşen satırlar silinmez: kısmen
  dışarıdaki kesilir, tamamen dışarıdaki çizilmez. Arayüz iki durumu da
  gösterir.
- Anlar yeniden sıralanınca satırlar yerinde kalır, çünkü çıktı zamanına
  bağlıdırlar. Satırların içerikle birlikte taşınması adım 3'e (zaman eşleme)
  aittir.

## Uygulama ve ölçüm (2026-09-21)

### Ne yapıldı

- **Worker'da işleme.** Her çıktı karesi çizildikten sonra, `videoSource.add`
  çağrılmadan önce, o kareyi kapsayan satır (`[startFrame, endFrame)`) aynı
  OffscreenCanvas'a `drawCaptionLayout` ile çizilir. Çizim, önizlemenin
  kullandığı modülle yapılır (`adapters/captionRender.ts`). Kaynaktan kare
  gelmese bile (tutulan kare ya da arka plan) satır yine çizilir, çünkü
  altyazı çıktı zamanına bağlıdır.
- **Satır başına bir kez yerleşim.** Kodlamaya başlamadan her satırın
  yerleşimi bir kez hesaplanır (`domain/captionBurnIn.ts`,
  `preflightCaptions`). Bu dizi aynı zamanda önbellektir: kare döngüsü
  yalnızca bir ikili arama yapar (`cueIndexAtFrame`). Böylece 5 dakikalık
  çıktı her karede metni yeniden sarmaz.
- **Font worker'ın içinde yüklenir.** Sayfanın origin'i başlatma isteğiyle
  worker'a gönderilir ve font mutlak URL ile yüklenir. Yüklendikten sonra iki
  şey doğrulanır: yüz `self.fonts` içinde `loaded` durumunda olmalı ve bir
  deneme metni hem `sans-serif` hem `serif` yedeklerinden farklı bir
  genişlikte ölçülmeli. Bu ikisinden biri tutmazsa sonuç
  `caption_font_unavailable` olur. Başka bir fonta sessizce geçilmez.
- **Uygunluk kapısı.** Plan altyazı içeriyorsa kapı (Stage B/C) fontu aynı
  worker'da dener. `FontFace` ya da `self.fonts` yoksa (`api_missing`) veya
  font yüklenemezse (`load_failed`) çıktı daha başlamadan
  `caption_font_unavailable` ile reddedilir. Chromium 153, Chrome, Edge ve
  Firefox 155 worker'larında `FontFace`, `self.fonts` ve `OffscreenCanvas`
  bulunduğu ölçüldü. Firefox yine de çıktı alamaz, çünkü AAC encoder'ı yok.
- **Ön kontrol.** Üçüncü satır gerektiren bir satır, tek kare kodlanmadan
  `caption_does_not_fit` ile durdurur. Hata olayı satırın kimliğini
  (`cueId`) taşır, metnini taşımaz. Arayüz bu kimlikten satırın listedeki
  sırasını ve metnini gösterir: "Kısaltılması gereken: 2. altyazı satırı, “…”".
- Parmak izi değişmedi. Altyazılar zaten planın bir parçasıydı.

### Ölçüm: matris M17

Kaynak `m01-portrait-20s.mp4`. Aynı kurgu iki kez dışa aktarıldı: bir kez
`box`/alt, bir kez `outline`/üst stille. Anlar 0–4 s ve 8–14 s, çıktı
720×1280, 30 fps, 300 kare. Altyazılar projeye yedek içe aktarma yoluyla
girdi (`.clip.json`, uygulamanın kendi doğrulamasından geçerek). Satırlar:

- 0,5–2,5 s: "Günaydın İstanbul";
- 3,5–7 s: iki satırlık "Dağlar ışıl ışıl / Şimdi başlıyoruz". Bu satır 4
  s'deki an geçişini kapsar.

Karşılaştırma, ffmpeg ile ayrıca kurulmuş, altyazısız bir referansa göre
yapıldı. Ölçülen bölgenin dikey sınırları uygulamanın kendi
`layoutCaption` fonksiyonundan geliyor (TypeScript kaynağı Node'da
çevrildi). Yatayda güvenli bandın tamamı alındı, çünkü gerçek genişlik
Inter'in tarayıcıdaki ölçüsünü gerektirir.

| | Chromium | Chrome | Edge |
|---|---|---|---|
| Satır dışı kareler, tam kare SSIM (ortalama / en düşük, 129 kare) | 0,9417 / 0,9363 | 0,9760 / 0,9752 | 0,9760 / 0,9752 |
| box satır 1, bölgedeki ort. mutlak luma farkı (içeride medyan, en düşük / dışarıda medyan, en yüksek) | 47,1, 42,9 / 14,4, 16,0 | 47,3, 43,3 / 14,6, 16,2 | aynı (Chrome) |
| box satır 2 | 60,7, 41,7 / 14,4, 16,0 | 60,9, 42,0 / 14,6, 16,2 | aynı |
| outline satır 1 | 33,0, 32,9 / 13,2, 13,2 | 33,2, 33,1 / 13,5, 13,5 | aynı |
| outline satır 2 | 35,0, 35,0 / 13,2, 13,3 | 35,4, 35,4 / 13,6, 13,6 | aynı |
| İlk/son görünen kare (plan 15–74 ve 105–209) | 15–74, 105–209 | aynı | aynı |
| Pencere içinde eksik kare / pencere dışına taşan kare | 0 / 0 | 0 / 0 | 0 / 0 |

Chromium'da bölge SSIM'i, içeride box için 0,55–0,56 ve outline için
0,67–0,69 çıktı; dışarıda ise 0,93–0,95.

"Dışarıda" fark sıfır değil, yaklaşık 13–16. Bunun sebebi iki farklı
encoder'ın (tarayıcı ve libx264) bu yoğun test deseninde piksel piksel aynı
sonuç vermemesi. Kontrol bu yüzden iki ölçüt kullanır:

- pencere içindeki medyan, gürültünün en az 10 üstünde olmalı;
- pencere içindeki en sessiz kare, pencere dışındaki en gürültülü kareden en
  az 4 yüksek olmalı.

Görünen kare sınırları, bu iki düzeyin ortasındaki eşiğe göre bulunur.

Negatif kontrol olarak aynı ölçüm, altyazısız M01 çıktısına uygulandı.
Pencere içi ve dışı aynı çıktı (14,0 ve 14,4; 13,2 ve 13,2). Yani ölçüm
olmayan bir altyazıyı "bulmuyor".

Firefox'ta M17 UNSUPPORTED oldu. Kapı AAC encoder'ı olmadığı için açıkça
reddetti ve sahte başarı gösterilmedi.

İnsan gözüyle bakmak için iki örnek kare (yalnızca sentetik matris medyası):
`web/screenshots/caption-export-frame.png` (box, alt) ve
`web/screenshots/caption-export-frame-outline.png` (outline, üst). İkisi de
150. kareden alındı.

### Sınırlar

- Ölçülen bölge yatayda güvenli bandın tamamıdır. Kutunun gerçek genişliği
  ölçülmez; yalnızca bant içinde kaldığı görülür.
- M17 tek bir oran (9:16) ve tek bir boyutla (medium) ölçüldü. Diğer oranlar
  ve boyutlar yalnızca birim testlerde ve yerleşim fonksiyonunda sınanıyor.
- Önizleme ile dosyanın piksel düzeyinde karşılaştırması bu adımda yapılmadı.
  Önizleme katmanı ayrı bir çalışmada yapılıyor. İkisi aynı çizim modülünü
  ve aynı fontu kullanıyor.

## Sonraki adımlar (ADR-009 backlog)

3. SRT/VTT içe ve dışa aktarma; kaynak zamanına bağlı satırlar.
4. Otomatik transkript. Ayrı rıza, maliyet ve gizlilik kapısı gerekir.
5. Çeviri.
