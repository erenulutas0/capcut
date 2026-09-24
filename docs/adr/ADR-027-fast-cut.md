# ADR-027 — Hızlı kesim: kaynağın sıkıştırılmış kareleri kopyalanır, yalnızca kesim noktaları kodlanır

> Tarih: 2026-09-24 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine: Windows 11, RTX 3070 Ti;
> Chrome 153, Edge 153, Playwright Chromium 153). Ölçüm belgesi:
> [`docs/spikes/2026-09-23-fast-cut.md`](../spikes/2026-09-23-fast-cut.md).

## Bağlam

Her indirme her kareyi yeniden kodluyordu (çöz → tuval → H.264). 60 dakikalık 1080p
çıktı Chrome'da ~7,5 dakika (×7,9 gerçek zaman), Chromium'da ~17 dakika (ADR-020).
Kurucunun ana kullanımı uzun videodan aralık ("kesit") alıp indirmek; çoğu zaman kırpma,
altyazı ya da müzik yok.

Kurucu kararı (23 Eylül 2026): **kare hassas.** Kesit tam işaretlenen karede başlayıp
bitmeli. Mümkünse yalnızca kesim noktalarının çevresi yeniden kodlanır ("smart cut"),
gerisi olduğu gibi kopyalanır; mümkün değilse bugünkü tam kodlama çalışır ve arayüz
hangisinin olduğunu söyler.

## Karar

1. **Smart cut seçildi; edit list yolu reddedildi.** Kopya her aralıkta ilk temiz
   **IDR**'dan başlar; kesimden o IDR'a kadarki kareler ve (B-kareli kaynakta) sondaki
   en fazla bir B grubu yeniden kodlanır. Edit list'le gizleme Chrome, Edge ve ffmpeg'de
   doğru göründü ama **Windows Media Foundation (Media Player / Filmler ve TV'nin çözme
   hattı) edit list'i yok sayıp kesimden önceki 33 kareyi gösterdi**: kullanıcı için kare
   hassas değil, yedek olarak da kullanılmıyor.
2. **İki parametre seti, paket içinde.** mediabunny 1.58.1 tek örnek açıklaması yazar ve
   WebCodecs kodlayıcısı kaynağın SPS/PPS'ini kullanamaz (Chrome/Edge: High CABAC 1 ref;
   Chromium/OpenH264: CAVLC). Bu yüzden her yeniden kodlanmış koşunun IDR'ının önüne
   kodlayıcının SPS/PPS'i, her kopyanın ilk IDR'ının önüne kaynağın SPS/PPS'i konur;
   geçişler yalnızca IDR'da. Örnek girdisi `avc1` (kaynağın `avcC`'si). Üç tarayıcının
   `<video>`'su, WebCodecs, ffmpeg ve Media Foundation hepsini doğru çözdü; `avc3` da
   denendi, aynı sonuç, kullanılmadı.
3. **Dikiş kareleri** kaynaktan çözülen kare olarak doğrudan `VideoEncoder`'a verilir
   (tuval ve renk dönüşümü yok), kaynağın kodlanmış boyutunda, sabit nicemleyici (QP 18)
   ya da kaynağın bit hızının 2 katı. Ölçülen dikiş SSIM'i uzun kaynakta 0,9987–0,999,
   gerçek kayıtlarda 0,86–0,996 (eşik 0,85).
4. **Açık GOP ve kurtarma noktaları kabul edilmez:** kopya yalnızca NAL tipi 5 (IDR)
   taşıyan ve zaman damgalarına göre "temiz" olan (öncesinde çözülen hiçbir kare
   sonrasında gösterilmiyor, sonrasında çözülen hiçbir kare ilk resminden önce
   gösterilmiyor) bir paketten başlar. Başlangıçtan önce gösterilen B-kareleri olan IDR
   (GoPro deseni) doğru ele alınır.
5. **Ses her zaman yeniden kodlanır** (AAC, tam kodlamanın ses yolunun aynısı,
   `segmentAudio.ts`): tam kesim, kazanç, müzik ve geçişler aynen çalışır. Ölçülen: 60 dk
   kesitin tamamı ~28 s; ses kopyalamanın getireceği birkaç saniye, 21 ms'lik AAC
   çerçevesine bağlı kesimi ve müzik/kazanç desteğini kaybetmeye değmez.
6. **Döndürme** kaynağın `tkhd` matrisiyle taşınır (pikseller döndürülmez). Chrome, Edge,
   ffmpeg ve Media Foundation matrisi uyguladı.
7. **Başarıdan önce kendi denetimi:** üretilen dosya yeniden açılır; paket sayısı
   beklenenle aynı olmalı; her kopya başlangıcı ve her kuyruk bu tarayıcının kendi
   çözücüsüyle yeniden çözülür, beklenen her kare gelmeli ve kopyanın ilk karesinin
   pikselleri kaynağınkiyle birebir aynı olmalı. Süre denetimi tam kodlamanınkiyle aynı.
   Tutmazsa geçici dosya silinir, **tam kodlama çalışır** ve sonuç sebebi söyler
   (`seam_check`). İptal, disk dolması, bellek ve politika retleri tam kodlamayı
   denemeden aynı hatayla biter.
8. **Uygunluk (politika `2026-09-24.v6`, kurucu kararı 24 Eylül 2026).** Hızlı kesim
   yalnızca kaynak zaten 720p/1080p katmanındaki o indirmeyse çalışır. "Katmanın içinde"
   tam olarak şu demek: kaynağın görüntülenen boyutu (döndürmeden sonra) editörün
   sunduğu indirme boyutlarından biri ve seçilen boyutla aynı — 1280×720, 720×1280,
   720×720, 1920×1080, 1080×1920, 1080×1080. 1440p, 4K, 480p ve tek sayılı/tuhaf boyutlar
   (1920×1088, 592×1280 gibi) seçilen boyuta kodlanır; 4K ve 1080p60 bilerek hızlı
   kesime girmez (kurucu: hayır).

   | Kural | Uymazsa (`fallbackReason`) |
   |---|---|
   | İstek `mode: 'auto'` (varsayılan) | `requested_encode` |
   | Altyazı görüntüye işlenmiyor | `captions` |
   | SDR (PQ/HLG değil) | `hdr` |
   | H.264 (`avc1`/`avc3`), MP4/MOV | `codec` |
   | Kırpma/yakınlaştırma yok | `crop` |
   | Çerçeve biçimi kaynağınki | `aspect` |
   | Çözünürlük kaynağınki (720p kaynak → 720p, 1080p → 1080p) | `resolution` |
   | Kare pikseller | `pixel_aspect` |
   | 8-bit 4:2:0 progresif, 4 baytlık NAL uzunluğu | `bitstream` |
   | Sınırlı renk aralığı, bt709/bt601 renkleri | `color` |
   | ADR-014 §3 yeniden sıralama düzeltmesi gerekmiyor | `reorder` |
   | Kaynak en çok 30 fps (aşağıdaki ölçü) | `fps` |
   | Aralıklardan en az birinde IDR var | `no_keyframe` |
   | Zaman damgaları tutarlı | `timing` |
   | Tarayıcı kaynak boyutunda H.264 kodlayabiliyor (dikiş) | `encoder` |
   | Kendi denetimi geçti | `seam_check` |

   Birleştirilmiş indirmelerde (aynı kaynaktan sıralı aralıklar) her birleşme bir kesim
   noktasıdır; her aralık ayrı planlanır.
9. **Sözleşme:** `WorkerRequest.export.mode?: 'auto' | 'encode'` (varsayılan `auto`);
   `ExportResult.method: 'copy' | 'smart' | 'encode'`, `fallbackReason`,
   `framesCopied`, `framesEncoded`. Çıkış katmanı (`prepareOutput` / OPFS / bellek)
   değişmedi; hızlı kesim aynı sink'e yazar. Depolama tahmini hızlı kesimde kaynağın
   kopyalanan baytlarından (+ dikiş karesi başına 3 × ortalama kare) hesaplanır.
   Test kancası `window.__clipExportMode = 'encode'` (uygulama ayarlamaz).
10. **Arayüz (küçük):** sonuç listesine bir satır: "Yöntem: Hızlı kesim — görüntü yeniden
    kodlanmadı" (+ "yalnızca kesim noktalarındaki N kare kodlandı") ya da "Kodlandı
    (sebep)". `data-method`, `data-fallback`, `data-frames-encoded` öznitelikleri test
    içindir.

## Ölçüm (özet; ayrıntı ölçüm belgesinde)

60 dakikalık 1080p kesit (iki aralık, 75 dk sentetik kaynak, kalıcı profil, OPFS):

| Tarayıcı | Tam kodlama | Hızlı kesim | Hızlanma | Tepe bellek (tam → hızlı) | Dosya (tam → hızlı) |
|---|---|---|---|---|---|
| Chrome | 437,8 s | 28,1 s | ×15,6 | 922 → 941 MiB | 2445 → 831 MiB |
| Edge | 373,1 s | 28,6 s | ×13,0 | 916 → 948 MiB | 2445 → 831 MiB |
| Chromium (Playwright, headless shell) | 804,7 s | 33,7 s | ×23,9 | 778 → 852 MiB | 6301 → 830 MiB |

- 18/18 koşuda kare sayısı birebir, süre ±1 kare, her aralığın ilk 90 ve son 30 karesi
  doğru kaynak karesi, ses 0,06 ms içinde hizalı; hızlı kesimde bu karelerden
  kopyalananlar bit bit aynı.
- Sentetik kaynaklar (B-kareli, B-karesiz, 4 B piramit 8 s GOP, paket içi SPS, 90°
  döndürme, 25 fps, açık GOP) ve 11 gerçek H.264 kayıt üç tarayıcıda: kopyalanan
  kareler bit bit aynı, kare numaraları, zamanlar ve `<video>` oynatması doğru.
- Destek matrisi üç tarayıcıda 22/22 (yeni M19 satırı `smart`; 30 fps matris kaynaklarının
  tam saniyelik kesimleri artık `copy`). Matris sürücüsü artık görüntülenen boyutu
  denetliyor (döndürme matrisle taşındığı için kodlu boyut 1280×720 kalabiliyor).
  Gerçek kayıt koşucusu Chrome'da 15/15.

## Kurucu kararları (24 Eylül 2026) — politika `2026-09-24.v6`

1. **Kare hızı: "en çok 30 fps".** 24, 25, 29,97, 30 fps ve 30 fps'i aşmayan değişken
   hızlı telefon kaydı kendi hızında kopyalanır; 50/60 fps kaynak 30 fps'e kodlanır.
   Doc 15'in kalite satırı "720p / 1080p, SDR, en çok 30 fps" oldu (değişiklik notu v6).
2. **Çözünürlük: hayır.** 4K ve 1080p60 tam kodlamada kalır; hızlı kesim yalnızca
   yukarıda tanımlanan 720p/1080p boyutlarında.
3. **Dosya boyutu: kabul.** Kopya kaynağın bit hızını korur, üst sınır yok. Sonuç satırı
   bunu söyler: "Hızlı kesim — görüntü yeniden kodlanmadı, orijinal kalite".

### Değişken hızlı kaynakta "en çok 30 fps" nasıl ölçülüyor

Gerçek kayıtlarda paket zamanları ölçüldü (`scripts/fast-cut-spike/frame-rate-stats.mjs`):

| Kayıt | Ortalama | Medyan | En kısa aralık (hız olarak) | 1 s'lik pencerede en çok kare |
|---|---|---|---|---|
| R03 720×1280 (nominal 30) | 30,004 | 30,00 | 31,6 | 31 |
| R04 480×724 (nominal 30, VFR) | 29,934 | 30,02 | 30,3 | 31 |
| R05 1080×1920 30 | 30,000 | 30,00 | 30,0 | 30 |
| R06 iPhone 4 (VFR) | 24,335 | 24,00 | 30,0 | 30 |
| R10 iPhone 11 (29,97 VFR) | 29,974 | 30,00 | 30,0 | 30 |
| R13/R14 HEVC (nominal 30) | 29,83/30,02 | 30,00 | 31,1/30,1 | 31 |
| R02 592×1280 (VFR) | 40,600 | 60,00 | 200 | **47** |
| R07/R12/R15 (59,94/60) | 59,9–60,0 | 60 | 60–60,5 | **60–61** |

- **En kısa aralık (anlık en yüksek hız) kullanılamaz:** nominal 30 fps dosyaların tek tük
  aralıkları 1/31,6 s'ye iniyor (zaman damgası titremesi); bu ölçü onların hepsini reddederdi.
- **Yalnızca ortalama da yetmez:** 60 fps'lik birkaç saniye, yavaş bir bölümle ortalamada
  30'un altına düşebilir.
- **Kural (`frameRateWithinPlan`):** kopyalanacak anın karelerinde, bir saniyeye kadar her
  aralıkta kare aralığı sayısı `30 × süre + 1`'i aşmaz (30 fps'nin üstünde en çok **bir**
  kare titremesi) ve anın ortalama hızı 30,3 fps'yi aşmaz. Nominal 30 fps dosyalar bir
  saniyede en çok 31 kare gösterdi, daha hızlı her kaynak 47–61: aradaki boşluk geniş.
  Birim testleri: R03/R04 benzeri titreme kabul, 60/59,94/50/32 fps ret, "3 s 60 fps +
  7 s 12 fps" (ortalama 23) ret, 30,5 fps sabit ret (ortalama), aynı zaman damgası `timing`.
- Kopyalanan anın son karesi, tam kodlamanın kuralıyla seçilir: 30 fps ızgarasının son
  anında ekranda olan kaynak karesi (ör. 29,97 fps'de 10 s'lik an 299 kare, son kare
  10,000 s'ye kadar tutulur). Tam kodlama aynı anı 300 kareyle, bir kareyi çoğaltarak verir.

## Ölçülmeyenler

Windows oynatıcı uygulamalarının ekranı (yalnızca aynı Media Foundation hattı), VLC,
macOS/iOS, Safari, Firefox, Android oynatıcıları; başka makineler; gerçek uzun telefon
kaydının hızlı kesimi (bugünkü kuralla uygun değil); 60 dk kesitte bütün karelerin kare
kare kimliği (dikiş pencereleri + sayım + zamanlar denetlendi).
