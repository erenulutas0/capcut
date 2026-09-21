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

## Kapsam dışı

- Transkript ve çeviri (adım 4–5).
- Birden fazla iz.
- Serbest stil ya da SRT'den gelen stil.
- Karaoke.
