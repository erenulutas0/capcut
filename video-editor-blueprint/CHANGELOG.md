# Değişiklik Kaydı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Cihazda yazılan yazı da editöre geçişte saklanır — 13 Ekim 2026 akşamı (ADR-034 "Ek 2", ADR-036 eki; yayındaki derlemenin davranışı değişti; şema, kayıt biçimi ve politika değişmedi; bulut yolu hâlâ KAPALI)

Kurucu kararı (sabahki ek'in 1. açık sorusuna): "Evet: cihazda yazılan yazı da geçişte saklansın." Hiçbir dış hizmete istek gitmedi; bulut sınamaları yerel sahte vekile karşı. `cloud/` altına dokunulmadı.

**Şimdi.** "Yazıya dök"ün yazısı nerede yazılmış olursa olsun, "Daha fazla ayar → editörde aç" ile açılan editör **kayıtlı projedir** — yayındaki (bulut yolu kapalı) derlemede de. Kural aynı (`handoffAction`); sihirbaz onu artık "satırı olan bir yazı varken" çağırıyor (`keepsOnHandoff = transcript !== undefined && hasLines`). Depo boşsa ya da yalnızca açılmış bir video kaydı varsa soru yok, proje hemen saklanır, adres `/editor` olur; üstünde çalışılmış bir proje varsa aynı soru penceresi ("Saklanan bir projen var" · "Eski proje kalsın (bu yazı saklanmaz)" / "Bu yazı saklansın (eski proje silinir)" / Vazgeç) — artık yayındaki sitede de; depo kullanılamıyorsa başlık "Düzenleme saklanamadı" + neden. Editör hiç açılmazsa hiçbir şey saklanmaz; satır çıkmadıysa saklanacak bir şey yoktur, geçiş öbür sihirbazlar gibi saklamadan olur. Öbür dokuz sihirbaz ve "Kes" **saklamaz** (ADR-034 aynen).

**Ekran.** Sonuç ekranındaki cümle artık her iki yolda: "Bu yazı henüz saklanmadı: editörde açarsan ya da metni indirirsen kalır, yoksa sayfa kapanınca gider." (TR + EN, aynı sözler; "Altyazılı videoyu indir" bittikten sonra editör bağlantısının üstünde de.)

**"Tek satır" iddiası doğrulandı: tek satır yetmedi.** Soru penceresi (`CloudKeep.tsx`) ve bütün sözleri (`cloud.keep.*`) bulut yolunun derleme sabitinin arkasında ve bulut tablosundaydı; varsayılan dışa aktarma onları atıyordu (`apply-csp` bulut sözü taşıyan çıktıyı reddeder). Taşındı: `CloudKeep.tsx` → `components/transcript/KeepOnHandoff.tsx` (bulut modülünden hiçbir şey almaz; her derlemede, `lazyPart` ile); `cloud.keep.*` → `wizard.yazi.keepNote` + `wizard.yazi.keep.*` (`messages.ts` / `messages.en.ts`); `CloudApplied.keepNote` kalktı; sınama kimlikleri `keep-choice*`, `keep-old`, `keep-new`, `keep-cancel`, `yazi-keep-note`. Varsayılan durağan çıktıda bulut sözü yok; `apply-csp` denetimi geçti.

**Gizlilik: önce → sonra.** `/gizlilik` "Proje tarifi" kartı (her derleme, TR + EN): "…ana ekrandaki bir işten (Kes, Dikey yap…) başlattığın çalışma saklanmaz." → aynı cümle + "Tek istisna “Yazıya dök”: çıkan yazıyı “Daha fazla ayar → editörde aç” ile açarsan o çalışma (satırların metni dahil) burada proje olarak saklanır; orada daha önce sakladığın bir proje varsa hangisinin kalacağı sana sorulur. Silmesi aşağıdaki gibi." (silme: kartın "Ne zaman silinir" satırı, "Kayıtlı projeyi sil"). Bulut derlemesinin ek cümlesi: "Tek istisna: internette yazılan bir yazıyı…" → "İnternette yazılan yazı için de aynı: editörde açarsan satırların metni ve kimin konuştuğu burada saklanır; ses, davet kodun ve şirketin yanıtı saklanmaz." Veri envanteri: üst not, §2.7 (istisna ve silme), §2.8, §8.4a (artık her iki yol), §8.6 (soru kapandı). ADR-034 "Ek 2", ADR-036 eki, ADR-039 eki güncellendi.

**Sınamalar (son kodla, yerel):** SINAMA-OZETI

**Kalite katmanı.** KALITE-OZETI

**Açık kurucu kararları:** soru penceresinin sözleri ve vurgulu düğme (artık yayındaki sitede); "iş" eşiği; satırsız yazının saklanmaması (bu işte seçildi); "İnternette yazıldı" etiketi (şema); video açıkken "projeyi sil"; adresin `/editor` olması; birden çok proje.

**Doğrulanmayan:** gerçek telefon, Safari, Firefox, ekran okuyucu; GitHub Pages'te (`/capcut`) adres değişimi (yalnızca `next start` ile); gerçek modelle geçiş (betikli tanıyıcıyla sınandı); gerçek sağlayıcı/Worker; iki sekme yarışı; depolama kotası; yeni yığının paket boyutu.

## İnternette yazılan yazı editöre geçişte saklanır — 13 Ekim 2026 (ADR-034 eki; ADR-043'ün "Bulunan"ı kapandı; şema, kayıt biçimi ve politika değişmedi; bulut yolu hâlâ KAPALI)

Kurucu kararı: "Bulut yazısı editöre geçişte saklansın." Hiçbir dış hizmete istek gitmedi; bulut sınamaları yalnızca yerel sahte vekile karşı. `cloud/` altına dokunulmadı.

**Sorun.** Bulut yolu yalnızca "Yazıya dök" sihirbazında; sihirbaz ve ondan açılan editör proje saklamıyordu (ADR-034). Dakika harcanmış, sesi başka bir şirkete gönderilmiş, beklenmiş bir yazı sayfa yenilenince tamamen gidiyordu; tek yol yedek dosyasıydı.

**Şimdi.** Tarif internette yazılmış bir yazı taşıyorsa "Daha fazla ayar → editörde aç" ile açılan editör **kayıtlı projedir**: var olan depo, var olan kayıt, var olan otomatik kayıt (yeni seçenek `adopt`: depodaki yüklenmez, eldeki hemen yazılır). Adres sayfa yüklenmeden `/editor` olur; yenileme projeyi yazısı ve "1. kişi / 2. kişi" ile geri getirir, video dosyası her zamanki gibi yeniden seçilir (dosya hiçbir yerde saklanmaz; hatırlanan dosya izni yok). Öbür dokuz sihirbaz ve "Kes" **saklamaz** — ADR-034 onlar için aynen geçerli.

**Var olan proje ezilmez.** Depo tek proje tutar (ADR-012). Geçişte depoya bakılır (`domain/wizardHandoff.ts`): boşsa ya da yalnızca açılmış bir video kaydı varsa soru yok; **üstünde çalışılmış bir proje** varsa (kesit, altyazı / yazı satırı, müzik ya da ad) hiçbir şey yazılmadan sorulur — "Saklanan bir projen var · Bu tarayıcıda yalnızca bir proje saklanabilir. Hangisi kalsın?" · **Eski proje kalsın (bu yazı saklanmaz)** / **Bu yazı saklansın (eski proje silinir)** · "Vazgeçersen hiçbir şey değişmez. Yazıyı “Metni indir” ile dosya olarak da alabilirsin." Eskisi seçilirse editör bugünkü gibi saklamadan açılır ve başlığı "Bu düzenleme saklanmıyor" der. Depo yazılamıyorsa başlık "Düzenleme saklanamadı" + neden + yedek dosyası; daha yeni bir derlemenin kaydına dokunulmaz (ADR-043). Editörün kendi onay kutusu (`sources.replaceWarning`) kullanılmadı: "Tamam / İptal" üç sonucu adlandıramıyor; eşiği ise aynı tutuldu (yalnızca kaybedilecek iş varsa sorulur).

**Ekran doğruyu söyler.** Geçişten önce yazı saklı değildir; sonuç ekranı (yalnız bulut yolunda) bunu tek cümleyle söyler: "Bu yazı henüz saklanmadı: editörde açarsan ya da metni indirirsen kalır, yoksa sayfa kapanınca gider." Aynı cümle "Altyazılı videoyu indir" bittikten sonra editör bağlantısının üstünde de durur. Geçişten sonra editörün kendi "Düzenleme saklandı" göstergesi geçerli.

**Silme.** Var olan yol: editör dosyayı istediğinde "Kayıtlı projeyi sil". Silinen kayıt geri yazılmaz (ADR-012 eki; sınandı: bekleme, yenileme, sihirbaza dönme).

**Cihazda yazılan yazı: yapılmadı, kurucu kararı.** Aynı kural onu da saklayabilirdi, ama yayındaki derlemenin davranışını, gizlilik metnini ve olağan e2e'nin beklentilerini değiştirir, soru penceresini yayındaki siteye getirir. Değişiklik bütünüyle bulut derlemesinin içinde: yeni parça (`CloudKeep`) ve sözleri varsayılan çıktıda yok.

**"İnternette yazıldı" etiketi: saklanmıyor (bilerek).** Şema alanı ister; eklenmedi. Saklanan projede ve editörde aynı iz "Otomatik yazıldı — yanlış olabilir" diye görünür.

**Gizlilik.** `/gizlilik` (yalnız bulut derlemesi): "Yazı cihazında nerede durur" maddesi ve "Proje tarifi" kartında bir cümle; veri envanteri §8.4a. Varsayılan derlemenin metni değişmedi ve orada doğru.

**Kalite katmanı.** "Kim konuştu" tablosunda "sayfa yenilenince" artık yedek dosyası olmadan, geçişin sakladığı projenin kendi sayfası yenilenerek ölçülüyor; yeni sütun "editöre geçince depoda"; yedek dosyası deposu boş başka bir tarayıcıda açılıyor. Bütçeler aynı (hepsi 4, SRT 0).

**Açık kurucu kararları:** cihazda yazılan yazı da saklansın mı; soru penceresinin sözleri ve vurgulu düğme; "iş" eşiği (kesitsiz kayıt sormadan değişiyor); "İnternette yazıldı" etiketi (şema); video açıkken "projeyi sil" düğmesi; adresin `/editor` olması; birden çok proje.

**Doğrulanmayan:** gerçek sağlayıcı ve Worker; gerçek telefon, Safari, Firefox; bulut yolu açık durağan çıktı ve Pages'te adres değişimi (yalnızca `next start` ile görüldü); soru penceresi telefon boyutunda ve ekran okuyucuyla; iki sekme yarışı; depolama kotası.

**Sayılar (13 Ekim, dal `worktree-agent-a2b52e38355c6d5f7`; hepsi yerel, son kodla):** `tsc` ve `eslint` temiz; birim 1418/1418 (82 dosya; 12'si yeni); e2e (olağan derleme) 395 testte 391 geçti / 4 atlandı / 0 başarısız (sayı değişmedi), kendiliğinden kurtarma gerektiren yükleme **0** (bekçinin kendi testleri bilerek 9 kurtarma, 2 ölü sayfa yaptı); bulut e2e'si (sahte Worker'a karşı) 58 testte 54 geçti / 4 atlandı / 0 başarısız (11'i yeni), kurtarma 0, ölü sayfa 0; varsayılan durağan çıktı derlendi, bulut denetimi geçti, yeni sözler çıktıda yok; `npm run quality` 643 ölçü: 566 bütçe içinde, 8 dışında (önceki koşulardaki aynı sekiz madde), 5 ölçülemedi, 64 bütçesiz — "Kim konuştu" tablosunda her adım 4 / 4, SRT 0, bulut yazı ekranı 110 → 122 kelime (bütçe ≤ 180). **Koşulmayan:** Pages duman testi, tarayıcı matrisi, `cloud/` sınamaları, gerçek telefon.

## Sunulup da canlanmayan sayfa artık kendini bir kez yeniden yükler, olmazsa söyler — 13 Ekim 2026 (ADR-044; politika ve şema değişmedi; tarayıcıda saklananlara bir `sessionStorage` anahtarı eklendi)

Kurucu yokken, özerk çalışma. Hiçbir dış hizmete istek gitmedi; `cloud/` altına dokunulmadı.

**Sorun.** İki kez (11 Ekim yerel, 13 Ekim CI koşusu 38371421148) bir sayfanın HTML'i geldi, `load` ateşlendi ve React sayfayı hiç devralmadı: "Video seç" 300 sn boyunca `disabled`, ekranda tek kelime yok. Kötü bağlantıdaki gerçek kullanıcı için aynı ölü sayfa.

**Olay yeniden üretilemedi; mekanizması kanıtlandı.** Yeni arıza sondası (`web/scripts/soak/fault-probe.mjs`: derlemenin önüne konan bir vekil tek bir isteği yedi biçimde bozar) değişiklikten önceki derlemede 395 durum ölçtü: `/yap/cevir`'in ilk HTML'indeki 13 betikten **herhangi biri** kopma / 500 / 404 / yarıda kesilme ile gelmezse sayfa tam olarak CI dökümündeki hâlde kalır — **52/52** (`load` ateşlenir, başlık görünür, düğme `disabled`, Next'in hata ekranı yok, sayfa hatası yok). Nedeni çatının parça yükleyicisi: HTML'de zaten duran bir betik, dinleyici takılmadan önce başarısız olursa söz hiç sonuçlanmaz; hata yok, zaman aşımı yok. Kendi kodumuzda hidratlamayı bekleten bir şey bulunmadı. O iki koşuda olanın bu olduğu **kanıtlanmadı** (ağ kaydı yok). Tablo: `docs/quality/2026-10-13-hydration-faults.md`.

**Bekçi.** Her sayfanın `<head>`'ine, derlemeden sonra, ilk betik olarak yazılan 6,1 kB'lık düz JavaScript (`web/scripts/lib/page-watchdog.js`; özeti sayfanın güvenlik politikasında, `'unsafe-inline'` yok). Sayfa "canlıyım" demezse (kök düzenin `effect`'i): bir derleme betiği başarısız olduktan **4 sn** sonra ya da `load`'dan **15 sn** sonra **bir kez** kendiliğinden yeniden yükler; yine canlanmazsa önceden çizilmiş düz HTML uyarıyı gösterir: "**Sayfa tam açılamadı.** İnternet bağlantın takılmış olabilir. · **Yeniden yükle**". `load` 45 sn'de bile gelmediyse yalnızca uyarı (yeniden yükleme yok; dosya gelirse uyarı kalkar). Canlı sayfada asla yeniden yüklemez. Eşiklerin gerekçesi (hidratlanma ortancası 0,3–0,8 sn, ağır yükte 99. yüzdelik 6,5 sn) ADR'de.

**Döngü yok.** Yeniden yüklemeden önce sekmeye not düşülür (`sessionStorage` → `clip:page-recovery`); gelen sayfa ikinci deneme olduğunu bilir ve ne olursa olsun kendiliğinden yeniden yüklenmez. Not yazılamıyorsa otomatik yeniden yükleme hiç yok. e2e: betikler hiç gelmezken bir yeniden yükleme, uyarı, bir dakika sonra hâlâ ikinci yükleme.

**Bozuk saklanan kopya.** Service worker dosyaları önce kopyadan verdiği için kopyadaki bozuk bir dosyada "Yeniden yükle" işe yaramaz (gösterildi). Yalnızca o durumda (sayfayı service worker yönetiyor ve tarayıcı çevrimdışı demiyor) ikinci düğme: "**Uygulamayı baştan indir**" — yalnızca bu uygulamanın service worker kaydını ve `clip-app-*` önbelleklerini siler; projeler, günlük, OPFS, konuşma modeli ve localStorage yerinde (e2e).

**Sonradan gelmeyen parça.** Sihirbazdan açılan editör, "Sorun bildir", "Sessizlikleri bul", editörün yazı paneli ve bulut yolunun parçaları artık `lazyPart` ile gelir: parça gelmezse Next'in İngilizce ham hata ekranı (sayfanın tamamı, açık videoyla birlikte giderdi) yerine yerinde "Bu bölüm açılamadı. İnternet bağlantın takılmış olabilir. · **Tekrar dene**"; sayfa, video ve seçim yerinde. Yanıtı hiç gelmeyen parça 30 sn sonra aynı cümleyle. Yakalanmayan çizim hatalarında Next'in ham ekranı yerine "Bir şey ters gitti · Yeniden yükle" (`app/error.tsx`, `app/global-error.tsx`).

**Çevrimdışı.** Kopya tamsa bekçi susar (e2e: 20 sn, yeniden yükleme yok, uyarı yok). Kopyada dosya eksikse bir yeniden yükleme + uyarı ("baştan indir" olmadan). Hiçbir şey saklı değilse görünen tarayıcının kendi sayfasıdır; yapılacak bir şey yok.

**Testler susmuyor.** Kendini kurtaran bir yükleme e2e'de de kendini kurtarır; görünür olsun diye bütün e2e dosyaları `tests/e2e/fixtures.ts`'ten içe aktarır: `PAGE-RECOVERED <adres> — <test>` / `PAGE-DEAD …` satırı ve koşu sonunda toplam (sıfırken de). Playwright'a `retries` **eklenmedi**. `hydration-soak.mjs` artık depoda ve kurtarmaları sayar.

**Gizlilik.** Veri envanteri §2.4a ve `/gizlilik` ("Sayfa yeniden yükleme notu" kartı; "sessionStorage kullanılmaz" cümlesi düzeltildi) aynı değişiklikte. Not: durum, zaman, sayfanın yolu, görülen şey; kimlik / dosya adı yok; hiçbir yere gönderilmez; sekme kapanınca silinir.

**Değişmeyen (bilinen sınırlar).** Açılış ekranında karta basınca yanıtı hiç gelmeyen `?_rsc` isteği (kart hiçbir şey yapmamış gibi kalır); yanıtı hiç gelmeyen `import('mediabunny')` ("Video açılıyor…" kalır); yarım gelen stil dosyası. `next dev`'de bekçi yoktur.

**Açık kurucu kararları:** eşikler; uyarı ve gizlilik cümleleri (gizlilik sayfasının "Son güncelleme" tarihi değiştirilmedi); yerinde sayan kart gezinmesi için koruma; dayanıklılık koşusunun CI'a eklenmesi; kurtarma sayısı sıfırdan büyükse CI'ın kırılıp kırılmayacağı.

**Doğrulanmayan:** 11 ve 13 Ekim olaylarının nedeni; gerçek kötü bağlantı ve gerçek ortak ağ giriş sayfası (bozulmalar yerel vekilde / Playwright yönlendirmesinde); Chromium dışı motorlar; gerçek telefon; gerçek ekran okuyucu; yayındaki site.

**Sayılar (13 Ekim, dal `worktree-agent-ac320ffd570cfb61c`; hepsi yerel, son kodla):** `tsc` ve `eslint` temiz; birim 1406/1406 (81 dosya; 32'si yeni); e2e (olağan derleme) 395 testte 391 geçti / 4 atlandı / 0 başarısız (20'si yeni), kendiliğinden kurtarma gerektiren yükleme **0** (bekçinin kendi testleri bilerek 9 kurtarma, 2 ölü sayfa yaptı); bulut e2e'si (sahte Worker'a karşı) 43 geçti / 4 atlandı; statik dışa aktarma + Pages duman testi 7 geçti / 2 atlandı (model dosyaları bu makinede yok; 1'i yeni); dayanıklılık: boşta 1 000 yükleme → 1 000 temiz, 0 kurtarma, 0 başarısız (ortanca 257 ms, p99 387 ms), 16 paralel sayfa + 10 CPU yakıcıyla 1 500 yükleme → 1 500 temiz, 0 kurtarma, 0 başarısız (ortanca 754 ms, p99 6,2 sn, en uzun 10,6 sn) — bu koşularda bekçiyi gerektiren hiçbir şey olmadı, kurtarmayı e2e gösterir; arıza sondası önce 395, sonra 360 durum; kalite katmanı (yalnız görsel + yükleme): görsel bölümde 26 ekranın 26'sı tabanıyla aynı (taban görüntüleri değişmedi), yükleme bölümünde 4/4; 28 ölçü bütçe içinde, 0 bütçe dışı. Kısmi koşu olduğu için `latest.*` dosyaları depoya yazılmadı.

## Kim konuştu, kalıcı: EDL v5 — satırda `speaker` — 13 Ekim 2026 (ADR-043; **şema v4 → v5**, politika değişmedi; bulut yolu hâlâ KAPALI)

Kurucu onayıyla (bulut yolunu açmanın parçası). Hiçbir dış hizmete istek gitmedi; bulut sınamaları yalnızca yerel sahte vekile karşı.

**Şema:** transkript izinin satırına isteğe bağlı `speaker` (1–20 arası tam sayı; ilk duyulan ses 1; ad değil sıra). İz düzeyinde alan yok. Yeni hata kodu `caption_speaker_invalid`; transkript olmayan izde `caption_track_invalid`. v1…v4 kayıpsız okunur: **yalnızca numara değişir**, hiçbir geçiş konuşan eklemez. Yeni fixture'lar: 2 geçerli, 8 geçersiz, `legacy-v4/` (5). Belge 10'a "EDL v5" bölümü eklendi.

**Mevcut kullanıcı için:** kayıtlı her proje ilk açılışta v5 olarak yeniden yazılır (otomatik kayıt; v3 → v4'teki ile aynı davranış) — değişen tek şey numara. Bulut yolu kapalı olduğu için hiçbir proje konuşan kazanmaz; ekranda fark yok. v4 yedek dosyaları açılır. **Geri yol yok.**

**Eski kabuk, yeni kayıt:** yayındaki (v4) derleme yüksek numaralı kaydı yüklemez ama "bozuk" sayar, kullanıcıya söylemez ve o sekmede yeni video açılırsa üstüne yazar (dar pencere: yarıda kalmış service worker kurulumu + çevrimdışı açılış; ADR-043 Karar 3). Geriye dönük düzeltilemez. **Bu derlemeden itibaren:** daha yeni bir derlemenin kaydı bozuk kayıttan ayrılır (`edl_newer`), başlık "Bu proje daha yeni bir sürümle saklanmış. Sayfayı yenile. Bu sayfada yaptıkların saklanmaz." der ve otomatik kayıt o sekmede üstüne **yazmaz**.

**Nerede görünür:** "1. kişi / 2. kişi" artık editörün "Yazı" panelinde, yedek dosyasında, yedekten açılan projede ve sayfa yenilenince de var (var olan sunum; yeni arayüz kavramı yok). En az iki ayrı konuşan yoksa etiket yok. **Kurallar:** metni/zamanı değişen satır konuşanını korur; kesit sınırında parçalanan satırın her parçası aynı konuşanı taşır; yalnızca aynı satırın parçaları birleşir; elle eklenen satırın konuşanı yok; altyazı dosyası içe aktarmak ya da cihazda yeniden yazmak konuşanları götürür; "Bunlardan kesit yap" satırlara dokunmaz.

**Dosyalar:** TXT ses değişen satırda adı yazar (değişmedi). **VTT** konuşanı ses etiketiyle taşır (`<v 2. kişi>…`; etiket metnin parçası değildir). **SRT taşımaz** — bayt bayt eskisiyle aynı (SRT'de metnin önüne yazılan ad, dosyayı okuyan her program için metnin kendisi olurdu). **Yakılan altyazı değişmedi:** render planı ve parmak izi alanı okumaz.

**Bulunan (yolu açmadan önce bilinmeli):** bulut yolu yalnızca sihirbazda ve sihirbaz proje saklamıyor (ADR-034); internette yazılan yazı sihirbazın ya da ondan açılan editörün sayfası yenilenince **tamamen** gider. Kalıcı olmasının bugünkü tek yolu yedek dosyası (indir → `/editor`'de geri yükle); konuşanlar bu yolda korunur ve sınanır. Kısaltmak arayüz kararı ister — yapılmadı.

**Açık kurucu kararları:** kişileri yeniden adlandırma (kapsam dışı; şema hazır); SRT'de ve yakılan altyazıda konuşan (bugün yok); bulut yazısının kalıcılığı (yukarıda); "İnternette yazıldı" etiketinin kalıcılığı; v4 → v5 penceresi için ara yayın istenip istenmediği.

**Doğrulanmayan:** gerçek sağlayıcının kişi ayrımı (sahte sunucu duymaz); yayındaki v4 derlemesinin v5 kayıtla davranışı kod okunarak yazıldı, çalıştırılmadı; service worker penceresi gerçek yayınla sınanmadı; VTT ses etiketinin başka oynatıcılardaki görünüşü; gerçek telefon, Safari, Firefox.

**Sayılar (13 Ekim, dal `worktree-agent-a08295f6ffb53c053`; hepsi yerel):** `tsc` ve `eslint` temiz; birim 1341/1341 (77 dosya; 30'u yeni); e2e (olağan derleme) 370 testte 366 geçti / 4 atlandı / 0 başarısız (3'ü yeni); bulut e2e'si (sahte Worker'a karşı) 41 geçti / 4 atlandı (2'si yeni; yeni sınamanın kendisi iki kez düzeltildi, uygulama kodu değişmeden); kalite raporu 641 ölçü: 564 bütçe içinde / 8 dışında (önceki koşulardaki yedi arama ölçüsü ve `out.notFaststart`; yenisi yok) / 5 ölçülemedi, "kim konuştu" tablosu masaüstü ve telefonda 4/4, SRT 0, ekran tabanları değişmedi; durağan çıktı (`/capcut`) derlendi, bulut kodu çıktıda yok. **Koşulmayan:** Pages duman sınaması, tarayıcı matrisi, `cloud/` sınamaları (kod değişmedi), gerçek telefon, gerçek Worker ve sağlayıcı. Mevcut kullanıcı haklarına etkisi: fiyat, kota, süre değişmedi; kayıtlı projeler ilk açılışta v5 numarasıyla yeniden yazılır ve yayındaki (v4) derlemeye geri okunamaz.

## Diğer işleyiciler de kör bitmiyor ve asılı kalmıyor; tarayıcı matrisi iki günlük değişiklikten sonra yeniden koşuldu — 13 Ekim 2026 (ADR-042 eki; politika ve şema değişmedi)

**İş 1 — diğer işleyiciler (ADR-042 eki).** 12 Ekim'de indirmeye verilen güvence — beklenmeyen hata *nerede ve ne tür* olduğunu söyler, metnini asla; çöken ya da yerinde sayan işleyici işi bitirir — dört işe daha uygulandı: sessizlik bulucu, cihazda yazıya dökme (model indirme dahil), bulut yolunun ses dosyası, "İyileştir" önizlemesi. Aynı tür (`ExportFailureDetail`), aynı denetim; yeni tür yok. Ortak bekçi `web/src/adapters/workerWatch.ts`.

- **Önce asılı kalanlar (kod okumasından):** okunamayan ileti (hiçbiri dinlemiyordu); gönderilemeyen istek (söz reddediliyor, ekran "aranıyor / indiriliyor / hazırlanıyor"da kalıyor; yazıya dökmede ve bulut sesinde "Durdur" da çalışmıyor, bulut yolunda yeni deneme de başlatılamıyordu); yerinde sayan işleyici (önizlemede sonraki her önizleme de arkasında bekliyordu). **Şimdi** hepsi hata olarak biter, işleyici durdurulur, yeniden deneme yenisini açar.
- **Önce yanlış söylenenler:** çalışırken çöken işleyici "bu tarayıcıda başlatılamadı" (bulut sesinde "bu tarayıcı sesi gönderilecek hâle getiremiyor") diyordu; şimdi "beklenmedik hata", "başlatılamadı" yalnız hiç ses vermediyse.
- **Eşikler (yalnız sayfa görünürken ve ilerleme yokken sayılır):** sessizlik, bulut sesi, önizleme 60 sn; model indirme 120 sn; yazıya dökmede konuşma arama 120 sn, model başlatma ve yazma 10 dk (içeriden ses veremeyen adımlar). Gerekçeleri ADR'de. İki yeni "hayat belirtisi": model denetimi (SHA-256) okudukça, tanıyıcı her çağrıdan sonra ilerleme bildirir — yoksa bu eşikler yanlış alarm verirdi.
- **Ekran:** cümleler aynı sadelikte; hatanın altında kapalı "Ayrıntılar" (`EncodingError · audio_decode · decoding_error · analysing`) ve "Sorun bildir". İki yeni cümle (model indirme): "İndirme durdu: bir süredir hiçbir şey inmedi. İndirilen kısım duruyor; tekrar denersen kaldığı yerden devam eder." ve "İndirme beklenmedik bir hatayla durdu. İndirilen kısım duruyor; tekrar dene."
- **Tanı dosyası:** bu işlerin hata kodu artık oturum kayıtlarına yazılıyor (önce yalnız sessizlik bulucununki), beklenmeyen hatada `detail` ile. Yalnız açık sekmenin belleğinde. Veri envanteri (§2.3, §5), `/gizlilik` ve "Sorun bildir" metni güncellendi.
- **Sızıntı testleri:** her işte dört bozulma (işin içinde hata, işleyicinin çökmesi, hatasız yerinde sayma, gönderilemeyen istek); hata metnine yol + dosya adı, altyazı cümlesi ve `blob:` adresi konur; sayfanın HTML'inde, tarayıcıda saklananlarda, uygulamanın konsol satırlarında ve tanı dosyasında aranır — yok. Birim tarafında her işin her alanına ayrı ayrı konup çıktıda aranır.

**İş 2 — tarayıcı matrisi.** Son koşudan (7–8 Ekim, 30/30 × 3) beri gelenler: büyütmeme ve editörün kaynağı izlemesi (ADR-041), yarım dosyanın reddi (ADR-040), Kes'in kendi boyutu / hızlı kesim, kaynağın iki katı bit hızı sınırı, çözülen ses ve karelerin kapatılması, yerinde sayma bekçisi.

- **İlk koşu (eski beklentilerle):** Chromium 153, Chrome 155, Edge 155'in her birinde **29 geçti / 1 başarısız** (M03).
- **M03 — eskimiş beklenti, ürün hatası değil:** 1920 × 1080 kaynağın 9:16 kırpması 720 × 1280 bekleniyordu; çıkan 608 × 1080. ADR-041 "Kırpma": dilimin kendi pikselleri, seçilen kalite bir üst sınır. Beklenti ve referans süzgeci 608 × 1080 yapıldı (ADR'ye atıfla).
- **Ürün hatası bulunmadı.** Beklentisi olmayan ama ölçüsü değişen satırlar da ADR-041'le uyumlu: M12 / M15 / M16 (dikey kaynak, 16:9 çerçeve) 1280 × 720 → 720 × 406; M20 720 × 1280 → 608 × 1080.
- **İki yeni satır (ADR-041'in "ölçülmeyen" maddesi için):** M24 — 640 × 360 kaynak varsayılan sınırla 640 × 360 ve kopya; M24b — aynı kaynaktan 9:16 kırpma 202 × 360 kodlanıyor (Chrome ve Edge'de de; hangi kodlayıcının — donanım mı, tarayıcının yazılıma düşmesi mi — kullanıldığı kaydedilmedi). M24b'nin SSIM'i Chrome / Edge'de 0,9681, Playwright Chromium'unda (yazılım kodlayıcı) 0,9001: çıtanın (0,90) tam üstünde, üç koşuda aynı.
- **Son koşu (13 Ekim, son kod):** üç tarayıcıda **32 / 32**. `docs/SUPPORT_MATRIX.md` yeniden üretildi. "Gerçek kayıtlar" bölümü **koşulmadı** (kurucunun özel videoları; ana oturum koşacak) — 8 Ekim sayıları tarihleriyle yerinde bırakıldı.

**Doğrulanmayan:** gerçek `messageerror` (üretilemedi; dinleyici sahte olayla sınanır); eşiklerin yavaş cihazda, telefonda yanlış alarmı; gerçek modelle yazıya dökme (tanıyıcı çağrısı sonrası yeni ilerleme iletisi dahil — model dosyaları yok); gerçek grafik / medya süreci ölümü bu dört işte; gizlenen sekme tarayıcıda; "önce" davranışının kendisi (kod okuması); M24b'de kullanılan kodlayıcının türü; Firefox, WebKit, Safari, gerçek telefon.

**Sayılar (13 Ekim, dal `worktree-agent-a7d911c145896a8af`; hepsi yerel):** `tsc` ve `eslint` temiz; birim 1315 / 1315 (77 dosya; 21'i yeni); e2e (olağan derleme) 372 testte 368 geçti / 4 atlandı / 0 başarısız (5'i yeni: `worker-failure.spec.ts`); bulut e2e'si (yerel sahte Worker'a karşı) 45 testte 41 geçti / 4 atlandı / 0 başarısız (2'si yeni: `cloud-audio-failure.spec.ts`); tarayıcı matrisi 32 / 32 × 3; durağan çıktı (`/capcut`) derlendi, 17 sayfa, sınama kancası çıktıda yok. **Koşulmayan:** gerçek kayıtlar (`run-real-media.mjs`), kalite raporu, Pages duman sınaması, gerçek telefon, gerçek Worker ve sağlayıcı. Mevcut kullanıcı haklarına etkisi: fiyat, kota, şema değişmedi; tanı dosyasının oturum kayıtlarına bir alan eklendi (metin değil, etiketler).

## Firefox ve WebKit ilk kez yüründü: dosyayı yapamayan tarayıcı baştan söyler ve yol gösterir — 13 Ekim 2026 (politika ve şema değişmedi)

**Neden:** her şey Chromium ailesinde ve tek bir Android telefonda sınanmıştı; Firefox ve Safari hakkında ölçüm yoktu. Yeni, ayrı bir paket (`npm run browsers`; olağan e2e'nin ve CI'ın parçası **değil**) on kartı ve çevresini Playwright'ın Firefox ve WebKit derlemelerinde, masaüstü ve telefon boyunda, insanların aldığı derlemede yürür ve her hücreyi sınıflar: çalışıyor / dürüst ret / bozuk. **Bunlar motor derlemeleridir:** Windows WebKit derlemesi Safari değildir (WebCodecs'i, OffscreenCanvas'ı ve H.264 oynatması yok), Firefox derlemesi Android Firefox'u değildir. Ayrıntı ve taşınabilirlik: `docs/quality/browsers-2026-10-13.md`.

**Bulunan (115 satır, 0 bozuk: sahte başarı, takılma, konsol hatası görülmedi):** Firefox derlemesinde AAC kodlayıcı yok; dokuz dosya kartının dokuzu “Bu tarayıcıda çıktı alınamıyor… AAC kodlama desteklenmiyor” ile bitiyordu. WebKit derlemesinde hiçbir video açılmıyor. Ana ekran, arama, çevrimdışı kabuk, editör (Firefox), axe her motorda geçti.

**Düzeltilen (dört küçük şey):** (1) tarayıcıdan kaynaklanan rette çıkış yolu: Chrome / Edge dışında “Chrome ya da Edge ile dene.”, iPhone / iPad'de “…Bir bilgisayarda ya da Android telefonda Chrome ile dene.”, Chrome / Edge'in içinde hiçbir şey; (2) aynı şey sihirbazın başında, “İndir”e basılmadan: “Bu tarayıcı video dosyası hazırlayamıyor. Videonu seçip bakabilirsin ama indiremezsin.”; (3) sayfa hazır olmadan arama kutusuna yazılan kelime artık kaybolmuyor; (4) sesi olmayan dosya ses kodlayıcısı istemiyor — Firefox'ta “Sesi kapat” çalışıyor (WebM kaynakta Firefox'un kendi H.264 kodlayıcısıyla). Sesli dosyalar için denetim değişmedi.

**Yapılmayan (seçenek olarak yazıldı):** Firefox'a WASM AAC kodlayıcı (kalan 8 kart); macOS'ta WebKit koşusu (gerçek Safari'ye en yakın ucuz ölçüm); ret panelinin teknik dili (“codec”, “AAC kodlama bu ayarla”).

**Doğrulanmayan:** gerçek Safari (macOS / iPadOS / iOS) ve Android Firefox — hiçbiri; “Yazıya dök”ün kendisi (model dosyaları makinede yok; yalnızca “Modeli indir” ve dürüst hatası); Firefox çıktısının kalitesi ve hızı (yalnızca kap, kodek, süre, boyut); Firefox'ta depolama ayırma yolu; “Paylaş”ın sistem penceresi; İyileştir'in işlemci yedeği.

**Açık kurucu kararları:** “Chrome ve Edge'de çalışır, başka yerde dürüstçe söyler” lansman için yeterli mi; iPad hedef mi; Firefox'a AAC; yeni dört cümlenin onayı; paketin CI'a bağlanması.

**Sayılar (13 Ekim, dal `worktree-agent-a29a2ca2827ccd50e`; hepsi yerel):** `tsc` ve `eslint` temiz; birim 1306/1306 (78 dosya; 12'si yeni); e2e (olağan derleme) 367 testte 363 geçti / 4 atlandı / 0 başarısız (değişmedi); tarayıcı paketi 105/105 (5 proje × 21 test; ≈ 6 dakika + derleme); durağan çıktı (`/capcut`) derlendi. **Koşulmayan:** kalite raporu (`npm run quality`), Pages duman sınaması, dışa aktarma matrisi, bulut sınamaları, gerçek telefon. Mevcut kullanıcı haklarına etkisi: yok (fiyat, kota, şema, gizlilik metni, CSP değişmedi).

## Beklenmeyen indirme hatası artık okunur; yerinde sayan indirme hata olarak biter — 12 Ekim 2026 (ADR-042; politika ve şema değişmedi)

**Olay (11 Ekim):** kurucunun makinesinde bulutta yazılan 4 dk 13 sn'lik videonun "Altyazılı videoyu indir"i bir kez "Beklenmeyen bir hata oluştu" ile bitti, ikinci basışta kaydedildi. Geriye bilgi kalmamıştı. **Neden bulunamadı:** 161 taze sayfa denemesinde (Chrome 154 ve Edge 155 donanım kodlayıcısıyla, Playwright Chromium; oynayan önizleme, işlemci yükü, koşut sayfalar, cihazda yazılmış yazı, 1080p dosya, bekletilmiş yazı) **0 hata**. Kendiliğinden yeniden deneme **eklenmedi** (hangi hatanın geçici olduğu bilinmiyor).

**Bir sonraki sefer için:** başarısız indirme hatanın **adını** (izin listesinden), **aşamasını** (kendi etiketimiz: `decode`, `encode`, `write`, `commit`…), geliş yolunu, kaçıncı karede kaldığını ve gerçekten yapılandırılan codec dizgilerini taşır; hata kartında kapalı "Ayrıntılar"da tek satır, dışa aktarma günlüğünde ve "Sorun bildir" dosyasında `failureDetail`. **Hatanın metni, dosya adı, yol saklanmaz** — metin yalnızca bilinen cümlelerle karşılaştırılır, etiketi yazılır; her alan okunurken yeniden denetlenir. Veri envanteri ve `/gizlilik` metni güncellendi.

**Bulunan ve düzeltilen:** tarayıcının grafik süreci indirme sırasında ölünce (Chrome 154 / Edge 155'te bilerek öldürüldü, 8'de 8) hiçbir hata gelmiyor, yüzde yerinde kalıyor, "İptal et" çalışmıyordu. Şimdi 60 sn ses gelmezse (sayfa görünürken) indirme hata olarak biter ve nerede durduğunu söyler (ölçülen: donanım kodlayıcısına kare verirken); ikinci basış 6'da 6 kaydetti. Yanıtsız "İptal et" 15 sn sonra işleyiciyi durdurur. Ayrıca: çöken işleyici durdurulur (önce yazmayı sürdürebilirdi) ve "başlatılamadı" yerine "beklenmeyen hata" denir; okunamayan ileti ve gönderilemeyen istek asılı kalmaz; tarayıcının geri aldığı codec "disk doldu" sayılmaz; çöken işleyiciden kalan 0 baytlık dosya kaldırılır.

**Cümle değişti:** "Beklenmeyen bir hata oluştu." → "Beklenmeyen bir hata oluştu. Bir kez daha dene; yine olursa “Sorun bildir”e bas." (kurucu isterse tek satır).

**Doğrulanmayan:** olayın nedeni; gerçek diske gerçek kaydetme penceresiyle yazma; gizlenen sekme; kurucunun gerçek videosu; 60 sn bekçisinin yavaş cihazda yanlış alarmı; diğer işleyicilerin hataları (hâlâ ayrıntısız).

**Sayılar (12 Ekim, dal `worktree-agent-a8fa4f279601b4f6f`; hepsi yerel):** `tsc` ve `eslint` temiz; birim 1294/1294 (76 dosya; 18'i yeni); e2e (olağan derleme) 367 testte 363 geçti / 4 atlandı / 0 başarısız (5'i yeni: `export-failure.spec.ts`); bulut e2e'si (sahte Worker'a karşı) 39 geçti / 4 atlandı (ekran görüntüsü betikleri; 1'i yeni: 4 dk 13 sn + gerçeğe benzer yanıt); durağan çıktı (`/capcut`) derlendi, sınama kancası çıktıda yok. **Koşulmayan:** kalite raporu, Pages duman sınaması, tarayıcı matrisi, gerçek telefon, gerçek Worker ve sağlayıcı. Mevcut kullanıcı haklarına etkisi: fiyat, kota, şema değişmedi; yerel günlüğe bir alan eklendi (metin değil, etiketler).

## Bulut yazıya dökme: "Yazıyı nerede çıkaralım?" ekranı ve internette yolu yazıldı — KAPALI doğar — 11 Ekim 2026 (ADR-039 eki; politika ve şema değişmedi)

Kurucunun seçtiği rıza ekranı (B, "İki yol yan yana") ve bulut yolunun tarayıcı tarafı yazıldı. **Yayındaki sitede hiçbir şey değişmedi:** yol yalnızca derlemeye vekil Worker'ın kökeni verilirse vardır (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`, varsayılan boş); boşken seçim ekranı yok, `connect-src 'self'` aynen, bulut kodu ve cümleleri derlemede yok (durağan çıktıda bulunursa derleme durur), gizlilik sayfası bugünkü cümlelerini söyler. Worker yayınlanmadı; AssemblyAI'ye, Cloudflare'e ya da başka bir dış hizmete tek istek atılmadı — her şey vekilin yerel bir sahtesine karşı sınandı.

**Ekran (yol açıkken):** "Yazıya dök"te, yazıya dökme başlamadan önce "Yazıyı nerede çıkaralım?" ve eş ağırlıkta iki kart — **Cihazımda** ("Hiçbir şey gitmez…" → "Cihazımda yaz") ve **İnternette** (dört olgu: yalnızca ses gider · AssemblyAI'nin Avrupa'daki bilgisayarlarına · yazı gelince silinir · başkalarının sesi de gider; "Yaklaşık N dakika sürer · X dakika düşer, Y dakikan kalır" → "Sesi gönder ve yaz"). İki düğme aynı boyda; telefonda alt alta, masaüstünde yan yana; hiçbiri ön seçili değil, seçim hatırlanmaz; düğmeye basılmadan ses çıkmaz. Davet kodu bir kez yazılır (cihazda saklanır, kartların altında ve gizlilik sayfasında kaldırılır). Taslak ve ekranlar: `docs/ux/2026-10-11-cloud-consent/`.

**Giden şey:** videonun sesi cihazda yeniden kodlanır (16 kHz, tek kanal, Opus 24 kbit/s, WebM; ölçülen ≈ 0,21 MB/dakika, 120 dakika ≈ 25,5 MB); kaynak dosyadan hiçbir şey kopyalanmaz. Sınama, sahte sunucunun aldığı baytları ffprobe ile okur: tam bir ses izi, görüntü yok, etiket yok.

**İlerleme ve hata:** hazırlanan saniye, gönderilen bayt, sonra sayı yok ("Yazılıyor…" + geçen süre); uydurma yüzde yok. Yirmi iki hata/iptal durumunun her biri düz Türkçe söylenir (ADR-039'daki tablo), gönderilen iş silinir — silinemediyse ya da iş başlamadan durdurulduysa ekran "silindi" demez — ve "Cihazımda yaz" hep bir basış uzaktadır.

**Sonuç:** sağlayıcının kelimeleri var olan transkript izine çevrilir (EDL v4, **şema değişmedi**): konuşmacı değişince ya da 1 sn'den uzun boşlukta yeni kesim, içinde cihaz üstü satır kuralları. Panel, arama, "Bunlardan kesit yap", altyazı ve SRT/VTT değişmeden çalışır. "İnternette yazıldı — yanlış olabilir, düzeltebilirsin." etiketi ve konuşmacılar ("1. kişi / 2. kişi") sonuç ekranında ve metin dosyasındadır; tarife yazılmaz (kalıcı olması v5 ister — kurucu kararı).

**Worker (yayınlanmadı):** tarayıcının adlandırdığı iş (`x-job-id`), yükleme sırasında silme, sahipsiz kayıt temizliği, durum okunamasa da silme. Tarayıcıya bakan 18 sözleşme durumu hem gerçek Worker koduna (workerd) hem yerel sahte Worker'a koşar.

**CI:** Pages derlemesi ve duman sınaması depo değişkeni `CLOUD_TRANSCRIPT_URL`'i okur (tanımsız = kapalı); bulut sınamaları yerel sahte Worker'a karşı koşar ve yol kapalıyken yayını durdurmaz.

**Doğrulanmayan:** gerçek Worker (CORS, akıtma, bağlantı kesilmesi), gerçek sağlayıcının tarayıcının ürettiği WebM/Opus dosyasını kabulü ve kelime zamanları, gerçek telefon, Opus kodlayıcısı olmayan tarayıcılar (AAC yedeği bu makinede denenemedi), 120 dakikalık ses, konuşmayla boyut. Yazının doğruluğu için tek kaynak 11 Ekim ölçümüdür.

**Açık kurucu kararları:** cihaz kartına eklenen "Şimdilik yalnızca İngilizce."; konuşmacıların kalıcılığı (EDL v5); iş başlamadan durdurulan yüklemenin sağlayıcıda en çok iki gün kalabilmesi; bulut dakikasının ücreti (belge 15 — dokunulmadı); veri sorumlusu (K02); CI'daki bulut adımının yayını durdurup durdurmayacağı.

**Sayılar (11 Ekim, dal `worktree-agent-a4ba1c069e813cc66`; hepsi yerel):** `tsc` ve `eslint` temiz; birim 1276/1276 (75 dosya; 39'u yeni); e2e (yol kapalı) 362 testte 358 geçti / 4 atlandı / 0 başarısız (atlananlar: 2 ekran görüntüsü, 2 gerçek-model testi); bulut e2e'si (sahte Worker'a karşı) 36/36; `cloud/`: düzenek 39/39, Worker 43/43 (25 + 18 ortak sözleşme), sahte Worker 23/23, `tsc` temiz; durağan çıktı varsayılan ayarla 17 sayfada `connect-src 'self'`, ayar verilince 17 sayfada tam bir köken daha, biçimsiz ayarda derleme durur; kalite raporu 625 ölçü: 547 bütçe içinde / 9 dışında (sekizi önceki koşudakiler; yenisi rıza ekranının kurucu onaylı "AssemblyAI adlı şirketin Avrupa'daki bilgisayarlarına gider." cümlesinin okunabilirlikte "çok zor" çıkması — metne dokunulmadı) / 5 ölçülemedi; var olan ekran tabanları değişmedi. **Koşulan ama bu işle ilgisiz kırık:** Pages duman testinde 2 başarısız (Dikey yap'tan hâlâ 1080 × 1920 bekleyen eski beklenti; destek adresi değişkeni verilmeden derlenen çıktı). **Koşulmayan:** tarayıcı matrisi, gerçek telefon, gerçek Worker ve sağlayıcı. Mevcut kullanıcı haklarına etkisi: yok (fiyat, kota, şema, yayındaki gizlilik metni ve CSP değişmedi).

## Arama emin değilken soruyor; görüntü hiçbir yolda büyütülmüyor; editör kaynağın boyutunu izliyor — 11 Ekim 2026 (ADR-041; ADR-034, ADR-027, ADR-035 ekleri; politika `2026-10-11.v9`; şema değişmedi)

Kalite raporunun 11 Ekim'de açık kalan üç maddesi (kurucu onayı, 11 Ekim).

**Arama — "Bunu mu demek istedin?" (ADR-034 eki, kural 12):** sıralama aynı; arama artık ilk satırın cevap mı, seçeneklerden biri mi olduğunu ayrıca söylüyor. Emin olduğunda eskisi gibi (ilk satır seçili, Enter başlatır). Emin olmadığında aynı satırlar birer seçenektir: hiçbiri seçili değildir, başlığın altında "Tam emin olamadım. Hangisini istiyorsan ona bas." yazar, listenin altında "Aradığın bunlardan biri değilse…" ve "Tüm işleri gör" durur; **Enter hiçbir şey başlatmaz**, "Önce aşağı okla birini seç" der. Eminlik, en iyi eşleşmenin arkasındaki kanıttan hesaplanır: isteğin kaç kelimesini açıkladığı, açıkta kalan kelimeler, sıradaki işin puanı. "Bunu henüz yapamıyoruz." soruya çevrilmez. Yalnızca işlerin listesi verilen bir yazarın yazdığı, kural dondurulduktan sonra bir kez ölçülen kör kümede (280 ifade; sayılan 202): **yanlış ama emin %12,4 → %3,0** (bütçe ≤ %5: ilk kez içinde); soru oranı %25,2 (yapılabilen işlerde %29,7); sorulduğunda doğru iş seçeneklerde %88,6; açık yazılmış isteğe soru %5,6 (18 ifadeden 1'i); doğrudan doğru cevap %75,7 → %54,1; yeniden yazmadan doğru işe varma %75,7 → %80,4. **Düzelmeyen:** ilk satır doğru iş %75,7 ve ilk üçte %80,4 (bütçeler ≥ %85 / ≥ %90) — arama beş istekten birinde doğru işi hiç göstermiyor; sunuş bunu değiştirmez. Önceki kümelerin hepsi artık ayar kümesidir (ayrı raporlanır). Önce / sonra ekranları: `docs/ux/2026-10-11-did-you-mean/`.

**Görüntü büyütülmez (ADR-041, belge 15 v9):** indirmenin boyutu tek yerde hesaplanır (`web/src/domain/outputSize.ts`); "Ayarlar"daki seçim bir **üst sınırdır** ("Videonun kendi boyutu (en çok 1080p)", "En çok 720p") ve altında gerçek boyut yazar. Editör doğrudan açıldığında 1280 × 720 kaynak 1920 × 1080 yerine 1280 × 720 iner ve hızlı kesim (ADR-027) sihirbazdakiyle aynı biçimde uygulanır; 640 × 360 ve 854 × 480 kaynak kendi boyutunda kalır (sihirbazlarda 720p'ye, editörde 1080p'ye büyüyordu). "Dikey yap → Doldur" kestiği dilimi büyütmez (640 × 360'tan 202 × 360, 1280 × 720'den 406 × 720; önce hep 1080 × 1920) ve boyutu indirmeden önce söyler; "Sığdır" yalnızca boşluk ekler. Küçült'ün ilk basamağı indirmenin kendi çerçevesidir (480p kaynak 540'a büyütülmez). İki teknik taban: kısa kenar 144 (her çerçeve), 360 (görüntüye gömülü altyazı). Şema değişmedi: `export.shortEdge` aynı sayıları taşır, "en çok" diye okunur; kayıtlı projelerdeki sayı yerinde kalır. **Tek daralma:** kaynağından büyük dosya indirmek artık mümkün değil ("Ayarlar"da büyütme seçeneği yok; istenirse ayrı karar).

**Ölçülmeyen:** gerçek Chrome / Edge'in donanım kodlayıcısı 360p'nin altındaki karelerde; gerçek telefon, Safari, Firefox; paylaşım sitelerinin küçük dikey videoyu (406 × 720) nasıl karşıladığı; gerçek çekimler; arama için gerçek kullanıcı cümleleri.

**Sayılar (11 Ekim, dal `worktree-agent-a511c0275d7647e51`):** `tsc` ve `eslint` temiz; birim 1237/1237 (73 dosya); e2e 358 testte 354 geçti / 4 atlandı / 0 başarısız (atlananlar: 2 ekran görüntüsü testi, model dosyaları olmadığı için 2 gerçek-model testi) — aynı kodda bir önceki tam koşuda 353 geçti / 1 başarısız (`editor.spec.ts:77`, dosya girişini beklerken zaman aşımı; bu işle ilgisiz, yeniden koşuda geçti); statik dışa aktarım (`/capcut`) derlendi (10 sihirbaz sayfası); kalite raporu 609 ölçü: 532 bütçe içinde / 8 dışında (yedisi arama: ilk satır, ilk üç, "yapamıyoruz" ölçüleri, liste dışı, anlamsız yazı; biri dizinin sonda olması) / 5 ölçülemedi (Yazıya dök: model dosyaları yok). Kaynağından büyük çıkan dosya 0 / 27. Editörün mobil kısıtlamadaki TBT'si bu koşuda 176 ms (bütçe içinde; sabah 206 ms — sınırın kıyısında, dokunulmadı). Görsel tabanlar ekranlara bakıldıktan sonra yenilendi (5 değişen, 2 yeni). **Koşulmayan:** Pages duman testi, tarayıcı matrisi, gerçek telefon, gerçek çekimlerle ölçüm. Mevcut kullanıcı haklarına etkisi: fiyat, kota, şema, gizlilik metni değişmedi; tek daralma yukarıda (büyütme).

## Kalite raporunun bulguları: Küçült, yarım dosya, arama, düz sözler, Kes, telefon, sayfa ağırlığı — 11 Ekim 2026 (ADR-040; ADR-035, ADR-024, ADR-034 ekleri; politika ve şema değişmedi)

10 Ekim kalite raporunun (`docs/quality/`) on bulgusundan dokuzu üzerinde çalışıldı; her biri aynı ölçünün önce → sonra değeriyle (`docs/quality/latest.md`, `bulgular.md`).

**Küçült (ADR-035 eki):** önceden seçili olan artık “WhatsApp (16 MB altı)”. Video seçilen sınıra zaten sığıyorsa “İndir” kapalıdır ve nedeni yazar; 16 MB’ın altındaki videoya “Daha da küçült (yaklaşık yarısı)” çıkar. Hiçbir şeyi küçültmeyen bir indirme artık “Kaydedildi” demez. Seçim değiştirilmeden: 24,74 → 24,73 MB idi; şimdi ≈ 25 → 14,0 MB.

**Yarım kalmış video (ADR-040):** dosyanın söylediği süre ile okunabilen süre karşılaştırılır; fark 1 sn’den büyükse dosya seçildiği anda, on sihirbazda ve editörde aynı cümleyle reddedilir; dışa aktarma da başlamadan aynı denetimi yapar. Önce: sessiz 24 sn’lik ses dosyası, 12,5 sn’lik video ya da “Chrome veya Edge ile dene”. “Başka tarayıcı dene” önerisi yalnızca tarayıcı Chromium değilken gösterilir. **Açık:** okunabilen kısmı yine de açma seçeneği yok.

**Kes:** sihirbaz videoyu kendi boyutunda açar (önce editörün 1080p varsayılanı: 720p kaynak 1080p’ye büyüyor, hızlı kesim reddediliyordu). 3 sn’lik kesit 1920 × 1080 / 1,5 MB / yeniden kodlanmış → 1280 × 720 / 83 KB / görüntüye dokunulmadan. Yeniden kodlamada bit hızı kaynağınkinin iki katıyla sınırlı (ADR-024 eki; İyileştir hariç). **Değişmeyen:** doğrudan editörde varsayılan 1080p; 720p’den küçük kaynak 720p’ye büyür.

**Metinler:** çok büyük / çok uzun video mesajları ne yapılacağını söyler (sayılar politikadan); varsayılan yolda teknik terim içeren cümle 8 → 0 (teknik ad “Ayrıntılar”da).

**Arama:** Türkçe ek denetimi (`turkishSuffix.ts`), “şey + fiil” çiftleri, olumsuz fiiller, yapılamayan dört yeni istek (indirme, yükleme, ekran / kamera kaydı, canlı yayın). Kuralları görmeyen bir yazarın 243 ifadelik kümesinde (bir kez ölçüldü): yanlış ama emin %19,6 → %12,0, ilk sonuç doğru %75,0 → %81,8. **Bütçe (≤ %5) hâlâ aşılıyor.** Eski 240’lık küme kirlenmiş sayılır (ilk sonuç %89,0 → %92,4; yanlış ama emin %7,1 → %3,1); ayrı raporlanır.

**Kaynak sızıntısı:** kapatılmayan iki çözülmüş örnek (kodlayıcı öz-sınaması, iptalde kare seçici) kapatılıyor; çöp toplamayı zorlayan 3 e2e testi.

**Telefon:** 14 px altı kelime payı ana ekranda %62 → %0, sihirbazlarda %21–54 → %0; 44 px’ten küçük hedef 16 → 0. Editörde video ve kesit varken %17 (şeridin 12 px’lik zaman etiketleri).

**Sayfa ağırlığı:** editör, İngilizce metinler, Yazı / İyileştir sihirbazları ve iletişim kutuları ayrı parçalarda; medya kitaplığı video açılınca iner. Aktarılan JS: ana ekran 193 → 177 KB, sihirbaz 422 → 234 KB, editör 421 → 284 KB; mobil kısıtlamada TBT sihirbaz 209 → 129 ms, editör 256 → 206 ms (167–213; bir önceki koşuda 176 — sınırın kıyısında, **bütçe (200 ms) bu koşuda aşılıyor**). Çevrimdışı kopya 46 → 63 dosya; CSP değişmedi.

**Sayılar (11 Ekim, dal `worktree-agent-a30ab281ec174f86b`):** `tsc` ve `eslint` temiz; birim 1214/1214 (71 dosya); e2e 347 testte 343 geçti / 4 atlandı / 0 başarısız (atlananlar: 2 ekran görüntüsü testi, model dosyaları olmadığı için 2 gerçek-model testi); statik dışa aktarım (`/capcut`) derlendi; kalite raporu 489 bütçe içinde / 8 dışında (altısı arama, biri editörün TBT’si, biri dizinin sonda olması — kapsam dışı) / 5 ölçülemedi (Yazıya dök: model dosyaları yok). **Koşulmayan:** Pages duman testi, tarayıcı matrisi, gerçek telefon, gerçek çekimlerle ölçüm. Mevcut kullanıcı haklarına etkisi: yok (fiyat, kota, şema, gizlilik metni değişmedi).

## Ürünün adı LiloCut; kesitsiz proje kaybı, dürüst arama yanıtları, test sağlamlığı — 10 Ekim 2026 (ADR-038, ADR-012 eki; politika ve şema değişmedi)

**Ad (kurucu kararı, K01):** ürünün adı **LiloCut**; "Clip" o güne kadarki geçici addı. Ad tek yerde yazılır (`web/src/appIdentity.ts`, `APP_NAME`); manifest, sekme başlıkları, logodaki yazı, TR/EN metinler, transkript dosyasının ilk satırı ve indirilen dosya adları (`lilocut-tani-…json`, `….lilocut.json`) ondan türer. Ana sayfadaki "Clip geçici çalışma adıdır." cümlesi kalktı. Bir koruma testi eski adın ürün adı olarak geri gelmesini yakalar. **Bilerek değişmeyen:** tarayıcıda tutulanların adları (`clip-editor`, `clip-export-`, `clip-app-`, `clip-models-`, `clip.firstRunHint.dismissed`) — değişseydi kayıtlı projeler ve indirilmiş modeller sahipsiz kalırdı —, `CLIP_TEST_HOOKS`, depo ve `/capcut` yolu. Eski `.clip.json` yedekleri aynı biçimde açılır. Önbellek sürümü elle artırılmadı: önbellek adı dosyaların baytlarından hesaplanır, yeni derleme yeni ad üretir. **Doğrulanmayan:** yüklenmiş uygulamanın simge altındaki adının telefonda ne zaman değiştiği; marka/alan adı incelemesi yapılmadı (K01'de açık iş).

**Kesiti olmayan proje (ADR-012 eki):** video açılıp hiç kesit eklenmeden kaydedilen proje "Düzenleme saklandı" diyor ama yenilemede kayboluyordu (kayıt, dışa aktarmanın "en az bir kesit" kuralıyla okunuyordu); aynı projenin yedeği de geri yüklenemiyordu. Kayıt artık `validateStoredProject` ile okunur: tek fark boş `clips`; ortak fixture'lar ve dışa aktarma kuralı değişmedi. "Kayıtlı projeyi sil"den sonra otomatik kaydın projeyi geri yazabilmesi de kapatıldı. Kesit yokken eklenmiş müziğin 0,1 sn'lik eski kayıtları artık açılıp onarılıyor.

**Arama:** "videoya yazı ekle", "yüzleri bulanıklaştır", "türkçeye çevir / dublaj", "rüzgar sesini sil" gibi yapılamayan dört istek için dürüst kayıt ("Bunu henüz yapamıyoruz.", düğme yok). Önce: 60 cümlelik yeni tabloda 16/60 ve 44 yeni istekten 26'sına başka iş yapan kart; ilk koşu 55/60 ve 4 yanlış kart; düzeltmeden sonra 60/60, 0. Eski tablolar aynı: 69/70 ve 92/95 (önce ve sonra). Tabloyu ve listeleri aynı kişi aynı oturumda yazdı.

**Sunucu günlüğü:** `/yap/<olmayan>` isteklerinde `next start` günlüğüne düşen "NoFallbackError" kalktı (`dynamicParams = false` kaldırıldı; sayfa 404'ü kendi söyler). 404 yanıtı ve statik dışa aktarım (10 sihirbaz sayfası) aynı.

**Testler:** telefon çubuğu odak testi çubuğun alt boşluğu yerleştikten sonra tek tur yürür ve sayfa sonuna vardığını doğrular (10/10). "Diskte yer kalmadı" testleri sabit 4 MiB kota yerine ölçülen kullanımın 2 MiB üstünü kullanır (çevrimdışı kopya büyüdükçe kırılıyordu). **Sayılar (10 Ekim, bu dal):** `tsc` ve `eslint` temiz; birim 1149/1149 (67 dosya); e2e 332 testte 328 geçti / 4 atlandı / 0 başarısız (atlananlar: 2 ekran görüntüsü testi, gerçek model dosyaları bu makinede olmadığı için 2 gerçek-model testi); statik dışa aktarım derlendi; Pages duman testi 7 testte 5 geçti / 2 atlandı (ikisi de model dosyası gerektirir — ÇALIŞTIRILMADI).

**Bağımlılık ve lisans notları (`docs/security/DEPENDENCIES.md`):** `npm audit` 5 high = tek tavsiye (`braces` ≤ 3.0.3, yalnız lint zinciri); düzeltilmiş sürüm yayınlanmadığı için çözülemedi, nedeni yazıldı; `--omit=dev` 0. Whisper ONNX dışa aktarımlarının lisansı için bilinen/bilinmeyen ayrı yazıldı, hukuki iddia yok.

## Yazıya dök: gerçek konuşmada kalite, önerilen model, uzun yazı — 7–8 Ekim 2026 (ADR-036 eki; politika ve şema değişmedi)

Kurucu canlı sitede denedi (5 Ekim): kısa, temiz videoda çoğunlukla çalıştı; 52 dakikalık gerçek bir videoda konuşmanın büyük kısmını yazmadı. Karar: bulut yolu sonra; ücretsiz cihaz üstü yol dürüstçe olabildiği kadar iyi olsun. Ses cihazdan çıkmaz, ücretli API yok — değişmedi.

**Önce ölçüldü.** Okunmuş konuşma yerine gerçekçi bir küme kuruldu (AMI toplantıları CC BY 4.0, Earnings-22 çağrıları CC BY-SA 4.0 — biri 51 dakika —, tek dosyada 48 dB'ye kadar seviye basamakları, konuşmanın altında ve bitişiğinde müzik, 20 yeni negatif; kaynak ve lisanslar `web/tests/media/SPEECH_SOURCE.md`; medya git'te değil). 5 Ekim'de yayınlanan ayarlarla, küçük modelle konuşma süresinin yalnızca **%59–62'si** yazılıyordu: **%22–28'i konuşma bulucuya hiç takılmıyor** (yüksek sesten sonra gelen kısık konuşma), **%13–16'sını koruma atıyordu** (kısa, bağlamsız parçalar).

**Değişen (motor; koruma eşiği aynı):** konuşma bulucudan önce **seviye eşitleme** (yalnız bulucunun dinlediği kopyada; duraklamada kazancı tutan karşıtlık kuralıyla); aralıklar **1,2 s'den kısa duraklamada bölünmüyor**, iki yana 0,4 s pay; korumanın attığı aralığa **ikinci bakış** (ikiye böl, her yarıyı aynı korumayla yargıla). Ayarlar geliştirme yarısında seçilip donduruldu, doğrulama yarısı sonra üretildi ve bir kez koşuldu.

**Sonuç (doğrulama yarısı, 116 dakika, Chromium):** yazılan konuşma payı `base` **%62,1 → %89,8** (hiç duyulmayan %21,9 → %3,9; atılan %16,1 → %6,3), `turbo` **%76,2 → %95,6**; normalize WER `base` %28,3 → %19,6, `turbo` %19,0 → %14,3; Hint aksanlı çağrıda `base` %30,7 → %15,7; denemenin stres dosyası `base` %72,0 → %9,8. **Uydurma metin: 45 negatif klipte 0** (`base`: Chromium, Chrome, Edge, Firefox; `turbo`: Chromium); müzik boşluklarına yazılan kelime 0. Daha yavaş değil: 14 dakikalık toplantı 0,43 → 0,35 (süre / ses süresi); 51 dakikalık çağrı bu masaüstünde 18 dakika, bellek 1,15 GiB.

**Önerilen model:** WebGPU + `shader-f16` olan tarayıcıda `large-v3-turbo` artık **"Önerilen: büyük model (≈595,6 MB, bir kez iner)"** olarak ilk sırada ve ön seçili; `base` "Küçük model (≈108,8 MB)". Tarayıcıda yalnızca küçük model varsa küçük model ön seçili kalır (596 MB'lık indirme kendiliğinden gündeme gelmez); başka tarayıcıda tek model. Hiçbir indirme düğmesiz başlamaz.

**Dürüst geri bildirim:** bulunan konuşmanın onda biri ya da fazlası yazılamadıysa sonuç sayıyla söyler — "Bulunan konuşmanın yaklaşık yüzde 62 kadarı yazıldı; 14 yer anlaşılamadı." — ve küçük modelle yazıldıysa, büyük model burada çalışıyorsa "Önerilen modelle yeniden yaz" önerir.

**Uzun yazı:** "Yazı" paneli 200 satırdan sonra pencereli çiziliyor (3000 satırda DOM 24 011 → 177 öğe; paneli açma 380 → 48 ms, 4 kat yavaşlatılmış işlemcide 2 368 → 147 ms). Tıkla-git, oynarken izleme, klavye (↑ ↓ Home End Enter), aralık seçip kesit yapma, yerinde düzeltme çizilmemiş satırlarda da çalışır; her satır yerini söyler (`aria-posinset` / `aria-setsize`); odak hiç kaybolmaz. Tarayıcının "sayfada bul"u uzun yazıda yalnızca ekrandaki satırları görür — bu yüzden panelin kendi **"Yazıda ara"** kutusu var (12 satırdan itibaren; bütün satırlarda arar). Dürüst not: yavaşlatılmış işlemcide büyük atlamalarla kaydırma adım başına biraz daha uzun sürüyor (56 → 67 ms).

**Testler (8 Ekim, `main` ef6c345 birleştirilmiş ağaçta):** birim 1090/1090; e2e 329 testte 326 geçti / 2 atlandı / 1 başarısız (bu işin dışında: `enhance.spec.ts:358`; ayrıntı ADR-036); yeni 18 e2e (uzun yazı 11 — axe 360/390/1440 0 bulgu, 320 px —, model ve geri bildirim 7); gerçek modelli 2 test koştu ve geçti; Pages duman testi 7/7; matris ADR-036'da.

**Hâlâ zayıf (bulut yolunun karşılaması gereken):** üst üste konuşma ve konuşmacı ayrımı (en iyi durumda WER %21–22); müzik altında ve uzak mikrofonda küçük model (WER %34–55); WebGPU'suz her cihaz (telefonlar, Firefox, Safari) küçük modelde kalır; uzun çağrıda `turbo` da %11. **Ölçülmeyen:** telefon, dizüstü, Safari, gerçek ekran okuyucu, Türkçe. Mevcut kullanıcı haklarına etkisi: yok (fiyat, kota, şema, gizlilik metni değişmedi).

## İyileştir: plan eşikte açılıp kapanmıyor, test videoları her üretimde aynı, GPU'suz cihaza süre uyarısı — 8 Ekim 2026 (ADR-037 güncellemesi; politika ve şema değişmedi, motor sürümü 2)

**Bulgu:** aynı tariften iki çalışma kopyasında üretilen "değişen ışık" test videosunda iyi pozlanmış bölüm birinde 3,22, diğerinde 6,28 seviye aydınlanıyordu (e2e sınırı 6; ikincide test kalıyordu). Aynı görünen iki videoya gözle görülür biçimde farklı davranan bir plan demekti.

**Neden (uygulama):** zaman yumuşatması iyi pozlanmış bölüme, önündeki aydınlanan bölümün kazancından yaklaşık onda bir taşıyordu; ölü bant ise tam o büyüklükte bir basamaktı ("kazanç 1,10'dan küçükse hiç"). Hangi yana düşeceğini resmin ayrıntısı belirliyordu. İstatistik olarak 40 farklı kum deseniyle denendiğinde eski plan o bölüme 40 desenin 40'ında dokunuyordu.

**Düzeltilen — plan:** ölü bantlar basamak değil, eşikten sonra yavaşça açılır (eğim en çok 2); yumuşatma bir kareyi kendi istediğinden en çok yarım "fark edilir adım" uzaklaştırır; tek aykırı kare komşularının ortancasını alır; sık bakılan yerler ortalamada fazla sayılmaz; hiçbir yerde görünür olmayan düzeltme türü plandan çıkar (söylenen ile yapılan aynı). Sonuç, tarayıcıda, e2e'nin ölçüsüyle: eski iki dosyada **3,22 → 1,40** ve **6,28 → 1,44**; yeni sabit dosyada 1,44. On iki farklı sahnede (referans işleyici) bölüm 0 … +1,66 yerine +0,02 … +0,05 seviye oynuyor. **Testin `< 6` sınırı değiştirilmedi.**

**Kazançlar korundu (aynı küme, önce → sonra):** Otomatik ortalama +4,22 → **+4,29 dB**, SSIM +0,0757 → +0,0757; temiz karelerde dokunuş azaldı (ortalama 45,5 → 48,1 dB; 9 karenin 8'i yine bir miktar değişiyor); soluk renkte artık zarar yok (−0,27 → −0,01 dB); kum +3,84 → +4,42 dB. **Bedeli:** küçük renk sapması düzeltmesi azaldı (soğuk +0,86 → +0,53 dB) ve titreme ölçüsü biraz arttı (12 sahne ortalaması 0,172 → 0,194 seviye; kaynak 0,138, kare başına düzeltme 0,31–0,38 olurdu). Gerçek kayıtlarda ortalamalar aynı; tek tek karelerde iki yönde küçük farklar.

**Düzeltilen — test videoları:** ffmpeg'in `perlin` kaynağı `random_seed`'i yalnızca `random_mode=seed` ile kullanıyor; her üretim başka bir sahneydi. Artık aynı baytlar: beş video × üç üretim aynı sha256 (`scripts/enhance-eval/fixture-determinism.mjs`), e2e'nin kendi ürettikleri de aynı. Dosyalar yeni klasörde (`tests/media/enhance/e2e-v2`).

**Yeni birim testleri (video dosyası olmadan):** yarım 8-bit seviyelik ölçüm farkı düzeltmeyi yarım adımdan az oynatır; 40 farklı kum deseninde iyi pozlanmış bölüm tam olarak dokunulmadan kalır ve hiçbir kare bir desenden ötekine bir adımdan fazla farklı işlenmez.

**Eklenen — süre uyarısı:** ekran kartı hızlandırması yoksa (işlemci yolu ya da WebGL'in yazılım işleyicisi: SwiftShader, llvmpipe, Microsoft Basic Render Driver) sihirbaz ve Ayarlar → Görüntü bunu **indirmeden önce** söyler: "Bu cihazda ekran kartı hızlandırması yok. İyileştirme yine çalışır ama yavaştır: 5 dakikalık bir video yarım saatten uzun sürebilir." — tahmin iki dakikayı geçiyorsa "bu video yaklaşık N dakika sürebilir" (kare başına 0,25 sn × piksel oranı; tek bir bilgisayarın ölçümünden, "yaklaşık" diye). 7 Ekim'in bilinen eksiği kapandı.

**Değişen — "Güçlü":** kaldı (kurucunun sözü olmadan kaldırılmaz); alt yazısı artık açıkça "Bazı videolarda Otomatik'ten kötü görünür: kumlanma ve sıkıştırma izleri belirginleşir, renkler abartılı olabilir." diyor.

**Testler (8 Ekim 2026, main 2292e16 birleştirilmiş ağaç, ölçüm kilidi altında):** `tsc` ve `eslint` temiz; birim **1101 / 1101** (65 dosya); e2e **327 geçti, 2 atlandı, 0 başarısız**; matris Chromium / Chrome / Edge **30 / 30**; gerçek kayıtlar (Chrome) **15 / 15**; Pages duman testi **7 / 7**.

**Ölçülmeyen:** hız ve bellek yeniden ölçülmedi (kare başına iş değişmedi); uyarı gerçek bir GPU'suz kullanıcı cihazında denenmedi; titreme için gözle karşılaştırma yok.

Mevcut kullanıcı haklarına etkisi: yok. İyileştirme açıkken indirilen videoların pikselleri değişti (motor sürümü 2); kapalıyken hiçbir şey değişmedi.

## İyileştir: cihaz üstü, tek dokunuşla görüntü iyileştirme — 7–8 Ekim 2026 (ADR-037; politika `2026-10-07.v8`, şema EDL v4)

Kurucu kararı (7 Ekim 2026): planlanan son ücretsiz kart yapılsın — tek dokunuş, cihazda, **klasik görüntü işleme**. Yapay zekâ, büyütme (upscaling) ya da bulanıklık giderme değildir ve hiçbir yerde böyle söylenmez; bunlar sonraki ücretli bulut aşamasına bırakıldı.

**Eklenen — onuncu kart "İyileştir"** (`/yap/iyilestir`): video seç → gerçek bir karenin **önce / sonra** resmi (çizgi sürüklenir, ok tuşlarıyla kayar) + tek seçim "Ne kadar?" (Hafif · **Otomatik** · Güçlü) → İndir → kaydedildi + paylaş. Açılış ekranından üç dokunuş. Dürüst cümle kartta ve sihirbazda aynı: "Işığı, rengi ve keskinliği toparlar. Çok bulanık bir videoyu netleştiremez." Sihirbaz ne yapacağını önceden söyler; değiştirilecek bir şey bulamazsa bunu söyler ve indirmeyi kapatır. "Daha fazla ayar → editörde aç" seçimi taşır; editörde **Ayarlar → Görüntü → "Görüntüyü iyileştir"** aynı ayardır.

**Motor** (dışa aktarma worker'ında, WebGL2; yoksa ya da çalışma anı denetimi tutmazsa aynı resmi veren işlemci yolu): önce videoya bakılır (≥ 0,5 sn arayla en çok 240 kare), sonra üç geçiş — hafif kumlanma süzgeci, doğrusal ışıkta ışık / kontrast / yumuşak beyaz dengesi / küçük canlılık, hale yapmayan keskinleştirme. HDR yumuşak kırpmadan sonra, altyazıdan önce; siyah bantlara dokunmaz. Renk ve keskinlik ayarı video için tektir, ışık zamanda yumuşatılır (titreme yok). Önizleme dışa aktarmayla **aynı kodla** üretilir. İyileştirme açıkken görüntü her zaman yeniden kodlanır (hızlı kesim uygulanmaz; yöntem satırı nedenini söyler).

**Arama:** "kaliteyi yükselt", "4K yap", "bulanıklığı sil", "netleştir", "renkleri düzelt", "brightness" bu karta gelir ve o dürüst cümleyle görünür. Gerçek filtre / efekt, titreme düzeltme ve arka plan istekleri "Bunu henüz yapamıyoruz." olarak kalır (renk / parlaklık / kontrast kelimeleri "filtre ve renk" girişinden bu karta taşındı).

**Şema — EDL v4:** kökte isteğe bağlı `enhance: { strength }`. Göç v3 → v4 yalnız sürüm numarası; v1–v3 tarifler kayıpsız okunur; alan yokken çıktı ve parmak izi eskisiyle aynı.

**Ölçüm (ayrıntı ve sınırlar ADR-037'de):** bilinen 12 bozulma × 9 açık lisanslı kare, Otomatik: ortalama **+4,22 dB PSNR / +0,076 SSIM**; karanlık +11…+13 dB, karanlık + kumlu +14,4 dB, kum +3,8…+6,7 dB; bulanık yalnız +0,02…+0,30 dB (bulanıklık giderilmez); **kötüleşenler:** soluk renk −0,27 dB, sıkıştırılmış −0,17 dB, temiz karelerde çok küçük değişiklik (ortalama 45,5 dB). Gerçek 13 SDR kayıtta Otomatik 2'sine hiç dokunmadı, 8'inde girdiye SSIM ≥ 0,997. Titreme: kaynak 0,152 → plan 0,183 seviye (kare başına düzeltme 0,388 olurdu); ani pozlama değişiminde taşma 2,6 seviye (kaynak 2,5). Hız, 5 dakikalık 1080p: Chrome 154 55,8 → 80,1 sn, Edge 154 54,5 → 76,9 sn (farkın tamamına yakını videoya bakma); **GPU'suz** Chromium 163,6 sn → **36 dakika**. Tepe bellek +14…+101 MiB. Kare sayısı, kare zamanları, ses ve renk etiketleri düz çıktıyla birebir (matris M23).

**Testler (7–8 Ekim 2026, bu makine, ölçüm kilidi altında):** `tsc` ve `eslint` temiz; birim **1056 / 1056** (60 dosya); e2e (Playwright Chromium, `CLIP_TEST_HOOKS=1` derlemesi) **309 geçti, 2 atlandı, 0 başarısız** (yeni 20 test: sihirbaz uçtan uca, önce / sonra fare + klavye, editöre taşıma, erişilebilirlik 360 / 390 / 1440, 320 px, metin aralığı, yalnız klavye, azaltılmış hareket); matris Chromium / Chrome / Edge **30 / 30**; gerçek kayıtlar (Chrome) **15 / 15**; Pages duman testi **7 / 7**.

**Ölçülmeyen:** telefon, Safari / Firefox, tümleşik GPU, HDR kaynakta kalite, 5 dakikadan uzun iyileştirilmiş çıktı, algısal (insan gözü) karşılaştırma. Bilinen eksik: yazılım WebGL kullanan cihazda uzun süre önceden söylenmiyor.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. İyileştirme kapalıyken (varsayılan) hiçbir indirme değişmedi; kayıtlı projeler aynen açılır.

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
