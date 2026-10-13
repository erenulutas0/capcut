# Tek bir dosya gelmezse kullanıcı ne görür? — arıza sondası, 13 Ekim 2026

> Ölçüm: `web/scripts/soak/fault-probe.mjs` (bu makine, Windows 11, Playwright'ın Chromium'u, `next start`
> ile `CLIP_TEST_HOOKS=1` derlemesi, kök yol). Karar ve gerekçe: `docs/adr/ADR-044-page-that-never-came-alive.md`.
> **Önce** sütunu değişiklikten önceki derlemedir (commit `c42e548`, 395 durum); **Şimdi** sütunu bu dalın
> derlemesidir (360 durum; işleyici dosyaları yeniden koşulmadı, onlara dokunulmadı).
> Sondanın bozduğu şey **kalıcıdır** (yeniden yüklemede de bozuk): "Şimdi" sütunu bu yüzden en kötü hâli
> gösterir. Bozulma **geçiciyse** (ilk yüklemede var, yeniden yüklemede yok) sayfa kendini kurtarır; onu
> e2e testleri gösterir (`web/tests/e2e/page-watchdog.spec.ts`), tabloda "→ geçiciyse" diye yazıldı.

## Nasıl ölçüldü

Derleme küçük bir vekilin arkasına konur; vekil **tek bir isteği** tel üzerinde, bir ağın yapacağı gibi bozar:

| Kısaltma | Ne olur |
|---|---|
| koptu | bağlantı yanıtsız kapanır (`ERR_EMPTY_RESPONSE`) |
| 500 / 404 | hata durumu, küçük bir HTML gövdesi |
| kesildi | 200, tam `Content-Length`, bağlantı yarıda kapanır (`ERR_CONTENT_LENGTH_MISMATCH`) |
| yarım | 200, dosyanın ilk yarısı, uyan `Content-Length` (hatasız "başarılı" yanıt) |
| yanıtsız | hiç yanıt gelmez |
| durdu | 200, dosyanın yarısı, sonra sessizlik |

Her (dosya, bozulma) çifti için sayfa **yeni bir tarayıcı bağlamında** açılır; yazılanlar: `load` ateşlendi mi
(12 sn içinde), React sayfayı devraldı mı (hidratlanınca çizilen gizli dosya girişi, 10 sn içinde), ekrandaki
yazı, "Video seç"in `disabled` olup olmadığı, Next'in hata ekranı var mı, konsol ve sayfa hataları, belge
kaç kez istendi, bekçinin uyarısı ve sekmenin notu. "Şimdi" koşusunda canlanmayan sayfa için 50 sn daha
beklenir (kendini kurtarsın ya da söylesin).

## 1. İlk yükleme, service worker yok

`/yap/cevir`: ilk HTML'de 13 betik + 3 stil dosyası (şimdi 15 betik: iki hata ekranının kodu eklendi).

| Ne bozuldu | Nasıl | Durum | `load`? | **Önce** kullanıcı ne gördü | Önce konsol | **Şimdi** (kalıcı bozulma) → geçiciyse |
|---|---|---|---|---|---|---|
| İlk HTML'deki **herhangi bir betik** (çatı, React, Turbopack çalışma zamanı, düzen, sayfanın kodu — fark yok) | koptu · 500 · 404 · kesildi | 13 × 4 = **52/52** | **evet** | **Ölü sayfa:** başlık "Videonu seç" görünür, "Video seç" `disabled`, tek kelime yok. Next'in hata ekranı yok. | yalnızca tarayıcının "Failed to load resource" satırı; sayfa hatası yok | 1 otomatik yeniden yükleme, sonra uyarı "**Sayfa tam açılamadı.** İnternet bağlantın takılmış olabilir. · Yeniden yükle" (15 betiğin 8'i) ya da uygulamanın kendi "**Bir şey ters gitti** · Yeniden yükle" ekranı (7'si: çatı o dosyalarda yüklemeyi reddediyor). İkisinde de söz ve düğme var. → **geçiciyse: ~5 sn'de kendiliğinden açılır** |
| aynı | yarım | 13/13 | evet | aynı ölü sayfa | bir `SyntaxError` | `error` olayı yok: `load`'dan **15 sn** sonra 1 yeniden yükleme, ondan 15 sn sonra uyarı (toplam ~30 sn) → geçiciyse ~16 sn'de açılır |
| aynı | yanıtsız · durdu | 26/26 | **hayır** | aynı ölü sayfa; sekme "yükleniyor" | yok | **45 sn** sonra uyarı, **yeniden yükleme yok** → dosya sonunda gelirse sayfa açılır, uyarı kendiliğinden kalkar |
| Stil dosyası (3'ünden biri) | koptu · 500 · 404 · kesildi | 12/12 | evet | Sayfa **çalışır**, biçimsiz: ortak dosyada (1/3) koyu zemin de yok, diğer ikisinde sayfanın kendi yerleşimi yok. Tek kelime yok. (5 Ekim CI olayı) | ağ satırı | 1 yeniden yükleme (hemen); dosya yine gelmezse sayfa çalışır ve "**Uygulamanın bir parçası açılamadı.** … Yeniden yükle / Kapat" der → geçiciyse biçimiyle açılır |
| Stil dosyası | yarım | 3/3 | evet | sayfa çalışır, kısmen biçimsiz | yok | **değişmedi**: tarayıcı hata vermez, bekçi göremez |
| Stil dosyası | yanıtsız · durdu | 6/6 | hayır | ölü sayfa (çizim de bekler) | yok | 45 sn sonra uyarı, yeniden yükleme yok |

`/yap/yazi` (kendi ekranını ayrı parçalarla getiren sihirbaz; "İyileştir" aynı yapıda):

| Ne bozuldu | Nasıl | Durum | `load`? | **Önce** | Önce konsol | **Şimdi** |
|---|---|---|---|---|---|---|
| `/yap/cevir` ile ortak 13 betik | hepsi | 91 | yukarıdaki gibi | yukarıdaki gibi (91'in 89'u ölü sayfa; 2'sinde Next'in ham hata ekranı) | yukarıdaki gibi | yukarıdaki gibi |
| Kendi ekranının 2 parçası (sayfa bunları **sonradan** ister) | koptu · 500 · 404 · kesildi | 8/8 | evet | Next'in İngilizce ham ekranı: "This page couldn't load · Reload to try again, or go back" | `ChunkLoadError` | 1 otomatik yeniden yükleme, sonra "**Bir şey ters gitti.** Sayfanın bir parçası açılamadı. İnternet bağlantın takılmış olabilir. · Yeniden yükle" → geçiciyse açılır |
| aynı | yanıtsız · durdu | 4/4 | **evet** | **Ölü sayfa, konsolda tek satır yok**: başlık var, "Video seç" `disabled` (11 Ekim olayının imzası) | **yok** | `load`'dan 15 sn sonra 1 yeniden yükleme, sonra uyarı |
| aynı | yarım | 2/2 | evet | ölü sayfa | `SyntaxError` | 15 sn sonra 1 yeniden yükleme, sonra uyarı |

**13 Ekim CI dökümünü (sunucu HTML'i + `disabled` düğme + `load` ateşlenmiş + sayfa hatası yok) birebir
veren durumlar:** `/yap/cevir`'in ilk HTML'indeki 13 betikten herhangi birinin koptu / 500 / 404 / kesildi
ile gelmemesi — **52/52**. Konsolda tek bir ağ satırı olur; CI dökümünde konsol yoktu, o yüzden bu satırın
orada olup olmadığı bilinmiyor. **Konsolu da tamamen boş** bırakan tek durum: `/yap/yazi`'nin sonradan
istenen parçasının hiç yanıt almaması (4/4).

## 2. Sayfa canlıyken sonradan istenenler

| Ne bozuldu | Nasıl | **Önce** | **Şimdi** |
|---|---|---|---|
| Sihirbazdan açılan editörün kodu ("Daha fazla ayar → editörde aç"; o an gerçekten istenen 3 parça) | koptu · 500 · 404 · kesildi | Next'in ham hata ekranı sayfanın **tamamının** yerine geçer; açık video ve seçim gider | **"Bu bölüm açılamadı. İnternet bağlantın takılmış olabilir." + Tekrar dene**; sihirbaz sayfası, video ve seçim yerinde; "Tekrar dene" tutunca editör o videoyla açılır |
| aynı | yanıtsız · durdu · yarım | "Editör açılıyor…" sonsuza kadar | "Editör açılıyor…", 30 sn sonra aynı "Bu bölüm açılamadı" + Tekrar dene |
| "Sorun bildir" penceresinin kodu | koptu · 500 · 404 · kesildi | Next'in ham hata ekranı; editörün tamamı gider | "Bu bölüm açılamadı" + Tekrar dene + Kapat; editör yerinde |
| aynı | yanıtsız · durdu · yarım | düğmeye basılır, **hiçbir şey olmaz** | 30 sn sonra "Bu bölüm açılamadı" + Tekrar dene + Kapat |
| Açılış ekranında karta basınca `?_rsc` isteği | koptu · 500 · 404 · kesildi · yarım | Next kendisi tam sayfa gezinmesine düşer; sihirbaz açılır | değişmedi (çalışıyor) |
| aynı | yanıtsız · durdu | kart hiçbir şey yapmamış gibi kalır | **değişmedi** (ADR-044, kurucu kararı 3) |
| Açılış ekranından "Yazıya dök"e geçerken sihirbazın parçaları | koptu (e2e) | (ölçülmedi; mekanizma yukarıdaki ham ekranla aynı) | "Bir şey ters gitti. Sayfanın bir parçası açılamadı…" + Yeniden yükle; kendiliğinden yeniden yükleme yok |

Sihirbazdan açılan editörün o sırada istediği 10 dosyanın 6'sı o adım için gerekli değildi ya da başka
yoldan (işleyici) geliyordu; onlar bozulunca editör yine açıldı (önce de şimdi de). Biri sayfanın kendisiyle
ortaktı (bozulunca sayfa zaten açılmadı: §1). Kalan 3'ü yukarıdaki satırlardır.

## 3. İşleyici (worker) dosyaları — "Boşlukları at" (yalnızca önce; dokunulmadı)

| Ne bozuldu | Nasıl | Kullanıcı ne gördü |
|---|---|---|
| Ses çözümleme işleyicisinin betiği / çalışma zamanı | koptu · 500 · 404 · kesildi · yarım | "Çözümleme bu tarayıcıda başlatılamadı. Sayfayı yenileyip tekrar dene. · Ayrıntılar · Yeniden dene · Editörde aç" (var olan koruma, ADR-042 eki) |
| aynı | yanıtsız · durdu | "Sessiz yerler aranıyor… · Vazgeç" (süre sınırı dolunca hata; ADR-042 eki) |
| Ana iş parçacığının medya kitaplığı parçası (`import('mediabunny')`, video seçilince) | yanıtsız · durdu · yarım | **"Video açılıyor…" kalır** (bilinen sınır; dokunulmadı) |

## 4. Service worker'ın yönettiği yükleme (yalnızca şimdi)

Değişiklikten önceki derlemede bu grup **geçerli biçimde ölçülemedi**: sonda aynı sekmede yeniden yüklüyordu
ve tarayıcının bellek / HTTP önbelleği sayfaya iyi kopyayı veriyordu (dokuz durumun dokuzu "çalışıyor"
çıktı — yanlış). Sonda düzeltildi (yüklemeden önce `Network.clearBrowserCache` + önbellek kapalı: yarın geri
gelen kullanıcının durumu). Önceki davranış ayrıca ölçülmedi; mekanizma §1 ile aynıdır (gelmeyen ya da
bozuk betik → ölü sayfa), e2e testlerinde uyarının altında görülen de o ölü sayfadır.

| Durum | `load`? | **Şimdi** |
|---|---|---|
| Ağ sağlam (taban) | evet | çalışıyor (55 ms) |
| Her istek kopuyor — çevrimdışı, kopya tam | evet | çalışıyor (71 ms); bekçi sessiz |
| Her istek yanıtsız — ölü bağlantı, kopya tam | evet | çalışıyor (4,0 sn: sayfa isteği 4 sn sonra kopyaya düşer, ADR-031); bekçi sessiz |
| Ana betik kopyada yok, ağ isteği koptu / 404 | evet | 1 yeniden yükleme, sonra uyarı + "Uygulamayı baştan indir" |
| Ana betik kopyada yok, ağ isteği yanıtsız | hayır | 45 sn sonra uyarı (+ "Uygulamayı baştan indir"), yeniden yükleme yok |
| Kopyadaki ana betik yarım (bozuk kopya), ağ sağlam | evet | `load`'dan 15 sn sonra 1 yeniden yükleme, ondan 15 sn sonra (toplam ~30 sn) uyarı + "Uygulamayı baştan indir". **"Yeniden yükle" işe yaramaz** (kopya önce gelir); "Uygulamayı baştan indir" düzeltir (e2e) |
| Kopyadaki ana betik bir HTML sayfası (ortak ağ giriş sayfası), ağ sağlam | evet | aynı |
| İlk ziyaret, kurulum listesinden bir dosya alınamıyor | evet | çalışıyor; service worker kurulmaz (hepsi ya da hiçbiri), bir sonraki ziyaret yeniden dener |
| Bütün kopya silinmiş, her istek kopuyor — çevrimdışı, hiçbir şey saklı değil | hayır | tarayıcının kendi hata sayfası: bizim belgemiz yok, yapılacak bir şey yok |

Çevrimdışıyken (tarayıcı `navigator.onLine === false` diyorsa) "Uygulamayı baştan indir" gösterilmez (e2e).

## Ham veri

Koşular bu dosyanın yanına konmadı (395 + 360 kayıt, ekran yazılarıyla ~1 MB). Yeniden üretmek için:

```
cd web
CLIP_TEST_HOOKS=1 npm run build
node scripts/soak/fault-probe.mjs --port=3193 --settle=50000 --out=fault-probe.json
#   --groups=first,rsc,lazy,worker,sw   --paths=/yap/cevir,/yap/yazi   --modes=reset,hang,s500,s404,truncate,cut,stall
```
