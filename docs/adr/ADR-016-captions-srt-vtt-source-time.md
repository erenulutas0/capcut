# ADR-016 — Altyazı adım 3: SRT/VTT ve kaynağa bağlı satırlar

> Tarih: 2026-09-21 · Durum: KABUL EDİLDİ
> ADR-009 backlog'unun 3. adımı. Şema kararı: ADR-015. Genişletme v2 içinde
> ve geriye uyumlu.

## Karar

### İki saat

Bir altyazı izi iki saatten biriyle çalışır:

| `timeBase` | Satır zamanı neye göre | Anlar yeniden sıralanınca | Aynı bölüm iki kez kullanılınca |
|---|---|---|---|
| `output` | sonuç videosu | satırlar yerinde kalır | satır bir kez görünür |
| `source` (+ `assetId`) | orijinal video dosyası | satırlar görüntüyle birlikte taşınır | satır iki kez görünür |

Kaynak zamanındaki bir satır sonuç videosuna şöyle yerleşir. Bir an kaynağın
`[S, E)` aralığından kesilmiş ve sonuçta `O`'da başlıyorsa, satırın o anın
içine düşen kısmı `O + (t − S)`'te görünür (ADR-009 §Kesme). Anın dışında
kalan kısmı görünmez. Bu eşleme tek bir yerde yapılır:
`domain/captions.ts → outputCues`. Önizleme, render planı, SRT/VTT dışa
aktarma ve zaman şeridi hep bu fonksiyonu kullanır; bu yüzden birbirleriyle
çelişemezler.

### Saat değiştirme (kullanıcı eylemi, tek geri alma adımı)

Saat değiştirilirken şu anki sonuç videosunda görünen şey korunur.

- **Sonuç → kaynak:**
  - Bir kesimin üzerinden geçen satır anlar kadar parçaya bölünür. Anlar
    dosyada art arda geliyorsa parçalar yeniden birleşir.
  - Aynı kaynak anına iki farklı satır düşüyorsa dönüşüm **reddedilir**
    (`caption_conversion_conflict`). Hangisinin kalacağını tahmin etmeyiz.
- **Kaynak → sonuç:**
  - Satırın her görünüşü ayrı bir satır olur.
  - Hiçbir anın göstermediği satırlar düşer ve sayısı bildirilir.
- En kısa satır süresinin altında kalan parçalar uzatılmaz, düşürülür ve
  sayılır.

### SRT/VTT içe aktarma

- **Güvenilmeyen girdi:**
  - Yalnızca zaman ve düz metin alınır.
  - Etiket biçimindeki her şey silinir: `<i>`, `<font>`, `<c.x>`, `<v Ad>`, satır içi zaman damgaları ve `{\an8}` gibi blokları.
  - HTML varlıkları karaktere çevrilir.
  - VTT'deki NOTE, STYLE ve REGION blokları ile satır ayarları yok sayılır.
  - Çıktı hiçbir zaman HTML olarak kullanılmaz.
- **Kodlama:**
  - Önce katı UTF-8 denenir. Geçmezse Windows-1254'e düşülür, çünkü Türkçe
    altyazıların çoğu bu kodlamayla kaydedilir.
  - UTF-16 BOM'u tanınır.
  - Kullanılan kodlama kullanıcıya söylenir.
- **Saat kullanıcıya sorulur:** Dosya orijinal videoya göre mi, sonuç videosuna
  göre mi zamanlanmış? Bu sessizce varsayılmaz (ADR-009).
  `suggestTimeBase` yalnızca zamanlamanın bir seçeneği imkânsız kıldığı
  durumda ipucu verir; kararı her zaman kullanıcı verir.
- **Kurala uymayan her satır atlanır** ve dosyadaki sırasıyla raporlanır.
  Bunlar: boş, çok uzun, çok kısa, ters aralık, çakışan, videoyu aşan satırlar
  ve 500 satırlık sınırı aşanlar. Hiçbir satır sığsın diye uzatılmaz ya da
  birleştirilmez.
  Tek istisna: 3 ve daha fazla satırlık metinde ikinci satırdan sonrası tek
  satırda birleştirilir. Bu da sayılıp bildirilir.
- İçe aktarma mevcut izi değiştirir; stil ve dil korunur. Tek geri alma adımıdır.

### SRT/VTT dışa aktarma

- Sonuç videosunun zamanıyla yazılır (`outputCuesForExport`).
  - Sonun ötesinde kalan satır kesilir, tamamen dışarıda kalan yazılmaz.
  - Milisaniyeye yuvarlanır.
- Biçimler:
  - SRT: CRLF satır sonu, en uyumlu biçim.
  - VTT: LF satır sonu; `<`, `&`, `>` karakterleri kaçışlanır.
- Stil yazılmaz. SRT/VTT stilin her oynatıcıda korunacağını garanti etmez;
  stil yalnızca videoya işlenen altyazıda vardır.

### Toplu kaydırma

`shiftCaptions` bütün satırları aynı miktarda kaydırır; senkron düzeltmesi
içindir. Bir satır saatinin dışına çıkacaksa işlem kırpılmaz, reddedilir.
Kırpmak satırları kenarda üst üste yığardı.

## Ölçüm (M18)

Soru: kaynak zamanlı satırlar, dışa aktarılan MP4'te gerçekten
`O + (t − S)` karelerinde mi görünüyor? Matris vakaları M18 ve M18b bunu
ffmpeg ile ölçer.

**Kurgu.** Kaynak `m01-portrait-20s.mp4` (testsrc; her karede kaynak
saniyesi yazılı). Anlar sırası bozuk ve biri tekrarlı: kaynak [8,12) →
sonuç [0,4), [0,4) → [4,8), [2,6) → [8,12). Çıktı 720×1280, 30 fps, 360
kare. Kaynak satırları: "bir" [1,3), "dokuz" [9,11), iki satırlık
"üç-beş / kesimin iki yanında" [3,5). İz, M17 gibi yedek içe aktarma
yoluyla (`.clip.json`, uygulamanın doğrulamasından geçerek) girer:
`timeBase: 'source'`, `assetId` videonun kimliği, `origin: 'imported'`.

**Beklenti** testte, uygulama kodundan bağımsız olarak formülle hesaplanır:
"dokuz" 1–3 s (kare 30–89), "bir" 5–7 s (150–209), "üç-beş" 7–8 s (210–239,
4 s kesiminde yarım kalan kısım), "bir" 8–9 s (240–269, tekrarlanan aralık,
an başında kesik), "üç-beş" 9–11 s (270–329). Uygulamanın `outputCues`
sonucu ayrıca bununla karşılaştırılır; aynı çıktı.

**Hangi satırın göründüğü nasıl ölçülür.** Yalnızca "altyazı var mı"
yetmez: 150–329 arasında altyazı hiç kesilmez, üç satır art arda gelir.
Her satırın kutusu farklıdır (genişlik metinden, yükseklik satır sayısından).
Kutular uygulamanın `layoutCaption` fonksiyonundan, metin genişliği ise
tarayıcıda, paketlenmiş Inter fontuyla ölçülür (bir 83×64, dokuz 146×64,
üç-beş 378×110 px). Her kare, altyazısız ffmpeg referansıyla karşılaştırılır.
Bir kutunun sol, sağ ve üst kenarının hemen içindeki şerit ile hemen
dışındaki şerit arasındaki ortalama luma farkına bakılır. Karede çizilen
kutu yüksek puan alır; ondan dar ya da geniş kutuların iki şeridi de aynı
tarafta kaldığı için puanı sıfıra yakındır. Değerler aynı karenin içinden
geldiği için encoder gürültüsü birbirini götürür. Eşik 12.

| | Chromium | Chrome | Edge |
|---|---|---|---|
| Planlanan karede planlanan satır: eksik / yanlış satır | 0 / 0 | 0 / 0 | 0 / 0 |
| Planlanmayan karede altyazı | 0 | 0 | 0 |
| Sınır kareleri dahil plandan farklı kare | 0 | 0 | 0 |
| Beş görünüşün ilk–son karesi (plan: 30–89, 150–209, 210–239, 240–269, 270–329) | aynı, sapma 0 | aynı, sapma 0 | aynı, sapma 0 |
| Doğru kutunun en düşük puanı / diğer kutuların en yüksek puanı | 16,57 / 8,47 | 17,24 / 8,93 | 17,24 / 8,93 |
| Altyazısız karelerde en yüksek puan (kenar ya da varlık) | 8,92 | 9,38 | 9,38 |
| Satır dışı kareler, tam kare SSIM (ort. / en düşük, 116 kare) | 0,9415 / 0,9395 | 0,9757 / 0,9751 | 0,9757 / 0,9751 |

M18b'de (sonuç zamanlı iz) aynı satırlar Chromium'da 16,63 / 8,58 ve 8,90;
Chrome ve Edge'de M18 ile aynı değerler çıktı.

**M18b: dönüşüm görüneni değiştirmez.** Aynı kurgu, aynı satırlar bu kez
sonuç zamanında. İz, bağımsız formülle "her görünüş ayrı satır" kuralına
göre kurulur (5 satır) ve yine yedekten girer. Dönüşümün arayüz yolu bu
ölçüm yazılırken henüz yoktu. Ölçüm aynı beklentiye karşı yapıldı ve M18
ile kare kare karşılaştırıldı: Chromium, Chrome ve Edge'de farklı kare 0.

**Negatif kontrol.** Aynı kurgu, altyazı izi olmadan dışa aktarıldı.
360 karenin hiçbirinde altyazı bulunmadı. En yüksek kenar puanı Chromium'da
0,21, Chrome ve Edge'de 0,40; en yüksek varlık farkı 8,87 ve 9,32 oldu (eşik
12). Bu çıktının sırası değişmiş ve tekrarlı referansla SSIM'i ortalama
0,9418 (Chromium) ve 0,9759 (Chrome/Edge); en düşük 0,9395 ve 0,9751. Yani
görüntü de doğru anlardan geliyor.

**Eşik neden 12?** Ölçülen iki düzeyin arasında duruyor. Altyazı olmayan
karelerde en yüksek değer 9,38 (varlık farkı; kenar puanı 0,4'ü geçmiyor).
Başka bir kutunun en yüksek puanı 8,93, doğru kutunun en düşük puanı 16,57.
Eşik alttan 2,6, üstten 4,6 pay bırakıyor. Varlık farkı, kutusu hiçbir
adaya uymayan bir altyazıyı yakalamak için var; o kolda pay daha dar.

Firefox'ta M18 ve M18b UNSUPPORTED oldu: AAC encoder'ı olmadığı için kapı
açıkça reddetti.

İnsan gözüyle bakmak için bir kare:
`web/screenshots/caption-source-anchored-frame.png`. Kare 285, sonuçta
9,5 s; kaynakta 3,5 s. Sayaç "3" gösteriyor, altyazı "üç-beş".

**Ölçüm aracında düzeltilen hata.** `captions.ts` bu adımda `./timeline`'ı
içe aktarmaya başladı. M17'nin yerleşim yükleyicisi ise yalnızca iki dosyayı
Node'a çeviriyordu, bu yüzden M17 `ERR_MODULE_NOT_FOUND` ile düşüyordu.
Yükleyici artık listelenen domain dosyalarının hepsini çeviriyor
(`captions`, `captionLayout`, `timeline`). M17 yeniden üç tarayıcıda PASS
oldu. Uygulama kodunda hata bulunmadı.

**Sınırlar**

- Kimlik ölçümü `box` stilinde yapılıyor. `outline` stilinde düz kenar
  olmadığı için bu yöntem kullanılamaz. Stil zamanlamayı etkilemez, `outline`
  M17'de ölçüldü.
- Kutu genişliği için metin, sayfanın ana iş parçacığındaki canvas ile
  ölçülüyor. Worker ise OffscreenCanvas kullanıyor. Aynı motor ve aynı font
  dosyası; ölçülen kutular çizilenlerle kenar kenar örtüşüyor.
- M18b, dönüşümün sonucunu bağımsız formülle kuruyor.
  `convertCaptionTimeBase` birim testlerde sınanıyor; arayüz yolu gelince
  matris o yoldan da sürülebilir.

## Kapsam dışı

- Transkript ve çeviri (adım 4–5).
- Birden fazla iz.
- Serbest stil ya da SRT'den gelen stil.
- Karaoke.
