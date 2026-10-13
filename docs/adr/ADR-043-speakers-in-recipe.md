# ADR-043 — Kim konuştu, kalıcı: EDL v5, satırda `speaker`

> Tarih: 13 Ekim 2026 · Durum: UYGULANDI (birim, e2e ve sahte sunucuya karşı bulut sınamaları; sayılar en altta)
> İlgili: [ADR-039](ADR-039-cloud-transcript-route.md) (bulut yazıya dökme; konuşmacılar oradan gelir),
> [ADR-036](ADR-036-on-device-transcript.md) (transkript izi, EDL v3), [ADR-037](ADR-037-enhance.md) (EDL v4),
> [ADR-012](ADR-012-w3-local-persistence.md) (kayıt ve yedek), [ADR-031](ADR-031-phone-share-install-offline.md)
> (service worker), [ADR-034](ADR-034-task-first-home.md) (sihirbaz proje saklamaz),
> `video-editor-blueprint/docs/10_PROJECT_SCHEMA_CONTRACTS.md` ("EDL v5").
> Politika (belge 15, `policy.ts`) **değişmedi**. Bulut yolu varsayılan derlemede hâlâ **kapalı**.
>
> **Bu çalışmada da hiçbir dış hizmete istek gitmedi** (AssemblyAI, Cloudflare, `*.workers.dev`): bulut
> sınamaları yalnızca yerel sahte vekile (`cloud/fake-worker`, 127.0.0.1) karşı koştu. Sahte sunucu kimin
> konuştuğunu **duymaz**; betikte yazanı döndürür. Gerçek sağlayıcının kişileri ne kadar doğru ayırdığı
> hakkında buradaki hiçbir sayı bir şey söylemez (tek kaynak ADR-039'un 11 Ekim ölçümü).

## Neden

ADR-039'un istemcisi konuşmacıları tarife yazmıyordu (o gün şemayı değiştirmek, yol **kapalıyken** herkesin
kayıtlı tarifini değiştirmek demekti). Sonuç: "1. kişi / 2. kişi" yalnızca açık sihirbazın sonuç ekranında
ve metin dosyasındaydı; editöre geçince ve sayfa yenilenince kayboluyordu. Kurucu, yolu açmanın parçası
olarak bunun kalıcı olmasını onayladı.

## Karar 1 — Şekil: satırda küçük bir sıra numarası, başka hiçbir şey

```json
{ "cueId": "q_002", "startUs": 3400000, "endUs": 5000000, "text": "Olur, hazırım.", "speaker": 2 }
```

- `speaker`: isteğe bağlı, **1–20 arası tam sayı**; videoda ilk duyulan ses 1'dir. Bir ad ya da kimlik
  değil, bir **sıra**: arayüz "1. kişi", "2. kişi" der (`transcript.speaker`, var olan cümle).
- Yalnızca `origin: "transcript"` izinin satırında. Alan yoksa "bilinmiyor"; `null`/`0` yazılmaz.
- Üst sınır 20: bulut yolunun zaten uyguladığı sınır (`MAX_SPEAKERS`); artık tek yerde,
  `CAPTION_LIMITS.maxSpeakers`. Yirmi birinci sesin satırları konuşansız kalır (uydurulmaz).
- **İz düzeyinde alan yok** (kişi sayısı, ad tablosu). Düşünüldü ve bırakıldı:
  - *Sayı* satırlardan türetilir; ayrı saklansa bir satır silindiğinde yalan söylerdi.
  - *Ad tablosu* (`1 → "Ayşe"`) yeniden adlandırma içindir; o bir arayüz kararı bekliyor (aşağıda).
    Geldiğinde izde isteğe bağlı bir alan olarak eklenebilir; bugünkü satır alanı onunla çelişmez.
- Numaralar 1'den başlamak ya da boşluksuz olmak zorunda değil: birinci kişinin bütün satırları silinince
  ikinci kişi "2. kişi" kalır. Yeniden numaralamak, kullanıcının gözü önünde etiket değiştirmek olurdu.

Hata kodları (ortak fixture'larla; `web/fixtures/edl/invalid/caption-speaker-*`):

| Durum | Kod | Yol |
|---|---|---|
| `0`, `21`, `1.5`, `"Ayşe"`, `null` | **`caption_speaker_invalid`** (yeni) | `captionTracks[i].cues[j].speaker` |
| `manual` ya da `imported` izde `speaker` | `caption_track_invalid` (`unclear` ile aynı kural) | aynı |
| izde `speakers` gibi bir alan | `unknown_field` | `captionTracks[i].speakers` |

## Karar 2 — Geçiş: yalnızca numara

v4 → v5 kayıpsız ve mekaniktir: `schemaVersion` 5 olur, başka hiçbir bayt değişmez (alan sırası dahil;
birim testi `JSON.stringify` eşitliğiyle sınar). v1, v2, v3 kendi kurallarıyla doğrudan v5'e gelir.
Hiçbir geçiş bir satıra konuşan **eklemez**. Daha eski bir numara taşıyıp satırında `speaker` bulunan
tarifi hiçbir derleme yazmadı: yükseltilmez, `schema_version_unsupported` ile reddedilir (v4'teki
`enhance` kuralının aynısı). Yeni fixture klasörü: `legacy-v4/` (yayındaki derlemenin yazdığı biçim).

Kesiti olmayan kayıtlı proje (ADR-012 eki) aynı yoldan geçer (`loadStoredProject`); v4 yedek dosyaları
(`*.lilocut.json`, eski `*.clip.json`) açılır.

### Otomatik kayıt: her kayıtlı proje ilk açılışta v5 olarak yeniden yazılır

Olan: editör kaydı okur (`parseRecord` → bellekte v5), geri yükleme bitince otomatik kayıt 500 ms sonra
kaydı **yeniden yazar**. Bu, v1→v2, v2→v3 ve v3→v4'te de böyleydi (`captions.spec.ts` "The next autosave
writes the migrated recipe"); emsal izlendi, davranış değiştirilmedi. Yeniden yazılan kayıtta v4'e göre
değişen: `edl.schemaVersion` (4 → 5) ve `updatedAt`. Tarifin geri kalanı, bağlar, ad, `createdAt` aynı
(e2e: `persistence.spec.ts` "the build before this one (v4)…", depoya v4 kayıt konur, açılır, depodaki
tarif numarası dışında bayt bayt karşılaştırılır).

Varsayılan derlemede bulut yolu kapalı olduğu için **hiçbir proje konuşan kazanmaz**; kullanıcının
göreceği tek fark yoktur.

## Karar 3 — Geri yol yok; eski kabuk yeni kaydı ne yapar

v5 tarifi v4'e indiren bir yol **yoktur** ve yazılmadı (konuşanları sessizce silmek olurdu).

**Yayındaki derleme (v4, `bbc13ea`) bugün yüksek numaralı bir kayıtla ne yapıyor** (kod okunarak; bu
çalışmada eski derleme ayrıca çalıştırılmadı):

1. `validateProject` numarayı görür, başka hiçbir şeye bakmadan `schema_version_unsupported` der;
   `parseRecord` → `edl_invalid`; depo → `corrupt`. **Proje yüklenmez, bozulmaz, kısmen okunmaz.**
2. Ama dürüst değildir: kullanıcıya hiçbir şey söylenmez (yükleme hatası yalnızca tanı dosyasına
   yazılır), editör boş açılır, başlık "Düzenleme henüz saklanmadı" der.
3. Ve korumaz: kullanıcı o sekmede yeni bir video açarsa otomatik kayıt aynı anahtara (`p_local_001`)
   yazar ve **v5 kaydın yerine yenisini koyar**. Kayıt bozulmaz ama eski proje gider.
4. Yedek dosyası: "Yedek dosyası okunamadı veya bu sürümle uyumlu değil." — bu cümle doğru.

**Bu ne zaman olabilir?** v5 derlemesi bir tarayıcıda en az bir kez çalışıp kaydı yeniden yazdıktan
sonra aynı tarayıcının yeniden v4 kabuğu açması gerekir:

- *İki sekme:* yayından önce açılmış bir sekme (v4, proje belleğinde) ve yeni açılan bir sekme (v5).
  Eski sekme bir düzenleme yaparsa kendi v4 tarifini yazar — son yazan kazanır; bu, şemadan bağımsız
  olarak bugün de böyledir ve yazılan kayıt geçerlidir. Eski sekme **yenilenirse** yeni kabuk gelir.
- *Service worker (ADR-031):* yeni derlemenin sayfası ağdan gelip çalıştı, yeni worker'ın kurulumu
  yarıda kaldı (bağlantı kesildi), sonraki açılış çevrimdışı ya da ağ 4 sn'den yavaş → saklanan (v4)
  kabuk açılır ve v5 kaydı görür. Dar bir pencere: yeni worker kurulur kurulmaz saklanan kabuk da v5'tir
  ("sayfa zaten yeni derlemeye aitse yeni worker sessizce devreye alınır").

Yayındaki kodu geriye dönük düzeltemeyiz. Bu pencere **v4 → v5 geçişi için açık kalır** ve kabul edildi:
dar, kayıp tek proje yuvasıyla sınırlı, ve varsayılan derlemede v5 kaydın v4'ten farkı yalnızca numaradır.

**Bundan sonrası için (bu derleme):** aynı şey v5 → v6'da olmasın diye bu derleme, kendisinden yeni bir
kayıtla karşılaşınca:

- onu bozuk kayıttan **ayırır**: `parseRecord` → `edl_newer` (numara bu derlemeninkinden büyük bir tam
  sayıysa; tarifin içinden başka hiçbir şey okunmaz), depo → `newer`;
- **söyler**: başlıkta "Düzenleme saklanamadı · Bu proje daha yeni bir sürümle saklanmış. Sayfayı yenile. Bu sayfada yaptıkların saklanmaz." ve yanında "Yedek dosyasını indir";
- **üstüne yazmaz**: o sekmede otomatik kayıt ve sayfadan çıkarkenki son yazma durur. (Çıkış uyarısı
  bu durumda gösterilmez: çare zaten sayfayı yenilemektir.)

e2e: `persistence.spec.ts` "a NEWER build: the project is not opened, not written over, and the header
says why" — depoya v6 kayıt konur; video açılıp kesit eklenir, 1,5 sn beklenir, sayfa yenilenir; kayıt
her seferinde aynıdır.

## Karar 4 — Düzenleme kuralları

| İşlem | Konuşan |
|---|---|
| Satırın metnini düzeltmek ("Yazı" panelindeki kalem, altyazı panelindeki metin) | **Kalır** |
| Satırın zamanını değiştirmek, bütün satırları kaydırmak | Kalır |
| Satırı silmek | Öbür satırlarınki değişmez (yeniden numaralama yok) |
| Elle satır eklemek, "(anlaşılamadı)" aralığını elle yazmak | Yeni satırın konuşanı **yoktur**; çevresindeki etiketler bozulmaz |
| "Bunlardan kesit yap" | Satırlara dokunmaz; kesitler eklenir |
| **Bölme** — iz çıktı zamanına çevrilirken bir satır kesit sınırında parçalanır ya da bir aralık iki kez kullanılır | **Her parça** satırın konuşanını taşır |
| **Birleştirme** — iz kaynak zamanına çevrilirken videoda bitişik parçalar | Yalnızca **aynı satırın** parçaları birleşir ve konuşanı taşır. İki ayrı satır hiçbir işlemde birleştirilmez: bir satır iki kişinin sözünü taşıyamaz (ADR-039'un satır kuralı) |
| Altyazı dosyası içe aktarmak; cihazda yeniden yazıya dökmek | İz yeniden kurulur; eski satırlarla birlikte konuşanlar da gider (içe aktarılan izin `origin`'i `imported`'dır) |
| Geri al / yinele | Tarifin tamamı gibi |

Uygulamada satırı ikiye bölen ya da iki satırı birleştiren bir **kullanıcı komutu yoktur**; yukarıdaki
iki satır, var olan tek bölme/birleştirme yerini (`convertCaptionTimeBase`) anlatır. Böyle bir komut
eklenirse kural aynıdır: parçalar konuşanı korur; farklı konuşanlı iki satır birleştirilmez ya da
birleşen satır konuşansız kalır (o gün karar verilir).

## Karar 5 — Nerede görünür

- **"Yazı" paneli** (sihirbazın sonuç ekranı ve editör): ses değişen satırda "1. kişi" / "2. kişi" —
  var olan sunum (`transcript-speaker`), yeni arayüz kavramı yok. Panel artık etiketleri sihirbazın
  belleğinden değil **satırların kendisinden** okur; bu yüzden editörde, yedekten sonra ve yenilemeden
  sonra aynıdır.
- İzde en az **iki ayrı** konuşan yoksa hiçbir yerde etiket yoktur (tek kişilik videoda "1. kişi" bir
  şey söylemez); numara yine de saklanır.
- **Videoya çizilmez.** Yakılan altyazı değişmedi: render planı `speaker`'ı okumaz; konuşanlı tarifin
  planı ve parmak izi, alanı silinmiş aynı tarifinkiyle aynıdır (birim testi).
- "İnternette yazıldı" etiketi **hâlâ kalıcı değil** (tarif yazının nerede yazıldığını tutmuyor); editör
  aynı izi "Otomatik yazıldı — yanlış olabilir" diye gösterir. Kapsam dışı; ADR-039'daki satır geçerli.

### Dosyalar

| Dosya | Karar | Neden |
|---|---|---|
| **TXT** ("Metni indir") | Ses değişen satırda `[00:04] 2. kişi: …` (değişmedi; artık editörden geçmiş projede de doğru) | İnsan okur |
| **VTT** | Konuşanı olan **her** satır ses etiketiyle yazılır: `<v 2. kişi>Olur, hazırım.` | WebVTT'nin bunun için yeri var ("cue voice span"). Etiket metnin parçası değildir: oynatıcı metni gösterir; bu uygulamanın kendi okuyucusu dahil dosyayı okuyan her program etiketi atar. Satır tek başına taşınabildiği için her satırda (yalnız değişen yerde değil) |
| **SRT** | Konuşan **yazılmaz**; dosya v5'ten önceki ile bayt bayt aynı | SRT'de standart bir yer yok. Yaygın çözüm metnin önüne "2. kişi: " yazmaktır; ama o zaman ad, dosyayı okuyan her program için **metnin kendisi** olur — başka bir araçta videoya yakılırsa ya da bu uygulamaya geri alınırsa altyazıda görünür. Varsayılan, yakılan altyazıyı değiştirmemeli |
| **Yedek** (`*.lilocut.json`) | Tarifin kendisi: satırlarda numara | Etiket metni ("kişi") dosyada yoktur; dil değişse de aynı dosya |
| **Altyazılı video** (MP4) | Değişmedi | Yukarıda |

Ses etiketinin içine giren ad `<`, `>`, `&` ve satır sonundan arındırılır (bugün ad yalnızca çeviri
tablosundan gelir; yeniden adlandırma gelince kullanıcı metni olacak).

VTT geri alınırsa konuşanlar **geri gelmez**: içe aktarılan iz `imported`'dır. Konuşanları taşımanın
yolu yedek dosyasıdır.

## Bulunan: bulut yazısı kalıcı projeye yalnızca yedek dosyasıyla geçer

> **ÇÖZÜLDÜ — 13 Ekim 2026** (kurucu kararı: "Bulut yazısı editöre geçişte saklansın";
> [ADR-034'ün 13 Ekim eki](ADR-034-task-first-home.md)). İnternette yazılan yazının üstünde "Daha fazla
> ayar → editörde aç"a basılınca çalışma kayıtlı proje olur; yenileme onu konuşanlarıyla geri getirir
> (video dosyası yeniden seçilerek). Kayıtlı proje varsa önce sorulur. Sonuç ekranı, geçişten önce yazının
> saklanmadığını söyler. Aşağıdaki paragraf o günkü durumu anlatır ve tarih için bırakıldı; yedek dosyası
> yolu çalışmaya devam ediyor ve sınanıyor (başka bir tarayıcıda).

Bu işin kendisinden bağımsız, ama "sayfa yenilenince" ne demek olduğunu belirlediği için yazılıyor:
bulut yolu yalnızca **sihirbazdadır** (ADR-039) ve sihirbaz proje **saklamaz** (ADR-034) — sihirbazdan
"editörde aç" ile gelinen editör de saklamaz (başlık "Bu düzenleme saklanmıyor" der). Yani internette
yazılmış bir yazı (dakika harcamış bir iş) sihirbazın sayfası yenilenince **tamamen** gider; konuşanlar
değil, yazının kendisi. Kalıcı olmasının bugünkü tek yolu: editörde "Diğer → Yedek dosyasını indir", sonra
`/editor`'de "Yedek dosyasından geri yükle". Konuşanlar bu yolda korunur ve bulut sınaması tam bu yolu
yürür (yedek → başka editör → yenileme). Bunu kısaltmak yeni bir arayüz kararıdır; yapılmadı (aşağıda).

## Kalite katmanı

`walkthrough-yazi-bulut.spec.ts`'e ikinci bir ölçüm eklendi ("sahte sunucuya karşı" etiketiyle, rapor
bölümü "‘Kim konuştu’ kalıcı mı"): betikteki dört konuşma sırasının etiketi sonuç ekranında, editörde,
yedek dosyasında, yedekten açılan editörde, yenilemeden sonra depoda ve ekranda, VTT'de sayılır; SRT'de
"kişi" geçmediği sayılır. Bütçe: hepsi = 4, SRT = 0 (`budgets.json`, `walk.fakecloud.*.speakers.*`).
Betiğin ulaşamadığı adım "ölçülemedi" yazılır, geçmiş sayılmaz. Var olan akış ölçümünün (tıklama, ekran,
kelime) bütçelerine dokunulmadı; yeni adımlar o sayılara eklenmedi (ayrı test).

**13 Ekim, ADR-034 ekiyle:** "yenilemeden sonra" artık yedek dosyası dolambacıyla değil, **editöre geçişin
sakladığı projenin kendi sayfası yenilenerek** ölçülür; yeni sütun "editöre geçince depoda". Yedek dosyası
ayrı bir yol olarak kaldı ve deposu boş başka bir tarayıcıda açılarak sayılır. Bütçe aynı (hepsi = 4, SRT = 0).

## Doğrulanmayanlar

- **Gerçek sağlayıcı.** Kişi ayrımının doğruluğu; sağlayıcının konuşan adlarının ("A", "B", …) ilk
  duyulma sırasına göre numaralanmasının gerçek yanıtlarda beklendiği gibi çalıştığı (yalnızca sahte
  yanıtlarla ve birim testleriyle sınandı).
- **Yayındaki v4 derlemesinin v5 kayıtla davranışı** kod okunarak yazıldı; eski derleme bu çalışmada
  ayrı bir sunucuda çalıştırılıp v5 kayıtla denenmedi. Service worker penceresi gerçek bir yayınla
  sınanmadı.
- **Başka oynatıcılar.** VTT ses etiketinin VLC, YouTube, tarayıcıların `<track>`'i gibi yerlerde nasıl
  göründüğü denenmedi (standart davranış: metin gösterilir, etiket gösterilmez ya da stil için kullanılır).
- **Gerçek telefon**, Safari, Firefox: denenmedi (bu işte tarayıcıya özgü kod yok).
- **Dart / Python** doğrulayıcıları yok; ortak fixture'lar yalnızca TypeScript'te koşuyor (belge 10'un
  "üç dilde aynı sonuç" koşulu bu depo için hâlâ açık).

## Kurucu kararları gerekiyor

1. **Kişileri yeniden adlandırma** ("1. kişi" → "Ayşe"): kapsam dışı bırakıldı, arayüz kararı ister
   (nerede yazılır; bir kişinin adı bütün satırlarında mı değişir; ad videoya yakılsın mı). Şema hazır:
   izde isteğe bağlı bir ad tablosu eklenir, satırlar değişmez.
2. **SRT'de konuşan:** bugün yok. İstenirse "metnin önüne ad" bir seçenek olarak eklenebilir; varsayılan
   olmamalı (yukarıdaki neden).
3. **Yakılan altyazıda konuşan:** bugün yok ve bu ADR onu değiştirmiyor.
4. ~~**Bulut yazısının kalıcılığı** (yukarıdaki "Bulunan"): sihirbazın işi saklanmadığı için internette
   yazılan yazı yenilemede gider; tek yol yedek dosyası. Yol açılmadan önce bilinmeli. Seçenekler:
   olduğu gibi bırak ve sonuç ekranında söyle; sihirbazdan editöre geçişte projeyi sakla (ADR-034'ü
   değiştirir, kayıtlı projenin yerine geçer); editörün kendi "Videoyu yazıya dök"üne bulut yolunu ekle.~~
   — **13 Ekim 2026: karar verildi ve yapıldı** — editöre geçişte saklanır, kayıtlı projenin yerine
   sormadan geçmez, sonuç ekranı geçişten önce saklanmadığını söyler (ADR-034 eki).
5. **"İnternette yazıldı" etiketi** kalıcı olsun mu (tarife `origin` ayrıntısı; ayrı bir şema eklemesi).
   — 13 Ekim: hâlâ açık. Yazı artık saklandığı için daha görünür: saklanan projede yazının internette
   yazıldığını gösteren hiçbir şey yok (ADR-034 eki, "İnternette yazıldı etiketi").
6. **v4 → v5 penceresi** (Karar 3): kabul edildi sayıldı. İstenirse yayından önce v4 derlemesine
   yalnızca "daha yeni kayıt" korumasını taşıyan ara bir yayın yapılabilir (önce o, sonra v5).

## Sınamalar (13 Ekim 2026, dal `worktree-agent-a08295f6ffb53c053`; hepsi yerel)

| Ne | Sonuç |
|---|---|
| `tsc --noEmit`, `eslint .` | hatasız |
| Birim (vitest) | **1341 / 1341** (77 dosya; 30'u yeni `speakers.test.ts`; fixture'lardan 15 yeni durum; sürüm numarasını sabit yazan 12 sınama güncellendi — numara dışında beklenti değişmedi) |
| e2e, olağan derleme (yol **kapalı**; `CLIP_TEST_HOOKS=1`) | 370 sınama: **366 geçti, 4 atlandı, 0 başarısız** (atlananlar önceki dördü: 2 ekran görüntüsü, 2 gerçek-model). 3'ü yeni (`persistence.spec.ts`: v4 kayıt, v4 / daha yeni yedek, daha yeni kayıt); `captions.spec.ts` ve `enhance.spec.ts`'te depodaki sürüm numarası beklentisi 4 → 5 |
| e2e, bulut derlemesi, yerel sahte Worker'a karşı (`playwright.cloud.config.ts`) | 45 sınama: **41 geçti, 4 atlandı** (ekran görüntüsü betikleri). 2'si yeni (`cloud-speakers.spec.ts`). İlk iki koşuda yeni sınamanın **kendisi** kırıldı (saklanan iki satırlı metni tek satırla karşılaştırıyordu; sonra paneli beklemeden okuyordu); sınama düzeltildi, uygulama kodu o koşular arasında değişmedi |
| `npm run quality` | 641 ölçü: **564 bütçe içinde, 8 dışında** (yedi arama ölçüsü ve `out.notFaststart`; hepsi önceki koşulardaki açık maddeler), 5 ölçülemedi (model dosyaları yok), 64 bütçesiz. Yeni tablo: masaüstü ve telefonda her adım 4 / 4, SRT 0. Ekran tabanları değişmedi |
| Durağan çıktı, varsayılan (`STATIC_EXPORT=1`, `/capcut`) | derlendi; 17 sayfa; çıktıda bulut kodu yok (`apply-csp` denetimi geçti) |
| **Koşulmayan** | Pages duman sınaması, tarayıcı matrisi, `cloud/` altındaki sınamalar (o kod değişmedi), gerçek telefon, gerçek Worker ve sağlayıcı |

