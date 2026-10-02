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
| `samples()`, O aralığı, yavaş (iki koşu) | 159 | **6 / 10** | yanlışların hepsi `close()`'tan sonra çizildi (189–194 → 188; 185–194 → 184) |
| `samples()`, tüm klip (Q), yavaş | 360 | **13** | 347–359 → 346, hepsi `close()`'tan sonra |
| Düz WebCodecs: son 4 kare tutulup flush'tan **sonra** çizildi (O ve Q sonu) | 4 + 4 | **0** | boşaltma resmi götürmüyor |
| Aynı, ama çözücü **kapandıktan** sonra çizildi | 4 + 4 | **2 + 2** | 199, 200 → 198; 358, 359 → 357 |
| Masaüstü Chrome, aynı deneyler | — | **0** | masaüstünde kare resmine sahip |

mediabunny'nin (1.58.1) `samples()` döngüsü çözücüyü tüketicinin önünde çalıştırır (sırasında 8
çözülmüş kareye kadar). Aralığın paketleri bitince çözücüyü boşaltır ve **hemen kapatır**
(`.finally(() => decoder.close())`), oysa kuyruktaki kareler henüz çizilmedi. Masaüstünde bir
`VideoFrame` resmini kendi taşıyor. Telefondaki Chrome ise kareyi, ilk çizilene kadar donanım
çözücüsünün çıkış tamponuyla tutuyor; çözücü kapanınca tamponlar bırakılıyor ve çizilmemiş her kare
**en son çizilen resmi** gösteriyor (damgası doğru). Dışa aktarma her kareden sonra kodlayıcıyı
beklediği için, kapanma anında kuyrukta kalan 1–20 kare bayat çıkıyordu; kaç tanesinin
çizilmemiş olduğu zamanlamaya bağlı — sayının koşudan koşuya değişmesi bundan. Hızlı kesim
(N, P) kopyalanan kareleri çözmüyor, dikiş kareleri de kodlayıcıya hemen verildiği için etkilenmedi.

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

TABLO_YER_TUTUCU

## Hız (ADR-028)

HIZ_YER_TUTUCU

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

TEST_YER_TUTUCU

## Ölçülmeyenler

OLCULMEYEN_YER_TUTUCU
