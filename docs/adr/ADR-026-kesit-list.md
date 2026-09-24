# ADR-026 — Kesit listesi: işaretle, ekle, kartından indir

> Tarih: 2026-09-23 · Durum: UYGULANDI (kurucu onaylı tasarım); kaydetme penceresi
> ölçümleri aşağıda. [ADR-019](ADR-019-single-timeline-editing.md)'un tek zaman
> çizgisi akışının ve [ADR-021](ADR-021-input-limit-120min.md)'in "zaman çizgisi
> sınırı ve fazlasını gösterir" kısmının **yerine geçer**. EDL v2 şeması
> **değişmedi** (belge 10): `clips` artık "kesitler"dir.

## Neden

Kurucu, 23 Eylül 2026, tek zaman çizgisi sürümünü denedikten sonra:

> "hala istediğim basitlikte değil … mesela kırpmak istiyorsa kırptığı aralıklar
> bir yere düşsün ve oradan tık tık bakabilsin ve üzerlerinde indirme sembolü
> olsun. Mesela şimdi aralık ekle diyorum, o aralık sona ekleniyor, sonra videonun
> diğer bölümlerini çıkarıp sağ üstten videoyu indir yapıyorum, daha sonra
> indiriyorum. Ayrıca videoyu tam ekran yapıp izleme olasılığı da sağlayalım."

ADR-019'da video açılınca bütünü tek parça olarak zaman çizgisine konuyordu;
kullanıcı istemediği yerleri bölüp siliyordu. İki saat vardı (kaynak ve sonuç),
iki önizleme modu (Kaynak / Sonuç) ve ayrı bir "Videoyu indir" penceresi. Kurucunun
tarif ettiği model tersidir: **istediğin aralığı işaretle, listeye düşsün, her
birini ayrı indir ya da hepsini birleştirip indir.**

## Karar

| Konu | Karar |
|---|---|
| Birim | **Kesit** (İngilizce "clip"). "Parça" ve "an" arayüzden kalktı. Şemada `clips` = kesitler, sırası birleştirilmiş indirmenin sırasıdır. |
| Video açılınca | Hiçbir şey otomatik eklenmez. Önizleme, altında **videonun tamamını** gösteren şerit, Başlangıç/Bitiş alanları ve boş "Kesitler" listesi. |
| Saat | **Tek saat: videonun kendi zamanı.** Kaynak/Sonuç sekmesi, çıktı zaman çizgisi ve çıktı saati yok. |
| İşaretleme | Başlangıç (I, düğme, alan), Bitiş (O, düğme, alan), şeritte bekleyen aralık vurgulu; tutamaçlarla sürüklenebilir. Son işaret, çelişen diğer ucu düşürür (Bitiş'ten sonraya Başlangıç koyarsan Bitiş silinir; sessiz yer değiştirme yok). |
| Kesit ekle | "Kesit ekle" (Enter). Kesit listenin **sonuna** düşer: küçük resim, başlangıç → bitiş, süre, numara. Bir geri alma adımı. Geçersiz aralık eklenmez; nedeni sabit yükseklikli bildirim satırında söylenir. |
| Kart | ▶ yalnız o aralığı oynatır (oynatma çizgisi oraya atlar, bitişte durur); ⬇ yalnız o kesiti indirir; ✕ siler (geri alınabilir). Karta tıklamak seçer: alanlar ve şeritteki tutamaçlar o kesiti ince ayarlar ("Bitti" / Escape ile çıkılır). Sıra: tutamaçla sürükleme ya da tutamaç odakta ↑/↓/Home/End; sıra yalnızca birleştirilmiş indirmeyi etkiler. |
| Sağ üst düğme | 0 kesit: **"Videoyu indir"** (videonun tamamı). 1 kesit: **"Kesiti indir"** (o kartın ⬇'ı ile aynı). ≥ 2 kesit: **"Hepsini birleştirip indir"** (dar ekranda "Hepsini indir"). |
| Şerit | Videonun tamamı; kesitler renkli ve numaralı bölgeler, oynatma çizgisi, bekleyen aralık. Yakınlaştırma: −/+/"Tümü" düğmeleri, Ctrl/⌘ + tekerlek, iki parmakla sıkıştırma; yatay kaydırma; oynatma çizgisi görünür tutulur. Oynatma çizgisi odaktayken ←/→ 1 kare, Shift ile 1 sn, Home/End. En fazla yakınlaştırma: ekranda 10 sn. |
| Tam ekran | Önizlemede ⛶ düğmesi ve F tuşu; Fullscreen API önizleme kutusuna uygulanır. Tam ekranda kendi denetimleri: oynat/duraklat, zaman, arama çubuğu, çıkış (Escape de çıkar). `document.fullscreenEnabled` yanlışsa düğme hiç çizilmez. |
| Ayarlar | "Ayarlar" düğmesi, eski sağ paneli (Görüntü / Ses / Altyazı sekmeleri) masaüstünde yan çekmecede, telefonda alttan açılan sayfada açar. Başlık: "Ayarlar · her indirmeye uygulanır". Çıktı kalitesi (1080p/720p) de burada, Görüntü sekmesinde. Çerçeve ve video sesi bütün kesitlere birlikte uygulanır (kesit başına ses ayarı kaldırıldı). |
| Diğer (⋯) | Başka video aç, Sessizlikleri bul, yedek dosyası, yardım; telefonda proje adı da burada. |
| Sessizlikleri bul | Diğer menüsünde. 0 kesit: tüm videoda arar, **kalan bölümler kesit olur**; seçili kesit varsa o kesitte, yoksa bütün kesitlerde. 20 kesit sınırı içinde, tek geri alma adımı. |
| Birden fazla kaynak | **Yapılmadı.** Uygulama W0'dan beri tek kaynaklıdır (worker tek `videoFile` alır). Politika satırı (5 video kaynağı) değişmedi; arayüz çoklu kaynağı engellemeyecek biçimde (kesit = kaynak + aralık) kuruldu ama çoklu kaynak ekleme yolu yok. |

### İndirme: kaydetme penceresi, doğrudan dosyaya

- ⬇'a basınca `window.showSaveFilePicker` **tıklamanın içinde, hiçbir `await`'ten
  önce** çağrılır (kullanıcı etkileşimi kaybolmasın). Önerilen ad:
  `tatil_00-12-01-40.mp4` (tek kesit, başlangıç–bitiş), `tatil_3-kesit.mp4`
  (birleştirilmiş), `tatil_tamami.mp4` (tüm video). Ad kaynağın adından gelir:
  harf, rakam, `-` ve `_` kalır; boşluk `-` olur; boş kalırsa `video`.
- Pencerede **Vazgeç = hiçbir şey olmaz** (durum yok, kodlama yok, dosya yok).
- Seçilen dosya tutacı worker'a gider; kodlayıcı **doğrudan o dosyaya** yazar
  (`createWritable({ keepExistingData: false })`, konumlu
  `write({ type: 'write', position, data })`). Önce tahmini boyut kadar yer
  `truncate()` ile ayrılır (ADR-023'ün aynısı), sonunda gerçek boya kesilir.
  İptal ya da hata: `abort()` — seçilen ad altında yarım video kalmaz; pencerenin
  oluşturduğu boş dosya da silinir. Kullanıcı var olan bir dosyayı seçip
  "değiştir" derse Chrome ve Edge o dosyayı **pencerede hemen boşaltır**
  (ölçüldü, aşağıda D): eski içerik ilk kareden önce gider; iptal ya da hatada
  boş dosya silinir.
- İlerleme kartın (ya da üst düğmenin) altında, gerçek kare sayısıyla ve "İptal
  et" düğmesiyle. Bitince **"Kaydedildi: tatil_00-12-01-40.mp4"** ve yöntem satırı:
  "Kodlandı" ya da (paralel çalışan hızlı yol eklendiğinde) "Hızlı kesim — yeniden
  kodlanmadı" / "Hızlı kesim — yalnızca kesim yerleri yeniden kodlandı".
  Ayrıntılar (süre, çözünürlük, codec, boyut, yazıldığı yer) üretilen dosyanın
  yeniden açılıp ölçülmesinden gelir (ADR-010).
- **Pencere yoksa** (Firefox, Safari, eski tarayıcı): eski yol — OPFS'e (yoksa
  belleğe) kodlanır, sonra "Bilgisayara kaydet" bağlantısı ve boş yer notu.
- **Uygunluk kapısı** (ortam → kodlayıcı ayarı → deneme dosyası → kaynak → rota)
  artık ayrı pencerede aşama aşama çizilmez: video açılınca ve planın şekli
  (boyut, bit hızı, altyazı yazı tipi, dosyalar) değişince arka planda bir kez
  çalışır ve oturum boyunca saklanır. ⬇ geçmiş kapı sonucunu kullanır; kapı
  geçmediyse kodlamadan önce engeller listelenir.
- **Paralel "hızlı kesim" işi ile sözleşme:** istek isteğe bağlı bir alan
  (`mode` gibi) taşıyabilir; başarı sonucunda `method: 'copy' | 'smart' | 'encode'`
  (`ExportResult.method`). Hedef dosya, worker içindeki başka bir yolun da
  kullanabileceği bir sink arayüzü (`prepareOutput` → `PreparedOutput`:
  `target`, `collect`, `discard`, `refused`) ve ortak ret yardımcısı
  (`sinkRefusal`) üzerinden açılır. `method` gelmeyen sonuç kodlama yolundan
  gelmiştir ve "Kodlandı" gösterilir.

### Sınırlar (politika `2026-09-23.v5`, değişmedi)

Girdi 120 dakika / 4 GiB / 5 video kaynağı / 20 kesit. **Her indirme ayrı ayrı**
çıktı sınırına tabidir: diske yazılan yolda (seçilen dosya ya da OPFS) 60 dakika,
bellek yolunda 5 dakika; ADR-021'in kapı metinleri indirme başına söylenir
(kesit için "Kesit {uzunluk}. İndirmek için en az {fazlası} kısalt — sınır
{sınır} dakika."; birleştirilmiş indirme ve tüm video için kendi metinleri),
kodlamadan önce.

- **60 dakikadan uzun bir kesit:** eklenebilir (kullanıcı onu sonra kısaltabilir
  ya da içinden daha kısa kesitler çıkarabilir); kartında uyarı görünür, ⬇
  kodlamadan önce ne kadar kısaltılması gerektiğini söyleyip reddeder.
- **Tüm video 60 dakikadan uzunsa** "Videoyu indir" aynı biçimde reddeder.
- Tarif doğrulamasının süre kuralı değişmedi: kesitlerin toplamı en fazla
  120 dakika ("Kesitlerin toplamı en fazla 120 dakika olabilir."), 21. kesit
  eklenmez.

### Altyazılar

- **Görüntüye bağlı** (kaynak zamanlı) satırlar kesitleri izler: bir kesit
  indirilince o kesitteki satırlar gelir; aynı aralık iki kesitte varsa iki kez.
- **Sonuca bağlı** (çıktı zamanlı) satırların anlamı: birleştirilmiş indirmenin
  zamanına göre yazılmışlardır. Tek kesit indirilirken o kesitin birleştirilmiş
  sonuçtaki dilimi alınır ve 0'a kaydırılır (kenardan taşan satır kırpılır);
  tüm video indirilirken zamanlar olduğu gibi kalır. Önizlemede tek saat video
  zamanı olduğu için sonuca bağlı satırlar kesit eşlemesiyle gösterilir.
- Video varken **yeni eklenen iz görüntüye bağlıdır** (tek saatle doğal olan bu).

### Müzik

Her indirme müziği kendi başından başlatır (müzikteki başlangıç ve "videoda
başlayacağı yer" ayarları indirmenin zamanına göre). Kesitin ▶'ı da müziği aynı
biçimde, kesitin başından itibaren çalar.

### Geçiş (eski projeler)

Şema değişmediği için eski proje ve yedek dosyaları olduğu gibi açılır. ADR-019'da
otomatik konan "tam video" parçası tek kesit olarak görünür; kullanıcı onu silip
kendi kesitlerini ekleyebilir. Sonuca bağlı altyazı izleri korunur ve yukarıdaki
anlamla indirilir. 0 kesitliyken ayarlanan çerçeve ve ses ("serbest ayarlar")
editörde tutulur, tüm video indirmesine uygulanır ve ilk kesite kopyalanır; tarif
kesit içermediği için bu değerler kaydedilmez ve geri alma geçmişine girmez.

## Ne kaldırıldı

- Arayüz: Kaynak/Sonuç önizleme sekmeleri; çıktı zaman çizgisi (`OutputStrip`);
  Böl (S) ve zaman çizgisinde Sil; açılışta videonun otomatik tek parça olarak
  konması ve onun geri alma adımı; sol "Parçalar" paneli (`LeftPanel`) ve aralık
  formu (`RangeEditor`) — yerini `MarkBar` + `KesitList` aldı; "Videoyu indir"
  penceresi (`ExportDialog`, aşama aşama kapı satırları, ayrı "Oluştur" düğmesi,
  `useExport`); telefon alt sekme çubuğu; kesit başına ses seviyesi/sessiz.
- Alan kodu: `splitClip`, `splitAtTimelinePlayhead`, `addWholeSource`,
  `setClipGain`, `setClipMuted`, `splitPointAt` ve bölme ret kodları;
  `timelineEdit.ts`'teki çıktı zamanı yardımcıları (`initialPlacement`,
  `pieceAtOutput`, `outputStartOf`, `playheadAfterRemoval`, `floorAfterEdit` …).
- Metinler: 116 anahtar her dilde (`timeline.*`, `moments.*`, `split.*`, `trim.*`,
  Kaynak/Sonuç önizleme, dışa aktarma penceresi, `export.blocked.*`); ~59 metin
  "parça → kesit", "sonuç → birleştirilmiş" diye değişti.
- Testler ve scriptler: `timeline.spec.ts`, `trim-split.spec.ts`, `rangeFlow.ts`,
  `scripts/lib/range-flow.mjs`, `caption-screenshots.mjs`,
  `caption-srt-screenshots.mjs` (yerine `scripts/screenshots.mjs` kesit
  ekranlarını üretir).

## Tıklama sayısı (fare; video zaten açık)

"Tıklama" = şeride tıklayarak oynatma çizgisini taşıma dahil her fare basışı.

| Görev | ADR-019 (tek zaman çizgisi) | ADR-026 (kesit listesi) |
|---|---|---|
| Bir aralığı kesip kaydet | 11: şeride tıkla, Böl, şeride tıkla, Böl, baştaki parçayı seç, Sil, sondakini seç, Sil, Videoyu indir, Oluştur, Bilgisayara kaydet | **7**: şeride tıkla, Başlangıç, şeride tıkla, Bitiş, Kesit ekle, ⬇, penceredeki Kaydet |
| Üç aralığı kesip birleştirilmiş kaydet | 23: 6 × (şeride tıkla + Böl), 4 × (seç + Sil), Videoyu indir, Oluştur, Bilgisayara kaydet | **17**: 3 × (şeride tıkla, Başlangıç, şeride tıkla, Bitiş, Kesit ekle), Hepsini birleştirip indir, Kaydet |

Klavyeyle (I, O, Enter) yeni akışta aralık başına fare basışı yalnızca iki
şerit tıklamasıdır. ADR-019'da "Bilgisayara kaydet" tarayıcının indirme
klasörüne yazıyordu (ad sorulmadan); yeni akışta son tık, kullanıcının yeri ve
adı seçtiği pencerenin Kaydet düğmesidir — dosya doğrudan oraya kodlanır, ikinci
bir kaydetme adımı yoktur.

## Kaydetme penceresi ölçümleri

Script: `web/scripts/measure-save-picker.mjs` (kurulu Chrome/Edge, gerçek
Windows kaydetme penceresi; pencere UI Automation ve pencere mesajlarıyla
doldurulur, `scripts/lib/fill-save-dialog.ps1` — tuş vuruşu gönderilmez).

Kaynak: `tests/media/timeline/portrait-110s.mp4` (1:50, dikey), kesit yok →
"Videoyu indir", 1080p. Klasör 50 ms'de bir örneklendi. Chrome 153.0.8010.53 ve
Edge 153.0.4234.48, aynı Windows 11 makinesinde; iki tarayıcıda sonuçlar aynı
(süre ±1 sn).

| Durum | Ne görüldü | Diskte en çok | Sonuç dosyası |
|---|---|---|---|
| **A — yeni dosya** | Pencere 0 baytlık `yeni-dosya.mp4` oluşturur. Yazıcı açılınca yanında `yeni-dosya.mp4.crswap` belirir, hemen **114,6 MiB** (uygulamanın yer ayırması = tahmin × 1,1 + 32 MiB). Kodlama o dosyaya yazar; `close()`'da takas dosyası adın üstüne taşınır (kopya yok: ikisi hiçbir örnekte birlikte dolu görünmedi). 17,5 sn (Chrome) / 16,5 sn (Edge). | 114,6 MiB (sonucun 1,52 katı; tamamı ayırma) | 75,56 MiB, "Kaydedildi: yeni-dosya.mp4" |
| **B — var olan 200 MiB dosyanın yerine** | Windows "Farklı Kaydetmeyi Onayla" sorar (evet). Takas dosyası belirdiğinde eski dosya artık 200 MiB **değil**: en yüksek toplam eski dosyanın kendisi (200 MiB), takas + eski hiçbir örnekte birlikte görülmedi. | 200 MiB (eski dosya), sonra 114,6 MiB | 75,56 MiB |
| **D — B + hemen iptal** | Kodlama görünür görünmez "İptal et". Seçimden hemen sonra dosya **0 bayt** (tarayıcı "değiştir"de boşalttı). İptalde takas atılır, uygulama boş dosyayı siler. | 200 MiB (seçimden önce) | yok (klasör boş) |

Sonuç: **çift alan gerekmez.** Takas dosyası hedefle aynı klasörde durur ve
kapanışta yeniden adlandırılır; en çok alan, uygulamanın kendi yer ayırmasıdır
(tahmin × 1,1 + 32 MiB). Var olan dosyanın yerine yazarken eski dosya pencerede
boşaltıldığı için eski + yeni birlikte yer kaplamaz — ama bu, "değiştir"e
basıldığı anda eski dosyanın gittiği anlamına gelir (iptal edilse bile). Bu
tarayıcının davranışı; uygulama değiştiremez, yalnızca boş kalan dosyayı temizler.

Otomasyon notu: ilk A denemesinde pencere doldurma yarışı kaybedildi (dosya
seçilmedi, uygulama bekledi); ikinci denemede ve sonraki bütün koşularda çalıştı.
Chrome, `AppData\Local\Temp` altındaki bir klasöre kaydetmeyi reddeder (seçim
sessizce `AbortError` olur; uygulama bunu "Vazgeç" gibi karşılar, hiçbir şey
başlamaz).

**C — Diskte yer yokken (yer ayırma).** Gerçek bir diski doldurmadan ölçüldü:
seçilen dosyanın yazıcısında `truncate()` boş alandan büyük bir boyut istedi
(E: sürücüsünde 784 GiB boşken boş alan + 16 GiB ve 2 TiB). Chrome ve Edge'de
sonuç aynı:

| İstenen | Sonuç | Süre |
|---|---|---|
| 10 MiB (kontrol) | başarılı | 1 ms |
| boş alan + 16 GiB | `InvalidStateError` ("…state had changed since it was read from disk.") | 1 ms |
| 2 TiB | `InvalidStateError`, aynı metin | 0 ms |

Hata sonrası yazıcı kullanılamaz (sonraki `write` de `InvalidStateError`),
`abort()` başarılı, geride `.crswap` kalmaz; pencerenin oluşturduğu 0 baytlık
dosya kalır (uygulama bunu `remove()` ile siler). Yani disk doluluğu
`QuotaExceededError` olarak **değil**, genel bir `InvalidStateError` olarak gelir.
Uygulama bu yolda `truncate` hatasını "yer yok" diye okur
(`output_storage_insufficient`, neden `file_reservation`): "Seçtiğin yerde bu
video için yaklaşık {gereken} boş yer gerekiyor; o diskte bu kadar yer yok.
Başka bir disk seç ya da yer aç; hiçbir kare kodlanmadı." Yer ayırma
başarılıysa kodlama sırasında disk dolması beklenmez; kodlamanın ortasında gerçek
bir disk dolduğunda yerel dosyanın ne fırlattığı **ölçülmedi** (gerçek diski
doldurmak gerekir): `QuotaExceededError` gelirse "diskte yer kalmadı", başka bir
hata gelirse genel hata gösterilir, her iki durumda geçici dosya atılır.

## Test edilen

⟨sayılar buraya⟩

## Test edilmeyen

- **Gerçek kullanıcı testi yok.** Kurucunun tarifine göre kuruldu; kesit
  kelimesi, ⬇ simgesi ve "Hepsini birleştirip indir" etiketinin anlaşılırlığı
  varsayımdır. Beta kullanıcı testi kiti buna göre güncellendi.
- **Gerçek dokunmatik cihaz ve gerçek ekran okuyucu yok** (ADR-019 ile aynı
  sınır): 390 px testleri Chromium'da CDP dokunma olaylarıyla; adlar ve
  duyurular erişilebilirlik ağacında doğrulandı, NVDA/VoiceOver ile dinlenmedi.
- Tam ekran yalnızca Chromium'da (Playwright) denendi; iOS Safari'de öğe tam
  ekranı desteklenmez ve düğme orada çizilmez (varsayım: `fullscreenEnabled`
  yanlış döner — cihazda denenmedi).
- Kaydetme penceresi yalnızca Windows'ta, Chrome ve Edge'de; macOS/Linux
  pencereleri denenmedi. Firefox/Safari'de pencere yoktur; o yol e2e'de
  pencere API'si kaldırılarak sınandı.
- Birden fazla kaynak: yapılmadı (yukarıda).
