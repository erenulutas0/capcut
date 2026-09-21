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

## Sonraki adımlar (ADR-009 backlog)

3. SRT/VTT içe ve dışa aktarma; kaynak zamanına bağlı satırlar.
4. Otomatik transkript. Ayrı rıza, maliyet ve gizlilik kapısı gerekir.
5. Çeviri.
