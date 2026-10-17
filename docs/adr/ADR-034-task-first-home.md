# ADR-034 — Görev öncelikli açılış ekranı: iş kartları, yazarak bulma, görev sihirbazları

> Tarih: 2026-10-03 · Durum: UYGULANDI (kurucu kararı 3 Ekim 2026: taslak **A + C**).
> Tasarım: [docs/ux/2026-10-03-home](../ux/2026-10-03-home/README.md) (üç taslak, karar,
> uygulamanın ekran görüntüleri). [ADR-026](ADR-026-kesit-list.md) /
> [ADR-030](ADR-030-kesit-flow-v2.md) (kesit editörü) aynen duruyor ve "Kes" işinin kendisi;
> [ADR-031](ADR-031-phone-share-install-offline.md)'in manifest başlangıç adresi değişti.
> Şema (EDL v2) ve politika (`2026-09-24.v6`) **değişmedi**; dışa aktarma motoru değişmedi.
> **Güncelleme 7 Ekim 2026:** dokuzuncu kart "Sesi kapat"; yapılamayan on istek aramada dürüst
> yanıt alıyor; arama kuralları 5 ve 7; müzik artık indirmenin tamamına yayılıyor (aşağıda
> ilgili yerler güncellendi, sonda "Güncelleme — 7 Ekim 2026"). Aynı gün onuncu kart "İyileştir" geldi ([ADR-037](ADR-037-enhance.md)).
> **Ek, 13 Ekim 2026:** "sihirbaz proje saklamaz" kuralının **tek istisnası** — "Yazıya dök"ün yazısı
> editöre geçişte saklanır: sabah internette yazılan yazı (yalnız bulut derlemesinde), akşam cihazda
> yazılan yazı da, yani yayındaki derlemede (sonda "Ek, 13 Ekim 2026" ve "Ek 2, 13 Ekim 2026 akşamı").

> **Ek, 17 Ekim 2026:** telefonun paylaşma menüsünden gelen videoyla açılış ekranı "Bu videoyla ne yapmak
> istiyorsun?" der, videoyu gösterir ve kartlar işi videoyla bir sonraki adımda açar —
> [ADR-047](ADR-047-share-target.md), ekranlar [docs/ux/2026-10-17-paylas](../ux/2026-10-17-paylas/README.md).

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
4. **Yapılamayan iş sahte gösterilmez:** kartı yoktur, sayfası yoktur; arama onu
   kastederse "Bunu henüz yapamıyoruz." yazar ve düğme çizmez (7 Ekim 2026'ya kadar cümle "Bu
   henüz yok, üzerinde çalışıyoruz." idi; söz vermediğimiz işler için söz veren cümle kaldırıldı).
5. **Editör `/editor`'de aynen durur**; logosu açılış ekranına götürür.

## Açılış ekranı

| Öğe | Davranış |
|---|---|
| Kutu | `role="combobox"`, `aria-controls` ile sonuç listesine (`role="listbox"`), `aria-activedescendant` ile vurgulu sonuca bağlı; odak hep kutuda. ↑/↓ sonuçta gezer (başa sarar), Enter vurgulu sonucu başlatır, Esc kutuyu boşaltır, × de. Sonuç sayısı `role="status"` ile duyurulur ("2 sonuç. İlki: Dikey yap."). |
| Örnek cümleler | "sessiz yerleri sil", "TikTok için dikey", "başını kes", "müzik koy": dokununca kutuya yazılır. Hepsi bugün çalışan bir işe götürür (birim testi). |
| Kartlar | Kayıttaki sırayla, yalnızca `available: true` işler — bugün on: Kes (dolu, öne çıkan kart), Boşlukları at, Dikey yap, Küçült, Yazıya dök, Müzik ekle, Sesini al, **Sesi kapat**, Her yerde açılsın, **İyileştir** ([ADR-037](ADR-037-enhance.md)) (Küçült ve Sesini al [ADR-035](ADR-035-target-size-and-audio-only.md), Yazıya dök [ADR-036](ADR-036-on-device-transcript.md), Sesi kapat 7 Ekim 2026). Kart bir bağlantıdır (JavaScript olmadan da çalışır), en az 126 px yüksek. Telefonda 2 sütun; 700 px'ten itibaren 3; 1000 px'ten itibaren, son satırda tek kart kalmayacak biçimde 3 ya da 4 (`wideColumns`: önce satırları tam dolduran — 8 → 4 + 4, 9 → 3 + 3 + 3, 6 → 3 + 3 —, sonra son satırı en dolu olan — 7 → 4 + 3, 10 → 4 + 4 + 2, 5 → 3 + 2). Hiçbir kart gizlenmez. |
| Yazınca | Kartlar ve örnekler yerini "Bunu mu demek istedin?" listesine bırakır (en fazla 3 satır; her satırda "Başla"). Kutuyu boşaltmak ya da "Tüm işleri gör" kartları geri getirir. Tek harf ya da yalnızca "video" yazmak henüz bir şey söylememektir: kartlar durur. |
| Yapılamayan istek | Kayıtta `available: false` olan on giriş (döndür, hızlandır / yavaşlat, videoları birleştir, GIF, filigran ya da logo sil, filtre ve renk, arka plan, tersten oynat, videodan fotoğraf, titremeyi düzelt): satırda işin adı ve **"Bunu henüz yapamıyoruz."**, düğme yok, `aria-disabled`; Enter ve dokunma hiçbir şey başlatmaz; duyuru "1 sonuç. İlki: Döndür. Bunu henüz yapamıyoruz." Altında başka iş yapan bir kart önerilmez (kural 7). |
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
   vertical"); deyimlerde atılan sözcükler de sayılır. İkinciden sonraki her sözcük +1: uzun
   deyim daha özeldir ("arka plan değiştir" arka planla ilgilidir; yalnız "arka plan" müzik
   isterken söylenir). Bir işin yalnızca en uzun deyimi sayılır. *(7 Ekim 2026)*
6. **Sıralama:** puana göre; eşitlikte daha özel iş öne (herkesin her iş için söylediği
   "kes / cut / sil" genel işi geri çeker: "cut the pauses" → Boşlukları at), sonra kayıt
   sırası. En fazla üç sonuç, yalnızca en iyinin %40'ı ve üstü (tek bir zayıf kelime ikinci
   satır açmaz: "altyazı ekle" yalnızca Yazıya dök).
7. **Yapılamayan iş birinciyse** ("gife çevir", "tiktok logosunu kaldır") yanıt "Bunu henüz
   yapamıyoruz."dur ve isteğin yalnızca bir kelimesini taşıyan çalışan iş ("çevir" → Her yerde
   açılsın, "tiktok" → Dikey yap) altında gösterilmez: çalışan bir işin satırı ancak puanı
   birincinin %80'i ve üstüyse kalır ("döndür ve kes": ikisi de). *(7 Ekim 2026)*

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

- `tests/unit/taskSearchHeldOut2.test.ts` *(7 Ekim 2026)* — "Sesi kapat" ve yapılamayan istekler
  için 95 cümle, o girişlerin listelerinden **önce** yazıldı. Üç ölçüm: eski kayıtla 13 / 95
  (yalnızca zaten var olan işlerin 13 cümlesi; kalan 82'nin **44'ü başka iş yapan, "Başla"
  düğmeli bir karta** gitti — 14 ses kapatma isteğinin 13'ü, yapılamayan 68 isteğin 31'i —,
  38'i "Bunu bulamadım"a); yeni girişlerle ilk koşu **69 / 95 (%73)**, yapılamayan 68 isteğin
  12'si hâlâ yanlış karta; kaçanlar listelerde düzeltildikten sonra 95 / 95, yanlış kart 0.
  Dürüst tahmin %73'tür. Bu tablo ile listeleri aynı kişi aynı oturumda yazdı: "görülmemiş"
  burada "listeler tabloya bakılmadan yazıldı" demektir, "kör" değil.

Bilinen sınır: listede olmayan bir söyleyiş bulunmaz ("Bunu bulamadım" der, kartlar bir
dokunuş ötededir). "Sesini kapat" artık "Sesi kapat"ı buluyor (7 Ekim 2026); yapılamayan on
istek kendi dürüst satırını alıyor. Listelenmemiş bir yapılamayan istek (ör. "yüzleri
bulanıklaştır", "videoya yazı ekle", "sesi değiştir", "çeviri altyazı") hâlâ ya bulunamaz ya
da bir kelimesi tutan çalışan bir işe gider. Gerçek kullanıcı cümleleri kullanıcı testlerinde
toplanıp tabloya eklenmeli (docs/beta/USER_TEST_KIT.md, Görev 0).

## İş kaydı ve sihirbaz çatısı

`web/src/domain/tasks.ts` tek kayıttır: kimlik, etiket ve alt etiket (mesaj anahtarı),
simge, `available`, sihirbazın adımları, kelimeler. Kartlar, arama ve `/yap/<id>/` sayfaları
buradan okur.

| İş | `available` | Adımlar | Tek karar |
|---|---|---|---|
| Kes (`kes`) | evet | video → editör | — (kesit editörü bu işin kendisi) |
| Boşlukları at (`bosluk`) | evet | video → karar → indir | "Uzun boşluklar" (varsayılan) / "Kısa duraksamalar da" |
| Dikey yap (`dikey`) | evet | video → karar → indir | "Doldur" (varsayılan) / "Sığdır" |
| Küçült (`kucult`) | evet (ADR-035) | video → karar → indir | Nereye sığsın: "Paylaşmak için (52 MB altı)" (varsayılan) / "E-posta (25 MB altı)" / "WhatsApp (16 MB altı)"; her seçenek sonucu baştan söyler ("≈ 15,4 MB · 720p", "Videon zaten bunun altında", "Bu video buna sığmaz: en az … gerekir") |
| Yazıya dök (`yazi`) | evet (ADR-036) | video → karar → indir | (model indirme ve yazıya dökme; ayrıntı ADR-036) |
| Müzik ekle (`muzik`) | evet | video → karar → indir | Videonun sesi "Kalsın" (varsayılan) / "Kapansın" |
| Sesini al (`ses`) | evet (ADR-035) | video → indir | — (ses M4A olarak kaydedilir; sessiz videoda İndir kapalı ve sebebi yazılı) |
| Sesi kapat (`sustur`) | evet (7 Ekim 2026) | video → indir | — (aynı video, ses izi olmadan; sesi olmayan videoda İndir kapalı ve sebebi yazılı) |
| Her yerde açılsın (`cevir`) | evet | video → indir | — |
| İyileştir (`iyilestir`) | evet (ADR-037) | video → karar → indir | Ne kadar: "Hafif" / "Otomatik" (varsayılan) / "Güçlü"; videonun gerçek bir karesinin öncesi ve sonrası (dışa aktarmanın kendi koduyla), ne yapılacağı sözle; değişecek bir şey yoksa İndir kapalı ve sebebi yazılı |
| Döndür (`dondur`), Hızlandır ya da yavaşlat (`hiz`), Videoları birleştir (`birlestir`), GIF yap (`gif`), Filigran ya da logo sil (`filigran`), Filtre ve renk (`efekt`), Arka planı değiştir (`arkaplan`), Tersten oynat (`ters`), Videodan fotoğraf al (`foto`), Titremeyi düzelt (`stabil`) | **hayır** (7 Ekim 2026) | — | Motoru yok. Kartı, sayfası, sihirbazı yok; yalnızca aramanın "Bunu henüz yapamıyoruz." demesi için kayıttalar. |

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
"Düzenleme saklandı" yerine "Bu düzenleme saklanmıyor" yazar. (Tek istisna, 13 Ekim 2026: "Yazıya dök"ün
yazısının — cihazda ya da internette yazılmış — üstünde açılan editör; sondaki iki ek.)

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
| İyileştir (ADR-037) | kart → Video seç → İndir | 3 (başka bir güçle 4) |

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

**Sesi kapat** *(7 Ekim 2026)*. Karar yok. "Aynı video, sesi olmadan kaydedilir." Tarif kesitsizdir
(bütün video), videonun sesi kapalıdır (editördeki "Sesi kapat" anahtarı), müzik yoktur; çıktıda
**ses izi yoktur** — sessizlik izi değil. Neden: (1) her oynatıcı ve paylaşım uygulaması ses izi
olmayan MP4'ü "sessiz video" olarak gösterir, sessizlik izi ise "sesi var ama duyulmuyor"
görünür; (2) sessizlik izi boşuna bayt harcar (128 kbit/s AAC ≈ dakikada 1 MB) ve ADR-032'nin
kodlayıcı gecikmesi / düzenleme listesi inceliklerini hiçbir şey için taşır; (3) motor bu dosyayı
sesi olmayan kaynaklar için zaten yazıyor ve testler onu zaten ölçüyor — yeni bir yol açılmadı.
Hızlı kesim (ADR-027) izin veriyorsa görüntü kopyalanır (sonuçtaki yöntem satırı: "Hızlı kesim —
görüntü yeniden kodlanmadı, orijinal kalite"); değilse yeniden işlenir ve satır onu söyler.
Önizleme sessiz oynar. Sesi olmayan videoda "Bu videoda zaten ses yok; kapatılacak bir şey yok."
— İndir kapalı. Ölçülen (Playwright Chromium, 24 sn'lik 720p H.264 + AAC): kaydedilen dosyada tek
akış `video:h264`, 24 sn, 1280 × 720, kareler kaynağın aynısı (0,5 / 11 / 23. sn'de fark < 1 / 255),
dosya kaynaktan küçük; tarayıcının kendi oynatıcısı oynatıyor, çözdüğü ses baytı 0. **Denenmedi:**
telefon, iOS / Safari, WhatsApp ve Instagram'ın ses izi olmayan videoyu nasıl gösterdiği.

**Müzik ekle.** Kullanıcı kendi müzik dosyasını seçer (dosya seçmek karar sayılmaz). Karar:
videonun kendi sesi "Kalsın" (müzik arkada, −12 dB) / "Kapansın" (yalnızca müzik, 0 dB). Müzik
videodan uzunsa videonun sonunda 1,5 sn'de kısılır; kısaysa kendi sonunda biter ve söylenir
("Müzik videodan kısa: … sonra biter."). Sesi olmayan videoda soru sorulmaz, müzik tam seviyede.
Müzik seçilmeden "İndir" kapalıdır ve nedenini söyler. *(7 Ekim 2026: sihirbaz artık bütün videoyu
tek kesit yapmıyor; müzik kesitsiz tarifte de indirmenin tamamına yayılıyor —
`web/src/domain/musicFit.ts`. Editöre geçince kesit listesi boştur, üstte "Videoyu indir".)*

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

- **Yapılamayan işlerin kartı.** Çalışmayan bir işe kart koymak, basınca "yapamıyoruz" demek
  olurdu. Arama kastederse dürüst satır var; kart yok. (Küçült ve Sesini al ADR-035, Yazıya dök
  ADR-036 ile motorları gelince kart oldu; bugün kartsız on giriş yukarıdaki tabloda.)
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

- Yazıya dök sihirbazı (motoru ayrı iş kaleminde). Küçült ve Sesini al ADR-035 ile yapıldı
  (kaydetme penceresi ses dosyasında `.m4a` / `audio/mp4` sunuyor).
- Gerçek telefon (Galaxy S23) ve gerçek kullanıcı denemesi yapılmadı; ölçümler masaüstünde
  Playwright'ın Chromium'uyla. Kullanıcı testi kiti açılış ekranından başlayacak şekilde güncellendi.
- Sihirbazda müzikle videonun birlikte dinlenmesi yok (müzik ve video ayrı ayrı oynatılır);
  birlikte önizleme editörde.
- ~~Editörde kesit yokken eklenen müzik yalnızca en kısa kesit uzunluğu kadar (0,1 sn) seçilir;
  sihirbaz bunu videonun tamamını tek kesit yaparak aşar.~~ **Düzeltildi (7 Ekim 2026):** kaydedilen
  dosyada ölçüldü (12 sn'lik video, müzik yalnızca ilk 0,1 sn'de), kök neden komutta giderildi,
  sihirbazın dolanması kaldırıldı. Ayrıntı sondaki güncellemede.
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

## Doğrulama — birleşim sonrası (3 Ekim 2026, ana oturum)

Bu ADR'yi yazan işin çalıştıramadığı üç koşu `main` üzerinde (commit 03eb084 + Pages testi
düzeltmesi) ölçüm kilidi altında çalıştırıldı:

- `tsc`, `eslint`, derleme: temiz. `vitest`: 700/700.
- Tam e2e (`E2E_PORT=3191`): **223 geçti, 2 atlandı, 0 kaldı.**
- Matris: Chromium, Chrome, Edge **22/22**. (Ana klasörün matris videoları boş bulundu;
  `generate-matrix-media.mjs` ile yeniden üretildi — bkz. değişiklik kaydı.)
- Pages duman testi (`/capcut` altında statik çıktı): ilk koşuda 1/4 kaldı. Sebep testin
  varsayımıydı: aramadan sihirbaza sayfa yüklenmeden geçilince yönlendirici `<head>` sırasını
  değiştiriyor ve test "politika etiketi charset'ten hemen sonra" sırasını o anda arıyordu.
  Politika sayfa yüklenirken uygulanır ve geçerliliğini korur; test artık sihirbazın kendi
  HTML'ini yükleyip onun politikasını denetliyor. Düzeltmeden sonra **4/4**.

## Güncelleme — 7 Ekim 2026: Sesi kapat, yapılamayan istekler, müzik uzunluğu

**Sesi kapat ve arama.** Yukarıda ilgili yerlere işlendi: kart ve sihirbaz ("Sihirbazlar"), kayıt
tablosu, kural 5 ve 7, üçüncü ölçüm tablosu. İlk bakışta doğru iş: ayarlanan tablo 74 / 74 →
139 / 139; eski bağımsız tablo 55 / 56 → 55 / 56 (aynı tek kaçak: "sadece bir bölümünü al"); yeni
bağımsız tablo 13 / 95 (eski kayıt) → 69 / 95 (ilk koşu) → 95 / 95 (düzeltmeden sonra).

**Müzik, indirilen videonun tamamının altında** (`web/src/domain/musicFit.ts`; şema değişmedi).

- *Kök neden.* `setMusicAsset` müziği eklendiği andaki birleşik kesit uzunluğu kadar seçiyordu
  (`max(0,1 sn, çıktı)`) ve bir daha dokunmuyordu. Kesit yokken çıktı 0 → 0,1 sn. "Videoyu indir"
  (kesitsiz tarif = bütün video) o 0,1 sn'lik seçimle kodluyordu.
- *Kanıt (kaydedilen dosya, ffmpeg ile çözülüp ölçüldü; 12 sn'lik video — sesi saniye başlarında
  2 ms'lik tık —, 220 Hz'lik müzik −12 dB):* düzeltmeden önce ton RMS'i ilk 0,1 sn'de 0,022,
  0,11 sn'den sonra ve sonraki 12 saniyenin her birinde 0,000; editördeki "Bitiş" alanı
  `00:00.100`. Düzeltmeden sonra 12 saniyenin 12'sinde 0,022; alan `00:12.000`.
- *Kural.* Müzik eklenince indirmenin tamamına **yayılır**: kesit yoksa bütün video, varsa birleşik
  kesitler; müzik dosyası kısaysa kendi sonunda biter (döngü yok; belge 15: müzik dosyası en çok
  10 dakika / 100 MiB, açılırken denetlenir). Sonu indirmenin sonunda olan müzik "yayılmış"tır ve
  kesitleri ya da videoyu değiştiren her komutta (`commands.ts` → `bump`) yeniden yayılır — aynı
  komutun içinde, yani **tek geri alma adımı**. Elle verilen aralık (sonu başka yerde) yayılmış
  değildir, dokunulmaz; kullanıcı sonu yeniden indirmenin sonuna koyarsa yine izler. Yayılmış
  müziğin yalnızca başlangıcı taşınırsa ("şarkı 0:30'dan başlasın", "5. saniyede girsin") sonu da
  taşınır (eskiden ilki "aralık ters" diye reddediliyordu). Kısalan seçime sığmayan geçişler
  kısaltılır.
- *Eski projeler.* Şema ve doğrulama aynı; kayıtlar ve yedekler aynen yüklenir, hiçbir şey
  dönüştürülmez. Eski kuralın bıraktığı 0,1 sn'lik seçim (kesit yok, baştan, 0,1 sn) "seçilmemiş"
  sayılır: açılırken (`healLegacyMusic`) ve ilk kesit değişikliğinde yayılır. **Dürüst not:**
  kesiti olmayan bir kayıt bugün zaten yüklenmiyor (boş kesit listesi kayıt doğrulamasından
  geçmiyor — bu işte bulunan ayrı bir hata, ayrı iş olarak işaretlendi), dolayısıyla açılıştaki
  onarım o hata giderilince işe yarar. Kesitli eski projede müzik aralığı olduğu gibi kalır;
  yalnızca tam indirmenin sonunda bitiyorsa sonraki kesit değişikliğinde izlemeye başlar.
- *Sihirbaz.* "Müzik ekle"nin bütün videoyu tek kesit yapan dolanması kaldırıldı
  (`musicUnderVideo`): sihirbaz da kesitsiz tarifle indiriyor; editöre geçince kesit listesi boş.
- *Testler.* `musicFit.test.ts` (23), `taskRecipes.test.ts`; e2e `music-length.spec.ts` (kaydedilen
  dosyada saniye saniye ton: kesitsiz 12 / 12; iki kesit 7 / 7 ve tek geri alma adımı; elle aralık
  korunur: 9 saniyenin yalnız ilk 2'si); `wizards.spec.ts` müziği 8 saniyenin 8'inde arıyor; matris
  satırı **M16b** (12 sn sessiz video + 10 sn WAV, kesit yok: 0,5 / 4,5 / 8,5. sn'de aynı seviye,
  10,8. sn'de yok).

**Doğrulama (7 Ekim 2026, masaüstü, ölçüm kilidi altında; gerçekten çalıştırılanlar).** `npx tsc
--noEmit -p .` ve `npx eslint .` temiz; `npx vitest run` **948 / 948** (58 dosya); tam e2e
(`CLIP_TEST_HOOKS=1` derlemesi, `E2E_PORT=3351`, Playwright Chromium) **287 geçti, 4 atlandı, 0
başarısız**, 16,4 dk (atlananlar: 2 isteğe bağlı sessizlik ekran görüntüsü, 2 gerçek model testi
— model dosyaları bu klasörde yok); Pages duman testi (CI'ın ortam değişkenleriyle statik derleme,
port 3104) **4 geçti, 2 atlandı** (ikisi de model dosyası istiyor: **koşulmadı**); matris
(`run-matrix.mjs`, olağan derleme, sunucu 3353'te — 3100 başka işlerle paylaşıldığı için)
Chromium **29/29**, Chrome **29/29**, Edge **29/29** PASS. Ekran görüntüleri: `shots/01-home-*` … `05-*` yenilendi, `75-sesi-kapat-*` eklendi
(360 / 390 / 1440). **Koşulmayanlar:** telefon (adb kullanılmadı), gerçek kayıt koşucusu
(`run-real-media.mjs`), Firefox / WebKit matrisi (eski sonuçlar duruyor), gerçek model testleri.


## Güncelleme — 10 Ekim 2026: arama kuralları (ekler, çiftler, olumsuz fiil), dürüst ölçüm

**Bulgu (kalite raporu, 10 Ekim):** ayrı tutulan 240 ifadede on istekten birine başka iş yapan, "Başla"
düğmeli bir kart öneriliyordu. En pahalıları ters işe götürenlerdi ("sesi kapa" → Sesini al).

**Ne değişti (`web/src/domain/taskSearch.ts`, `turkishSuffix.ts`, `tasks.ts`).** Kelime listesi büyütmek
yerine kurallar; "Yazarak bulma: eşleştirme kuralları" bölümündeki sıra dosyanın başında güncel hâliyle yazılı:

- **Türkçe ekler.** Bir kelime, gerçek bir ekle uzadığında o kelimedir ("sesini" ← "ses", "kesebilir
  miyim" ← "kes", "müziği" ← "müzik": sondaki k/p/t yumuşaması; "ekliyorum" ← "ekle": ünlü daralması).
  Aynı harflerle başlayan başka kelime değildir: "kesinlikle" Kes, "dikkat" Dikey yap, "netflix" İyileştir
  değildir. İki kalıp (isim: çoğul, iyelik, hâl; fiil: çatı, yeterlik, olumsuzluk, zaman + kişi ya da
  fiilimsi); yapım ekleri (-lik, -li, -siz) bilerek yok. Bir çözümleyici değildir: "kal-i-te" gibi tesadüfleri
  kabul eder.
- **Yarım kelime yalnızca son kelimedir**; iki harfle arama yalnızca kutuda başka bir şey yokken başlar.
- **Çiftler: neye ne yapıldığı.** "ses" + "kapa / olmasın / istemiyorum / yok" = Sesi kapat; "ses / müzik /
  şarkı" + "al / kaydet / indir" = Sesini al; "müzik / şarkı" + "ekle / koy / çalsın" = Müzik ekle;
  "sessiz / boş" + "yer / kısım / an" = Boşlukları at. İki yönde, ekleriyle, niyet taşımayan kelimeler
  (zarflar, zamirler) aradan çıkarıldıktan sonra yan yana; olumsuzluk yanındaki kelimeye aittir ("sadece
  sesi lazım, görüntü olmasın" Sesini al'dır).
- **Olumsuz fiil.** "açamıyorum / açılmadı / oynamıyor / izleyemiyorum" = Her yerde açılsın;
  "gönderemiyorum / atamadım / sığmadı / gitmiyor" = Küçült — kişi ve zaman tek tek listelenmeden.
- **Geri çekilen kelime.** "çevir / dönüştür / convert" bir şeyin bir şeye çevrileceğini söyler, neye
  olduğunu yanındaki kelime söyler: tek başına ya da "mp4" ile Her yerde açılsın; "mp3e çevir" Sesini al;
  "gife", "Türkçeye", "sağa" ile yapılamayan iş. "boyut / size" da böyledir ("tiktoka uygun boyut" Dikey yap).
- **Taban.** Dört ve daha çok kelimelik bir istekte tek bir destek kelimesine dayanan sonuç verilmez:
  "Bunu bulamadım." Tek GÜÇLÜ kelimeye taban uygulanmaz (denendi: bir yanlış kartı kaldırmak için üç doğru
  cevabı kaybediyordu).
- **Yazım hatası** beş harfli kelimede yalnızca eksik / fazla / yer değiştirmiş harftir; harf DEĞİŞMESİ
  altı harften itibaren sayılır ("yarın", "yayın" değildir).
- **Yapılamayan dört iş için dürüst kayıt** (`available: false`): internetten video indirme, bir siteye
  yükleme, ekranı ya da kamerayı kaydetme, canlı yayın. "youtubedan video indir" artık Dikey yap'ı değil
  "Bunu henüz yapamıyoruz."u bulur. Çıplak "indir" bu kaydın kelimesi değildir: "İndir" uygulamanın kendi
  düğmesidir.

**Ölçüm disiplini ve sayılar.** Ayar yalnızca `DEV` kümesinde (127 yeni ifade, kurallardan önce yazıldı)
ve görülmüş birim tablolarında yapıldı. Eski ayrı küme (`HELD_OUT`) **kirlenmiştir**: kaçanları bu işten önce
okundu. Bu yüzden iki yeni küme, aramanın kodunu, listelerini ve öteki ifadeleri **görmeyen** ayrı bir
yazara yazdırıldı; her biri bir kez ölçüldü:

| Küme | Durum | Sayılan | İlk sonuç doğru | Yanlış ama emin |
|---|---|---|---|---|
| `search-eval-fresh2.ts` (243 ifade) | **ayrı, bir kez ölçüldü — başlık** | 209 | %75,0 → **%81,8** | %19,6 → **%12,0** |
| `search-eval-fresh.ts` (178 ifade) | ilk turdan sonra bir kez ölçüldü (%77,2 → %81,5; %20,9 → %12,2), sonra kaçanları okundu: **artık ayar kümesi** | 139 | — | — |
| `HELD_OUT` (282 ifade) | **kirlenmiş** | 225 | %89,0 → %92,4 | %7,1 → %3,1 |
| `DEV` (175 ifade) | ayar kümesi | — | 135 → 167 / 175 | 37 → 7 kart |

("önce" = d1edd82'deki arama, aynı ifadelerde.) Yeni kümede öteki ölçüler: ilk üçte %81,1 → %85,8;
yapılabilen işe "yapamıyoruz" %4,1 → %2,0; "yapamıyoruz" yakalama %71,0 → %83,9, isabet %82,9 → %91,2;
listede olmayan isteğe dürüst cevap %70 → %80; uzun cümlelerde ilk sonuç %67,5 → %67,5 (değişmedi).

**Dürüst sonuç:** görmeyen bir yazarın ifadelerinde başka işe kart oranı beşte birden sekizde bire indi,
ama bütçenin (≤ %5) iki katından fazla. İki tur aynı yerde durdu (%12,2 ve %12,0): kelime ve kural
temelli aramanın bu tür ifadelerdeki sınırı buna yakın görünüyor. Uzun, hikâye anlatan cümleler ("…
dedem de anlasın diye lazım") hiç iyileşmedi; onlar anahtar kelime taşımıyor. Görülmüş tablolar bozulmadı
(70 / 70 — önce 69 —, 92 / 95, 60 / 60; beklentileri değişmedi).

**Kurucuya:** %5 hedefi için ya gerçek kullanıcı ifadeleriyle büyüyen bir ayar kümesi (bugünkü kümeleri
yazanlar kullanıcı değil), ya da cihazda çalışan küçük bir anlam modeli gerekir; ikisi de bu işin dışında.
Yeni kümenin kaçanları raporda yazılıdır: o küme de artık görülmüş sayılır.

## Güncelleme — 11 Ekim 2026: emin değilken "Bunu mu demek istedin?" (kural 12)

**Bulgu.** İki ayrı görmeyen kümede arama sekiz istekten birine başka iş yapan tek bir kart gösteriyordu
(%12,2 ve %12,0); kelime listesi ve ek kuralları bunu aşağı çekemedi. **Karar (kurucu onayı, 11 Ekim):**
kural yığmak yerine sunuş değişti. Sıralama aynı kaldı; arama artık ilk satırın **cevap** mı, yoksa
**seçeneklerden biri** mi olduğunu ayrıca söylüyor.

### Eminlik kuralı (`confidenceOf`, `web/src/domain/taskSearch.ts`)

Arama, en iyi eşleşmenin arkasında ne durduğunu sayar (`SearchEvidence`): isteğin anlam taşıyan kaç
kelimesini açıkladığı (kendi kelimeleri, deyimi, çifti), açıkta kalan kelimeler (başka bir işin bildiği
ya da kimsenin bilmediği) ve sıradaki işin puanı. Cevap **emin** sayılır, yalnızca:

- arkasında **iki ya da daha çok kelime** varsa ve sıradaki işin puanı onun %80'inin altındaysa — isteğin
  iki ya da daha çok kelimesi açıkta kalıyorsa %50'sinin altındaysa; ya da
- arkasında **tek kelime** varsa ve o kelime isteğin tamamıysa (güçlü bir kelime ya da yazılmakta olan
  kelime; puan ≥ 2, sıradaki iş %80'in altında); ya da
- arkasında tek kelime varsa, **yalnızca bir** kelime açıkta kalıyorsa, kelime işin kendi adıysa (puan 3)
  ve sıradaki iş yarısının altındaysa.

Öbür her durumda arama **sorar**. "Bunu henüz yapamıyoruz." cevabı hiçbir zaman soruya çevrilmez.
Dayanak, görülmüş dört kümedeki sayım (DEV, HELD_OUT, iki eski "yeni" küme; 878 ifade): iki ya da daha çok
kelimeye dayanan ilk satır yaklaşık 60'ta bir yanlış işti; tek kelimeye dayanıp başka kelimeleri açıkta
bırakan ilk satır dörtte bir.

### Ekran (`web/src/components/home/TaskFinder.tsx`)

Yeni bir yerleşim yok; aynı sonuç satırları. Önce / sonra görüntüleri:
[docs/ux/2026-10-11-did-you-mean](../ux/2026-10-11-did-you-mean/README.md).

| | Emin (değişmedi) | Emin değil |
|---|---|---|
| İlk satır | seçili | **hiçbiri seçili değil** |
| Başlığın altı | — | "Tam emin olamadım. Hangisini istiyorsan ona bas." |
| Satırlar | en iyinin %40'ı ve üstü, en çok 3 | çalışan işler için %25'i ve üstü (daha çok seçenek), en çok 3; her satırda işin bir satırlık açıklaması |
| Listenin altı | "Tüm işleri gör" | "Aradığın bunlardan biri değilse başka kelimelerle dene ya da bütün işlere bak." + "Tüm işleri gör" |

**Enter ne yapar.** Emin cevapta ilk (seçili) satırı başlatır — eskisi gibi. Seçeneklerde **hiçbir şey
başlatmaz**: odak ve yazı kutuda kalır, canlı bölge "Hiçbiri seçili değil. Önce aşağı okla birini seç."
der, başlığın altındaki cümle vurgulanır. ↓ ilk seçeneği, ↑ son seçeneği seçer; seçildikten sonra Enter
onu başlatır. Fareyle üzerine gelmek seçeneklerde satırı yalnızca aydınlatır, seçmez (Enter, fare listenin
çıktığı yerde duruyor diye bir işi başlatmamalı); dokunmak ya da tıklamak satırı başlatır. Yazmaya devam
edilince seçim sıfırlanır. Ekran okuyucu: kutu yine bir combobox, liste yine bir listbox; seçenek yokken
`aria-activedescendant` yoktur ve durum cümlesi "Emin olamadım. 2 seçenek var. Aşağı okla birini seç, sonra
Enter'a bas." olur. Telefonda klavyenin "git" tuşu Enter'dır: aynı davranış.

**Tek aday.** Aday tek ise liste tek satırdır (soru yine sorulur, Enter yine başlatmaz). "2–3 seçenek"
her zaman tutmaz; payı aşağıda.

### Ölçüm

**Temizlik.** Kural yalnızca görülmüş kümelerde ayarlandı ve `fd6ce81`'de donduruldu. Sonra, kendisine
YALNIZCA işlerin listesi ve birer satırlık açıklamaları (ve yapılamayanların listesi) verilen bir yazar
280 ifade yazdı (`search-eval-fresh3.ts`); kodu, kelime listelerini, eşikleri ve öteki ifadeleri görmedi.
Çıktısı, yalnızca sayım basan bir betikle dosyaya çevrildi; ölçümden önce ifadeleri kimse okumadı. Ölçüm
bir kez yapıldı ve ondan sonra arama koduna dokunulmadı. Daha eski bir kümede ya da ayar tablosunda
bulunan 78 ifade sayılmadı (çoğu kısa, açık ifadeler: sayılan 202 ifade yazılandan zordur).

| Ölçü (yeni kör küme, 202 ifade; 148'i yapılabilen iş) | Önce (`dd0301b`) | Sonra |
|---|---|---|
| **Yanlış ama emin** — tek cevap, yanlış iş (bütçe ≤ %5) | %12,4 (25 kart) | **%3,0** (6 kart) |
| Tahmin etmek yerine sordu (bütün ifadelerde) | — | %25,2 (51 kez; 16'sında tek seçenek) |
| Yapılabilen işlerde sorma oranı (bütçe ≤ %33) | — | %29,7 |
| Sorduğunda doğru iş seçeneklerde (bütçe ≥ %80) | — | %88,6 (44 sorunun 39'u) |
| Açık yazılmış isteğe ("kolay") soru (bütçe ≤ %15) | — | %5,6 (18 ifadeden 1'i) |
| Doğrudan doğru (tek cevap ve doğru iş) | %75,7 | %54,1 |
| Doğru işe yeniden yazmadan varıldı | %75,7 | %80,4 |
| İlk satır doğru iş (bütçe ≥ %85) | %75,7 | %75,7 (sıralama değişmedi) |
| İlk üç satırda var (bütçe ≥ %90) | %79,1 | %80,4 |
| Yapılabilen işe "Bunu bulamadım." | %12,2 | %12,2 |
| "Yapamıyoruz" yakalama / isabet (bütçe ≥ %95) | %88,0 / %88,2 | %88,0 / %88,2 |
| Listede olmayan isteğe dürüst cevap (bütçe ≥ %80) | %65 | %65 (20 ifadenin 3'üne hâlâ tek kart, 4'üne soru) |

**Kirlenmiş kümeler — başlık DEĞİL** (kural bunlara bakılarak ayarlandı): `search-eval-fresh2.ts` yanlış
ama emin %12,0 → %1,0, sordu %27,8; `search-eval-fresh.ts` → %0, sordu %13,7; `HELD_OUT` %3,1 → %0,9, sordu
%11,6; `DEV` (ayar tablolarında olmayan 85 ifade) → %0, yapılabilen işe soru %12,5.

**Dürüst okuma.**

- Bedel açık: doğrudan doğru cevap dörtte üçten yarının biraz üstüne indi. Kullanıcı yaklaşık dört
  istekten birinde bir soruyla karşılaşıyor; sorulduğunda dokuz kez sekizinde doğru iş karşısında.
  "Yeniden yazmadan doğru işe varma" %75,7'den %80,4'e çıktı; yanlış işe **gönderilme** dörtte bire indi.
- **Arama hâlâ beş istekten birinde doğru işi hiç göstermiyor** (ilk üçte %80,4; %12,2'sine "Bunu
  bulamadım"). Sunuş bunu düzeltmez; "ilk satır" ve "ilk üç" bütçeleri bu kümede de aşılıyor. Uzun
  cümlelerde doğrudan doğru %35 (40 ifade), "Yazıya dök" isteklerinde %15 (13 ifadenin 2'si).
- Üçüncü bağımsız kümede eski aramanın "yanlış ama emin" oranı yine %12 çıktı (%12,2, %12,0, %12,4):
  o sayı sağlam bir ölçümdü.
- Yeni dört bütçenin değerleri (≤ %33, ≥ %80, ≤ %15, DEV ≤ %15) ölçümle aynı oturumda yazıldı; ilkeden
  seçildi ama ölçümü görmeden değil. `DEV` bütçesi önce bütün `DEV` ifadeleri üzerinden hesaplanan %8,9'a
  göre ≤ %12 yazılmıştı; raporun saydığı (ayar tablolarında olmayan) 64 ifadede oran %12,5 çıktı ve bütçe
  bu sayıya göre ≤ %15 olarak düzeltildi — yeni bir bütçenin ilk değeri, gevşetme değil; yine de söylenmeli.
- Yapılabilen bir işi isteyen 55 "kolay" ifadenin 37'si daha önceki bir kümede ya da ayar tablosunda da
  bulunduğu için sayılmadı: "açık isteğe soru" 18 ifadeye dayanıyor (bir ifade 5,6 puan).
- Yeni kümenin kaçanları raporda yazılıdır: bir sonraki arama çalışması dördüncü bir küme yazdırmalı.

**Testler.** Birim: `web/tests/unit/taskSearchConfidence.test.ts` (kanıt sayımı, kural, her kart adı ve
örnek cümlenin emin cevap olması, "yapamıyoruz"un soruya dönmemesi). E2E: `home.spec.ts` (seçenek ekranı,
Enter'ın başlatmaması, okla seçip başlatma, fare, tek seçenek, emin cevabın eskisi gibi kalması),
`a11y.spec.ts` (seçenek ekranında axe, 320 / 640 px'te taşma yok, klavye yürüyüşü). Eski ayrı tabloların
beklentilerine dokunulmadı (69–70 / 70, 92 / 95, 60 / 60: sıralama değişmedi).

**Kurucuya.**

1. Emin cevabın başlığı da "Bunu mu demek istedin?" (3 Ekim'den beri). İki durumu ayıran seçili satır ve
   alttaki cümle. Emin durumda başlık "Bunu buldum" olursa ayrım güçlenir — "emin eşleşme bugünkü gibi
   kalsın" dendiği için dokunulmadı.
2. Dört istekten birine soru sormak çok mu? Eşikler `taskSearch.ts`'in sonunda beş sabit; gevşetmek yanlış
   kartı, sıkılaştırmak soruyu artırır.
3. Aramanın asıl eksiği artık "doğru işi hiç bulamamak" (beşte bir): kelime listesiyle iki turda
   düzelmedi; gerçek kullanıcı cümleleri ya da cihazda küçük bir anlam modeli gerekir.

## Ek, 13 Ekim 2026 — internette yazılan yazı editöre geçişte saklanır

> Kurucu kararı (13 Ekim 2026): **"Bulut yazısı editöre geçişte saklansın."**
> İlgili: [ADR-043](ADR-043-speakers-in-recipe.md) "Bulunan" (bu ek onu kapatır),
> [ADR-039](ADR-039-cloud-transcript-route.md) (bulut yolu; varsayılan derlemede hâlâ **kapalı**),
> [ADR-012](ADR-012-w3-local-persistence.md) (tek kayıtlı proje; silinen proje geri yazılmaz).
> Şema (EDL v5), kayıt biçimi (`ProjectRecord` v1) ve politika (belge 15, `policy.ts`) **değişmedi**.
> Hiçbir dış hizmete istek gitmedi: bulut sınamaları yalnızca yerel sahte vekile (`cloud/fake-worker`) karşı.

### Neden

Bu ADR'nin kuralı "sihirbaz proje saklamaz; ondan açılan editör de saklamaz" idi. Bulut yolu yalnızca
"Yazıya dök" sihirbazında olduğu için, kullanıcının davet dakikası harcadığı, sesini başka bir şirkete
gönderdiği ve beklediği yazı sayfa yenilenince **tamamen** gidiyordu; tek kalıcı yol yedek dosyasıydı
(indir → `/editor`'de geri yükle).

### Karar

**Tek istisna:** tarif internette yazılmış bir yazı taşıyorsa, "Daha fazla ayar → editörde aç" ile açılan
editör **kayıtlı projedir**. Öbür dokuz sihirbaz ve "Kes" için bu ADR aynen geçerli: saklamazlar.

Yeni bir saklama kavramı yok: aynı depo, aynı anahtar (`p_local_001`), aynı kayıt, aynı otomatik kayıt
(`useProjectPersistence`). Eklenen tek şey kancanın `adopt` seçeneği: depodaki kayıt editöre **yüklenmez**,
eldeki tarif onun yerine **hemen** yazılır (500 ms beklemeden — kullanıcıya az önce "kalır" dendi).

### Geçişte ne olur

Kural saf bir fonksiyon: `web/src/domain/wizardHandoff.ts` → `handoffAction(keep, probe)`.

| Depoda ne var | Ne olur | Kullanıcı ne okur |
|---|---|---|
| Hiçbir şey | Soru yok. Editör açılır, proje hemen saklanır. | Başlıkta "Düzenleme saklandı · saat" (editörün her zamanki göstergesi) |
| Yalnızca açılmış bir video (kesit, satır, müzik, ad yok — ADR-012 ekinin "kesitsiz kaydı") | Soru yok; o kaydın yerine bu proje yazılır. `/editor` de aynı durumda başka video açılınca sormadan değiştirir. | Aynı |
| **Üstünde çalışılmış bir proje** (en az bir kesit, altyazı / yazı satırı, müzik ya da proje adı) | **Hiçbir şey yazılmaz; sorulur.** | Aşağıdaki pencere |
| Okunamayan depo (gizli pencere, engel, dolu) | Editör açılır; yazma denenir ve reddedilir. | "Düzenleme saklanamadı · neden" + "Yedek dosyasını indir" |
| Daha yeni bir derlemenin kaydı | Editör açılır; kayıt açılmaz ve üstüne **yazılmaz** (ADR-043 Karar 3). | "Düzenleme saklanamadı · Bu proje daha yeni bir sürümle saklanmış. Sayfayı yenile. Bu sayfada yaptıkların saklanmaz." |
| Bozuk kayıt (proje olarak okunamıyor) | Yerine bu proje yazılır — `/editor`'ün bugünkü davranışı. | "Düzenleme saklandı" |

**Soru penceresi** (var olan `Dialog`; yeni düzen kavramı yok; `CloudKeep.tsx`):

> **Saklanan bir projen var**
> Saklanan proje: *tatil.mp4* (proje adı; yoksa videosunun dosya adı)
> Bu tarayıcıda yalnızca bir proje saklanabilir. Hangisi kalsın?
> [ Eski proje kalsın (bu yazı saklanmaz) ]  [ Bu yazı saklansın (eski proje silinir) ]
> Vazgeçersen hiçbir şey değişmez. Yazıyı “Metni indir” ile dosya olarak da alabilirsin.

- **Eski proje kalsın:** editör bugüne kadarki gibi saklamadan açılır; başlık "Bu düzenleme saklanmıyor"
  der; depoya dokunulmaz (okunmaz, yazılmaz).
- **Bu yazı saklansın:** eski kaydın yerine bu proje yazılır; başlık "Düzenleme saklandı".
- **Vazgeç** (× ya da Esc): sonuç ekranına dönülür; depo ve yazı olduğu gibi.

**Neden `window.confirm` değil?** Editörün "zaten bir iş var" kalıbı bir onay kutusudur
(`sources.replaceWarning`: "Yeni bir video seçersen kesitlerin ve altyazıların silinir. Devam edilsin mi?").
Orada "İptal" hiçbir şey kaybettirmez. Burada üç sonuç var (eskisi kalsın ve saklamadan devam et / yerine
geç / vazgeç) ve "Tamam / İptal" ikisini adlandıramaz; kullanıcı editöre yalnızca eski projesini silerek
girebilirdi. Bu yüzden iki düğmesi de ne yaptığını ve bedelini söyleyen düz bir seçim yazıldı. Kalıbın
**eşiği** editörünkiyle aynı tutuldu: yalnızca kaybedilecek iş varsa sorulur.

### Sonuç ekranı ne der

Geçişten **önce** yazı saklanmış değildir ve ekran bunu söyler (sabah yalnız bulut yolunda, akşamdan
beri her iki yolda — `wizard.yazi.keepNote`; yazı panelinin ve dosya düğmelerinin altında, ayrıca
"Altyazılı videoyu indir" bittikten sonra editör bağlantısının üstünde):

> Bu yazı henüz saklanmadı: editörde açarsan ya da metni indirirsen kalır, yoksa sayfa kapanınca gider.

Geçişten sonra editörün kendi göstergesi geçerlidir.

### Yenileme ve geri gelme

- Saklanan geçişte adres çubuğu, sayfa yüklenmeden `/editor` olur (`history.replaceState`; açık `File` bir
  sayfa yüklemesini atlatamaz). Kayıtlı proje orada yaşar: sayfa yenilenince sihirbazın "Videonu seç"i
  değil **editör** açılır.
- Editör projeyi geri getirir ve **video dosyasını yeniden ister** (`RelinkPanel`: "Bu projenin videosu açık
  değil." + aranan dosyanın adı). Tarayıcı bir `File`'ı oturumlar arası tutamaz ve kalıcı dosya izni
  (File System Access) kullanılmıyor (ADR-012 "Bilinen sınırlar"): hatırlanan bir dosya yoktur, her
  dönüşte dosya yeniden seçilir. Aynı dosya seçilince yazı ve "1. kişi / 2. kişi" yerindedir.
- Sonradan dönmek: açılış ekranı → "Kendim düzenleyeceğim" → aynı proje.
- "Eski proje kalsın" seçilmişse adres değişmez; yenileme sihirbazı açar ve yazı gider (başlık bunu söylemişti).

### Silme

Var olan proje silme: editör dosyayı istediğinde "Kayıtlı projeyi sil" (onay). Kayıt silinir ve o sekmede
geri yazılmaz (ADR-012 eki, 10 Ekim); sınama, silmeden sonra beklemeyle ve yenilemeyle deponun boş
kaldığını doğrular. Video açıkken editörde ayrı bir "projeyi sil" düğmesi yoktur — var olan sınır, bu işte
eklenmedi.

### Cihazda yazılan yazı: **kapsam dışı bırakıldı** (kurucu kararı) — aynı akşam geri alındı, aşağıda "Ek 2"

> Bu bölüm sabahki durumu anlatır; akşam kurucu "cihazda yazılan yazı da saklansın" dedi ve aşağıda
> sayılan her sonuç (yayındaki derleme, gizlilik metni, olağan e2e) o ek'te üstlenildi.

Cihazda yazılan yazı da sihirbazda aynı biçimde yenilemede gider. Aynı kod yolu onu da saklayabilirdi,
ama bu **yayındaki** (bulut yolu kapalı) derlemenin davranışını değiştirir:

- "Yazıya dök → editörde aç" bugün saklamaz; saklamaya başlarsa `/editor`'deki kayıtlı projeyle çakışır ve
  yukarıdaki soru penceresi yayındaki sitede de çıkar (yeni bir ekran);
- yayındaki gizlilik metni ("ana ekrandaki bir işten başlattığın çalışma saklanmaz") ve veri envanteri §2.7
  yanlış olur;
- olağan e2e, sihirbazdan açılan editörün saklamadığını bekler (`wizards.spec.ts`, `a11y.spec.ts`:
  "Bu düzenleme saklanmıyor"); yazı sihirbazının geçişini yürüyen sınamalar buna göre yeniden yazılmalı olurdu.

Kurucunun cümlesi bulut yazısını kapsıyor; bu yüzden değişiklik **yalnızca bulut yazısı** için yapıldı ve
bütünüyle bulut derlemesinin içinde kaldı (`CloudKeep` parçası ve sözleri, yolun kendisiyle aynı derleme
sabitinin arkasında; varsayılan dışa aktarmada yoklar). Bulut derlemesinde cihazda yazılan yazı da
eskisi gibi saklanmadan geçer (sınandı). İstenirse aynı kural tek satırla açılır (`keepsOnHandoff`).

### "İnternette yazıldı" etiketi: **saklanmıyor** (bilerek)

Tarif, yazının nerede yazıldığını tutmuyor (ADR-043 Karar 5); tutması yeni bir şema alanı ister ve bu işte
şema değişmedi. Sonuç: editöre geçince ve yenilemeden sonra aynı iz "Otomatik yazıldı — yanlış olabilir"
diye görünür; "İnternette yazıldı" yalnızca sihirbazın sonuç ekranında ve oradan indirilen metin dosyasının
ilk satırındadır. Kayıtlı projeden yazının bir sunucuda yazıldığı anlaşılmaz.

### Gizlilik

Yeni saklanan **tür** yok (proje kaydı zaten vardı); yeni olan, bir sihirbazın işinin o kayda girebilmesi.
`/gizlilik` (yalnız bulut derlemesinde) ve veri envanteri §8.4a aynı değişiklikte güncellendi: yazının
önce yalnızca açık sayfada durduğu, editörde açılınca bu tarayıcıda proje olarak saklandığı (satırların
metni ve kim konuştuğu), önceki proje varsa sorulduğu, nasıl silindiği. Varsayılan derlemenin metni
değişmedi ve orada doğrudur.

### Kod

| Dosya | Ne |
|---|---|
| `web/src/domain/wizardHandoff.ts` | Kural: `handoffAction`, `storedProjectHasWork`, `storedProjectName` |
| `web/src/components/transcript/KeepOnHandoff.tsx` (sabah `CloudKeep.tsx`, yalnız bulut derlemesi; akşam her derlemeye taşındı — Ek 2) | Depoya bakar; gerekirse soru penceresi |
| `web/src/components/wizard/YaziWizard.tsx` | Satırı olan bir yazı varken editör bağlantısını `KeepOnHandoff`'a yönlendirir; sonuç cümlesi |
| `web/src/components/wizard/TaskWizard.tsx`, `WizardFlow.tsx` | `onOpenEditor({ stored })`; adres `/editor`; `editorNote` |
| `web/src/components/editor/useProjectPersistence.ts`, `EditorApp.tsx` | `adopt`: depodakini yükleme, eldekini hemen yaz |
| `web/src/i18n/messages*.ts` (`wizard.yazi.keep*`; sabah `cloudMessages*.ts` içindeydi), `PrivacyPage.tsx` | Sözler (TR + EN), gizlilik |

### Sınamalar (13 Ekim 2026, dal `worktree-agent-a2b52e38355c6d5f7`; hepsi yerel, son kodla)

| Ne | Sonuç |
|---|---|
| `tsc --noEmit`, `eslint .` | hatasız |
| Birim (vitest) | **1418 / 1418** (82 dosya; 12'si yeni `wizardHandoff.test.ts`: kural tablosu, "iş" eşiği, kimin saklama isteyebildiği, sözler, gizlilik) |
| e2e, olağan derleme (yol **kapalı**; `CLIP_TEST_HOOKS=1`) | 395 sınama: **391 geçti, 4 atlandı, 0 başarısız** — sayı ve sınamalar değişmedi. Kendiliğinden kurtarma gerektiren yükleme **0** (`PAGE-RECOVERED-TOTAL 0`, `PAGE-DEAD-TOTAL 0`; bekçinin kendi sınamaları bilerek 9 kurtarma, 2 ölü sayfa yaptı) |
| e2e, bulut derlemesi, yerel sahte Worker'a karşı | 58 sınama: **54 geçti, 4 atlandı** (ekran görüntüsü betikleri), 0 başarısız; `PAGE-RECOVERED-TOTAL 0`, `PAGE-DEAD-TOTAL 0`. 11'i yeni (`cloud-keep.spec.ts`): geçiş → saklandı → yenileme → yazı ve konuşanlar; editör hiç açılmazsa depo boş; indirmeden sonra cümle; soru penceresi ve "Vazgeç"; "Eski proje kalsın"; "Bu yazı saklansın"; kesitsiz kayıt sorulmadan; silme ve geri gelmeme; kullanılamayan depo; cihazda yazılan yazı saklanmadan; gizlilik sayfası. `cloud-speakers.spec.ts` yeni yolu yürür (yedek dosyası artık başka bir tarayıcıda açılır) |
| Durağan çıktı, varsayılan (`STATIC_EXPORT=1`, `/capcut`) | derlendi; `apply-csp` bulut denetimi geçti; çıktıda yeni sözler yok (yalnızca bir sınama kimliği: `yazi-cloud-keep-note`) |
| `npm run quality` | 643 ölçü: **566 bütçe içinde, 8 dışında** (yedi arama ölçüsü ve `out.notFaststart`; hepsi önceki koşulardaki açık maddeler), 5 ölçülemedi (model dosyaları yok), 64 bütçesiz. "Kim konuştu" tablosu yeni yolla: masaüstü ve telefonda her adım 4 / 4, SRT 0. Bulut yazı ekranı 110 → 122 kelime (bütçe ≤ 180). Dört ekran tabanı yenilendi (eklenen cümle; `docs/quality/bulgular.md`) |
| **Koşulmayan** | Pages duman sınaması, tarayıcı matrisi, `cloud/` altındaki sınamalar (o kod değişmedi), gerçek telefon, gerçek Worker ve sağlayıcı |

İlk koşuda yeni sınamalardan biri **kendisi** kırıldı ("Bu yazı saklansın": "Yazı" sekmesi açıkken görünmeyen
kesit sayacını okuyordu); sınama düzeltildi, uygulama kodu o koşular arasında bu nedenle değişmedi.

### Doğrulanmayanlar

- **Gerçek sağlayıcı / gerçek Worker:** yok; yalnızca yerel sahte vekil.
- **Gerçek telefon, Safari, Firefox:** denenmedi. Bulut e2e'si yalnız masaüstü Chromium; telefon görünümü
  yalnızca kalite katmanının yürüyüşünde (Chromium, telefon boyutu) geçti. Soru penceresi telefon
  boyutunda ayrıca sınanmadı.
- **Adresin `/editor` olması** yalnızca `next start` ile (bulut e2e'si ve kalite yürüyüşü) görüldü. Durağan
  dışa aktarmada ve GitHub Pages'te (`/capcut` taban yolu, sonda `/`) yalnızca kod okunarak: taban yolu
  `BASE_PATH`'ten eklenir, sondaki `/` o anki adresten alınır. Bulut yolu açık bir durağan çıktı bu işte
  üretilip sınanmadı; Pages duman sınaması bu yolu yürümez (yayındaki derlemede yol kapalı).
- **Ekran okuyucu:** soru penceresi var olan `Dialog`'u kullanır (odak tuzağı, Esc, başlıkla adlandırma);
  gerçek ekran okuyucuyla denenmedi, bulut derlemesinde axe koşusu eklenmedi.
- **İki sekme:** depoya bakma ile yazma arasında başka bir sekmenin proje saklaması (son yazan kazanır —
  ADR-043'te yazılı, şemadan bağımsız var olan davranış) sınanmadı.
- **Depolama kotası** dolduğunda gerçek davranış (kod yolu var, tetiklenmedi — ADR-012'deki açık madde).

### Kurucu kararları gerekiyor

1. ~~**Cihazda yazılan yazı** da editöre geçişte saklansın mı?~~ — Aynı akşam **evet** dendi ve yapıldı
   (aşağıda "Ek 2").
2. **Soru penceresinin sözleri** ve hangi düğmenin vurgulu olduğu (bugün: "Bu yazı saklansın" vurgulu).
3. **"İş" eşiği:** yalnızca açılmış bir videonun kaydı sormadan değiştiriliyor (editörün kendi davranışı).
   Her kayıt için sorulsun istenirse tek satır.
4. **"İnternette yazıldı" etiketi kalıcı olsun mu** (ADR-043 madde 5; şema eklemesi).
5. **Video açıkken "projeyi sil"** düğmesi: bugün silme yalnızca dosya yeniden istenirken görünür.
6. **Adresin `/editor` olması:** yenileme editörü açsın diye. İstenmezse geri alınır; o zaman yenileme
   sihirbazı açar ve proje açılış ekranındaki "Kendim düzenleyeceğim"den bulunur.
7. **Birden çok proje** saklamak (bu sorunun asıl çözümü; ADR-012 "Bilinen sınırlar").

## Ek 2, 13 Ekim 2026 akşamı — cihazda yazılan yazı da editöre geçişte saklanır

> Kurucu kararı (13 Ekim 2026, akşam): **"Evet: cihazda yazılan yazı da geçişte saklansın."**
> Sabahki ek'in 1. açık sorusunun cevabı. İlgili: [ADR-036](ADR-036-on-device-transcript.md) (cihazda
> yazıya dökme; kısa ek), [ADR-039](ADR-039-cloud-transcript-route.md). Şema, kayıt biçimi ve politika
> yine **değişmedi**; hiçbir dış hizmete istek gitmedi (bulut sınamaları yerel sahte vekile karşı).

### Karar

"Yazıya dök"ün yazısı, **nerede yazılmış olursa olsun**, "Daha fazla ayar → editörde aç" ile açılan
editörde **kayıtlı projedir**. Yayındaki (bulut yolu kapalı) derleme de artık böyle davranır. Öbür dokuz
sihirbaz ve "Kes" için bu ADR aynen geçerli: saklamazlar (sınandı: `transcript-keep.spec.ts` "Kes",
`wizards.spec.ts`).

Kural sabahkiyle aynı (`handoffAction`); değişen tek şey sihirbazın kuralı **ne zaman** çağırdığı:
`keepsOnHandoff = transcript !== undefined && hasLines` (`YaziWizard.tsx`). Sabah "bulut yazısı varken"
idi. **Satırı olmayan yazı** (hiçbir şey yazılamadı) saklanmaz: saklanacak bir şey yok, geçiş öbür
sihirbazlarınki gibi saklamadan olur ve cümle görünmez (sınandı). Bu, sabahki bulut davranışından küçük
bir fark: o zaman satırsız bulut yazısı da saklanırdı; şimdi ikisi de saklanmaz.

### Yayındaki derlemede geçişte ne olur

| Depoda ne var | Ne olur | Kullanıcı ne okur |
|---|---|---|
| Hiçbir şey | Soru yok; editör açılır, proje hemen saklanır; adres `/editor` | "Düzenleme saklandı · saat" |
| Yalnızca açılmış bir video (iş yok) | Soru yok; o kaydın yerine bu proje yazılır | Aynı |
| Üstünde çalışılmış bir proje | Hiçbir şey yazılmaz; sorulur ("Saklanan bir projen var") | Pencere: "Eski proje kalsın (bu yazı saklanmaz)" / "Bu yazı saklansın (eski proje silinir)" / Vazgeç |
| Okunamayan depo | Editör açılır; yazma reddedilir | "Düzenleme saklanamadı · neden" + "Yedek dosyasını indir" |
| Daha yeni derlemenin kaydı | Açılmaz, üstüne yazılmaz (ADR-043) | Başlık bunu söyler |
| Editör hiç açılmazsa | Hiçbir şey saklanmaz; yenileme yazıyı götürür | Sonuç ekranı: "Bu yazı henüz saklanmadı: editörde açarsan ya da metni indirirsen kalır, yoksa sayfa kapanınca gider." |
| Satır yok | Saklanmaz (öbür sihirbazlar gibi) | "Bu düzenleme saklanmıyor"; cümle yok |
| Kes, Dikey yap, … | Saklanmaz (değişmedi) | "Bu düzenleme saklanmıyor" |

### Bulut modüllerinden çıkarılanlar ("tek satır" iddiası doğrulandı mı?)

Sabahki ajan "tek satır (`keepsOnHandoff`)" demişti. Satır tek, ama **tek başına yeterli değildi**: soru
penceresi (`CloudKeep.tsx`) ve bütün sözleri (`cloud.keep.*`) bulut yolunun derleme sabitinin arkasında ve
`cloudMessages*.ts` içindeydi; varsayılan derleme onları atıyordu. Taşınanlar:

- `components/transcript/CloudKeep.tsx` → `KeepOnHandoff.tsx`: aynı parça, `translator('tr')` ile; bulut
  modülünden hiçbir şey almıyor (birim sınaması bunu kaynak üstünde denetler). `YaziWizard` onu derleme
  sabiti olmadan `lazyPart` ile yüklüyor; sınama kimlikleri `keep-choice`, `keep-choice-name`, `keep-old`,
  `keep-new`, `keep-cancel`, cümle `yazi-keep-note` (eski `cloud-keep*`, `yazi-cloud-keep-note`).
- `cloud.keep.note / title / body / named / old / new / hint / cancel` → `wizard.yazi.keepNote` ve
  `wizard.yazi.keep.*` (`messages.ts` + `messages.en.ts`, sözler aynı). `CloudApplied.keepNote` kalktı.
- Varsayılan durağan dışa aktarma: `apply-csp`'nin bulut denetimi geçer; çıktıda `cloud-keep` kimliği
  de kalmadı (aşağıda "Sınamalar").

### Gizlilik: önce → sonra

- `/gizlilik` "Proje tarifi" kartı (her derleme), TR: *"…ana ekrandaki bir işten (Kes, Dikey yap…)
  başlattığın çalışma saklanmaz."* → aynı cümle **+** *"Tek istisna “Yazıya dök”: çıkan yazıyı “Daha fazla
  ayar → editörde aç” ile açarsan o çalışma (satırların metni dahil) burada proje olarak saklanır; orada
  daha önce sakladığın bir proje varsa hangisinin kalacağı sana sorulur. Silmesi aşağıdaki gibi."* (silme:
  kartın kendi "Ne zaman silinir" satırı, "Kayıtlı projeyi sil"). EN aynı anlamda.
- Bulut derlemesinin ek cümlesi (`cloud.privacy.stored.project.extra`): *"Tek istisna: internette yazılan
  bir yazıyı…"* → *"İnternette yazılan yazı için de aynı: editörde açarsan satırların metni ve kimin
  konuştuğu burada saklanır; ses, davet kodun ve şirketin yanıtı saklanmaz."* ("tek istisna" artık kartın
  kendi cümlesinde; bulut cümlesi yalnızca fazladan ne saklandığını söylüyor.) "Yazı cihazında nerede durur"
  maddesi olduğu gibi doğru kaldı.
- Veri envanteri: üst not, §2.7, §2.8, §8.4a, §8.6.

### Sınamalar

(Bu ek'in sonundaki tablo, aynı değişiklikle son kodda koşulan sınamaların sonucudur; değişiklik
kaydında da aynı sayılar.)

(14 Ekim 2026, dal `worktree-agent-a52e453bcc58fbe27`, kod commit'i `fab30c5`; hepsi yerel, son kodla.)

| Ne | Sonuç |
|---|---|
| `tsc --noEmit`, `eslint .` | hatasız |
| Birim (vitest) | **1420 / 1420** (82 dosya; `wizardHandoff.test.ts` 14 sınama: kural tablosu her iki yol için aynı cevap, "iş" eşiği, kimin saklama isteyebildiği — `KeepOnHandoff` bulut modülünden bir şey almıyor, sözler her derlemenin tablosunda ve bulut sözü taşımıyor, gizlilik metni) |
| e2e, olağan derleme (yol **kapalı**; `CLIP_TEST_HOOKS=1`) | 407 sınama: **403 geçti, 4 atlandı, 0 başarısız** (önce 395 / 391; +12 yeni `transcript-keep.spec.ts`). `PAGE-RECOVERED-TOTAL 0`, `PAGE-DEAD-TOTAL 0` (bekçinin kendi sınamaları bilerek 9 kurtarma, 2 ölü sayfa). Yeni sınamalar betikli tanıyıcıyla: geçiş → saklandı → yenileme → yazı geri; editör hiç açılmazsa depo boş; indirmeden sonra cümle; soru penceresi, Esc ve "Vazgeç"; "Eski proje kalsın"; "Bu yazı saklansın"; kesitsiz kayıt sorulmadan; silme ve geri gelmeme; kullanılamayan depo; satırsız yazı saklanmaz; "Kes" saklamaz; gizlilik sayfası TR + EN. Var olan `transcript*.spec.ts`, `cloud-off.spec.ts`, `wizards.spec.ts`, `a11y.spec.ts` değiştirilmeden geçti (hiçbiri Yazıya dök için "saklanmıyor" beklemiyordu; depoları her sınamada boş başladığı için soru penceresi çıkmıyor) |
| e2e, bulut derlemesi, yerel sahte Worker'a karşı | 58 sınama: **54 geçti, 4 atlandı, 0 başarısız**; `PAGE-RECOVERED-TOTAL 0`, `PAGE-DEAD-TOTAL 0`. `cloud-keep.spec.ts` 11 sınama yeni kimliklerle; "cihazda yazılan yazı saklanmadan geçer" sınaması tersine döndü: bu derlemede de saklanır, vekile istek gitmez |
| Durağan çıktı, varsayılan (`STATIC_EXPORT=1`, `/capcut`) | derlendi; `apply-csp` bulut denetimi geçti; çıktıda `/v1/jobs`, `/v1/quota`, `AssemblyAI`, `cloud-keep`, `cloud.keep`, "İnternette yazıldı", "davet kodu" **yok**; yeni cümle, soru penceresi ve gizlilik cümlesi **var** |
| `npm run quality` | 643 ölçü: **564 bütçe içinde, 10 dışında**, 5 ölçülemedi, 64 bütçesiz. Sekizi önceki koşulardaki açık maddeler (yedi arama ölçüsü, `out.notFaststart`). İkisi yeni: telefon kısıtlamasında TBT, editör 268 ms ve sihirbaz (`/yap/dikey/`) 202 ms (bütçe ≤ 200). Aynı kodla üç tam koşuda editör 248 / 157 / 268 ms; bu işin ve öncekinin (`5911725`) sırayla üçer `--only=perf` ölçümü: editör 165 / 226 / 229 ve 228 / 186 / 171 ms. Bu işe bağlanabilen bir yavaşlama gösterilemedi, yokluğu da kanıtlanmadı (ayrıntı `docs/quality/bulgular.md`); bütçe gevşetilmedi. Yazıya dök yürüyüşü (betikli tanıyıcı) 5 / 6 basış, teknik terim 0; metin ölçüleri değişmedi. Bir ekran farklı çıktı (`yol-yazi-kancali-sonuc`, eklenen cümle): bakıldı, iki görünümün tabanı yenilendi; karşılaştırmalı son koşuda farklı ekran 0 |

### Doğrulanmayanlar

- Sabahki ek'in listesi aynen geçerli: gerçek sağlayıcı/Worker, gerçek telefon, Safari, Firefox, ekran
  okuyucu, iki sekme yarışı, depolama kotası.
- Yayındaki sitede (GitHub Pages, `/capcut` taban yolu) adresin `/editor` olması yine yalnızca kod
  okunarak; Pages duman sınaması bu geçişi yürümüyor.
- Gerçek modelle (109 MB) geçiş: sınamalar betikli tanıyıcıyla; kalite yürüyüşü de öyle. Gerçek modelin
  yazısı aynı tarife girer; saklama yolu aynıdır, ayrıca koşulmadı.

### Kurucu kararları

Sabahki listenin 2–7. maddeleri açık (soru penceresinin sözleri ve vurgulu düğme; "iş" eşiği; "İnternette
yazıldı" etiketi; video açıkken "projeyi sil"; adresin `/editor` olması; birden çok proje). Yeni:

8. **Satırsız yazı saklanmıyor** (bu ek'te seçildi: saklanacak şey yok). İstenirse `hasLines` kaldırılır.
9. **Soru penceresi yayındaki sitede göründü**: önceki ek bunu "yeni bir ekran" diye saymıştı; sözleri
   ve davranışı aynen alındı, ayrı bir tasarım turu yapılmadı.
