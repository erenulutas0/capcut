# ADR-037 — "İyileştir": cihaz üstü, tek dokunuşla görüntü iyileştirme (klasik görüntü işleme)

> Tarih: 7 Ekim 2026 · Durum: UYGULANDI (web) · Politika `2026-10-07.v8` · Şema EDL v4
> İlgili: [ADR-034](ADR-034-task-first-home.md) (kartlar), [ADR-027](ADR-027-fast-cut.md) (hızlı kesim),
> [ADR-029](ADR-029-export-memory.md) (dışa aktarma belleği), `video-editor-blueprint/docs/15_PRICING_FREE_PRO.md`.
> Bu belgedeki her sayı aşağıda adı geçen betikle, bu makinede ölçüldü. Ölçülmeyen şeyler
> "Ölçülmeyen / yapılmayan" başlığında tek tek yazılıdır; hiçbir tahmin ölçüm diye sunulmadı.

## Kurucu kararı ve ne yapıldığı

Kurucu kararı (7 Ekim 2026): planlanan son ücretsiz kart **"İyileştir"** yapılsın — tek dokunuş, cihazda,
**klasik görüntü işleme**. Yapay zekâ değildir; büyütme (upscaling) ve gerçek bulanıklık giderme
değildir ve arayüzün hiçbir yerinde böyle söylenmez. Bunlar sonraki ücretli bulut aşamasına
bırakıldı (belgenin sonundaki "Yapamadıkları" o aşamanın girdi listesidir).

Yapılan: dışa aktarma worker'ının kare yoluna bir iyileştirme adımı; aynı kodla üretilen gerçek
kare önizlemesi (önce / sonra); onuncu kart ve sihirbazı; editörde Ayarlar → Görüntü'de aynı
ayar; EDL v4; politika v8.

## Karar

### 1. Ne yapar — üç geçiş, sabit sıra

Kare yolu: çöz → tuvale çiz (HDR kaynakta: float tuval → yumuşak kırpma → SDR) → **iyileştir** →
altyazı → kodla. İyileştirme **HDR yumuşak kırpmadan sonra** (her zaman SDR, BT.709 pikselleri
görür) ve **altyazıdan önce** (yazı keskinleştirilmez, rengi değişmez) çalışır. Resmin dışında
kalan şeritler (dikey / kare çıktıda siyah bantlar) dokunulmadan kalır.

| # | Geçiş | Alan | Ne yapar | Sınır |
|---|---|---|---|---|
| 1 | Kumlanma süzgeci | gama (kodlanmış) | 5×5 iki yanlı (bilateral) süzgeç; ağırlık parlaklık farkından | yalnız ölçülen kum > 1,5 seviye ise; tam güç 3,4'te; sigma en çok 24 seviye |
| 2 | Işık ve renk | **doğrusal ışık** (sRGB/BT.709 eğrisi açılır, sonunda geri kapanır) | kanal başına yumuşak siyah düzeyi; beyaz dengesi kazançları (parlaklığı koruyacak biçimde normalleştirilmiş); kazanç; gama; parlaklıkta rasyonel omuz (diz 0,5 — beyazlar kırpılmaz, yuvarlanır); canlılık (az doygun renge daha çok); gam dışına çıkan rengi parlaklığa doğru çekme | aşağıdaki güç tablosu |
| 3 | Keskinleştirme | gama, yalnız parlaklık | 3×3 bulanık maske (unsharp); eşik = 2 × ölçülen kum; sonuç dört komşunun en küçük / en büyüğü arasına **kıstırılır** | hale (aşma) tanım gereği 0; kum > 4,6 ise hiç yapılmaz |

Etkisiz (nötr) geçiş atlanır; üçü de nötrse kare hiç işlenmez. Renk etiketleri, kare sayısı ve
zaman damgaları değişmez: iyileştirme yalnızca tuvaldeki pikselleri değiştirir.

### 2. Ne kadar yapacağına nasıl karar verir — önce videoya bakar

İndirmeden (ve önizlemeden) önce video bir kez gezilir: en az 0,5 sn arayla, en çok 240 kare
(her kesitin ilk ve son karesi dahil). Her karede ölçülenler (`measureFrame`,
`web/src/domain/enhance.ts`): parlaklığın %0,5 / %50 / %99,5 dilimleri, düz alan payı,
gri-dünya ve beyaz-yama renk ortalamaları, doygunluk, kum (blok tabanlı Immerkær kestirimi,
en sakin bloklardan), keskinlik (kontrasta göre eşiklenmiş gradyan enerjisi).

- **Bakış (renk, keskinlik, kum) video için tektir** — tipik (ortanca) ölçülerden seçilir; kareden
  kareye değişmez, bu yüzden titremez.
- **Işık (kazanç, siyah, gama) noktadan noktaya değişebilir** ama zamanda yumuşatılır (2 sn'lik,
  parlaklık farkına duyarlı ortanca / iki yanlı yumuşatma) ve kareler arasında doğrusal
  aradeğerlenir. Ardışık iki bakış arasında ışık birden değişiyorsa (sahne değişimi, pozlama
  sıçraması) araya yeni bakışlar eklenir (en çok 96) ve değişim **bitişik iki kareye** kadar
  daraltılır; düzeltme o iki kare arasında değişir, öncesine ve sonrasına taşmaz.

### 3. "Zarar verme" kuralları (Otomatik bunlarla korunur)

| Kural | Değer | Neyi önler |
|---|---|---|
| Aydınlatma yalnız parlak uç düşükse | %99,5 dilimi < 0,8 ise başlar, 0,7'de tam | zaten aydınlık videoyu yakmayı |
| Ortanca tavanı | ortanca 0,55'i geçecekse kazanç kısılır | gece / loş sahneyi gündüze çevirmeyi |
| Siyah düzeyi yalnız siyahlar kalkıksa | %0,5 dilimi 0,12'de başlar, 0,24'te tam | bilerek açık tonlu (sisli, yüksek anahtar) görüntüyü ezmeyi |
| Yüksek anahtar koruması | ortanca 0,3–0,42 üstünde siyah düzeltmesi söner | açık tonlu sahneleri karartmayı |
| Grafik / ekran kaydı koruması | düz alan payı ≥ 0,4 ya da doygunluk 0,5→0,65 ise ışık ve renk kapanır | ekran kaydı, sunum, çizim renklerini bozmayı |
| Ölü bantlar | kazanç 0,1 · siyah 0,004 · gama 0,04 · renk sapması 0,02 · canlılık 0,05 | ölçüm gürültüsünden doğan anlamsız küçük değişiklikleri |
| Beyaz dengesi | gri-dünya ve beyaz-yama **aynı yönü** gösteriyorsa; Otomatik'te sapmanın yarısı, kanal başına en çok %6 | gökyüzü / deniz / orman gibi tek renkli sahneyi "renk sapması" sanmayı |
| Canlılık | doygunluk 0,35'in altındaysa; Otomatik'te en çok 0,15 | zaten canlı rengi bağırtmayı |
| Keskinleştirme | keskinlik < 1,05 ise (tam güç 0,8'de) | zaten keskin görüntüde sıkıştırma izlerini büyütmeyi |
| Gama ile gölge açma | yalnız Güçlü'de | Otomatik'te görüntünün "yıkanmasını" |

### 4. Güçler

| | Hafif | **Otomatik** (varsayılan) | Güçlü |
|---|---|---|---|
| En çok kazanç (doğrusal) | 1,5 | 3 | 4 |
| Gereken kazancın uygulanan payı | 0,75 | 1 | 1 |
| En çok siyah düzeyi / payı | 0,03 / 0,4 | 0,06 / 0,7 | 0,10 / 1 |
| En düşük gama (gölge açma) | 1 (yok) | 1 (yok) | 0,8 |
| Beyaz dengesi payı / en çok sapma | 0 / 0 | 0,5 / 0,06 | 0,8 / 0,15 |
| Canlılık | 0,06 | 0,15 | 0,30 |
| Keskinleştirme miktarı | 0,7 | 1,5 | 2,5 |
| Kumlanma süzgeci (sigma / kum) | 1,3 | 2,1 | 2,9 |

Ortak: alt hedef 0,03, üst hedef 0,92, ortanca hedefi 0,4, omuz dizi 0,5, kum kestirim
düzeltmesi 1,18. Tek kaynak: `ENHANCE_TUNING` (`web/src/domain/enhance.ts`); motor sürümü
`ENHANCE_ENGINE_VERSION` parmak izine girer.

### 5. Nerede çalışır — WebGL2, ölçülmüş işlemci yedeği

- **WebGL2**, worker'da `OffscreenCanvas` üstünde (`adapters/export/enhanceGl.ts`): tuval doku
  olarak yüklenir, geçişler GLSL ES 3.00 gölgelendiricileriyle (`texelFetch`, süzme yok) çalışır,
  ara doku varsa RGBA16F'dir, sonuç tuvale geri çizilir.
- **Referans işleyici** (`renderEnhanced`, saf TypeScript) aynı matematiğin tek tanımıdır;
  ölçümlerin tamamı ve birim testleri onunla yapılır.
- **Çalışma anı denetimi** (`frameEnhancer.ts`): her dışa aktarmanın başında bir sınama resmi
  hem WebGL hem referansla işlenir. En büyük fark ≤ 2 seviye ve ortalama ≤ 0,4 değilse (ya da
  WebGL2 yoksa / bağlam düşerse) **işlemci yoluna** geçilir — yavaş ama aynı resim. Bu durumda
  sihirbaz önceden "Bu cihazda grafik hızlandırma kullanılamıyor…" der ve sonuç satırı "Grafik
  hızlandırma olmadan yapıldı." yazar.
- İyileştirme bir karede başarısız olursa dışa aktarma **durur** (`enhance_failed`); iyileştirilmemiş
  kare sessizce yazılmaz.

### 6. Önizleme: dışa aktarmayla aynı kod

"Önce / sonra" resmi worker'a giden `enhancePreview` isteğiyle üretilir: aynı çözücü, aynı
`drawSegmentFrame`, aynı analiz, aynı `FrameEnhancer`, dışa aktarma boyutunda. Ayrı bir "önizleme
süzgeci" yoktur. Analiz sonucu indirmeye taşınır (aynı girdi ise yeniden bakılmaz). Bölme çizgisi
yerel bir `input type="range"`'dir: sürüklenir, ok tuşlarıyla kayar, ekran okuyucuya yüzdesini
söyler; 320 px'te yatay kaydırma yapmaz. "Başka bir kare göster" videonun dört ayrı yerinden (%30, %60, %85, %10) kare
getirir.

### 7. Kart ve sihirbaz

Onuncu kart **İyileştir** ("Işık, renk, netlik"), `/yap/iyilestir`. Akış: **video seç → önce /
sonra + "Ne kadar?" (Hafif · Otomatik · Güçlü; Otomatik seçili) → İndir → kaydedildi + paylaş.**
Açılış ekranından itibaren varsayılanla **üç dokunuş**: kart, video seçmek, "İndir" (dosya seçme
ve kaydetme pencereleri tarayıcınındır, sayılmadı).
Dürüst cümle kartın arama sonucunda ve sihirbazın ilk ekranında aynıdır:
**"Işığı, rengi ve keskinliği toparlar. Çok bulanık bir videoyu netleştiremez."**
Sihirbaz ne yapılacağını önceden söyler ("Yapılacaklar: video belirgin biçimde aydınlatılır,
kumlanma azaltılır"); değiştirilecek bir şey bulunamazsa bunu söyler ve "İndir"i kapatır
("…zaten iyi görünüyor"). "Daha fazla ayar → editörde aç" seçilen gücü editöre taşır;
Ayarlar → Görüntü → "Görüntüyü iyileştir" (Kapalı · Hafif · Otomatik · Güçlü) aynı ayardır ve
aynı önizlemeyi gösterir. İndirme bittiğinde sonuç satırı gerçekte ne yapıldığını yazar
("İyileştirildi (Otomatik): …").

Arama: "kaliteyi yükselt", "4K yap", "bulanıklığı sil", "netleştir", "karanlık", "renkleri
düzelt" gibi istekler bu karta gelir ve kart o dürüst cümleyle görünür. Gerçek filtre / efekt,
titreme düzeltme ve arka plan istekleri "Bunu henüz yapamıyoruz." olarak kalır.

### 8. Veri: EDL v4

`enhance?: { strength: 'light' | 'auto' | 'strong' }` — tarifin kökünde, isteğe bağlı. Alan yoksa
iyileştirme kapalıdır ve çıktı baytı baytına eskisi gibidir (parmak izi alanı yalnız açıkken
içerir). Göç v3 → v4 yalnızca sürüm numarasını değiştirir; v1 → v2 → v3 → v4 zinciri kayıpsızdır
(sabit dosyalar: `web/fixtures/edl/legacy-v3/`, `valid/enhance-*.json`, `invalid/enhance-*.json`).
İyileştirme açıkken hızlı kesim (ADR-027) uygulanmaz: görüntü her zaman yeniden kodlanır ve yöntem
satırı nedenini söyler.

