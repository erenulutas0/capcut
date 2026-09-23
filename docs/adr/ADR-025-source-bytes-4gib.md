# ADR-025 — Web toplam kaynak boyutu 4 GiB (politika `2026-09-23.v5`)

> Tarih: 2026-09-23 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine; Edge, Chrome ve
> Playwright Chromium; sentetik kaynak). [ADR-021](ADR-021-input-limit-120min.md)'in
> "Byte sınırı kanıtı" bölümünün devamı; aynı ölçüm scriptini kullanır.

## Bağlam

ADR-021, gerçek telefon kayıtlarında bağlayıcı sınırın 120 dakika değil 2 GiB
olduğunu hesapladı (17 Mbit/s'lik 1080p H.264 kayıt 2 GiB'a ~17 dakikada ulaşır)
ve bir deney derlemesiyle 4,45 GiB'lık bir dosyanın Chrome ve Chromium'da
açıldığını, 2 ve 4 GiB ofsetlerini geçen 5 dakikanın doğru indirildiğini gösterdi.
Edge denenmemişti.

Kurucu (23 Eylül 2026): web yerel toplam kaynak boyutu 2 GiB → **4 GiB**, koşullu:
önce 4 GiB'ı aşan bir kaynak **Edge'de** de ölçülecek; Chrome ve Chromium birleşik
kodda (ADR-022 HDR yolu, ADR-023 yer ayırma, ADR-024 yazılım kodlayıcıya 3 kat bit
hızı) yeniden ölçülecek; yeniden bağlama, sessizlik analizi ve üstüne eklenen müzik
de denenecek. Edge geçmezse politika değişmeyecekti.

## Karar

1. **Politika `2026-09-23.v5`:** `maxTotalSourceBytes` = 4096 MiB = 4 GiB
   (4.294.967.296 byte). Doc 15 satırı: "60 dakika çıktı (diske yazamayan
   tarayıcıda 5 dakika) / 120 dakika video girdi / 4 GiB toplam". Video ve müzik
   birlikte sayılır (doc 15: "toplam byte limitine dahil"); kontrol değişmedi
   (`exceedsTotalSourceBytes`). `policy.test.ts` sayıyı belgeden okur, v5 notunu
   ve v4/v3/v2 notlarının yerinde durduğunu, mobil satırın değişmediğini denetler.
2. **Birim, kontrolün birimi.** Doc 15: "Kullanıcı arayüzü hangi birimi gösteriyorsa
   gerçek kontrol aynı birimde yapılmalı." Ret mesajları "4 GiB (yaklaşık 4,29 GB)"
   der; parantezdeki ondalık değer doğru (4.294.967.296 / 10⁹ = 4,29) ve birim
   testinde hesaplanır. **Düzeltilen:** `formatBytes` (kaynak paneli, yeniden bağlama
   paneli, çıkan dosyanın boyutu) ikili değerleri "GB/MB/KB" diye yazıyordu; 4 GiB'lık
   bir dosya "4.00 GB" görünürdü, sınır ise "4 GiB (yaklaşık 4,29 GB)". Artık
   "GiB/MiB/KiB" yazıyor.
3. **Değişmeyenler:** 120 dakika girdi, 60 dakika çıktı (bellek yolunda 5), 5 video
   kaynağı, 20 parça, 1 müzik (10 dakika / 100 MiB), mobil satırlar (2 GiB / 5 GiB),
   cloud satırları, fiyatlar.
4. **Matris satırı M13** ("politika sınırını aşan büyük dosya") 2 GiB + 16 MiB idi
   ve v5'te açılırdı. Artık 4 GiB + 16 MiB (`m13-oversize-4gib.mp4`; kutu boyu 32 bit
   olduğu için dolgu 1 GiB'lık birkaç `free` kutusu). Ad değişti: eski 2 GiB'lık
   dosya yeni satır sanılmaz, eksikse koşucu "eksik fixture" der. Chromium, Chrome ve
   Edge'de PASS: "“m13-oversize-4gib.mp4” açılamadı: dosya bu sürümdeki 4 GiB
   (yaklaşık 4,29 GB) sınırının üzerinde."
5. EDL fixture'larında (`web/fixtures/edl`) byte değeri yok; değişmedi.

## Ölçüm

Yöntem ADR-021 ile aynı (`scripts/measure-long-source.mjs`): kalıcı profil (disk
destekli OPFS), tarayıcı süreç ağacının private bytes değeri ~400 ms aralıkla,
editör klavye ve fareyle sürülür. Script'e iki seçenek eklendi: `--music` (açtıktan
sonra müzik ekler; dışa aktarmada miks edilir, geri yüklemede yeniden bağlanır) ve
`--music-over` (önce videoyla toplamı sınırı aşan bir müzik dener, ret beklenir).

Kaynaklar (git dışında, `web/tests/media/long/`, ölçümden sonra silindi):
`generate-long-media.mjs --only=big` — 60 dk, 1080p30, gürültülü `testsrc2`,
10,5 Mbit/s, her karede 20 bitlik kare numarası çubuk kodu, indeks (moov) dosyanın
**sonunda**: **4 778 134 663 byte (4,45 GiB)**. `--only=edges` (yeni) bu dosyanın
başından akış kopyasıyla (yeniden kodlama yok, aynı kareler) iki dosya keser:
**4 252 160 630 byte (3,9601 GiB, 53:24)** ve **4 303 694 394 byte (4,0081 GiB,
54:02)**. Müzik: 3 dk AAC (2 914 400 byte) ve 5 dk WAV (57 600 078 byte; 3,96 GiB'lık
videoyla toplam 4 309 760 708 byte > 4 GiB, kendi 100 MiB sınırının altında).

Tarayıcılar: Edge 153.0.4234.48, Chrome 153.0.8010.53 (kararlı), Playwright Chromium
153.0.8010.12. Makine: Windows 11, Intel i5-12500. Her hücre tek koşu (n=1).
Bellek MiB.

### A. 4 GiB'ı aşan dosya (4,45 GiB) — yalnızca bu ölçüm için 8 GiB'lık yerel derleme

ADR-021'deki gibi: yalnızca `maxTotalSourceBytes` 8 GiB yapılıp statik derleme
alındı, `serve-static.mjs` ile ayrı portta sunuldu, `policy.ts` hemen geri alındı
(depoya girmedi; derleme silindi). Tutulan parçalar: **26:00–28:30** (2 GiB ofseti
≈ 27:00) ve **52:30–55:00** (4 GiB ofseti ≈ 53:56); 4 bölme, 3 silme.

| | Edge | Chrome | Chromium |
|---|---|---|---|
| Aç: zaman çizgisi / ilk önizleme karesi | 113 / 254 ms | 114 / 264 ms | 108 / 154 ms |
| Bellek: boş editör → açtıktan sonra | 280 → 336 | 303 → 394 | 107 → 181 |
| Müzik ekle (toplam 4,45 GiB + 2,8 MiB) | eklendi, 77 ms | 63 ms | 92 ms |
| 59:00'a git (~4,4 GiB ofseti): ilk kare, ekrandaki kare | 16 ms, 106199 ✓ | 17 ms ✓ | 61 ms ✓ |
| Oynat: ilk yeni kare / 3 sn sonra ilerleme | 43 ms / 3,01 sn | 60 ms / 3,00 sn | 61 ms / 3,02 sn |
| Sessizlik önerileri (60 dk) | 11,7 sn, 553 öneri | 12,8 sn, 553 | 12,4 sn, 553 |
| bellek: başlangıç → tepe → pencere kapanınca | 620 → 1134 → 500 | 762 → 1183 → 568 | 337 → 1040 → 349 |
| Böl ve sil (~3300 klavye adımı dahil) | 14,0 sn | 14,3 sn | 11,5 sn |
| **5 dk 1080p indir** (gerçek zaman katsayısı) | 32,9 sn (×9,11) | 36,4 sn (×8,23) | 75,2 sn (×3,99) |
| bellek: kodlama öncesi → tepe | 852 → 1063 | 867 → 1092 | 466 → 916 |
| dosya | 203,3 MiB, 5,55 Mbit/s | 203,3 MiB, 5,55 | 605,2 MiB, 16,79 (yazılım kodlayıcı, ADR-024) |
| ffprobe: video süresi, kare | 300,000 sn, **9000** | aynı | aynı |
| kare doğruluğu (çubuk kod: iki parçanın başı, ortası, sonu) | **10/10** | 10/10 | 10/10 |
| çözülemeyen kare / yol / kapanınca geçici dosya | 0 / OPFS / 0 | 0 / OPFS / 0 | 0 / OPFS / 0 |
| Yeniden yükle → istem + video + müzik bağla | 90 + 93 + 54 ms | 96 + 89 + 63 ms | 102 + 86 + 140 ms |
| Yedek (1,7 KB) → boş profil → video + müzik bağla | 12 + 81 + 56 ms, 2 parça | 13 + 83 + 62 ms | 38 + 88 + 148 ms |
| Koşunun tepe belleği | 1147 | 1183 | 1041 |

### B. Gerçek politika (4 GiB), 3,96 GiB'lık dosya

Tutulan parçalar **26:00–28:30** (2 GiB ofseti) ve **50:40–53:10** (~3,94 GiB
ofseti). Müzik: önce toplamı aşan WAV, sonra 3 dk AAC.

| | Edge | Chrome | Chromium |
|---|---|---|---|
| Aç: zaman çizgisi / ilk önizleme karesi | 115 / 251 ms | 222 / 242 ms | 110 / 142 ms |
| Bellek: boş editör → açtıktan sonra | 278 → 347 | 300 → 390 | 103 → 175 |
| Toplamı aşan müzik (4 309 760 708 byte) | 14 ms'de ret, video açık kaldı | 20 ms, aynı | 13 ms, aynı |
| Sığan müzik (toplam 4 255 075 030 byte) | eklendi, 68 ms | 84 ms | 69 ms |
| Sondan 60 sn geriye git (52:24, ~3,9 GiB ofseti) | 11 ms, 94321 ✓ | 14 ms ✓ | 48 ms ✓ |
| Oynat: ilk yeni kare / 3 sn sonra ilerleme | 42 ms / 3,00 sn | 39 ms / 3,01 sn | 52 ms / 2,99 sn |
| Sessizlik önerileri (53:24) | 10,6 sn, 493 öneri | 13,0 sn, 493 | 10,8 sn, 493 |
| bellek: başlangıç → tepe → pencere kapanınca | 764 → 1114 → 532 | 768 → 1151 → 544 | 514 → 989 → 341 |
| Böl ve sil | 14,6 sn | 15,6 sn | 35,1 sn |
| **5 dk 1080p indir, müzikle** | 33,4 sn (×8,98) | 38,5 sn (×7,79) | 98,8 sn (×3,04) |
| bellek: kodlama öncesi → tepe | 838 → 1099 | 996 → **1265** | 578 → 1034 |
| dosya | 203,5 MiB, 5,56 Mbit/s | 203,5 MiB, 5,56 | 605,3 MiB, 16,79 |
| ffprobe: video süresi, kare | 300,000 sn, **9000** | aynı | aynı |
| kare doğruluğu | **10/10** | 10/10 | 10/10 |
| müzik dosyada mı (kaynağın sessiz anında, çıktı 0:04,3–0:05,3) | evet: RMS −48,0 dB (kaynak −60,0), 262 Hz bandı −51,2 dB (kaynak −90,2) | aynı sayılar | aynı sayılar |
| "Bilgisayara kaydet" altındaki not | "…yaklaşık 204 MiB daha boş yer gerekir." | aynı | "…606 MiB…" |
| Yeniden yükle → istem + video + müzik bağla | 84 + 100 + 92 ms | 110 + 92 + 87 ms | 75 + 94 + 112 ms |
| Yedek (1,7 KB) → boş profil → video + müzik bağla | 42 + 87 + 55 ms, 2 parça | 12 + 95 + 65 ms | 43 + 92 + 109 ms |
| Koşunun tepe belleği | 1114 | 1265 | 1034 |

Toplamı aşan müziğin mesajı (üçünde aynı): "“muzik-fazla.wav” açılamadı: video ve
müzik birlikte bu sürümdeki 4 GiB (yaklaşık 4,29 GB) sınırını aşıyor."

### C. Gerçek politika (4 GiB), 4 GiB'ı aşan dosyalar (`scripts/probe-open.mjs`)

| Dosya | Edge | Chrome | Chromium |
|---|---|---|---|
| 4,0081 GiB (4 GiB + 8,3 MiB) | ret, 33 ms | ret, 30 ms | ret, 30 ms |
| 4,45 GiB | ret, 29 ms | ret, 29 ms | ret, 31 ms |

Mesaj: "“over-4gib-1080p.mp4” açılamadı: dosya bu sürümdeki 4 GiB (yaklaşık 4,29
GB) sınırının üzerinde." Boyut kontrolü dosyadan hiçbir byte okumadan yapılır.

### Değerlendirme

- **Edge koşulu karşılandı.** Edge, 4 GiB ofsetini geçen dosyada Chrome ile aynı
  sonuçları verdi: açma, ~4,4 GiB'ta doğru kare, 10/10 kare, müzik, yeniden bağlama.
- **Bellek dosya boyutuna değil çıktıya bağlı**, ADR-021'deki gibi: açtıktan sonra
  175–394 MiB (4,45 GiB'lık dosya dahil). Kodlama tepesi 916–1265 MiB; en yüksek
  Chrome'da 3,96 GiB'lık dosya + müzik ile 1265 MiB (ADR-021'in 60 dakikalık
  çıktısındaki en yüksek 1198 MiB'ın 67 MiB üstü; bu koşuda kodlamadan önce sessizlik
  analizi ve ~3300 önizleme araması da yapılmıştı).
- **Sessizlik analizi** 53–60 dakikada 10,6–13,0 sn; tepe 989–1183 MiB, pencere
  kapanınca 341–568 MiB'a iniyor. ADR-021'deki 2 saatlik 1,6 GiB'lık dosyadaki
  tepeden (708–970 MiB) yüksek: bu kaynak ~6 kat bit hızlı; muhtemel sebep, sesin
  dosyada videoyla iç içe olması yüzünden okunan byte miktarının artması (ölçülmedi). Analiz boyunca düz (onda birlik
  dilimler 820–1134, sonra geri veriliyor); kapı gerekmedi.
- **Yeniden bağlama dosyayı okumaz** (parmak izi boyut + değişiklik zamanı + süre);
  4 GiB'a yakın dosyada da ≤ 0,15 sn.
- Chromium'un çıktısı ADR-024 gereği 3 kat bit hızlı (605 MiB); not bunu doğru
  söylüyor (606 MiB).

Kanıt dosyaları git dışında: `web/matrix-results/long-source-exp8-*-big.json`,
`long-source-v5-*-under.json`. Kaynaklar ve çıktı dosyaları ölçüldükten sonra silindi.

## Aynı değişiklikteki arayüz metinleri (kurucu isteği)

- "Bilgisayara kaydet"in altında ikincil metin: "Kaydederken bilgisayarında yaklaşık
  X daha boş yer gerekir." (ADR-023 bulgu 3; ayrıntı ADR-023 karar 6.)
- HEVC çözücüsü olmayan tarayıcıda HEVC video açılamayınca içe aktarma hatasının
  altında ipucu (ADR-022 "Sonuçlar"). Edge'de dört gerçek HEVC telefon kaydında
  (HDR PQ ve HLG olanlar dahil) ve sentetik HEVC klipte ipucu çıktı; Chrome sentetik klibi açtı
  (ipucu gerekmedi); Chromium'da ipucu çıktı.

## Test edilen

`web/` içinde, bu değişikliğin son hâliyle:

- `npx tsc --noEmit -p .` → hata yok; `npx eslint .` → 0 sorun.
- `npx vitest run` → 29 dosya, **411 test geçti**.
- `npm run build` → başarılı.
- `E2E_PORT=3141 npx playwright test` (tam) → 142 test: **140 geçti, 2 atlandı**
  (sessizlik ekran görüntüsü testleri, yalnızca istenince çalışır), 3,6 dk. HEVC
  testleri bu makinenin Playwright Chromium'unda HEVC çözücüsü olmadığı için
  atlanmadan koştu.
- `node scripts/run-matrix.mjs --case=M13` → Chromium, Chrome, Edge: PASS. Tam matris
  bu değişiklikte koşulmadı.

Yeni/değişen testler: `policy.test.ts` (v5 kimliği ve notu, 4 GiB belgeden,
"4 GiB (yaklaşık 4,29 GB)" iki dilde ve ondalık değerin doğruluğu, mobil satır
değişmedi, 4 GiB'a 20 MiB kala video + 5 MiB müzik sığar / + 60 MiB müzik sığmaz,
`formatBytes` ikili birimler, kaydetme notu, HEVC ipucu kararı ve metni);
`editor.spec.ts` (not, indirilen dosyanın gerçek boyutunu yukarı yuvarlanmış MiB
olarak söylüyor, uyarı değil ikincil metin); `hevc.spec.ts` (HEVC klip: dosya adı,
sebep, ipucu, bağlantı yok, kapatınca kaybolur; HEVC olmayan bozuk dosyada ipucu
yok); `a11y.spec.ts` (ipucu ve not: axe 1440 ve 390 px'te 0 ihlal, 320 px reflow,
metin aralığı).

## Ölçülmeyenler

- **Safari ve Firefox.** Desteklenen çıktı hedefi değiller (Firefox'ta AAC
  kodlayıcı yok); 2 GiB'ı aşan dosya orada denenmedi.
- **Gerçek büyük telefon kayıtları.** Kaynaklar sentetik, sabit bit hızlı H.264.
  2–4 GiB'lık gerçek bir telefon kaydı (değişken bit hızı, HEVC, döndürme, 60 fps)
  denenmedi. HEVC olanlar Edge ve Chromium'da bu makinede zaten codec yüzünden
  açılmıyor (ADR-022).
- **4 GiB'a yakın kaynaktan uzun çıktı.** Burada 5 dakika indirildi. 60 dakikalık
  çıktı ADR-021'de 1,6 GiB'lık kaynaktan ölçüldü; 4 GiB'lık kaynaktan ölçülmedi.
- **Başka makineler**, düşük RAM'li dizüstüler, yavaş/ağ diskleri, gizli pencere.
- Her ölçüm tek koşu (n=1).

## Sonraki tek görev

Kurucunun kendi 2–4 GiB'lık telefon kaydıyla (dosya bilgisayardan çıkmadan)
aç → böl/sil → indir akışını `scripts/measure-long-source.mjs` ile Chrome ve Edge'de
tekrarlamak.
