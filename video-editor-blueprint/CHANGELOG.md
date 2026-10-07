# Değişiklik Kaydı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Sesi kapat, dürüst arama yanıtı, müzik uzunluğu, ondalık virgül, kararsız test — 7 Ekim 2026 (ADR-034 güncellemesi; politika ve şema değişmedi)

Beş küçük, birbirinden bağımsız iş; her biri kendi testi ve kendi commit'iyle.

**Eklenen — dokuzuncu kart "Sesi kapat":** video seç → karar yok → İndir → aynı video, **ses izi olmadan** (sessizlik izi değil: her oynatıcı sessiz video diye gösterir, bayt harcamaz, motorun sesi olmayan kaynaklarda zaten yazdığı dosya). Uygunsa görüntü hızlı kesimle (ADR-027) kopyalanır ve yöntem satırı bunu söyler; sesi olmayan videoda İndir kapalıdır ve sebebi yazar. Kart "Sesini al"ın yanında, Kes ilk kart; dokuz kart geniş ekranda 3 + 3 + 3.

**Değişen — arama:** "sesini kapat" artık "Sesini al"a gitmiyor. Yapılamayan on istek (döndür, hızlandır / yavaşlat, videoları birleştir, GIF, filigran ya da logo sil, filtre ve renk, arka plan, tersten oynat, videodan fotoğraf, titremeyi düzelt) kayıtta `available: false` giriş oldu: kartı, sayfası, sihirbazı yok; arama onlara düğmesiz **"Bunu henüz yapamıyoruz."** der ve altında başka iş yapan bir kart önermez. Eski cümle "Bu henüz yok, üzerinde çalışıyoruz." söz vermediğimiz işler için söz verdiğinden kaldırıldı. İlk bakışta doğru iş: ayarlanan tablo 74/74 → 139/139; eski bağımsız tablo 55/56 → 55/56; yeni bağımsız tablo (95 cümle, listelerden önce yazıldı) eski kayıtla 13/95 — kalan 82 cümlenin 44'ü başka iş yapan "Başla" düğmeli bir karta gidiyordu —, yeni girişlerle ilk koşu 69/95 (%73, dürüst tahmin), düzeltmelerden sonra 95/95.

**Düzeltilen — müzik:** editörde kesit yokken eklenen müzik 0,1 sn seçiliyordu ve "Videoyu indir" bütün videoyu 0,1 sn müzikle kaydediyordu (kaydedilen dosyada ölçüldü: 12 sn'lik videoda ton yalnızca ilk 0,1 sn'de). Müzik artık eklendiği anda indirilecek videonun tamamına yayılır (kesit yoksa bütün video, varsa birleşik kesitler; müzik dosyası kısaysa kendi sonunda biter, döngü yok; belge 15'in 10 dakika / 100 MiB müzik sınırı aynen) ve kesitler değiştikçe aynı geri alma adımının içinde onu izler. Elle verilen aralığa dokunulmaz. "Müzik ekle" sihirbazının bütün videoyu tek kesit yapan dolanması kaldırıldı. Şema değişmedi (`web/src/domain/musicFit.ts`).

**Düzeltilen — sayılar:** sessizlik penceresi ("0.9 sn", ilerleme "12.3 / 290.0 sn", kaydırıcı), "Ayrıntılar"daki "Süren işlem" ve şeridin yakınlaştırma değeri Türkçede noktayla yazıyordu; ADR-030'un kuralı (TR virgül, EN nokta) artık buralarda da geçerli. Bir birim testi kaynakta biçimleyiciler dışında `toFixed` çağrısına izin vermiyor.

**Test altyapısı — kararsız CI testi:** 5 Ekim'de açılış ekranı erişilebilirlik denetimi bir kez 23 `color-contrast` bulgusuyla kaldı. Kanıt: sayfanın kendi stil dosyası (`home.css`) kesilince axe aynı bulguyu düğümü düğümüne veriyor — o koşuda sayfa stil dosyası gelmeden denetlenmiş. Uygulamada neden bulunamadı; 1 250 yükleme ve 30 test tekrarında yeniden üretilemedi; isteğin CI'daki durum kodu bilinmiyor. Yeniden deneme eklenmedi, denetim gevşetilmedi: denetimden önce stil dosyalarının uygulanmış olması bekleniyor, gelmediyse test hangi dosyanın hangi durum koduyla gelmediğini söyleyerek kalıyor (docs/a11y/2026-09-22-audit.md).

**Testler (7 Ekim 2026, bu makine, ölçüm kilidi altında):** `tsc` ve `eslint` temiz; birim **948/948** (58 dosya); e2e (Playwright Chromium, `CLIP_TEST_HOOKS=1` derlemesi) **287 geçti, 4 atlandı, 0 başarısız** (atlananlar: 2 isteğe bağlı ekran görüntüsü, 2 gerçek model testi — model dosyaları bu klasörde yok); Pages duman testi (`/capcut` altında statik derleme) **4 geçti, 2 atlandı** (model dosyaları yok); matris Chromium **29/29**, Chrome **29/29**, Edge **29/29** PASS (yeni satır M16b: kesit yokken eklenen müzik). Erişilebilirlik: yeni sihirbaz ve değişen açılış ekranı için axe 360 / 390 / 1440 px'te 0 bulgu, yalnız klavye, 320 px, yazı aralığı.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme ve düzeltme. Müzikli indirmeler değişti: kesit yokken müzik artık bütün videoda; müzikten sonra kesit ekleyen ya da çıkaranlarda müzik yeni uzunluğa uyar (eskiden eklendiği andaki uzunlukta kalırdı). Kayıtlı projeler aynen açılır; müzik aralığı ancak indirmenin tam sonunda bitiyorsa sonraki kesit değişikliğinde izlemeye başlar. **Ölçülmeyen / açık:** telefon ve gerçek kullanıcı; iOS / Safari; WhatsApp ve Instagram'ın ses izi olmayan videoyu nasıl gösterdiği; listelenmemiş yapılamayan istekler (ör. "videoya yazı ekle", "yüzleri bulanıklaştır") hâlâ yanlış karta gidebilir. **Bulunan, bu işte düzeltilmeyen:** kesiti olmayan bir proje "Düzenleme saklandı" dediği hâlde sayfa yenilenince geri gelmiyor (boş kesit listesi kayıt doğrulamasından geçmiyor) — ayrı iş olarak işaretlendi.

## Yazıya dök: cihaz üstü İngilizce transkript ve otomatik altyazı — 4–5 Ekim 2026 (ADR-036; politika `2026-10-04.v7`, şema EDL v3)

Kurucu kararları (4 Ekim 2026): "Yazıya dök" yapılsın (YouTube tarzı transkript + otomatik altyazı, şimdilik İngilizce, cihazda); model kendi sitemizde dursun; küçük model varsayılan, büyük model isteğe bağlı; cihaz üstü transkript ücretsiz temel özellik olsun.

**Eklenen:** açılış ekranında sekizinci kart **Yazıya dök** ve sihirbazı; editörde **"Kesitler | Yazı"** sekmeleri ve "Diğer → Videoyu yazıya dök". Videodaki İngilizce konuşma **bu cihazda** yazıya dökülür (Whisper `base`, WebAssembly; WebGPU + `shader-f16` olan cihazda isteğe bağlı `large-v3-turbo`). Sonuç zaman damgalı satırlardır: satıra dokununca video o ana gider, konuşulan satır izlenir, yanlış kelime yerinde düzeltilir, yazılamayan yer **"(anlaşılamadı)"** olarak görünür (uydurma metin gösterilmez, sessizce silinmez). Çıkışlar: **altyazılı video** (satırlar videoya işlenir), **TXT**, **SRT/VTT**, ve editörde **yazıdan kesit** ("Bunlardan kesit yap": işaretlenen satırlar kesit olur, tek geri alma adımı). Çıktı "Otomatik yazıldı — yanlış olabilir, düzeltebilirsin" etiketiyle gelir.

**Model ve gizlilik:** ses, görüntü ve metin cihazdan çıkmaz; ücretli API ve üçüncü taraf isteği yok. Model yalnızca **"Modeli indir (≈108,8 MB, bir kez)"** düğmesiyle, bu sitenin kendi adresinden iner (büyük model 595,6 MB), sha256 ile doğrulanır (bozuk dosya reddedilir ve silinir), kesilen indirme kaldığı yerden sürer, tarayıcıda ayrı bir önbellekte (`clip-models-v1`) durur, sonra internetsiz çalışır; "Modeli sil" gizlilik sayfasında ve editörün "Kısayollar ve sınırlar" penceresinde. Model dosyaları git'te değildir: CI sabit revizyonlardan indirir, sha256'yı doğrular (tutmazsa derleme durur) ve Pages yapıtına ekler (yapıt ≈ 0,68 GB; Pages sınırı 1 GB). **CSP değişmedi:** kurucunun onayladığı `'wasm-unsafe-eval'` gerekmediği ölçülerek eklenmedi (WebAssembly worker'da derleniyor; dört tarayıcıda onsuz çalışıyor).

**Politika `2026-10-04.v7` (belge 15):** cihaz üstü yazıya dökme ve otomatik altyazı ücretsiz temel özelliktir, adet/dakika kotası yoktur; "AI işlemleri (bulut / ücretli)" satırı değişmedi. Sınırlar tekniktir: yalnız web, yalnız İngilizce, 120 dakika / 4 GiB girdi, proje başına **3000** altyazı satırı (500 idi). **Şema EDL v3 (belge 10):** `origin: "transcript"`, isteğe bağlı `unclear` aralıkları, satır sınırı; v1 ve v2 tarifler kayıpsız açılır.

**Ölçülen (uygulama yolunda, AAC sesli videolarla; tek masaüstü, makine %44–95 doluyken; ayrıntı ADR-036):** doğru çıktısı boş olan 25 klipte (sessizlik, gürültü, müzik) **uydurma metin 0** — Chromium 153, Chrome 154, Edge 154, Firefox 155 (`base`) ve Chromium (`turbo`); duraklamalara yazılan kelime 0. `base` katı WER: temiz uzun konuşma %4,9–9,7, doğrulama konuşması %11,0, altı kısa klip %12,4 — ADR-017'nin %10 eşiğinin çevresinde, bir kısmı üstünde (deneme de "sınırda" demişti); `turbo` %2,1–5,3 (kısa klipler %9,3). Kelime zamanı p95: `base` başlangıç 226 ms (eşik 250'nin altında), bitiş 274 ms (üstünde); `turbo` 242 / 306 ms. Hız: `base` tek iş parçacığında konuşma süresinin **0,45–0,72 katı** (10 dakikalık konuşma 4,5–5,5 dakika; denemenin "0,28"i farklı, paketli yoldandı), bellek 1,0–1,3 GiB (Firefox 1,8); `turbo` 0,19–0,29 kat, 4,4–4,6 GiB.

**Testler:** birim 837/837; e2e (Chromium) 273 testte son derlemeyle iki tam koşu 270 geçti / 2 atlandı / 1 başarısız — başarısız olan her koşuda farklı, bu işin dokunmadığı bir testti (ağ tamponu hatası; gerçek kota testi) ve tek başına yinelenince geçti; önceki tam koşu 271 geçti / 0 başarısız. Yeni e2e: 15 arayüz (test ikizi motorla), 11 erişilebilirlik (axe 360/390/1440: 0 bulgu, 320 px, yazı aralığı, klavye, azaltılmış hareket), **2 gerçek modelli test koştu ve geçti** (çevrimiçi + çevrimdışı, origin dışı istek 0, CSP ihlali 0). Pages duman testi 6/6 (model dosyaları `/capcut/models/` altından, sha256 ve `Range` doğrulandı; sihirbaz gerçek modelle). Matris Chromium/Chrome/Edge 28/28 (yeni satır M22: transkript altyazısı karede).

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Eski projeler açılıyor (v1/v2 → v3); altyazı satır sınırı büyüdü; hiçbir sınır daralmadı, fiyat ve bulut hakları değişmedi. **Ölçülmeyen / açık:** gerçek GitHub Pages yayını (0,68 GB yapıt, 10 dakikalık yayın süresi); telefon (S23 bağlıydı ama Chrome çalışmıyordu — ölçülmedi); dizüstü; Safari; Türkçe (açılmadı). **Kurucu/hukuk notu:** Whisper ONNX dışa aktarımlarının model kartlarında lisans beyanı yok; üst modellerin lisanslarıyla (Apache-2.0 / MIT) yayınlıyoruz (`docs/security/DEPENDENCIES.md` §5).

## Küçült ve Sesini al — 3–4 Ekim 2026 (ADR-035; politika ve şema değişmedi)

Açılış ekranına iki iş daha geldi (yedi kart): **Küçült** ve **Sesini al**. İkisi de cihazda çalışır; video hiçbir yere gönderilmez.

**Küçült (hedef boyuta indirme):** kullanıcı nereye sığacağını seçer — "Paylaşmak için (52 MB altı)", "E-posta (25 MB altı)", "WhatsApp (16 MB altı)" — ve her seçenek sonucunu **kodlamadan önce** söyler ("≈ 15,4 MB · 720p", "Videon zaten bunun altında", "Bu video buna sığmaz: en az 25,5 MB gerekir"). Saf planlayıcı (`web/src/domain/targetSize.ts`) çözünürlüğü (1080 → 720 → 540 → 360), video ve ses bit hızını ölçülen tabanlara göre seçer; kodlayıcıdan sabit bit hızı istenir; dosya kaydedilmeden önce tartılır ve hedefi aşarsa ölçülen oranla yeniden kodlanır (en çok 3 kodlama). Hâlâ büyükse dosya kaydedilir ama **"sığdı" denmez**: "530 KB — hedefin üstünde (hedef 500 KB)…". Kaynağın kendisi sığıyorsa görüntü kopyalanır (hızlı kesim). Sığmayan hedef kaydetme penceresi açılmadan reddedilir ve sığacak en küçük boyut söylenir. Hazır hedefler: paylaşma 52 428 800 bayt (ADR-031 ölçümü), e-posta 25 000 000 (Gmail yardım sayfası), WhatsApp 16 000 000 (Meta'nın WhatsApp medya belgesi); dosya bu uygulamalara gönderilerek **denenmedi**.

**Sesini al:** seçili videonun sesi M4A (MP4 içinde AAC) olarak kaydedilir; görüntü hiç çözülmez; süre örneğine kadar tamdır (ADR-032'nin hizalı AAC yolu, düzenleme listesi duruyor). Sessiz videoda İndir kapalıdır ve sebebi yazar; hiçbir şey yazılmaz. MP3 yok: tarayıcıda MP3 kodlayıcı yok.

**Ölçülen (tek masaüstü, bir telefon; ayrıntı ADR-035):** donanım kodlayıcısı (Chrome/Edge 154) 18 gerçek kayıt indirmesinin 18'inde ilk denemede hedefin altında (bit hızı düşürülenler hedefin %90–97'si); yazılım kodlayıcı (Playwright Chromium) 14 indirmenin 13'ünde hedefin altında, 6'sında 2–3 kodlama gerekti, 1'i üç denemeden sonra hedefin %106'sında kaldı ve öyle bildirildi; telefonda (Galaxy S23, ilk oturum) üç hedef ilk denemede tuttu. Değişken bit hızında donanım kodlayıcısı istenenin 1,07–1,30 katını, telefonda 1,97 katını yazıyor; sabit bit hızında 0,98–1,09 (telefonda 1,00). Ses dosyası Chrome/Edge `<audio>`, ffmpeg ve Windows Media Foundation'da (başsız) çalıyor; süre tam, kayma 0.

**Açık soru (kurucu):** belge 15 "720p / 1080p … dahil" diyor ama daha düşük çözünürlüğü yasaklamıyor; Küçült bugün 540p/360p'ye inebiliyor (tek yerden kapatılır: `DEFAULT_MIN_SHORT_EDGE`). Belge 15 değişmedi.

**Testler:** birim 732/732; e2e (Chromium) 243 geçti, 2 atlandı — hedef boyut, yalnızca ses, iki sihirbaz, erişilebilirlik (axe 360/390/1440: 0 bulgu) ve klavye dahil; matris Chromium/Chrome/Edge 27/27 (yeni satırlar M20, M20b, M20c, M21, M21b); gerçek kayıtlar Chrome 15/15; Pages duman testi 4/4. Telefon bu oturumda bağlı değildi: sihirbazlar telefonda koşulmadı.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Olağan indirme (hedefsiz) aynı bit hızı, aynı mod ve aynı hızlı kesim kurallarıyla çalışır; sınırlar, fiyatlar ve şema değişmedi. Ölçülmeyen: iOS/Safari/macOS, WhatsApp ve e-posta uygulamalarının kendisi, başka GPU'lar, 60 dakikalık hedef boyut indirmesi, birleştirmeden sonra telefon.

## Görev öncelikli açılış ekranı — 3 Ekim 2026 (ADR-034; politika ve şema değişmedi)

Kurucu kararı (taslak A + C): editörle açılan ekran "bir çocuğun bile istediğini yapabileceği" kadar kolay değildi.

**Değişen:** Site artık **"Ne yapmak istiyorsun?"** ekranıyla açılır (eski tanıtım sayfasının yerine; yüklenen uygulama da buradan başlar): üstte yazma kutusu, örnek cümleler, altında bugün çalışan her iş için büyük bir kart, sağ üstte "Kendim düzenleyeceğim" (editör), altta "Videon cihazından çıkmaz. Hesap gerekmez." Telefonda iki sütun, masaüstünde üç–dört; hiçbir kart gizlenmez.

**Eklenen — yazarak bulma:** Kutuya yazılan cümle cihazda, uygulamanın içindeki Türkçe/İngilizce kelime listesiyle eşleştirilir (yapay zekâ yok, ağ isteği yok, yazılan saklanmaz): harf katlama, anlamsız sözcükleri atma, kök/ön ek, uzun kelimelerde tek yazım hatası, deyimler. Kartların yerini "Bunu mu demek istedin?" alır; Enter ilk sonucu başlatır. Listeler 74 cümlelik bir tabloyla yazıldı (74/74); sonradan yazılan 56 cümlede ilk ölçüm 48/56 (%86).

**Eklenen — sihirbazlar** (`/yap/<id>/`; video seç → en fazla bir karar → İndir → "Kaydedildi" + "Paylaş"; hepsi mevcut dışa aktarma motoruyla): **Kes** (kesit editörünü seçilen videoyla açar), **Boşlukları at** ("N sessiz yer bulundu, videon kısalacak: X → Y"; "Uzun boşluklar / Kısa duraksamalar da"; 20 parça sınırını söyler), **Dikey yap** (1080 × 1920; "Doldur / Sığdır", canlı önizleme), **Müzik ekle** (videonun sesi "Kalsın / Kapansın"; seviye ve bitişteki kısılma hazır gelir), **Her yerde açılsın** (H.264/AAC MP4; zaten uygunsa söyler). Açılış ekranından kaydedilen dosyaya 3–5 dokunuş. Her sihirbazda "Daha fazla ayar → editörde aç": aynı video ve ayarlarla, dosya yeniden seçilmeden.

**Henüz olmayanlar dürüstçe:** Küçült, Sesini al ve Yazıya dök'ün kartı ve sayfası yok; arama onları kastederse "Bu henüz yok, üzerinde çalışıyoruz." yazar, düğme çizmez.

**Değişmeyen:** Editör `/editor`'de aynı (logosu artık açılış ekranına götürür). Sihirbazdan başlayan çalışma tarayıcıya kaydedilmez; editörde kayıtlı proje yerinde durur. CSP aynı; çevrimdışı kopya sihirbaz sayfalarını da içerir; gizlilik sayfası arama kutusunu ve sihirbazların proje saklamadığını söyler. Kullanıcı testi kiti görevleri açılış ekranından başlatır.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar, fiyatlar ve şema değişmedi; eski projeler editörde aynen açılır.

## Teknik — 2 Ekim 2026: Telefonda kesit sonlarındaki bayat kareler düzeltildi (ADR-033; politika ve şema değişmedi)

**Ölçülen (Galaxy S23, Android 16, Chrome 154):** Telefonda tam kodlanan kesitlerin son 1–21 karesi, kaynağın doğru karesi yerine daha önceki bir karenin resmini gösteriyordu; kare sayısı ve "eksik kare" sayacı doğru göründüğü için hiçbir kontrol görmüyordu. Sebep: çözme kitaplığı (mediabunny) aralığın paketleri bitince çözücüyü kapatıyor, oysa önceden çözdüğü birkaç kare henüz çizilmemiş oluyor. Masaüstünde kare resmini kendisi taşıyor; telefondaki Chrome'da resim, kare çizilene kadar donanım çözücüsünün tamponunda duruyor ve çözücü kapanınca gidiyor (`decode-probe.mjs` ile telefonda ölçüldü: kapanmadan önce çizilen kareler doğru, sonra çizilenler son çizilen resmi gösteriyor; boşaltma tek başına resmi götürmüyor).

**Değişen:** Dışa aktarma çözücüyü kesitin son karesi çizilene kadar açık tutuyor (hızlı kesimin dikiş kodlamasında da). Çözücü yine de kendiliğinden kapanırsa, ondan sonraki kareler "eksik" sayılıyor (ADR-014: %2'yi aşarsa dışa aktarma reddedilir); bayat bir resim asla gerçek kare diye yazılmıyor. Telefonda A–R'nin 18 durumunun hepsi üç koşuda kare kare doğru (canlı derlemede aynı gün 8–10 durumda 1–21 bayat kare); masaüstü Chrome/Edge önce de sonra da doğru, 20 dakikalık 1080p tam kodlamanın hızı aynı (önce 130,6–146,3 sn, sonra 134,5–143,2 sn).

**Ölçüm araçları:** `scripts/lib/frame-identity.mjs` (barkodsuz kayıtlarda her çıktı karesi bağımsız ffmpeg referansının aynı karesiyle karşılaştırılıyor; durağan sahneler "karar verilemez"); matris ve gerçek kayıt koşucusunda yeni kontrol "her çıktı karesi referansın aynı karesini gösteriyor (kesit başı, ortası, sonu)"; `phone-run.mjs` her durumda kare kimliği, yeni R durumu (24 fps barkodlu klip, iki kesit); `scripts/android/decode-probe.mjs` (telefonda çözücü ve kare resmi deneyleri).

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar, fiyatlar ve şema değişmedi.

## Teknik — 2 Ekim 2026: ADR-032 düzeltmesi — telefondaki "−42,67 ms" bir ölçüm hatasıydı (uygulama değişmedi)

**Ölçülen:** Canlı ADR-032 derlemesi telefonda koşturulunca ölçüm betiği sesi 42,67 ms erken okudu. Dosyalar doğruydu: betik çıktıyı `ffmpeg -ss 0` ile okuyordu ve ffmpeg bu aramada, düzenleme listesinin gizlediği hazırlık karelerini ikinci kez atıyor (ffmpeg'in kendi AAC dosyalarında da). Baştan okununca telefon çıktılarının sesi kaynağa göre 0 ms; flaş+cıvıltı senkron klibinde görüntüyle arası ≤ 0,1 ms. Masaüstü Chrome, Edge, Firefox ve **telefondaki Chrome**'un kendi `<video>` oynatıcısı telefon çıktısını masaüstü çıktısıyla aynı senkronda çalıyor, düzenleme listesi 0'a çekilmiş ikizini 40–46 ms geç: düzenleme listesine uyuyorlar. Telefonda A–Q'nun hepsi (canlı site ve aynı kodun yerel derlemesi) kaydedildi; süreler ve kare sayıları masaüstüyle aynı, ses 0 ms. Uygulamada ses için değişiklik gerekmedi.

**Değişen (yalnızca ölçüm araçları):** `phone-run.mjs` sesi baştan okuyor, kaynağın ses başlangıcını hesaba katıyor, 1 sn'lik pencere; yeni durumlar N–Q (senkron klibi: hızlı kesim, tam kodlama, iki kesit, tüm klip) ve ses izi düzeni (ilk paketler, `skip_samples`). Yeni: `scripts/lib/av-sync.mjs` (senkron klibi üretimi, flaş/cıvıltı eşleştirme, kare barkodu), `scripts/android/player-sync.mjs` (tarayıcının kendi oynatıcısında senkron, masaüstünde ve telefonda), `scripts/android/cdp-own-tabs.mjs` (telefon betikleri yalnızca kendi açtıkları sekmeleri görüyor; yeni açılmış Chrome'un yüklenmemiş sekmesi bağlantıyı kilitliyordu, kurucunun sekmelerine artık hiç bağlanılmıyor).

**Yan bulgu (düzeltilmedi, ayrı iş):** Telefonda tam kodlanan kesitlerin son 1–11 karesi bayat (daha önceki bir kare tekrar ediyor; barkodlu klipte doğrulandı); kare sayısı ve "eksik kare" sayacı bunu görmüyor. Senkron klibinin hızlı kesimlerinde (N, P) görülmedi. Ayrıntı ADR-032.

Mevcut kullanıcı haklarına etkisi: yok. Uygulama kodu, sınırlar, fiyatlar ve şema değişmedi.

## Teknik — 1 Ekim 2026: Android'de ses kayması ve "süre uyuşmadı" (ADR-032; politika ve şema değişmedi)

**Ölçülen (gerçek telefon: Galaxy S23, Android 16, Chrome 154):** Telefondaki Chrome'un AAC kodlayıcısı sesin önüne 2048 hazırlık karesi koyuyor ve bunu bildirmiyor. Sonuç: telefonda dışa aktarılan her videonun sesi görüntüden 42,7 ms geride kalıyordu, son 10–20 ms'si eksikti; uzunluğu 1024 ses karesinin katını az geçen kesitler (30 fps'lik uzunlukların %37,5'i; ör. 3,5 sn, 7 sn) bir kareden uzun çıkıp "Oluşan dosyanın süresi beklenen süreyle uyuşmadı" ile reddediliyordu. Samsung'un 60 fps ve ağır çekim kayıtlarında görülmesi tesadüftü; görüntü, döndürme ve kare sayıları doğruydu. Masaüstü Chrome/Edge'in kodlayıcısında gecikme yok.

**Değişen:** Dışa aktarma, ses kodlayıcısının gecikmesini her tarayıcıda bilinen bir sinyalle ölçüyor ve dosyada geri alıyor (MP4 düzenleme listesi; oynatıcılar hazırlık karelerini çalmaz); kodlayıcı sonda sessizlikle boşaltılıyor, fazlası atılıyor. Gecikme ölçülemezse ya da ses kesitin sonuna kadar gelmezse dosya kaydedilmiyor: "Bu tarayıcının ses kodlayıcısı sesi görüntüyle hizalı yazamadı; sesi kayık bir dosya kaydedilmedi." Süre toleransı (bir kare) değişmedi. Masaüstünde ölçülen gecikme 0; çıktılar aynı süre ve senkronda.

**Ölçüm araçları:** `phone-run.mjs` (`--profile`, `--media`, `--desktop`, yerel derleme için `adb reverse`, Samsung kayıtlarının farklı aralıkları H–M, ses kayması ölçümü, adb yeniden başlarsa yeniden bağlanma, tarayıcı arka plandayken bekleme); `phone-cleanup.mjs`, `phone-peek.mjs`. Destek matrisine elle yazılmış "Gerçek telefon" bölümü.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar, fiyatlar ve şema değişmedi.

## Telefonda paylaş, uygulama olarak yükle, internetsiz aç — 30 Eylül 2026 (ADR-031; politika ve şema değişmedi)

**Eklenen:** İndirme bitince "Kaydet"in (ya da "Kaydedildi"nin) yanında **"Paylaş"**: video sistemin paylaşma menüsüne verilir (WhatsApp, Instagram, Drive…). Yalnızca tarayıcı dosya paylaşabiliyorsa görünür; menüyü kapatmak sessiz, ret açık bir cümle. Chromium tek seferde en fazla 50 MiB paylaşır (ölçüldü: 50 MiB geçer, 1 bayt fazlası reddedilir); daha büyük videoda düğme yerine "önce kaydet, sonra Dosyalar ya da galeriden paylaş" yazar.

**Değişen:** Telefon düzeninde ve dokunmatik ekranda "Bilgisayara kaydet" yerine "Kaydet"; hazır/boş yer cümleleri "cihazında" der. "Bilgisayarından çıkmaz" cümleleri her yerde "cihazından çıkmaz".

**Eklenen:** Site uygulama olarak yüklenebilir: manifest (ad "Clip", koyu tema, editörden başlar), logodan simgeler (maskelenebilir dahil), ⋯ menüsünde "Uygulama olarak yükle" (tarayıcı sunduysa), iPhone/iPad Safari'de "Paylaş → Ana Ekrana Ekle" ipucu.

**Eklenen:** İnternetsiz açılış: ilk ziyaretten sonra bir service worker uygulamanın kendi dosyalarını (~1,9 MB; sayfalar, kod, altyazı yazı tipi, simgeler) saklar; tanıtım, editör ve gizlilik sayfası internetsiz açılır, yerel videodan kesit indirilebilir. Medya ve dışa aktarılan dosya önbelleğe girmez. Yeni sürüm hazır olunca "Yeni sürüm hazır — Yenile" notu; sayfa kendiliğinden yenilenmez, indirme sürerken "Yenile" kapalı. Gizlilik sayfası ve veri envanteri "Çevrimdışı kopya"yı ve paylaşmayı anlatır; CSP değişmedi.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar, fiyatlar ve şema değişmedi; eski projeler aynen açılır.

## Kesit akışı v2 — 30 Eylül 2026 (ADR-030; politika ve şema değişmedi)

Kurucu kararları, ilk kullanıcı UX denetiminin yapısal önerilerinden (Ö1, Ö3, Ö5, Ö6, Ö8).

**Değişen:** "Bitişi işaretle" (O) kesiti hemen ekler; ayrı "Kesit ekle" adımı yok. Tek geri alma kaldırır; bildirim ve kartın parlaması aynen. Kesit seçiliyken I/O yine o kesitin kenarlarını taşır. Başlangıç yokken bitiş "Önce başlangıcı işaretle." der (0'dan başlatılmaz); bitiş başlangıcın önündeyse eski ret ve sonraki adım, başlangıç işaretli kalır (eskiden başlangıç sessizce düşüyordu). "Kesit ekle" (Enter) yalnızca kutulara yazılan ya da şeritte sürüklenen bitiş için kaldı, birincil değil; hiçbir şey işaretli değilken artık videonun tamamını kesit yapmıyor, "Önce başlangıcı işaretle" diyor. Tıklama: bir aralığı kesip kaydet 7 → 6, üç aralık birleştirilmiş 17 → 14, tüm video 2.

**Değişen:** Zamanlar ince ayar dışında milisaniyesiz: kartlar, şerit, oynatma saati, bildirimler "00:07" / "1:02:07" (konum, aşağı yuvarlanmış saniye); uzunluk dakikanın altında onda bir ve aşağı yuvarlanmış ("4,6 sn"), böylece 00:02.600 → 00:07.200 "5 saniyelik" okunmaz. Başlangıç/Bitiş alanları ve kaydırıcıların ekran okuyucu değerleri milisaniyeyi korur. Dosya satırındaki süre Türkçede artık ondalık virgülle.

**Değişen:** Boyutlar "GiB/MiB" yerine ondalık "GB/MB", Türkçede virgülle ("2,4 GB"). Sınırlar ve kontrol baytla aynı (4 GiB = 4 294 967 296 bayt, müzik 100 MiB); arayüz sınırı aşağı yuvarlayarak "4,29 GB" / "104,8 MB" der, sınırı aşan boyutu yukarı yuvarlar: gösterilen sayılar bayt kontrolüyle aynı sonucu verir (sınırdaki baytlar birim testinde). Ret metni dosyanın boyutunu da söylüyor ("dosya 4,3 GB; bu sürümün sınırı 4,29 GB."). Destek dosyasındaki depolama alanı ondalık MB.

**Eklenen:** Telefonda, kesit listesi ekranın altındayken alta yapışkan çubuk: "Kesitler (N)" listeye götürür, "Kesiti indir" / "Hepsini birleştirip indir" üstteki düğmeyle aynı işi yapar. 0 kesitte yok, liste görünürken çekilir; odaklı denetimi örtmez (WCAG 2.4.11), güvenli alan boşluklarına uyar, 320 px'te sarılır, hareket etmez.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar, fiyatlar ve şema değişmedi; eski projeler aynen açılır.

## Teknik — 30 Eylül 2026: uzun dışa aktarmada bellek (ADR-029, politika değişmedi)

**Ölçülen:** 60 dakikalık dışa aktarmada yükselen bellek tarayıcının sayfa ve worker'ı çalıştıran sürecinde; GPU ve tarayıcı süreçleri düz. Worker'da gerçekten tutulan tek büyüyen şey MP4 dosyasının sonundaki dizin (`moov`) için örnek başına tutulan kayıtlar: ~90 bayt/örnek, 30 fps + AAC'de **saatte ~24 MiB**; bu, sıkıştırılmamış MP4 yazmanın doğası (mediabunny 1.58.1). Geri kalan artış çöptü: ses karıştırıcısı her örnek için kısa ömürlü nesne ayırıyordu (20 dakikada 2,3 GiB, worker'ın ayırdığının %79'u) ve editör her ilerleme olayında (~50/sn) yeniden çiziliyordu (20 dakikada 0,77 GiB); tarayıcı bu hızda çöp üretilince yığını büyütüp geri vermiyordu.

**Değişen:** Karıştırıcı artık kare başına ayırmıyor (aynı aritmetik, çıktı paket paket aynı; birim testi eski biçimle bit bit karşılaştırıyor). İlerleme olayı ilk ve son dışında en çok 250 ms'de bir. Chrome 1080p: 20 dakikada tepe 987 → 701 MiB ve düz; 60 dakikada tepe 951 → 852 MiB, seviye 60–90 MiB aşağıda. 60 dakika hâlâ tam düz değil: dizin ve V8 payı yüzünden taban saatte ~40–50 MiB yükseliyor, kapanışta kısa bir tepe var; dışa aktarma bitince hepsi bırakılıyor. ADR-020/021'deki "bellek düz" cümlesi buna göre düzeltildi. Parçalı MP4 önerilmiyor: mediabunny'de o modda da örnek kayıtları tutuluyor (ölçüldü: 57 → 52 bayt/örnek).

**Ölçüm araçları:** `measure-export-memory.mjs` süreç türüne göre dağılım, onda birlerin en düşüğü, `--heap`, `--heap-gc`, `--heap-snapshots`, `--heap-sampling[=page]`, `--memory-dumps`; `heap-snapshot-summary.mjs`.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar ve fiyatlar değişmedi; indirilen dosyanın içeriği aynı.

## Teknik — 25 Eylül 2026: dışa aktarma hızı ve bellek (ADR-028, politika değişmedi)

**Ölçülen:** Yeniden kodlayan dışa aktarmada Chrome ve Edge'de sürenin %74–85'i donanım H.264 kodlayıcısını beklemek (1080p'de ~4 ms/kare); çözme, çizim ve kare kopyası %10–13. Playwright'ın headless Chromium kabuğunda (GPU yok) süre tuvale çizmek (%85–95). Aşama profili bir test kancasıyla açılır (`window.__clipExportProfile`, `measure-export-memory.mjs --profile`); uygulama bunu açmaz.

**Değişen:** Bir parçanın sesi artık kareleriyle birlikte, kodlayıcı beklenirken işleniyor (önce: parçanın videosundan sonra). Chrome/Edge'de %2–12 hızlı; 60 dk 1080p Chrome 468 → 441 s. HDR videolarda parlak renk yumuşak kırpması tablo tabanlı ve ikinci bir iş parçacığında: 2 dk 1080p HDR 156 → 62 s (2,5 kat). Çıktılar önce/sonra kare kare aynı; matris 21/21/21 PASS ve gerçek kayıtlar (11/15/11 PASS) aynı.

**Düzeltilen:** Yüksek bit hızlı videoda sessizlik önerileri çok bellek tutuyordu (10,5 Mbit/s kaynakta tepe ~950–980 MiB, pencere kapanınca da ~930). Sebep kaynağın okunma şekliydi; artık yalnızca gereken aralıklar okunuyor ve uzun aralık 4 parça hâlinde çözülüyor: tepe ~720 MiB (Chromium 855 → 580). Öneriler bit bit aynı. Bedel: yüksek bit hızlı dosyada analiz ~2 kat uzun (20 dakikada 4,5 → 9 s). Aynı sebep eski dışa aktarmada parçanın ses geçişinde sıçramaya yol açıyordu (10,5 Mbit/s kaynakta tepe 927 → 799 MiB).

**Hızlı kesimle birlikte (main ile birleşim):** değişiklikler yalnızca tam kodlama yoluna (kırpma, altyazı, HDR, 60 fps, farklı çözünürlük) uygulandı; hızlı kesim aynı dosyayı aynı hızda veriyor (10 dk kesit 8,5–10,4 s, `smart`). Tam kodlamanın çıktısı main'inkiyle kare kare aynı; 2 dk 1080p HDR 202 → 98 s. Matris 22/22/22 PASS.

**Bilinen:** 60 dakikalık dışa aktarmada tepe bellek aynı (873 → 874 MiB), ama artık sonda sıçramak yerine süre boyunca yavaşça yükseliyor (~+120 MiB/saat, ses işiyle ölçekleniyor); nerede tutulduğu ölçülmedi.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar ve fiyatlar değişmedi.

## Kesit listesi — 23 Eylül 2026 (ADR-026; politika değişmedi)

**Değişen:** Web editörünün ana akışı. Tek zaman çizgisi (ADR-019) yerine kurucunun tarif ettiği model: videoda Başlangıç (I) ve Bitiş (O) işaretlenir, "Kesit ekle" (Enter) ile aralık "Kesitler" listesinin sonuna düşer; kartta ▶ o aralığı oynatır, ⬇ yalnız o kesiti indirir, ✕ siler (geri alınabilir); sıra birleştirilmiş indirmenin sırasıdır. Sağ üst düğme: 0 kesit "Videoyu indir" (tamamı), 1 kesit "Kesiti indir", ≥ 2 kesit "Hepsini birleştirip indir". Tek saat videonun kendi zamanıdır; şerit videonun tamamını, kesitleri numaralı bölgeler olarak ve bekleyen aralığı gösterir; yakınlaştırılabilir (düğmeler, Ctrl/⌘ + tekerlek, iki parmak). Görüntü/Ses/Altyazı ayarları "Ayarlar" çekmecesine taşındı ve her indirmeye uygulanır; video sesi artık kesit başına değil bütün kesitler için. Sessizlikleri bul "Diğer" (⋯) menüsünde; kesit yokken tüm videoda arar ve kalan bölümleri kesit yapar. Birim adı "parça" değil "kesit".

**Değişen:** İndirme. ⬇ kaydetme penceresini hemen açar (önerilen ad: `tatil_00-12-01-40.mp4`, `tatil_3-kesit.mp4`, `tatil_tamami.mp4`); video doğrudan seçilen dosyaya kodlanır, önce tahmini boyut kadar yer ayrılır, iptal ve hatada yarım dosya kalmaz; bitince "Kaydedildi: ad.mp4" ve yöntem ("Kodlandı"). Pencerede Vazgeç hiçbir şey başlatmaz. Pencereyi desteklemeyen tarayıcıda eski yol (OPFS/bellek + "Bilgisayara kaydet"). Uygunluk kapısı arka planda bir kez çalışıp oturum boyunca saklanıyor; ayrı "Videoyu indir" penceresi kalktı.

**Eklenen:** Tam ekran izleme (⛶ düğmesi, F tuşu; kendi oynat/duraklat, zaman ve arama çubuğuyla; tarayıcı desteklemiyorsa düğme görünmez). Kesit küçük resimleri (tarayıcıda üretilir, hiçbir yere gönderilmez).

**Kaldırılan:** Kaynak/Sonuç önizleme sekmeleri, çıktı zaman çizgisi, Böl (S) ve zaman çizgisinde Sil, açılışta videonun otomatik tek parça olarak konması, telefon alt sekme çubuğu, kesit başına ses ayarı.

Sınırlar değişmedi (girdi 120 dakika / 4 GiB / 5 video kaynağı / 20 kesit); çıktı sınırı (60 dakika, bellek yolunda 5) artık **her indirmeye ayrı** uygulanır ve kodlamadan önce söylenir. 60 dakikadan uzun kesit eklenebilir, kartında uyarı görünür, ⬇ reddeder. Çoklu video kaynağı hâlâ yok.

Mevcut kullanıcı haklarına etkisi: yok. Şema değişmedi; eski proje ve yedek dosyaları açılır (eski otomatik "tam video" parçası tek kesit olarak görünür).

## Politika 2026-09-24.v6 — 24 Eylül 2026 (hızlı kesim, ADR-027)

**Değişen:** İndirilen videonun kalite satırı "720p / 1080p, SDR, **en çok** 30 fps" oldu (doc 15). Hızlı kesim artık 30 fps'yi aşmayan her uygun kaynağı **kendi kare hızında ve kendi bit hızında** kopyalıyor: 24, 25, 29,97 fps ve değişken hızlı telefon kayıtları dahil. "30 fps'yi aşmayan" ölçüsü gerçek kayıtlarda ölçülerek seçildi: bir saniyeye kadar her aralıkta 30 fps'nin üstünde en çok bir kare titremesi ve ortalama en çok 30,3 fps (nominal 30 fps telefon dosyaları saniyede en çok 31 kare, daha hızlılar 47–61 kare gösterdi). 50/60 fps, 1440p/4K ve 720p/1080p boyutlarından farklı kaynak eskisi gibi kodlanıyor. Sonuç satırı: "Hızlı kesim — görüntü yeniden kodlanmadı, orijinal kalite"; kodlandıysa sebebi ("kaynak 30 fps'den hızlı, 30 fps'ye çevrildi" gibi).

**Kurucu kararları:** (1) en çok 30 fps — evet; (2) 4K ve 1080p60'ın kopyalanması — hayır; (3) kaynağın bit hızı korunur, üst sınır yok (dosya tam kodlamanınkinden büyük olabilir).

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Süre, boyut, kaynak ve parça sınırları, cloud satırları ve fiyatlar değişmedi.

## Hızlı kesim — 24 Eylül 2026 (ADR-027, politika değişmedi)

**Eklenen:** Görüntüsü değişmeyen indirmelerde kaynağın sıkıştırılmış kareleri olduğu gibi kopyalanıyor; yalnızca her kesimden sonraki ilk IDR'a kadarki kareler (ve B-kareli kaynakta sondaki en fazla bir B grubu) yeniden kodlanıyor ("smart cut"). Kare hassas: kesit tam işaretlenen karede başlayıp bitiyor; kopyalanan kareler kaynakla bit bit aynı. Ses her zaman eskisi gibi yeniden kodlanıyor (kazanç, müzik, tam kesim çalışır). Dosya başarı demeden önce bu tarayıcının çözücüsüyle dikişlerde yeniden denetleniyor; tutmazsa tam kodlama çalışıyor. Ölçülen (60 dk 1080p kesit, iki aralık): Chrome 437,8 s → 28,1 s, Edge 373,1 s → 28,6 s, Playwright Chromium 804,7 s → 33,7 s; tepe bellek aynı düzeyde. Sonuç ekranında yeni satır: "Yöntem: Hızlı kesim — görüntü yeniden kodlanmadı" ya da "Kodlandı (sebep)".

**Kapsam (ilk sürüm):** yalnızca altyazısız, kırpmasız, SDR, H.264 MP4/MOV kaynak; indirilen çözünürlük kaynağınkiyle aynı; kareleri 30 fps ızgarasında (aynı gün politika v6 ile "en çok 30 fps" oldu, yukarıda). 4K ve HEVC tam kodlanıyor.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar ve fiyatlar değişmedi; aynı indirme daha hızlı olabilir, dosyası kaynağın bit hızındadır.

## Politika 2026-09-23.v5 — 23 Eylül 2026

**Değişen:** Web yerel toplam kaynak boyutu limiti (video ve müzik birlikte) 2 GiB → 4 GiB (doc 15, doc 11). Kurucu kararı, Edge'de de ölçülme koşuluyla; dayanak ADR-025: 4,45 GiB'lık dosya (yalnızca ölçüm için limiti 8 GiB olan yerel derlemede) ve gerçek politikayla 3,96 GiB'lık dosya Edge, Chrome ve Chromium'da açıldı, 4 GiB ofsetine yakın doğru kareye gidildi, sessizlik önerileri çalıştı, üstüne müzik eklendi, 2 ve 4 GiB ofsetlerini geçen 5 dakika indirildi (9000 kare, 10/10 kare doğru), yeniden yükleme ve yedek dosyasıyla video ve müzik yeniden bağlandı; tepe bellek 916–1265 MiB. 4 GiB'ı aşan dosya ve toplamı aşan müzik dosya adıyla ve "4 GiB (yaklaşık 4,29 GB)" mesajıyla reddedilir. Matris satırı M13 artık 4 GiB + 16 MiB (`m13-oversize-4gib.mp4`). Girdi 120 dakika, çıktı 60 dakika (bellek yolunda 5), 5 video kaynağı, 20 parça, 1 müzik, mobil (2 GiB / 5 GiB) ve cloud limitleri, fiyatlar değişmedi.

**Düzeltilen:** Dosya boyutları (kaynak paneli, yeniden bağlama paneli, çıkan dosya) ikili değer olduğu hâlde "GB/MB" yazılıyordu; artık kontrolün birimiyle "GiB/MiB/KiB" (doc 15: gösterilen birim, kontrol edilen birim).

**Eklenen:** "Bilgisayara kaydet"in altında sessiz bir not: kaydederken bilgisayarda yaklaşık dosyanın boyutu kadar daha boş yer gerekir, gerçek boyutla (ADR-023). HEVC çözücüsü olmayan tarayıcıda HEVC video açılamazsa içe aktarma hatasının altında ipucu: Windows'ta Edge'de Microsoft Store'daki "HEVC Video Uzantıları" gerekebilir ya da Chrome denenebilir; yalnızca video HEVC ve tarayıcının çözücü kontrolü "hayır" dediğinde (ADR-022).

**Kurucu kararları (kayıt):** HDR HLG açık kalır; R11 HLG'nin geçişinin, önceden kaydedilen 5 operatörlük set kaldıktan sonra genişletilen 7 operatörlük sete dayandığı bilerek kabul edildi (ADR-022). Yazılım kodlayıcıya 3 kat bit hızı kalır (ADR-024).

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen her dosya ve geçerli her proje/yedek geçerli kalır.

## Politika 2026-09-23.v4 — 23 Eylül 2026

**Değişen:** Web yerel girdi limiti (toplam video kaynak süresi) 60 dakika → 120 dakika (doc 15, doc 11). Girdi sınırına sığan video artık çıktı sınırından uzun olsa da zaman çizgisine tek parça olarak gelir; çıktı sınırı (60 dakika; diske yazamayan tarayıcıda 5 dakika) tarifin kuralı olmaktan çıktı ve indirmenin kapısı oldu: sonuç sınırdan uzunsa "Videoyu indir" kodlamadan önce sonucun uzunluğunu ve en az ne kadar silinmesi gerektiğini söyler, zaman çizgisi sınırı çizgiyle ve fazlasını taralı gösterir (ADR-021). "İlk 60 dakikayı ekle" seçimi kaldırıldı. Çıktı limiti, 2 GiB toplam boyut, 5 video kaynağı, 20 parça, 1 müzik, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-021 ölçümleri.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen her video ve geçerli her proje/yedek geçerli kalır; tarif doğrulamasındaki süre kuralı artık çıktı sınırını değil girdi sınırını (120 dakika) uygular (`timeline_duration_exceeds_policy`), çıktı sınırı render planında (`output_duration_exceeds_policy`) kaldı.

## Teknik — 23 Eylül 2026 (politika değişmedi)

**Değişen:** Diske (OPFS) yazılan çıktının depolama kontrolü. Tarayıcının depolama tahmini gerçek diski göstermiyor (Chrome her durumda "kullanım + 10 GiB" bildiriyor), bu yüzden eski "tahminin iki katı" kuralı pratikte hiçbir şeyi kontrol etmiyordu. Artık dosyanın ölçülmüş tahmini boyutu (bit hızı × süre × 1,1 + 32 MiB) kodlamadan önce diskte ayrılıyor. Yer yoksa uzun çıktı ilk kare kodlanmadan reddediliyor ve mesaj gereken alanı ve tarayıcının bildirdiği alanı söylüyor. 60 dakika 1080p için gereksinim ~6,0 GiB'tan 2,67 GiB'a indi (ADR-023).

**Değişen:** Donanım H.264 kodlayıcısı olmayan tarayıcıda (ör. Playwright Chromium, VA-API'siz Linux Chrome) video bit hızı 3 kat. Bu tarayıcılarda gerçek görüntüde dosya ~2,7–2,9 kat büyür ve kalite donanım kodlayıcısının düzeyine çıkar. Donanım kodlayıcılı Chrome ve Edge'de dosyalar birebir aynı (ADR-024).

**Düzeltilen:** Gerçek kayıt R15 Chromium'da FAIL (SSIM 0,825) → PASS (0,870). Dışa aktarma sırasında dolan disk artık "yarım dosya silindi" diyor; bu yol tarayıcının kendi kota hatasıyla e2e'de sınanıyor.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar ve fiyatlar değişmedi.

## HDR kaynaklar SDR'ye çevriliyor — 23 Eylül 2026 (ADR-022)

**Eklenen:** HDR (PQ / HLG, bt2020) videolar artık reddedilmek yerine SDR H.264 olarak dışa aktarılır — ama yalnızca, dışa aktarmadan hemen önce worker'da sentetik bir 10-bit HDR karesiyle yapılan kontrol **bu tarayıcıda** geçerse. Dönüşüm tarayıcının kendi HDR→SDR dönüşümüdür; parlak doygun renklerin kesilmesi (ölçüldü: PQ ColorChecker karesinin %16'sı) float16 tuval ve tonu koruyan bir yumuşak kırpmayla giderilir. Dialog'da yeni satır ("HDR → SDR dönüşümü bu tarayıcıda doğru") ve not: "Bu video HDR. İndirilen dosya SDR olacak; renkler telefondaki görüntüden biraz farklı görünebilir." Ölçüm: `docs/spikes/2026-09-23-hdr-tonemap.md`; eşikler tarayıcı çıktısı ölçülmeden sabitlendi.

**Değişen:** HDR ret mesajı sebebi söylüyor (bu tarayıcı HDR'yi SDR'ye doğru çeviremedi, deneme karesiyle test edildi). Matris satırı M10-hdr artık gerçek 10-bit içerik (VP9 profil 2, PQ) kullanıyor ve reddi değil doğru renkli çıktıyı (ya da HDR gerekçeli açık reddi) kontrol ediyor; yeni M10-hdr-hlg satırı (HLG, 90° döndürmeli). Eski 8-bit "PQ etiketli" H.264 fixture'ı kaldırıldı.

Sınır: HEVC çözücüsü olmayan tarayıcıda (bu makinede Edge ve Playwright Chromium) telefonun HEVC HDR kaydı yine içe aktarmada, codec yüzünden reddedilir. Fiyat, kota ve politika sınırları değişmedi.

## Politika 2026-09-22.v3 — 22 Eylül 2026

**Değişen:** Web yerel çıktı limiti 5 dakika → 60 dakika, yalnızca çıktının tarayıcının özel diskine (OPFS) akıtılabildiği yolda. Diske yazamayan tarayıcıda (bellek yolu) çıktı 5 dakikada kaldı ve daha uzun çıktı kodlamadan önce açık bir mesajla reddedilir; depolama tahmini dosyaya yetmiyorsa da uzun çıktı baştan reddedilir (doc 15, doc 11). Girdi limiti (60 dakika / 2 GiB), 20 parça sınırı, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-013 ve ADR-020 bellek ölçümleri.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden indirilebilen hiçbir çıktı reddedilmez; bellek yolundaki tarayıcılar için sınır aynı kaldı.

## Politika 2026-09-21.v2 — 21 Eylül 2026

**Değişen:** Web yerel girdi limiti 20 dakika / 250 MiB → 60 dakika / 2 GiB (doc 15, doc 11). Çıktı limiti 5 dakika, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-013 bellek ölçümü.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen hiçbir proje kapanmaz.

## 0.1 — 19 Eylül 2026

Araştırmaya dayalı ürün, mimari, medya sözleşmesi, ücretsiz/Pro politika önerisi, ödeme ve kota tasarımı, pazarlama deneyleri, test matrisi, yayın kapıları ve ilk kodlama görevi oluşturuldu.

Bu sürüm yalnızca dokümantasyondur. Uygulama sürümü, test sonucu veya canlı hizmet duyurusu değildir.

Sonraki değişiklikler `Eklenen`, `Değişen`, `Düzeltilen`, `Güvenlik`, `Kırıcı değişiklik` başlıklarıyla kaydedilir. Fiyat/kota değişiklikleri mevcut kullanıcı haklarına etkisiyle birlikte yazılır.
