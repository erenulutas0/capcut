# ADR-042 — Beklenmeyen indirme hatası: nerede ve ne tür olduğu kaydedilir, metni asla

> Tarih: 2026-10-12 · Durum: UYGULANDI (birim ve e2e testleri). **11 Ekim olayının nedeni BULUNAMADI**
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
| `videoEncoder`, `videoDecoder`, `audioEncoder` | **Gerçekten yapılandırılan** codec dizgisi ve `hardwareAcceleration` isteği (kodlayıcı: mediabunny'nin `onEncoderConfig` çağrısından; çözücü: mediabunny'nin kurduğu sarmalayıcıdan, kendi tarayıcı düzeltmelerinden sonra) |
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
- **Diğer işleyiciler** (sessizlik, cihazda yazıya dökme, bulut sesi, İyileştir önizlemesi) hâlâ yalnız
  `internal_error` der; bu karar onlara uygulanmadı.
- Kalite katmanı (`npm run quality`), Pages duman sınaması, tarayıcı matrisi, gerçek telefon: koşulmadı.
