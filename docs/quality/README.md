# Kalite ölçüm katmanı

> Durum: 10 Ekim 2026'da kuruldu. Kurucunun sözüyle: "şu an tester'im yok; kalitesini kendimiz
> test edip analiz edecek mekanizmalar yazalım."
> Bu katman bir kullanıcı testinin **yerine geçmez**; onun yokluğunda, ölçülebilen şeyleri her
> seferinde aynı biçimde ölçer ve tek bir rapora yazar. Neyi ölçemediği en altta.

## Ne üretir

`npm run quality` (klasör: `web/`) şunları yazar:

| Dosya | Ne |
|---|---|
| `docs/quality/latest.md` | Okunacak rapor: bulgular, özet, dokuz bölüm, tablolar |
| `docs/quality/latest.json` | Aynı ölçüler, makinenin okuyacağı biçimde (her ölçü: değer, bütçe, durum) |
| `docs/quality/history.jsonl` | Her koşudan bir satır: tarih, commit, başlık sayıları. Geriye gidiş buradan görülür |
| `docs/quality/diffs/` | Yalnızca bir ekran tabanından farklı çıktığında: fark resimleri |
| `docs/quality/bulgular.md` | **Elle yazılır.** Ölçümlerin gösterdiği en önemli sorunlar; rapor bunu en üste koyar |

Doğruluk testleri (vitest, e2e, dışa aktarma matrisi, axe) ayrıdır ve yerinde durur. Onlar "çalışıyor
mu" diye sorar; bu katman "ne kadar iyi" diye sorar ve bir sayı verir.

## Nasıl çalıştırılır

```
cd web
npm run quality                               # hepsi (yazıya dökme: yalnız kayıtlı sayılar)
npm run quality -- --only=search,text         # yalnız bazı bölümler (tarayıcısız olanlar birkaç saniye)
npm run quality -- --skip=output,errors       # bazıları hariç
npm run quality -- --no-build                 # out/ ve .next/ yerindeyse yeniden derleme
npm run quality -- --with-transcript          # gerçek modeli de koş (public/models gerekir)
npm run quality -- --update-baselines         # ekranların bugünkü hâlini taban kabul et
npm run quality -- --report-only              # ölçmeden, son sonuçlardan raporu yeniden yaz
npm run quality -- --no-history               # history.jsonl'a satır ekleme (deneme koşuları)
npm run quality -- --no-gate                  # bütçe aşılsa da 0 ile çık
npm run quality -- --only=output --grep=kes-goruntu   # bir bölümün tek ölçümü (ötekilerin sonucu kalır)
```

`--report-only` ölçüm yapmaz: sayılar son ölçüm koşusunundur ve rapor başlığı o koşunun tarihini ve
commit'ini söylemeye devam eder. Bulgular (`bulgular.md`) düzeltildikten sonra raporu yeniden yazmak içindir.

Bölüm adları: `walkthrough`, `search`, `errors`, `honesty`, `output`, `transcript`, `perf`, `visual`,
`a11y`, `text`.

Gerekenler: Node 20, `npm ci`, Playwright'ın Chromium'u (`npx playwright install chromium`), ffmpeg ve
ffprobe (yolda). VMAF yalnızca yerel ffmpeg libvmaf ile derlenmişse ölçülür; betik bunu sorar,
varsaymaz.

**Bulut yazıya dökme yolu (ADR-039; 11 Ekim 2026).** Yol yayındaki sitede yoktur; ama rıza ekranı
ve akışı ölçülür: `walkthrough` bölümü, yolun açık olduğu test kancalı bir derlemeyi **yerel sahte
Worker'a** (`cloud/fake-worker/`, 127.0.0.1:38197) karşı yürütür (`walkthrough-yazi-bulut.spec.ts`)
ve ekranlarını tabanlarla karşılaştırır (`yol-yazi-bulut-*`). Rapor bu satırları **"sahte
sunucuya karşı"** diye etiketler: akışı, okunacak kelimeyi, sade dili, giden şeyin tek bir ses
dosyası olduğunu ve sunucuda kayıt kalmadığını ölçer; **yazının doğruluğu ya da gerçek sunucunun
hızı hakkında hiçbir şey söylemez.** Bulut cümleleri (`cloudMessages.ts`) okunabilirlik ölçümüne
de girer. Hiçbir dış hizmete istek atılmaz. `.next/` tek sunucu derlemesi tutar: betik önce bulut
derlemesini, sonra olağan test kancalı derlemeyi yapar (koşu sonunda `.next/` olağan e2e
derlemesidir) ve hangisinin durduğunu `.next/quality-build.txt`'ye yazar; `--no-build` yanlış
derlemeyi kullanmaz, yeniden derler.

**Süre** (bu makinede, 10 Ekim 2026; 12 çekirdek, 64 GB): iki derlemeyle birlikte toplam yaklaşık 9 dakika,
kilit beklemesi hariç. En uzun bölümler çıktı kalitesi ve yükleme ölçümleri (ikişer dakika), sonra hata
yolları (80 hücre) ve yürüyüşler (birer dakika). `search` ve `text` tarayıcı açmaz, birer saniye sürer.

**Kilit ve port.** Tarayıcılı bölümler makine genelindeki ölçüm kilidini alır
(`web/scripts/lib/measure-lock.mjs`): aynı anda tek bir ağır koşu olur, hız ve LCP sayıları başka bir
koşunun yüküyle bozulmaz. Kilit başkasındaysa betik bekler. Sunucu 3195 numaralı portta açılır
(`QUALITY_PORT` ile değişir), önce o portta kalmış eski bir dinleyici varsa kapatılır, koşu bitince
sunucu da kapanır.

**Hiçbir şey makineden çıkmaz.** Sunucular 127.0.0.1'dedir; medya ffmpeg ile üretilir ya da depodaki
haklı örneklerdir (`web/tests/media/`). Kurucunun kendi videoları (`web/tests/media/real/`)
kullanılmaz.

## Hangi derleme ölçülür

| Derleme | Nasıl | Hangi bölümler |
|---|---|---|
| **Statik çıktı** — insanların aldığı şey | `STATIC_EXPORT=1 npm run build` → `out/`, `serve-static.mjs --gzip` ile sunulur (GitHub Pages gibi) | Hepsi; aşağıdaki tek satır dışında |
| **Test kancalı** — hiçbir zaman yayınlanmaz | `CLIP_TEST_HOOKS=1 npm run build` → `.next/`, `next start` | Yalnızca "Yazıya dök" akışının baştan sona yürünmesi |

"Yazıya dök"ün gerçek modeli 109 MB'tır ve depoda yoktur. Akışın (tıklama, ekran, kelime, dosyanın
çıkması) baştan sona ölçülebilmesi için o tek satır, küçük bir model listesi ve **konuşmayı duymayan**
betikli bir tanıyıcıyla koşulur. Rapor bu satırları ayrı bir tabloda, büyük harfle işaretler. Yazı
kalitesi olarak hiçbir yerde sunulmaz.

Statik çıktı kök yolda derlenir (`/`), yayındaki site `/capcut/` altındadır. Alt yolun bozduğu şeyleri
ayrı bir test yakalar (`web/tests/pages/`, CI'da).

## Bölümler: ne ölçülür, ne anlama gelir

### 1. Görev tamamlama yürüyüşleri (`walkthrough`)

Betikli bir "ilk kez kullanan" (`web/tests/quality/lib/novice.ts`) ana ekrandan başlar, on kartın her
biri için işi küçük bir deneme videosuyla bitirir ve gerçek bir dosya alır. Kural: yalnızca **görünen
ve adıyla bulunabilen** düğmelere basar (rol + erişilebilir ad), test kimliği kullanmaz. Bir adım adıyla
bulunamazsa bu bir bulgudur; betik not eder ve ölçümün geri kalanı için test kimliğiyle devam eder.

Görev başına: tıklama sayısı, yazılan alan sayısı, karar ekranı sayısı (bir seçim sunan ya da videonun
dışında bir şey isteyen ekran), ekran sayısı, ekran başına ve toplam görünen kelime (okuma yükü),
karttan dosyaya süre, varsayılan yolda görülen teknik terimler, konsol hataları — masaüstünde ve telefon
görünümünde. Çıkan dosya ffprobe / ffmpeg ile denetlenir: süre, izler, boyut, göreve özgü denetimler
(Dikey yap 1080 × 1920 mi, Sesini al'da yalnızca ses mi, İyileştir'de görüntü aydınlandı mı…). Dosya
kartın söz verdiği gibi değilse görev "tamamlandı" sayılmaz.

Sayılmayanlar: sistemin dosya seçme penceresi ve (masaüstünde) kaydetme penceresi — bunlar uygulamanın
değil sistemin tıklamalarıdır. Telefonda kaydetme penceresi yoktur; "Kaydet" tıklaması sayılır.

Teknik terim listesi küçüktür ve tartışmaya açıktır: `web/tests/quality/lib/jargon.ts`.

### 2. Arama kalitesi (`search`)

"Yaz, bulalım" kutusuna bir çocuğun ya da ilk kez kullananın yazabileceği ifadeler: Türkçe, İngilizce,
yazım hatalı, Türkçe harfsiz ("kucult"), argo, uzun cümle; uygulamanın yapamadığı işler; hiçbir kaydın
tarif etmediği istekler; anlamsız yazı. Küme: `web/tests/quality/data/search-eval.ts`.

**Ayar / ayrı tutma kuralı.** Ayrı küme ölçümdür; arama (`web/src/domain/taskSearch.ts`, `tasks.ts`) onun
üzerinde ayarlanmaz — kaçanlarına bakıp kural ya da kelime eklenmez. Bunu yapan, sayıyı bir daha
kullanılamaz hâle getirir ve yeni bir küme yazdırmak zorunda kalır. Ayar için `DEV` kümesi vardır. Ayar
tablolarındaki (`web/tests/unit/taskSearch*.test.ts`) ve `DEV`'deki ifadeler otomatik olarak sayım dışı
bırakılır.

11 Ekim 2026'dan beri beş küme var ve rapor hangisinin ne olduğunu her seferinde yazar:

| Küme | Dosya | Ne |
|---|---|---|
| **Yeni ayrı küme** — başlık ve bütçeler | `search-eval-fresh3.ts` | Kendisine YALNIZCA işlerin listesi ve birer satırlık açıklamaları (ve yapılamayanların listesi) verilen ayrı bir yazar (bir alt ajan) yazdı: aramanın kodunu, kelime listelerini, eminlik eşiklerini ve öteki ifadeleri görmedi. Yazarın JSON çıktısı, yalnızca sayım basan bir betikle veri dosyasına çevrildi; ölçümden önce ifadeleri kimse okumadı. Eminlik kuralı dondurulduktan (commit `fd6ce81`) sonra bir kez ölçüldü. Kaçanları raporda yazılı olduğu için bir sonraki arama çalışmasında bu da görülmüş sayılır. |
| İkinci yeni küme | `search-eval-fresh2.ts` | 10–11 Ekim raporlarının başlığıydı. Kaçanları raporda yazılıydı ve eminlik kuralı bu kümeye de bakılarak ayarlandı: **artık ayar kümesi.** |
| İlk yeni küme | `search-eval-fresh.ts` | Aynı biçimde yazıldı, bir kez ölçüldü, sonra kaçanları okunup arama ona göre değiştirildi: ayar kümesi. |
| Eski ayrı küme | `search-eval.ts` → `HELD_OUT` | **Kirlenmiş:** kaçanları arama değiştirilmeden önce okundu. |
| Geliştirme kümesi | `search-eval.ts` → `DEV` | Üzerinde ayar yapılır. |

**Yeni bir ayrı küme nasıl yazdırılır:** yazan kişi (ya da ajan) `web/src/`, `web/tests/` ve `docs/` altını
açmamalı, aramayı çalıştırmamalı; ona yalnızca on işin ne yaptığı, yapılamayanların listesi ve yazış
biçimleri (Türkçe, harfsiz, yazım hatalı, argo, uzun cümle, İngilizce; kısa ve açık olanlar `kolay`
etiketiyle) verilir. Küme, arama değiştirilmeden ÖNCE ya da değişikliği görmeden yazılır; çıktısı
ifadeleri göstermeyen bir betikle dosyaya çevrilir; değişiklik dondurulduktan sonra bir kez ölçülür.

**İki sunuş, bu yüzden dört ek sayı (11 Ekim 2026).** Arama emin olduğunda tek bir işi cevap diye
sunar (satırı seçilidir, Enter başlatır); emin olmadığında “Bunu mu demek istedin?” diye 1–3 seçenek
sorar, hiçbiri seçili değildir. Sayılar (`web/tests/quality/lib/searchEval.ts`):

- **yanlış ama emin** — TEK bir iş cevap diye sunuldu ve başka iş yapıyor (en pahalı hata; bütçe ≤ %5).
  Seçenek olarak sorulan yanlış iş burada sayılmaz: kullanıcı gönderilmedi, soruldu.
- “Hep sor” bu sayıyı sıfırlardı. Bunu kapatan dört sayı: **sorma oranı** (yapılabilen işlerde; bütçe
  ≤ %33), **sorduğunda doğru iş seçeneklerde** (bütçe ≥ %80), **açık yazılmış isteğe soru** (yeni kümenin
  `kolay` etiketli ifadeleri; bütçe ≤ %15) ve ayar kümesinde aynı şey (`DEV`; bütçe ≤ %12).
- **doğrudan doğru** (tek cevap ve doğru iş), **yeniden yazmadan varıldı** (doğrudan ya da seçeneklerden),
  **ilk satır doğru iş** (cevap ya da ilk seçenek olarak — önceki raporların “ilk sonuç doğru”su; sıralama
  değişmediği için o sayılarla karşılaştırılabilir), ilk üçte var.
- “Bunu henüz yapamıyoruz.” için yakalama ve isabet; listede olmayan isteğe ve anlamsız yazıya dürüst cevap.

Kaçanlar tabloda: ifade → beklenen → çıkan (“soruldu, doğrusu seçeneklerde” de kaçan sayılır: doğrudan
cevap değildir).

### 3. Hata yolları (`errors`)

On sihirbazın her birine sekiz tür sorunlu dosya verilir: video olmayan dosya, sıfır bayt, rastgele
baytlar, yarıda kesilmiş MP4, yalnızca ses, sesi olmayan video, sınırın üstünde boyut, sınırın üstünde
süre. Ekranda görülen metin kelimesi kelimesine kaydedilir ve her hücre **iyi / belirsiz / bozuk**
olarak sınıflanır; kurallar raporda ve `web/tests/quality/errors.spec.ts` başında yazılıdır. Sınıflama
kabadır (bir mesajın "ne yapılacağını söylediği" bir fiil listesiyle anlaşılır); bu yüzden metnin kendisi
de tablodadır — son sözü okuyan söyler.

Sınır üstü durumlarda dosyanın boyutu ve süresi yalnızca test sayfasının içinde büyük gösterilir
(`File.prototype.size` ve `HTMLMediaElement.prototype.duration` üzerinde, test tarafından kurulan bir
okuyucu). Üretim kodu bunun için değiştirilmedi.

### 4. Dürüstlük denetimleri (`honesty`)

- İlerleme çubuğu 40 ms'de bir örneklenir: geri gidiyor mu, dosya yokken %100'de bekliyor mu.
- "Kaydedildi" göründüğü anda dosya orada mı, boş değil mi, ffprobe okuyabiliyor mu.
- "İptal et" gerçekten durduruyor mu, sayfanın deposunda (OPFS) bir şey kalıyor mu — kaydetme pencereli
  ve penceresiz iki yolda.

e2e paketinin zaten kanıtladıkları yeniden ölçülmez; rapor onları test adıyla **anar**
(`web/scripts/quality/citations.json`) ve adın dosyada hâlâ durduğunu denetler. O testlerin geçtiği
iddia edilmez: e2e paketini bu betik koşmaz.

### 5. Çıktı kalitesi (`output`)

Kes, Küçült, Dikey yap ve Her yerde açılsın için, ffmpeg / ffprobe ile:

- **Ses–görüntü eşzamanı:** `web/scripts/lib/av-sync.mjs` klibi (beyaz kare + o karede başlayan ses);
  hem H.264 MP4 hem VP9 WebM olarak (ikincisinde her iş yeniden kodlamak zorundadır).
- **Süre hatası:** çıkan süre eksi istenen süre.
- **Görüntü sadakati:** SSIM, PSNR ve (varsa) VMAF — aynı düzenlemenin yalnızca ffmpeg ile yapılmış
  kayıpsız referansına karşı, kaynağın boyutunda (düşük çözünürlüğe inen bir dosya bunun bedelini
  sayıda öder).
- **Küçült:** dosya hedefe sığdı mı, hedefin ne kadarını kullandı.
- **Her yerde açılır:** H.264 / AAC / yuv420p, önce dizin (faststart), sıralı ve boşluksuz zaman
  damgaları.

**Büyütme yok (ADR-041):** video dosyası üreten dokuz yol (editör doğrudan, Kes, Boşlukları at, Dikey
yap, Küçült, Müzik ekle, Sesi kapat, Her yerde açılsın, İyileştir), 640 × 360, 854 × 480 ve 1280 × 720
kaynakla: kaydedilen dosyanın piksel sayısı kaynağınkini geçmemeli (çıkan / kaynak piksel oranı ≤ 1).
Kaynak üretilmiş, loş ve kumlu bir deneme desenidir (her işin yapacak bir şeyi olsun diye: ses boşluğu,
aydınlatılacak görüntü, atılacak bayt).

İyileştir için ADR-037'nin ölçüleri yeniden kullanılır (ortalama parlaklık, Laplace varyansı, eklenen
titreme, "değişecek bir şey yoksa indirme yok"). Sadakat videosu üretilmiştir ("kamera benzeri":
gradyan üstünde fraktal gürültü, biraz kum); gerçek çekim değildir.

### 6. Yazıya dökme kalitesi (`transcript`)

Varsayılan koşu modeli **çalıştırmaz**. Rapor, ADR-036 çalışmasında gerçek modellerle ve gerçekçi
kümeyle alınmış sayıları `web/scripts/quality/recorded.json` dosyasından okur ve "KAYITLI, YENİDEN
ÖLÇÜLMEDİ" diye, tarihi ve commit'iyle basar. `--with-transcript` verilirse ve küçük modelin dosyaları
makinedeyse (`node scripts/fetch-models.mjs --models=base --dest=public/models`), depodaki tek haklı
cümle gerçek modelle yazıya dökülür ve WER'i ölçülür: bu bir duman ölçümüdür, kalite ölçümü değil.

### 7. Performans bütçeleri (`perf`)

Ana ekran, bir sihirbaz ve editör için: gerçekten aktarılan JS baytı, FCP, LCP, TBT — soğuk önbellekle,
bu makinede ve "mobil kısıtlama" altında (150 ms, 1,6 Mbit/s, 4× yavaş işlemci; bir öykünmedir).
Yöntem `docs/perf/2026-09-30-load.md` ile aynıdır. Dışa aktarma hızı (× gerçek zaman) bölüm 5'in
ürettiği dosyalardan gelir. Bellek: dışa aktarma sırasında ana iş parçacığının JS yığını; işçiler ve
kodlayıcı bu sayının dışındadır.

### 8. Görsel regresyon (`visual`, ve `walkthrough`)

Ana ekran (üç arama cevabıyla), her sihirbazın ilk ve sonuç ekranı, seçim ekranlarından bazıları ve boş
editör — masaüstü ve telefon — `web/tests/quality/baselines/` altındaki taban resimlerle karşılaştırılır.
Karşılaştırma toleranslıdır ve tarayıcının kendisiyle yapılır (ek kütüphane yok). Fark çıkarsa fark
resmi rapora girer. Bilerek yapılan bir tasarım değişikliğinden sonra: `--update-baselines`, sonra
resimlere **bakıp** commit'lemek.

**CI'da kapı değildir.** Tabanlar Windows 11'de Chromium'un sistem yazı tipleriyle çizdiği hâldir.
CI da Windows'ta koşar ama GitHub'ın Windows Server görüntüsünde aynı pikselleri verip vermediği
ölçülmedi; gösterilmeden kapı yapılmamalı. Bu yüzden `.github/workflows/ci.yml` değiştirilmedi.

### 9. Erişilebilirlik ve çocuk-dostu ölçüler (`a11y`, `text`)

Kontrast ve rol / ad kuralları axe ile zaten denetleniyor (`web/tests/e2e/a11y.spec.ts` ve
arkadaşları); tekrar edilmez. Burada: dokunma hedefi boyutları (telefonda 44 × 44 px), metin boyu,
her kontrolün adı ve görünür yazısı, sihirbazlarda klavye (Tab) sırası ve odak halkası; ve
`web/src/i18n/messages.ts` içindeki Türkçe metinlerin Ateşman okunabilirlik puanı (hece = ünlü sayısı),
en zor 20 metinle birlikte. Ateşman kaba bir cetveldir: bir kelimenin tanıdık olup olmadığını bilmez.

## Bütçeler

`web/scripts/quality/budgets.json`: ölçü kimliği → `max`, `min` ya da `equals`, yanında neden (`why`).
`*` iki nokta arasındaki bir parçanın yerini tutar; tam kimlik, sonra dosyadaki ilk uyan kalıp geçerlidir.

Her ölçünün dört durumu vardır: **bütçe içinde**, **bütçe dışı**, **ölçülemedi** (nedeniyle), **bütçesiz**
(yalnızca bildirilir). Sonuç dosyası olmayan bir ölçü "ölçülemedi"dir; hiçbir sayı uydurulmaz ve eski bir
sayı yenisi gibi sunulmaz (yeniden ölçülmeyen bölüm özet tablosunda "bu koşuda yenilenmedi" diye görünür).

İki tür bütçe vardır ve dosyada hangisinin hangisi olduğu yazılıdır:

- **Ölçülene göre** (bugünkü değerin biraz üstü / altı): geriye gidişi yakalar. Bilerek kötüleştiren bir
  değişiklikte bütçe de aynı commit'te, nedeniyle değişir.
- **İlkeye göre** (44 px, 0 teknik terim, ses–görüntü 25 ms, "yanlış ama emin" en çok %5…): bugün
  aşılıyor olabilir. Aşılması raporun bulgusudur; bütçeyi bugünkü sayıya çekip sorunu görünmez yapmak
  yanlıştır.

Bir bütçe aşıldığında ya da bir ölçüm betiği yarıda kaldığında `npm run quality` 1 ile çıkar
(`--no-gate` ile 0). Bugün ilkeye göre bütçelerin bir kısmı aşıldığı için betik 1 ile çıkar; bu
beklenen durumdur ve CI'a bağlı değildir.

## Bulgular nasıl yazılır

Rapor üretildikten sonra tablolar okunur ve `docs/quality/bulgular.md` elle güncellenir: en önemli
gerçek sorunlar, önem sırasıyla, kanıtıyla (hangi tablo, hangi sayı, hangi ekran / dosya). Bir sayının
bütçe dışında olması tek başına bulgu değildir; kullanıcıya ne yaptığı yazılır. Düzeltilen bulgu
silinmez, "düzeltildi (commit)" diye işaretlenir, sonraki koşuda sayısıyla doğrulanır.

## Bu katman neyin yerini TUTAMAZ

- **Gerçek bir çocuğun şaşkınlığı.** Betik hiç duraksamaz, hiçbir kelimeyi yanlış anlamaz ve her düğmenin
  adını önceden bilir. "3 tıklama" bir alt sınırdır; bir çocuğun "Video seç"e basıp basmayacağını, "Doldur"
  ile "Sığdır"ı ayırt edip edemeyeceğini, bekleme sırasında sayfayı kapatıp kapatmayacağını söylemez.
- **Beğeni.** Bir ekranın güzel, güven verici ya da sıkıcı olup olmadığını hiçbir sayı söylemez. Görsel
  karşılaştırma yalnızca "değişti" der, "kötüleşti" demez.
- **Gerçek cihazlar.** "Telefon" burada masaüstü Chromium'un 390 × 844 dokunmatik öykünmesidir: gerçek
  bir Android'in ya da iPhone'un hızı, belleği, dosya seçicisi, paylaşım menüsü, ekran klavyesi ölçülmez.
  Hız sayıları bu masaüstünün sayılarıdır. Gerçek telefon ölçümü ayrı bir iştir (`web/scripts/android/`).
- **Gerçek videolar.** Sadakat ve İyileştir ölçümleri üretilmiş videolardadır; bir düğün çekiminde ya da
  karanlık bir odada ne olduğunu söylemez.
- **Yazıya dökmenin bugünkü doğruluğu.** Kayıtlı sayılar son ölçümün sayılarıdır.
- **Okunabilirlik.** Ateşman puanı cümle ve kelime uzunluğunu ölçer; "kesit" kelimesinin bir çocuğa bir
  şey ifade edip etmediğini ölçmez.
- **Diğer tarayıcılar.** `npm run quality` içindeki her şey Playwright'ın Chromium'undadır. Chrome ve Edge
  farkları dışa aktarma matrisinin işidir (`docs/SUPPORT_MATRIX.md`); Firefox ve WebKit **motor
  derlemeleri** ayrı bir pakette yürünür (aşağıda, “Diğer tarayıcı motorları”). Gerçek Safari (macOS / iOS)
  ve Android'deki Firefox hiçbir yerde ölçülmedi.
- **e2e paketinin yerine geçmez** ve onu koşmaz.

İlk gerçek kullanıcı testi yapıldığında bu raporun yanına konmalı: betiğin "sorun yok" dediği yerde bir
insanın takıldığı her nokta, bu katmanın kör noktasıdır ve mümkünse yeni bir ölçüye çevrilmelidir.

## Diğer tarayıcı motorları (`npm run browsers`)

> 13 Ekim 2026'da kuruldu. Ayrı bir pakettir: `npm run quality`'nin, olağan e2e koşusunun ve CI'ın parçası
> **değildir** ve hiçbir şeyi kapatmaz.

Bir çocuğun cihazı iPad ya da Firefox'lu bir dizüstü olabilir. Bu paket on kartı ve çevresini Firefox ve
WebKit motorlarında, masaüstü ve telefon boyunda, **insanların aldığı derlemede** (düz `npm run build` +
`next start`; test kancası yok) yürür ve her hücreyi sınıflar:

| Sınıf | Ne demek |
|---|---|
| **çalışıyor** | İş bitti; çıkan dosya ffprobe ile denetlendi ve kartın söz verdiği gibi |
| **dürüst ret** | Uygulama durdu ve nedenini söyledi; metin kelimesi kelimesine raporda |
| **BOZUK** | Sahte başarı, bitmeyen bekleme (sınırlı beklenir; takılma bir bulgudur), kimseye söylenmeyen hata, açıklamasız duruş |
| **yok** | Tarayıcıda özellik yok, uygulama da vaat etmiyor (ör. yükleme önerisi) |
| **koşulmadı** | Nedeniyle. Sonuç dosyası olmayan hücre de böyle yazılır; hiçbir şey tahmin edilmez |

Paket yalnızca **BOZUK** bir hücrede kırmızıya döner. Bir işi yapamayan ama bunu söyleyen tarayıcı hata değildir.

```
cd web
npx playwright install firefox webkit        # bir kez (Playwright'ın kendi derlemeleri; ücretsiz)
npm run browsers                             # derle, hepsini koş, raporu yaz
npm run browsers -- --no-build               # .next/ düz bir derlemeyse yeniden derleme
npm run browsers -- --project=firefox-desktop,webkit-phone
npm run browsers -- --grep=kart              # yalnızca adı uyan testler
npm run browsers -- --report-only            # son sonuçlardan raporu yeniden yaz
node scripts/lib/engine-walk-section.mjs --patch   # docs/SUPPORT_MATRIX.md içindeki bölümü yenile
```

Projeler (`web/playwright.browsers.config.ts`): `chromium-desktop` (**kontrol**: aynı yürüyüş, öteki
testlerin motorunda — paketin kendi hatası motor bulgusundan böyle ayrılır), `firefox-desktop`,
`firefox-phone`, `webkit-desktop`, `webkit-phone`. Sunucu 3196 numaralı portta açılır (`BROWSERS_PORT`),
koşu makine genelindeki ölçüm kilidini alır, bitince sunucu kapanır. Süre bu makinede: derleme ≈ 1 dakika,
105 test ≈ 6 dakika (kilit beklemesi hariç). `.next/` koşudan sonra **düz** derlemedir: olağan e2e'den önce
`CLIP_TEST_HOOKS=1 npm run build` yeniden gerekir.

**Bunlar motor derlemeleridir, tarayıcının kendisi değil — her bulgu böyle okunmalı:**

- **WebKit** = Playwright'ın *Windows* için WebKit derlemesi. Safari değildir: bu derlemede WebCodecs,
  OffscreenCanvas ve H.264 oynatma **hiç yok**, sayfanın özel deposu (OPFS) hata veriyor; gerçek Safari'de
  bunlar var. Bu yüzden buradaki “hiçbir kart çalışmıyor” gerçek Safari hakkında bir şey söylemez; söylediği
  şey, **hiçbir şeyi olmayan bir tarayıcıda uygulamanın dürüst kaldığıdır**.
- **Firefox** = Playwright'ın yamalı *masaüstü* Firefox'u. Android'deki Firefox değildir (orada kodekler
  işletim sisteminden gelir). Firefox'ta telefon öykünmesi yoktur: “telefon boyu” aynı masaüstü motorunun
  390 × 844 dokunmatik görünümüdür.
- Hangi bulgunun gerçek Safari'ye / Android Firefox'a taşınması **olası**, hangisinin **olası değil**
  olduğu, nedeniyle, elle yazılan yorum dosyasındadır: `docs/quality/browsers-2026-10-13.md`.

Ne yürünür: her kart için ana ekran → sihirbaz → video → “İndir” → dosya ya da ret (yürüyen,
`tests/quality/lib/novice.ts`'in adıyla-bulan kullanıcısıdır; Firefox ve WebKit'te hiçbir şey taklit edilmez,
dosya gerçek indirme yolundan alınır). Kartların dışında: tarayıcının gerçekte nesi olduğu (sayfanın
içinde ölçülür, adından varsayılmaz), ana ekran ve arama, çevrimdışı kabuk, editör (klavye, kesit listesi,
tam ekran), dosyanın tarayıcıdan çıkışı, “Paylaş”, yükleme önerisi, “Yazıya dök”ün model adımı (model
dosyaları makinede yoksa “Modeli indir”e basılır ve uygulamanın bunu söylediği doğrulanır; yazıya dökmenin
kendisi **koşulmaz**), HEVC ve HDR kaynak, axe (ana ekran + bir sihirbaz). Ayrıca 13 Ekim düzeltmelerinin
testi (`advice.spec.ts`): dosyayı yapamayan tarayıcıda bunun **baştan** söylenmesi ve çıkış yolunun doğru
olması — beklenti tarayıcının adından değil, sayfada ölçülen yeteneğinden türetilir.

| Dosya | Ne |
|---|---|
| `docs/quality/browsers-latest.md` / `.json` | Son koşunun tabloları (üretilir; elle düzeltilmez) |
| `docs/quality/browsers-2026-10-13.md` | **Elle yazılır.** İlk koşunun yorumu: bulgular, düzeltilenler, seçenekler, taşınabilirlik |
| `web/playwright.browsers.config.ts` | Motorlar ve boyutlar |
| `web/tests/browsers/` | `cards.spec.ts`, `platform.spec.ts`, `advice.spec.ts`, `lib/` |
| `web/scripts/browsers/run.mjs`, `report.mjs` | Koşucu ve tablo yazarı |
| `web/scripts/lib/engine-walk-section.mjs` | `docs/SUPPORT_MATRIX.md` içindeki “motor derlemeleri” bölümü |
| `web/.scratch/browsers/` | Ham sonuçlar ve çıkan dosyalar (git'e girmez) |

## Dosyalar

| Yer | Ne |
|---|---|
| `web/scripts/quality/run.mjs` | Koşucu: derleme, kilit, sunucu, bölümler, rapor |
| `web/scripts/quality/report.mjs` | Sonuçlardan `latest.md` / `latest.json` / `history.jsonl` |
| `web/scripts/quality/budgets.json` | Bütçeler |
| `web/scripts/quality/citations.json` | Dürüstlük bölümünün andığı e2e testleri |
| `web/scripts/quality/recorded.json` | Yeniden ölçülmeyen, kayıtlı sayılar (yazıya dökme) |
| `web/playwright.quality.config.ts` | Ölçüm betiklerinin Playwright ayarı (masaüstü + telefon) |
| `web/tests/quality/*.spec.ts` | Bölümlerin ölçüm betikleri (ölçer, yargılamaz) |
| `web/tests/quality/lib/` | Betikli kullanıcı, ekran okuma, teknik terim listesi, ffmpeg ölçümleri, görsel karşılaştırma |
| `web/tests/quality/data/search-eval*.ts` | Arama değerlendirme kümeleri (`HELD_OUT`, `DEV`; üç “yeni” küme: `-fresh`, `-fresh2`, `-fresh3`) |
| `web/tests/quality/lib/searchEval.ts` | Arama sayılarının hesabı (tarayıcısız; ayar sırasında da aynı hesap) |
| `web/tests/quality/baselines/` | Ekran tabanları (PNG) |
| `web/.scratch/quality/` | Ham sonuçlar, üretilen kaynaklar, çıkan dosyalar (git'e girmez) |
