# ADR-034 — Görev öncelikli açılış ekranı: iş kartları, yazarak bulma, görev sihirbazları

> Tarih: 2026-10-03 · Durum: UYGULANDI (kurucu kararı 3 Ekim 2026: taslak **A + C**).
> Tasarım: [docs/ux/2026-10-03-home](../ux/2026-10-03-home/README.md) (üç taslak, karar,
> uygulamanın ekran görüntüleri). [ADR-026](ADR-026-kesit-list.md) /
> [ADR-030](ADR-030-kesit-flow-v2.md) (kesit editörü) aynen duruyor ve "Kes" işinin kendisi;
> [ADR-031](ADR-031-phone-share-install-offline.md)'in manifest başlangıç adresi değişti.
> Şema (EDL v2) ve politika (`2026-09-24.v6`) **değişmedi**; dışa aktarma motoru değişmedi.

## Neden

Kurucunun 3 Ekim 2026 değerlendirmesi (tasarım klasörünün README'sinden):

> Kurucu, editörle açılan ekranı yeterince kolay bulmadı: hedef "bir çocuğun bile
> istediğini yapabileceği" bir ürün.

Görev tanımındaki sözleriyle: video uygulamalarını kullanması zor buluyor; editörle açılan
ekran "yeterince kullanıcı dostu değil"; arayüz, kullanıcının istediğini hızla öne
getirmeli. Üç taslak çizildi (A · iş kartları, B · önce video, C · yaz, bulalım) ve karar:

> **Seçim: A + C birlikte.** Üstte arama kutusu, altında kartlar. Kart seçilince B'deki
> "Video seç" adımı, sonra o işe özel 1–2 adım ve indirme. Editör "Kendim düzenleyeceğim"
> bağlantısıyla kalır.

Araştırma özeti de aynı yönde: araç ızgarası kullanan siteler onlarca araçla ve belirgin
arama olmadan çalışıyor; göreve göre düzenlenmiş gezinme özelliğe göre düzenlenmişten kolay
öğreniliyor; yazarak bulma menüden hızlı ama tek başına bırakılmamalı.

## Karar

1. **`/` artık açılış ekranı** (eski tanıtım sayfasının yerine; yüklenen uygulamanın
   `start_url`'i de bu): başlık "Ne yapmak istiyorsun?", bir yazma kutusu, örnek cümleler,
   bugün çalışan her iş için bir kart, sağ üstte sessiz "Kendim düzenleyeceğim" (editör),
   altta "Videon cihazından çıkmaz. Hesap gerekmez."
2. **Yazarak bulma cihazda, kelime listesiyle** yapılır: yapay zekâ yok, ağ isteği yok,
   yazılan hiçbir şey saklanmaz (`web/src/domain/taskSearch.ts`, kurallar aşağıda).
3. **Her iş bir sihirbaz**, kendi adresinde (`/yap/<id>/`): (1) "Videonu seç", (2) en fazla
   **bir** karar — varsayılanı seçili —, (3) "İndir" → ilerleme → "Kaydedildi" + "Paylaş".
   Sihirbazlar editörün kendi tarifini ve kendi indirme yolunu kullanır; yeni bir motor yok.
4. **Henüz yapılmamış iş sahte gösterilmez:** kartı yoktur, sayfası yoktur; arama onu
   kastederse "Bu henüz yok, üzerinde çalışıyoruz." yazar ve düğme çizmez.
5. **Editör `/editor`'de aynen durur**; logosu açılış ekranına götürür.

## Açılış ekranı

| Öğe | Davranış |
|---|---|
| Kutu | `role="combobox"`, `aria-controls` ile sonuç listesine (`role="listbox"`), `aria-activedescendant` ile vurgulu sonuca bağlı; odak hep kutuda. ↑/↓ sonuçta gezer (başa sarar), Enter vurgulu sonucu başlatır, Esc kutuyu boşaltır, × de. Sonuç sayısı `role="status"` ile duyurulur ("2 sonuç. İlki: Dikey yap."). |
| Örnek cümleler | "sessiz yerleri sil", "TikTok için dikey", "başını kes", "müzik koy": dokununca kutuya yazılır. Hepsi bugün çalışan bir işe götürür (birim testi). |
| Kartlar | Kayıttaki sırayla, yalnızca `available: true` işler: Kes (dolu, öne çıkan kart), Boşlukları at, Dikey yap, Müzik ekle, Her yerde açılsın. Kart bir bağlantıdır (JavaScript olmadan da çalışır), en az 126 px yüksek. Telefonda 2 sütun; 700 px'ten itibaren 3; 1000 px'ten itibaren satırları dolduruyorsa 4 (8 kart → 4 + 4; bugünkü 5 kart → 3 + 2, tek kalan kart olmasın diye). Hiçbir kart gizlenmez. |
| Yazınca | Kartlar ve örnekler yerini "Bunu mu demek istedin?" listesine bırakır (en fazla 3 satır; her satırda "Başla"). Kutuyu boşaltmak ya da "Tüm işleri gör" kartları geri getirir. Tek harf ya da yalnızca "video" yazmak henüz bir şey söylememektir: kartlar durur. |
| Bulunamadı | "Bunu bulamadım. Başka kelimelerle dene ya da bütün işlere bak." + "Tüm işleri gör". |
| Yük | Açılış ekranı dışa aktarma motorunu (mediabunny) yüklemez, worker başlatmaz, başka kökene istek yapmaz (e2e). |

## Yazarak bulma: eşleştirme kuralları

Girdi → sıralı işler; tamamı `searchTasks()` içinde, saf fonksiyon:

1. **Katlama:** Türkçe küçük harf, aksanlar düz harfe (ç ğ ı ö ş ü â î û), harf ve rakam
   dışındaki her şey boşluk ("WhatsApp’a SIĞMIYOR!" → `whatsapp a sigmiyor`).
2. **Sözcükler:** tek harfliler ve anlam taşımayanlar atılır ("ve", "için", "istiyorum",
   "my", "make", "video…" ile başlayan her sözcük).
3. **Sözcük–kelime karşılaştırması**, en emin olandan: **tam** ("dikey") › **kök ya da ön
   ek**, dört harf ve üstü ("sessizlikleri" ← "sessiz"; yazarken "sess") › **yazım hatası**,
   beş harf ve üstü kelimelerde tek düzeltme, ilk harf aynı ("sesiz", "whatsap", "dikye",
   ekli hâliyle "titokta") › üç harf ve altı kök ("kesmek" ← "kes"). Bir sözcük yalnızca en
   emin türüne ve onun içinde en uzun eşleşen kelimeye sayılır: "sessiz" *Boşlukları at*'tır,
   *Sesini al* ("ses") değil. İki harfli yarım sözcük yalnızca o an yazılan son sözcükse sayılır.
4. **Puan:** güçlü kelime tam 3, kök/ön ek/yazım hatası 2; zayıf kelime ("ekle", "sil",
   "baş") tam 1, kök 0,75, yazım hatasıyla hiç.
5. **Deyim:** birkaç sözcük sırayla geçiyorsa +4 ("her yerde", "sessiz yer", "make it
   vertical"); deyimlerde atılan sözcükler de sayılır.
6. **Sıralama:** puana göre; eşitlikte daha özel iş öne (herkesin her iş için söylediği
   "kes / cut / sil" genel işi geri çeker: "cut the pauses" → Boşlukları at), sonra kayıt
   sırası. En fazla üç sonuç, yalnızca en iyinin %40'ı ve üstü (tek bir zayıf kelime ikinci
   satır açmaz: "altyazı ekle" yalnızca Yazıya dök).

Kelime listeleri iş kaydındadır (`web/src/domain/tasks.ts`): her iş için güçlü kelimeler,
zayıf kelimeler ve deyimler, Türkçe ve İngilizce.

**Ölçüm.** İki tablo var ve ikisi farklı şey söyler:

- `tests/unit/taskSearch.test.ts` — 74 cümle (TR + EN; her işten en az 5; henüz olmayan üç iş
  dahil). Kelime listeleri **bu tabloya bakılarak** yazıldı; 74 / 74'ünde doğru iş birinci.
  Bu yüzden tek başına bir doğruluk tahmini değildir, bir gerileme testidir.
- `tests/unit/taskSearchHeldOut.test.ts` — listeler bittikten sonra yazılan 56 cümle. İlk
  koşuda, listelere dokunulmadan: **48 / 56 (%86)** doğru iş birinci. Kaçanlar: "sadece bir
  bölümünü al", "susma yerlerini kes", "jump cut", "ses ekle", "file not supported", "tvde
  oynatmak istiyorum", "videodan müzik çıkar", "şarkıyı al". Sonra bu sekizi için listeler
  düzeltildi (düzeltmeden sonra 55 / 56; kalan: "sadece bir bölümünü al"); dürüst tahmin
  %86'dır, düzeltmeden sonraki sayı değil, çünkü tablo artık görülmüş bir tablodur.
  Test, oranın %80'in altına düşmesini engeller.

Bilinen sınır: listede olmayan bir söyleyiş bulunmaz ("Bunu bulamadım" der, kartlar bir
dokunuş ötededir); "sesini kapat" gibi karşılığı bir iş olmayan istekler yanlış işe
(Sesini al) gidebilir. Gerçek kullanıcı cümleleri kullanıcı testlerinde toplanıp tabloya
eklenmeli (docs/beta/USER_TEST_KIT.md, Görev 0).

## İş kaydı ve sihirbaz çatısı

`web/src/domain/tasks.ts` tek kayıttır: kimlik, etiket ve alt etiket (mesaj anahtarı),
simge, `available`, sihirbazın adımları, kelimeler. Kartlar, arama ve `/yap/<id>/` sayfaları
buradan okur.

| İş | `available` | Adımlar | Tek karar |
|---|---|---|---|
| Kes (`kes`) | evet | video → editör | — (kesit editörü bu işin kendisi) |
| Boşlukları at (`bosluk`) | evet | video → karar → indir | "Uzun boşluklar" (varsayılan) / "Kısa duraksamalar da" |
| Dikey yap (`dikey`) | evet | video → karar → indir | "Doldur" (varsayılan) / "Sığdır" |
| Küçült (`kucult`) | **hayır** | — | (hedef boyut; motoru başka bir iş kaleminde) |
| Yazıya dök (`yazi`) | **hayır** | — | (cihazda transkript denemesi sürüyor) |
| Müzik ekle (`muzik`) | evet | video → karar → indir | Videonun sesi "Kalsın" (varsayılan) / "Kapansın" |
| Sesini al (`ses`) | **hayır** | — | (yalnızca ses çıktısı; motoru başka bir iş kaleminde) |
| Her yerde açılsın (`cevir`) | evet | video → indir | — |

**Bir işi açmak:** `tasks.ts`'te `available: true` (tek satır) + `components/wizard/wizards.tsx`
içinde sihirbaz bileşeni ve `WIZARDS` tablosunda satırı. Tablo `Record<AvailableTaskId, …>`
türündedir: `available: true` yapılıp bileşen eklenmezse `tsc` derlemez. Kart, arama satırındaki
"Başla", sayfa (`generateStaticParams`), service worker listesi kendiliğinden gelir.

**Çatı** (`components/wizard/`):

- `TaskWizard` — sayfanın sahibi. Tarifi ve açık dosyaları **editörün kendi durum kancası**
  (`useEditorState`) tutar; proje saklama kancası yoktur.
- `WizardFlow` — her sihirbazın ortak iskeleti: üstte "Geri" ve logo (açılış ekranı), "İş ·
  Adım n / 3", adım başlığı; (1) büyük "Video seç" düğmesi (masaüstünde sürükle-bırak;
  editörün ret cümleleri: çok büyük, çok uzun, okunamıyor, HEVC ipucu), (2) videonun küçük
  önizlemesi + adı + "Değiştir", işin kararı, **"İndir"**, "Daha fazla ayar → editörde aç",
  (3) editörün `DownloadStatus`'u (ilerleme, "Kaydedildi: ad.mp4", "Paylaş", yöntem satırı,
  ret ve hata cümleleri) + "Başka bir video" / "Ana ekrana dön". Adım değişince odak adım
  başlığına gider. İndirme sürerken çıkmak sorulur ("Video hâlâ hazırlanıyor…"), tarayıcının
  kendi kapatma uyarısı da editördeki gibi çalışır.
- `useWizardExport` — sihirbazdan dışa aktarmaya giden **tek yol**: editörün `useDownloads`'u
  (kaydetme penceresi tıklamanın içinde, yetenek kapısı, yedek yol, paylaşma, alan ve sınır
  retleri) + sihirbazın tarifi, dosya adı (`ad_dikey.mp4`) ve **ek dışa aktarma seçenekleri**
  (`extras`). `extras`'ın türü dışa aktarma istemcisinin kendi seçeneklerinden türetilir
  (`ExportExtras`): istemciye `targetBytes` ya da yalnızca-ses çıktısı eklendiğinde ilgili
  sihirbaz bunu `exportExtras` ile verir, arada başka hiçbir şey değişmez.
- `application/taskRecipes.ts` — her sihirbazın tarife yaptığı saf değişiklikler (birim testli).

**Editöre el verme ("Daha fazla ayar → editörde aç", ve "Kes"):** sayfa değişmez. `TaskWizard`
sihirbazın yerine editörü (`EditorView`) **aynı durumun üstünde** çizer: aynı `File`, aynı
ayarlar, ikinci dosya penceresi yok. Sayfa yüklemesi bir `File` taşıyamaz ve çevrimdışıyken
istemci içi gezinme tam sayfa yüklemesine düşer (ADR-031 testleri); yerinde değiştirmek ikisinden
de bağımsızdır. Bu editörde **hiçbir şey saklanmaz** (`stored={false}`): tarayıcıdaki proje
deposu okunmaz ve yazılmaz, yani `/editor`'de kayıtlı proje yerinde durur; başlıkta
"Düzenleme saklandı" yerine "Bu düzenleme saklanmıyor" yazar.

## Sihirbazlar

Dokunuş sayıları: açılış ekranından kaydedilen dosyaya, uygulama içindeki dokunuşlar; işletim
sisteminin iki penceresi (dosya seçme, kaydetme) ayrıca. Yazarak başlamak ilk dokunuşun yerine
geçer (yaz + Enter).

| İş | Yol | Dokunuş |
|---|---|---|
| Kes | kart → Video seç → *(editör)* Başlangıcı işaretle → Bitişi işaretle → İndir | 5 (bir kesit) |
| Boşlukları at | kart → Video seç → *(kendiliğinden aranır)* → İndir | 3 (diğer seçenekle 4) |
| Dikey yap | kart → Video seç → İndir | 3 ("Sığdır" ile 4) |
| Müzik ekle | kart → Video seç → Müzik seç → İndir | 4 ("Kapansın" ile 5) |
| Her yerde açılsın | kart → Video seç → İndir | 3 |

**Kes.** Video seçilince kesit editörü aynı videoyla açılır (ilk açılış ipucu "Nasıl kesilir?
Üç adım" dahil). Kesit editörü bu işin kendisidir; ayrı bir kesme sihirbazı yazılmadı.

**Boşlukları at.** Video açılınca ADR-018'in ses çözümlemesi videonun tamamı için çalışır
(ilerleme çubuğu, "Vazgeç"). Sonuç: "N sessiz yer bulundu." + "Videon kısalacak: 12,0 sn →
10,1 sn". Karar: "Uzun boşluklar" (editörün varsayılanı: 0,7 sn ve üstü) / "Kısa duraksamalar
da" (0,4 sn ve üstü; konuşmayı koruyan 150 ms pay ve eşik aynı). 20 kesit sınırı aşılıyorsa en
uzun boşluklar seçilir ve açıkça söylenir: "Bir videoda en çok 20 parça birleştirilebiliyor. En
uzun 19 boşluk atılacak; 1 kısa boşluk yerinde kalacak." Bulunamadıysa "Sessiz yer bulunamadı."
— "İndir" kapalı, editör önerilir. Ses yoksa "Bu videoda ses yok; sessizlik aranamaz."; konuşma
ile gürültü ayırt edilemiyorsa o söylenir. Editöre el verince aynı kesimler kesit olur (tek
geri alma adımı).

**Dikey yap.** Çerçeve 9:16, boyut 1080 × 1920 (Reels / TikTok / Shorts). Karar: "Doldur"
(kenarlar kesilir) / "Sığdır" (boşluk kalır); 9:16 önizleme çerçevesi seçimi canlı gösterir
(dışa aktarmanın yaptığı orta kırpma / kenar boşluğuyla aynı geometri). Zaten 9:16 olan video
için karar yok: "Bu video zaten dikey: görüntü aynı kalır, 1080 × 1920 olarak kaydedilir."

**Müzik ekle.** Kullanıcı kendi müzik dosyasını seçer (dosya seçmek karar sayılmaz). Karar:
videonun kendi sesi "Kalsın" (müzik arkada, −12 dB) / "Kapansın" (yalnızca müzik, 0 dB). Müzik
videodan uzunsa videonun sonunda 1,5 sn'de kısılır; kısaysa kendi sonunda biter ve söylenir
("Müzik videodan kısa: … sonra biter."). Sesi olmayan videoda soru sorulmaz, müzik tam seviyede.
Müzik seçilmeden "İndir" kapalıdır ve nedenini söyler.

**Her yerde açılsın.** Karar yok. "iPhone, HEVC ya da HDR videolar her cihazda açılan MP4
olur." Çıktı H.264 + AAC MP4, videonun kendi çerçevesinde. Kaynak zaten öyleyse (H.264, AAC ya
da sessiz, SDR, `.mp4`) indirmeden önce söylenir: "Bu video zaten her cihazda açılan türde.
Yine de indirebilirsin; görüntüsü aynı kalır." — ve hızlı kesim (ADR-027) izin veriyorsa
görüntü yeniden kodlanmadan kopyalanır; sonuçtaki yöntem satırı hangisinin olduğunu söyler.

**Kendi boyutunda indirme.** Çerçeveyi değiştirmeyen üç sihirbaz (Boşlukları at, Müzik ekle,
Her yerde açılsın) videoyu kendi boyutunda indirir: kısa kenarı 720 px ve altı olan video 720p,
büyüğü 1080p (editörün sunduğu iki boyut), yerleşim "tam görüntü" (kırpma yok). Böylece 720p bir
video boşuna 1080p'ye büyütülmez ve hızlı kesim mümkün olur. Editörün kendi varsayılanı (1080p)
değişmedi.

## Bilerek gösterilmeyenler

- **Küçült, Sesini al, Yazıya dök'ün kartı.** Çalışmayan bir işe kart koymak, basınca "henüz
  yok" demek olurdu. Arama kastederse dürüst satır var; kart yok.
- **Editörün ayarları** (kare oranı, yakınlaştırma, kalite, ses seviyeleri, müzik aralığı ve
  geçişleri, altyazı, sessizliklerin tek tek listesi ve "Dinle"). Sihirbazda tek karar var;
  gerisi "Daha fazla ayar → editörde aç".
- **Teknik kelimeler.** Sihirbaz metinlerinde "codec", "fps", "MiB", "kare" yok. (İstisna:
  "Her yerde açılsın"ın tek cümlesindeki "HEVC / HDR / MP4" — kullanıcının telefonunda gördüğü
  adlar; ve sonuçtaki "Ayrıntılar" açılır bölümü, editördekinin aynısı.)
- **Proje kaydı, "Düzenleme saklandı", yedek.** Sihirbaz proje saklamaz.
- **Eski tanıtım sayfası** (dört adımlı anlatım, "Editörü aç" düğmesi). Yerini ekranın kendisi
  aldı; deneme sürümü notu ve gizlilik bağlantısı altta kaldı.
- **"En çok kullanılanlar"** (taslak C). Kullanım ölçmüyoruz (analitik yok); bütün kartlar
  kayıt sırasıyla gösterilir.

## Değişen dosyalar (özet)

- Yeni: `src/domain/tasks.ts`, `src/domain/taskSearch.ts`, `src/application/taskRecipes.ts`,
  `src/components/home/TaskFinder.tsx`, `src/components/wizard/*`, `src/app/yap/[id]/page.tsx`,
  `src/app/home.css`, `src/app/wizard.css`, `src/components/editor/MediaErrorNotice.tsx`.
- Değişen: `src/app/page.tsx` (açılış ekranı), `src/app/manifest.ts` (`start_url` = `/`),
  `EditorApp.tsx` (`EditorView` + logo bağlantısı), `useEditorState.ts` (dosya açarken tarife
  saf bir hazırlık adımı), `useDownloads.ts` (dosya adı ve ek seçenekler), `useProjectPersistence.ts`
  (`enabled`), `Icon.tsx` (iş simgeleri), `messages.ts` (TR + EN), `scripts/build-sw.mjs`.
- Güvenlik: CSP aynen (satır içi `<style>`/`<script>` yok; yeni sayfalar da politikayı taşır ve
  bir oturum boyunca ihlal yok). Service worker listesine `/yap/<id>` sayfaları girdi.
- Gizlilik: yeni saklanan veri yok. Gizlilik sayfası ve veri envanteri arama kutusunu ve
  sihirbazların proje saklamadığını söyler.

## Testler

- Birim: `taskSearch.test.ts` (74 cümlelik tablo, kurallar, kayıt), `taskSearchHeldOut.test.ts`
  (56 cümle), `taskRecipes.test.ts` (sihirbaz tarifleri; her biri derleyicinin kabul ettiği
  bir tarif), `serviceWorker.test.ts` (sihirbaz sayfaları listede).
- e2e: `home.spec.ts` (açılış ekranı, arama: klavye + dokunma, henüz olmayan işler, 360 / 390 /
  1440 px), `wizards.spec.ts` (beş sihirbaz baştan kaydedilen dosyaya — dosya ffprobe/ffmpeg ile
  ölçülür —, editöre el verme, kayıtlı projenin korunması, ret ve iptal, yedek yol, sürükle-bırak,
  telefon), `a11y.spec.ts` (axe: masaüstü / tablet / telefon; yalnız klavyeyle akış; 320 px;
  yazı aralığı; azaltılmış hareket; adlar), `csp.spec.ts`, `pwa.spec.ts` (çevrimdışı açılış
  ekranı + sihirbaz), `tests/pages/pages-smoke.spec.ts` (`/capcut/` altında açılış → sihirbaz →
  indirme → editör).

Koşu sayıları: bu belgenin sonundaki "Doğrulama".

## Yapılmayanlar / açık kalanlar

- Küçült, Sesini al, Yazıya dök sihirbazları (motorları ayrı iş kalemlerinde). Sesini al için
  kaydetme penceresinin dosya türü (bugün yalnızca `.mp4`) o sihirbazla birlikte ele alınmalı.
- Gerçek telefon (Galaxy S23) ve gerçek kullanıcı denemesi yapılmadı; ölçümler masaüstünde
  Playwright'ın Chromium'uyla. Kullanıcı testi kiti açılış ekranından başlayacak şekilde güncellendi.
- Sihirbazda müzikle videonun birlikte dinlenmesi yok (müzik ve video ayrı ayrı oynatılır);
  birlikte önizleme editörde.
- Editörde (ADR-026'dan beri var olan) bir durum: kesit yokken eklenen müzik yalnızca en kısa
  kesit uzunluğu kadar seçilir. Sihirbaz bunu videonun tamamını tek kesit yaparak aşar; editörün
  kendi davranışına dokunulmadı.
- Arama yalnızca Türkçe ve İngilizce kelime bilir; arayüz dili Türkçe (EN çevirileri
  `messages.ts`'te hazır, dil seçimi yok).

## Doğrulama (3 Ekim 2026, masaüstü, Playwright Chromium)

Gerçekten çalıştırılanlar:

- `npx tsc --noEmit -p .` ve `npx eslint .`: hatasız (son kodda).
- `npx vitest run`: 49 dosya, **700 / 700** (son kodda).
- Tam e2e (`E2E_PORT=3301 npx playwright test`, ölçüm kilidi altında, 18:46–18:55): **220 geçti,
  3 kaldı, 2 atlandı**. Kalan üçü bu işin yan etkisiydi ve düzeltildi: iki kota testi (çevrimdışı
  kopya 2 MB'ı geçince 3 MiB'lık kota 1 MiB'lık ayırmaya yetmedi → 4 MiB) ve ağ testi (izin
  listesinde `/yap/…` sayfaları yoktu; teste arama + sihirbaz oturumu da eklendi). Düzeltmeden
  sonra bu üçü ve açılış ekranı / CSP testleri hedefli koşuda geçti (22 / 22).
- Ekran görüntüleri: 57 dosya, 2,2 MB (`shots/`).

**Çalıştırılamayanlar** (ölçüm kilidi iki saat boyunca başka işlerdeydi; bekleyen koşu süre
sınırında durduruldu): düzeltmelerden sonraki **tam** e2e koşusu, dosya matrisi
(`run-matrix.mjs --browser=chromium`) ve GitHub Pages duman testi (`/capcut/` altında; testleri
yazıldı ama **hiç koşturulmadı**). Bunlar birleştirmeden önce koşturulmalı.
