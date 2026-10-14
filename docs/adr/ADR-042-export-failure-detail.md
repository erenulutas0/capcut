# ADR-042 — Beklenmeyen indirme hatası: nerede ve ne tür olduğu kaydedilir, metni asla

> Tarih: 2026-10-12 · **13 Ekim eki sonda:** diğer işleyiciler (sessizlik, yazıya dökme, bulut sesi, önizleme).
> Durum: UYGULANDI (birim ve e2e testleri). **11 Ekim olayının nedeni BULUNAMADI**
> (aşağıda "Ne arandı, ne bulundu"). Politika (belge 15) ve şema (EDL) **değişmedi**; dışa aktarma
> günlüğüne bir alan eklendi (`failureDetail`; `docs/privacy/DATA_INVENTORY.md` §2.1 ve §5, `/gizlilik`
> metni aynı değişiklikte güncellendi).

## Bağlam: 11 Ekim 2026 olayı

Kurucunun kendi makinesinde (Windows, Chrome; `next start` ile yerel derleme): "Yazıya dök" → internette
yol (ADR-039) → 4 dk 13 sn'lik sıradan bir MP4'ün yazısı geldi → **"Altyazılı videoyu indir"** →
"Bu sefer olmadı / Çıktı alınamadı. Beklenmeyen bir hata oluştu." (`internal_error`). Kurucu aynı sayfada,
hiçbir şeyi yenilemeden yeniden bastı: **kaydedildi**.

Geriye hiçbir bilgi kalmadı, çünkü işleyici (worker) hata metnini bilerek iletmiyordu ("dosya yolu
içerebilir") ve bilinmeyen her şeyi tek koda (`internal_error`) çeviriyordu; tanı dosyasında da yalnızca
o kod vardı. Geçici bir hatanın bir sonraki görünüşünde de aynı şey olacaktı.

## Karar 1 — Bir sonraki sefer için: `ExportFailureDetail`

Başarısız her indirme, kodunun yanında **nerede ve ne tür** bir hata olduğunu taşır
(`web/src/domain/exportFailureDetail.ts`). İşleyiciden sayfaya (`failed` olayının `detail` alanı), oradan
indirme durumuna, dışa aktarma günlüğüne (`failureDetail`) ve "Sorun bildir" dosyasına gider. Beklenmeyen
bir hatada (`internal_error`, `worker_unavailable`, ya da bizim sınıfımız olmayan bir hata) hata kartında
kapalı duran **"Ayrıntılar"** açılınca tek satır olarak da görünür:

> `EncodingError · encode · encoding_error · kare 12/7590 · enc avc1.640028 no-preference hw+ · dec avc1.64001f no-preference · file`

| Alan | Ne |
|---|---|
| `errorName` | Hatanın adı — yalnızca bilinen adlar listesindeyse (`EncodingError`, `InvalidStateError`, `NotSupportedError`, `DataError`, `OperationError`, `TypeError`, `AbortError`, `QuotaExceededError`, `NotReadableError`, `NoModificationAllowedError`…); değilse `Other`. Hata nesnesi değilse `NonError` |
| `stage` | Kendi kodumuzun koyduğu aşama: `captions`, `open_source`, `audio_calibration`, `analyse`, `fast_cut`, `open_output`, `setup`, `mux`, `frames`, `configure_decoder`, `decode`, `draw`, `enhance`, `frame_capture`, `configure_encoder`, `encode`, `audio_decode`, `audio_encode`, `audio`, `write`, `finalize`, `commit`, `verify`, `worker_crash`, `unknown` |
| `via` | `exception` (işleyicide yakalandı) · `worker_error_event` (işleyicinin kendisi çöktü) · `worker_message_error` · `request_not_sent` · `stalled` (hata yok: yerinde saydı) |
| `hint` | Hata metni bilinen birkaç cümleyle karşılaştırılır; eşleşenin **etiketi** yazılır (`codec_reclaimed`, `encoding_error`, `decoding_error`, `encoder_creation`, `write_blocked`…), cümlenin kendisi değil |
| `phase`, `framesDone`, `totalFrames`, `videoPacketsOut` | Sayfanın gördüğü son adım; kaçıncı karede kaldığı; kodlayıcıdan kaç paket çıkmıştı |
| `videoEncoder`, `videoDecoder`, `audioEncoder` | **Gerçekten yapılandırılan** codec dizgisi ve `hardwareAcceleration` isteği; video kodlayıcısında 14 Ekim'den beri bit hızı modu da (`bitrateMode`, ADR-045) (kodlayıcı: mediabunny'nin `onEncoderConfig` çağrısından; çözücü: mediabunny'nin kurduğu sarmalayıcıdan, kendi tarayıcı düzeltmelerinden sonra) |
| `hardwareEncoderAvailable` | Tarayıcı bu görüntü için donanım kodlayıcısı sunuyor mu (`no-preference` neyi seçerdi) |
| `route` | `opfs` / `memory` / `file` |
| `pageWasHidden`, `attemptInSession` | Deneme sırasında sayfa hiç gizlendi mi; bu sayfadaki kaçıncı indirme (0: ilki) |

**Aşama nasıl bilinir.** İki yolla: (1) işleyici ilerledikçe kaba aşamayı not eder (`enter('open_source')`…);
(2) bir adım hatayı gördüğü yerde onu etiketler (`tagStage`, hata nesnesinin *yanında* bir WeakMap — hataya
dokunulmaz, metni kopyalanmaz). **İlk etiket kazanır:** dosyaya yazarken oluşan bir hata, kodlayıcının bir
sonraki karesinde yüzeye çıksa da `write` kalır. Çözücüyü beklerken oluşan hata `decode`, kodlayıcıya ilk
kareyi verirken oluşan `configure_encoder` (kodlayıcı orada kurulur), sonrakiler `encode`'dur.

### Hatanın metni neden hiç saklanmıyor ("temizleyip saklasak?")

Soruldu, cevap **hayır**. Tarayıcının ve medya kitaplığının hata cümleleri dosya adı, yol, `blob:` adresi ya
da dosyanın üstverisinden bir parça taşıyabilir (`NotReadableError`, `NotFoundError`, mediabunny'nin
kapsayıcı hataları). "Şunları sil" diye yazılacak bir kuralın *hepsini* yakaladığı gösterilemez; gösterilemeyen
bir kurala güvenip metni saklamak, "Dosya adı yoktur" cümlesini kanıtsız bırakır. Bunun yerine metin
işleyicinin içinde yalnızca **okunur**: bilinen bir cümleyse etiketi yazılır. Bilinmeyen bir cümle için
elimizde ad + aşama + codec'ler kalır; yetmezse listeye yeni bir cümle eklenir.

İlk yazılan codec denetimi ("harf, rakam, nokta, tire") testte yakalandı: `aile-tatili-antalya-2025.mp4`
de o harflerden oluşuyor. Denetim artık her codec türünün kendi dil bilgisidir (`avc1.` + 6 onaltılık hane,
`mp4a.` + 2 hane + isteğe bağlı sayı…).

### İşleyicinin `error` olayı (çökme) — düzeltilenler

`exportClient.ts` olağan indirmede işleyicinin `error` olayını `worker_unavailable` ("Arka plan işleyicisi
başlatılamadı") olarak bildiriyor ve **işleyiciyi çalışır bırakıyordu**: sayfa "olmadı" derken işleyici
kullanıcının seçtiği dosyaya yazmayı sürdürebilirdi. Şimdi:

- çöken işleyici **durdurulur** (bir sonraki indirme yenisini açar);
- zaten çalışırken çöktüyse cümle "Beklenmeyen bir hata oluştu"dur (`internal_error`, `via:
  worker_error_event`); "başlatılamadı" yalnızca hiç ses vermediyse söylenir;
- `messageerror` (okunamayan ileti) da dinlenir; önce sonsuza dek beklerdi;
- istek işleyiciye hiç verilemezse (`postMessage` hata verirse) indirme "bekliyor"da asılı kalmaz, hata olur.

### Aynı adı taşıyan iki ayrı hata

Chromium, uzun süre boşta kalan bir codec'i geri alırken onu `QuotaExceededError` ("Codec reclaimed due to
inactivity.") ile kapatır — dolu diskin adıyla. İşleyici bu adı `output_storage_full` ("disk doldu")
sayıyordu. Artık bu cümle tanınır ve `internal_error` olur; başka her `QuotaExceededError` eskisi gibi dolu
disktir. (Bu, 11 Ekim olayının nedeni **değildir**: o gün ekrandaki cümle zaten "beklenmeyen hata" idi.)

### Cümle

"Beklenmeyen bir hata oluştu." ne yapılacağını söylemiyordu; olay tam da "bir daha basınca oldu" idi.
Yeni cümle: **"Beklenmeyen bir hata oluştu. Bir kez daha dene; yine olursa “Sorun bildir”e bas."**
(Kurucu metni değiştirmek isterse tek satır: `export.fail.internal_error`.)

## Karar 2 — Kendiliğinden yeniden deneme YOK (şimdilik)

Hata yeniden üretilemedi; hangi hata adının geçici olduğu bilinmiyor. "Ne olursa olsun bir kez daha dene"
kuralı (a) nedeni bilinmeyen bir hatayı gizler, (b) dört dakikalık işi sessizce iki kez yaptırır,
(c) gerçek bir hatada kullanıcıyı iki kat bekletir. Eklenmedi. Bir sonraki olay adı ve aşamayı
söylediğinde karar yeniden verilir: örneğin `EncodingError` + `decode` + donanım çözücüsü ise "yazılım
çözücüsüyle bir kez daha, yöntem satırında söyleyerek" savunulabilir bir kuraldır.

## Ne arandı, ne bulundu

**Olay yeniden üretilemedi.** 12 Ekim 2026, bu makine (Windows 11), yerel sahte vekile karşı; her deneme
taze bir sayfa: video → yazı → "Altyazılı videoyu indir"e **bir** basış. Video: ffmpeg ile üretilen 4 dk 13 sn,
1280 × 720, H.264 + AAC; sağlayıcı yanıtı gerçeğine benzetilmiş (aşağıda).

| Koşu | Tarayıcı | Deneme | Hata |
|---|---|---|---|
| Düz | Chrome 154 (kurulu; donanım kodlayıcı + çözücü) | 20 + 20 | 0 |
| Düz | Playwright Chromium 153 (yazılım) | 20 + 20 | 0 |
| Önizleme oynarken + 8 iş parçacığı işlemci yükü | Chrome 154 | 10 | 0 |
| Önizleme oynarken | Edge 155 (donanım) | 8 + 6 | 0 |
| Aynı anda 3 sayfa, önizleme oynarken | Chrome 154 | 12 | 0 |
| Aynı anda 3 sayfa + işlemci yükü | Chromium 153 | 9 | 0 |
| Yazı **cihazda** (yerine geçen betik) yazılmış | Chrome 154 / Chromium 153 | 8 / 6 | 0 |
| 1920 × 1080, 23,976 kare/sn, 44,1 kHz, dizini sonda | Chrome 154 | 8 | 0 |
| Yazı ekranda 150 sn bekletildikten sonra | Chrome 154 | 3 | 0 |
| `--repeat-each=2`, önizleme oynarken | Chrome 154 | 6 | 0 |
| Basıştan sonra başka sekme öne alınmış | Chrome 154 | 5 | 0 — **ama sayılmaz:** görünmez pencerede sayfa "gizli" olmadı |

Toplam **161 akış, 0 hata** (gizli sekme satırı hariç 156). İlk iki satırın ikinci yarısı ve Edge'in 6'sı son
kodda (yerinde sayma bekçisinden sonra) koşuldu; gerisi ondan bir önceki kodda (fark yalnız o bekçi).
Kapanmadan önceki yarım koşunun 96 satırı da hatasızdı; sayılara katılmadı.

### Şüpheliler (kanıtla; sıra olasılık tahminidir, kanıt değil)

1. **Tarayıcının donanım video çözücüsünde / grafik sürecinde anlık bir hata.** Lehine: WebCodecs
   çözücüsünde akış ortasında yazılıma düşme yoktur; hata tek seferliktir, ikinci basış çalışır — olayın
   biçimi budur. Aleyhine: üretilemedi. Grafik sürecini bilerek öldürdüğümüzde (aşağıda) hata **gelmedi**,
   indirme yerinde saydı — yani kurucunun gördüğü "hata" tam olarak bu yol değil.
2. **Seçilen dosyaya yazma / dosyayı yerine taşıma** (`write`, `commit`): gerçek diskte, kaydetme
   penceresiyle. Lehine: sınamalar bu yolu gerçek diskle yürüyemiyor (kaydetme penceresi sürülemez;
   yerine tarayıcının özel dosya sistemi geçer), yani hiç denenmemiş tek büyük fark bu; Windows'ta başka
   bir programın (virüs taraması, eşitleme, önizleme) dosyayı tutması geçicidir. Aleyhine: kanıt yok;
   hatanın basıştan ne kadar sonra geldiği bilinmiyor (sonda geldiyse bunu güçlendirirdi).
3. **Kodlayıcının ilk oturumu** (`configure_encoder` / `encode`). Aleyhine: 101 Chrome/Edge denemesinin
   hepsi donanım kodlayıcısıyla ve taze sayfayla; `no-preference` isteğinde tarayıcının kendi yazılıma
   düşmesi var.
4. **Bulut yolundan kalan kaynak** (hipotez a). Aleyhine: ses çıkarma kendi işleyicisinde yapılır ve iş
   bitince işleyici **sonlandırılır** (çözücü, kodlayıcı, tampon onunla gider); dışa aktarma işleyicisiyle
   ortak hiçbir nesnesi yok. Cihazda yazılan yazıyla da bulutla da 0 hata: bulut yolu fark yaratmıyor.
   Kod okumasında sızıntı bulunmadı.
5. **Önizlemenin aynı dosyayı çözmesi** (c): oynayan önizlemeyle 42 deneme, 0 hata.
6. **Altyazı çizimi / yazı tipi** (e): yazı tipi yüklenemezse ayrı bir kod ve cümle çıkar
   (`caption_font_unavailable`); kurucunun gördüğü o değil.
7. **Sağlayıcı yanıtının biçimi** (f): dışlandı. Aynı yazıyla ikinci basış çalıştı — belirleyici bir hata
   olamaz. Ayrıca gerçeğe benzer yanıtla (çakışan sıralar, sıfır uzunlukta kelimeler, 86 kelimelik noktasız
   bölüm, 37 harflik kelime, sonu aşan kelime) 161 akışta sorun yok.
8. **Arka plandaki yetenek denetimiyle yarış / hizmet işçisi / geri alınan codec:** kod okumasıyla
   elendi (aynı anahtar aynı sözü paylaşır; dışa aktarmada yeni dosya istenmez; geri alınan codec o gün
   "disk doldu" derdi).

### Bulunan başka bir kusur: grafik süreci ölünce indirme sonsuza dek yerinde sayıyor

Chrome 154 ve Edge 155'te, donanım kodlayıcısıyla, indirmenin 6. saniyesinde tarayıcının grafik süreci
öldürüldü (`Browser.crashGpuProcess`; bekçiden önce 2, sonra 6 deneme; 8'de 8):

- **Önce:** hiçbir hata gelmedi. Yüzde olduğu yerde kaldı (3 dakika izlendi), **"İptal et" çalışmadı**.
  Tek çıkış sayfayı yenilemekti.
- **Şimdi:** sayfa, kare döngüsündeki bir indirmeden 60 sn (yalnız sayfa görünürken sayılır) ses gelmezse
  işleyiciye nerede durduğunu sorar, işleyiciyi durdurur ve indirmeyi hata olarak bitirir. Ölçülen satır:
  `Stalled · encode · stalled · kare 2704/7590 · enc avc1.64001f no-preference hw+ · dec avc1.64001f no-preference · file`
  — yani bekleyen, donanım kodlayıcısına kare veren adımdı. **İkinci basış 6'da 6 kaydetti** (7590 kare).
  "İptal et"e 15 sn yanıt gelmezse işleyici durdurulur ve indirme iptal olur.

Bu, 11 Ekim olayının nedeni olarak **kanıtlanmadı** (o gün bekçi yoktu ve ekranda hata vardı), ama aynı
ailedendir: tarayıcının donanım yolu bir an bozulur, sonraki deneme çalışır.

### Sağlamlaştırılanlar (olayı çözdüğü iddia edilmiyor)

Her biri kendi gerekçesiyle: çöken işleyicinin durdurulması; `messageerror` ve gönderilemeyen istek;
yerinde sayan indirme ve yanıtsız iptal; geri alınan codec'in "disk doldu" sayılmaması; çöken işleyiciden
kalan boş dosyanın kaldırılması (ölçüldü: 0 baytlık dosya seçilen adla kalıyordu).

## Kurucu ne yapmalı (yine olursa)

1. Hata kartında **"Ayrıntılar"**a bas; satırı oku ya da ekran görüntüsünü al.
2. **"Sorun bildir"** → "Tanı dosyasını indir". Dosyada `exportLog`'un son satırındaki `failureDetail`
   aynı bilgiyi, `elapsedMs` de hatanın basıştan ne kadar sonra geldiğini taşır (hemen mi, dört dakikanın
   sonunda mı).
3. Sonra yeniden dene. (Sayfayı yenileme: günlük tarayıcıda kalır, ama oturumun hata kodları sayfayla gider.)

Yeniden üretmeyi denemek için: `web/playwright.soak.config.ts` (başındaki açıklama).

## Doğrulanmayanlar

- **Olayın nedeni.** Yukarıdaki sıra bir tahmindir.
- **Gerçek diske, gerçek kaydetme penceresiyle yazma** — hiçbir otomatik koşuda yok.
- **Gizlenen sekme** (kullanıcı başka sekmeye geçerse): görünmez pencerede sayfa gizlenmedi; görünür
  pencereyle koşulmadı (kurucunun ekranında pencere açmamak için).
- **Kurucunun gerçek videosu** ve gerçek sağlayıcı / gerçek Worker: kullanılmadı (kural).
- **Grafik süreci öldükten sonra kaydedilen dosyanın görüntüsü**: yalnız kare sayısı ve süre ölçüldü.
  (İlk deneme hiç kaydetmedi; ölçülen dosya temiz ikinci basışın dosyası.)
- **60 sn bekçisinin yanlış alarmı**: çok yavaş cihazda, ağ sürücüsündeki kaynakta ya da telefonda
  ölçülmedi. Sayfa gizliyken saymaz; yalnız kare döngüsünde çalışır.
- ~~**Diğer işleyiciler** (sessizlik, cihazda yazıya dökme, bulut sesi, İyileştir önizlemesi) hâlâ yalnız
  `internal_error` der; bu karar onlara uygulanmadı.~~ → 13 Ekim eki (aşağıda).
- Kalite katmanı (`npm run quality`), Pages duman sınaması, tarayıcı matrisi, gerçek telefon: koşulmadı.

---

## Ek — 13 Ekim 2026: diğer işleyiciler de aynı kurala bağlandı

> Durum: UYGULANDI (birim ve e2e testleri). Politika (belge 15) ve şema (EDL) **değişmedi.** Tanı dosyasının
> `sessionErrors` satırlarına isteğe bağlı bir alan eklendi (`detail`; `docs/privacy/DATA_INVENTORY.md` §2.3
> ve §5, `/gizlilik` ve "Sorun bildir" metni aynı değişiklikte güncellendi).

Yukarıdaki karar yalnızca indirme (dışa aktarma) işleyicisini kapsıyordu. Dört iş daha arka planda çalışır
ve beklenmeyen bir hatada yalnızca `internal_error` diyor, bazı durumlarda da **hiç bitmiyordu**:

| İş | Dosyalar | Önce: ayrıntısız biten | Önce: sonsuza dek bekleyen |
|---|---|---|---|
| **Sessizlik bulucu** ("Boşlukları at", editördeki pencere) | `adapters/silence/` | Her beklenmeyen hata `internal_error`; çözücünün gerçek hatası "bu tarayıcı sesi çözemiyor" (`undecodable`) sayılıyor, ne olduğu kayboluyordu. Çalışırken çöken işleyici "bu tarayıcıda başlatılamadı" diyordu | Okunamayan ileti (`messageerror` dinlenmiyordu); **gönderilemeyen istek** (söz reddediliyor, kimse yakalamıyor, ekran "aranıyor…"da kalıyordu); yerinde sayan işleyici (yalnız "Durdur" kurtarıyordu) |
| **Model indirme** ("Yazıya dök" → "Modeli indir") | `adapters/transcript/` | Beklenmeyen her şey `storage_failed` ("gizli sekmede olabilirsin") — adı ve yeri yok | Okunamayan ileti; gönderilemeyen istek (**"Durdur" da çalışmıyordu**: söz zaten reddedilmişti, ekran "indiriliyor"da kalıyordu); bağlantı bayt göndermeden açık kalırsa süresiz bekleme |
| **Cihazda yazıya dökme** | `adapters/transcript/` | `internal_error`; çalışırken çöken işleyici "başlatılamadı" | Okunamayan ileti; gönderilemeyen istek ("Durdur" çalışmıyordu); yerinde sayan model |
| **Bulut için ses dosyası** ("İnternette" yolu, gönderimden önceki adım) | `adapters/cloud/cloudAudio*`, `CloudRoute.tsx` | `internal_error` ("Bir şey ters gitti"); çalışırken çöken işleyici "bu tarayıcı sesi gönderilecek hâle getiremiyor" diyordu — yanlış bir iddia | Okunamayan ileti; gönderilemeyen istek (ekran "ses hazırlanıyor"da kalıyor, **"Durdur" çalışmıyor ve yeni deneme de başlatılamıyordu** — tek çıkış sayfayı yenilemekti); yerinde sayan işleyici |
| **"İyileştir" önizlemesi** (indirme işleyicisinin içinde, kendi kopyasında) | `adapters/export/exportClient.ts` `enhancePreview` | `internal_error`, ayrıntısız | Okunamayan ileti; gönderilemeyen istek; yerinde sayan işleyici — iptal bir iletiydi, duran işleyici yanıtlayamıyordu ve **sonraki her önizleme de aynı işleyicinin arkasında bekliyordu** |

"Önce" sütunları **kod okumasından** çıkarıldı (dinlenmeyen olay, yakalanmayan söz reddi); eski kod bu
bozulmalarla ayrıca koşulmadı. "Şimdi" davranışı aşağıdaki testlerle koşuldu.

### Karar

**Aynı tür, aynı güvenceler.** Bu işlerin beklenmeyen hatası da `ExportFailureDetail` taşır
(`web/src/domain/exportFailureDetail.ts`): izin listesinden hata adı, kendi koyduğumuz aşama, geliş yolu,
bilinen cümlenin etiketi, sayfanın gördüğü son adım, sayfa hiç gizlendi mi. Hatanın metni, dosya adı, yol
yine **hiç** işleyiciden çıkmaz; nesne sayfada alan alan yeniden kurulur (`sanitizeExportFailureDetail`).
Yeni tür tanımlanmadı; listelere eklenenler:

- aşamalar: `model_download`, `model_check`, `model_load`, `speech_detect`, `recognise`, `loudness`
  (var olanlar da kullanılır: `open_source`, `audio_decode`, `audio_encode`, `mux`, `finalize`, `analyse`…);
- adımlar (`phase`): `downloading`, `checking`, `loading`, `listening`, `writing`;
- hata adları: kendi sınıflarımız (`AnalysisError`, `AudioFeedError`, `EngineError`, `DownloadError`,
  `PreviewRefusal`).

**Düz sözlü ret, gerçek hatayı yanında taşır.** Bu işleyiciler çoğu hatayı düz bir nedene çevirir
("ses çözülemedi", "dosya okunamadı", "bellek yetmedi"). Çeviri doğruydu ama gerçek hata orada bitiyordu.
Artık yeni hata nesnesinin *yanında* saklanır (`withOrigin`, `failureStage.ts`; bir WeakMap — metin
kopyalanmaz, hata nesnesine dokunulmaz) ve ayrıntı ondan yazılır. Cümle değişmez; "Ayrıntılar" eklenir.
Kendi kararımız olan retlerde (ses izi yok, model eksik) ayrıntı **yoktur**: söylenecek başka bir şey yok.

**Tek bekçi, her iş için** (`web/src/adapters/workerWatch.ts`, saat kuralı `web/src/domain/stallClock.ts`):

- işleyicinin `error` ve `messageerror` olayı işi **bitirir** (olayın kendi metni okunmaz);
- gönderilemeyen istek (`postMessage` hata verirse) işi bitirir: `via: request_not_sent`, hata adı;
- eşiğinden uzun süre ses vermeyen işe "neredesin?" diye sorulur, bir saniye sonra — yanıt gelse de
  gelmese de — iş bitirilir ve işleyici **durdurulur** (`via: stalled`; yanıt geldiyse aşaması yazılır);
- süre **yalnız sayfa görünürken** ve **yalnız ilerleme yokken** sayılır; sekme gizlenince ve yeniden
  görününce sayaç sıfırdan başlar (görünürlük olayına ek olarak her saniye de bakılır);
- "başlatılamadı" yalnızca işleyici hiç ses vermediyse söylenir; çalışırken çöken işleyici "beklenmeyen
  hata"dır (indirmedeki kuralın aynısı).

**İptal her zaman çalışır.** Sessizlik, yazıya dökme, model indirme ve bulut sesi zaten işleyiciyi
durdurarak iptal ediyordu; çalışmadıkları tek durum (gönderilemeyen istek) kapandı. Önizlemede iptal bir
iletidir; duran işleyici 60 sn sonra durdurulur ve onu bekleyen **bütün** önizlemeler hatayla biter,
"Tekrar dene" yeni bir işleyici açar.

### Eşikler — neden bu sayılar

Yanlış alarm, kullanıcının beklediği işi çöpe atar; bu yüzden her eşik o işin **gerçekte ne sıklıkta ses
verdiğinden** çıkarıldı ve geniş tutuldu. Hepsi "sayfa görünürken, hiçbir ileti gelmeden geçen süre"dir.

| İş / adım | Eşik | İşleyici ne sıklıkta ses verir | Gerekçe |
|---|---|---|---|
| Sessizlik bulucu | **60 sn** | Çözülen her ses parçasından sonra (en sık 100 ms'de bir) | Dosyayı açmak birkaç küçük okumadır (ADR-040 aynı tür okumayı 4 sn ile sınırlar). Bir dakika sessizlik yavaşlık değildir. İndirmenin kendi eşiği |
| Bulut için ses dosyası | **60 sn** | Kodlanan her saniyelik sesten sonra (en sık 200 ms'de bir) | İlk iletiden önce yalnız kodlayıcı sorgusu ve dosyanın açılması, sondan sonra bellekte bir kapanış var |
| "İyileştir" önizlemesi | **60 sn** | Videoya bakarken en sık 100 ms'de bir; sonra tek kare | Tek kare bir arama ve en çok bir kare grubunun çözülmesidir |
| Model indirme | **120 sn** | Gelen her bayt parçasında (en sık 100 ms'de bir); denetimde okudukça | İki dakika tek bayt gelmemesi yavaş değil, durmuş bağlantıdır. İnen parçalar saklıdır; yeniden deneme kaldığı yerden sürer. Denetim (SHA-256) önceden hiç ses vermiyordu — artık okudukça aynı sayıları yeniden bildirir, yoksa büyük dosyada yavaş cihazda yanlış alarm olurdu |
| Yazıya dökme — model başlatılıyor | **10 dk** | Başta **tek** ileti, model çalışana dek hiçbiri | Yüzlerce MB'ı tarayıcı deposundan okuyup derlemek (büyük modelde WebGPU gölgelendiricileri) yavaş cihazda **ölçülmedi**; eşik ölçülen her şeyin (masaüstünde saniyeler) çok üstünde |
| Yazıya dökme — konuşma aranıyor | **120 sn** | En sık 100 ms'de bir | 10 dakikalık video 13–24 sn sürdü (ADR-036) |
| Yazıya dökme — yazılıyor | **10 dk** | Her tanıyıcı çağrısından sonra (**yeni**; önce yalnız bölüm bitince) | Bir çağrı en çok 30 sn ses dinler ve içeriden ses veremez; ADR-036'nın masaüstü yaklaşık iki kat hızla yazdı (çağrı başına ≈ 15 sn). 10 dk bunun kırk katı: on kat yavaş bir telefon da içinde kalır. Önce bir bölüm reddedilip yeniden bakıldığında (birkaç çağrı) arada hiç ileti yoktu; eşik bölüme göre konsaydı ya çok uzun ya yanlış alarmlı olurdu |

On dakikalık iki eşik "yerinde sayma"yı geç yakalar; bilerek. O adımlarda "Durdur" her an çalışır ve
bekçinin işi sonsuz beklemeyi bitirmektir, yavaş cihazı cezalandırmak değil.

### Ekranda ve dosyada

- **Cümleler çocuk sadeliğinde kalır**, teknik satır yalnız "Ayrıntılar"ın içindedir (kapalı gelir; ortak
  bileşen `web/src/components/FailureDetails.tsx`): `EncodingError · audio_decode · decoding_error · analysing`.
  Kare sayısı olmayan işlerde satır, sayfanın gördüğü son adımı söyler. Altında aynı not ve — indirme
  kartında olduğu gibi — **"Sorun bildir"** düğmesi durur (editör ve sihirbazların kendi penceresi;
  `ReportProblem.tsx`).
- Değişen / eklenen cümleler: model indirme için "İndirme durdu: bir süredir hiçbir şey inmedi. İndirilen
  kısım duruyor; tekrar denersen kaldığı yerden devam eder." (`stalled`) ve "İndirme beklenmedik bir hatayla
  durdu. İndirilen kısım duruyor; tekrar dene." (`internal_error`). Diğer işlerin cümleleri aynı
  ("Çözümleme beklenmedik bir hatayla durdu. Tekrar dene." vb.).
- **Tanı dosyası:** bu işlerin hata kodu oturumun hata kayıtlarına yazılır (`sessionErrors`; alanlar
  `silence`, `transcript`, `model_download`, `cloud_audio`, `enhance_preview`), beklenmeyen hatada aynı
  ayrıntıyla (`detail`). Önce yalnız sessizlik bulucunun kodu yazılıyordu; yazıya dökme, model indirme, bulut
  sesi ve önizleme hiç kayda geçmiyordu. Kayıt yalnız açık sekmenin belleğindedir (en çok 30 satır), sekme
  kapanınca gider; kullanıcı dosyayı indirmedikçe hiçbir yere gitmez. Dışa aktarma günlüğü (IndexedDB)
  **değişmedi**.

### Testler

- Birim (`tests/unit/workerWatch.test.ts`, 21): saat kuralı (gizliyken sayılmaz, dönüşte sıfırdan);
  bekçinin dört bitirişi sahte bir işleyiciyle (çökme, okunamayan ileti, yerinde sayma — yanıtlı ve yanıtsız —,
  durdurulmuş bekçi); eşiklerin olağan derlemede kısaltılamadığı; `caughtFailureDetail`'in **her aşama ×
  dört gizli değer** için, adı / metni / yığını / `fileName` / `cause` alanlarının hepsi o değer olan bir
  hatadan hiçbir şey taşımadığı; beş işin her biri için tanı dosyasında **her alana ayrı ayrı** dosya adı,
  yol, altyazı cümlesi ve `blob:` adresi konup çıktıda aranması; sayfanın kendi kaydının (uygulama durumu)
  girişte de denetlendiği.
- e2e (`tests/e2e/worker-failure.spec.ts`, 5; `tests/cloud/cloud-audio-failure.spec.ts`, 2): her iş için
  dört bozulma — işin içinde fırlatılan hata, işleyicinin kendi çökmesi, hatasız yerinde sayma,
  gönderilemeyen istek — bilerek yapılır (`window.__clipWorkerFault`, yalnız sınama derlemesinde; olağan
  derlemede okunmaz). Hata metnine bir yol ve dosya adı, bir altyazı cümlesi ve bir `blob:` adresi konur.
  Denetlenen: iş **biter**; cümle düz; "Ayrıntılar" kapalı gelir, açılınca beklenen satır; tanı dosyasında
  aynı değerler ve yalnız bilinen 15 alan; gizli parçaların **sayfanın HTML'inde, tarayıcıda saklananlarda
  (localStorage, sessionStorage, bütün IndexedDB satırları), uygulamanın konsol satırlarında ve tanı
  dosyasında olmadığı**; yerinde sayarken "Durdur"un hemen çalıştığı; hatasız yeniden denemenin çalıştığı;
  1 saniyelik eşikle bile sağlıklı bir işin bitirilmediği (ilerleme geldikçe sayaç sıfırlanır). Bulut
  testinde ayrıca vekile **hiçbir şey gönderilmediği**.
- Bir satır uygulamanın değildir ve testte biçiminden ayrılır: işleyici her tutucunun dışında hata
  fırlatınca (`crash`) **tarayıcının kendisi** o yakalanmamış hatayı kendi konsoluna yazar ("Uncaught …",
  testin fırlattığı metinle). Uygulama bu metni okumaz, yinelemez, saklamaz.

### Doğrulanmayanlar (ek)

- **Gerçek bir `messageerror`** tarayıcıda üretilemedi (okunamayan bir ileti göndermenin bir yolu
  bulunmadı); dinleyici birim testinde sahte bir olayla sınanır.
- **Eşiklerin yanlış alarmı** yavaş cihazda, telefonda, ağ sürücüsündeki dosyada **ölçülmedi.** Özellikle:
  büyük modelin (turbo, WebGPU) yavaş bir cihazda başlaması 10 dakikayı geçer mi; küçük modelle bir
  tanıyıcı çağrısı telefonda ne kadar sürer. Gerçek model bu koşularda **hiç çalıştırılmadı** (yerine geçen
  betik); tanıyıcı çağrısından sonraki yeni ilerleme iletisi gerçek modelle yalnız tür denetiminden geçti.
- **Gerçek yerinde sayma** (grafik ya da medya süreci ölünce) bu dört işte üretilmedi; yerinde sayma
  testin kendi yaptığı hatasız beklemedir. İndirmede ölçülen davranışın (hiç hata gelmez) bu işlerde de
  aynı olduğu varsayıldı.
- **Gizlenen sekme** tarayıcıda denenmedi (indirmedeki gibi: görünmez pencerede sayfa "gizli" olmuyor);
  kural birim testindedir.
- Gerçek Worker, gerçek sağlayıcı, gerçek telefon, kurucunun videoları: kullanılmadı.
