# ADR-045 — Olağan indirmede donanım kodlayıcısı sabit bit hızıyla kodlar

> Tarih: 2026-10-14 · Durum: UYGULANDI (web; birim ve e2e testleri, matris). Telefonda yeniden ölçülecek.
> Şema ve politika **değişmedi**. Kaynak: telefon raporu [`docs/phone/2026-10-14-s23.md` §3](../phone/2026-10-14-s23.md)
> ve kurucunun koşullu kararı ("olağan indirme de sabit mod istesin — masaüstünde anlamlı kalite kaybı
> göstermezse"). Ölçüm ve önceden kayıtlı kural: [`docs/quality/2026-10-14-cbr.md`](../quality/2026-10-14-cbr.md).
> İlgili: [ADR-024](ADR-024-software-encoder-bitrate.md) (yazılım kodlayıcısına 3 kat),
> [ADR-035](ADR-035-target-size-and-audio-only.md) (hedef boyut, sabit mod),
> [ADR-041](ADR-041-never-upscale.md) (büyütme yok, kaynağın 2 katı tavanı),
> [ADR-027](ADR-027-fast-cut.md) (kopya ve hızlı kesim: dokunulmadı),
> [ADR-042](ADR-042-export-failure-detail.md) (hata ayrıntısı), [ADR-023](ADR-023-storage-margin.md) (depolama tahmini).

## Bağlam

WebCodecs kodlayıcısına bit hızıyla birlikte bir mod verilir (`VideoEncoderConfig.bitrateMode`). 14 Ekim'e
kadar yalnızca hedef boyut ("Küçült") `constant` istiyordu (ADR-035); olağan indirme hiçbir şey istemiyordu,
yani `variable`. Telefonda (S23, Chrome 155, donanım H.264) olağan indirme istenen bit hızının ortanca 1,17
katını yazdı (11 kodlamada 1,06–1,51; kısa ayrıntılı klipte 1,97); sabit modda 0,999–1,003. Uygulamanın
indirmeden önce ve sonra söylediği boyutlar telefonda olağan indirmede tutmuyordu.

## Karar

1. **Olağan (yeniden kodlanan) indirmede kodlayıcı türüne göre mod** (`ORDINARY_BITRATE_MODE`,
   `src/domain/encoderBitrate.ts`):
   - **donanım → `constant`**;
   - **yazılım → `variable`** (değişmedi).
   Kodlayıcı türü ADR-024'teki gibi sorulur (`prefer-hardware` desteği). Bit hızı değişmedi: plan, kaynağın
   2 katı tavanı (10 Ekim), İyileştir'de tavan yok (ADR-037), yazılımda 3 kat (ADR-024).
2. **Kural ölçümden önce yazıldı ve uygulandı** (`docs/quality/2026-10-14-cbr.md`, commit `3a56db1`): bir
   (durum, kodlayıcı) çifti, ortalama VMAF düşüşü ≤ 2,0, en kötü kare SSIM düşüşü ≤ 0,020 ve sabit dosya
   ≤ değişken × 1,01 ise geçer; bir kodlayıcı türü bütün durumlarda geçerse sabit moda geçer, geçmeyenlerin
   ortak özelliği yalnızca içerikse o tür değişken kalır.
   - Donanım (Chrome 155 ve Edge 155, NVIDIA RTX 3070 Ti; dokuz durum: gürültülü 1080p, düz test deseni,
     ekran kaydı gibi 1 dk, 60 fps hareket, kısa 60 fps patlama, 1 dk patlamalı, karanlık kayıt, İyileştir,
     işlenmiş altyazı): **9/9 geçti**. En büyük VMAF düşüşü 1,85, en büyük en kötü kare SSIM düşüşü 0,006;
     sabit dosyalar değişkenin 0,80–0,99'u; yazılan ÷ istenen 1,04–1,29 → 0,95–1,00; düz resim
     doldurulmadı (iki modda da istenenin ~%5'i).
   - Yazılım (Playwright Chromium, OpenH264): düz test deseninde sabit dosya %1,9 (altyazılı) ve %2,5
     (deneme koşusu) büyük çıktı → geçmedi; ortak özellik içerik → **değişken kalır**. Yazılım kodlayıcısı
     iki modda da istenenin ~0,99'unu yazıyor; sabit mod ona bir şey kazandırmazdı.
3. **Sabit mod kodlayıcı kurulmadan sorulur; reddedilirse indirme değişkenle sürer** (`chooseBitrateMode`;
   işçide `settleBitrateMode`): mediabunny'nin `canEncodeVideo`'su, işçinin kuracağı yapılandırmayla (bu
   boyut, bu bit hızı, bu kare hızı, `bitrateMode: 'constant'`; mediabunny Firefox'ta bir kare de kodlar).
   "Hayır", hata ya da cevapsızlık: `variable`. Sonuç bunu söyler (aşağıda); indirme bu yüzden asla
   başarısız olmaz. Aynı soru hedef boyuta da konuldu: o güne dek `constant`'ı reddeden bir tarayıcıda
   Küçült mediabunny'nin "bu yapılandırma desteklenmiyor" hatasıyla dururdu; şimdi değişkenle kodlar ve
   ADR-035'in düzeltme denemeleri boyutu tutturur. Desteklenen her yerde hedef boyut **aynen** (sabit).
   `forced` ölçüm kancası sorulmaz, ne dediyse o (yoksa `variable`).
4. **Raporlama:** sonuç `videoEncoding` taşır (tam kodlamada: bit hızı, kullanılan mod, istenen mod); yöntem
   satırı `data-video-bitrate`, `data-bitrate-mode`, `data-bitrate-mode-asked` (kopyada boş). ADR-042
   ayrıntısında video kodlayıcısının `bitrateMode`'u (yalnızca bilinen üç değer); "Ayrıntılar" satırı
   `enc avc1.640028 no-preference hw+ constant`. Ölçüm betiklerinin `--profile` satırında `videoBitrateMode`.
5. **Kancalar:** `window.__clipBitrateMode = 'constant' | 'variable'` (ölçüm; her derlemede; olağan indirmenin
   modunu değiştirir, hedef boyutu değil) ve `window.__clipRefuseConstantBitrate = true` (yalnızca
   `CLIP_TEST_HOOKS=1` derlemesi: işçi sabit modu reddedilmiş sayar). Uygulama ikisini de kurmaz.

## Boyut tahmini

Olağan indirmenin önceden söylenen tek boyutu ADR-023'ün depolama tahminidir (`ENCODER_OVERSHOOT = 1,1` ×
nominal + 32 MiB). O pay değişken modun ölçüsünden gelir ama değişken mod için **ayrıca** konmuş bir pay
değildir (uzun çıktılarda 0,98–1,00 ölçülmüştü; %10 ölçülmeyen içerik için). Değiştirilmedi: donanımda sabit
mod (masaüstü 0,95–1,00, telefon 0,999–1,003) tahmini artık telefonda da tutuyor (değişkende 1,06–1,51 ile
%10'u aşabiliyordu); yazılım kodlayıcısı değişken kaldığı ve ölçülmemiş donanımlar olduğu için düşürülmedi.
Küçült'ün tahmini (`VIDEO_EXPECTED_RATIO`) zaten sabit moddu; değişmedi.

## Sonuç

- Telefonda ve masaüstü donanımında olağan indirmenin dosyası istenen bit hızında olur; ayrıntılı
  kayıtlarda dosya küçülür (masaüstünde %1–20; telefonda değişkenin fazladan yazdığı ~%6–51 gider).
- Bedel: değişken modun fazladan yazdığı bitlerin getirdiği kalite gider. Masaüstünde ölçülen en büyük kayıp
  VMAF −1,85 (karanlık kayıt, 720p) — kuralın sınırı içinde ama sıfır değil.
- Matris (son kod, 14 Ekim): Chromium, Chrome, Edge 32/32 PASS; Chrome ve Edge tam kodlamaları `constant`
  (sonuç satırından, matrisin notlarında), Chromium `variable`. Hiçbir boyut beklentisi değişmedi (matrisin
  boyut sınırları yalnızca hedef boyut satırlarında, onlar zaten sabit moddu).

## Ölçülmeyen

- Telefonda iki modun **kalitesi** (yalnızca boyutu ölçülmüştü). Ana oturum aynı vakaları
  `--bitrate-mode=variable` ile ve kancasız (uygulamanın kendi seçimi: sabit) koşup karşılaştıracak.
- Intel / AMD / Apple / VA-API donanım kodlayıcıları; Firefox ve Safari (yazılım ya da başka yol).
- Gerçek kamera kayıtları (kaynaklar üretilmiş).
- `isConfigSupported` "evet" deyip `configure` aşamasında sabit modu reddeden bir tarayıcı: o durumda indirme
  bugünkü gibi bir kodlayıcı hatasıyla biter (ayrıntıda `constant` görünür). Böyle bir tarayıcı görülmedi.

## Kurucuya

1. Donanımda sabit mod ayrıntılı kayıtlarda kaliteyi biraz düşürüp dosyayı küçültüyor (en çok VMAF −1,85).
   Boyutun doğru söylenmesi bu bedele değer mi — kararınız böyleydi; telefon ölçüsünden sonra yeniden bakılabilir.
2. Yazılım kodlayıcısı (donanımı olmayan bilgisayarlar) değişken kaldı; orada boyut sapması zaten yok.
