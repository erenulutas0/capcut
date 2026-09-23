# ADR-022 — HDR kaynak: SDR'ye tarayıcının dönüşümü + parlak renk yumuşak kırpma, çalışma anında doğrulanarak

> Tarih: 2026-09-23 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine: Windows 11, RTX 3070 Ti;
> Chrome 153, Edge 153, Playwright Chromium 153). Ölçüm belgesi:
> [`docs/spikes/2026-09-23-hdr-tonemap.md`](../spikes/2026-09-23-hdr-tonemap.md).

## Bağlam

Telefonların HDR kayıtları (iPhone: HEVC HLG + Dolby Vision 8.4; Android: HEVC PQ /
HDR10+) bilerek reddediliyordu: doğrulanmış bir HDR→SDR yolu yoktu ve doc 09
"doğrulanmış tone mapping hattı yoksa anlaşılır biçimde reddet" diyor. Çıktı her
zaman H.264 SDR bt709 (doc 15).

Ölçülen ret sebepleri: Chrome dosyaları çözebiliyordu, ret yalnızca politikaydı.
Edge ve Playwright Chromium'da bu makinede HEVC çözücüsü yok; dosyalar codec
yüzünden içe aktarmada reddediliyor ve bu ADR bunu değiştirmez.

## Karar

1. **Dönüşümü tarayıcı yapar, taşmayı biz yuvarlarız.** HDR karesi dışa aktarmada
   float16 bir 2D `OffscreenCanvas`'a çizilir (tarayıcının standart HDR→SDR
   dönüşümü: PQ/HLG çözme, bt2020→bt709, ton eğrisi). Tuval 1.0'ı aşan değerleri
   korur; `softClipToRgba8` (saf, `src/domain/hdr.ts`) en büyük kanalı 0.9'dan
   sonra 1.660491'de 1.0'a varan bir eğriyle yuvarlar, diğer kanalları aynı oranla
   ölçekler (ton ve doygunluk korunur). Diz altındaki pikseller tarayıcının
   verdiği değerle aynen kalır. Sonuç 8-bit tuvale `putImageData` ile yazılır,
   altyazı üstüne çizilir, H.264'e kodlanır. SDR kaynağın yolu değişmedi.
   Kendi shader'ımızla tam ton eşleme Chrome'da mümkün değil (donanım HEVC
   karesinin ham düzlemleri okunamıyor; ayrıntı ölçüm belgesinde).
2. **Çalışma anında kanıt, varsayım yok.** Kaynak PQ/HLG ise kapının C aşaması
   worker'da sentetik bir 10-bit kareyi (`buildProbeFrame`: siyah, 20/203/400/1000
   cd/m² nötr, bt709 ana renkler, 600 cd/m² kırmızılı turuncu) **aynı yoldan**
   (`VideoSample.draw` → float16 → yumuşak kırpma) çizer ve `judgeHdrProbe` ile
   yargılar: nötrler nötr, siyah siyah, orta ton ve beyaz makul, 400 < 1000 cd/m²
   (parlaklar kesilmemiş), ana renklerin tonu ±5° ve doygunluğu saf ana rengin en
   az %80'i, parlak turuncuda hiçbir kanal 254'e varmıyor. Geçmezse ya da float16
   tuval / float okuma yoksa (`api_missing`) çıktı `hdr_source_unsupported` ile
   reddedilir. Worker aynı kontrolü dışa aktarmanın başında bir kez daha yapar;
   kapıyı atlayan bir yol kodlayıcıya doğrulanmamış HDR götüremez.
3. **Kullanıcıya söylenir.** Uygunluk listesine "HDR → SDR dönüşümü bu tarayıcıda
   doğru (deneme karesiyle ölçüldü)" satırı eklenir. Hazır durumda: "Bu video HDR.
   İndirilen dosya SDR olacak; renkler telefondaki görüntüden biraz farklı
   görünebilir." (İngilizcesi de var.) Ret mesajı artık sebebi söyler: bu tarayıcı
   HDR'yi SDR'ye doğru çeviremedi (deneme karesiyle test edildi).
4. **Önizleme ayrı bir "güzel" sistem değil.** Önizleme `<video>` öğesidir, yani
   tarayıcının aynı dönüşümü; yalnızca taşma düzeltmesi yok. Ölçülen fark PQ'da
   ΔE00 ort. 0.72, HLG'de 0.48 (SSIM Y 0.995 / 0.998); fark yalnızca önizlemede
   kesilen parlak sıcak renklerde. HDR ekranda önizleme HDR görünür, dosya SDR'dir;
   dialog notu bunu söyler.
5. **Yeni bağımlılık yok.** Renk matematiği saf TypeScript, birim testli
   (`tests/unit/hdr.test.ts`, `tests/unit/hdrGate.test.ts`,
   `tests/unit/colorMetrics.test.ts`). Ölçüm için ffmpeg (zimg, libplacebo) yalnızca
   geliştirme makinesinde.

## Ölçüm ve eşikler

Eşikler tarayıcı çıktısı ölçülmeden önce ffmpeg ile kalibre edildi: 7 meşru ton
eşleme operatörünün birbirine uzaklığı ile 10 bilerek bozulmuş dönüşümün uzaklığı
arasına kondu; aday, en yakın meşru operatöre karşı ölçülür (ΔE00 ≤ 8, renk
kayması ≤ 4.5, doygunluk oranı 0.78–1.30, ton açısı ≤ 9°, kırpma farkı ≤ 0.045,
ortalama luma ≥ 20, kare SSIM Y ≥ 0.90). Tek bilinen kör nokta: yalnızca PQ
ColorChecker'da, yalnızca gamut dönüşümü atlanırsa eşiklerin içinde kalıyor; HLG
dosyası ve çalışma anı kontrolü onu yakalıyor.

Kare düzeyinde (Chrome 153, örnek karelerin en kötüsü):

| Dosya | Yol | En yakın operatör | ΔE00 | kayma | doygunluk | ton | kırpma Δ | Sonuç |
|---|---|---|---|---|---|---|---|---|
| PQ (R09) | 8-bit tuval (eski düz yol) | hable | 4.70 | 0.65 | 1.09 | 1.3° | **0.158** | **kaldı** |
| PQ (R09) | float16 + yumuşak kırpma (uygulama) | hable | 4.51 | 0.71 | 1.09 | 1.4° | −0.001 | geçti |
| HLG (R11) | 8-bit tuval | libplacebo spline | 5.07 | 1.15 | 1.05–1.10 | 3.9° | 0 | geçti |
| HLG (R11) | float16 + yumuşak kırpma (uygulama) | libplacebo spline | 5.06 | 1.15 | 1.05–1.10 | 3.9° | 0 | geçti |

Dışa aktarılan dosya düzeyi (gerçek kayıtlar ve sentetik matris satırları) ölçüm
belgesinde ve `docs/SUPPORT_MATRIX.md`'de.

Dışa aktarılan dosya (uygulama üzerinden, 720×1280, iki an):

| Tarayıcı | Kayıt | Önce | Sonra |
|---|---|---|---|
| Chrome | R09 PQ 4K | REFUSED (politika) | PASS — SSIM 0.935, ΔE00 5.32, ton 1.4°, kırpma 0.016 |
| Chrome | R11 HLG −90° VFR | REFUSED (politika) | PASS — SSIM 0.947, ΔE00 5.28, ton 8.44° (7 operatörle; 5 CPU operatörüyle 9.37° ile **kaldı**) |
| Edge, Chromium | R09, R11 | REFUSED (HEVC yok) | REFUSED (HEVC yok), değişmedi |
| Chromium / Chrome / Edge | sentetik M10-hdr (PQ), M10-hdr-hlg (HLG, 90°) | M10-hdr: ret beklenen | PASS, süre ve kare tam |

SDR gerçek kayıtlarında gerileme yok (Chrome 13→13, Edge 11→11, Chromium 10→10 PASS; bilinen
R15 Chromium FAIL aynı). R11'in export düzeyindeki referans seti ölçümden sonra 5'ten 7'ye
genişletildi (kalibrasyondaki set); bu açıkça ölçüm belgesinde ve kurucu sorularında.

## Sonuçlar

- HDR telefon videosu, HEVC'yi çözebilen ve kontrolü geçen tarayıcıda (bu makinede
  Chrome) SDR H.264 olarak dışa aktarılır. Edge ve Chromium'da bu makinede HEVC
  yok; 10-bit VP9 profil 2 HDR dosyaları (sentetik M10-hdr satırları) orada da
  çalışır (AV1 HDR denenmedi).
- Maliyet: HDR karesi başına float16 çizim + okuma ve yumuşak kırpma. Örnek
  ölçüm 960×540'ta kare başına 7–24 ms okuma + 4–27 ms kırpma (Chrome, spike
  sayfası). Uzun HDR çıktıda süre bu kadar uzar; ayrı bir süre ölçümü yapılmadı.
- Uygulama Dolby Vision RPU ve HDR10+ dinamik metadata'yı kendisi kullanmıyor;
  taban katman HLG/PQ olarak tarayıcının dönüşümüne gidiyor. Tarayıcının bunları
  kullanıp kullanmadığı ölçülmedi.

## Hâlâ sınanmayanlar

Safari ve Firefox'ta HDR (Firefox'ta AAC kodlayıcı zaten yok), HDR ekranlı
makinede önizleme, macOS/Linux, AV1 HDR, HEVC yazılım çözücüsü olan ortamlar,
çok parlak doygun içerikli gerçek HLG kaydı (tek HLG kaydımızda böyle alan azdı),
Chrome'un gelecekteki sürümlerinde dönüşümün değişmesi (çalışma anı kontrolü bunu
yakalamak için var).
