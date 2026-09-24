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
8. **Uygunluk dar tutuldu (doc 15'e dokunulmadı).** Hızlı kesim yalnızca kaynak zaten
   tam o indirmeyse çalışır:

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
   | Kareler 30 fps ızgarasında (ilk kareden itibaren, ±1 tik + %0,5 kare) | `fps` |
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

## Kurucu soruları

1. **Kare hızı (doc 15: "720p / 1080p, SDR, 30 fps").** Bugünkü kural yalnızca 30 fps
   ızgarasındaki kaynağı kopyalıyor. Eldeki **gerçek telefon kayıtlarının hiçbiri** buna
   uymuyor (iPhone 29,97 ve değişken, 24 fps, 60 fps), yani hızlı kesim bugün
   neredeyse yalnızca 30 fps ekran/kamera kayıtlarında çalışır. Teknik bu kayıtlarda da
   ölçüldü ve doğru. Öneri: **"en çok 30 fps"** okuması — 24/25/29,97 fps ve 30 fps'i
   aşmayan değişken hızlı kaynak kendi hızında kopyalansın (kareler ve süre aynı, yalnızca
   indirilen dosya 30 değil 29,97 fps olur; tam kodlama bugün bu kaynaklarda kare
   çoğaltıyor). 50/60 fps kaynak 30 fps'e kodlanmaya devam etsin. Karar kurucunun;
   değişirse tek satır (`frameRateMatchesPlan` → üst sınır kuralı) ve belge.
2. **Çözünürlük.** 4K kaynağın 1080p indirmesi ve 1080p60 kodlanmaya devam ediyor. 4K
   veya 60 fps'i olduğu gibi kopyalamak doc 15'in katmanını aşar (Pro/ücret konusu);
   önerilmiyor.
3. **Dosya boyutu.** Hızlı kesimin dosyası kaynağın bit hızındadır: sentetik kaynakta
   3 kat küçük, gerçek bir telefon kaydında (15–20 Mbit/s) tam kodlamadan (5,6 Mbit/s)
   2–3 kat büyük olabilir. Kabul edilebilir mi, yoksa belli bir bit hızının üstünde
   tam kodlama mı tercih edilsin?

## Ölçülmeyenler

Windows oynatıcı uygulamalarının ekranı (yalnızca aynı Media Foundation hattı), VLC,
macOS/iOS, Safari, Firefox, Android oynatıcıları; başka makineler; gerçek uzun telefon
kaydının hızlı kesimi (bugünkü kuralla uygun değil); 60 dk kesitte bütün karelerin kare
kare kimliği (dikiş pencereleri + sayım + zamanlar denetlendi).
