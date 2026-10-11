# ADR-041 — Görüntü büyütülmez: indirme videonun kendi boyutudur, “Ayarlar”daki seçim bir üst sınırdır

> Tarih: 2026-10-11 · Durum: UYGULANDI (web; birim ve e2e testleri, kalite katmanı).
> Politika `2026-10-11.v9` (belge 15: çıktı boyutu satırı). Şema **değişmedi** (EDL v4).
> Kaynak: kalite raporunun 11 Ekim “bilinmesi gerekenler” maddesi (`docs/quality/bulgular.md`) ve
> kurucunun 11 Ekim onayı: editörün çıktısı kaynağı izlesin; hiçbir yol büyütmesin.
> İlgili: [ADR-027](ADR-027-fast-cut.md) (hızlı kesim), [ADR-035](ADR-035-target-size-and-audio-only.md)
> (Küçült’ün boyut basamakları), [ADR-024](ADR-024-software-encoder-bitrate.md) (bit hızı).

## Bağlam

11 Ekim’e kadar indirmenin boyutu tarifteki `export.shortEdge` sayısının kendisiydi ve iki değeri
vardı: 1080 (varsayılan) ve 720.

- **Editör doğrudan açıldığında** her video 1080p iniyordu: 1280 × 720 kaynak 1920 × 1080 oluyordu
  (2,25 kat piksel). Boyut artık kaynağınki olmadığı için hızlı kesim (ADR-027) de reddediliyordu
  (`resolution`): her kesim baştan sona yeniden kodlanıyordu.
- **Sihirbazlar** 10–11 Ekim’de “kendi boyutu” tarifine geçmişti (`ownSizeRecipe`), ama o tarif
  iki basamak tanıyordu: 720p’ye kadar olan her şey 720p. 640 × 360 kaynak 1280 × 720 oluyordu.
- **Dikey yap** hiç boyut seçmiyordu: 1280 × 720 bir videodan kestiği 406 × 720’lik dilimi
  1080 × 1920’ye (2,7 kat), 640 × 360’tan kestiği 202 × 360’lık dilimi 5,3 kat büyütüyordu.
- **Küçült**’ün basamakları (1080, 720, 540, 360) kaynağı “tutan ilk basamak”tan başlıyordu:
  480p kaynak 540’a, 360’ın altındaki kaynak 360’a büyütülüp sonra sıkıştırılıyordu.

Büyütmek görüntüye ayrıntı katmaz; dosyayı büyütür, kodlamayı yavaşlatır ve kaynağın kendi
karelerinin kopyalanmasını (hızlı kesim) imkânsız kılar.

## Karar

**Görüntü büyütülmez.** `export.shortEdge` boyutun kendisi değil, bir **üst sınırdır** (“en çok
1080p”, “en çok 720p”). İndirmenin çerçevesi, o sınıra kadar, **hiçbir kaynak pikselinin birden
fazla çıktı pikselini kaplamadığı en büyük çerçevedir.** Kural tek yerde uygulanır: tarifi
derleyen `compileRenderPlan` (`web/src/domain/renderPlan.ts`) boyutu `outputSizeFor`’dan alır
(`web/src/domain/outputSize.ts`). Dosya üreten bütün yollar — on sihirbaz, editör, Küçült’ün
basamakları, önizleme karesi — bu planı okur; ayrı bir “boyut seçen” kod kalmadı.

| Kaynak ve çerçeve | 11 Ekim’e kadar | Şimdi |
|---|---|---|
| 1280 × 720, kendi biçiminde (16:9) — editör | 1920 × 1080 | 1280 × 720 |
| 640 × 360, kendi biçiminde — sihirbaz / editör | 1280 × 720 / 1920 × 1080 | 640 × 360 |
| 854 × 480, kendi biçiminde | 1280 × 720 / 1920 × 1080 | 854 × 480 |
| 3840 × 2160, sınır 1080p | 1920 × 1080 | 1920 × 1080 (değişmedi) |
| 1920 × 1080, sınır “en çok 720p” | 1280 × 720 | 1280 × 720 (değişmedi) |
| 1280 × 720 → Dikey yap, Doldur | 1080 × 1920 | 406 × 720 |
| 640 × 360 → Dikey yap, Doldur | 1080 × 1920 | 202 × 360 |
| 640 × 360 → Dikey yap, Sığdır | 1080 × 1920 | 640 × 1138 |
| 1920 × 1080, %200 yakınlaştırma | 1920 × 1080 | 960 × 540 |

### Kenar durumları ve verilen kararlar

1. **Kırpma (Dikey yap → Doldur, yakınlaştırma).** Ölçü, kaynağın tamamı değil, çerçevede
   **gösterilen dilimdir**. “Doldur” 16:9 bir videodan 9:16’lık bir dilim keser; dosya o dilimin
   kendi pikselleridir. Küçük bir yatay videodan çıkan dikey video bu yüzden küçüktür
   (1280 × 720’den 406 × 720). Sihirbaz bunu indirmeden önce söyler: “… dikey video: 406 × 720.
   Videon büyütülmez; büyütmek onu netleştirmez.” Yakınlaştırma da bir kırpmadır: %150’de
   1280 × 720 video 854 × 480 iner.
2. **Boşluk ekleme (Sığdır / contain).** Boşluk görüntü değildir. “Sığdır” görüntüyü olduğu gibi
   bırakır ve çevresine siyah ekler: çerçeve, görüntünün 1:1 kalacağı genişliktedir (640 × 360 →
   640 × 1138, içindeki görüntü yine 640 × 360). Bu, **kaynağın pikselinden fazla pikseli olan tek
   durumdur** ve fazlası yalnızca boşluktur. Sınıra sığmıyorsa (1920 genişlik, sınır 1080) görüntü
   eskisi gibi küçültülür (1080 × 1920, içinde 1080 × 608). Biçimi üç çerçeveden birine uymayan
   kaynak (4:3, 848 × 480, 1920 × 1088) “Sığdır” ile aynı kurala girer.
3. **Çift sayı.** Kodlayıcı çift kenar ister. Boyut dilimin kısa kenarından yuvarlanır; yuvarlama
   çerçeveyi dilimden bir piksel büyük yaparsa kısa kenar birer birer indirilir. Sonuç: görüntü
   hiçbir zaman büyümez, en çok %2 küçülür (birim testi 22 kaynak × 3 biçim × 2 yerleşim × 4
   yakınlaştırma × 2 sınır = 1056 durumda bunu denetler).
4. **Dönüş bilgisi.** Boyut, kaynağın **gösterilen** eninden ve boyundan hesaplanır (dönüş
   uygulandıktan sonra; `displayWidth` / `displayHeight`). Yan çekilmiş bir telefon videosu dikey
   bir video olarak ölçülür. Bu ADR dönüş işlemeyi değiştirmedi.
5. **Farklı boyutta videolardan kesitler.** Tek dosyanın tek boyutu olur: çerçeve **en büyük**
   görüntüyü izler; küçük olanlar ona büyütülür. (Uygulama bugün tek video açtırıyor; kural şema
   beş kaynağa izin verdiği için yazıldı.)
6. **En küçük çerçeve — 144 (istisna 1).** Kısa kenarı 144’ün altında kalan görüntü 144’e
   getirilir: donanım H.264 kodlayıcıları ve bazı oynatıcılar daha küçük kareyi reddeder. Büyütmenin
   yapıldığı iki yerden biri budur; “Ayarlar” bunu açıkça yazar (“Bu görüntü çok küçük: her yerde
   açılabilsin diye … boyutuna büyütülür.”).
7. **Gömülü altyazı — 360 (istisna 2).** Görüntüye gömülen altyazı gerçek harflerle çizilir; harf
   boyu kısa kenarın bir payıdır ve 10 pikselin altına inmez. 360’ın altında harfler biçimini
   koruyamaz ve daha büyük çerçevelere sığan bir satır sığmayabilir. İçine altyazı gömülen video bu
   yüzden kısa kenarda en az 360’tır. Altyazı panelindeki “sığıyor / sığmıyor” işareti artık sınırın
   değil, **gerçek indirme çerçevesinin** üzerinde hesaplanır.
8. **Donanım kodlayıcı küçük kareyi reddederse.** Kodlayıcıyı tarayıcı seçer (`no-preference`):
   donanım kodlayıcı o boyutu desteklemiyorsa yazılım kodlayıcıya kendisi geçer. İkisi de yoksa
   indirme, başlamadan önceki yetenek denetiminde durur ve bunu söyler (“Bu tarayıcıda H.264 kodlama
   bu ayarla desteklenmiyor.”);
   büyütülmüş bir dosya sessizce üretilmez. 144 tabanı bu duruma düşme olasılığını azaltmak içindir.
   **Ölçülmedi:** gerçek donanım kodlayıcılarda 360p’nin altı (aşağıda).
9. **Bit hızı (ADR-024 ve 10 Ekim eki).** Değişmedi, yalnızca daha küçük çerçeveye uygulanıyor:
   planın bit hızı piksel sayısından gelir (yaklaşık 0,09 bit/piksel, en az 500 kbit/sn), kaynağın
   kendi bit hızının iki katıyla sınırlanır, yazılım kodlayıcıda üç katı alınır. Küçük çerçevede
   500 kbit/sn tabanı devreye girer (640 × 360 için plan 622 kbit/sn; 202 × 360 için taban).
10. **Küçült’ün basamakları (ADR-035).** İlk basamak artık indirmenin **kendi çerçevesidir** —
    1080, 720 ya da 480p video için 480, dikeye çevrilmiş 720p video için 406 — ve altındaki
    basamaklar (720, 540, 360) ondan sonra gelir. Tabanın (360) altındaki bir görüntü tabana
    büyütülmez: kendi boyutu tek basamaktır. Kodlayıcı türü sorusu bu ilk basamak için de sorulur.
11. **Hızlı kesim (ADR-027).** Kopya kaynağın boyutunu korur; çerçeve artık kaynağın boyutu olduğu
    için, üç biçimden birinde olan ve sınırdan büyük olmayan **her** kaynak uygundur (1920 × 1080,
    1280 × 720, 854 × 480, 640 × 360, dikeyleri, kareler). 11 Ekim’e kadar yalnızca tam 720p ve
    1080p uygundu ve editörde 720p kaynak varsayılan ayarla hiç uygun değildi. Sınırın üstündeki
    kaynak (4K, ya da “en çok 720p” seçiliyken 1080p) eskisi gibi yeniden kodlanır (`resolution`).
    Yakınlaştırılmış görüntünün nedeni “kırpma” olarak söylenmeye devam eder (çerçeve artık tam
    16:9’a yuvarlanmadığı için biçim karşılaştırması bir piksellik payla yapılır).

### “Ayarlar”daki seçim

Seçim eskisi gibi iki değerlidir; anlamı ve yazısı değişti:

- **“Videonun kendi boyutu (en çok 1080p)”** — varsayılan (`1080`);
- **“En çok 720p”** (`720`).

Altında, indirmenin planından okunan gerçek boyut yazar: “İndirilen video 1280 × 720 olur. Videon
büyütülmez: büyütmek görüntüyü netleştirmez, yalnızca dosyayı büyütür.”

**Kaynağından büyük boyut isteme seçeneği yoktur.** Kurucu kuralı “kullanıcı Ayarlar’da açıkça
daha büyük bir boyut istemedikçe” diyordu; böyle bir denetim 11 Ekim’e kadar da yoktu — yalnızca
varsayılanı her şeyi büyüten iki basamak vardı. Yeni bir “büyüt” seçeneği eklemek tarife yeni bir
alan (şema değişikliği) ve yeni bir ekran öğesi gerektirir; istenirse ayrı bir karar olarak eklenir
(aşağıda “Kurucuya”).

### Şema ve kayıtlı projeler

Şema değişmedi: `export.shortEdge` aynı alan, aynı sayılar (pozitif tam sayı). Kayıtlı bir projedeki
sayı **olduğu gibi kalır** ve “en çok” diye okunur:

- `720` yazan proje (kullanıcı seçmişti): 1080p kaynakta yine 1280 × 720 verir — anlamı aynı.
- `1080` yazan proje (varsayılan; kullanıcı seçmiş olsa da ayırt edilemez): kaynağı 1080p’den küçükse
  artık kaynağın boyutunda iner. Değişen tek davranış budur; eski davranış bir büyütmeydi.
- Sihirbazlar videoyu açarken sınırı varsayılana (1080) döndürür (`ownSizeRecipe`): bir sihirbazın
  bakılacak “Ayarlar”ı yoktur, önceki bir editör oturumunun sınırı ona taşınmamalı.

## Testler

- Birim: `web/tests/unit/outputSize.test.ts` (editör varsayılanı, sınır, kayıtlı tarif, hızlı
  kesim uygunluğu, 1056 durumluk “hiçbir piksel büyümez” taraması, iki taban, Dikey yap, yakınlaştırma);
  `targetSize.test.ts` (basamaklar), `taskRecipes.test.ts`, `renderPlan.test.ts`, `enhancePlan.test.ts`,
  `policy.test.ts` (belge 15 v9 ↔ kod ↔ ekran yazıları).
- E2E: `web/tests/e2e/own-size.spec.ts` — editör doğrudan açılıp hiçbir ayara dokunulmadan 720p
  kaynak 1280 × 720 ve `export-method` öznitelikleri (`data-method`, `data-fallback`,
  `data-frames-encoded`) “Kes” sihirbazındakiyle **aynı**; 640 × 360, 854 × 480, 360 × 640 kaynak
  kendi boyutunda ve kopya; “en çok 720p” 1080p kaynağı 1280 × 720 yapar (yeniden kodlanır,
  `resolution`); yakınlaştırma. `wizards.spec.ts` (Dikey yap: 202 × 360, 640 × 1138, 360 × 640),
  `fast-cut.spec.ts` (1080p sınırı 720p kaynakta artık kopya).
- Kalite katmanı (bölüm 5, “Büyütme yok”): dokuz yol × 360p / 480p / 720p kaynak; bütçe: çıkan /
  kaynak piksel oranı ≤ 1 (`out.size.*.*.pixelRatio`).

## Ölçülmeyenler

- **Donanım kodlayıcılar.** Bütün ölçümler Playwright’ın Chromium’unda (yazılım kodlayıcı). Gerçek
  Chrome / Edge’in donanım kodlayıcısının 360p’nin altındaki karelerde (202 × 360, 256 × 144) ne
  yaptığı ölçülmedi; kural tarayıcının yazılıma geçmesine güveniyor.
- **Gerçek telefon, Safari, Firefox.**
- **Paylaşım siteleri.** Küçük dikey videoyu (406 × 720, 202 × 360) Instagram / TikTok / YouTube’un
  nasıl karşıladığı (kabul, yeniden ölçekleme, görünür kalite) denenmedi. Bu siteler küçük videoyu
  kendileri büyütür; ama bazılarının en küçük boyut koşulu olabilir.
- **Gerçek çekimler.** Kaynaklar üretilmiş deneme desenleridir.
- **Görsel karşılaştırma.** Aynı içeriğin büyütülmüş ve büyütülmemiş hâlinin oynatıcıda nasıl
  göründüğü (oynatıcının kendi büyütmesi) ölçülmedi; ölçülen piksel sayısı ve dosya boyutudur.

## Kurucuya

1. **“Dikey yap” küçük videodan küçük dikey video verir** (720p’den 406 × 720). Kural gereği doğru;
   paylaşım sitelerinde nasıl durduğu ölçülmedi. İstenirse yalnızca bu sihirbaz için “en az 720
   genişlik” gibi açık bir istisna konabilir — o zaman görüntü 1,8 kat büyütülmüş olur ve bunu
   ekranda söylemek gerekir.
2. **Kaynağından büyük indirme seçeneği yok.** İstenirse “Ayarlar”a açık bir “Büyüt” seçeneği
   eklenir (şemaya bir alan; yanında “netleşmez, dosya büyür” yazısı).
3. **Gömülü altyazıda 360 tabanı** bir büyütme istisnasıdır (360p’nin altındaki kaynaklarda).
