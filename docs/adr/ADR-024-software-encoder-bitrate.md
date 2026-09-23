# ADR-024 — Yazılım H.264 kodlayıcısına 3 kat bit hızı (R15)

> Tarih: 2026-09-23 · Durum: UYGULANDI ve ÖLÇÜLDÜ (Windows; Chromium, Chrome, Edge).

## Bağlam

Gerçek kayıt koşusunda R15 (Samsung S21, 1920×1080, −90°, 60 fps, 4,4 s,
14,8 MiB, çok ayrıntılı ve hareketli) yalnızca Playwright Chromium'da FAIL
veriyordu: SSIM 0,8252. Chrome ve Edge'de 0,8607 (eşik 0,85; ADR-014 §3).
Donanım kodlayıcısı olmayan Chromium tabanlı tarayıcılar da bu kaliteyi alır:
Linux'ta VA-API'siz Chrome, Brave, sanal makineler, eski GPU'lar.

## Kök neden (ölçüldü)

Uygulamanın çözme → çizme → kodlama yolunu birebir yeniden üreten ayrı bir
deney sayfası kuruldu: aynı mediabunny, aynı an ızgarası ve aynı kırpma. Bu
sayfa uygulamanın skorlarını tekrar etti (Chromium 0,8251, Chrome 0,8607).
Kodlayıcı yapılandırmasının tek tek etkisi:

| Deney (720×1280, 30 fps çıktı) | Chromium | Chrome | Edge |
|---|---|---|---|
| Uygulamanın ayarı (2,49 Mbit/s, VBR, `quality`, 2 s anahtar kare) | 0,8251 · 4,75 Mbit/s | 0,8607 · 3,81 | 0,8607 · 3,81 |
| `hardwareAcceleration: 'prefer-software'` | 0,8252 · 4,73 | **0,8209** · 4,10 | 0,8209 · 4,09 |
| `prefer-hardware` desteği (`isConfigSupported`) | **yok** | var | var |
| 50 Mbit/s (kodlama kaybı neredeyse sıfır) | **0,9683** | 0,9731 | 0,9731 |
| `bitrateMode: 'constant'` (yazılım) | 0,8252 | 0,8208 | — |
| `latencyMode: 'realtime'` (yazılım) | 0,8252 | 0,8210 | — |
| Anahtar kare 5 s (yazılım) | 0,8252 | 0,8209 | — |
| `quantizer` (sabit kalite) | desteklenmiyor | yalnız donanımda | yalnız donanımda |

- **Sebep kodlayıcı.** Chromium'da donanım H.264 kodlayıcısı yok. WebCodecs
  yazılım kodlayıcısına (OpenH264) düşüyor. Chrome ve Edge'e yazılım kodlayıcısı
  zorlanınca aynı düşük sınıfa iniyorlar (0,821).
- **Çözme, döndürme ve 60→30 fps sebep değil.** Aynı yolda 50 Mbit/s ile
  Chromium 0,968 veriyor. Kareler doğru, hizalı ve doğru yönde.
- **Bit hızı modu, gecikme modu ve anahtar kare aralığı etkisiz.**
- Yazılım kodlayıcı bu içerikte 2,49 Mbit/s hedefini tutamıyor. 4,75 Mbit/s
  üretiyor ve yine de daha kötü. Donanım kodlayıcısıyla aynı kalite için
  hedefin ~3 katına ihtiyacı var:

| Yazılım hedefi | Chromium SSIM · gerçek | Chrome `prefer-software` SSIM · gerçek |
|---|---|---|
| 1× (2,49) | 0,8252 · 4,75 | 0,8209 · 4,10 |
| 1,5× (3,73) | 0,8281 · 5,14 | 0,8252 · 4,69 |
| 2× (4,98) | 0,8332 · 5,53 | 0,8463 · 5,59 |
| 2,5× (6,22) | 0,8511 · 6,39 | — |
| **3× (7,46)** | **0,8706 · 7,57** | **0,8882 · 8,31** |
| 4× (9,95) | 0,8972 · 10,01 | 0,9154 · 10,82 |

`contentHint: 'detail'` bit hızını yok sayıyor (10,7 Mbit/s): uygun değil.

## Karar

- Worker, kodlamadan önce `canEncodeVideo(..., hardwareAcceleration:
  'prefer-hardware')` ile planın ayarına bir **donanım** kodlayıcısı olup
  olmadığını soruyor. Tarayıcı hangi kodlayıcıyı seçtiğini söylemez, ama
  donanım kodlayıcısı olup olmadığını söyler. Yoksa `no-preference` yazılım
  kodlayıcıdır.
- Donanım: **hiçbir şey değişmez** (aynı ayar, aynı dosya).
- Yazılım: video bit hızı planın **3 katı** (`src/domain/encoderBitrate.ts`).
  720p30'da 7,46, 1080p30'da 16,80 Mbit/s. 3×, ölçülen en zor gerçek kayıtta
  donanımın kalitesine paylı ulaşan en küçük adım. 2,5× eşiğin 0,001 üstünde
  kalıyordu. Tarayıcı bu bit hızını reddederse plan bit hızına dönülür.
- Depolama tahmini (ADR-023) kodlayıcının gerçek hedefini kullanır.
- SSIM eşiği (0,85) ve eksik kare kapısı değişmedi.

## Sonuç

Gerçek kayıtlar (15 dosya):

| Tarayıcı | Önce | Sonra | Dosya boyutu (çıkan klipler toplamı) |
|---|---|---|---|
| Chromium | 10 PASS, 4 REFUSED, **1 FAIL** | **11 PASS**, 4 REFUSED, 0 FAIL | 24,1 MB → 65,8 MB (**×2,73**) |
| Chrome | 13 PASS, 2 REFUSED | 13 PASS, 2 REFUSED | birebir aynı bayt (×1,00) |
| Edge | 11 PASS, 4 REFUSED | 11 PASS, 4 REFUSED | birebir aynı bayt (×1,00) |

Chromium, dosya başına SSIM (önce → sonra) ve boyut katı: R01 0,9837→0,9871
×2,87 · R02 0,9831→0,9872 ×2,89 · R03 0,9858→0,9866 ×2,82 · R04 0,9770→0,9772
×2,58 · R05 0,9964→0,9967 ×1,05 · R06 0,9138→0,9285 ×2,88 · R07 0,9690→0,9698
×2,92 · R08 0,9863→0,9867 ×2,77 · R10 0,9251→0,9635 ×2,72 · R12 0,9145→0,9635
×2,91 · **R15 0,8252→0,8703 ×1,57**. Chrome ve Edge'de 13/11 dosyanın SSIM'i
ve boyutu değişmedi.

Sentetik matris: üç tarayıcıda 20/20 PASS. Boyut: Chromium ×1,02 (sentetik
desen bitleri harcamıyor), Chrome ve Edge ×1,00 (M12/M14/M15'te ±16 bayt,
koşudan koşuya muxer zaman damgası farkı). Chromium M01–M03 SSIM
0,9416/0,9410/0,9221 → 0,9412/0,9413/0,9219.

Hız: 15 dk 1080p Chromium'da 257,6 s (×3,49 gerçek zaman). ADR-020'nin 3 kat
düşük bit hızlı ×3,47'siyle aynı.

## Bedel ve açık soru (kurucu)

Yazılım kodlayıcılı kullanıcının dosyası gerçek görüntüde ~2,7–2,9 kat büyüyor:
60 dk 1080p ~7,1 GiB (donanımda ~2,4 GiB). Karşılığında bu kullanıcılar
donanımla aynı kalite sınıfına çıkıyor (R10 0,925 → 0,964, R12 0,915 → 0,964).
Seçenekler: 3× (şimdiki), 2,5× (R15 eşikte: 0,851, ~2,3 kat büyüklük) veya 1×
(küçük dosya, R15 eşiğin altında). Ölçüm yalnızca bu makinedeki OpenH264
içindir.

**Kurucu kararı 2026-09-23:** 3× kalır. Kurucu, yazılım kodlayıcılı kullanıcının
dosyasının ~2,7–2,9 kat büyümesini (60 dk 1080p ~7,1 GiB) donanımla aynı kalite
sınıfı karşılığında bilerek kabul etti. Açık soru kapandı.

## Ölçülmeyenler

- Linux/macOS'ta yazılım kodlayıcısı, Brave ve gerçek bir donanımsız makine.
  Chromium'un Windows derlemesi yerine geçti.
- 4 GiB'ı aşan çıktı: 60 dk 1080p yazılım yolunda ~7,1 GiB. mediabunny `mdat`
  için 64 bit boyutu baştan ayırıyor ama böyle bir dosya üretilmedi.
- Donanım kodlayıcısının oturum sınırı dolunca yazılıma düşmesi (tespit
  "donanım" der, dosya yazılımla kodlanır).

Deney betikleri git dışında tutuldu (oturum not defteri); sonuç dosyaları
`web/matrix-results/real-media-*.json`, `matrix-*.json`.
