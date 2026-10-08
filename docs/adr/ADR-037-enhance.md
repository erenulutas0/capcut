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

## Parametreler nasıl seçildi

Her parametre, aşağıdaki iki ölçüm kümesi üstünde **tek tek değiştirilerek** seçildi
(`web/scripts/enhance-eval/tuning.mjs`; her denemenin sonucu `web/enhance-results/quality-*.json`
dosyalarında, depo dışı): bir değişiklik, bozulmuş karelerde ortalama kazancı artırıyor **ve**
temiz karelerle gerçek kayıtlarda zararı artırmıyorsa kaldı. Öne çıkan kararlar:

- **Beyaz dengesi sıkı kıstırıldı.** Tam düzeltme (pay 1, sapma 0,3) sentetik renk sapmasını en iyi
  gideriyordu ama gökyüzü / su / orman ağırlıklı temiz karelerde ve gerçek kayıtlarda olmayan bir
  sapmayı "düzeltiyordu". Otomatik'te pay 0,5, en çok %6; iki kestirim aynı yönü göstermiyorsa hiç.
  Bedeli: gerçek bir renk sapmasının ancak küçük bir kısmı düzelir (tabloda +0,3 / +0,9 dB).
- **Canlılık küçük tutuldu** (0,15; 0,3 ve 0,6 denendi): daha fazlası "soluk" karede bile
  PSNR'ı düşürüyor, temiz karelerde zararı büyütüyordu.
- **Keskinleştirme 1,5, aşma payı 0.** 2,5 bulanık karelerde SSIM'i biraz daha artırıyor ama
  PSNR'ı düşürüyor ve sıkıştırılmış karede blok kenarlarını büyütüyor; aşmaya izin vermek
  (0,15) hale üretiyordu. 2,5 yalnız Güçlü'de.
- **Siyah düzeyi eşikleri temkinli** (0,12 / 0,24; 0,10 / 0,16 ve 0,15 / 0,27 denendi).
- **Kum kestirimi düzeltmesi 1,18:** kanal başına bağımsız gürültünün parlaklıktaki payı 0,75σ
  olduğu için; eşikler buna göre ölçeklendi.
- **Ekran kaydı koruması** gerçek bir ekran kaydı (R05) bozulduktan sonra eklendi.
- **Ani pozlama değişiminde araya bakma** titreme ölçümünde 60 seviyelik taşma görüldükten
  sonra eklendi (aşağıda).

## Ölçüm 1 — kalite: bilinen bozulmalar (referanslı)

**Küme:** açık lisanslı dört temiz kaynaktan 9 kare (`tests/media/real/` içindeki
`web-*` dosyaları: Pixel 6 Pro şelale — kamu malı; Samsung ağır çekim — Apache-2.0; iPhone 11 yol —
CC BY-ND 4.0; iPhone 13 Pro iskele — CC BY-NC-ND 4.0), kısa kenar 720'ye küçültülmüş; her kare
12 bilinen biçimde bozuldu (`web/scripts/enhance-eval/build-set.mjs`). Bozulmalar doğrusal ışıkta:
az pozlama ×0,5 ve ×0,25; düşük kontrast (×0,65 + 0,06); sıcak / soğuk renk sapması; doygunluk ×0,6;
Gauss bulanıklığı σ 1 ve 2 piksel; Gauss kumu σ 5 ve 10 seviye; karanlık + kumlu; H.264 ile sert
sıkıştırma. Ölçü: bozulmuş ve iyileştirilmiş karenin **temiz kareye** PSNR'ı ve SSIM'i
(parlaklıkta), referanssız keskinlik (çarpan) ve kum (seviye). İşleyici: referans işleyici
(tarayıcıdaki WebGL yolu ona en çok 1 seviye, ortalama 0,035 seviye uzak ölçüldü).
Betik: `web/scripts/enhance-eval/evaluate.mjs`. **Sınırı:** 9 kare, 4 sahne — küçük bir küme;
sahne türü çeşitliliği dar (gece çekimi, yüz yakın planı, iç mekân yok).

### Otomatik

| Bozulma | PSNR önce → sonra (dB) | Δ dB | SSIM önce → sonra | Δ | Kötüleşen kare (SSIM / PSNR) | Keskinlik × | Kum önce → sonra |
|---|---|---|---|---|---|---|---|
| temiz (9 karenin 8'i değişti) | ∞ → 45,46 (en kötü 37,23) | — | 1 → 0,9996 | −0,0004 | 2/9 · 8/9 | 1,03 | 0,56 → 0,56 |
| az pozlama ×0,5 | 16,54 → 29,20 | **+12,66** | 0,9248 → 0,9889 | +0,0641 | 0 · 0 | 1,63 | 0,44 → 0,58 |
| az pozlama ×0,25 | 11,68 → 22,83 | **+11,16** | 0,7385 → 0,9829 | +0,2444 | 0 · 0 | 2,51 | 0,35 → 0,56 |
| düşük kontrast | 21,54 → 22,44 | +0,90 | 0,9097 → 0,9571 | +0,0474 | 0 · 3/9 | 1,57 | 0,38 → 0,49 |
| sıcak renk sapması | 28,18 → 28,49 | +0,31 | 0,9999 → 0,9995 | −0,0004 | 2/9 · 2/9 | 1,03 | 0,56 → 0,57 |
| soğuk renk sapması | 29,37 → 30,23 | +0,86 | 0,9999 → 0,9995 | −0,0004 | 2/9 · 0 | 1,03 | 0,55 → 0,56 |
| soluk renk | 30,90 → 30,64 | **−0,27** | 0,9997 → 0,9993 | −0,0004 | 2/9 · 5/9 | 1,04 | 0,57 → 0,58 |
| bulanık σ1 | 30,72 → 31,02 | +0,30 | 0,9118 → 0,9218 | +0,0101 | 0 · 2/9 | 1,38 | 0,19 → 0,22 |
| bulanık σ2 | 26,70 → 26,73 | +0,02 | 0,7811 → 0,7932 | +0,0122 | 0 · 2/9 | 1,60 | 0,15 → 0,18 |
| kum σ5 | 34,16 → 38,00 | +3,84 | 0,9016 → 0,9717 | +0,0701 | 0 · 1/9 | 0,63 | 4,04 → 1,11 |
| kum σ10 | 26,61 → 33,26 | +6,65 | 0,6683 → 0,9010 | +0,2326 | 0 · 0 | 0,31 | 9,05 → 2,09 |
| karanlık + kumlu | 12,57 → 26,99 | **+14,42** | 0,7079 → 0,9367 | +0,2288 | 0 · 0 | 1,03 | 3,88 → 1,40 |
| sıkıştırılmış | 26,99 → 26,82 | **−0,17** | 0,7291 → 0,7291 | +0,0001 | 4/9 · 7/9 | 1,26 | 0,13 → 0,15 |

12 bozulmanın ortalaması: **+4,22 dB PSNR, +0,0757 SSIM.**

### Hafif ve Güçlü (özet; tam tablolar `web/enhance-results/quality-final.txt`)

| Bozulma | Hafif Δ dB / Δ SSIM | Otomatik Δ dB / Δ SSIM | Güçlü Δ dB / Δ SSIM |
|---|---|---|---|
| temiz: değişen kare · ort. PSNR (en kötü) | 2/9 · 53,6 (41,69) | 8/9 · 45,46 (37,23) | 9/9 · 38,67 (31,18) |
| az pozlama ×0,5 | +3,95 / +0,0462 | +12,66 / +0,0641 | +11,31 / +0,0652 |
| az pozlama ×0,25 | +1,65 / +0,0900 | +11,16 / +0,2444 | +18,43 / +0,2530 |
| düşük kontrast | +1,05 / +0,0293 | +0,90 / +0,0474 | +1,50 / +0,0577 |
| sıcak renk sapması | −0,06 / −0,0001 | +0,31 / −0,0004 | +2,09 / −0,0009 |
| soğuk renk sapması | −0,03 / −0,0001 | +0,86 / −0,0004 | +4,48 / −0,0008 |
| soluk renk | −0,01 / −0,0001 | −0,27 / −0,0004 | −1,26 / −0,0009 |
| bulanık σ1 | +0,26 / +0,0049 | +0,30 / +0,0101 | −0,62 / +0,0144 |
| bulanık σ2 | +0,10 / +0,0061 | +0,02 / +0,0122 | −0,55 / +0,0175 |
| kum σ5 | +4,51 / +0,0584 | +3,84 / +0,0701 | +0,62 / +0,0688 |
| kum σ10 | +6,09 / +0,1724 | +6,65 / +0,2326 | +5,46 / +0,2443 |
| karanlık + kumlu | +2,02 / +0,1154 | +14,42 / +0,2288 | +14,33 / +0,2302 |
| sıkıştırılmış | −0,02 / +0,0003 | −0,17 / +0,0001 | −0,80 / −0,0002 |
| **ortalama (12)** | **+1,63 / +0,0435** | **+4,22 / +0,0757** | **+4,58 / +0,0790** |

### Bu tabloların dürüst okunuşu

- **Asıl kazanç ışıkta ve kumda.** Karanlık, kumlu ve karanlık + kumlu görüntü belirgin biçimde
  düzelir.
- **Bulanıklık giderilmez.** Bulanık karede kazanç +0,02 … +0,30 dB / +0,01 SSIM: kenarlar biraz
  belirginleşir (keskinlik ×1,4–1,6), kaybolan ayrıntı geri gelmez. Arayüzdeki cümle bu yüzden
  "Çok bulanık bir videoyu netleştiremez."
- **Renk sapması yalnızca biraz düzelir** (+0,3 / +0,9 dB): bilinçli bir kıstırmanın bedeli.
- **Kötüleştirdiği yerler (Otomatik):** soluk renk (−0,27 dB — canlılık, doygunluğu 0,6'ya inmiş
  kareyi geri getirmeye yetmez, yaptığı küçük değişiklik de referanstan uzaklaştırır);
  sıkıştırılmış kare (−0,17 dB, 9 karenin 7'sinde PSNR düşer — keskinleştirme blok kenarlarını da
  bir miktar keskinleştirir; SSIM değişmez); temiz kare (8/9 karede çok küçük renk / siyah
  düzeyi değişikliği, ortalama 45,5 dB, en kötü 37,2 dB — göze zor görünür ama "hiç dokunmadı"
  değildir).
- **Kum süzgeci keskinliği düşürür** (×0,31–0,63): kumla birlikte ince doku da yumuşar.
- **Güçlü daha çok zarar verebilir:** soluk −1,26 dB, bulanık −0,6 dB, sıkıştırılmış −0,8 dB,
  temiz karede en kötü 31,2 dB. Seçenekteki uyarı bu yüzden var; varsayılan Otomatik'tir.

## Ölçüm 2 — gerçek kayıtlarda "zarar verme"

`E:\capcut_better\web\tests\media\real\` içindeki 15 kayıt (yalnız okundu; içerikleri bu belgede
anlatılmaz, R01…R15 diye anılır). Her kayıttan eşit aralıklı kareler, dışa aktarma boyutunda;
analiz ve referans işleyici uygulamadakiyle aynı (`web/scripts/enhance-eval/no-harm.mjs`).
Referans olmadığı için ölçülen şey "ne kadar değişti"dir (girdiye SSIM / PSNR, ortalama
parlaklık farkı); "daha iyi oldu" iddiası değildir. R09 ve R11 HDR'dir, bu çevrimdışı betikte
ölçülmedi (aşağıda tarayıcıda denendi).

| Kayıt | Kaynak → çıktı | Otomatik ne yaptı | Girdiye en düşük SSIM (Hafif / **Otomatik** / Güçlü) | Parlaklık farkı (Otomatik, seviye) |
|---|---|---|---|---|
| R01 | 854×480 → 720p | siyah düzeyi (≤0,016), renk, keskinleştirme | 0,9993 / **0,9979** / 0,9957 | −0,2 |
| R02 | 592×1280 → 720 | renk, keskinleştirme | 0,9996 / **0,9987** / 0,8637 | −0,1 |
| R03 | 720×1280 (karanlık) | kazanç ×3, renk, keskinleştirme | 0,9845 / **0,8385** / 0,6480 | +29,6 |
| R04 | 480×724 → 720 | renk, keskinleştirme | 0,9998 / **0,9992** / 0,9539 | +0,1 |
| R05 | 1080×1920 (ekran kaydı) | **hiçbir şey** | 1 / **1** / 1 | 0 |
| R06 | 1280×720 | siyah düzeyi (≤0,035) | 0,9962 / **0,9882** / 0,9615 | −1,4 |
| R07 | 1280×720 | kazanç ≤1,93, renk | 0,9947 / **0,9600** / 0,8727 | +4,1 |
| R08 | 224×128 → 720p | renk, keskinleştirme | 1,0000 / **0,9998** / 0,9536 | 0 |
| R10 | 1920×1080 | renk (beyaz dengesi ≤%4,5) | 1 / **0,9998** / 0,9938 | −0,1 |
| R12 | 1920×1080 | **hiçbir şey** | 1 / **1** / 0,9848 | 0 |
| R13 | 2160×3840 → 1080 | siyah düzeyi (≤0,007), canlılık | 1 / **0,9988** / 0,9962 | −1,4 |
| R14 | 1080×1920 | canlılık, keskinleştirme | 0,9999 / **0,9996** / 0,9991 | 0 |
| R15 | 1080×1920 | renk (beyaz dengesi ≤%3) | 1 / **1,0000** / 0,9891 | +0,1 |

Okunuşu: Otomatik 13 SDR kaydın 2'sine hiç dokunmadı, 8'inde girdiye SSIM ≥ 0,997 kaldı (küçük
renk / keskinlik dokunuşu), üçünde belirgin değişiklik yaptı (R03 karanlık: aydınlatıldı; R07:
aydınlatıldı; R06: siyah düzeyi). Bu üçünde değişikliğin **iyileştirme** olduğu bir ölçümle değil,
önce / sonra resmine bakılarak söylenebilir — sihirbazın o resmi göstermesinin nedeni budur.
Güçlü, gölge açtığı için birçok kayıtta belirgin değişiklik yapar (R02 0,86; R07 0,87; R03 0,65).

## Ölçüm 3 — titreme (kareden kareye tutarlılık)

Pozlaması değişen yapay klip (300 kare, 10 sn: ilk 4 sn yavaşça aydınlanır, sabit kalır, 6. sn'de
— 180. kare — birden kararır, 8. sn'de — 240. kare — geri gelir), `web/scripts/enhance-eval/flicker.mjs`. "Titreme" = ortalama parlaklığın ikinci
farkının ortalama mutlak değeri (seviye); "taşma" = ani değişimin çevresinde, değişimin kendisi
dışındaki en büyük sapma.

| Yöntem (Otomatik) | En büyük kare-kare fark | Titreme | Ani değişim çevresinde taşma | Karanlık bölümlerin ort. parlaklığı |
|---|---|---|---|---|
| kaynak | 68,3 | 0,152 | 2,5 | 65,8 |
| her kare kendi başına düzeltilse | 20,8 | **0,388** | 2,5 | 112,1 |
| yumuşatma var, araya bakma yok | 82,0 | 0,181 | **60,5** | 108,3 |
| **uygulamadaki plan** | 23,5 | **0,183** | **2,6** | 111,0 |

Güçlü'de plan: titreme 0,185, taşma 2,6, en büyük kare-kare fark 8,8. Yani plan, karanlık
bölümleri aydınlatırken titremeyi kaynağın düzeyinde tutar (0,152 → 0,183; kare başına düzeltme
0,388 olurdu) ve ani değişimde taşmaz (2,6; kaynakta 2,5). Tarayıcıda, gerçek dışa aktarmada: M23
satırında en büyük kare-kare parlaklık farkı 0,49 seviye; e2e'de pozlaması değişen klipte de
sınanır (`enhance.spec.ts`).

## Ölçüm 4 — hız ve bellek (tarayıcıda, gerçek dışa aktarma)

Bu makine (Windows 11, NVIDIA GeForce RTX 3070 Ti), 7 Ekim 2026, ölçüm kilidi altında.
`web/scripts/measure-export-memory.mjs --whole --mode=encode --profile --quality=1080
[--enhance=auto] [--enhance-engine=cpu]`; kaynaklar `web/scripts/enhance-eval/make-speed-media.mjs`
ile üretilen 1080p 30 fps klipler (10 sn: karanlık, bulanık, kumlu; 5 dakika: kumlu — üç geçişin
de çalıştığı **en pahalı** durum). Bellek: tarayıcının bütün süreç ağacının private bytes değeri,
işletim sisteminden ~400 ms'de bir. Her satır **tek koşudur** (tekrar ve yayılım ölçülmedi).
WebGL işleyicisi (worker'daki `OffscreenCanvas`, `WEBGL_debug_renderer_info`): Chrome 154 ve
Edge 154 → ANGLE / Direct3D11, RTX 3070 Ti; Playwright'ın Chromium 153'ü (başsız) → **SwiftShader**
(GPU yok, WebGL yazılımla).

### 10 saniyelik 1080p (300 kare)

| | Chromium 153 (GPU yok) | Chrome 154 | Edge 154 |
|---|---|---|---|
| Düz kodlama | 6,2 sn | 1,9 sn | 2,2 sn |
| Otomatik — karanlık (ışık + renk + keskinleştirme) | 39,9 sn · 103 ms/kare | 3,1 sn | 3,4 sn |
| Otomatik — bulanık (ışık + renk + keskinleştirme) | 32,7 sn · 91 ms/kare | 3,4 sn | 4,2 sn |
| Otomatik — kumlu (ışık + renk + kum süzgeci) | 85,5 sn · 244 ms/kare | 4,7 sn | 5,5 sn |
| Otomatik — karanlık, **işlemci yolu** (zorlanmış) | 97,3 sn · 306 ms/kare | 86,2 sn · 278 ms/kare | 104,2 sn · 336 ms/kare |
| Videoya bakma (analiz, 21 kare) | 1,2–5,3 sn | 1,1–1,9 sn | 1,2–2,4 sn |
| Tepe bellek: düz → iyileştirilmiş (MiB) | 731 → 709 / 719 / 811 | 797 → 880 / 854 / 1084 | 828 → 882 / 819 / 1064 |

"ms/kare" profilin `enhance` aşamasının kare başına ortalamasıdır. GPU'lu tarayıcılarda bu aşama
0,2–0,3 ms görünür, çünkü çizim komutları eşzamansızdır ve asıl iş GPU'da, kodlamayla iç içe
yapılır; o sütunlarda dürüst ölçü **toplam süredir**.

### 5 dakikalık 1080p (9001 kare, kumlu kaynak)

| | Düz kodlama | Otomatik | Fark | Bunun analizi (237 kare) | Tepe bellek düz → iyileştirilmiş |
|---|---|---|---|---|---|
| Chrome 154 | 55,8 sn | **80,1 sn** | +24,3 sn (×1,44) | 23,6 sn | 1018 → 1119 MiB |
| Edge 154 | 54,5 sn | **76,9 sn** | +22,4 sn (×1,41) | 25,1 sn | 1044 → 1058 MiB |
| Chromium 153 (GPU yok) | 163,6 sn | **2162 sn (36 dk)** | ×13,2 | 68,7 sn | 761 → 837 MiB |

Okunuşu:

- **GPU olan tarayıcıda** iyileştirmenin bedeli neredeyse tamamen indirmeden önceki bakıştır
  (5 dakikalık videoda ~24 sn); kare başına ek maliyet ölçülebilir düzeyin altındadır. Sihirbazda
  bakış önizleme için zaten yapıldığından indirme sırasında yeniden yapılmaz.
- **GPU yoksa** (yazılım WebGL ya da işlemci yolu) kare başına 0,1–0,3 sn: 5 dakikalık 1080p
  kumlu video **36 dakika** sürdü. İşlemci yolu kullanılacaksa sihirbaz bunu önceden söyler;
  yazılım WebGL (SwiftShader) durumunda **söylemez** — denetim yalnızca doğruluğa bakar, hıza
  değil. Bu bilinen bir eksiktir (aşağıda).
- **Bellek:** tepe değer düz kodlamaya göre +14 … +101 MiB (5 dakika) arasında; GPU'lu tarayıcılarda
  renderer ve GPU süreçlerinin tepe değeri ilk yarıda yükselip sonra yatay kalıyor (sürekli
  büyüme görülmedi; 5 dakikadan uzun süre ölçülmedi). 10 saniyelik kumlu satırdaki
  ~+290 MiB (Chrome 797 → 1084) tek koşudur; 5 dakikalık aynı içerikte +101 MiB ölçüldü.
- Ölçülmedi: 720p hız, 4K kaynak hızı, tümleşik (Intel / AMD) GPU, telefon.

## Ölçüm 5 — kare kimliği, zaman, renk etiketi (matris satırı M23)

`web/scripts/lib/matrix-cases.mjs` → **M23**: karanlık kamera görüntüsü, iki kesit, Otomatik;
aynı kurgu bir kez düz, bir kez iyileştirilmiş dışa aktarılır ve iki dosya karşılaştırılır.
Chromium 153, Chrome 154 ve Edge 154'te **PASS** (matrisin tamamı: 30 / 30 PASS, üçünde de):
kare sayısı ve süre birebir (120 kare, 4,000 sn); kare zamanları birebir; renk etiketleri (aralık,
matris, aktarım, birincil renkler) düz çıktıyla aynı; ses, çözülmüş örnekler düzeyinde birebir;
120 karenin 120'si düz çıktıdakinden aydınlık (en az +47 seviye, Chromium) ve onunla aynı resim
(korelasyon ≥ 0,999); siyah / bozuk kare yok; kare-kare parlaklık farkı en çok 0,49 seviye; yöntem
satırı "Görüntü yeniden işlendi (iyileştirme her kareyi değiştiriyor)".

Gerçek kayıtlar (`run-real-media.mjs --browser=chrome`, iyileştirme **kapalı** — gerileme denetimi):
15 / 15 PASS.

## HDR kaynak (tarayıcıda denendi; ölçüm değil, çalışıyor mu denetimi)

İyileştirme HDR → SDR yumuşak kırpmadan sonra çalışır. Sihirbaz, Otomatik:

| Kaynak | Tarayıcı | Sonuç |
|---|---|---|
| R11 (gerçek kayıt, HEVC HLG, 1080×1920, 21,7 sn) | Chrome 154 | "ışık ve kontrast biraz düzeltildi, renkler toparlandı"; çıktı H.264, 652 kare, BT.709 / sRGB etiketli SDR; siyah kare 0 |
| R09 (gerçek kayıt, HEVC PQ, 4K, 1,1 sn) | Chrome 154 | "değiştirilecek bir şey bulunamadı" — indirme kapalı |
| `m10-hdr10.mp4` (yapay, HEVC PQ) | Chrome 154 | "kenarlar keskinleştirildi"; çıktı H.264 1920×1080, 180 / 180 kare, BT.709 SDR |
| `m10-hdr-pq-vp9.mp4`, `m10-hdr-hlg-vp9-rot90.mp4` (yapay, VP9) | Chromium 153 | Otomatik'te (PQ olanda Güçlü'de de) "değiştirilecek bir şey bulunamadı" — indirme kapalı; önizleme üretildi |

Sınırı: bunlar "çalıştı ve dosya geçerli" denetimleridir; HDR kaynakta kalite (referanslı ya da
referanssız) **ölçülmedi**.

## Testler

- **Birim (vitest): 1056 / 1056** (60 dosya). Yeni: `tests/unit/enhance.test.ts` (ölçümler,
  karar kuralları, ölü bantlar, geçişlerin nötrlüğü, hale yok, bantlara dokunmama, plan ve ani
  değişimde araya bakma), `enhancePlan.test.ts` (tarif → plan, parmak izi, hızlı kesim reddi),
  şema / göç / sabit dosyalar (v1 → v4), arama tabloları (yeni 14 dışarıda tutulmuş ifade: hepsi ilk
  koşuda doğru — **ama listeleri yazan da bendim; yanlıdır**), politika v8.
- **e2e (Playwright Chromium, `CLIP_TEST_HOOKS=1` derlemesi, ölçüm kilidi altında): 309 geçti,
  2 atlandı, 0 başarısız** (atlananlar isteğe bağlı iki ekran görüntüsü testi). Yeni 20 test:
  `enhance.spec.ts` (10: sihirbaz uçtan uca — vekil kaydetme penceresi, kaydedilen dosya kare kare
  ölçülür, ses birebir; bölme çizgisi fare ve klavyeyle; üç güç sırayla; "değiştirilecek bir şey
  yok" durumu; bulanık ve kumlu video; değişen pozlamada titreme yok; işlemci yolu aynı resmi verir
  ve sonuç bunu söyler; editöre taşıma; proje ile saklama ve geri dönme; dikey çerçevede bantlar
  siyah kalır) ve `enhance-a11y.spec.ts` (10: axe 0 bulgu 360 / 390 / 1440; "hayır" diyen durumlar;
  320 px'te yatay kaydırma yok; metin aralığı 360 / 390 / 1440; yalnız klavye; azaltılmış hareket).
- **CSP:** e2e ve Pages duman testinde ihlal 0 (WebGL, worker ve `OffscreenCanvas` mevcut
  politikayla çalışır; politika metni değişmedi).
- **Matris:** Chromium / Chrome / Edge 30 / 30 PASS (M23 dahil). **Gerçek kayıtlar (Chrome):** 15 / 15.
- **Pages duman testi** (statik derleme, `/capcut` altında): **7 / 7 geçti** (yeni: "İyileştir under /capcut/" — önizleme worker'dan, indirme, politika).
- `tsc --noEmit` ve `eslint .` temiz.

## Yapamadıkları (sonraki ücretli bulut aşamasının girdi listesi)

1. **Bulanıklığı gidermek.** Odak dışı ya da hareket bulanıklığında kaybolan ayrıntıyı geri
   getiremez (ölçüm: bulanık σ2'de +0,02 dB). Bu, öğrenilmiş bir model ister.
2. **Büyütmek (upscaling / "4K yap").** Çıktı çözünürlüğü değişmez; 480p kaynak 720p çerçeveye
   yine yumuşak ölçeklenir, yalnız kenarları biraz belirginleşir.
3. **Sıkıştırma izlerini silmek.** Blok ve halka izleri kalır; keskinleştirme onları bir miktar
   belirginleştirir (−0,17 dB).
4. **Ağır kumu ayrıntıyı koruyarak temizlemek.** Süzgeç yalnız uzamsaldır (kareler arası değil);
   kumla birlikte ince doku da gider. Zamansal / öğrenilmiş kum giderme yok.
5. **Gerçek renk düzeltme.** Güçlü bir renk sapmasının ancak küçük kısmı düzelir; ten rengi,
   karışık ışık, sahne sahne ayar yok. Filtre / LUT / "sinematik görünüm" yok.
6. **Yerel düzeltme.** Yüz aydınlatma, gökyüzünü kurtarma, arka ışıkta özne — hepsi bölgesel işlem
   ister; burada yalnız bütün kareye tek eğri var. Yanmış (kırpılmış) beyazlar ve tamamen siyah
   gölgeler geri gelmez.
7. **Titreme (sarsıntı) düzeltme, kare hızı artırma, HDR çıktı.** Yok.

## Ölçülmeyen / yapılmayan

- Telefon (Android / iOS) tarayıcılarında hız, bellek ve WebGL davranışı; Safari ve Firefox
  (iyileştirme yolu hiç koşturulmadı).
- Tümleşik GPU'lu bilgisayar; 720p ve 4K kaynakta hız; 60 dakikalık iyileştirilmiş çıktı
  (en uzun ölçülen: 5 dakika).
- HDR kaynakta kalite (yalnız "çalışıyor" denetimi yapıldı).
- Algısal kalite (insan gözüyle karşılaştırma, MOS) — yalnız PSNR / SSIM ve referanssız ölçüler.
- Kalite kümesi küçük: 4 sahneden 9 kare. Gece çekimi, yüz yakın planı, iç mekân ve çok hareketli
  sahne yok; ek açık lisanslı görüntü indirilmedi (indirme için ayrı onay gerekir).
- Hız satırları tek koşudur.
- **Bilinen eksik:** yazılım WebGL (SwiftShader) kullanan tarayıcıda uzun süre önceden söylenmiyor
  (yalnız işlemci yolunda söyleniyor).
- **Bilinen eksik:** oynatıcı iyileştirilmiş görüntüyü canlı göstermez; önizleme tek karedir
  (arayüz bunu söyler).

## Açık sorular (kurucu)

1. Otomatik temiz görüntüde çok küçük renk dokunuşları yapıyor (ortalama 45,5 dB). "İyi videoya
   hiç dokunma" isteniyorsa ölü bantlar genişletilebilir; bedeli hafif sapmaların da düzelmemesi.
2. GPU'suz cihazda uzun videoya süre tahmini / uyarı eklensin mi?
3. "Güçlü" kalsın mı? Ölçümde bulanık, soluk ve sıkıştırılmış görüntüde Otomatik'ten kötü.
