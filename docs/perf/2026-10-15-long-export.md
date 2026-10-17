# Uzun dışa aktarma — 60 dakikalık çıktı uçtan uca (2026-10-15)

> Durum: ÖLÇÜLDÜ, tek makinede (aşağıda). Politika (`2026-10-14.v10`) 120 dakikalık / 4 GiB'lık girdiye ve
> 60 dakikalık çıktıya izin veriyor; bu belge o sınırlarda her indirme yolunun gerçekte ne yaptığını ölçer:
> süre, süreç belleği, disk, dosyanın doğruluğu, bekçiler ve sınırlardaki cümleler. **Politika değişmedi.**
> Telefon ölçülmedi (en altta hazır komut). İlgili: ADR-013/020/021 (OPFS yolu, 60 dk), ADR-023 (yer ayırma),
> ADR-024 (yazılım kodlayıcısına 3 kat), ADR-027 (hızlı kesim), ADR-028 (aşama saati), ADR-029 (bellek),
> ADR-035 (Küçült, Sesini al), ADR-042 (takılma bekçisi), ADR-044 (sayfa bekçisi), ADR-045 (sabit bit hızı).

## Özet

- **Her yol tam uzunlukta sonuna kadar gitti**, biri hariç: **Boşlukları at** 60 dakikalık videoda
  çözümlemenin sonunda `RangeError · loudness` ile duruyordu (40 saniyede çalışıyordu). Sebep bulundu ve
  düzeltildi (§6): sessizlik worker'ı dört parçanın zarfını `values.push(...parça)` ile birleştiriyordu; 15
  dakikalık parça ~90 000 değer, worker'ın yığını bunu argüman olarak taşıyamadı.
- **Tam yeniden kodlama (Chrome, donanım):** 60 dk 1080p **448,6 s (×8,0)**; 60 dk 720p (120 dakikalık
  kaynağın ortası) 231,2 s (×15,6); 30 dk 4K HEVC HDR → 1080p SDR 945,1 s (×1,9). Süre donanım kodlayıcısının
  (SDR) ve float16 geri okumanın (HDR) süresi; ADR-028'deki tablonun aynısı (60 dk 1080p o gün 441 s). Dosya
  artık 1690 MiB (ADR-045'ten beri sabit bit hızı; ADR-028'de değişken bit hızıyla 2443 MiB).
- **Tam yeniden kodlama (Playwright Chromium, yazılım kodlayıcı):** 923,5 s (×3,9) ve **4958 MiB'lık dosya**
  (11,4 Mbit/s; ADR-024'ün 3 katı). Bu, uygulamanın kendi **4 GiB girdi sınırının üstünde**: kullanıcı kendi
  indirdiği dosyayı LiloCut'ta yeniden açamaz; FAT32 bir belleğe de sığmaz. Karar gerektirir (§8, öneri 1).
- **Kopyalayan yollar** (hızlı kesim, Sesi kapat, Her yerde açılsın, 20 kesit birleştirme) 60 dakikayı
  5–37 s'de bitiriyor; görüntü kopyalanırken **sesin baştan kodlanması** yolun tamamı (§5). Karıştırma
  döngüsü hızlandırıldı: hızlı kesim 60 dakikada 30,9 → **27,1 s** (3'er koşunun ortancası), çıktı bit bit
  aynı (§6). Sesini al değişmedi (25,1 s): orada tavan tarayıcının AAC kodlayıcısı.
- **Bellek:** bütün süreç ağacının tepesi 488–1218 MiB; sayfa+worker renderer'ı 300–870 MiB, GPU süreci
  150–540 MiB. Çıktı uzadıkça renderer 60 dakikada ~+80–160 MiB tepe büyüyor (ADR-029: muxer'ın dizini
  ~24 MiB/saat, gerisi toplanmamış çöp). Hiçbir koşu 1,25 GiB'ı geçmedi.
- **Disk:** ayırma (ADR-023) gerçek dosyanın 1,11–1,22 katı (sesli kısa dosyada sabit 32 MiB pay yüzünden
  1,66); her koşudan sonra profil başlangıçtaki boyutuna döndü — **artık dosya 0**, iptalde ve diskin
  dolmasında da.
- **Doğruluk:** her başarılı dosyada süre birebir (Boşlukları at'ta sihirbazın seçtiği uzunluk), kare sayısı tam (108 000 / 107 400 / 54 000), kaynak
  karesi başta / ortada / sonda 5/5 doğru (Sesini al'da görüntü yok; Boşlukları at'ta bakılmadı), ses–görüntü kayması başta / ortada / sonda ≤ 0,6 ms.
  Takılma bekçisi ve sayfa bekçisi hiçbir koşuda konuşmadı.
- **Sınırlar dürüst:** 121 dk ve 4,78 GB'lık girdi açılışta, politikanın cümlesiyle reddedildi; 61 dakikalık
  çıktı (§7); Küçült 16 MB'ı (ve 25 MB'ı, paylaşım boyutunu) 60 dakikada **başlamadan** reddetti ve
  gereken en az boyutu söyledi; disk yarıda dolunca yarım dosya silindi; %50'de iptal 345 ms'de durdu.

## 1. Makine ve yöntem

**Makine:** Windows 11 Pro 10.0.26200, Intel Core i5-12500 (6 çekirdek / 12 iş parçacığı), 63,7 GiB RAM,
NVIDIA GeForce RTX 3070 Ti (sürücü 32.0.16.1088); profil ve dosyalar E: sürücüsünde (Kingston 2 TB SSD, NTFS,
~700 GB boş).
**Tarayıcılar:** Chrome 155.0.8059.40 (donanım H.264 kodlayıcısı, ADR-045 ile sabit bit hızı) ve
Playwright'ın Chromium'u 153.0.8010.12 (headless kabuk: GPU yok, OpenH264 yazılım kodlayıcısı, değişken
bit hızı). Edge bu turda koşulmadı (ADR-028'de Chrome ile aynı sınıftaydı).

**Derleme ve sunucu:** düz `npm run build` (test kancası yok) + `npx next start -p 3100`, bu dalın kodu.

**Betik:** `web/scripts/measure-long-export.mjs` (bu çalışmada yazıldı). Her koşu:

- yeni, **diskte kalıcı** bir tarayıcı profili (OPFS gerçekten diske yazar); makinenin ölçüm kilidi
  (`.claude/measure-lock`) koşu boyunca tutulur, bitince bırakılır;
- uygulamanın kendi düğmesine basar: editörde "Videoyu indir" / "Kesiti indir" / "Hepsini birleştirip
  indir", sihirbazlarda "İndir". Kaydetme penceresi yerine OPFS'te bir dosya veren vekil
  (`lib/kesit-flow.mjs`, matrisle aynı): uygulamanın "seçtiğin dosya" yolu gerçek, yalnızca dosya OPFS'te;
- **süre:** düğmeye basıştan "Kaydedildi"ye kadar duvar saati; × gerçek zaman = çıktı süresi ÷ bu süre.
  **Aşama saati** (ADR-028, `window.__clipExportProfile`): worker'ın aşama toplamları;
- **bellek:** işletim sisteminden, tarayıcının bütün süreç ağacının **private bytes** değeri ~400 ms'de bir
  (`lib/process-memory.ps1`, ADR-029: `Get-Process … PrivateMemorySize64`, süreç türü komut satırının
  `--type=` anahtarından). "renderer" = sayfayı ve dışa aktarma worker'ını taşıyan en büyük renderer;
  "GPU" = donanım kodlayıcısının ve çözücüsünün süreci. "Tepe" indirme süresince; "taban" basmadan hemen
  önce; "sonra" pencere kapandıktan 3+ s sonra. Not: Chrome kendi `OnDeviceModelService` sürecini üç
  koşuda (tam kodlama, iptal, 20 kesit tam kodlama) ölçüm sırasında açtı (~200 MiB); bizim değil, ama toplam tepede o anda var;
- **disk:** profil klasörünün baytları ve sürücünün boş alanı 2 s'de bir. Profil tepesi − taban =
  ADR-023'ün baştan ayırdığı yer; pencere kapanınca ve tarayıcı kapanınca profil yeniden ölçülür;
- **dosya:** OPFS'ten 8 MiB'lık parçalarla dışarı alınır, `ffprobe` (süre, kare, kodek, bit hızı);
  **kare kimliği:** kaynağın her karesinde yanan 20 bitlik barkod (`generate-long-media.mjs`,
  `lib/frame-barcode.mjs`) çıktının ilk iki, ortadaki ve son iki karesinde okunur, tarifin söylediği kaynak
  karesiyle karşılaştırılır; **ses–görüntü:** kaynağın sesi 13 saniyede bir aynı yerlerde susar; çıktının
  başında, ortasında ve sonunda 30'ar saniyede `silencedetect` kenarları beklenen yerlerle karşılaştırılır,
  ortanca sapma = sesin görüntüye göre kayması;
- **bekçiler:** başarısızlıkta hata ayrıntısında takılma bekçisinin (ADR-042) sözü, her yoklamada sayfa
  bekçisinin (ADR-044) durumu; bütün konsol hataları (hiçbir koşuda yok).

**Kaynaklar** (git dışında, `generate-long-media.mjs`, deterministik; test deseni + konuşmaya benzer ton
patlamaları ve duraklamalar, gerçek görüntü ya da müzik yok, `moov` dosyanın sonunda):

| Ad | İçerik |
|---|---|
| (a) `long-120min-1080p-3600s.mp4` | 60 dk 1080p30 H.264 1,8 Mbit/s + AAC mono 96 kbit/s, 817 MiB |
| (b) `long-120min-720p.mp4` | 120 dk 720p30 H.264 1,1 Mbit/s, 1034 MiB (çıktı sınırı 60 dk: ortadaki 60 dk indirildi) |
| (c) | (a) + 20 eşit kesit (180'er s), "Hepsini birleştirip indir" |
| (d) `long-30min-4k-hevc-hdr.mp4` | 30 dk 3840×2160 HEVC Main10, BT.2020 / PQ (HDR10), 15 Mbit/s, 3,29 GiB |
| sınır | `long-120min-720p-7260s.mp4` (121 dk), `big-60min-1080p-4gib.mp4` (4,45 GiB) |

"Konuşan kafa + müzik" kaynağı yok: ses bir konuşma benzeri tondur; müzik parçası eklenmedi (müzikli
karıştırma ayrı ölçülmedi).

## 2. Sonuç tablosu

Bellek: taban → tepe (renderer, GPU) → sonra, MiB, bütün süreç ağacı. Disk: profil klasörü, MiB: önce →
tepe → pencere kapandıktan sonra / tarayıcı kapandıktan sonra. Kare: barkod kontrolü doğru / bakılan.
Ses: başta / ortada / sonda kayma. Bekçi: takılma / sayfa. Tek koşu (hızlı kesim ve Sesini al için üç koşu
§6'da).

| Yol | Kaynak | Tarayıcı | Sonuç | Süre (× gerçek zaman) | Yöntem | Dosya | Bellek | Disk | Kare | Ses | Bekçi |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Tam yeniden kodlama | (a) 60 dk 1080p | Chrome | kaydedildi | 448,6 s (×8,02) | encode | 1690 MiB, 3600,000 s, 108 000 kare | 517 → 982 (388, 368) → 599 | 26 → 1921 → 30 / 30 | 5/5 | 0,1 / 0,1 / 0,1 ms | yok / yok |
| Tam yeniden kodlama | (a) | Chromium | kaydedildi | 923,5 s (×3,90) | encode | **4958 MiB**, 3600,000 s, 108 000 kare | 319 → 794 (685, 42) → 340 | 19 → 5507 → 19 / 19 | 5/5 | 0,1 / 0,1 / 0,1 ms | yok / yok |
| Hızlı kesim (10,5–3590,5 s) | (a) | Chrome | kaydedildi | 33,8 s (×106) | smart | 826 MiB, 3580,011 s, 107 400 kare | 547 → 867 (500, 287) → 571 | 26 → 964 → 30 / 30 | 5/5 | 0,1 / 0,6 / 0,1 ms | yok / yok |
| Hızlı kesim | (a) | Chromium | kaydedildi | 26,8 s (×134) | smart | 825 MiB, 3580,011 s, 107 400 kare | 331 → 797 (687, 42) → 333 | 19 → 956 → 19 / 19 | 5/5 | 0,1 / 0,6 / 0,1 ms | yok / yok |
| Küçült → 16 MB | (a) | Chrome | **başlamadan reddedildi** | — | — | — | — | — | — | — | — |
| Sesini al (M4A) | (a) | Chrome | kaydedildi | 24,6 s (×146) | ses | 56 MiB, 3600,000 s | 526 → 634 (322, 154) → 518 | 26 → 118 → 26 / 26 | — | 0,1 / 0,1 / 0,1 ms | yok / yok |
| Sesini al | (a) | Chromium | kaydedildi | 23,7 s (×152) | ses | 56 MiB, 3600,000 s | 312 → 488 (380, 42) → 351 | 19 → 111 → 19 / 19 | — | 0,1 / 0,1 / 0,1 ms | yok / yok |
| Sesi kapat | (a) | Chrome | kaydedildi | 5,6 s (×643) | copy | 774 MiB, 3600,000 s, 108 000 kare | 522 → 885 (582, 147) → 552 | 26 → 968 → 26 / 26 | 5/5 | (ses yok) | yok / yok |
| Sesi kapat | (a) | Chromium | kaydedildi | 5,3 s (×679) | copy | 774 MiB, 3600,000 s, 108 000 kare | 315 → 777 (679, 31) → 371 | 19 → 961 → 19 / 19 | 5/5 | (ses yok) | yok / yok |
| Her yerde açılsın | (a) | Chrome | kaydedildi | 35,0 s (×103) | copy | 829 MiB, 3600,000 s, 108 000 kare | 692 → 901 (451, 161) → 742 | 26 → 968 → 30 / 30 | 5/5 | 0,1 / 0,1 / 0,1 ms | yok / yok |
| Her yerde açılsın | (a) | Chromium | kaydedildi | 25,6 s (×141) | copy | 829 MiB, 3600,000 s, 108 000 kare | 312 → 589 (480, 42) → 356 | 19 → 961 → 19 / 19 | 5/5 | 0,1 / 0,1 / 0,1 ms | yok / yok |
| Boşlukları at (düzeltmeden önce) | (a) | Chrome | **çözümleme 9,4 s'de durdu**: "Çözümleme beklenmedik bir hatayla durdu." · `RangeError · loudness · analysing` | — | — | — | — | — | — | — | — |
| Boşlukları at (düzeltmeden sonra) | (a) | Chrome | kaydedildi; çözümleme 10,4 s | 38,9 s (×92,0) | smart | 836 MiB, 3577,216 s, 107 316 kare | 735 → 1099 (658, 286) → 630 | 26 → 971 → 30 / 30 | (atlandı¹) | (atlandı¹) | yok / yok |
| Boşlukları at (sonra) | (a) | Chromium | kaydedildi; çözümleme 9,9 s | 33,3 s (×107) | smart | 829 MiB, 3577,216 s, 107 316 kare | 537 → 984 (870, 42) → 409 | 19 → 964 → 19 / 19 | (atlandı¹) | (atlandı¹) | yok / yok |
| 20 kesit birleştir | (c) | Chrome | kaydedildi | 36,5 s (×98,6) | copy | 829 MiB, 3600,000 s, 108 000 kare | 794 → 1205 (795, 264) → 793 | 26 → 968 → 30 / 30 | 5/5 | 0,1 / 0,1 / 0,1 ms | yok / yok |
| 20 kesit, tam kodlama | (c) | Chrome | kaydedildi | 474,8 s (×7,58) | encode | 1690 MiB, 3600,000 s, 108 000 kare | 808 → 1218 (637, 397) → 828 | 26 → 1921 → 30 / 30 | 5/5 | 0,1 / 0,1 / 0,1 ms | yok / yok |
| 60 dk kesit, tam kodlama | (b) 720p, 1800–5400 s | Chrome | kaydedildi | 231,2 s (×15,6) | encode | 1090 MiB, 3600,000 s, 108 000 kare | 579 → 1003 (500, 276) → 597 | 26 → 1260 → 30 / 30 | 5/5 | 0,1 / 0,1 / 0,1 ms | yok / yok |
| HDR → SDR | (d) 30 dk 4K HEVC HDR | Chrome | kaydedildi | 945,1 s (×1,90) | encode | 1229 MiB, 1800,000 s, 54 000 kare (1080p) | 600 → 1023 (357, 540) → 597 | 26 → 1414 → 30 / 30 | 5/5 | 0,1 / −0,1 / −0,1 ms | yok / yok |
| %50'de iptal | (a), tam kodlama | Chrome | durdu | 262,7 s'de basıldı, **345 ms'de durdu** | — | dosya yok | 499 → 992 (325, 376) → 723 → 20 s sonra **490** | 26 → 1921 → 30 / 30 | — | — | yok / yok |

¹ Boşlukları at'ta hangi parçaların kalacağı sihirbazın kendi kararı; betik kaynak karesini önceden
bilemediği için kare kimliğine ve ses kaymasına bakmadı (süre ve kare sayısı ffprobe ile, aşağıda).

Ek gözlemler:

- **Boşlukları at, 60 dakikada:** "553 sessiz yer bulundu." / "Videon kısalacak: 1:00:00 → 59:37" /
  "Bir videoda en çok 20 parça birleştirilebiliyor. En uzun 19 boşluk atılacak; 534 kısa boşluk yerinde
  kalacak." Politikanın 20 parça sınırı (`maxClips`) uzun videoda sihirbazın işini 23 saniyeye indiriyor;
  sihirbaz bunu açıkça söylüyor (öneri 6). Çıktı 3577,216 s, 107 316 kare, yöntem `smart`
  ("yalnızca kesim yerlerindeki 522 kare yeniden işlendi").
- **Hızlı kesimin dosyası 3580,011 s**: video 107 400 kare (tam 3580 s); fazladan 11 ms sesin son AAC
  çerçevesi (ADR-032'nin hizalaması), önceki ölçümlerle aynı.
- **20 kesit** uç uca ve aradaki boşluksuz olduğundan uygulama onları tek kopya olarak birleştirdi (`copy`);
  yeniden kodlayan birleştirme ayrıca koşuldu (§2 sonu).
- Chromium kopya yollarında Chrome'dan hızlı: farkın çoğu ses çözme aşamasında (Chromium 10,0–11,4 s, Chrome
  15,7–16,5 s; hızlı kesim ve Her yerde açılsın). Sebebi araştırılmadı.
- **Tarayıcının dosya boyutu sınırı:** 4958 MiB'lık (> 4 GiB) dosya OPFS'e yazıldı, `getFile()` ile okundu ve
  ffprobe 108 000 kareyi ve 3600,000 s'yi okudu; 4 GiB'lık bir tarayıcı sınırına rastlanmadı. Gerçek kaydetme
  penceresinin (`showSaveFilePicker`) diske yazışı ölçülmedi (vekil dosya OPFS'te).

## 3. Bellek

- **Renderer (sayfa + worker)** her yolda en büyük kalem; GPU süreci (kodlayıcı / çözücü) Chrome'da
  150–540 MiB, Chromium'da ~40 MiB (GPU yok). HDR koşusunda GPU 540 MiB (4K HEVC çözme).
- **Çıktı uzunluğuyla büyüme:** renderer'ın onda bir tepeleri Chrome tam kodlamada 293 → 388, 720p'de
  416 → 500, hızlı kesimde 341 → 500, 20 kesitte 571 → 795 MiB. ADR-029'un ölçtüğü muxer dizini saatte
  ~24 MiB; gerisi toplanmadan duran çöp (ADR-029 zorla toplamada yalnızca muxer kadar kalıcı artış buldu).
  Bu çalışmada yığın görüntüsü alınmadı.
- **İptal belleği bırakıyor:** iptalden 20 s sonra ağaç 490 MiB, basmadan önceki tabandan (499) düşük.
- En yüksek ağaç toplamı 1218 MiB (20 kesit, tam kodlama: editörün 20 kesit kartı basmadan önceki tabanı 808'e çıkarıyor; o anda Chrome'un kendi OnDeviceModelService süreci de açıktı, 197 MiB).

## 4. Disk

| Koşu | Ayrılan (profil tepe − taban) | Dosya | Oran |
|---|---|---|---|
| Tam kodlama Chrome | 1895 MiB | 1690 MiB | 1,12 |
| Tam kodlama Chromium | 5488 MiB | 4958 MiB | 1,11 |
| 720p 60 dk | 1234 MiB | 1090 MiB | 1,13 |
| HDR 30 dk | 1388 MiB | 1229 MiB | 1,13 |
| Hızlı kesim / Her yerde açılsın / 20 kesit | 938–942 MiB | 826–829 MiB | 1,14 |
| Sesi kapat | 942 MiB | 774 MiB | 1,22 |
| Sesini al | 93 MiB | 56 MiB | 1,66 (32 MiB sabit pay) |

Ayırma indirme başlarken bir kez yapılıyor ve dosya bitince gerçek boyuna kesiliyor; her koşuda pencere
kapanınca profil başlangıç boyutuna döndü (26 → 26/30 MiB; aradaki ~4 MiB OPFS dosyası değil — OPFS listesi boş — tarayıcının kendi profil dosyaları),
tarayıcı kapanınca da aynı. OPFS'te kalan dosya: 0. Sürücünün boş alanı en çok ~6 GB düştü (Chromium).

## 5. Darboğazlar (aşama saati ve CPU profili)

| Yol | Zaman nereye gidiyor |
|---|---|
| Tam kodlama, Chrome | `encode` %85 (3,5 ms/kare, donanım H.264), çözme %7, çizim %6 — ADR-028 ile aynı; tavan donanım kodlayıcısı |
| Tam kodlama, 720p | `encode` %74 (1,6 ms/kare) |
| Tam kodlama, Chromium | `draw` %89 (7,6 ms/kare: yazılım tuvalinde YUV → RGB ve ölçekleme), kodlama %1 |
| HDR → SDR (4K) | `hdrRead` %72 (12,5 ms/kare, float16 `getImageData`), kırpma %15 (yardımcı worker'da), yazma %6 |
| Hızlı kesim, Her yerde açılsın, 20 kesit | **ses**: çözme %37–47, karıştırma %27–29, AAC %10–17 — görüntü paketleri kopyalanıyor, ses baştan kodlanıyor |
| Sesini al | aynı ses yolu (aşama saati bu yolda yok) |
| Sesi kapat | dosya okuma/yazma; 5,6 s |

**CPU profili** (`web/scripts/profile-export-worker.mjs`, bu çalışmada yazıldı: dışa aktarma worker'ında
V8'in örnekleyen profilcisi, 10 dk'lık kaynak, Chrome): Sesini al ve hızlı kesimde worker'ın kendi
iş parçacığında en çok zaman alan fonksiyon **karıştırma döngüsü `mixFrames`**: 4,8 s'lik indirmede 1,17 s
(örneklenen 7,5 s'nin %15,6'sı; 4,5 s boşta — çözücü ve kodlayıcı ayrı iş parçacıklarında; örnekleme indirme
bittikten sonraki birkaç saniyeyi de kapsıyor).
Döngü her ses örneği için PCM bloklarını baştan tarıyordu.

Kopyalayan yollarda karıştırmadan sonraki tavan **AAC kodlayıcısı**: Sesini al'da 60 dakika 24,6–26,2 s
(~×140) ve aşağıdaki düzeltmeden sonra da aynı; hızlı kesimde düzeltmeden sonra `audioEncode` aşaması
3,3 → 8,6 s'ye çıktı, yani worker artık kodlayıcıyı bekliyor.

## 6. Değişiklikler (önce → sonra, aynı kaynak, aynı makine)

### a) Boşlukları at: 60 dakikalık videoda çözümleme durmuyor

`src/adapters/silence/silenceWorker.ts` dört parçanın ses zarfını `values.push(...meter.finish().db)` ile
birleştiriyordu. Yayılan dizi argüman olarak geçer; 60 dakikada parça başına ~90 000 değer worker'ın
yığınına sığmadı ve çözümleme `RangeError` ile durdu (40 saniyelik videoda sorun yok, bu yüzden hiçbir
test görmedi). Şimdi `joinEnvelopes` (`src/domain/loudness.ts`) parçaları tek bir `Float32Array`'e kopyalıyor;
sonuç `Float32Array.from(birleşim)` ile aynı. Birim testi 4 × 180 000 değerle (120 dakika).
Önce: 9,4 s'de "Çözümleme beklenmedik bir hatayla durdu." → sonra: çözümleme 10,4 s, indirme 38,9 s
(Chrome); Chromium'da 9,9 + 33,3 s.

### b) Ses karıştırma döngüsü: blok araması son bulunan bloktan başlıyor

`mixFrames` (`src/domain/audioMix.ts`) her ses örneği için PCM bloklarını baştan tarıyordu. Konumlar ileri
gittikçe (adım ≥ 0) arama artık bir önceki örneğin durduğu bloktan başlıyor: ondan önceki her blok o
örnekten önce bitiyor, yani sonraki örnekten de önce biter — arama aynı, sonuç bit bit aynı. Mevcut
rastgele karşılaştırma testi (400 deneme, boşluklu bloklar, 7 örnekleme oranı) ve yeni kenar durumları
(geri giden, duran, NaN adım) geçiyor. Node'da 600 s stereo karıştırma 1036–1403 → 516–644 ms.

| 60 dk kaynak, Chrome, 3'er koşu | Önce | Sonra |
|---|---|---|
| Hızlı kesim 10,5–3590,5 s | 33,8 / 30,8 / 30,9 s (ortanca **30,9**) | 27,1 / 27,1 / 27,4 s (ortanca **27,1**, −%12) |
| — `audioMix` aşaması | 10,0 / 9,2 / 9,3 s | 6,1 / 5,9 / 5,9 s |
| — dosya, kare, kimlik, ses | 865 753 776 bayt, 107 400 kare, 5/5, 0,1 / 0,6 / 0,1 ms | **aynı** |
| Sesini al (M4A) | 24,6 / 25,1 / 26,2 s (ortanca 25,1) | 25,4 / 25,1 / 25,1 s (ortanca 25,1) — **değişmedi** (AAC tavanı) |
| — dosya, ses | 58 304 069 bayt, 0,1 / 0,1 / 0,1 ms | **aynı** |

Çıktıların aynılığı ayrıca 10 dakikalık kaynakta dosyalar saklanarak sınandı: Sesini al ve hızlı kesim
dosyalarında ses paketlerinin, çözülmüş sesin ve görüntü paketlerinin MD5'i önce/sonra birebir aynı
(dosyalar yalnızca `mvhd` zaman damgasının 12 baytında farklı). Tam yeniden kodlamada ses, kodlayıcıyı
bekleyen aralarda işlendiği için (ADR-028) bu değişiklik duvar saatini değiştirmez; ölçülmedi.

Denenip bırakılan bir şey yok; daha büyük fikirler §8'de.

## 7. Sınırlarda dürüstlük

| Durum | Ne oldu | Uygulamanın sözü |
|---|---|---|
| 121 dk girdi (7260 s, 720p) | açılışta reddedildi, 0,2 s; hiçbir şey kodlanmadı | "“long-120min-720p-7260s.mp4” açılamadı: video bu sürümdeki 120 dakika sınırının üzerinde. Daha kısa bir video seç; ya da bu videoyu önce başka bir uygulamayla parçalara böl." |
| 4,45 GiB girdi | açılışta reddedildi | "… açılamadı: dosya 4,78 GB; bu sürümün sınırı 4,29 GB. Daha küçük bir video seç; ya da …" (4 GiB = 4,29 GB; ondalık GB ile söylüyor) |
| 61 dk çıktı (120 dk kaynakta 0–61:00 kesiti) | kesit kartı basmadan önce uyarıyor; "Kesiti indir"e basınca hiçbir kare kodlanmadan, OPFS'e dosya açılmadan durdu | Kartta: "İndirmek için çok uzun: bir kesit en fazla 60 dakika indirilebilir. Başını ya da sonunu kısalt." Basınca: "Kesit 1:01:00. İndirmek için en az 1:00 kısalt — sınır 60 dakika." |
| Küçült → 16 MB, 60 dk | düğme kapalı, başlamadan | "Bu video bu boyuta sığmaz (hedef 16 MB). En az 131,3 MB gerekir; ya da editörde en çok 07:18.769 uzunluğunda bir kesit seç." 25 MB ve paylaşım seçenekleri de "en az 131,3 MB gerekir" dedi |
| Disk yarıda doluyor (gerçek kota: 600 MiB yer, baştan yalnızca 1 MiB ayırma — ölçüm kancası) | 108 000 karenin 38 405'inde (~21. dakika, 157 s) `QuotaExceededError`; yarım dosya silindi, OPFS boş, profil 30 MiB | "Video yazılırken diskte yer kalmadı. Yarım dosya silindi, indirilecek bir şey yok. Diskte yer açıp tekrar dene." Ayrıntı: `QuotaExceededError · write · kare 38405/108000 · enc avc1.640028 no-preference hw+ constant · …` |
| Yer yetmiyor (1500 MiB yer, gereken ~1,99 GB) | 0,3 s'de, hiçbir kare kodlanmadan | "Bu uzunlukta bir video için boş disk alanı yetmiyor. Diskte yer aç ya da en fazla 5 dakikalık bir kesit indir; hiçbir kare kodlanmadı." + "Seçtiğin yerde bu video için yaklaşık 1,99 GB boş yer gerekiyor; o diskte bu kadar yer yok. …" |
| %50'de iptal (60 dk, tam kodlama) | 345 ms'de durdu; OPFS boş, profil 30 MiB; bellek 20 s sonra tabanın altında | "İndirme durduruldu; yarım dosya bırakılmadı." |

Disk dolması yolu gerçek kotayla sınandı (`Storage.overrideQuotaForOrigin`, `tests/e2e/output-limits.spec.ts`
ile aynı yöntem; Chromium onu her OPFS yazımında uygular); gerçek bir dolu disk değil.

## 8. Öneriler (karar gerektirir, uygulanmadı)

1. **Yazılım kodlayıcısında 60 dakikanın dosyası 4 GiB'ı geçiyor** (4958 MiB, 1080p, ADR-024'ün 3 katı
   bit hızı). Uygulamanın kendi girdi sınırı 4 GiB: kullanıcı kendi indirdiğini yeniden açamaz, FAT32'ye
   yazamaz. Seçenekler: (a) yazılım kodlayıcısında bit hızını çıktı uzunluğuna göre tavanla (ör. dosya
   ≤ 4 GiB − pay; 60 dk 1080p için ~9 Mbit/s), kalite ADR-024'teki ölçümle yeniden doğrulanır; (b) indirmeden
   önce "bu dosya ~4,8 GB olacak; LiloCut'ta yeniden açılamaz" demek; (c) olduğu gibi bırakmak. Kalite ↔
   boyut kararı kurucunun.
   **Durum 17 Ekim:** kurucu (a)'yı seçti, uygulandı ([ADR-024, 17 Ekim eki](../adr/ADR-024-software-encoder-bitrate.md)):
   hiçbir indirme 4 GiB − 1 bayttan büyük olmaz; aynı koşu artık 8,48 Mbit/s ister ve **3697,6 MiB** yazar (önce 4958).
2. **Kopyalayan yolların süresi sesin süresi.** Karıştırma döngüsü hızlandı (§6); geri kalan çözme
   (WebCodecs AAC) ve kodlama. Sesi hiç değiştirmeyen bir kesimde (kazanç 1, müzik yok, kenarlarda solma
   yok) AAC paketlerini kopyalamak bu süreyi kaldırır, ama kesim noktaları AAC çerçevesine (21,3 ms) düşmez:
   ADR-032'nin hizalamasıyla birlikte yeniden tasarlanmalı; ayrıca ölçülmeli. Bugün 60 dakika 25–39 s,
   kullanıcı için zaten kısa.
3. **HDR'de float16 geri okuma** (12,5 ms/kare, %72): tonu GPU'da (WebGL / WebGPU gölgelendirici) eşleyip
   8 bit okumak 4K HDR'yi ×1,9'dan belirgin hızlandırabilir; ADR-022'nin "aynı sonuç" kanıtı yeniden
   kurulmalı. Büyük iş.
4. **Chromium (GPU'suz) tam kodlamada çizim** (%89): çıktı boyu kaynakla aynı ve kırpma / altyazı / iyileştirme
   yokken çözülen kareyi tuvalsiz doğrudan kodlayıcıya vermek çizimi kaldırır (hızlı kesimin dikişlerinde bu
   zaten yapılıyor). Renk yolu değişir (YUV → RGB → YUV turu kalkar), ADR-033'ün çözücü tutma kuralı ve
   matris SSIM'i yeniden ölçülmeli. Orta iş.
5. **"Yer yetmiyor" cümlesi** dosya yolunda da "en fazla 5 dakikalık bir kesit indir" diyor; 1,5 GB boş
   yerde ~20 dakikalık kesit sığar. Cümle, ayrılabilen yere göre söylenebilir (metin kararı).
   **Durum 17 Ekim:** uygulandı ([ADR-023, 17 Ekim eki](../adr/ADR-023-storage-margin.md)): uzunluk diskin gerçekten
   verdiği yerden ve indirmenin kendi bit hızından hesaplanır; dürüst bir sayı yoksa sayı söylenmez.
6. **Boşlukları at uzun videoda 553 sessizliğin 19'unu atabiliyor** (politikanın 20 parça sınırı,
   `maxClips`): 60 dakika yalnızca 23 s kısalıyor. Sihirbaz bunu dürüstçe söylüyor. Sınırın sihirbazın
   ürettiği tarif için yükseltilmesi (kopya/akıllı kesimde parça sayısı belleği değil dikiş sayısını
   artırır) politika kararıdır; bellek ve süre ölçülerek verilmeli.

## 9. Ölçülmeyenler

- **Telefon.** Hiçbir sayı telefonda değil. Hazır komut (S23, kurucunun telefonu, adb ile):

  ```
  cd web
  node scripts/generate-long-media.mjs --only=phone60          # 60 dk 720p, < 50 MB (Playwright'ın sınırı)
  adb forward tcp:9222 localabstract:chrome_devtools_remote
  node scripts/android/phone-run.mjs --only=LONG60 --profile --url=https://erenulutas0.github.io/capcut/editor/
  ```

  `LONG60` yalnızca adıyla istenince koşar (zaman aşımı 120 dk); bütün 60 dakikayı tam kodlamayla indirir,
  dosyayı bu bilgisayarda ffprobe ve kare kimliğiyle doğrular. Telefonun belleği ve diski bu betikte
  ölçülmüyor. Kaynak üretildi ve sınandı: 45,4 MB, 3600,000 s, 108 000 kare, barkod başta / ortada / sonda
  okunuyor. Durum masaüstünde denendi (`--desktop=chrome --url=http://127.0.0.1:3100/editor/`, yerel derleme):
  241,2 s'de kaydedildi, 3600,000 s, 108 000 kare, ses kayması 0; kaynağın barkodu başta / ortada / sonda
  5/5 doğru. (İlk denemede `phone-run`'ın kayıt yöntemi bu aç desende 108 000 karenin hepsine "karar
  verilemez" dedi; durum artık barkodu okuyor.) Yani komut çalışıyor — bu bir telefon sayısı değil.
- Edge; gerçek kaydetme penceresinin diske yazışı (vekil OPFS'e yazar); FAT32 / ağ diski; gerçekten dolu bir
  disk (kota ile benzetildi); 4 GiB'ın hemen üstündeki girdi (`--only=edges`, ADR-025'te ölçüldü; burada
  4,45 GiB); müzikli karıştırma; gerçek bir konuşma kaydı; aynı anda başka ağır iş yükü olmayan bir makine
  (üç ajan aynı makinede çalıştı; koşular ölçüm kilidiyle sıraya kondu, ama kilit klasörü bir kez, bu çalışmanın
  bir koşusu onu tutarken başka bir işçe silindi (o koşu takılı kalıp atıldı ve yeniden koşuldu); kilidi
  tutmayan işlerle çakışma olmuş olabilir).
- Mutlak süreler aynı makinede saatten saate %10–20 oynuyor (ADR-028); tek koşulu satırlar bu kadar
  belirsiz.
