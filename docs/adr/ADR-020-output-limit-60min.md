# ADR-020 — Web çıktı sınırı 60 dakika (politika `2026-09-22.v3`)

> Tarih: 2026-09-22 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine, Chromium ve Chrome; Edge ölçülmedi).

## Bağlam

Kurucu canlı betayı denerken 5 dakikalık **çıktı** sınırına takıldı ve web çıktı
sınırı olarak **60 dakikayı** seçti (girdi sınırıyla aynı; politika v2'de 60 dk /
2 GiB girdi seçilmişti).

Elimizdeki kanıt ADR-013'ten: çıktı tarayıcının özel diskine (OPFS) akıtıldığında
bellek çıktı uzunluğundan bağımsızdı (5 dk 1080p: tepe ~600 MiB); OPFS eşzamanlı
erişimi olmayan **bellek yolunda** ise bellek çıktıyla birlikte büyüyor (5 dk
1080p: ~1 GiB, çıktı boyutunun ~2,2 katı). 60 dakika bellek yolunda ~5–6 GiB
demek; bunu hiçbir tarayıcıda denemedik ve denemeyi önermiyoruz.

## Karar

1. **Yola bağlı sınır.** `WEB_LOCAL_POLICY.maxOutputDurationUs` = 60 dk;
   ayrı ve açık bir `maxMemoryRouteOutputDurationUs` = 5 dk. Doc 15 satırı:
   "60 dakika çıktı (diske yazamayan tarayıcıda 5 dakika) / 60 dakika video
   girdi / 2 GiB toplam". `policy.test.ts` üç sayıyı da belgeden okur.
2. **Kodlamadan önce ret.** Worker çıktı yolunu seçtikten hemen sonra, ilk kare
   kodlanmadan politikayı uygular (`outputRouteRefusal`, saf fonksiyon):
   - OPFS yolu: sınır yok (60 dk plan sınırı zaten tarifte).
   - Bellek yolu ve çıktı ≤ 5 dk: eskisi gibi çalışır, sonuçta "Yazıldığı yer:
     bellek" görünür.
   - OPFS erişimi yok ve çıktı > 5 dk: `output_too_long_for_memory` — "Bu
     tarayıcı videoyu diske yazamıyor; burada en fazla 5 dakikalık video
     indirilebilir. …"
   - OPFS var ama depolama tahmini dosyaya yetmiyor ve çıktı > 5 dk:
     `output_storage_insufficient` — "Bu uzunlukta bir video için tarayıcının
     kullanabileceği boş disk alanı yetmiyor. …" (Kısa çıktı eskisi gibi
     belleğe düşer.)
3. **Depolama kontrolü zaten vardı, şimdi söyleniyor.** ADR-013'ten beri OPFS
   yolu `navigator.storage.estimate()` boş alanının tahmini dosya boyutunun
   (bitrate × süre × 1,25) **iki katı** olmasını istiyordu; yetmezse sessizce
   bellek yoluna düşüyordu. 60 dakikada bu sessiz düşüş ~5 GiB belleğe yol
   açardı; artık uzun çıktı baştan reddediliyor. Kodlama ortasında dolan disk
   için `output_storage_full` yolu değişmedi.
4. **Sabit "5 dakika"ya bağlı her şey politikayı izler:** içe aktarma kuralı
   (60 dakikaya kadar video tek parça gelir), mesajlar (60), yardım penceresine
   yeni satır, doğrulama fixture'ı (65 dk çıktı, yeni sınırı aşar), testler.
   20 parça sınırı değişmedi.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Bellek yolundaki
tarayıcılar için sınır aynı.

## Ölçüm

Yöntem ADR-013 ile aynı: `scripts/measure-export-memory.mjs`, kalıcı profil
(`--persistent`, OPFS diskte), tarayıcı süreç ağacının private bytes değeri
işletim sisteminden ~400 ms aralıkla (`scripts/lib/process-memory.ps1`).
Yeni `--whole` seçeneği içe aktarmada gelen tek parçayı olduğu gibi dışa aktarır.

Kaynak: ffmpeg ile üretilmiş sentetik dosya, git dışında
(`web/tests/media/long/long-60min-480p.mp4`): 854×480, 30 fps, hareketli test
deseni + zamansal gürültü (`testsrc2 … noise=alls=12:allf=t+u`), 440 Hz AAC ton;
**3600,000 sn, 108000 kare, 448 MiB**. Çıktı: tüm parça, 1080p (16:9 →
1920×1080), H.264 + AAC. Makine: Windows 11, 12 mantıksal çekirdek.

| Tarayıcı | Çıktı | Taban | Tepe | Artış | Kodlama boyunca (onda birlik dilimlerin tepeleri) | Süre | Gerçek zaman katsayısı | Dosya | ffprobe | Geçici dosya |
|---|---|---|---|---|---|---|---|---|---|---|
| Chromium (Playwright) | 60 dk 1080p | 218 MiB | **664 MiB** | +446 MiB | 577, 476, 498, 496, 487, 494, 486, 506, 493, 664 | 1038,7 s (17 dk 19 s) | ×3,47 | 2447,1 MiB (5,57 Mbit/s video) | 3600,000 sn, 108000 kare | sunulurken 1, pencere kapanınca **0** |
| Chrome (kararlı kanal) | 60 dk 1080p | 489 MiB | **774 MiB** | +285 MiB | 733, 720, 731, 731, 730, 733, 735, 736, 735, 774 | 455,9 s (7 dk 36 s) | ×7,90 | 2430,7 MiB (5,53 Mbit/s video) | 3600,000 sn, 108000 kare | sunulurken 1, pencere kapanınca **0** |
| Chrome (kararlı kanal) | 60 dk 720p | 553 MiB | 746 MiB | +193 MiB | 687, 666, 689, 684, 686, 674, 693, 695, 688, 746 | 240,7 s (4 dk 1 s) | ×14,96 | 1148,5 MiB (2,55 Mbit/s video) | 3600,000 sn, 108000 kare | **0** |

- Chrome, Playwright'ın Chromium'undan iki kat hızlı (muhtemelen donanım
  kodlayıcısı; hangisinin kullanıldığı ölçülmedi). Taban daha yüksek (Chrome'un
  kendi süreçleri), artış daha düşük; kodlama boyunca yine düz.
- **Bellek düz.** Kodlamanın ikinci diliminden son dilimine kadar tepe
  Chromium'da 476–506 MiB, Chrome'da 720–736 MiB aralığında kaldı; ADR-013'ün 5 dakikalık OPFS değerleriyle
  (574–607 MiB) aynı düzeyde. 60 dakikalık çıktı belleği büyütmüyor.
- Son dilimdeki 664 MiB tepe kapanış, yeniden açıp ölçme (probe) ve dosyanın
  sayfaya verildiği ana ait; kısa ve geçici. İlk dilimdeki 577 MiB çözücü ve
  kodlayıcının açılışı.
- Süre birebir: 3600,000 sn, 108000 kare; hiç kare eksik değil.
- Depolama tahmini ölçüm öncesi kota ~10 GiB, kullanım ~1 KB gösterdi;
  gereken (tahmini dosyanın iki katı) ~6,0 GiB idi (tahmini dosya ~3,0 GiB; gerçek 2,4 GiB), OPFS yolu seçildi.
  (ADR-023: bu 10 GiB, Chrome'un her durumda bildirdiği sabit "kullanım + 10 GiB"
  değeridir, gerçek disk değil. Gereksinim artık 2,67 GiB ve yer baştan ayrılıyor.)
- İndirme (`Bilgisayara kaydet`) 2,4 GiB dosyayı diske kopyaladı; pencere
  kapanınca OPFS'teki geçici dosya silindi (kalan 0).

Kanıt dosyaları git dışında: `web/matrix-results/export-memory-1080-whole60-*.json`.
Çıktı dosyası ölçüldükten sonra silindi (`--delete-output`).

### Depolama yetmezliği ve bellek yolu testleri

- `tests/unit/policy.test.ts`: `outputRouteRefusal` sınır değerleri (5 dk tam
  geçer, +1 µs reddedilir; iki neden ayrı).
- `tests/e2e/output-limits.spec.ts`: bellek yolu zorlanınca 5:10 çıktı hiç kare
  kodlanmadan doğru mesajla reddediliyor ve OPFS'te dosya kalmıyor; 3 sn çıktı
  bellek yolundan iniyor ("bellek"); depolama tahmini 40 MB gösterilince 5:10
  çıktı reddediliyor, 3 sn çıktı yine iniyor.
- Test kancaları `window.__clipForceMemoryRoute` ve `window.__clipStorageFreeBytes`
  (mevcut `__clipSilenceEnvelopes` deseni). Uygulama bunları hiç ayarlamaz.
  Chromium'un CDP kota geçersiz kılması (`Storage.overrideQuotaForOrigin`)
  Playwright tarayıcısında `navigator.storage.estimate()`'e yansımadı; bu
  yüzden gerçek kota küçültülemedi, tahmin kancayla verildi. (ADR-023: kota
  tahmine yansımıyor ama yazma ve yer ayırmada uygulanıyor; gerçek kotayla
  e2e testleri eklendi.)

## Kullanıcı için değişenler (aynı değişiklik)

- Üstteki düğme **"Videoyu indir"**; pencere başlığı "Videoyu indir"; son eylem
  **"Bilgisayara kaydet"**. Tek başına "Kaydet" kullanılmadı: otomatik kayıt
  rozeti "Kaydedildi" ile karışırdı.
- Zaman çizgisinin altında: "İndirilen video, zaman çizgisindeki parçalardan
  oluşur."
- Boş zaman çizgisine açılan video çerçeveyi yönüne göre seçer: dikey → 9:16,
  yatay → 16:9, kareye yakın (%5 içinde) → 1:1 (`aspectForVideo`, saf
  fonksiyon). İçe aktarma adımının parçasıdır: ilk Ctrl+Z otomatik parçayı,
  ikincisi içe aktarmayı çerçeveyle birlikte geri alır. İçe aktarma bildirimi
  söyler: "Dikey video: çerçeve 9:16 seçildi. …". Kayıtlı projeyi geri yüklemek
  ve aynı dosyayı yeniden bağlamak çerçeveye dokunmaz (e2e ile doğrulandı).
- Yardım penceresinde sınırlar: "Açılan video en fazla 60 dakika ve 2 GiB.
  İndirilen video en fazla 60 dakika; tarayıcı videoyu diske yazamıyorsa en
  fazla 5 dakika."

## Bilerek değiştirilen testler

- `tests/unit/policy.test.ts`: satır regex'i yeni metne göre (üç sayı + bellek
  yolu sayısı; ayrıştırılamayan sayı artık NaN olarak geçmez, test kırılır);
  v3 değişiklik notunun varlığı; mesajların politika sayılarını taşıması.
- `tests/unit/timelineEdit.test.ts`: 5 dk sabiti yerine politika değeri;
  "çok uzun" dalı 5 dakikalık ayrı bir test politikasıyla korunuyor; 5:10 ve
  60 dk videonun tek parça gelmesi; `aspectForVideo`.
- `tests/e2e/timeline.spec.ts`: "5 dakikadan uzun video seçim sorar" testi
  "5:10 video tek parça gelir" oldu (v3'te seçim ekranına tarayıcıdan
  ulaşılamaz).
- `tests/e2e/a11y.spec.ts`: aynı nedenle "too-long" ekranının axe denetimi
  kaldırıldı, yerine uzun videonun tek parça hâli denetleniyor; sekme sırası
  etiketi "Videoyu indir". 320 px'te daha uzun düğme metni yatay kaydırma
  yaptı (20 px); 360 px altında düğmenin simgesi gizleniyor, metin kalıyor.
- `fixtures/edl/invalid/output-duration-exceeds-policy.json`: 400 sn → 65 dk
  (40 dk kaynak, iki parça), yeni sınırı aşan tek kural.

## Ölçülmeyenler

- **Başka makineler.** Tek Windows masaüstü; düşük RAM'li (4–8 GB) dizüstüler,
  yavaş diskler, pil tasarrufu modunda kodlama süresi ölçülmedi. Burada 8–17
  dakika süren bir kodlamanın ince bir dizüstünde ne kadar sürdüğünü bilmiyoruz.
- **Safari ve Firefox.** Firefox'ta çıktı zaten kapalı (AAC encode yok).
  Safari'nin OPFS eşzamanlı erişimi ve kotası denenmedi.
- **Gizli pencere.** ADR-013'e göre orada OPFS RAM'de tutulur; yol "opfs"
  görünür ama bellek kazancı yoktur. 60 dakikalık çıktı gizli pencerede
  denenmedi ve belleği büyütmesi beklenir.
- **Gerçek uzun kayıtlar.** Kaynak sentetik ve 480p; 60 dakikalık gerçek
  1080p/4K telefon kaydı (daha pahalı çözme), altyazı veya müzik ekli 60 dakika
  denenmedi.
- **Düşük disk.** Depolama tahmininin gerçekten az olduğu bir makinede davranış
  yalnızca test kancasıyla sınandı (ADR-023'te gerçek tarayıcı kotasıyla sınandı ve
  pay ölçümle küçültüldü). Tahminin iki kat payı, 60 dakika 1080p
  için ~6 GiB boş alan istiyor; daha az boş alanı olan kullanıcı 5 dakikadan
  uzun video indiremez (mesajla söylenir). Payın küçültülmesi ayrı karar.
- **Edge** ve Chromium'da 720p 60 dakika ölçülmedi (Chrome'da 720p ölçüldü).
- Ölçüm tek koşu (her satır n=1); ADR-013'te bellek yolunda koşudan koşuya
  ~%15 oynama görülmüştü.

## Sonraki tek görev

Aynı ölçümü 8 GB RAM'li bir dizüstünde ve gerçek bir uzun telefon kaydıyla
tekrarlamak; kodlama süresi kullanıcıya uzun geliyorsa ilerleme ekranına kalan
süre tahmini eklemek.
