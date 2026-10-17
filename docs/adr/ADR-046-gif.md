# ADR-046 — "GIF yap": videonun bir kısmından, cihazda, yazılı GIF

> Tarih: 2026-10-17 · Durum: UYGULANDI (web; birim, e2e, kalite katmanı). Telefonda, Safari'de ve Firefox'ta
> denenmedi. Politika **değişti** (doc 15 `2026-10-17.v11`: GIF yap ücretsiz, cihazda, GIF başına en çok
> 10 saniye); şema değişmedi (EDL v5 — GIF ekranı proje saklamaz).
> Kaynak: kurucunun kararı (yeni kart "GIF yap", taslak tuvalinden seçenek **B "Tek ekran, yazı önizlemenin
> üstünde"**). Taslak ve uygulanan ekranlar: [`docs/ux/2026-10-17-gif/`](../ux/2026-10-17-gif/README.md).
> İlgili: [ADR-034](ADR-034-task-first-home.md) (iş kartları ve sihirbaz çatısı), [ADR-015] (altyazı yazı
> tipi: önizleme = dosya), [ADR-026] (kaydetme penceresi / indirme bağlantısı), [ADR-031] (Paylaş),
> [ADR-033] (çözücü kapanmadan kare çizilir), [ADR-040] (yarım dosya), [ADR-041] (büyütme yok),
> [ADR-042](ADR-042-export-failure-detail.md) (hata ayrıntısı ve bekçi), [ADR-022] (HDR).

## Bağlam

"gif yap", "gife çevir", "make a gif" 7 Ekim'den beri aramada dürüst bir "Bunu henüz yapamıyoruz."
alıyordu. Kurucu bunu on birinci kart yaptı: bir çocuk videodan kısa, yazılı, durmadan dönen bir GIF
yapabilmeli — tek ekran, sahte başarı yok, takılan çark yok.

## Karar

### Ekran (tasarım B)

Video seçildikten sonra **tek ekran** (sihirbazın 2. adımı): seçilen kısım önizlemede sessiz ve
durmadan döner; önizlemenin üstünde ve altında kesik çizgili iki yazı kutusu (dokun, yaz; boş = yazı
yok); altında videonun boyu kadar bir çubuk ve üstünde seçili kısım (en çok 10 sn); yanında
"4,0 sn · yaklaşık 141 KB"; "Boyut: Küçük / Orta"; tek düğme "GIF'i indir". 3. adım her sihirbazınki
gibi: gerçek ilerleme, İptal, "Kaydedildi", Paylaş, "Bir GIF daha yap", "Başka bir video", "Ana ekrana
dön". Uygulamanın kendi bileşenleri ve Quiet Studio belirteçleri (`wizard.css` "GIF yap" bölümü);
taslağın satır içi stilleri kullanılmadı. Taslaktan farklar ve ekran görüntüleri UX kaydında.

- **Yazı kutusu = GIF'teki yazı.** Kutu, GIF'in harfleriyle (altyazı yazı tipi Inter Bold — bütün Türkçe
  harfler içinde, ADR-015), GIF'teki boyuta ölçeklenmiş olarak yazar; satırı GIF'in kırdığı yerden kırar
  (düzen tek bir saf işlevde: `layoutGifText`; sayfa ve worker aynı yazı tipiyle ölçer). Beyaz harf,
  koyu kenar. Enter yeni satır değil "bitti"; en çok 40 harf.
- **Kısım çubuğu:** çubuğun tamamı kısmı taşıyan kaydırıcıdır (basıp sürükle; kısmın dışına basınca
  kısım oraya gelir), iki kenar ayrı kaydırıcılar (uzat / kısalt). Klavye: oklar 0,5 sn, Shift 2 sn,
  Home / End. 10 sn'yi aşmak istenince durur ve yazar: "GIF en çok 10 saniye olabilir." Video 10 sn'den
  kısaysa sınır videonun sonudur ve hiçbir şey söylenmez. En kısa kısım 0,5 sn (≈ 6 kare); daha kısa
  video bütünüyle alınır (0,1 sn'den kısası seçilirken zaten reddedilir, ADR-040 / fuzz).
- **Önizleme durdurulabilir** (kendiliğinden hareket eden içerik, WCAG 2.2.2).
- **Editöre geçiş yok:** "Daha fazla ayar → editörde aç" bu kartta gösterilmez; editör GIF yapmaz.
- **Ana ekran:** kart sayısı tek olunca öndeki kart iki yer kaplar (`leadWide`): telefonda Kes tam
  genişlikte, altında beş sıra ikili; masaüstünde 3 + 4 + 4. Hiçbir satırda tek kart kalmaz (10 Ekim
  kuralı). Kurucu kararına açık (aşağıda).

### Kodlama: tamamen cihazda, ayrı bir worker'da

`web/src/adapters/gif/gifWorker.ts` (kendi worker'ı; dışa aktarma worker'ına **dokunulmadı**). Çözme,
dışa aktarmanın yolu — ikinci bir yol değil: mediabunny `VideoSampleSink` ile tek sürekli geçiş
(`framePicker`: her GOP'ta boşaltma yok), çözücü son kare çizilene dek açık (`decoderHold`, ADR-033),
yarım dosya denetimi (`sourceIntegrity`, ADR-040), HDR kaynak float16 tuval + yumuşak kırpma ve önce
tarayıcının ton eşlemesi doğrulanır (`hdrCanvas`, `hdrProbe`, ADR-022; doğrulanmazsa dürüst ret).
`VideoSample.draw` dosyanın döndürmesini uygular. Kare GIF boyutunda çizilir (`imageSmoothingQuality:
'high'`), yazı her kareye çizilir, piksel okunur. Ortak kullanılan modüller yalnızca **içe aktarıldı**
(`adapters/export/**` içindeki hiçbir dosya değişmedi).

- **Bilinen boşluk:** dışa aktarmanın H.264 sıra derinliği düzeltmesi (`correctAvcReorder`, bazı
  GoPro/Ambarella dosyaları) `exportWorker.ts`'in içinde özel bir işlev; başka ajanın alanına dokunmamak
  için taşınmadı. Böyle bir dosyada GIF karelerinin sırası bozulabilir. Taşımak tek işlevlik bir iş
  (`avcReorder.ts`'e), dışa aktarma ajanının işi bitince.

### Kodlayıcı: `gifenc` 1.0.3 (MIT)

Seçenekler (npm kaydı, 17 Ekim): `gifenc` 1.0.3 (MIT, bağımlılığı yok, pakete giren 9 KB, son sürüm
2021/22), `modern-gif` 2.1.0 (MIT, 2026-04, `modern-palette`'e bağlı), `gif.js` 0.2.0 (2016, kendi
worker dosyasını ister), `omggif` 1.0.10 (yalnız LZW, renk seçimi yok), `gif-encoder-2` (Unlicense).
**`gifenc`** seçildi: en küçük, bağımlılıksız, yalnızca hesap yapar (ağ, dosya, `eval` yok), iyi bir
renk seçici (PnnQuant) ve hızlı LZW yazıcısı var, worker'da doğrudan çalışır. Bakımı etkin değil — ama
GIF89a donmuş bir biçim ve sarıldığı yer tek dosya (`gifEncode.ts`); gerekirse kendi yazıcımızla
değiştirilir. Kendi kodlayıcımızı yazmadık: LZW ve renk seçici ~400 satır sınanmış kod demek, kazancı
yok. `npm audit --omit=dev` eklendikten sonra **0**. Tipler bizim (`src/types/gifenc.d.ts`).
`docs/security/DEPENDENCIES.md` §1'de satırı var.

Uygulamanın kendi kararları `gifEncode.ts` ve `domain/gifPalette.ts`'te: **tek palet** (bütün
karelerden eşit aralıklı ~1 M piksel örnek; 253 renk + saf beyaz + saf siyah, yazı varsa; 255. giriş
saydamlık), **değişmeyen piksel saydam** (bir piksel ancak önceki karede aynı palet rengiyle çizildiyse:
hiçbir yaklaştırma yok), **titreşim (dithering) yok**, her kare 8/100 sn, NETSCAPE döngü bloğu
"sonsuz". Sayfa, kaydetmeden önce GIF'i yapısıyla geri okur (`inspectGif`: imza, mantıksal ekran,
kare sayısı, döngü bloğu, gecikmeler); kare sayısı tutmazsa "Kaydedildi" denmez.

### Palet, titreşim, kare hızı — ölçüm

Yöntem: dört yapay kaynak (ffmpeg; gerçek çekim değil — `web/tests/media/real/` kullanılmadı):
`desen` (testsrc2, düz renkler, hareketli), `yumusak` (gradients + hafif kumlanma), `kaydirma`
(Mandelbrot üzerinde yatay kaydırma + kumlanma), `gurultulu` (yakınlaşan Mandelbrot + yoğun
kumlanma). 320 px, 4 sn, 12,5 kare/sn; Node'da aynı kod (`gifPalette` + `gifenc`). Kalite: PSNR ve
"bulanık PSNR" (iki resim de 5 × 5 kutu bulanıklığından sonra: titreşim gürültüsü ortalanır, bantlaşma
kalır).

| Kaynak | Kare başı palet, titreşimsiz | Kare başı, Bayer | Kare başı, Floyd–Steinberg | **Tek palet + saydam, titreşimsiz** | Tek + Bayer | Tek + F–S |
|---|---|---|---|---|---|---|
| desen | 0,35 MB · 49,6 dB · 0,9 s | 0,41 · 46,3 | 0,38 · 56,5 · 5,5 s | **0,19 MB · 50,7 dB · 0,6 s** | 0,20 · 50,7 | 0,22 · 52,3 · 3,2 s |
| yumusak | 0,91 · 53,9 | 1,28 · 43,9 | 1,38 · 56,7 | **0,95 · 51,5 · 0,3 s** | 1,23 · 43,6 | 1,61 · 57,9 |
| kaydirma | 1,21 · 43,3 · 8,0 s | 1,48 · 43,7 | 1,48 · 47,0 · 10,2 s | **1,21 · 41,5 · 1,3 s** | 1,42 · 42,4 | 1,55 · 45,7 · 4,0 s |
| gurultulu | 1,30 · 43,4 · 8,0 s | 1,55 · 43,9 | 1,55 · 46,5 · 10,5 s | **1,24 · 41,7 · 0,9 s** | 1,40 · 42,5 | 1,55 · 44,0 · 4,3 s |

(boyut · bulanık PSNR · süre; bu ölçüm 5 bitlik renk önbelleğiyle yapıldı, uygulamadaki 6 bit.)

- **Tek palet + saydam:** üç kaynakta kare başı paletten küçük ya da eşit (`desen`de yarısı),
  `yumusak`ta %4 büyük; kumlu / ayrıntılı görüntüde **6–7 kat hızlı** (kare başı renk seçimi orada kare
  başına ~160 ms), düz görüntüde 1,5–2,5 kat. Bedeli: bulanık PSNR'de 0–2,4 dB (kare başı palet her
  kareye kendi renklerini seçer). Ayrıca renkler kareden kareye titremez.
- **Titreşim yok:** Bayer deseni düz ve yumuşak alanda ızgara olarak göründü (`yumusak`ta bulanık PSNR
  51,5 → 43,6 dB — desen renkleri kaydırdı) ve tek palette dosyayı %5–29 büyüttü; Floyd–Steinberg bantları
  en iyi kapattı ama dosyayı %16–69 büyüttü, 3–10 kat yavaştı ve gürültüsü kareden kareye yer
  değiştirdiği için "değişmeyen piksel" kazancını yok etti. 255 renklik tek palet bu boyutlarda
  `yumusak`ın bir karesinde göze batan bant bırakmadı (dört yolun karesi yan yana büyütülüp bakıldı).
  Kurucu kararına açık: titreşimsiz GIF'te çok yumuşak gökyüzü gibi yerlerde hafif bant görülebilir.
- **12,5 kare/sn** (8/100 sn): GIF gecikmeyi yüzde bir saniye cinsinden yazar; 12,5 kesin (15 kare/sn
  7, 7, 6 … ister). Aynı kaynaklarda (Orta, 10 sn) 15 kare/sn dosyayı %13–22 büyüttü (`gurultulu`
  5,40 → 6,51 MB), 10 kare/sn %15–21 küçülttü. Seçim ikisinin ortası; hareketin akıcılığı ayrıca bir
  izleyiciyle değerlendirilmedi.
- **Boyutlar:** "Küçük" uzun kenar 320 (varsayılan), "Orta" 480; hiçbiri videodan büyük değil (ADR-041:
  640 × 360 videoda Orta 480 × 270, 300 × 200 videoda tek boyut 300 × 200 ve ekran yalnızca bunu söyler).

### Uygulamadaki boyutlar ve süre (bu makine)

Uygulamanın kendi düğmesinden (`/yap/gif`, Playwright Chromium, Windows; aynı dört yapay kaynak,
1280 × 720, 30 kare/sn; kısım 2–6 sn ya da 0–10 sn, yazısız). Tahmin = ekranın söylediği sayı; süre =
"GIF'i indir"e basıştan "Kaydedildi"ye (kaydetme penceresi taklitti, dosya tarayıcının kendi deposuna
yazıldı):

| Kaynak | Küçük 4 sn | Küçük 10 sn | Orta 4 sn | Orta 10 sn |
|---|---|---|---|---|
| desen (düz renk) | 225 KB · tahmin ×0,96 · 0,9 s | 523 KB · ×0,94 · 3,1 s | 443 KB · ×1,00 · 1,3 s | 1,06 MB · ×0,96 · 2,4 s |
| yumusak (yumuşak geçiş) | 1,26 MB · ×0,98 · 0,8 s | 3,16 MB · ×0,97 · 1,3 s | 2,62 MB · ×0,98 · 0,8 s | 6,62 MB · ×0,96 · 1,8 s |
| kaydirma (kaydırma, kumlu) | 1,28 MB · ×1,02 · 1,9 s | 2,56 MB · ×1,05 · 2,8 s | 2,59 MB · ×1,02 · 2,4 s | 5,25 MB · ×1,09 · 4,4 s |
| gurultulu (yoğun kumlu) | 1,23 MB · ×1,01 · 2,4 s | 2,99 MB · ×1,08 · 4,9 s | 2,53 MB · ×1,01 · 1,8 s | 6,12 MB · ×1,09 · 3,3 s |

(×: gerçek boyut ÷ tahmin.) Tahmin 16 ölçümün hepsinde gerçeğin %6 altı ile %10 üstü arasında; en çok
yanıldığı yer, kısım boyunca görüntünün çok değiştiği uzun GIF (gerçek tahminden büyük çıkıyor: ekran
"yaklaşık" der). Tahminin kendisi 1,3–4,8 sn sürüyor (dört kez kısa çözme); bu sürede yazı
"boyutu hesaplanıyor…" der, düğme beklemez. Bir GIF yapmak bu masaüstünde **0,8–4,9 sn** sürdü
(10 sn Orta, yazısız; zaman çoğunlukla karelerin çözülmesi). Örnek videoyla (sample-24s, test deseni)
e2e'de: 4 sn Küçük yazılı 172 KB (tahmin 168 KB, ×1,03), 10 sn Orta 745 KB, 3,2 sn.

### "yaklaşık 3 MB": ölçülür, tahmin edilmez

Kısım, boyut ya da yazı değişip 0,45 sn durunca ayrı bir worker kısmın **dört yerinden ikişer ardışık
kare** çözer, onlardan bir palet seçer ve GIF'in kendi yoluyla kodlar: ilk kare bütün bir resmin,
ikincisi "değişmeyen piksel saydam" ile sonraki her karenin bedelidir. Tahmin = sabit baş + ilk kare +
(kare sayısı − 1) × sonraki kare (`estimateGifBytes`). Ekran sayının hangi seçime ait olduğunu bilir;
eski seçimin sayısı yenisi diye gösterilmez ("boyutu hesaplanıyor…"). Tahmin çalışmazsa ekran bunu söyler
ve yine de yapmayı dener; tahminin kanıtladığı bir ret (görüntü izi yok, çözülemiyor, yarım dosya, HDR
doğrulanmadı, kare çözülmedi) "GIF'i indir"i bekletir ve sebebini söyler.

### Yazı

Klasik "meme" yazısı: kalın sans (Inter Bold), beyaz, koyu kenar (yazı boyunun ≈ %9'u), ortalı,
üstte ya da altta; en büyük harf boyu GIF yüksekliğinin %14'ü ve genişliğin %13'ü; sığmazsa harf küçülür,
iki satıra kırılır (kelime arasından; tek başına satırdan uzun kelime harf arasından — Türkçe harfler
tek kod noktası, emoji bölünmez). En küçük harf 13 px (telefonda önizlemede ≥ 14 px). En küçük harfte
de iki satıra sığmayan yazı (ör. 40 tane "W") ikinci satırın sonunda "…" ile biter ve ekran bunu
söyler. **Büyük harfe çevrilmez:** yazılan neyse GIF'te o (kurucu kararına açık).

### Sınırlar ve dürüstlük

- Ses dosyası, tek kare, bozuk dizin, yarım dosya: seçerken reddedilir, ekranların kendi cümleleriyle
  (`fileKind`, ADR-040).
- İlerleme gerçektir: "Kareler hazırlanıyor: 23 / 50", sonra "GIF yazılıyor: 23 / 50" (çubuk %85 / %15).
- İptal worker'ı sonlandırır; kaydetme penceresinin oluşturduğu boş dosya silinir.
- ADR-042: worker hatası, okunamayan mesaj ya da 60 sn sessizlik (sayfa görünürken) işi bitirir;
  "Beklenmeyen bir hata oluştu" + "Ayrıntılar" (`GifFailure` / `gif_encode` yeni değerler; hiçbir
  hata metni taşınmaz) + "Sorun bildir". Test kancası `window.__clipWorkerFault = { worker: 'gif', … }`.
- Dosya adı `<video>_gif.gif`; kaydetme penceresi (File System Access) ya da indirme bağlantısı
  (ADR-026); "Paylaş" tarayıcı GIF paylaşabiliyorsa (ADR-031; Chromium 50 MiB sınırı aynen).
- Saklanan bir şey yok: GIF ekranı proje kaydetmez; gizlilik sayfası değişmedi.

## Arama

`gif` artık bir kart: "gif yap", "gife çevir", "make a gif", "hareketli resim yap" kendinden emin bir
cevapla GIF yap'ı açar (eminlik kuralı — rule 12 — değişmedi; birim testi). "sticker" / "çıkartma"
önceden bu girdinin kelimesiydi; bir sohbet uygulamasının çıkartması başka biçim ve boyutta bir
resimdir ve bu kart onu yapmaz: ayrı bir "henüz yapamıyoruz" girdisi oldu (`sticker`, "Çıkartma yap").
"animasyon" / "animated" yalnızca destekleyici (ör. "intro animasyonu" GIF değil). Değerlendirme
kümelerinde GIF ifadelerinin doğru cevabı `cannot` → `gif` yapıldı (cevap değişti, ifade değil); hiçbir
kümenin kaçırdıklarına bakılıp kelime eklenmedi.

Ölçüm (`tests/quality/lib/searchEval.ts`'in aritmetiği, kalite katmanının kümeleri; önce = `c96c60e`,
eski beklentilerle; sonra = bu dal, yeni beklentilerle). "Doğrudan doğru" = tek kart, doğru iş;
`fresh` = kör küme (`search-eval-fresh3.ts`, bir kez ölçüldü; kaçırdıkları raporlarda basıldığı için
artık "görülmüş" sayılır):

| Küme (sayılan) | Doğrudan doğru | Yanlış ama emin | Sordu | "Henüz yapamıyoruz" isabet / kesinlik |
|---|---|---|---|---|
| fresh (202; iş ifadesi 148 → 149) | %54,1 → **%53,7** | %3,0 → %3,0 | %25,2 → %25,7 | %88,0 / %88,2 → %87,5 / %87,5 |
| ikinci fresh (209) | %58,1 → %58,1 | %1,0 → %1,0 | %27,8 → %27,3 | %83,9 / %91,2 → %87,1 / %91,4 |
| ilk fresh (139) | %80,4 → %80,6 | %0 → %0 | %13,7 → %13,7 | %100 / %100 → aynı |
| eski held-out (225) | %80,2 → %80,3 | %0,9 → %0,9 | %11,6 → %11,6 | %100 / %97,4 → aynı |
| dev (85) | %85,9 → %86,2 | %0 → %0 | %16,5 → %16,5 | %100 / %92,3 → %100 / %91,7 |

Kör kümede sayılan tek GIF ifadesi ("vidyodan hareketli resim yapcam caps gibi") artık "Bunu mu demek
istedin?" ile tek seçenek olarak GIF yap'ı gösteriyor (doğrudan değil; "gif yap" tabloda görülmüş
olduğu için sayılmıyor). Yüzdedeki 0,4 puanlık düşüş paydanın büyümesidir (bir ifade "yapamıyoruz"dan
işe geçti, o da sorularak cevaplandı). Eminlik kuralı (12) aynen: "Bunu henüz yapamıyoruz." hiçbir
zaman soruya dönmüyor (birim testi "çıkartma" ile), GIF ifadeleri emin cevap (yeni birim testi). Tutulan
tablolar (`taskSearch*.test.ts`) yeşil; tabloya beş "sticker" ifadesi eklendi (hiçbiri bir
değerlendirme kümesinde yok).

## Değişen dosyalar (özet)

- Yeni: `src/domain/gif.ts`, `gifPalette.ts`, `gifInspect.ts`; `src/adapters/gif/` (worker, protokol,
  istemci, kodlayıcı, yazı); `src/components/gif/` (ekran, kısım çubuğu, sonuç kartı, kancalar);
  `src/adapters/saveFile.ts` (kaydetme penceresi yardımcıları `useDownloads`'tan taşındı; davranış
  aynı); `src/types/gifenc.d.ts`.
- Değişen: `tasks.ts` (kart, `sticker`), `wizards.tsx`, `WizardFlow.tsx` (`ownDownload`),
  `TaskFinder.tsx` + `home.css` (`leadWide`), `wizard.css`, `Icon.tsx` (`taskGif`), `policy.ts` (v11,
  `maxGifDurationUs`), `workerWatch.ts` (`gif`), `exportFailureDetail.ts` (`gif_encode`, `GifFailure`),
  mesajlar (TR + EN).
- Dokunulmayan: `src/adapters/export/**` (yalnızca içe aktarıldı).

## Sınamalar

Hepsi yerel, bu dalın son koduyla (Windows, Playwright Chromium):

- `tsc`, `eslint` temiz; birim **1512 / 1512** (88 dosya; yeni `gif.test.ts` 26 sınama: kısım, kare
  zamanları, boyut planı, dosya adı, tahmin aritmetiği, yazı temizleme / kırma / sığdırma / "…", Türkçe
  harf ve emoji bölünmez, palet eşleme, saydamlık, gifenc ile yazılan GIF'in yapısı, beyaz/siyah palette,
  değişmeyen kare ucuz, bozuk GIF reddedilir; politika v11 testi; arama tabloları).
- Olağan e2e (`CLIP_TEST_HOOKS=1`, port 3194, kilit altında): **444: 438 geçti, 4 atlandı, 2 başarısız** —
  ikisi de sınamanın kendi izin listesinde `/yap/gif` yoktu (gizlilik "yalnızca uygulama dosyaları",
  PWA "yalnızca bu derlemenin dosyaları"); liste düzeltildi, iki dosya yeniden koşuldu: 26 / 26. Sonra
  `src` değişmedi. `PAGE-RECOVERED-TOTAL 1` (Yazıya dök'ün büyük model sınamasında bir sayfa yüklemesi;
  GIF'le ilgisi yok), `PAGE-DEAD-TOTAL 0` (bekçinin kendi sınamalarındaki bilerek yapılanlar hariç).
  Bunların içinde yeni `gif.spec.ts` (9) ve `gif-a11y.spec.ts` (3).
- Bulut e2e (sahte vekil): **59: 55 geçti, 4 atlandı, 0 başarısız**; `PAGE-RECOVERED-TOTAL 0`.
- Varsayılan durağan çıktı (`/capcut`, CI'ın iletişim / barındırma değerleriyle) + Pages duman: **14: 8 geçti,
  6 atlandı (bulut ön uçuşu ve modeller), 0 başarısız**; yeni sınama: `/capcut/` altında GIF (worker, yazı
  tipi, kaydedilen dosya, içerik politikası, dışarıya istek yok).
- `npm run quality`: 676 ölçü, 598 bütçe içinde, 8 dışında (hepsi önceden açık), farklı ekran 0 (iki `ana-ekran`
  tabanı fark resmine bakılarak yenilendi). `npm audit --omit=dev`: 0.

## Doğrulanmayanlar

- Gerçek telefon (Android Chrome, iOS Safari), Safari ve Firefox: yalnızca Windows'ta Playwright
  Chromium. Firefox'ta WebCodecs çözücüsü var, `OffscreenCanvas` var; çalışması beklenir ama
  denenmedi. WebKit derlemesinde WebCodecs yok: video seçilebilir, GIF yapılamaz ("Bu tarayıcı kaynak
  videoyu çözemiyor" — denenmedi).
- Gerçek çekim görüntüsünde boyut ve tahmin isabeti (ölçüm yapay görüntüyle).
- HDR kaynaktan GIF (yol dışa aktarmanınki; GIF için ayrıca sınanmadı).
- H.264 sıra derinliği düzeltmesi gereken kamera dosyaları (yukarıda "Bilinen boşluk").
- Çok uzun videoda (ör. 2 saat) çubuk kaba: 1 piksel ≈ 20 sn; kısmı klavyeyle ya da kenarları sürükleyerek
  inceltmek gerekir. Yakınlaştırılan bir çubuk yapılmadı.

## Kurucu kararları

1. **Ana ekranda öndeki kart iki yer kaplıyor** (tek kart kalmasın diye). Alternatif: son satırda tek kart.
2. **Titreşim yok.** Çok yumuşak geçişlerde hafif bant olabilir; titreşimli seçenek dosyayı büyütür.
3. **Yazı büyük harfe çevrilmiyor** (klasik "meme" büyük harftir). İstenirse `toLocaleUpperCase('tr')`
   ile tek satır.
4. ~~**Varsayılan kısım ilk 4 saniye.**~~ **Karar (17 Ekim, ana oturum):** 10 saniyeye sığan video bütünüyle seçili gelir; daha uzunu ilk 4 saniyeyle başlar (`initialGifRange`).
5. **Sticker ayrı "henüz yapamıyoruz" girdisi** oldu. WhatsApp çıkartması (512 × 512 WebP) ayrı bir iş.
6. `gifenc`'in bakımı etkin değil; yerine kendi kodlayıcımız gerekirse tek dosya.
