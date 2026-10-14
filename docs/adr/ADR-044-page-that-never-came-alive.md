# ADR-044 — Sunulup da canlanmayan sayfa: bir kez kendini yeniden yükler, olmazsa söyler

> Tarih: 2026-10-13 · Durum: UYGULANDI (birim, e2e, Pages duman testi, 1 000+ yüklemelik dayanıklılık koşusu).
> **Olayın kendisi yeniden üretilemedi**; mekanizması kanıtlandı (aşağıda "Kanıtlanan / varsayım").
> Politika (belge 15) ve şema (EDL) değişmedi. Tarayıcıda saklananlara **bir anahtar eklendi**
> (`sessionStorage` → `clip:page-recovery`; `docs/privacy/DATA_INVENTORY.md` §2.4a ve `/gizlilik` metni
> aynı değişiklikte güncellendi). Hiçbir dış hizmete istek gitmedi.

## Bağlam: üç olay, tek aile

| Ne zaman | Nerede | Ne görüldü |
|---|---|---|
| 5 Ekim 2026 | CI (Windows koşucusu, koşu 37303427271) | Açılış ekranının kendi stil dosyası (`home.css`) gelmedi; axe 23 "kontrast" bulgusu verdi (`docs/a11y/2026-09-22-audit.md`, "Kararsız test"). Sayfa çalışıyordu, biçimsizdi; hiçbir şey bunu söylemedi. |
| 11 Ekim 2026 | Yerel tam e2e koşusu | `transcript-a11y.spec.ts:300` — `page.goto('/yap/yazi')` döndü, `video-input` 300 sn boyunca hiç gelmedi. |
| 13 Ekim 2026 | CI (Windows koşucusu, koşu 38371421148) | `wizards.spec.ts:870` — `page.goto('/yap/cevir')` döndü, "Videonu seç" başlığı göründü, sayfa dökümünde "Video seç" düğmesi 300 sn boyunca `[disabled]`. |

"Video seç" düğmesi `disabled={!hydrated}` ve gizli dosya girişi yalnızca `hydrated` olunca çizilir
(`WizardFlow.tsx`, `useHydrated.ts`). Yani üçüncü olayda: sunucunun HTML'i geldi, `load` olayı ateşlendi,
**React sayfayı hiç devralmadı**, ekranda bunu söyleyen tek kelime yoktu ve hiçbir şey yeniden denemedi.
Gerçek bir kullanıcı için aynı şey kötü bir bağlantıda olur: sonsuza kadar basılamayan bir "Video seç" —
vaadi "bir çocuk kullanabilir" olan bir uygulamada.

## Ne arandı, ne bulundu

### 1. Yeniden üretme denemesi: olmadı

`web/scripts/soak/hydration-soak.mjs` (her yükleme yeni tarayıcı bağlamında; hidratlanma işaretini bekler;
bekleyen/başarısız istekleri ve konsolu yazar), değişiklikten **önceki** derlemede:

- boşta 400 yükleme: 0 başarısız;
- 16 paralel sayfa + CPU'yu dolduran 10 süreçle 1 500 yükleme: 0 başarısız — ama **bir** yüklemede
  `requestfailed script net::ERR_NO_BUFFER_SPACE` görüldü ve o sayfa yine de hidratlandı.

`ERR_NO_BUFFER_SPACE` bu makinede bilinen bir ortam durumudur (`docs/a11y/2026-09-22-audit.md`: her tarayıcı
bağlamı 6 TCP bağlantısı açar, kapanınca 120 sn `TIME_WAIT`'te kalır; birkaç iş aynı anda koşunca Windows'un
geçici bağlantı noktası aralığına yaklaşılır). Yani "tek bir derleme dosyasının isteği başarısız olur" bu
makinede gerçekten yaşanan bir şeydir; ölü sayfayla sonuçlandığı an ise yakalanamadı.

### 2. Mekanizma: tek bir dosya gelmezse ne olur? (arıza sondası)

`web/scripts/soak/fault-probe.mjs` derlemeyi (`next start`) küçük bir vekilin arkasına koyar; vekil tek bir
isteği seçilen biçimde bozar (bağlantıyı keser, hiç yanıt vermez, 500/404 döner, dosyanın yarısını gönderir,
yarıda keser, yarıda durur) ve her (dosya, bozulma) çifti için sayfayı yeni bir tarayıcı bağlamında açıp
ekranda ne olduğunu yazar. Tablo: **`docs/quality/2026-10-13-hydration-faults.md`** (değişiklikten önce 395
durum, sonra 360 durum). Özeti:

- **Sayfanın ilk HTML'indeki 13 betikten HERHANGİ BİRİ** (çatı, React, Turbopack çalışma zamanı, düzen,
  sayfanın kendi kodu — hangisi olduğu fark etmiyor) bağlantı kopması / 500 / 404 / yarıda kesilme ile
  gelmezse: `load` **ateşlenir**, başlık görünür, **"Video seç" `disabled` kalır**, Next'in hata ekranı
  **çıkmaz**, sayfa hatası (pageerror) **yoktur**; konsolda yalnızca tarayıcının "Failed to load resource"
  satırı vardır. 13 betik × 4 bozulma = 52 durumun 52'si. **Bu, 13 Ekim CI dökümünün aynısıdır.**
- Dosya yarım ama "başarılı" gelirse (200, yarım gövde): aynı ölü sayfa; konsolda bir `SyntaxError`.
- Yanıt hiç gelmezse / yarıda durursa: `load` **ateşlenmez**, sayfa aynı ölü hâlde, tek kelime yok.
- `/yap/yazi`'nin kendi ekranını getiren parçalar (sayfayla birlikte, sonradan istenir): gelmezse Next'in
  İngilizce ham hata ekranı ("This page couldn't load · Reload to try again, or go back"); **yanıt hiç
  gelmezse `load` ateşlenir ve sayfa konsolda tek satır olmadan ölü kalır** — 11 Ekim olayının imzası.
- Stil dosyası gelmezse: sayfa çalışır, biçimsiz kalır (5 Ekim olayı).
- Sonradan istenen parçalar (sihirbazdan açılan editör, "Sorun bildir"): gelmezse Next'in ham hata ekranı
  sayfanın tamamının yerine geçer — açık video ve seçim gider; yanıt gelmezse "Editör açılıyor…" sonsuza
  kadar kalır, "Sorun bildir"e basınca hiçbir şey olmaz.
- İşleyici (worker) betikleri: var olan koruma çalışıyor ("Çözümleme bu tarayıcıda başlatılamadı… Yeniden
  dene"; yerinde sayarsa ADR-042 ekindeki süre sınırı). Bu değişiklik onlara dokunmadı.

### 3. Neden sessiz? (Turbopack çalışma zamanının okunması)

Next 16.3.8'in ürettiği `turbopack-*.js` içinde parça yükleyicisi şunu yapar:

- Sonradan istediği bir betik başarısız olursa **200–600 ms sonra bir kez daha dener**, o da olmazsa
  `ChunkLoadError` ile reddeder ve kaydı siler (bir sonraki `import()` yeniden ağa gider).
- Ama sayfanın HTML'inde **zaten duran** bir `<script>` için yalnızca o etikete bir `error` dinleyicisi
  takar. Betik, dinleyici takılmadan önce başarısız olduysa (çalışma zamanı henüz inmemişken kopan bir
  bağlantı) ya da "çalışma zamanı bağımlılığı" sayılıyorsa söz **hiç sonuçlanmaz**: ne çözülür ne reddedilir.
  React hidratlamaya başlamak için o sözü bekler. Hata yok, zaman aşımı yok, yeniden deneme yok.

Dayanıklılık koşusundaki tek `ERR_NO_BUFFER_SPACE` vakasının neden hidratlandığı da buradan okunur:
dinleyici o sefer zamanında takılmıştı ve çalışma zamanının kendi tek denemesi tutmuştu.

### 4. Kendi kodumuzda hidratlamayı sonsuza kadar bekletebilecek bir şey var mı?

Kod okundu; **yok**:

- üst düzey `await` yok; istemci bileşenlerinin çizim yolunda `use()` ile okunan söz yok; bizim yazdığımız
  `<Suspense>` yok;
- `useSyncExternalStore` kullanan işaretler (`useHydrated`, `useLayoutMode`, `useTouchScreen`, ilk kullanım
  ipucu, PWA) eşzamanlıdır, sunucu görüntüsü sabittir;
- `PwaClient` service worker'ı bir `effect` içinde ve `load`'dan sonra kaydeder;
- 13 Ekim'de eklenen yetenek denetimi (`BrowserNotice.tsx`: `checkEnvironment`, `isChromiumBrowser`) eşzamanlı
  özellik sorgularıdır; ağ ya da söz yok.

Tek askıda kalabilen yer çatının kendisidir: yukarıdaki parça sözleri ve `next/dynamic` ile sunucuda da
çizilen iki sihirbaz ("Yazıya dök", "İyileştir") — parçaları gelene kadar o bölüm hidratlanmaz.

### Kanıtlanan / varsayım

- **Kanıtlandı:** ilk HTML'deki herhangi bir derleme betiğinin isteği başarısız olursa sayfa tam olarak CI
  dökümündeki hâlde kalır (52/52); bunun nedeni çatının hiç sonuçlanmayan parça sözüdür; bizim kodumuz
  hidratlamayı engellemiyor.
- **Kanıtlanmadı:** 11 ve 13 Ekim'de olanın bu olduğu. O koşulardan ağ kaydı yok; olay yerelde yeniden
  üretilemedi. En güçlü dolaylı kanıtlar: imzanın birebir aynı olması, aynı makinede ve aynı CI
  koşucusunda "tek dosya gelmedi"nin daha önce görülmüş olması (5 Ekim, `ERR_NO_BUFFER_SPACE`).
- Bu yüzden çözüm nedeni değil **sonucu** hedefler: neden ne olursa olsun, canlanmayan sayfa bunu fark
  eder. Bir sonraki sefer ayrıca **görünür** olur (Karar 4).

## Karar 1 — Sayfanın bekçisi: çatı olmadan çalışan bir satır içi betik

`web/scripts/lib/page-watchdog.js` (şablon; ne yaptığı başındaki açıklamada). `scripts/apply-csp.mjs` onu her
derlemeden sonra **her sayfanın `<head>`'ine, karakter kümesi ve güvenlik politikasından hemen sonra, ilk
betik olarak** yazar ve özetini (sha256) o sayfanın politikasına ekler — Next'in kendi satır içi betikleri
gibi; `'unsafe-inline'` yok. 6,1 kB düz JavaScript (gzip ile 2,1 kB), `var` ve işlevlerle
yazıldı: ayrıştırılamayan bir bekçi kimseyi korumaz.

**Neden düzenin (layout) içinde değil de derleme sonrasında.** İlk sürümde React'in çizdiği bir `<script>`
idi (gövdenin ilk öğesi). Ölçümde görüldü: satır içi betik, kendinden önceki stil dosyalarını bekler; o
sırada başarısız olan bir derleme betiğinin `error` olayı bekçi dinlemeye başlamadan ateşlenip kaçabiliyor
(son betik kesildiğinde kurtarma 4 sn yerine 15 sn sürdü; kesilen stil dosyası ikinci denemede hiç
görülmedi). `<head>`'in başında ondan önce hiçbir şey istenmez. Yan kazanç: betik sayfada bir kez durur
(React ağacında olsaydı RSC yükünde bir kez daha taşınırdı).

**"Canlı" ne demek.** `<html data-clip-alive>` (kök düzenin bir `effect`'i koyar: `PageAlive.tsx` — yani
React sayfayı devralmıştır) **ve** sayfada `data-clip-pending` taşıyan öğe kalmamıştır (sihirbazın ilk ekranı
hidratlanana kadar taşır: kendi parçası gelmeyen "Yazıya dök" kök düzen canlı olsa da canlı sayılmaz).

**Ne yapar.**

| Görülen | Yapılan |
|---|---|
| Sayfanın bir derleme betiği yüklenemedi (`error` olayı, yakalama evresinde) ve sayfa **4 sn** sonra hâlâ canlı değil | Bir kez yeniden yükle |
| Sayfanın kendi stil dosyası yüklenemedi (ya da `load` anında sayfası yok) ve sayfa henüz canlı değil | Bir kez, hemen yeniden yükle (stil dosyasını kimse yeniden denemez) |
| `load` ateşlendi, **15 sn** sonra sayfa canlı değil | Bir kez yeniden yükle |
| O tek yeniden yüklemeden sonra da canlı değil | Uyarıyı göster; **bir daha kendiliğinden yeniden yükleme yok** |
| **45 sn** geçti, `load` bile gelmedi (yerinde sayan istek) | Uyarıyı göster, **yeniden yükleme yok**; dosya sonunda gelirse uyarı kendiliğinden kalkar |
| Sayfa **canlı** ve sonradan bir parça kimse söylemeden başarısız oldu (yakalanmamış `ChunkLoadError`, kendi stil dosyası) | Uyarının "bir parça açılamadı" hâlini göster ("Kapat" ile); **asla yeniden yükleme** — açık video ve seçim giderdi |

### Eşikler ve gerekçeleri

Dayanıklılık koşusunun ölçtüğü: gezinmenin **başından** hidratlanmaya kadar ortanca 0,3–0,8 sn; ağır yük
altında (16 paralel sayfa + 10 CPU yakıcı) 99. yüzdelik 6,5 sn.

- **15 sn (`load`'dan sonra).** Sayaç gezinmenin başından değil `load`'dan başlar ve ölçülen en kötü
  değerin iki katından fazladır. Yanlış alarmın bedeli: üzerinde henüz hiçbir şey yapılamamış bir sayfanın
  bir kez yeniden yüklenmesi. Bedel küçük olduğu için 30–60 sn beklemek yerine 15 sn seçildi; 10 sn'nin
  altı ölçülen 6,5 sn'ye fazla yakın.
- **4 sn (bir dosya başarısız olduktan sonra).** Çatı o dosyayı 200–600 ms sonra kendisi bir kez daha ister;
  dosyanın gelmesi ve hidratlanma için üç saniyeden fazla kalır. Hemen yeniden yüklenmedi, çünkü çatının
  kendi denemesi tutarsa (dayanıklılık koşusundaki vaka) hiçbir şey gerekmez.
- **45 sn (`load` gelmeden).** Burada yalnızca uyarı vardır, yeniden yükleme yoktur: yavaş bir bağlantıda
  yeniden yükleme, inmiş olanı çöpe atar. Uygulamanın bütün betiği 1 MB'ın altındadır; 45 sn'de `load`'a
  ulaşamayan bir bağlantıda kullanıcıya düğmeyi vermek dürüst olandır. 40 sn geciken bir betikle sınandı:
  uyarı bir an bile görünmedi.
- **5 dakika.** Aynı sekmede ikinci bir otomatik yeniden yükleme için en kısa aralık (ilki başarılı olmuş
  olsa bile).

Saniyeler, gerçekten çalışmış bir saniyelik vuruşlarla sayılır: dondurulmuş ya da uyutulmuş bir sekme
uyuduğu süreyle yargılanmaz.

### Döngü koruması

- Yeniden yüklemeden hemen önce `sessionStorage`'a `{ s: 'reloading', t, p, why }` yazılır. Gelen sayfa
  açılırken bunu görür, kendini **ikinci deneme** bilir (`s: 'retried'`) ve o sayfa ne olursa olsun
  kendiliğinden yeniden yüklenmez — bu bir zaman koşulu değil, o yüklemenin değişmez bir özelliğidir.
- Yazılamıyorsa (gizli pencere, depolama engelli) **hiç** otomatik yeniden yükleme yapılmaz; yalnızca uyarı.
- Uyarıdaki düğmeler de aynı notu yazar: düğmeyle gelen yükleme de ikinci denemedir.
- Kanıt: birim testi "her yüklemesi ölen sekme: tam olarak bir otomatik yeniden yükleme, kullanıcı düğmeye
  kaç kez basarsa bassın" ve "ikinci deneme bir saat boyunca dosyalar başarısız olmaya devam ederken
  yeniden yüklenmez"; e2e "betikler hiç gelmiyor: bir yeniden yükleme, uyarı, **bir dakika sonra hâlâ
  ikinci yükleme**; düğme → üçüncü yükleme → 25 sn sonra hâlâ üçüncü".

### Uyarı

Kök düzende önceden çizilmiş, gizli, **düz HTML** (`PageWatchdog.tsx`); göstermek için React gerekmez.
Türkçe ve İngilizce aynı HTML'dedir, betik sayfanın dilini gösterir (İngilizce yalnızca `/gizlilik/en`).

> **Sayfa tam açılamadı.** İnternet bağlantın takılmış olabilir. · **[Yeniden yükle]**

Canlı sayfada sonradan başarısız olan parça için: "**Uygulamanın bir parçası açılamadı.** İnternet bağlantın
takılmış olabilir. Yeniden yüklersen videonu yeniden seçmen gerekebilir. · [Yeniden yükle] [Kapat]".

Erişilebilirlik: uyarı bölgesi (`role="alert"`) sayfada hep durur ve boştur; içindeki panelin gösterilmesi
ekran okuyucunun duyurduğu değişikliktir. Düğmeler gerçek `<button>`, 44 px (var olan `--tap`), renkler var
olan "yeni sürüm hazır" bildiriminin belirteçleri. axe bulgusu yok (uyarının üç hâli ve iki yeni ekran).
Stil dosyası da gelmemişse uyarı biçimsiz ama okunur ve basılır kalır (`hidden` özniteliği CSS'siz çalışır).

### "Uygulamayı baştan indir" — neden var, ne zaman görünür

Service worker derleme dosyalarını **önce saklanan kopyadan** verir. Saklanan kopyadaki bir dosya bozuksa
(sondada: yarım dosya; dosyanın yerine saklanmış bir HTML sayfası — bir ortak ağın giriş sayfasının
yapacağı şey) sayfa her yüklemede aynı bozuk dosyayı alır: **"Yeniden yükle" işe yaramaz** (e2e'de
gösterildi), yeni bir sürüm yayımlanana kadar da yaramaz. Bu yüzden, **yalnızca** sayfayı bir service worker
yönetiyorsa **ve** tarayıcı çevrimdışı olduğunu söylemiyorsa ikinci bir düğme görünür: "Uygulamayı baştan
indir" (+ "videolarını ve projelerini silmez"). Yaptığı: bu uygulamanın service worker kaydını (kapsamı
`<base>/` olanı — `github.io` kökeni başka projelerle paylaşılır) ve `clip-app-` ile başlayan önbellekleri
siler, sonra yeniden yükler. IndexedDB (projeler, günlük), OPFS, konuşma modelinin önbelleği (`clip-models-*`)
ve localStorage'a dokunmaz (e2e: hepsi yerinde).

Çevrimdışıyken gösterilmez: o anda saklanan kopya eldeki her şeydir.

## Karar 2 — Canlı sayfada sonradan gelmeyen parça: yerinde söyler, yeniden denenir

- **`lazyPart`** (`web/src/components/LazyPart.tsx`), `next/dynamic … { ssr: false }` yerine: sihirbazdan
  açılan editör, "Sorun bildir" (editör ve sihirbaz), "Sessizlikleri bul" penceresi, editördeki yazı paneli,
  bulut yolunun iki parçası. Parça gelmezse — çatının kendi tek denemesinden sonra — **yerinde** "Bu bölüm
  açılamadı. İnternet bağlantın takılmış olabilir." + **"Tekrar dene"** (pencerelerde ayrıca "Kapat")
  gösterilir. Sayfa yerinde kalır: sihirbazın açık videosu ve seçimi durur, "Tekrar dene" tutunca editör o
  videoyla açılır (e2e: aynı sayfa, tek yükleme). Yanıtı hiç gelmeyen parça 30 sn sonra aynı cümleyle
  bildirilir ("Editör açılıyor…" sonsuza kadar kalmaz); parça sonunda gelirse gösterilir.
- **`app/error.tsx` ve `app/global-error.tsx`** (`PageCrash.tsx`): yakalanmayan bir çizim hatasında Next'in
  İngilizce ham ekranı yerine "Bir şey ters gitti" + "Yeniden yükle". Kendi ekranını getiren iki sihirbaza
  ("Yazıya dök", "İyileştir") açılış ekranından geçilirken parçaları gelmezse hata budur; cümle bağlantıyı
  söyler. Hatanın kendi metni hiçbir yerde gösterilmez. Sayfa daha hiç canlanmamışken olursa (doğrudan
  `/yap/yazi` yüklemesi) bekçi bunu "henüz canlı değil" sayar ve tek otomatik yeniden yüklemesini yapar.

## Karar 3 — Çevrimdışı

- **Çevrimdışı, kopya tam:** sayfa saklanan kopyadan açılır, bekçi susar (e2e: 20 sn, yeniden yükleme yok,
  uyarı yok, `sessionStorage` boş; ikinci bir sayfa da). Bağlantı "var ama yanıt vermiyor" ise sayfa isteği
  4 sn sonra kopyaya düşer (ADR-031); bekçinin sayacı `load`'dan başladığı için bu süre sayılmaz.
- **Çevrimdışı, kopyada bir dosya eksik:** bir yeniden yükleme, sonra uyarı — "Uygulamayı baştan indir"
  **olmadan**.
- **Çevrimdışı, hiçbir şey saklı değil:** sayfanın HTML'i de gelmez; görünen tarayıcının kendi "bağlantı
  yok" sayfasıdır. Bizim hiçbir kodumuz orada değildir; yapılabilecek bir şey yok.

## Karar 4 — Test altyapısının dürüstlüğü

Otomatik tek yeniden yükleme e2e'de de çalışır: bu duruma düşen bir yükleme, kullanıcınınki gibi kendini
iyileştirir. Bunun **sessiz** olmaması için:

- `web/tests/e2e/fixtures.ts` — bütün e2e ve bulut e2e'si dosyaları artık buradan içe aktarır. Her testte
  kendiliğinden çalışan bir düzenek, testin açtığı her tarayıcı bağlamının her sayfasını izler ve
  `PAGE-RECOVERED <adres> — <test>` (yeniden yükleme gerekti) / `PAGE-DEAD <adres> — <test>` (test bittiğinde
  uyarı hâlâ ekrandaydı) satırını yazar, teste aynı adla not (annotation) düşer.
- `web/tests/e2e/recoveryReporter.ts` — koşunun sonunda toplamı yazar; **sıfırken de**:
  `PAGE-RECOVERED-TOTAL 0 … PAGE-DEAD-TOTAL 0 …`. Bekçinin kendi testlerinin bilerek yaptıkları ayrı sayılır.
- `hydration-soak.mjs` her yüklemeyi üç sınıftan birine koyar: temiz / kurtarıldı (`RECOVERED` satırı,
  başarısız isteklerle birlikte) / başarısız.
- Playwright'a toptan `retries` **eklenmedi**: tam da bu satırları gizlerdi.
- `privacy.spec.ts`'in "oturum sonunda sessionStorage boş" denetimi yerinde duruyor: bir yükleme kendini
  kurtarmak zorunda kalırsa o test bilerek kırılır ve koşu nedenini söyler.

## Sınananlar ve sayılar

Hepsi 13 Ekim 2026, bu makine (Windows 11), dal `worktree-agent-ac320ffd570cfb61c`, son kodla, yerel:

- `tsc --noEmit` ve `eslint .`: temiz.
- **Birim (vitest):** 1 406 / 1 406 (81 dosya; 32'si yeni — `tests/unit/pageWatchdog.test.ts`: bekçinin sayfaya
  yazılan metni düz nesnelerden bir tarayıcıya karşı çalıştırılır).
- **e2e (olağan derleme, `CLIP_TEST_HOOKS=1`):** 395 test — **391 geçti, 4 atlandı, 0 başarısız** (22,4 dk).
  20'si yeni (`page-watchdog.spec.ts`, gerçek eşiklerle). Koşunun son satırı: `PAGE-RECOVERED-TOTAL 0 …
  PAGE-DEAD-TOTAL 0` — yani hiçbir yükleme kendiliğinden kurtarmaya ihtiyaç duymadı; bekçinin kendi
  testlerinin **bilerek** yaptıkları ayrı sayıldı: 9 kurtarma, 2 ölü sayfa.
- **Bulut e2e'si** (yerel sahte Worker'a karşı): 47 test — 43 geçti, 4 atlandı, 0 başarısız; kurtarma 0.
- **Statik dışa aktarma (`/capcut`) + Pages duman testi:** 9 test — 7 geçti, 2 atlandı (konuşma modeli
  dosyaları bu makinede yok), 0 başarısız; 1'i yeni (bekçi dışa aktarmada, özeti politikada, `/capcut`
  yolları doğru; bir kez başarısız olan betiklerde kurtarma; hiç gelmeyenlerde uyarı ve döngü yok).
- **Dayanıklılık koşusu** (`hydration-soak.mjs`, `next start`, her yükleme yeni tarayıcı bağlamında, beş sayfa
  sırayla: `/yap/cevir`, `/yap/yazi`, `/yap/kes`, `/editor`, `/`):

  | Koşu | Yükleme | Temiz | Kendini kurtardı | Başarısız | Ortanca | p99 | En uzun |
  |---|---|---|---|---|---|---|---|
  | boşta, 6 paralel | 1 000 | 1 000 | **0** | 0 | 257 ms | 387 ms | 437 ms |
  | 16 paralel + CPU'yu dolduran 10 süreç | 1 500 | 1 500 | **0** | 0 | 754 ms | 6 183 ms | 10 599 ms |

  Başarısız istek ya da 4xx/5xx yanıt: hiç. Yani bu 2 500 yüklemede bekçinin devreye girmesini gerektiren
  hiçbir şey olmadı; **kurtarmanın çalıştığını dayanıklılık koşusu değil e2e testleri gösterir.** Süreler
  gezinmenin başındandır; en uzunu 10,6 sn. 15 sn'lik sayaç `load`'dan başlar ve hiçbir yüklemeyi yanlışlıkla
  yeniden yüklemedi.
- **Arıza sondası:** değişiklikten önce 395 durum, sonra 360 durum (`docs/quality/2026-10-13-hydration-faults.md`).
- **Kalite katmanı** (`npm run quality -- --only=visual,perf --no-history --no-gate`): görsel bölümde 26 ekranın 26'sı tabanıyla aynı (taban görüntüleri değişmedi), yükleme bölümünde 4/4; 28 ölçü bütçe içinde, 0 bütçe dışı. Kısmi koşu olduğu için `latest.*` dosyaları depoya yazılmadı.

## Doğrulanmayan

- **11 ve 13 Ekim olaylarının nedeni.** Mekanizma imzayı birebir veriyor; o koşularda olanın bu olduğu
  kanıtlanmadı.
- **Gerçek kötü bağlantı.** Bütün bozulmalar yerel bir vekilde ya da Playwright'ın yönlendirmesinde yapıldı.
  Gerçek bir hücresel ağda, gerçek bir ortak ağ giriş sayfasında denenmedi.
- **Chrome dışı motorlar.** Bekçi yalnızca Chromium'da çalıştırıldı. Kullandığı her şey (yakalama evresinde
  `error`, `sessionStorage`, `link.sheet`, `Element.closest`) Firefox ve Safari'de yıllardır var; yine de
  `npm run browsers` yürüyüşüne bekçi senaryosu eklenmedi.
- **Gerçek telefon.** Kurucunun S23'ünde denenmedi (dondurulan sekme, veri tasarrufu, zayıf sinyal).
- **Ekran okuyucu.** `role="alert"` bölgesinin duyurulduğu axe ile değil gerçek bir okuyucuyla doğrulanmadı.
- **Yayındaki site.** Yerel statik dışa aktarmada sınandı; GitHub Pages'e gönderilmedi.

## Bilinen sınırlar

- **Yerinde sayan `?_rsc` isteği.** Açılış ekranında bir karta basılınca Next sayfa verisini ister; istek
  başarısız olursa Next kendisi tam sayfa gezinmesine düşer (çalışıyor), ama **yanıt hiç gelmezse** kart
  hiçbir şey yapmamış gibi kalır. Bu değişiklik ona dokunmadı (aşağıda kurucu kararı). **14 Ekim:
  kapandı** — basılan kart "Açılıyor…" der, 10 sn sonra sayfa bir kez tam yüklenir (aşağıda "Ek").
- **Yerinde sayan `import('mediabunny')`.** Video seçildikten sonra medya kitaplığının parçası hiç yanıt
  almazsa "Video açılıyor…" kalır. Dokunulmadı.
- **Yarım gelen stil dosyası** (200, yarım gövde): tarayıcı hata vermez, sayfa kısmen biçimsiz kalır;
  bekçi bunu göremez.
- **`next dev`.** Bekçi ve politika yalnızca derlemede yazılır; geliştirme sunucusunda yoktur.
- **Sayfa ağırlığı.** `/yap/cevir`'in HTML'i 12,7 kB'tan 25,8 kB'a çıktı (gzip ile 6,5 kB): bekçi 6,1 kB;
  iki dilde uyarı hem HTML'de hem RSC yükünde durur. Uyarı da derleme sonrasında yazılsaydı yarısı
  kazanılırdı; React'in çizmediği bir gövde öğesinin hidratlamada sorun çıkarmadığı ölçülmeden yapılmadı.
- **Kalıcı bozulmada iki farklı son.** İlk HTML'deki 15 betikten 8'i kalıcı olarak gelmezse son ekran
  bekçinin uyarısıdır; 7'sinde çatı yüklemeyi reddeder ve son ekran uygulamanın "Bir şey ters gitti"
  ekranıdır. İkisinde de söz ve "Yeniden yükle" vardır; tek bir ekrana indirilmedi.
- **İkinci denemede uyarı gecikir.** Hata olayı vermeyen bozulmada (yarım dosya, bozuk kopya) ilk yükleme
  15 sn, ikinci deneme de 15 sn bekler: uyarı ~30 sn'de görünür.

## Açık kurucu kararları

1. **Eşikler** (15 sn / 4 sn / 45 sn / 5 dk) ölçümden türetildi ama birer seçimdir; gerçek kullanıcı
   bağlantılarından veri gelince yeniden bakılmalı.
2. **Uyarının cümleleri** ("Sayfa tam açılamadı. İnternet bağlantın takılmış olabilir." / "Uygulamayı baştan
   indir") ve `/gizlilik`'e eklenen "Sayfa yeniden yükleme notu" kartı kurucu onayından geçmedi. Gizlilik
   sayfasının "Son güncelleme" tarihi (30 Eylül) **değiştirilmedi**.
3. **Yerinde sayan kart gezinmesi** (`?_rsc`): birkaç saniye sonra tam sayfa gezinmesine düşen küçük bir
   koruma yazılabilir; istenip istenmediği. — **Kapandı (14 Ekim): istendi, yazıldı** (aşağıda "Ek").
4. **CI'da dayanıklılık koşusu**: `hydration-soak.mjs` şimdilik elle koşulur; CI'a (ör. 300 yükleme)
   eklenip eklenmeyeceği.
5. **Kurtarma sayısı sıfırdan büyükse CI kırılsın mı?** Şu an yalnızca yazılır.

## Ek — 14 Ekim 2026: yerinde sayan kart gezinmesi (`?_rsc`) — 10 sn sonra tam yükleme, bir kez

**Kurucu kararı** (yukarıdaki 3. açık karar): açılış ekranında bir karttan ya da arama sonucundan başlayan
gezinme sınırlı bir sürede bitmezse aynı adres bir kez tam yüklenir; bu arada basılan kart "Açılıyor…" der.

**Önce yeniden üretildi** (bu değişiklikten önceki derleme, `CLIP_TEST_HOOKS=1`, `next start`): Playwright
`?_rsc` isteğini yanıtsız tuttu, "Kes" kartına basıldı. **25 sn sonra** adres hâlâ `/`, tutulan `?_rsc`
isteği 1, belge isteği 0, sihirbaz yok, kartın yazısı değişmemiş ("Kes · İstediğin yerleri al"). Kullanıcı
için: kart hiçbir şey yapmamış.

**Karar** (`web/src/components/home/navigationFallback.ts`, `TaskFinder.tsx`):

- Kart (`next/link`) ya da sonuç satırı (`router.push`) basılınca o kartın alt yazısı / satırın "Başla"sı
  hemen **"Açılıyor…"** olur (`aria-busy`; sayfanın görünmez durum bölgesi de "Açılıyor…" der). Yeni
  sekme/pencere açan basışlar (Ctrl, ⌘, Shift, Alt, orta tuş) izlenmez: onlar tarayıcınındır.
- Açılış ekranı basıştan **10 sn** sonra hâlâ oradaysa aynı adres `location.assign` ile tam yüklenir
  (taban yolu ve durağan çıktıdaki sondaki `/` ile — `next/link`'in yazdığı adresin aynısı;
  `NEXT_PUBLIC_TRAILING_SLASH`). "Bitti"nin ayrı bir işareti yok: gezinme bitince açılış ekranı gider,
  sayacı da onunla.
- **Döngü yok:** açılış ekranı başına **bir kez**. Tam yükleme istendikten sonra yeni bir basış yalnızca
  istemci yönlendiricisine gider, sayaç kurulmaz; gelen sayfa başka bir sayfadır ve sayacı yoktur.
  Geri/ileri önbelleğinden (bfcache) dönülürse yeni ziyaret sayılır: "Açılıyor…" kalkar, koruma yeniden
  bir kez çalışabilir.

**Neden 10 sn.** Elimizdeki tek ölçüm bu ADR'nin dayanıklılık koşusu ve bir **tam** sayfa yüklemesini
ölçer (gezinmenin başından React'in sayfayı devralmasına; istemci gezinmesi bundan azını yapar: çatı zaten
çalışıyor): boşta ortanca 257 ms, en uzun 437 ms; 16 paralel sayfa + 10 CPU yakıcıyla ortanca 754 ms,
**p99 6,2 sn**, en uzun 10,6 sn. 10 sn, o p99'un 1,6 katıdır ve bu ADR'nin kendi kuralına uyar ("10 sn'nin
altı ölçülen 6,5 sn'ye fazla yakın"). Daha uzun beklemek gereksiz: bekleme artık sessiz değil, ama ölü
bağlantıdaki kullanıcı yine bekliyor. Yanlış alarmın bedeli: açılmak üzere olan sayfanın bir kez tam
yüklenmesi; açılış ekranında kaybolacak iş yok. Ağır yükte en uzun tam yükleme (10,6 sn) sınırın üstünde
kaldığı için böyle bir anda istemci gezinmesi yerine tam yükleme olabilir — zararsız.

**Kapsam.** Yalnızca açılış ekranındaki görev kartları ve arama sonuçları. "Kendim düzenleyeceğim"
bağlantısı ve öbür sayfalardaki bağlantılar değişmedi (karar kart için; aynı koruma istenirse aynı kanca).
Next'in kendi davranışı aynen: istek **başarısız** olursa çatı kendisi tam yüklemeye düşer (bu koruma
devreye girmeden); bekçinin (Karar 1) ilk yüklemedeki davranışı değişmedi.

**Sınananlar** — `web/tests/e2e/card-navigation.spec.ts` (4, gerçek 10 sn ile):

1. kartın `?_rsc`'si hiç yanıt almıyor: 1 sn içinde "Açılıyor…", `aria-busy`, durum bölgesi; başka kart
   değişmez; basıştan ≥ 9,8 sn ve < 13 sn sonra tek belge isteği `/yap/kes`; sihirbaz açılır;
2. arama sonucu satırı (`yazıya dök`): satırda "Açılıyor…", sonra tam yükleme, "Yazıya dök" açılır;
3. normal gezinme (hızlı) ve verisi 3 sn geciken ama gelen gezinme: sihirbaz açılır, 12 sn daha
   beklenir, **hiç** belge isteği yok;
4. tam yükleme de yanıtsız (service worker kapalı — ilk ziyaret; varsa sayfayı kendi kopyasından verir):
   10 sn'de bir belge isteği, 30 sn daha **yalnızca o bir**; bırakılınca sihirbaz açılır, ikinci istek yok.
   Aynı ekranda ikinci basışın tam yükleme istememesi birim testinde (Playwright, bekleyen bir belge
   yüklemesi varken sayfayı okumadan önce onu bekliyor).

Birim `tests/unit/navigationFallback.test.ts` (7, elle sürülen saatle): 9 999 ms'de yok, 10 000 ms'de bir
kez; tamamlanan gezinme tetiklemez; ikinci basış yeni adres ve tam 10 sn ile yeniden kurar; tam yüklemeden
sonra basışlar hiçbir şey kurmaz (10 dk boyunca tek çağrı); bfcache dönüşü yeniden bir kez; adres (taban
yolu, sondaki `/`); izlenen basışlar.

**Doğrulanmayan:** gerçek kötü bağlantı (yalnızca Playwright yönlendirmesi); GitHub Pages'te (`/capcut/…/`)
tam yükleme adresi yalnızca birim testi ve durağan derlemeyle; gerçek telefon; ekran okuyucunun
"Açılıyor…"yu okuması; bfcache dönüşü yalnızca birim testinde.
