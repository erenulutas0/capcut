# ADR-033 — Telefonda kesit sonlarında bayat kareler: çözücü, kareleri çizilmeden kapanıyordu

> Tarih: 2026-10-02 · Durum: UYGULANDI. Politika (`2026-09-24.v6`, belge 15) ve şema (EDL v2,
> belge 10) **değişmedi**. [ADR-014](ADR-014-w5-real-media-decoding.md)'ün eksik kare politikası
> (sessizce düşen/siyah/tekrarlanan kare yok; %2'den fazlası eksikse ret; tolerans bir çıktı
> karesi) aynen geçerli ve bir durumla **genişledi**: kapanmış bir çözücünün karesi "eksik"
> sayılır. [ADR-027](ADR-027-fast-cut.md) (hızlı kesim) ve [ADR-028](ADR-028-encode-speed.md)
> (kodlama döngüsü) değişmedi; hızlı kesimin dikiş kodlamasına aynı koruma eklendi.

## Bağlam

[ADR-032](ADR-032-android-samsung-media.md)'nin yan bulgusu: kurucunun telefonunda (Samsung
Galaxy S23, SM-S911B, Android 16, Chrome 154.0.8037.57) **tam kodlanan** her kesitin son
karelerinde görüntü bayattı. Kare sayıları tam, `framesMissing` 0; hiçbir kontrol yakalamıyordu.
Barkodlu senkron klibinde (her kare kendi numarasını taşıyor, `scripts/lib/av-sync.mjs`)
doğrudan görüldü: O'nun son 2 karesi kaynağın 193/194. kareleri yerine 192'yi, Q'nun 351–359.
kareleri 350'yi gösteriyordu. Sayı koşudan koşuya değişiyordu; hızlı kesimler (N, P) ve
masaüstü Chrome/Edge doğruydu.

Akla gelen açıklamalar: (a) `VideoSampleSink.samples(ilk, son + ε)` telefonda erken bitiyor ve
kare seçici (`framePicker.ts`) son kareyi "eksik" saymadan tutuyor; (b) donanım çözücüsü
boşaltmada (flush) son kareleri vermiyor, fazladan paket gerekiyor; (c) kareler zamanında geliyor
ama resimleri bayat.

## Kanıt

### 1. Kareler eksiksiz ve zamanında geliyor; seçici tutmuyor

Canlı derlemeyle telefonda `phone-run.mjs --profile` (2 Ekim): işçinin günlüğüne yazdığı çözülen
kare damgaları her kesitte **tam ve sıralı** — Q'da 360 kare, 0 → 11,967 sn, adım 33,3 ms, geri
giden yok; R'nin (24 fps) ikinci kesitinde 60 kare 9,500 → 11,958 sn (klibin son karesi); B, C,
H–M, O aynı. `framesMissing` her durumda 0, yani her çıktı karesi **kendi damgalı** karesiyle
çizildi; seçici hiçbir kareyi tutmadı (a ve b değil). Bayat olan, zamanında gelen karelerin
**resmi**.

### 2. Çözücünün kapanması resmi götürüyor (telefonda ölçüldü)

`scripts/android/decode-probe.mjs` senkron klibini telefonun Chrome'unda, bir işçi içinde
mediabunny ile çözüyor, her kareyi bir `OffscreenCanvas`'a çizip barkodunu okuyor. İşçinin
`VideoDecoder`'ı sarılı: karelerin çözücüden çıkışı, `flush()` ve `close()` çağrıları çizimlerle
aynı sırada günlüğe yazılıyor. "Yavaş" = her kareden önce 15 ms bekleme (kodlayıcıyı bekleyen
dışa aktarma gibi).

| Deney (telefon) | Çizilen | Yanlış | Not |
|---|---|---|---|
| `samples()`, O aralığı, hızlı tüketici | 159 | **0** | çözücü kapanmadan hepsi çizildi |
| `samples()`, O aralığı, yavaş (üç koşu) | 159 | **6 / 10 / 10** | yanlışların hepsi `close()`'tan sonra çizildi (189–194 → 188; 185–194 → 184) |
| `samples()`, tüm klip (Q), yavaş (iki koşu) | 360 | **13 / 13** | 347–359 → 346, hepsi `close()`'tan sonra |
| Düz WebCodecs: son 4 kare tutulup flush'tan **sonra** çizildi (O ve Q sonu) | 4 + 4 | **0** | boşaltma resmi götürmüyor |
| Aynı, ama çözücü **kapandıktan** sonra çizildi | 4 + 4 | **2 + 2** | 199, 200 → 198; 358, 359 → 357 |
| Yavaş `samples()`, sink'in `close()`'u son çizime kadar **ertelendi** (düzeltme): O, Q, 24 fps O, 24 fps Q | 159 / 360 / 159 / 360 | **0 / 0 / 0 / 0** | boşaltmadan sonra 11–12 / 14–16 / 12 / 20 kare çizildi, hepsi doğru (iki koşu) |
| Masaüstü Chrome, aynı deneyler | — | **0** | kapandıktan sonra çizilen 5 / 10 kare de doğru: masaüstünde kare resmine sahip |

mediabunny'nin (1.58.1) `samples()` döngüsü çözücüyü tüketicinin önünde çalıştırır (kuyruğunda en
çok 8 çözülmüş kare). Aralığın paketleri bitince çözücüyü boşaltır ve **hemen kapatır**
(`.finally(() => decoder.close())`), oysa kuyruktaki kareler henüz çizilmedi. Masaüstünde bir
`VideoFrame` resmini kendi taşıyor. Telefondaki Chrome ise kareyi, ilk çizilene kadar donanım
çözücüsünün çıkış tamponuyla tutuyor; çözücü kapanınca tamponlar bırakılıyor ve çizilmemiş her kare
**en son çizilen resmi** gösteriyor (damgası doğru). Dışa aktarma her kareden sonra kodlayıcıyı
beklediği için, kapanma anında henüz çizilmemiş 1–21 kare bayat çıkıyordu; kaç tanesinin
çizilmemiş olduğu zamanlamaya bağlı — sayının koşudan koşuya değişmesi bundan. Hızlı kesim
(N, P) kopyalanan kareleri hiç çözmüyor; dikişte çözülen kareleri kodlayıcıya beklemeden veriyor,
bu yüzden kuyrukta çizilmemiş kare kalmıyor olmalı (varsayım; N ve P'nin barkodu her koşuda
hatasızdı, ayrı ölçülmedi). Koruma oraya da eklendi (Karar 1).

(c) doğru: kareler zamanında, resimleri bayat. Fazladan paket ya da başka bir boşaltma
gerekmiyor: boşaltmadan sonra çizilen kareler doğru.

Yan gözlem (dışa aktarmayı etkilemiyor): telefonda bir kare, ondan **yeni** kareler çizildikten
sonra **yeniden** çizilirse yeni karenin resmini gösterebiliyor (düz WebCodecs deneyinde 195, 196
→ 198). Dışa aktarma kareleri sırayla çizer; bir kare tekrar gerekiyorsa (24 fps kaynak, 30 fps
çıktı) hemen ardından, araya başka kare girmeden çizilir. 24 fps barkodlu klip (R) bunu ölçüyor.

## Karar

1. **Çözücü, kesitin son karesi çizilene kadar açık kalır** (`web/src/adapters/export/decoderHold.ts`).
   Her kesit kendi `VideoSampleSink`'ini açar; `holdDecoder(sink)` sink'in çözücü üreticisini
   (mediabunny'nin iç `_createDecoder`'ı) sarar ve sink'in `close()` çağrısını erteler. Kesitin
   döngüsü bitince (ya da hata/iptalde) `release()` çözücüyü kapatır. Boşaltma olduğu gibi
   kalır. Hızlı kesimin dikiş kodlamasında da aynısı: çözücü, kodlayıcı dikişin son karesini
   okuyana (`finishRun`) kadar açık.
2. **Kapanmış çözücünün karesi gerçek kare sayılmaz.** Çözücü ertelemeye rağmen kendiliğinden
   kapanırsa (bir hata, tarayıcının çözücüyü geri alması) `decoderClosed()` bunu söyler; kare
   seçicinin yeni `usable` sorusu o andan sonra verilen her kareyi **eksik** sayar
   (`framesMissing`; %2'yi aşarsa `source_frames_missing` ile ret, ADR-014). Dikişte bu durum
   hızlı kesimden tam kodlamaya geri dönüştür.
3. mediabunny bir yükseltmede `_createDecoder`'ı kaldırırsa `holdDecoder` hata verir ve dışa
   aktarma `internal_error` ile durur (sessizce korumasız çalışmaz); birim testi
   (`tests/unit/decoderHold.test.ts`) bunu yükseltmede yakalar. Sürüm kilitli (1.58.1).

### Neden bu yol

- **Kareleri gelir gelmez kopyalamak** (her kareyi ayrı bir tuvale ya da `ImageBitmap`'e) her
  tarayıcıda kare başına bir tam kare kopyası daha demek; ADR-028'de kodlayıcı dışındaki her şey
  kare başına < 0,5 ms. Erteleme masaüstünde hiçbir şeyi değiştirmiyor.
- **Kendi çözme döngümüz** mediabunny'nin tarayıcı düzeltmelerini (damga yeniden atama, SPS
  düzeltmesi, HEVC RASL atlama, Chromium'un ilk paket ve renk alanı düzeltmeleri) yeniden yazmayı
  gerektirirdi; bunlar ADR-014'te ölçülerek doğrulandı.
- **Aralığı uzatıp çözücüyü hiç boşaltmamak** dosyanın sonuna giden kesitte (Q, H, K, R'nin ikinci
  kesiti) işe yaramaz: orada son kareler ancak boşaltmayla çıkar.
- **Cihaza göre** (yalnız Android'de) bir yol açmak, aynı davranışı gösteren başka bir tarayıcıyı
  (ölçülmedi) dışarıda bırakırdı; erteleme her yerde aynı ve zararsız.

## Sonuç

Galaxy S23, Android 16, Chrome 154.0.8037.57; masaüstü Windows 11, Chrome 154 ve Edge (aynı
makine). 2 Ekim 2026, `phone-run.mjs --profile`, 1080p. "Canlı": https://erenulutas0.github.io/capcut/
(bu düzeltmeden önceki kod, ADR-032 derlemesi). "Bu dal": bu dalın yerel derlemesi (`next start` +
`adb reverse`). Hücre: yanlış kare / beklenen kare; yanlışların yeri (b = kesitin ilk 15 karesi,
o = orta, s = son 15 kare; "s 6" = son 15 karenin 6'sı). Kimlik N–R'de barkoddan, A–M'de kaynağın
kendi karelerine karşı (`frame-identity.mjs`); durağan ya da düz kareler "karar verilemez" sayılır
ve parantez içinde. Her durumda ve her koşuda süre ve kare sayısı ADR-032 tablosundakiyle aynı
(R: 5,419 sn, 162 kare), ses kayması ölçülebilen her durumda 0 ms, `framesMissing` 0.

| # | Kaynak, kesit | Telefon, canlı | Telefon, bu dal | Masaüstü Chrome, canlı | Masaüstü Chrome, bu dal | Masaüstü Edge, bu dal |
|---|---|---|---|---|---|---|
| A | add1.mp4, 2–10 sn (aralıkta anahtar kare yok: tam kodlama) | 0/240 (190 k.v.) | 0/240 (190 k.v.) | 0/240 (167 k.v.) | 0/240 (167 k.v.) | 0/240 (167 k.v.) |
| B | R15 Samsung H.264 60 fps, 0,5–4 sn | 0/105 | 0/105 | 0/105 | 0/105 | 0/105 |
| C | R14 Samsung HEVC ağır çekim, 1–8 sn | 0/210 | 0/210 | 0/210 | 0/210 | HEVC açılmıyor |
| D | R11 iPhone HEVC HLG, 2–10 sn | **1/240** (s 1) | 0/240 | 0/240 | 0/240 | HEVC açılmıyor |
| E | 3 dk, hızlı kesim | 0/5400 (3559 k.v.) | 0/5400 (3559 k.v.) | 0/5400 (3559 k.v.) | 0/5400 (3559 k.v.) | 0/5400 (3559 k.v.) |
| F | 3 dk, zorla tam kodlama | **12/5400** (s 12; 3559 k.v.) | 0/5400 (3559 k.v.) | 0/5400 (3559 k.v.) | 0/5400 (3559 k.v.) | 0/5400 (3559 k.v.) |
| G | 3 dk, iki kesit (hızlı kesim) | 0/1800 (1187 k.v.) | 0/1800 (1187 k.v.) | 0/1800 (1187 k.v.) | 0/1800 (1187 k.v.) | 0/1800 (1187 k.v.) |
| H | R15 tüm dosya | **6/132** (s 6) | 0/132 | 0/132 | 0/132 | 0/132 |
| I | R15 1,2–2,9 sn | 0/51 | 0/51 | 0/51 | 0/51 | 0/51 |
| J | R15 iki kesit | **3/108** (2. kesit s 3) | 0/108 | 0/108 | 0/108 | 0/108 |
| K | R14 tüm dosya | **5/354** (s 5) | 0/354 | 0/354 | 0/354 | HEVC açılmıyor |
| L | R14 2,5–5,1 sn | 0/78 | 0/78 | 0/78 | 0/78 | HEVC açılmıyor |
| M | R14 iki kesit | **3/195** (2. kesit s 3) | 0/195 | 0/195 | 0/195 | HEVC açılmıyor |
| N | Senkron klibi 1,2–6,5 sn, hızlı kesim | 0/159 | 0/159 | 0/159 | 0/159 | 0/159 |
| O | aynı, zorla tam kodlama | 0/159 | 0/159 | 0/159 | 0/159 | 0/159 |
| P | iki kesit, hızlı kesim | 0/147 | 0/147 | 0/147 | 0/147 | 0/147 |
| Q | tüm klip, zorla tam kodlama | **6/360** (s 6: 354–359 → 353) | 0/360 | 0/360 | 0/360 | 0/360 |
| R | 24 fps klip, 0,4–3,3 + 9,5–12 sn, zorla tam kodlama (yeni) | **21/162** (2. kesit son 21: 141–161 → 270) | 0/162 | 0/162 | 0/162 | 0/162 |

Telefonda bu dal üç ayrı koşuda 18/18 durumun hepsinde 0 yanlış kare (tablodaki koşu ve ondan önce,
kimlik kontrolünün ilk sürümüyle, iki koşu daha). Canlı derlemede bayat kareler her koşuda başka durumlarda çıktı: aynı gün ilk canlı
koşuda (kimlik kontrolünün ilk sürümüyle: ffmpeg'in 30 fps yeniden örneklemesine karşı) B 5,
C 10, F 13, H 7, I 3, J 4, K 3, L 11, Q 9, R 31 kare, hepsi kesit sonunda; D, M, O o koşuda 0. Bu,
zamanlamaya bağlı yarışla uyumlu. Profil (`drawnAfterDecodePass`) bu dalda telefonda kesit başına
1–16 karenin çözme geçişi bittikten **sonra** çizildiğini gösteriyor (Q 16, K 16, L 14, R 11+7):
düzeltmeden önce bunlar bayat çıkabilecek karelerdi; hepsi doğru. Edge'de HEVC kaynakları (C, D,
K, L, M) bu bilgisayarda açılmıyor (ADR-032'deki gibi, HEVC çözücüsü yok); masaüstü Edge canlı
koşusu bu dalınkiyle aynı (açılan 13 durumda 0 yanlış). "k.v." = karar verilemez: A, E, F, G'nin
kaynağı çoğunlukla durağan; orada bayat bir kare bu kontrolle de görülmez (gözle de zor görülür),
ama F'nin canlıdaki 12 bayat karesi hareketli sonda görüldü.

`decode-probe.mjs`'in tamamı masaüstü Chrome'da da koşturuldu: bütün deneylerde 0 yanlış, çözücü
kapandıktan sonra çizilen 5 / 10 kare dahil (masaüstünde kare resmine sahip).

## Hız (ADR-028)

Masaüstü Chrome 154, 1080p, zorla tam kodlama, `measure-export-memory.mjs --profile`, kalıcı
olmayan profil. "Önce": bu dalın başladığı commit (2e5d06b) ayrı bir klasörde derlendi (3101);
"sonra": bu dal (3100); sırayla, aynı saatte, ölçüm kilidi altında.

| Durum | Önce | Sonra |
|---|---|---|
| 20 dk kaynak, tümü (36 000 kare, 1 kesit sonu) | 130,6 / 146,3 / 144,5 sn (275,7 / 245,9 / 249,1 kare/sn) | 137,0 / 134,5 / 143,2 sn (262,7 / 267,6 / 251,5 kare/sn) |
| 20 kesit × 15 sn (9000 kare, 20 kesit sonu) | 42,1 / 41,5 sn (215,3 / 218,0 kare/sn) | 42,3 / 40,8 sn (214,0 / 221,1 kare/sn) |
| Kare başına (tüm koşular) | kodlama 3,13–3,99 ms, çizim 0,19–0,24 ms, çözme bekleme 0,23–0,31 ms | kodlama 3,22–4,04 ms, çizim 0,20–0,22 ms, çözme bekleme 0,24–0,31 ms |

Fark koşular arasındaki oynamanın içinde (ADR-028: aynı durum saatten saate %10–20); hız düşmedi.
(Bir "önce" koşusu, 143,8 sn, yarıda bırakılmış eski bir ölçüm süreciyle aynı anda çalıştığı için
sayılmadı.) Kesit sonunda çözücünün birkaç kare daha açık kalması dışında iş aynı. Telefonda kare
hızı (profil) canlı ve bu dal aynı sınıfta: F 145,5 / 144,3, Q 123,0 / 124,6, K 128,2 / 124,5 kare/sn.

## Gerileme kontrolü: kare sayısı değil, kare kimliği

- `scripts/lib/frame-identity.mjs` (yeni): barkodsuz kayıtlarda her çıktı karesi, aynı kesitin
  bağımsız ffmpeg referansındaki (`buildReference`'ın grafiği) karesiyle ve onun ±10 komşusuyla
  karşılaştırılır (gri, 36×64, her kare sıfır ortalama / birim kontrast). Bir komşu kendi karesinden
  açıkça yakınsa ve iki referans karesi açıkça farklıysa kare **yanlış**; komşular birbirine
  benziyorsa (durağan sahne) **karar verilemez**, doğru sayılmaz. Yanlış kareler kesit içinde
  yerleriyle (ilk 15 / orta / son 15 kare) raporlanır. Telefonun 1 Ekim çıktılarında masaüstüyle
  kare kare karşılaştırmanın bulduğu bayat sonları (I, J, K, L, M, D'nin son karesi) buluyor;
  masaüstü çıktılarında hiçbir şey bulmuyor.
- `scripts/lib/av-sync.mjs`: barkodlu klipte `frameIdentity` artık beklenen kareyi kesit kesit,
  dışa aktarmanın 30 fps ızgarasıyla hesaplıyor (`expectedSourceFrames`; 24 fps kaynakta tekrar
  eden kareler dahil) ve yanlışları başta/ortada/sonda diye ayırıyor. 24 fps ikiz klip:
  `node scripts/lib/av-sync.mjs <out.mp4> 24`.
- `phone-run.mjs`: her kaydedilen dosyada kare kimliği (N–R barkod, A–M referans); yeni **R**
  durumu (24 fps klip, iki kesit, ikincisi klibin sonuna, zorla tam kodlama). Son satır her
  durumun yanlış/beklenen kare sayısı.
- Matris ve gerçek kayıt koşucusu (`matrix-driver.mjs`, ffmpeg referanslı her durum): yeni kontrol
  "her çıktı karesi referansın aynı karesini gösteriyor (kesit başı, ortası, sonu)".
- Profil (yalnız ölçümde): `drawnAfterDecodePass` — her kesitte çözme geçişi bittikten sonra
  çizilen kare sayısı (düzeltmeden önce telefonda bayat çıkabilecek olanlar).

## Test edilen

- Birim: `tests/unit/decoderHold.test.ts` (6: kapanmanın ertelenmesi, serbest bırakınca hemen
  kapanma, birden çok çözücü, kendiliğinden kapanan çözücünün fark edilmesi, üreticisiz sink'in
  reddi, mediabunny'de `_createDecoder`'ın varlığı); `framePicker.test.ts`'e 2 test (kapanmış
  çözücüden sonra verilen kareler eksik; tolerans içindeki tutulan son kare bile, çözücü kapandıysa
  eksik); `tests/unit/frameIdentity.test.ts` (17: barkodlu klipte beklenen kare — 24 fps dahil —,
  bayat sonun yeri, kaynağın karelerine karşı eşleştirme, VFR'de 1 ms kuralı, 60 fps, durağan ve
  düz kareler, eşleşmeyen kare). Tümü: vitest **585/585**.
- Telefon (Galaxy S23, Chrome 154): `decode-probe.mjs` (yukarıdaki tablo; iki tam koşu),
  `phone-run.mjs` A–R canlı (iki koşu) ve bu dal (üç koşu), `drawnAfterDecodePass` profili.
- Masaüstü `phone-run.mjs` A–R: Chrome canlı ve bu dal, Edge canlı ve bu dal (bir koşu daha, ilk
  kimlik sürümüyle, Chrome ve Edge bu dal): hepsinde 0 yanlış kare.
- Matris (`run-matrix.mjs`, bu dal, yeni kare kimliği kontrolü dahil — ffmpeg referanslı M01, M02,
  M03, M19'da): Chromium **22/22**, Chrome **22/22**, Edge **22/22**.
- Gerçek kayıtlar (`run-real-media.mjs`, 15 kayıt): Chrome **15 PASS**; Chromium ve Edge **11 PASS,
  4 REFUSED** (önceki gibi: HEVC/HDR), 0 FAIL. Kare kimliği 35 kayıt/tarayıcı çiftinde 0 yanlış,
  0 eşleşmeyen. Kontrolün ilk sürümü (ffmpeg'in 30 fps yeniden örneklenmiş referansına karşı) R06
  ve R07'de önce **ve** sonra derlemede aynı 2 / 3 kareyi yanlış saymıştı: R06'da kaynağın karesi
  çıktı anından 1,3 ms sonra başlıyor (oynatıcı kuralı eski kareyi gösterir, ffmpeg'in yuvarlaması
  yenisini), R07'de kareler neredeyse siyah (kontrast < 1,4 gri düzey). Kaynağın kendi karelerine
  karşı ölçülünce ikisi de doğru çıktı; kontrol buna göre değiştirildi (uygulama değil).
- Hız: yukarıdaki tablo.
- e2e (`E2E_PORT=3281 npx playwright test`, tam): **170 geçti, 2 atlandı**, 0 kaldı.
  `tsc --noEmit`, `eslint .`, `npm run build` temiz.

## Ölçülmeyenler

- Başka Android telefonlar, Samsung Internet (ADR-032'deki sebeple), Android'de Firefox; iOS/macOS
  Safari. Erteleme her tarayıcıda aynı ve zararsız; "kapanmış çözücü" koruması WebCodecs'in
  `state` alanına bakıyor, her tarayıcıda var.
- Çözücünün dışa aktarma sırasında **kendiliğinden** kapanması (tarayıcının arka plandaki çözücüyü
  geri alması, donanım hatası) telefonda üretilmedi; bu yol yalnızca birim testinde
  (`decoderHold.test.ts`, `framePicker.test.ts`) sınandı.
- Dikiş kodlamasında (hızlı kesim) erteleme olmadan bayat kare çıkıp çıkmadığı ayrıca ölçülmedi
  (N ve P'nin barkodu her koşuda hatasızdı); koruma yine eklendi.
- Kare kimliği kontrolü durağan ve düz (karanlık) karelerde karar veremez: A, E, F, G'de karelerin
  çoğu, gerçek kayıtlarda karanlık sahneler. Bu kareler doğru sayılmıyor, "karar verilemez" diye
  ayrı yazılıyor. HDR kayıtlarda (R09, R11; HDR renk kontrolü olan durumlar) matris/gerçek kayıt
  koşucusunda kare kimliği yok; telefonda D (HLG) kaynağın kendi karelerine karşı ölçüldü.
- Telefonda bir karenin, daha yeni kareler çizildikten sonra yeniden çizilince yeni resmi
  göstermesi (yan gözlem) dışa aktarmanın çizim sırasında oluşmaz; yine de yalnızca R (24 fps)
  ile ölçüldü, başka kare hızları (25, 23,976, VFR telefon kaydı) telefonda denenmedi.
