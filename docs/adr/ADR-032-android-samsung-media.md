# ADR-032 — Gerçek Android telefonda "süre uyuşmadı": AAC kodlayıcısının gecikmesi

> Tarih: 2026-10-01 · Durum: UYGULANDI. Politika (`2026-09-24.v6`, belge 15) ve şema
> (EDL v2, belge 10) **değişmedi**. [ADR-014](ADR-014-w5-real-media-decoding.md)'ün kare
> politikası, [ADR-027](ADR-027-fast-cut.md)'nin hızlı kesimi ve bir karelik süre toleransı
> (belge 22) aynen geçerli; hiçbir kontrol gevşetilmedi.

## Bağlam

Kurucunun telefonunda (Samsung Galaxy S23, SM-S911B, Android 16, Chrome 154.0.8037.57)
canlı site `web/scripts/android/phone-run.mjs` ile sürüldü (adb + CDP; ayrıntı betiğin
başında). İki Samsung kaydı masaüstünde (Chrome/Edge, gerçek kayıtlar 15/15) geçerken
telefonda ~1,5–2,5 sn'de "Çıktı alınamadı. Oluşan dosyanın süresi beklenen süreyle
uyuşmadı." ile reddediliyordu:

- R15 `web-samsung-s21-h264-60fps-rot90.mp4` (H.264 1920×1080 60 fps, −90°, 4,4 sn), kesit 0,5–4 sn;
- R14 `web-samsung-hevc-slowmo-sef-rot90.mp4` (HEVC 1080p ağır çekim SEF, −90°, 11,8 sn, 12 kHz ses), kesit 1–8 sn.

## Kanıt

Dışa aktarma profili (ADR-028 kancası `window.__clipExportProfile`) bu iş için genişletildi:
yalnızca ölçüm açıkken işçi, çözücünün verdiği kare damgalarını ve oluşan dosyanın her
izini paket paket günlüğe yazıyor (`describeProduced`, `recordTimes`; kullanıcıda hiç
çalışmaz). `phone-run.mjs --profile` bunları ve işçinin aşama olaylarını satıra ekliyor.

**Görüntü sağlam.** Telefonda R15 kesiti: çözücü 209 kare verdi, 0,499833 → 3,963711 sn,
adım 16,5–16,7 ms, geriye giden ya da tekrar eden damga yok; çıktı 105 kare, 0 → 3,5 sn
tam, eksik kare 0. R14: 210 kare, eksik 0. Hızlı kesim denenmedi (R15 "fps" — 60 fps >
30; R14 "codec" — HEVC), düşüş sebebi değil. Döndürme doğru.

**Sorun ses izinde.** Aynı kesit, telefonda ve masaüstü Chrome'da (aynı derleme):

| | Görüntü izi | Ses izi | Dosya süresi | Plan | Fark |
|---|---|---|---|---|---|
| Telefon (önce) | 105 paket, 0 → 3,5 sn | 166 paket, 0 → 3,541333 sn | 3,541333 sn | 3,5 sn | **+41,3 ms > 34,3 ms tolerans → ret** |
| Masaüstü Chrome | 105 paket, 0 → 3,5 sn | 165 paket, 0 → 3,520021 sn | 3,520021 sn | 3,5 sn | +20,0 ms |

WebCodecs `AudioEncoder`'ın kendisi ölçüldü (AAC-LC 48 kHz stereo 128 kbit/s, uygulamanın
ayarı; bilinen bir gürültü parçası konup tarayıcının kendi `AudioDecoder`'ıyla geri
çözüldü):

| n giriş karesi | Telefon: paket / işaretin kayması | Masaüstü Chrome: paket / kayma |
|---|---|---|
| 168 000 | 166 / **2048** | 165 / 0 |
| 336 000 | 330 / **2048** | 329 / 0 |
| 48 000 | 48 / **2048** | 47 / 0 |
| 49 152 | 49 / **2048** | 48 / 0 |
| 40 961 | 42 / **2048** | 41 / 0 |

Telefon `ceil((n + 1024) / 1024)` paket veriyor ve sesin önüne **2048 hazırlık karesi**
(priming) koyuyor, ilk paketin damgası yine 0; masaüstü `ceil(n / 1024)` paket, kayma 0.
Masaüstünde kodlanmış paketler telefonun çözücüsüyle çözülünce kayma 0 çıktı: çözücü
standart, gecikme **kodlayıcının**. WebCodecs'te bu gecikmeyi bildiren bir alan yok ve
mediabunny paketleri kodlayıcının damgalarıyla yazıyor; dosyada düzenleme listesi (edit
list) olmadığı için oynatıcı hazırlık karelerini de çalıyor.

**Sonuçları (ffmpeg ile, kaynağa karşı çapraz ilinti):**

- Telefonda "geçen" iPhone HLG kesiti (2–10 sn, gerçek ses) görüntüden **42,67 ms
  geride** ve son 1024 ses karesi eksik; masaüstü Chrome'da aynı kesit kayma 0, eksiksiz.
  Kodlayıcı her dışa aktarmada aynı olduğu için telefondaki her sesli çıktı böyleydi: 3 dk
  tam video (hızlı kesim ve tam kodlama) ve iki kesit de `ceil((n + 1024) / 1024)` paket
  taşıyor (8439 / 2814); o kaynağın sesi sürekli 440 Hz ton olduğundan kayması ilintiyle
  tek bir değere okunamıyor.
- Ses izi = `ceil((n + 1024) / 1024) × 1024` kare. `n mod 1024` 1…447 arasındaysa fazlalık
  1600 kareyi (30 fps'te bir çıktı karesi, 34,3 ms) aşıyor ve dosya reddediliyor: 30 fps'lik
  kesit uzunluklarının **%37,5'i** (3,5 sn ve 7 sn bunlardan). 8 sn, 60 sn, 180 sn
  tesadüfen tolerans içinde kaldı. Sorun Samsung kayıtlarına özgü değil; 60 fps, SEF,
  döndürme ya da 12 kHz ses değil, **kesitin uzunluğu** belirliyordu.

## Karar

Gecikme dışa aktarmanın yapıldığı tarayıcıda **ölçülür** ve **geri alınır**; ölçülemezse
dışa aktarma reddedilir.

1. **Ölçme** (`web/src/adapters/export/alignedAac.ts`, saf kurallar
   `web/src/domain/audioEncoderDelay.ts`): dışa aktarmanın ses ayarıyla (48 kHz, 2 kanal,
   plan bit hızı) 32 768 karelik bir sinyal kodlanıp tarayıcının kendi çözücüsüyle geri
   çözülür. Sinyalde iki işaret var (Hann pencereli 500 Hz → 8 kHz tarama, 2048 kare;
   ton olsaydı her periyotta eşleşirdi). İkisi de −1024…8192 kare aralığında aranır;
   **ikisinin de** normalize ilintisi ≥ 0,9 olmalı ve aynı kaymada (en çok 1 kare fark)
   bulunmalı. Değilse `audio_encoder_misaligned` ("Bu tarayıcının ses kodlayıcısı sesi
   görüntüyle hizalı yazamadı; sesi kayık bir dosya kaydedilmedi."), çıktı dosyası
   oluşmadan. Sonuç işçi başına önbellekte. Telefonda ölçülen: 2048 kare, ilinti 0,99991;
   masaüstü Chrome: 0.
2. **Geri alma**: AAC kodlayıcısı artık mediabunny'nin `AudioSampleSource`'u yerine bizde
   çalışıyor (mediabunny'nin kurduğu ayarın aynısı: `mp4a.40.2`, ham AAC), paketler
   `EncodedAudioPacketSource`'a veriliyor. Her paket ölçülen gecikme kadar geri alınır; ilk
   hazırlık paketleri negatif zamana düşer ve mediabunny'nin MP4 yazıcısı bunları gizleyen
   düzenleme listesini yazar (`elst` media_time = 2048). Çözücü bu paketlerle ısınır,
   oynatıcı onları çalmaz.
3. **Sonu tamamlama**: son gerçek kareden sonra `gecikme + 2048` kare sessizlik verilip
   kodlayıcı boşaltılır (telefonun kodlayıcısı son kareleri tutuyordu); kaydırıldıktan sonra
   başı kesitin sonunda ya da sonrasında olan paketler atılır. Kalan paketler kesitin
   sonuna kadar gelmiyorsa (`AacPacketAligner.complete`) dosya reddedilir
   (`audio_encoder_misaligned`), iki yolda da (tam kodlama ve hızlı kesim).
4. Ses izi sonuçta en çok bir AAC paketi (1023 kare, 21,3 ms) uzun olabilir, masaüstünde
   de hep böyleydi; süre toleransı (bir çıktı karesi) **değişmedi**.
5. WebKit'in bozuk AAC açıklaması için mediabunny'nin yaptığı düzeltme bizim kodlayıcıda
   da var (`aacDescriptionInvalid`, `aacLcAudioSpecificConfig`).

Gecikmenin 0 olduğu masaüstünde paketler mediabunny'nin koyduğu yerde; tek fark kodlayıcının
sonu artık sessizlikle boşaltılıp fazlası atılıyor (önce kodlayıcı son paketi kendisi
dolduruyordu). Masaüstü çıktılarının süreleri aynı (ör. 3,5 sn kesit 3,520 sn).

### Neden bu yol

- **Tolerans gevşetmek** yanlış dosyayı kabul ederdi: ses yine 42,7 ms geride kalırdı.
- **Cihaza göre sabit 2048** (Android'de şu kadar kaydır) başka telefonların, başka
  kodlayıcıların (Apple AAC 2112 kare) ve Chrome'un ileride değişmesinin önünde kör kalırdı.
  Ölçüm her tarayıcıda gerçeği okur; masaüstünde 0 ölçüp hiçbir şeyi değiştirmez.
- **Hazırlık paketlerini atmak** (düzenleme listesi yerine) ilk paketi örtüşmesiz çözdürür,
  sesin ilk 21 ms'si bozulur.

### Maliyet

Ölçme masaüstü Chrome'da 79–143 ms (9 dışa aktarma); telefonda ayrı ölçülmedi, R15 kesitinin
toplam süresi 1,35 → 1,55 sn (tek koşu, önce/sonra). İşçi başına bir kez; her dışa aktarma
yeni işçi açtığı için dışa aktarma başına bir kez. Sessiz dolgu en çok `gecikme + 2048` kare.

## Telefonda sonuç

Galaxy S23 (SM-S911B), Android 16, Chrome 154.0.8037.57; 30 Eylül 2026. "Önce": canlı site
(düzeltmesiz derleme). "Sonra": bu dalın derlemesi, `next start` + `adb reverse`
(`phone-run.mjs --url=http://localhost:<port>/editor`). Kalite 1080p. Ses kayması ffmpeg ile,
kaynağın aynı anına karşı (+ = ses geç).

| # | Kaynak, kesit | Önce | Sonra |
|---|---|---|---|
| A | add1.mp4 (1080×1920 30 fps H.264), 2–10 sn | ✅ tam kodlama (aralıkta anahtar kare yok), 8,021 sn, 240 kare; kaynak sessiz | {{A_AFTER}} |
| B | R15 Samsung S21 H.264 60 fps −90°, 0,5–4 sn | ❌ "süre uyuşmadı" (1,5 sn) — ses izi 3,541 sn, görüntü 3,5 sn | ✅ 3,520 sn, 105 kare, eksik 0, ses kayması **0 ms** (2,0 sn) |
| C | R14 Samsung HEVC ağır çekim SEF −90°, 1–8 sn | ❌ "süre uyuşmadı" (2,0 sn) | ✅ 7,019 sn, 210 kare, eksik 0, ses kayması **0 ms** (2,5 sn) |
| D | R11 iPhone 12 Pro HEVC HLG −90°, 2–10 sn | ✅ 8,021 sn, 240 kare, ses **+42,67 ms**, son 1024 kare eksik | {{D_AFTER}} |
| E–G | 3 dk 1080×1920 (tam video hızlı kesim / zorla tam kodlama / iki kesit) | ✅ (ana oturumun koşusu) 180,032 / 180,032 / 60,032 sn; ses paketleri `ceil((n+1024)/1024)` | {{EFG_AFTER}} |
| H–M | R15 ve R14, başka aralıklar (tüm dosya, kısa, iki kesit) | çalıştırılmadı (telefon arka planda kaldı) | {{HM_AFTER}} |

Masaüstü Chrome'da (aynı derleme, `phone-run.mjs --desktop=chrome`) B, C, D ve H–M hepsi ✅,
ölçülen gecikme 0, ses kayması 0 ms (tüm dosyada +1,9–2 ms: kaynağın sesi görüntüden 2 ms
sonra başlıyor, çıktı bunu koruyor).

## Test edilen

- Birim: `tests/unit/audioEncoderDelay.test.ts` (22 test): işaretin bulunması, 0/64/1024/2048/2112/−64
  karelik gecikmeler, sessizlik/gürültü/aralık dışı/kayan gecikmede ret, Android ve masaüstü
  paket zamanlaması (telefonda ölçülen 170 paket → 167 tutulan, 3 atılan), 1–300 karelik her
  uzunlukta toleransın içinde kalma ve düzeltmesiz hâlin 3,5 sn / 7 sn'de reddi, AAC
  açıklaması, `audioEndFrame`. Tümü: vitest 548/548 (main birleşiminden sonra).
- Masaüstü (main birleşiminden önce ve sonra ayrı ayrı): matris Chromium 22/22, Chrome 22/22,
  Edge 22/22 — 66 durumun hepsinde süre ve kare sayısı önceki koşuyla aynı; gerçek kayıtlar
  Chrome 15/15. e2e: birleşimden sonra 170 geçti, 2 atlandı; birleşimden önceki koşuda
  154 geçti, 1 kaldı (`kesit.spec.ts:1024` telefon çubuğu odak testi, ses koduyla ilgisiz;
  tek başına 4/4 geçti, sonraki tam koşuda da geçti — kararsız test), 2 atlandı.
- `tsc --noEmit`, `eslint .`, `npm run build` temiz.

## Ölçülmeyenler

- **Samsung Internet** (v30.0.0.67): telefonda çalışmıyordu, DevTools soketi
  (`/proc/net/unix`'te tarayıcı olarak yalnızca Chrome'un `chrome_devtools_remote` soketi vardı)
  açık değildi. Soketi açmak Samsung Internet'in ayarlarında "USB ile web sayfası hata
  ayıklama"yı açmayı gerektirir; kurucunun telefonunda ayar değiştirilmedi. Samsung
  Internet Chromium tabanlı, aynı `AudioEncoder`'ı kullanması beklenir; ölçüm her
  tarayıcıda çalıştığı için düzeltme onda da gecikmeyi okur, ama **ölçülmedi**.
- Başka Android telefonlar ve başka AAC kodlayıcıları (Qualcomm/Exynos farkı, Android
  sürümleri), iOS Safari, macOS Safari/Chrome (AudioToolbox kodlayıcısı).
- Telefonda HDR ekran, telefonun kendi kaydetme penceresi (betik OPFS'e yazan bir
  yer tutucu kullanıyor, ADR-026), uzun (> 3 dk) kaynaklar, termal davranış.
- Telefonda sessiz kaynaklarda (add1.mp4) ses kayması ölçülemez; yalnızca süre ve paket
  sayısı karşılaştırıldı.
