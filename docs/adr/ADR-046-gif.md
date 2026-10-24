# ADR-046 — "GIF yap": videonun bir kısmından, cihazda, yazılı GIF

> Tarih: 2026-10-17 · Durum: UYGULANDI (web; birim, e2e, kalite katmanı). Telefonda, Safari'de ve Firefox'ta
> denenmedi. Politika **değişti** (doc 15 `2026-10-17.v11`: GIF yap ücretsiz, cihazda, GIF başına en çok
> 10 saniye); şema değişmedi (EDL v5 — GIF ekranı proje saklamaz).
> **Ek, 19–20 Ekim 2026** (en altta): gerçek telefon kayıtlarıyla ölçüm; renk yöntemi ve 12,5 kare/sn
> değişmedi; yeni boyut "Büyük" (640), varsayılan "Orta" (kurucu kararı), 10 MB üstü uyarı, tahmin 8 × 3
> kare; telefonda her sihirbazın ana düğmesi ekranın altında.
> **Ek, 21 Ekim 2026** (en altta): bellek — 8 GB'tan az ya da belleğini söylemeyen cihazda 32 MiB'tan çok karesi olan
> GIF iki geçişle, kare tutmadan yapılır (aynı baytlar); bellek yetmeyince GIF'in kendi cümlesi.
> **Ek 2, 21 Ekim 2026** (en altta): kareler tarayıcının kendisiyle çizilip ölçüldü; dördüncü boyut "Çok büyük"
> (960); küçültme, keskinleştirme, eşikli saydamlık, kırpma ön kayıtlı kuralı geçmedi; 1280 / 1920 sunulmadı.
> **Ek 3, 24 Ekim 2026** (en altta): ana oturumun kararıyla (kurucu devretti) her GIF karesi küçültmeden sonra 0,25
> güçte keskinleştirilir (`high+s0.25`) — Ek 2'nin ön kayıtlı kuralı bunu ince farkla geçirmemişti; geçersiz kılma ve
> gerekçesi orada. Tahmin keskinleştirmeyi içerir, ±%10 yeniden ölçüldü.
> **Sonra: [ADR-052](ADR-052-gif-sharpest.md) (21 Ekim 2026):** varsayılan "Orta" değil, ölçülen tahmini 10 MB'ı
> geçmeyen en büyük boyut; kartta ikinci çıktı "Video olarak (en net)" (aynı kısım ve yazı, olağan MP4 indirmesiyle).
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

---

## Ek — 19 Ekim 2026: gerçek çekimde görüntü kalitesi (kurucunun telefonu)

Kurucu S23'te galeriden paylaştığı gerçek bir telefon videosundan GIF yaptı: "görüntü kalitesi baya kötü
çıktı ama sevdim, bunu düzeltebilir miyiz". Yukarıdaki palet / titreşim kararları yalnızca dört yapay
kaynakta ölçülmüştü. Gerçek kamera görüntüsü (ten, yumuşak geçiş, az ışık, kumlanma) 256 renklik tek bir
paletin titreşimsiz en kötü göründüğü yer; ayrıca dikey videoda "Küçük" 180 × 320 piksel — telefon
ekranında 1080 piksel genişliğe büyütülür.

### Ön kayıt (ölçümden ÖNCE yazıldı; bu bölüm ölçüm sonuçlarından sonra değiştirilmedi)

**Görüntüler.** (1) *Gerçek:* yerelde duran gerçek telefon kayıtları (`web/tests/media/real/`, depoda yok;
yalnızca ölçüm için okunur; burada ve her yerde R1, R2 … diye anılır — dosya adı, kare, küçük resim
depoya girmez). HDR kaynaklar (HLG/PQ) dışarıda: GIF yolu onları ayrı ton eşlemeyle çizer. Az ışık için
iki gerçek kaydın karartılmış + kumlanma eklenmiş kopyası (R-karanlık; yalnızca yerel). (2) *Yapay:* eski
tablonun dört kaynağı (`desen`, `yumusak`, `kaydirma`, `gurultulu`; ffmpeg komutları kayıtlı olmadığı için
aynı tarife göre yeniden üretildi — eski sayılarla doğrudan değil, aynı tablodaki "bugünkü" sütunla
karşılaştırılır) ve bir "kamera benzeri" yapay kaynak (yumuşak renk geçişi + kesirli gürültü + bulanıklık
+ az ışık eğrisi + zamanla değişen kumlanma).

**Yöntem.** Kaynak, uygulamanın çizdiği boyutta ve kare zamanlarında ffmpeg ile RGBA karelere çevrilir
(döndürme uygulanır, Lanczos küçültme); her aday bu karelerden Node'da uygulamanın kendi koduyla (aynı
`gifenc`, aynı eşleme) GIF yazar; GIF ffmpeg'in GIF çözücüsüyle geri açılır (saydamlık ve "atma" kuralları
uygulanmış kareler) ve aynı boyuttaki kaynak karelerle karşılaştırılır.

**Ölçüler.**
- **SSIM** (ffmpeg `ssim`, yuv420p, "All") ve **VMAF** (libvmaf v0.6.1, GIF'in kendi boyutunda): renk
  azaltmanın sadakati.
- **Bant (ΔCAMBI):** Netflix'in bant ölçüsü CAMBI (libvmaf `cambi`, referanssız; 0 = bant yok, ~5 üstü
  göze batar). Ölçü: CAMBI(GIF) − CAMBI(kaynak kareleri) — kaynağın kendi bandı çıkarılır, GIF'in eklediği
  kalır.
- **Telefonda görünen (VMAF-tel):** GIF ve kaynak video, ikisi de kısa kenarı 1080 piksel olacak biçimde
  (telefon ekranının genişliği) bikübik büyütülüp VMAF. Yalnızca boyut seçeneklerini karşılaştırmak için
  (aynı boyuttaki karşılaştırma çözünürlük kaybını görmez).
- **Boyut** (bayt) ve **süre:** palet + eşleme + LZW, bu masaüstünde Node'da, tek iş parçacığı (kare çözme
  hariç; her adayda aynıdır).

**Adaylar.** Palet: tek palet (bugün) / kare başı palet / daha çok örnekten tek palet / PnnQuant'tan sonra
algısal uzayda birkaç k-means adımı. Titreşim: yok (bugün) / Floyd–Steinberg (yılan, güç 1, 0,75, 0,5) /
sıralı: Bayer 8 × 8, mavi gürültü (void-and-cluster 64 × 64), R2 dizisi — sıralı titreşim yer başına
sabittir, değişmeyen piksel değişmeyen kalır. Saydamlık: tam eşitlik (bugün) / eşikli ("rengi gösterilen
renge şu kadar yakınsa değişmemiş say"; eşik T birkaç değerde). Kare hızı 12,5 / 15. Boyut: uzun kenar 320
/ 480 / 640.

**Karar kuralı.**
1. *Yöntem* (palet + titreşim + saydamlık), Küçük 4 sn, 12,5 kare/sn, gerçek kümede ortanca:
   - **Uygun** olmak için: (a) SSIM bugünkünden en çok 0,002, VMAF en çok 1,0 puan düşük — gerçek **ve**
     yapay kümede; (b) boyut: aynı yöntemle 10 sn Küçük gerçek kümede ortanca ≤ 5 MB, 10 sn Orta ortanca
     ≤ 8 MB ve en büyüğü ≤ 10 MB (Discord'un ücretsiz yükleme sınırı 10 MB; X/Twitter GIF 15 MB; WhatsApp
     GIF'i videoya çevirir, 16 MB); (c) süre: 4 sn Küçük ≤ 0,6 sn, 10 sn Orta ≤ 3 sn (bu masaüstü, Node;
     telefon ~3 kat yavaş varsayılır).
   - Uygunlar içinde **kazanan:** gerçek kümede en düşük ortanca ΔCAMBI; en iyiye 0,2 içinde olanlar
     arasında en yüksek ortanca VMAF; o da eşitse en küçük ortanca boyut.
   - Kazanan bugünkünün yerine **ancak** ortanca ΔCAMBI'yi en az %30 düşürüyorsa ya da ortanca VMAF'ı en az
     2 puan artırıyorsa geçer; yoksa bugünkü yöntem kalır.
2. *Kare hızı:* hareketin akıcılığını ölçen bir ölçümüz yok; 15 kare/sn ancak gerçek kümede ortanca boyut
   bedeli ≤ %10 ise alınır (15 kare/sn GIF'te tam değil: 7, 7, 6 / 100 sn).
3. *Boyutlar:* varsayılan, kazanan yöntemle 10 sn GIF'i gerçek kümede ortanca ≤ 5 MB olan en büyük boyut.
   Bir üst boyut ("Büyük", 640) ancak VMAF-tel'i bir altındakinden ortanca ≥ 3 puan yüksekse, 10 sn ortancası
   ≤ 15 MB ise ve 10 sn'lik karelerin bellekte tutulan hali ≤ 300 MB ise eklenir. Ekrandaki tahmin her
   boyutta gerçek dosyanın ±%10'u içinde kalmalı (yeniden ölçülür).

Sonuçlar ve uygulanan karar bu bölümün altına eklenir.

### Sonuçlar (19–20 Ekim; ölçüm bu masaüstünde, `web/scripts/gif-eval/`)

Kümeler: **gerçek** = 11 gerçek telefon kaydı (R1–R11: yedisi dikey, ikisi HEVC, 30–120 kare/sn; üçü
iPhone, biri Pixel, ikisi Samsung, biri GoPro, dördü sosyal medya videosu) + iki az ışık kopyası (K1, K2:
iki gerçek kaydın karartılıp kumlandırılmışı) = 13; R2 4,4 sn olduğu için 10 sn ölçümlerinde yok (12).
**yapay** = S1 `desen`, S2 `yumusak`, S3 `kaydirma`, S4 `gurultulu`, S5 kamera benzeri dikey az ışık.
Değerler ortanca. Süreler dört ölçüm aynı anda koşarken alındı (kaba; tek başına daha kısa).
Aday A, uygulamanın kodlayıcısıyla bayt bayt aynı GIF'i yazar (bir kez denetlendi).

**1. Yöntem** (Küçük, 4 sn, 12,5 kare/sn):

| Aday | Gerçek: SSIM · VMAF · ΔCAMBI · boyut · süre | Yapay: SSIM · VMAF · ΔCAMBI · boyut |
|---|---|---|
| **A — bugünkü** (tek palet, titreşimsiz, tam eşitlikte saydam) | **0,9808 · 99,2 · 0,01 · 1,65 MB · 248 ms** | **0,9887 · 92,9 · 0,09 · 1,21 MB** |
| Kare başı palet | 0,9823 · 99,5 · 0,02 · 1,70 · **864 ms** | 0,9904 · 93,4 · 0,08 · 1,21 |
| 4 kat örnekten tek palet | 0,9805 · 99,6 · 0,01 · 1,62 · 237 | 0,9887 · 92,8 · 0,08 · 1,21 |
| PnnQuant + 3 k-means adımı | 0,9822 · 98,8 · 0,02 · 1,71 · 225 | 0,9915 · 94,0 · 0,06 · 1,24 |
| Floyd–Steinberg 1 / 0,75 / 0,5 | 0,9573 / 0,9722 / 0,9771 · 99,4–99,5 · 0,00–0,07 · 1,82–2,02 · 354–470 | 0,9822–0,9880 · 94,3–94,7 · 0,05–0,06 · 1,36–1,53 |
| Sıralı: Bayer 12 / mavi gürültü 8, 12, 16 / R2 12 | 0,9424–0,9701 · 98,4–99,1 · −0,02–0,00 · 1,83–1,91 | 0,9431–0,9711 · 92,0–92,7 · −0,00–0,07 · 1,20–1,39 |
| Eşikli saydamlık T 3 / 6 | 0,9774 / 0,9668 · 98,3 / 97,1 · 0,02 · 1,27 / 0,99 · 204–223 | 0,9801 / 0,9638 · 91,9 / 89,9 · 0,17 · 0,74 / 0,46 |
| Titreşim + eşik (mavi 12, F–S 0,75; T 3, 6; k-means'li) | 0,9459–0,9711 · 96,8–99,1 · −0,02–0,04 · 1,04–1,43 | 0,9390–0,9792 · 89,3–95,5 · −0,00–0,08 · 0,51–0,94 |

(ΔCAMBI: GIF'in kaynağın kendi bandına eklediği bant; 0 = yok, ~5 göze batar.)

- **Kural uygulandı:** titreşimlerin ve eşikli saydamlığın hepsi SSIM sınırını (−0,002) aştı; kare başı
  palet süre sınırını (0,6 sn). Sınırların içinde kalan iki aday (4 kat örnek, k-means) bant ölçüsünde
  A'yla aynı (0,01–0,02; en iyiye 0,2 içinde), VMAF'ı en yüksek olan (4 kat örnek, +0,4) ne bandı %30 azaltıyor
  ne VMAF'ı 2 puan artırıyor → **yöntem değişmedi.** Gerçek görüntüde, GIF'in kendi boyutunda, 255 renklik
  tek palet neredeyse hiç bant eklemiyor (13 kaydın en kötüsü K2: +0,65); bant yalnızca yapay yumuşak
  geçişte (S2: 4,45; titreşim onu 0'a indiriyor) belirgin.
- Ayrıca: bugünkü yöntem **boyut sınırını gerçek görüntüde aşıyor** — 10 sn Orta ortanca 8,28 MB, en büyüğü
  11,3 MB (sınır 8 / 10 MB); kuralda (b) her aday için yazılmıştı, A'yı da tutmuyor. Hiçbir aday (b)'yi
  geçmedi (eşikli saydamlık T 3: 6,71 MB ortanca ama en büyüğü 10,07 MB ve SSIM'i sınırın dışında).

**2. Kare hızı:** 15 kare/sn gerçek kümede dosyayı ortanca **%19,5** büyüttü (13 kaydın hepsinde %14–21);
sınır %10 → **12,5 kalıyor.**

**3. Boyut — telefonda görünen** (VMAF-tel: GIF ve kaynak, kısa kenarı 1080 olacak biçimde büyütülüp; 4 sn):

| | Küçük (320) | Orta (480) | Büyük (640) |
|---|---|---|---|
| Gerçek, VMAF-tel | **36,2** | **62,1** | **77,5** |
| — dikey (7) / yatay (6) | 26,7 / 38,4 | 56,0 / 62,9 | 77,5 / 78,6 |
| Yapay, VMAF-tel | 36,8 | 57,9 | 73,9 |
| Gerçek, 4 sn boyut (ortanca / en çok) | 1,65 / 2,51 MB | 3,44 / 5,65 MB | 5,93 / 10,08 MB |
| Gerçek, 10 sn boyut (ortanca / en çok) | 3,90 / 5,09 MB | 8,28 / 11,31 MB | 14,12 / 20,02 MB |
| Yapay, 10 sn boyut (ortanca / en çok) | 3,03 / 3,89 MB | 7,15 / 9,93 MB | 13,65 / 19,67 MB |
| 10 sn kodlama süresi, gerçek (bu masaüstü, Node) | 0,43 sn | 0,86 sn | 1,48 sn |

**Bulgu:** kurucunun "kalite kötü"sünün asıl sebebi renk değil **boyut**: dikey bir telefon videosu
Küçük'te 180 × 320 piksel ve telefon ekranında 6 kat büyütülür (VMAF-tel 26,7). Hiçbir palet / titreşim
seçimi VMAF-tel'i 3 puandan fazla oynatmadı (A 36,2; F–S 0,5 36,3; T 3 33,1; F–S 0,75 + T 3 34,3); bir üst
boyut 15–26 puan.

- **Kural uygulandı (boyutlar):** varsayılan = 10 sn ortancası ≤ 5 MB olan en büyük boyut → **Küçük**
  (3,90 MB; Orta 8,28). "Büyük": VMAF-tel Orta'dan +15,4 (≥ 3), 10 sn ortanca 14,12 MB (≤ 15), 10 sn'lik
  kareler bellekte 640 × 360 × 4 × 125 = 115 MB (≤ 300) → **eklendi.**
- **Kurucu kararı (20 Ekim, ana oturum aracılığıyla) — kuralın varsayılan sonucunu geçersiz kıldı:**
  varsayılan **Orta** (video izin veriyorsa; yoksa videonun kendi boyutu), çünkü kurucunun şikâyeti
  telefonda netlikti. Bedeli dürüstçe: 10 sn Orta gerçek görüntüde ortanca 8,3 MB, en çok 11,3 MB. Bunun
  için, tahmin **10 MB'ı** (10 000 000 bayt, ekranın "10 MB"ı) geçince boyut seçiminin altında
  engellemeyen bir uyarı: "Bu GIF 10 MB'tan büyük olacak; bazı uygulamalar kabul etmeyebilir. Küçük
  seçebilir ya da süreyi kısaltabilirsin." Uzun videonun varsayılan kısmı 4 sn olduğundan çoğu GIF
  uyarısız kalır (4 sn Orta gerçek ortanca 3,44 MB, en çok 5,65).
- Döngülü MP4 ("Video olarak") **yapılmadı** (kurucu kararı: şimdilik yok).
- Ekranda boyutun altında tek satır: "Büyüdükçe GIF telefonda daha net görünür; dosyası da büyür."

Keşif (kurala girmedi, karar değil): eşikli saydamlık (T 3) gerçek görüntüde dosyayı %15–23 küçültüyor
(10 sn Orta 8,28 → 6,71 MB), VMAF'ta −0,4–0,6, SSIM'de −0,003 bedelle; boyut uyarısını seyreltmek için
bir sonraki aday olabilir, ama yeni bir ön kayıtla.

**Ekrandaki tahmin, uygulamada** (`/yap/gif`, Playwright Chromium, kaydetme penceresi yok; tahmin =
ekranın `data-bytes`'ı, gerçek = dosya; × = gerçek ÷ tahmin):

Dokuz gerçek kayıt (HEVC olan R1, R3 Playwright'ın Chromium'unda açılmıyor; R4, R5 yerine onlardan türeyen K1,
K2) ve beş yapay kaynak; kısım baştan 4 sn ya da 10 sn (R2 4,4 sn: bütünü). Hücre: dosya (MB) × gerçek ÷
tahmin, Küçük / Orta / Büyük. Son sütun: 10 sn Orta'yı yapma süresi · tahminin süresi (bu masaüstü).

| Kaynak | Küçük | 4 sn: Küçük / Orta / Büyük | 10 sn: Küçük / Orta / Büyük | Yapma · tahmin |
|---|---|---|---|---|
| R2 | 180 × 320 | 1,96 ×1,01 / 4,24 ×1,01 / 7,12 ×1,00 | 2,15 ×0,99 / 4,65 ×1,01 / 7,77 ×0,99 | 1,4 sn · 1,8 sn |
| R6 | 180 × 320 | 0,04 ×1,15 / 0,06 ×1,17 / 0,10 ×1,17 | 0,10 ×1,45 / 0,17 ×1,50 / 0,25 ×1,47 | 1,2 sn · 1,3 sn |
| R7 | 180 × 320 | 1,06 ×1,05 / 1,99 ×1,05 / 3,13 ×1,06 | 2,68 ×1,06 / 4,97 ×1,08 / 7,73 ×1,07 | 1,3 sn · 1,3 sn |
| R8 | 148 × 320 | 1,06 ×1,00 / 1,94 ×0,98 / 3,04 ×0,99 | 2,49 ×1,01 / 4,63 ×1,02 / 7,09 ×1,00 | 1,8 sn · 1,8 sn |
| R9 | 212 × 320 | 1,12 ×1,06 / 2,23 ×1,06 / 3,51 ×1,04 | 2,76 ×0,98 / 5,48 ×0,99 / 8,76 ×0,99 | 0,8 sn · 0,8 sn |
| R10 | 320 × 180 | 1,65 ×1,01 / 3,34 ×0,99 / 5,90 ×1,02 | 3,92 ×1,01 / 7,92 ×1,00 / 13,99 ×0,98 | 1,7 sn · 2,3 sn |
| R11 | 320 × 180 | 1,54 ×0,98 / 3,17 ×0,99 / 5,70 ×1,00 | 3,39 ×0,99 / 6,83 ×0,98 / 12,07 ×0,98 | 3,2 sn · 3,3 sn |
| K1 | 320 × 180 | 1,87 ×1,00 / 4,50 ×1,01 / 8,21 ×1,01 | 4,64 ×1,00 / 11,15 ×1,01 / 20,30 ×1,01 | 4,2 sn · 4,3 sn |
| K2 | 320 × 180 | 1,81 ×1,00 / 3,95 ×1,00 / 6,77 ×0,99 | 4,30 ×1,00 / 9,54 ×1,01 / 16,32 ×1,00 | 3,9 sn · 3,8 sn |
| S1 | 320 × 180 | 0,22 ×0,99 / 0,43 ×1,00 / 0,78 ×0,99 | 0,51 ×1,01 / 0,99 ×0,99 / 1,88 ×0,98 | 1,3 sn · 1,3 sn |
| S2 | 320 × 180 | 1,00 ×1,00 / 2,46 ×1,00 / 6,35 ×1,01 | 2,47 ×1,02 / 5,91 ×1,00 / 15,70 ×1,03 | 2,2 sn · 2,3 sn |
| S3 | 320 × 180 | 1,43 ×1,00 / 3,52 ×0,96 / 7,21 ×0,99 | 3,53 ×1,01 / 8,81 ×1,01 / 17,70 ×0,98 | 4,9 sn · 5,9 sn |
| S4 | 320 × 180 | 2,12 ×0,98 / 5,06 ×0,99 / 9,96 ×0,99 | 4,95 ×1,02 / 11,71 ×1,01 / 23,26 ×1,00 | 7,4 sn · 9,4 sn |
| S5 | 180 × 320 | 1,29 ×1,00 / 2,70 ×1,01 / 4,91 ×1,00 | 3,36 ×1,01 / 6,80 ×0,98 / 12,57 ×1,00 | 2,4 sn · 2,3 sn |

- **Tahmin değişti** (ön kayıttaki ±%10 şartı ilk ölçümde tutmadı): eski tahmin (kısmın 4 yerinden 2'şer kare)
  gerçek kayıtlarda 54 GIF'in **37'sinde** ±%10 içindeydi — R7'de (açılışı geri kalanından çok hareketli bir
  sosyal medya videosu) dosya tahminden %17–19 büyük, R9'da %11 büyük, R11'in 10 sn'sinde %11–12 küçük çıktı.
  Yeni tahmin **8 yerden 3'er ardışık kare**; anahtar kareler seyrekse (ör. bir uygulamanın yeniden
  kaydettiği, 8 sn'de bir anahtar kareli video) kısmı tek geçişte çözer: **54'te 48** içinde; dışında kalan
  altısının hepsi R6 — neredeyse hiç kıpırdamayan bir video (40–250 KB): dosya tahminden 4 sn'de %15–17
  büyük, 10 sn'de %31–33 küçük (tahmin 10 sn'de iki kat fazla söylüyor; ekran "yaklaşık" der). Yapay
  kaynakların 30'unun 30'u içinde. Tahminin süresi önce 1,3–22 sn, şimdi 0,8–9,9 sn (en uzunu yoğun kumlu,
  seyrek anahtar kareli yapay kaynak); "GIF'i indir" onu hiç beklemez.
- Uygulamada 10 sn Büyük GIF yapmak 1,2–8,1 sn sürdü (bu masaüstü); telefonda ölçülmedi.

### Telefonda ana düğme (aynı gün)

Kurucu dikey videoda "GIF'i indir"i bulamadı: önizleme ekranı doldurmuş, düğme ekranın altında kalmıştı.
Ölçüm (eski derleme, dikey 360 × 640 deneme videosu, düğmenin alt kenarı): 360 × 780'de Küçült 1025,
Müzik ekle 905, İyileştir 1507, GIF yap 898 px (ekranın dışında); 320 × 640'ta ayrıca Sesi düzelt 719 ve
Çevir 733. **Düzeltme:** her sihirbazın ana düğmesi (ortak `WizardFlow`, GIF yap'ın kendi düğmesi ve
Yazıya dök'ün "Modeli indir" ve "Yazıya dök" düğmeleri) telefonda ve kısa pencerede (`max-width: 699px` ya da
`max-height: 820px`) ekranın altına yapışan bir çubukta; adım ekrandan kısaysa yerinde durur. Çubuğun
üstünde 12 px yumuşak geçiş; "Daha fazla ayar" çubuğun dışına, altına alındı; odak çubuğun altında
kalmasın diye sayfa kaydırırken alttan 104 px boşluk bırakır (WCAG 2.4.11). GIF önizlemesinin yüksekliği
`52svh` (tarayıcı çubuğu açıkken görünen yükseklik). Yazıya dök'ün ilk düğmesi ("Modeli indir") de 320 ×
640'ta ekranın altındaydı (alt kenarı 696). Sonra: 11 sihirbazın hepsinde ana düğmenin alt kenarı 360 × 780'de
634–772, 320 × 640'ta 610–632 px, kaydırmadan; GIF'in iki yazı kutusu düğmenin üstünde, Tab hiçbir denetimi
çubuğun altına düşürmüyor. Yeni sınama `tests/e2e/wizard-phone-action.spec.ts`. "Kes" editörü açar (kendi
telefon çubuğu, ADR-030), sınamada yok.

### Sınamalar (ek; son kodla, yerel, Windows, Playwright Chromium)

- `tsc`, `eslint` temiz; birim **1611 / 1611** (93 dosya; `gif.test.ts` boyut seçenekleri, Büyük, 10 MB sınırı).
- Olağan e2e **523: 519 geçti, 4 atlandı, 0 başarısız**; `PAGE-RECOVERED-TOTAL 0`, `PAGE-DEAD-TOTAL 0` (bekçinin
  kendi sınamalarındaki bilerek yapılanlar hariç). İçinde yeni `wizard-phone-action.spec.ts` (23: 11 sihirbaz × 360 ×
  780 ve 320 × 640, dikey video, kaydırmadan; GIF'in yazı kutuları çubuğun üstünde, Tab çubuğun altına düşmüyor) ve
  `gif.spec.ts`'in yeni üç sınaması (Orta varsayılan, 10 MB uyarısı engellemiyor, Büyük 360 × 640: tahmin ×0,99). Eski
  sınamaların beklentileri yalnızca varsayılan boyut için değişti (Küçük → Orta, kaynağı bu ek); hiçbir eşik gevşemedi.
- Bulut e2e **62: 58 geçti, 4 atlandı**. Durağan çıktı (`/capcut`) + Pages duman iki kez: bulutsuz **16: 10 geçti, 6
  atlandı**, bulut yolu açık **16: 14 geçti, 2 atlandı** (Pages'te GIF artık 480 × 270).
- Kalite katmanı: farklı ekran 0 (32 ekrana bakılıp yenilendi); bütçe dışı 16 (ayrıntı `docs/quality/bulgular.md`).
  `npm audit --omit=dev` 0.

### Doğrulanmayanlar (ek)

- **Telefon:** kurucunun S23'ünde ne GIF'in görünüşü ne süreler ne de alt çubuk denendi (ana oturum yeniden
  deneyecek). Telefonda tahmin ve yapma masaüstünün ~3 katı varsayıldı, ölçülmedi.
- HEVC kayıtlar (R1, R3) uygulamanın içinde ölçülemedi (Playwright'ın Chromium'u açmıyor); ölçüm aracında ölçüldü.
- VMAF-tel bir model; telefonun galerisinin ya da sohbet uygulamasının büyütme biçimi farklı olabilir. Gözle
  karşılaştırma yapılmadı (gerçek kayıtların karelerine depoda yer yok).
- "Büyük"ün 10 sn'lik GIF'i bellekte ~115 MB kare tutar (yatay 640 × 360); düşük bellekli telefonda denenmedi.
  → 21 Ekim eki: 8 GB'tan az ya da belleğini söylemeyen cihazda artık hiç kare tutmaz (iki geçiş); telefonda yine denenmedi.

### Kurucu kararları (ek)

1. ~~Varsayılan boyut~~ **Karar (20 Ekim):** Orta (kural Küçük diyordu; yukarıda).
2. ~~10 MB üstü~~ **Karar:** engellemeyen uyarı.
3. ~~Döngülü MP4~~ **Karar:** şimdilik yok.
4. Açık: eşikli saydamlık (dosyayı %15–23 küçültüyor, SSIM'de −0,003) yeni bir ön kayıtla denensin mi?
5. Açık: üç boyut 390 px'te iki satıra kırılıyor ("Büyük" alta iniyor); istenirse seçenekler daraltılabilir.

---

## Ek — 21 Ekim 2026: bellek (kareler tutulmadan GIF)

> Durum: UYGULANDI (birim, e2e, ölçüm). Politika ve şema **değişmedi**; GIF'in baytları **değişmedi** (aşağıda
> kanıt). Düşük bellekli telefonda ve Safari'de **denenmedi**.

### Bağlam: GIF işleyicisi bütün kareleri tutuyordu

Kod okuması (`gifWorker.ts`, `a7ed854`): `make` kısmın **bütün** karelerini GIF boyutunda RGBA olarak bellekte
topluyor, sonra paleti hepsinden seçiyor (`buildGifPalette`: bütün karelerden eşit aralıklı ~1 M piksel), sonra
kareleri tek tek yazıp bırakıyordu. 10 sn "Büyük" (640 × 360 × 4 × 125) = **115 MB** yalnızca kareler. Sonda bir
fazlalık daha: `writer.finish()` dosyanın tam boyunda bir kopya veriyor, işleyici onu bir kez daha kopyalayıp
gönderiyordu (23 MB'lık GIF'te 23 MB fazla). Tahmin (`estimate`) en çok 24 kare tutar (Büyük'te 22 MB); değişmedi.

### Ölçüm (bu masaüstü, Windows, Playwright Chromium, `CLIP_TEST_HOOKS=1` yapısı; `web/scripts/measure-gif-memory.mjs`)

Uygulamanın kendi düğmesi (`/yap/gif`), iki yapay kaynak (1280 × 720, 30 kare/sn, 12 sn; `desen` = testsrc2,
`gurultulu` = yoğun kumlu Mandelbrot, 92 Mbit/sn), Küçük / Orta / Büyük × 4 / 10 sn. Her GIF yaparken:

- **işleyici:** GIF işleyicisinin V8 yığını + `ArrayBuffer` içerikleri (CDP `Runtime.getHeapUsage`,
  `usedSize + backingStorageSize`, 100 ms'de bir; henüz toplanmamış çöp de içinde — gerçek bellek baskısıdır);
- **süreç:** sayfayı ve işleyicilerini taşıyan renderer sürecinin özel belleğinin basıştan önceye göre en çok
  artışı (işletim sistemi, 200 ms'de bir). Üç okumada örnekleyici yanlış süreci baz aldı (artış ≤ 1 MiB çıktı);
  onlar sayılmadı ("—").
- `performance.measureUserAgentSpecificMemory()` kullanılamadı: yalnızca cross-origin-isolated sayfada var.
- Süre: basıştan GIF'in hazır olduğu ana. Grafik süreci hiçbir okumada artmadı (çözme renderer'da).

Ortancalar (önce: 2 koşu; iki geçiş: 3 koşu; MiB · MiB · sn):

| Kaynak, boyut | Önce: işleyici · süreç · süre | **İki geçiş** (32 MiB bütçe): işleyici · süreç · süre |
|---|---|---|
| desen Küçük 4 sn | 28 · 55 · 0,9 | tek geçiş (aynı) |
| desen Orta 4 sn | 42 · 63 · 0,9 | tek geçiş (aynı) |
| desen Büyük 4 sn | 61 · 80 · 0,9 | 60 · 90 · **1,4** |
| desen Küçük 10 sn | 45 · 80 · 1,4 | tek geçiş (aynı) |
| desen Orta 10 sn | 79 · 107 · 1,9 | **59 · 70** · 2,9 |
| desen Büyük 10 sn | 131 · 163 · 1,9 | **63 · 96** · 2,9 |
| gurultulu Küçük 4 sn | 82 · 152 · 4,2 | tek geçiş (aynı) |
| gurultulu Orta 4 sn | 78 · 139 · 4,4 | tek geçiş (aynı) |
| gurultulu Büyük 4 sn | 99 · 154 · 5,5 | 96 · — · **8,0** |
| gurultulu Küçük 10 sn | 92 · 168 · 7,2 | tek geçiş (aynı) |
| gurultulu Orta 10 sn | 114 · 188 · 7,8 | 104 · 174 · **13,2** |
| gurultulu Büyük 10 sn | 168 · 229 · 10,5 | **117 · 178** · **14,7** |

Bulgular:

- Kareler gerçekten belleğin büyük kısmı: 10 sn Büyük'te işleyici 131 → 63 MiB (test deseni), 168 → 117 MiB (yoğun
  kumlu); süreç 163 → 96, 229 → 178 MiB.
- Yoğun kumlu kaynakta kareler dışında da çok bellek var: **Küçük 4 sn'de bile işleyici ~80 MiB, süreç ~150 MiB**
  (yalnızca 11 MB kare). 92 Mbit/sn'lik kaynağın okunması / çözülmesinden kalan tamponlar; **araştırılmadı**, bu ek
  onu düzeltmiyor. Telefonda gerçek kamera kaydı genellikle 10–20 Mbit/sn; o durumda ölçülmedi.
- İkinci çözme pahalı: süre **+%50 (test deseni), +%40–70 (yoğun kumlu)**. Bu yüzden iki geçiş her cihazda değil.

### Karar

1. **Paletin örneği kare kare toplanır** (`GifPaletteSampler`, `gifEncode.ts`): kare sayısı çözmeden önce bilinir
   (kısmın her anı bir kare; `pickFrames` her an için tam bir kare verir), yani örnek bütün kareler tutuluyormuş gibi
   **aynı piksellerden, aynı sırayla** alınır. `buildGifPalette` artık onu kullanır (tek kaynak).
2. **Kareler yalnızca bütçe içindeyse tutulur** (`gifFramesBudget`, `domain/gif.ts`). Bütçeyi aşan GIF **iki
   geçişle** yapılır: 1. geçiş kısmı çözer, yalnızca örneği toplar ("Kareler hazırlanıyor"); palet seçilir; 2. geçiş
   kısmı yeniden çözer ve her kareyi çizildiği anda yazıp bırakır ("GIF yazılıyor"). Hiçbir kare tutulmaz.
   - Bütçe **32 MiB**: cihaz belleğini söylemiyorsa (Safari, Firefox — Safari'nin sekme başı sınırı tam da dar olan)
     ya da 8 GB'tan az diyorsa. Bütün "Küçük"ler, 4 sn "Orta" (varsayılan; uzun videonun varsayılan kısmı 4 sn) ve
     2,9 sn'ye kadar "Büyük" tek geçişte kalır; 10 sn Orta ve Büyük iki geçiş.
   - Bütçe **128 MiB**: cihaz `navigator.deviceMemory` ile **8 GB ya da fazla** diyorsa (Chromium; bu masaüstü 32
     diyor). Her GIF tek geçişte, eskisi gibi hızlı; bellek eskisi gibi.
   - Neden cihaza göre: 8 GB'lık bir cihazda 115 MB kare bir sorun değil, oysa iki geçiş her Büyük 10 sn'ye %40–50
     süre ekliyor; az bellekli ya da belleğini söylemeyen cihazda ise süre değil sekmenin kapanması risk.
   - İlerleme çubuğu iki geçişte yarı yarıya (`passes: 2` her ilerleme iletisinde; tek geçişte %85 / %15 aynen).
3. **Sondaki fazladan kopya kaldırıldı:** `finish()`'in verdiği tam boyutlu kopyanın tamponu olduğu gibi aktarılır.
4. **Bellek yetmediği söylenir:** "Out of memory at ImageData creation" gibi bir `RangeError` önceden
   `out_of_memory` sayılmıyordu (yalnız "array buffer / allocation" cümleleri); artık bilinen cümle etiketiyle
   (`failureHint` → `out_of_memory`) tanınır. GIF'in kendi cümlesi: **"Tarayıcının belleği yetmedi. Daha küçük bir
   boyut seç ya da kısmı kısalt; açık başka sekmeleri kapatmak da yardım eder."** (`gif.fail.memory`; önce dışa
   aktarmanın "Daha kısa bir çıktı dene."si); "Ayrıntılar" ve "Sorun bildir" aynen.
5. **Uyarı ya da sınır konmadı.** İki geçişle 10 sn Büyük'ün kareleri artık hiç tutulmuyor; kalan bellek
   (yukarıda: kaynağın okunması, GIF'in kendisi ≤ ~25 MB) boyuttan çok kaynağa bağlı. Gerçek düşük bellekli bir
   telefonda sekmenin kapandığı görülmeden bir boyutu yasaklamak ya da uyarmak kanıtsız olurdu.

### Baytlar değişmedi — kanıt

- **Birim** (`tests/unit/gifMemory.test.ts`, 10): eski `buildGifPalette`'in birebir kopyasına karşı kare kare örnek
  dört geometride (örnek adımı 1, 2, 6, 13; tek sayılı ve adıma bölünmeyen kare boyları) yazılı / yazısız aynı palet;
  kareleri tutup yazmak ile örneği toplayıp kareleri "yeniden üretip" yazmak **bayt bayt aynı GIF**; bozulan bir
  başlangıç hesabı (bilerek denendi) üç sınamayı düşürüyor. Bütçe kuralı ve çubuk paylaşımı.
- **Uygulamada, gerçek tarayıcıda** (`tests/e2e/gif-memory.spec.ts`): aynı GIF (sample-24s, Küçük 4 sn, Türkçe
  harfli yazı) bütçe ∞ (tek geçiş) ve 0 (iki geçiş) ile: **171 456 bayt, aynı**; 10 sn Büyük kumlu video
  (640 × 360 × 125) iki yoldan: **15 787 522 bayt, aynı**.
- **Ölçüm koşularında:** 12 durumun her biri önceki yapıyla (2 koşu), yeni yapıyla cihaz kuralında (2 koşu) ve
  32 MiB bütçeyle (3 koşu): 84 GIF, her durumda **tek bir SHA-256** (önceki yapının iki koşusu da kendi aralarında
  aynı). (H.264 çözmesi standart gereği bit-tam; iki geçişte de aynı çözücü, aynı çizim.)

### Ortada çöken işleyici (ADR-042)

Önceki sınamalar hatayı yalnızca işin **başında** yapıyordu. Yeni sınama hatayı karelerin ortasında, kareler
elde iken yapar (`window.__clipWorkerFault` artık `atFrame` alır — yalnız GIF işleyicisi; ve yeni tür `oom`:
tarayıcının vermeyeceği bir tampon istenir, motorun kendi `RangeError`'u gelir, gerçekte bellek alınmaz):

- 1. geçişin 20. karesinde bellek yetmedi → "Tarayıcının belleği yetmedi…", `RangeError · frame_capture ·
  out_of_memory`;
- 2. geçişin 10. karesinde (60. kare) işleyicinin kendisi çöker → "Beklenmeyen bir hata oluştu…", `WorkerError ·
  worker_crash · worker_error_event`, tanı dosyasında gizli parça yok;
- 2. geçişin 20. karesinde yerinde sayar → bekçi bitirir, `Stalled · gif_encode · stalled`;
- her birinde kaydetme penceresinin açtığı dosya kalmaz; sonra hatasız GIF yapılır.

Sekmenin **bütünüyle** öldürülmesi (Android'in bellek katili, iOS'un jetsam'i) sayfayı da götürür; sayfanın
söyleyebileceği bir şey kalmaz. Ona karşı tek önlem belleği düşürmek (yukarıda).

### Sınamalar (ek; son kodla, yerel, Windows, Playwright Chromium)

- `tsc`, `eslint` temiz; birim **1624 / 1624** (94 dosya; yeni `gifMemory.test.ts` 10).
- e2e (kilit altında, port 3194): `gif-memory.spec.ts` (yeni, 2), `gif.spec.ts` (11), `gif-a11y.spec.ts` (3),
  `worker-failure.spec.ts` (6): **22 / 22 geçti.** `PAGE-RECOVERED-TOTAL 0`, `PAGE-DEAD-TOTAL 0`. Olağan e2e takımının
  geri kalanı, kalite katmanı koşulmadı.

### Doğrulanmayanlar (ek)

- **Gerçek düşük bellekli telefon** (3–4 GB Android) ve **iPhone Safari**: hiçbiri denenmedi; sekmenin hangi
  bellekte kapandığı bilinmiyor. 32 MiB bütçe ve 8 GB eşiği bir yargı, ölçüm değil.
- Telefonda iki geçişin süresi (masaüstünün ~3 katı varsayılır: 10 sn Büyük kumlu ~45 sn).
- `navigator.deviceMemory`'nin işleyicide okunduğu yalnız bu masaüstünde görüldü (32); Android Chrome'da okunmadı.
- Yoğun kumlu kaynakta kareler dışındaki ~80 MiB (yukarıda) — araştırılmadı.
- Donanım çözücüsünde (telefon) iki geçişin aynı kareleri verdiği: ADR-033'teki gibi bir çözücü kapanırsa ikinci
  geçiş "eksik kare" sayar ve dürüstçe reddeder; baytların aynılığı yalnız bu makinenin yazılım çözücüsünde ölçüldü.

---

## Ek 2 — 21 Ekim 2026: ikinci tur (küçültme süzgeci, keskinleştirme, eşikli saydamlık, daha büyük boyutlar)

Kurucu yeni GIF'i (Orta varsayılan, Büyük eklendi) S23'te denedi: "daha güzel olmuş, daha da geliştirebiliriz";
sonra ana oturum aracılığıyla: fark "240p 720p olmuş gibi" açık; **daha yüksek çözünürlüklü** GIF istiyor.
Birinci tur sebebin çözünürlük olduğunu buldu; palet / titreşim değişiklikleri kuralı geçmedi. Birinci turun
ölçmediği şey: ölçüm aracı kareleri **ffmpeg'in Lanczos küçültmesiyle** çiziyordu; uygulamanın kendi
küçültmesi (tarayıcının `drawImage`'ı, `imageSmoothingQuality: 'high'`) hiç ölçülmedi.

### Ön kayıt (ölçümden ÖNCE yazıldı ve ayrı bir işlemle kaydedildi; sonuçlardan sonra değiştirilmedi)

Ölçümden önce yalnızca kod okundu: `gifWorker.ts` her kareyi `VideoSample.draw` ile doğrudan GIF boyutuna çizer;
mediabunny'nin kendi `_drawWithFitAndMipmapping` açıklaması "2 kattan fazla küçültmede çift doğrusal süzgeç piksel
atlar, sonuç örtüşür (aliasing); `imageSmoothingQuality` güvenilmez" diyor. Hiçbir kayıtta, hiçbir aday ölçülmedi.

**Görüntüler.** Birinci turun kümesi: 11 gerçek telefon kaydı (`web/tests/media/real/`, depoda yok, yalnızca ölçüm
için okunur; dikey 7, HEVC 2, 30–120 kare/sn, iPhone 3, Pixel 1, Samsung 2, GoPro 1, sosyal medya 4; HDR olan
ikisi, 224 × 128'lik bir kayıt ve 854 × 480'lik 32 dakikalık bir kayıt dışarıda) + iki az ışık kopyası (K1, K2).
Birinci turun R numaralarının dosya eşlemesi kaydedilmemiş: numaralar yeniden verildi (yalnızca yerel bir dosyada);
K1, K2 yeniden üretildi: iki yatay gerçek kaydın ilk 12 sn'si, `lutrgb` ile R, G × 0,45, B × 0,5 karartılmış,
`noise=alls=12:allf=t` kumlanması, H.264 CRF 18 (yalnızca yerel). Yapay: S1–S5, `evaluate.mjs`'in tarifleri.
Kısım baştan 4 sn (R2 ve S'lerin bütünü daha kısaysa bütünü); 10 sn ölçümlerinde 10 sn'den kısa kayıt yok sayılır.

**Yöntem.** Kareleri bu kez **tarayıcının kendisi** çizer: bu masaüstündeki Google Chrome (155, Playwright ile),
uygulamanın çözme yolu (mediabunny `VideoSampleSink`, `pickFrames`, `holdDecoder`, `VideoSample.draw`), uygulamanın
kare zamanları (`gifFrameTimesUs`) ve boyut planı. Her adayın kareleri aynı geçişte, aynı çözülmüş kareden çizilir.
**Telefonda görünenin kaynağı**: tarayıcının aynı karelerinin kendi boyutunda (1:1, büyütme / küçültme yok) okunmuşu,
ffmpeg Lanczos ile kısa kenarı 1080'e getirilmiş hali (aynı çözücü, aynı renk dönüşümü, aynı kare). GIF, birinci
turdaki gibi bikübik büyütülür. GIF'i aday yöntemle Node'da uygulamanın kodlayıcısı yazar (`candidates.ts`), ffmpeg
geri açar.

**Ölçüler.**
- **VMAF-tel** (v0.6.1) ve **VMAF-tel-NEG** (`vmaf_v0.6.1neg`, "no enhancement gain": keskinleştirmeyi
  ödüllendirmeyen model) — telefonda görünen; **SSIM-tel**; **ΔCAMBI-tel** (bant; GIF'in kaynağa eklediği).
- GIF boyutunda (eşikli saydamlık için): GIF ile **kendi girdisi olan kareler** arasında SSIM ve VMAF (birinci tur
  gibi) ve kare başı SSIM'in **en kötü %5'i** (5. yüzdelik; gölge / iz bırakmayı yakalar).
- **Boyut** (bayt); **çizme süresi** (tarayıcıda kare başına çizme + okuma + küçültme + keskinleştirme, bu
  masaüstü); **kodlama süresi** (Node, birinci tur gibi); yeni boyutlar için **bellek**: 10 sn'lik karelerin
  bellekte tutulan hali (genişlik × yükseklik × 4 × 125) ve uygulamada GIF yaparken tarayıcı süreç ağacının en
  yüksek özel belleği (`scripts/lib/process-memory.ps1`).

**Adaylar.**
1. *Küçültme:* `high` (bugünkü: `VideoSample.draw` doğrudan GIF boyutuna, `imageSmoothingQuality 'high'`), `medium`,
   `low`; `mip` (önce GIF boyutunun 2^k katına `high` ile, sonra her adımda yarıya — çift doğrusal, yani 2 × 2
   ortalama — GIF boyutuna dek; mediabunny'nin kendi yolu); `box` (kare 1:1 çizilip okunur, JS'te alan ortalaması).
   *Keskinleştirme:* `mip` ve `box`'ın üstüne 3 × 3 bulanıklık farkıyla keskinleştirme (unsharp mask), güç 0,25 ve 0,5.
2. *Eşikli saydamlık:* T = 2, 3, 4 (birinci turun tanımı: gösterilen renk, en iyi yeni renkten en çok T düzey
   uzaksa piksel değişmemiş sayılır; hata kareden kareye birikmez), 1'in kazananının üstüne.
3. *Kare farkı kırpma:* sonraki her kare, değişen piksellerin çevreleyen dikdörtgenine kırpılır (kayıpsız).
4. *Daha büyük boyutlar:* uzun kenar 960, 1280, 1920 (16:9 / 9:16'da kısa kenar 540, 720, 1080); hiçbiri videodan
   büyük değil (ADR-041); her biri yalnızca videosu o boyuta yeten kayıtlarda ölçülür.

**Karar kuralı.**
1. *Küçültme ve keskinleştirme* (Küçük, Orta, Büyük; 4 sn; palet ve saydamlık bugünkü):
   - **Uygun** olmak için: (a) çizme süresi: gerçek kümede kare başı ortanca, `high`'ınkinden en çok 15 ms fazla;
     kayıt başı ortancaların en kötüsü en çok 40 ms fazla (Büyük'te; telefon ~3 kat yavaş varsayılır: 125 karede
     ~6 sn); (b) boyut: her boyutta gerçek kümede ortanca bayt `high`'ın en çok %5 üstü; (c) SSIM-tel ortancası
     `high`'ınkinden en çok 0,002 düşük — gerçek **ve** yapay kümede; keskinleştirilen aday ayrıca VMAF-tel-NEG'de
     keskinleştirilmemiş halinden düşük olmamalı (gerçek kümede ortanca).
   - **Puan:** üç boyutun gerçek kümedeki ortanca VMAF-tel-NEG'lerinin ortalaması. Uygunlar içinde **kazanan** en
     yüksek puanlı; en iyiye 0,3 içinde olanlardan Orta'da ortanca baytı en küçük olan.
   - Kazanan `high`'ın yerine **ancak** puanı en az 2,0 yüksekse, ya da en az 1,0 yüksek ve Orta'da ortanca baytı
     en az %5 küçükse geçer; ve yapay kümede puanı `high`'ınkinden en çok 1,0 düşükse.
2. *Eşikli saydamlık* (1'in sonucunun üstüne; Orta ve Büyük; 4 sn kalite, 4 ve 10 sn boyut):
   - Bir T **uygun**: (a) VMAF-tel-NEG ortancası T = 0'dan en çok 1,0, kayıt başına en çok 2,5 düşük (gerçek; yapayda
     ortanca en çok 1,0); (b) GIF boyutunda SSIM ortancası en çok 0,004, kare başı SSIM'in 5. yüzdeliğinin ortancası
     en çok 0,010 düşük (gerçek ve yapay); (c) ΔCAMBI-tel ortancası en çok 0,3 artar.
   - **Kazanan:** uygun T'lerin en büyüğü. **Ancak** 10 sn'de hem Orta hem Büyük için gerçek kümede ortanca bayt
     T = 0'dan en az %10 küçükse geçer. 10 sn Orta'nın 10 MB'ı aşan kayıt sayısı önce / sonra yazılır.
3. *Kare farkı kırpma:* geri açılan GIF kare kare bit bit aynıysa (kayıpsız) ve 10 sn Orta'da gerçek kümede ortanca
   bayt en az %2 küçükse geçer.
4. *Daha büyük boyutlar* (1–3'ün sonucuyla; küçükten büyüğe, her biri bir öncekinin kabulüne bakarak):
   bir boyut ancak şunların hepsi tutarsa **sunulur**:
   (a) VMAF-tel-NEG ortancası sunulan bir alt boyuttan en az 3 puan yüksek (o boyuta yeten kayıtlarda, ikisi aynı
   kayıtlarda); (b) 4 sn gerçek kümede ortanca ≤ 15 MB (X/Twitter GIF sınırı; 10 MB üstü uyarısı zaten var) ve en
   büyüğü ≤ 50 MiB (Chromium'un paylaşma sınırı); (c) uygulamada, bu masaüstünde, 4 sn GIF yapmak ortanca ≤ 10 sn ve
   10 sn GIF yapmak ortanca ≤ 25 sn; (d) **bellek:** 10 sn'lik kareler bellekte ≤ 300 MB (birinci turun sınırı)
   — (a)–(c) tutup (d) tutmayan boyut **şimdi sunulmaz**; "kareleri iki geçişte işleyen yol gelince güvenli"
   diye yazılır (bu iş başka bir ajanda; bu tur kare saklamayı değiştirmez); (e) ekrandaki tahmin o boyutta da
   gerçek dosyanın ±%10'u içinde (uygulamada yeniden ölçülür).
5. Neyi kabul edilirse edilsin: ekrandaki tahmin her boyutta gerçeğin ±%10'u içinde kalmalı — gerçek kayıtlarda
   birinci turun ölçtüğü gibi yeniden ölçülür. Tutmazsa tahmin düzeltilir ya da değişiklik geri alınır.

Sonuçlar ve uygulanan karar bu bölümün altına eklenir.

### Ön kayda ek (21 Ekim, adım 1'in sonucunu GÖRDÜKTEN SONRA, yeni adaylar ölçülmeden önce yazıldı)

Adım 1'in sonucu (aşağıda): kural bugünkü `high`'ı tuttu. Keskinleştirilen adayların hepsi VMAF-tel-NEG'de büyük
kazanç gösterdi (puan +8,6 / +12,0) ama ön kayıt keskinleştirmeyi yalnızca `mip` ve `box`'ın üstüne koymuştu; o ikisi
4K kaynakta (R1) süre sınırını aştı (kare başına +107 / +157 ms). **Bugünkü küçültmenin üstüne keskinleştirme ön
kayıtta yoktu** — eksik bir aday. Bu ek, sonucu bilerek yazıldığı için ayrıca **saklı bir kümede doğrulama** ister:

- Yeni adaylar: `high+s0.25`, `high+s0.5` (bugünkü küçültme, sonra aynı keskinleştirme). Başka aday eklenmedi.
- Aynı kural (adım 1'in a–c'si, puan, geçme eşikleri: +2,0, ya da +1,0 ve Orta'da bayt −%5; yapayda en çok −1,0),
  **iki kümede ayrı ayrı** tutmalı: (1) ana küme (yukarıdaki ölçümün aynı kareleri yeniden çizilir; `high` aynı
  koşuda yeniden ölçülür); (2) **saklı küme:** aynı kayıtların ortasından bir kısım (başlangıç = süre / 2, en çok
  süre − 4,5 sn; 4,4 sn'lik R2 yok) + birinci turun dışarıda bıraktığı 854 × 480'lik kayıt (R12, 32 dk, ortasından)
  + S1–S5'in 6. saniyesinden başlayan kısmı. Saklı kümenin hiçbir karesi bu ekten önce ölçülmedi.
- İki kümede de geçen adaylar arasından kazanan, ana kümedeki adım 1 sıralamasıyla seçilir; iki kümede de geçen
  yoksa `high` kalır.
- Adım 2–4 bu adımın sonucuyla, yazıldıkları gibi.

### Ön kayda ikinci ek (21 Ekim, ilk ekin adayları ölçülürken, `mip2` ölçülmeden önce yazıldı)

Adım 1'in kayıt başı sayıları: 1080p kaynaklarda (R2, R6, R10, R11) `mip` Büyük'te VMAF-tel-NEG'i 5–10 puan
artırdı (Chrome'un `high`'ı bu kaynaklarda örtüşüyor); `mip`'in elenme sebebi tek bir 4K kaynakta (R1) çok
seviyeli ara çizimin süresiydi. Ucuz bir ara yol ön kayıtta yoktu. Yeni aday: **`mip2`** — kaynak GIF boyutunun en az
2 katıysa önce GIF boyutunun **yalnızca 2 katına** `high` ile çizilir, sonra bir kez yarıya (çift doğrusal = 2 × 2
ortalama); değilse `high` ile aynı. Ve `mip2+s0.25`, `mip2+s0.5`. Kural ilk ekinkiyle aynı: adım 1'in a–c'si ve geçme
eşikleri, `high`'a karşı, ana kümede **ve** saklı kümede (ilk ekin saklı kümesi; `high` aynı koşuda yeniden ölçülür).
İki kümede de geçen bütün adaylar (ilk ekinkiler dahil) arasından kazanan ana kümedeki adım 1 sıralamasıyla seçilir.

### Sonuçlar (21 Ekim; bu masaüstü, Google Chrome 155 başsız, `web/scripts/gif-eval/round2.mjs`, `app-check.mjs`)

Kümeler: **gerçek** 13 (R1–R11, K1, K2; 10 sn ölçümlerinde 12, R2 4,4 sn), **yapay** 5 (S1–S5), **saklı** 13 (R1,
R3–R12, K1, K2 ortadan + S1–S5 6. saniyeden). Değerler ortanca. VMAF-tel-NEG = telefon ekranının genişliğinde
(kısa kenar 1080), keskinleştirmeyi ödüllendirmeyen modelle; birinci turun VMAF-tel'iyle aynı ölçek değil (kaynak
artık tarayıcının kendi 1:1 kareleri). Aynı kareler iki kez ölçüldüğünde sayılar bayt bayt aynı çıktı.

**Chrome'un küçültmesi (`high`):** `medium` ile her ölçüde aynı sayıları verdi; `low`dan farklı. Bir küçültme süzgeci
bütün kaynaklarda daha iyi değil: 1080p kaynaklarda Büyük'te (3 kat küçültme) `mip` / `box` VMAF-tel-NEG'i 5–10
puan artırdı (R2, R6, R10, R11), R3 ve R9'da Küçük / Orta'da 5–9 puan düşürdü (`high` orada daha keskin).

**1. Küçültme ve keskinleştirme** (gerçek küme; Küçük / Orta / Büyük; puan = üçünün ortalaması):

| Aday | VMAF-tel-NEG | Puan | Orta bayt | Büyük çizme ms/kare (en kötü kayıtta fark) | Kural |
|---|---|---|---|---|---|
| **`high` (bugünkü)** | **37,8 / 59,8 / 78,3** | **58,6** | **3,03 MB** | **7,4** | — |
| `medium` | aynı | 58,6 | aynı | 7,0 | uygun; kazanç yok |
| `low` | 41,3 / 64,9 / 78,3 | 61,5 | ×1,087 | 5,4 | ✗ (b) bayt, (c) SSIM-tel Orta −0,0029 |
| `mip` | 36,2 / 64,8 / 78,3 | 59,8 | ×0,959 | 9,1 (+107, R1 4K) | ✗ (a) süre |
| `mip+s0.25` / `+s0.5` | 47,9 / 71,5 / 82,3 · 53,7 / 74,3 / 83,8 | 67,3 · 70,6 | ×0,99 · ×1,07 | 16,6 · 17,3 (+114) | ✗ (a); s0.5 ayrıca (b) Büyük ×1,12 |
| `box` | 36,6 / 64,7 / 78,5 | 59,9 | ×0,952 | 20,1 (+157) | ✗ (a) |
| `box+s0.25` / `+s0.5` | 48,0 / 71,5 / 82,2 · 53,6 / 74,4 / 83,8 | 67,2 · 70,6 | ×0,98 · ×1,05 | 28,0 · 28,2 (+164) | ✗ (a) ortanca da (+20,7); s0.5 ayrıca (b) |

Kural: kazanan `high` — **ön kaydın adaylarıyla küçültme değişmedi.**

*İlk ek* (`high+s…`; ana küme / saklı küme, `high`'a karşı puan farkı):
- `high+s0.25`: ana kümede **+7,7**, bayt ×1,03 / 1,03 / 1,04, süre +7,8 ms (en kötü +11,2), SSIM-tel +0,0007–0,0014 →
  geçer. Saklı kümede +6,0 ama **SSIM-tel Büyük'te −0,0021** (sınır −0,002; Orta −0,0012) → **uygun değil.**
- `high+s0.5`: iki kümede de (b) bayt (Büyük ×1,12 / ×1,08) ve saklıda SSIM-tel Büyük −0,0057 → uygun değil.

*İkinci ek* (`mip2`):
- `mip2`: ana kümede uygun ama +1,67 ve Orta'da ×0,959 (−%4,1) → geçme eşiğinin (+2,0, ya da +1,0 ve −%5) altında.
- `mip2+s0.25`: saklı kümede geçer (+7,0); ana kümede **Büyük'te bayt ×1,062** (sınır ×1,05) → uygun değil.
- `mip2+s0.5`: iki kümede de (b) bayt.

**Sonuç: iki kümede de geçen aday yok → küçültme ve keskinleştirme değişmedi** (`VideoSample.draw`, `high`).
Gözlem (karar değil, kurucuya): 0,25 güçte keskinleştirme telefonda görüneni **iki kümede de 6–8 puan** artırdı
(VMAF-NEG; SSIM-tel de çoğunlukla arttı); iki aday kuralın birer alt şartını ince farkla kaçırdı.

**2. Eşikli saydamlık** (`high`; gerçek, 4 sn; 10 sn bayt; T = 0'a karşı):

| T | VMAF-tel-NEG Orta / Büyük | SSIM (GIF boyutunda) Orta / Büyük | 10 sn bayt Orta / Büyük | 10 sn Orta / Büyük > 10 MB (12 kayıttan) |
|---|---|---|---|---|
| **0 (bugünkü)** | **59,8 / 78,3** | **0,9819 / 0,9817** | **7,75 / 13,73 MB** | **1 / 8** |
| 2 | −0,85 / **−1,32** | −0,0020 / −0,0021 | ×0,842 / ×0,865 | 1 / 7 |
| 3 | −1,95 / −3,24 | −0,0065 / −0,0067 | ×0,771 / ×0,787 | 0 / 6 |
| 4 | −3,23 / −5,58 | −0,0090 / −0,0096 | ×0,709 / ×0,721 | 0 / 6 |

Yapay kümede Büyük'te T 2 bile VMAF-tel-NEG −4,1 ve SSIM −0,0049. **Uygun T yok → saydamlık değişmedi.**
(Birinci turun "−0,003 SSIM" Küçük boyuttaydı; telefonda görünen boyutta kayıp daha büyük.)

**3. Kare farkı kırpma:** 72 / 72 GIF bit bit aynı (kayıpsız) ama 10 sn Orta'da ortanca bayt **×1,0000**: kamera
görüntüsünde her karede her satırda ve sütunda değişen bir piksel var, dikdörtgen bütün resim. Yalnızca neredeyse
kıpırdamayan R6'da %10–28 (dosya 0,1–0,2 MB) ve S1 / R8'de %0,4–0,6 küçüldü → **geçmedi.**

**4. Daha büyük boyutlar** (`high`, T = 0, kırpmasız; gerçek küme; bir boyut yalnızca videosu ona yeten kayıtlarda):

| Uzun kenar | Kayıt | VMAF-tel-NEG | 4 sn MB ortanca / en çok | 10 sn MB ortanca / en çok | 10 sn kareler bellekte | Uygulamada yapma 4 / 10 sn (en çok) | Uygulamada tarayıcı belleği, 10 sn (artış, ortanca / en çok) |
|---|---|---|---|---|---|---|---|
| 640 (Büyük) | 13 | 78,3 | 5,15 / 9,71 | 13,73 / 19,24 | 115–136 MB | 1,4 / 2,9 sn (6,0) | +168 / +246 MB |
| **960** | 12 | **87,7** (aynı kayıtlarda 640: 75,3) | **11,52 / 22,31** | 28,46 / 44,02 | **259 MB** | **1,9 / 3,9 sn** (8,6) | +302 / +348 MB |
| 1280 | 12 | 96,4 (960: 87,7) | 20,02 / 38,09 | 46,59 / 75,72 | 461 MB | 2,4 / 5,5 sn (10,1) | +506 / +549 MB |
| 1920 | 6 | 99,3 (aynı kayıtlarda 960: 81,1) | 39,46 / 83,10 | 95,54 / 161,39 | 1037 MB | 4,4 / 9,6 sn (22,9) | +1040 / +1136 MB |

(Uygulamada ölçmek için 1280 ve 1920 yalnızca yerel, işlenmemiş bir derlemeye geçici olarak eklendi; her GIF kendi
sayfasında; bellek = işletim sisteminin gördüğü tarayıcı süreç ağacının özel belleği, "GIF'i indir"den hemen önceki
örneğe göre en yüksek artış.)

- **960:** (a) +12,4 ✓; (b) 11,5 MB ortanca, en çok 22,3 MB ✓; (c) 1,9 / 3,9 sn ✓; (d) 259 MB ✓; (e) tahmin ±%10
  içinde **gerçekte 25'te 23, yapayda 10'da 10**; dışındaki ikisi yine R6 (neredeyse kıpırdamayan video, 0,17 /
  0,44 MB: ×1,10, ×1,51) — Büyük'te de aynı video aynı yönde dışarıda (×1,13, ×1,43; birinci turdaki gibi). Birinci
  turun kabul ettiği istisna; kural bu yüzden tutmuş sayıldı → **"Çok büyük" (960) eklendi.**
- **1280:** (a) +8,7 ✓ ama (b) 4 sn ortanca 20 MB ✗ ve (d) 461 MB ✗ → **sunulmadı.** İki geçişli yol belleği çözer,
  dosya boyutunu çözmez: bu kural altında 1280'i bellek işi tek başına açmaz.
- **1920:** (b) 39 MB ✗ (en çok 83 MB: paylaşma sınırının üstünde), (d) 1037 MB ✗ → **sunulmadı.**
- Telefonda 1280 / 1920'yi güvenli yapacak olan iki geçişli yol (başka bir ajanın işi) olurdu; 960'ın 10 sn'si bugün
  259 MB kare tutar ve bütün GIF'lerin en ağırıdır: düşük bellekli telefonda o yolla daha güvenli olur.

**Uygulanan:** dördüncü boyut **"Çok büyük"** (İngilizce "Extra large"), uzun kenar 960; video ondan küçükse
sunulmaz (ADR-041: 640 × 360 videoda yine üç boyut; 800 × 600'de "Çok büyük" videonun kendi boyutu). Varsayılan
**Orta** kaldı. 4 sn'si çoğu zaman 10 MB'ı geçtiği için engellemeyen uyarı sık görünür. Telefonda dört seçenek tek
satırda; iki kelimeli ad seçeneğin içinde iki satıra, yalnızca kelimeler arasından bölünür. Küçültme, palet,
saydamlık ve tahmin yöntemi değişmedi.

### Sınamalar (ek 2; yerel, Windows)

- `tsc`, `eslint` temiz; birim **1614 / 1614** (93 dosya; `gif.test.ts`: dört boyut, 960, videodan büyük değil, dört
  seçenek ancak video "Büyük"ten büyükse).
- e2e (test kancalı derleme, port 3193, kilit altında): `gif.spec.ts` + `gif-a11y.spec.ts` + `wizard-phone-action.spec.ts`
  **50 / 50** (yeni: "Çok büyük" 540 × 960, tahmin ×1,01, 640 × 360'ta yine üç seçenek; dört seçenek 320 / 360 / 390 px'te
  Türkçe ve İngilizce tek satırda, her biri ≥ 44 × 44, hiçbir kelime satır arasında bölünmeden). İlk koşuda bu yeni
  satır sınamalarının 6'sı düştü (iki satırlı ad satırdaki öbür seçenekleri 9 px aşağı itiyordu); seçenekler aynı
  boya getirildi, sonra 50 / 50. `english.spec.ts` "Make a GIF" ve `share-target.spec.ts` GIF sınaması **2 / 2**.
  `PAGE-RECOVERED-TOTAL 0`. Tam e2e takımı, bulut, Pages koşulmadı.
- Kalite katmanı (yalnız `visual`, `a11y`, `text`, `walkthrough`; geçmişe yazılmadan): 705 ölçüden 704 bütçe içinde,
  1 dışında: farklı ekran 2 — `sihirbaz-gif-secim` telefon TR / EN, dördüncü seçenek; fark resimlerine bakılıp yalnız
  bu iki taban yenilendi, sonra farklı ekran 0. a11y 34 / 34 (telefonda 44 px altı hedef yok).
- Ölçüm: ön kayıt ve iki ek önce kaydedildi (`34f6575`, `d053553`, `b806acf`), sonuçlar sonra.

### Doğrulanmayanlar (ek 2)

- **Telefon:** S23'te "Çok büyük" ne görünüş ne süre ne bellek ölçüldü; telefonda yapma ve tahmin masaüstünün ~3 katı
  varsayıldı. Ölçüm masaüstü Chrome'unda (Windows, başsız); Android Chrome'un küçültmesi başka olabilir (donanım
  çözücüsünün kareleri).
- VMAF-tel-NEG bir model; gözle karşılaştırma yapılmadı (gerçek kayıtların karelerine depoda yer yok).
- 10 sn "Çok büyük" düşük bellekli telefonda denenmedi (masaüstünde tarayıcı belleği +300–350 MB).

### Kurucu kararları (ek 2)

1. **Keskinleştirme (0,25):** telefonda görüneni iki kümede 6–8 puan artırıyor; dosya %3–4 büyük, kare başına +8 ms;
   kural ince farkla geçirmedi (saklı kümede Büyük'te SSIM-tel −0,0021, sınır −0,002). Telefonda gözle bir karşılaştırma
   ve istenirse kurucu kararıyla açılabilir (tek işlev, kod ölçüm aracında hazır).
2. **1280 / 1920:** dosyaları 4 sn'de 20 / 39 MB (ortanca); paylaşmada ve sohbet uygulamalarında sorun. İki geçişli
   yol gelince bile bu kural onları açmaz; istenirse sınır (15 MB) kurucu kararıyla değişir. Bu boyutlarda döngülü MP4
   ("Video olarak", kurucu 20 Ekim'de şimdilik istemedi) aynı netliği çok küçük dosyayla verir.
3. Adlar "Çok büyük" / "Extra large".

---

## Ek 3 — 24 Ekim 2026: keskinleştirme açıldı (0,25, `high+s0.25`) — ön kayıtlı kuralın geçersiz kılınması

> Durum: UYGULANDI (birim, e2e, uygulamada ölçüm; sayılar aşağıda). Telefonda **denenmedi**. Politika ve şema
> değişmedi. "Video olarak" (MP4) **değişmedi**.

### Karar ve geçersiz kılma (açıkça)

Ana oturumun kararı (kurucu devretti; kurucunun hedefi "her zaman en neti vermeliyiz"): Ek 2'nin `high+s0.25`
adayı — uygulamanın kendi `high` küçültmesinden sonra 3 × 3 bulanıklık farkıyla 0,25 güçte keskinleştirme — **her GIF
boyutunda açılır.** Bu, Ek 2'nin ön kayıtlı karar kuralını **bilerek geçersiz kılar:** aday ana kümede kuralı geçti
(+7,7 puan, bayt ×1,03–1,04, kare başına +7,8 ms), ama ön kayda ekin istediği saklı kümede **SSIM-tel Büyük'te
−0,0021** çıktı; sınır −0,002 idi (Orta −0,0012). Kural yazıldığı gibi uygulansaydı keskinleştirme açılmazdı;
sonuç bölümü (yukarıda) bu yüzden "değişmedi" diyor ve o bölüm değiştirilmedi.

21 Ekim karşılaştırmasının sayıları (R3 / R4 çiftleri, o günün numaralarıyla; ana oturumun aktardığı, bu ek
yeniden ölçmedi):
**VMAF-tel +4,1 ile +6,8**, bayt **+%2,4 ile +%3,9**, **SSIM-tel −0,0021 ile +0,0065**.

Gerekçe: telefonda görünen netlik (VMAF-tel ve keskinleştirmeyi ödüllendirmeyen VMAF-tel-NEG) iki kümede de
6–8 puan arttı; SSIM-tel kaybı tek bir boyutta, tek kümede sınırı 0,0001 aştı, öbür durumlarda SSIM-tel arttı;
bedel küçük (dosya %2–4, süre aşağıda). Hedef "en net" olduğu için bu ince kaçırma, kazancı geri çevirmeye yeter
sayılmadı. Kural bundan sonraki ölçümler için aynen geçerli; bu ek bir istisnadır, kuralın gevşetilmesi değil.

### Uygulama

- **`GifSharpener`** (`adapters/gif/gifSharpen.ts`, yeni; tarayıcı API'si yok): ölçüm aracının `sharpen`'ıyla
  (`scripts/gif-eval/resample.ts`) **aynı aritmetik** — out = in + 0,25 × (in − blur), [1 2 1] ⊗ [1 2 1] / 16,
  kenarda kenar pikseli tekrarlanır, `Uint8ClampedArray` gibi yuvarlanır (en yakın, yarımlar çifte) ve 0–255'e
  kırpılır; alfa okunmaz, 255 yazılır. Fark: kare **yerinde** keskinleşir (her satırın bulanıklığı özgün piksellerin
  üç satırlık yatay toplamlarından; y + 1. satır, y. satır yazılmadan toplanır) ve sonuç tek bir tamsayı anahtarla
  (M × in − 16 × blur, M = 80) bir kez kurulan tablodan okunur. Birim sınaması: 15 geometride (1 × 1, tek satır,
  tek sütun, tek sayılı boylar, dört GIF boyutu) iki güçte ölçüm aracınınkiyle **bayt bayt aynı**.
- **Nerede:** `gifWorker.ts`'in tek çizim yolu `drawFrames`'te, her boyutta, `VideoSample.draw` (tarayıcının `high`
  küçültmesi; HDR'de yumuşak kırpmadan sonra) ile paletin örneği ve kodlayıcı arasında. Tahmin, tek geçiş ve iki geçiş
  aynı yoldan geçtiği için üçü de aynı kareyi görür.
- **Yazı keskinleşmez:** resim keskinleşir, yazı onun üstüne çizilir (`putImageData`, `drawGifText`, yeniden
  `getImageData`). Harflerin saf beyazı ve siyah kenarı paletin onlara ayırdığı renkler; keskinleştirme onların
  kenarında hale bırakırdı. Yazılı karede bu bir okuma / yazma daha (960 × 540'ta 0,8 ms).
- "Video olarak" (export worker'ı) dokunulmadı.

### Ölçülen (bu masaüstü, Windows; uygulamanın kendisi, `CLIP_TEST_HOOKS=1` yapısı)

**Kare başına keskinleştirme** (Playwright Chromium 153'ün bir işleyicisinde, 200 karenin ortancası, üç koşu):
Küçük 320 × 180 **0,6–0,7 ms**, Orta 480 × 270 **1,4–1,5 ms**, Büyük 640 × 360 **2,5–2,6 ms**, Çok büyük 960 × 540
**5,7–5,8 ms**. Yazılı karede ayrıca 0,1–0,8 ms. (İlk yazılan, her pikseli hesaplayan sürüm Çok büyük'te 9,6 ms idi;
tablo ile 5,8.) Telefon ~3 kat yavaş varsayılır (ölçülmedi): Çok büyük'te ~17 ms.

**GIF'i yapma süresi** (işleyicinin kendi ölçtüğü süre, sonuç kartındaki "Süre", Google Chrome; 3 koşu ortancası,
öncesi → sonrası):

| Kaynak | 4 sn Büyük | 4 sn Çok büyük | 10 sn Büyük | 10 sn Çok büyük (iki geçiş) |
|---|---|---|---|---|
| S1 (test deseni) | 0,8 → 1,0 sn | 1,2 → 1,6 | 1,8 → 2,2 | 3,7 → 6,1 |
| R3 (iPhone 1080p 30) | 1,1 → 1,3 | 1,8 → 1,9 | 2,4 → 2,9 | 5,0 → 6,8 |
| R4 (iPhone 1080p 60) | 1,1 → 1,2 | 1,5 → 1,8 | 2,4 → 2,8 | 5,0 → 7,5 |
| R8 (GoPro 720p 60) | 1,0 → 1,3 | 1,3 → 2,0 | 2,1 → 2,7 | 4,4 → 6,4 |

Kare başına **+2–6 ms Büyük'te, +2–14 ms 4 sn Çok büyük'te, +14–20 ms 10 sn Çok büyük'te** (bu masaüstünde 10 sn
Çok büyük'ün 259 MB karesi 128 MiB bütçeyi aşar: iki geçiş, her kare iki kez çizilir ve keskinleşir; çekirdeğin
2 × 5,8 ms'sinin üstündeki kısım ölçülmüş ama ayrıştırılmamıştır — keskin karede değişmeden kalan piksel azalır,
kodlayıcının işi artar). En kötüsü 10 sn Çok büyük: +1,8–2,5 sn. Telefonda ölçülmedi.

**Dosya boyutu ve tahmin** (`scripts/gif-eval/app-check.mjs`; öncesi ve sonrası aynı kaynaklarla; gerçek 11
kayıt — Ek 2'nin kümesi, K1 / K2 yok; R1 (4K), R2 (4,4 sn), R6 (neredeyse kıpırdamayan) Ek 2'dekilerle aynı
kayıtlar, öbür numaralar yeniden verildi (yukarıdaki süre tablosu dahil; eşlemesi yalnızca yerel bir dosyada); yapay S1–S5; Küçük / Orta / Büyük / Çok büyük × 4 / 10 sn; gerçek kayıtlar Google Chrome'da,
yapaylar Playwright Chromium'da):

- **Bayt, sonra ÷ önce** (her boyut ve süre için ortanca): gerçek kümede **×1,018–1,032** (tek tek 0,991–1,057),
  yapayda ×1,035–1,056 (en çok ×1,116: S1 test deseni Küçük 10 sn).
- **Tahmin ±%10 içinde: gerçek kümede 84 GIF'in 76'sı, yapayda 40 / 40.** Dışındaki 8'in hepsi **R6** (neredeyse
  kıpırdamayan dikey 1080p, 0,04–0,45 MB: ×1,13–1,54), birinci turdan beri bilinen istisna — önceki yapıda da aynı 8
  dışarıdaydı (×1,10–1,51). Tahmin yöntemi değişmedi: aynı işleyici, aynı keskin kareler.
- **ADR-052'nin ilk seçimi** (9 MB eşiği değişmedi; ölçülen tahminlere uygulanınca, süre sınırı dışarıda): 31
  kaynak / süre durumunun **30'unda aynı boyut**; değişen tek durum S3 10 sn (yapay kaydırma + kum): Orta 8,69 →
  9,26 MB, artık Küçük. Gerçek kayıtlarda seçilen boyutun tahmini en çok 8,93 MB (R11 10 sn Büyük).
- Önceki yapının bir koşusu (R9 10 sn Çok büyük) 10 dk'da bitmedi (ölçüm aracının sınırı); yeni yapıda aynı GIF 6,5
  sn'de çıktı. Tekrar edilmedi; keskinleştirmeyle ilgisi yok (önceki yapı).

### Sınamalar (Ek 3; ADR-052 Ek 4 ile aynı son kodla; yerel, Windows, port 3193, ölçüm kilidi altında)

- `tsc`, `eslint` temiz; birim **1679 / 1679** (97 dosya; yeni `gifSharpen.test.ts` 9: ölçüm aracınınkiyle 15
  geometride iki güçte bayt bayt aynı, elle hesaplanmış nokta ve hale, yarımların çifte yuvarlanması, siyah / beyazda
  kırpma, kenarlar, alfa okunmaz ve 255, tek nesneyle ardışık kareler, yanlış boy / güç reddi).
- e2e (Playwright Chromium, `CLIP_TEST_HOOKS=1` yapısı) **92 / 92**, ilk koşuda: `gif.spec.ts` 15, `gif-a11y.spec.ts` 3,
  `gif-memory.spec.ts` 2, `wizard-phone-action.spec.ts` 39, `english.spec.ts` 23, `share-target.spec.ts` 10.
  `PAGE-RECOVERED-TOTAL 0`. **İki geçiş tek geçişle bayt bayt aynı** (var olan sınama, değiştirilmedi): Küçük 4 sn
  yazılı 172 515 B, 10 sn Büyük kumlu 16 278 940 B (keskinleştirmeden önce 171 456 / 15 787 522). GIF sınamalarında
  hiçbir eşik gevşemedi; beklentisi değişen yalnızca ADR-052 Ek 4'ün satırları (yazılı / yazısız video satırı,
  videonun boyutu, ×1,15 ve doğrulama). Tahmin ÷ gerçek: 1,016 (Küçük, yazılı), 1,014 (Büyük dikey), 1,034 (Çok büyük).
- Kalite katmanı (`visual`, `a11y`, `text`, `walkthrough`; geçmişe yazılmadan, rapor depoya konmadı): ilk koşuda 705
  ölçüden 704 bütçe içinde, **farklı ekran 2** — `sihirbaz-gif-secim` telefon TR / EN: tahmin sayısı (keskin
  kareler) ve Ek 4'ün yeni çıktı satırı ("video olarak yaklaşık 250 KB …"). Fark resimlerine bakılıp yalnız bu iki taban
  yenilendi; sonra **705 bütçe içinde, 0 dışında, farklı ekran 0**; a11y 34 / 34.
- Tam e2e takımı, Pages sınaması, bulut koşulmadı.

### Doğrulanmayanlar (Ek 3)

- **Telefon:** S23'te keskin GIF'in görünüşü, süresi, tahmini ölçülmedi; kurucunun gözle karşılaştırması yapılmadı.
- Saklı kümedeki SSIM-tel kaybının (Büyük −0,0021) gözle fark edilip edilmediği bilinmiyor.
- K1 / K2 (az ışık kopyaları) bu ekte yeniden üretilmedi; tahmin ve bayt onlarda ölçülmedi.
- Safari / Firefox'un küçültmesinin üstüne keskinleştirme (yalnız Chromium'da ölçüldü).

