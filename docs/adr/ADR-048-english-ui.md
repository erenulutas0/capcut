# ADR-048 — Uygulamanın tamamı İngilizce: her sayfa iki dilde önceden çizilir, okur ilk karede kendi dilindedir

> Tarih: 2026-10-18 · Durum: UYGULANDI (birim, e2e, bulut e2e, durağan çıktı + Pages duman testi, kalite katmanı).
> Kurucunun hedefi "web, her telefon": İngilizce arayüz erişimdeki en büyük kazanç. Şema (EDL) ve politika
> **değişmedi**. Tarayıcıda saklananlara **bir anahtar eklendi** (localStorage `clip.language`;
> [veri envanteri](../privacy/DATA_INVENTORY.md) §2.4c ve `/gizlilik` "Dil seçimi" kartı aynı değişiklikte).
> Hiçbir dış hizmet ya da makine çevirisi kullanılmadı: İngilizce metinler elle yazıldı ve gözden geçirildi.

## Bağlam

Metinler `web/src/i18n/messages.ts` (Türkçe) ve `messages.en.ts` (İngilizce, yalnız `/gizlilik/en`'in
yüklediği) tablolarındaydı; bileşenler modül düzeyinde `translator('tr')` çağırıyordu, yani İngilizce
tablo hazır olsa da uygulama İngilizce **çizilemiyordu**. Kısıtlar: durağan çıktı (sunucu yok), çevrimdışı
PWA (her sayfa önbellekte), İngilizce okura yanlış dilin bir an bile görünmemesi, derin bağlantılar ve paylaşım
hedefinin (`/paylas/` → `/?paylasim=…`) çalışmaya devam etmesi, sayfa bekçisinin (ADR-044) önceden çizilmiş
uyarısı, bulut yolunun rıza ekranı (ADR-039) ve Türkçe kullanıcı için davranışın — dil düğmesi dışında —
değişmemesi.

## Seçenekler

| | A. Yol öneki: her sayfa iki kez önceden çizilir (`/en/…`) | B. Tek sayfa takımı, dil çalışma anında |
|---|---|---|
| İlk kare | Sayfanın HTML'i zaten kendi dilinde; betiksiz de doğru | HTML Türkçe çizilir; İngilizce okura ya Türkçe görünür (yanıp söner) ya da sayfa React gelene kadar gizlenir (ADR-044'ün "HTML betiksiz de işe yarar" ilkesine aykırı; yavaş telefonda saniyelerce boş ekran) |
| `<html lang>` | Her sayfada doğru (iki kök düzen) | Sunucu HTML'inde yanlış; Chrome İngilizce sayfayı "Türkçeden çevir" diye önerir |
| Sayfa ağırlığı | Her sayfa yalnız kendi dilinin tablosunu yükler | İki tablo birden ya da dili sonradan indiren ek bir istek (çevrimdışında ayrıca önbellek) |
| Hidrasyon | Sunucu ve tarayıcı aynı dili çizer | Sunucu Türkçe, tarayıcı İngilizce: uyuşmazlık, istemcide yeniden çizim |
| Bedel | Sayfa sayısı 15 → 28; çevrimdışı kopya ≈ +0,4 MB (HTML); İngilizce tarayıcı Türkçe bir adrese gelirse bir yerel geçiş (aşağıda) | Daha az HTML |
| Arama motorları | Her dilin kendi adresi, `hreflang` | Tek adres |

**Karar: A.** Belirleyici olan ilk kare ve `<html lang>`: B'de İngilizce bir okur ya Türkçe kelimeler görür ya
boş bir sayfa. Ek HTML'in bedeli küçük ve bir kez ödenir (çevrimdışı kopya).

## Nasıl

### Adresler

| Türkçe | İngilizce |
|---|---|
| `/` | `/en/` |
| `/editor/` | `/en/editor/` |
| `/yap/<iş>/` (on bir iş) | `/en/yap/<iş>/` |
| `/gizlilik/` | `/gizlilik/en/` (9 Ekim'den beri olan adres korundu) |

Eşleme tek bir modülde (`web/src/i18n/localePath.ts`) ve aynısı sayfa betiğinde; birim testi ikisini aynı
tabloyla koşar. Görev kimlikleri (`kes`, `bosluk`…) ve `/paylas/`, `?paylasim=` iki dilde aynıdır: yalnız adres
çubuğunda görünürler, değiştirmek derin bağlantıları kırardı.

### İki kök düzen

`app/(tr)/layout.tsx` (`<html lang="tr">`) ve `app/(en)/layout.tsx` (`<html lang="en">`); ortak gövde
`components/root/RootParts.tsx`. Kök düzenler arası geçiş Next'te tam sayfa yüklemesidir — dil düğmesi zaten
budur. Eşleşmeyen adres için `app/global-not-found.tsx` (Next `experimental.globalNotFound`): iki kök düzen
olunca tek bir 404 düzeni kalmıyor; sayfa iki dilde "Bu sayfa yok. / This page does not exist." der ve bekçi
için canlıdır (`PageAlive`).

### Sözlükler: sayfa başına tek dil

`translate.ts` hiçbir kelime içermez; `messages.ts` (Türkçe) ve `messages.en.ts` (İngilizce) yüklenince kendini
kaydeder. Türkçe sayfaları `TurkishProvider`, İngilizce sayfaları `EnglishProvider` sarar: sağlayıcı modülü
kendi tablosunu içe aktarır ve çocuklar sağlayıcıdan sonra çizildiği için tablo hep hazırdır. Bileşenler
`useT()` / `useLocalePath()` kullanır. Bulut yolunun kelimeleri (`cloudMessages*.ts`) yolun kendi parçasıyla,
sayfanın diline göre gelir (`YaziWizard.tsx`, `<html lang>`). Bir birim testi (`i18nCoverage.test.ts`) Türkçe
tabloyu yalnız Türkçe sayfaların, İngilizce tabloyu yalnız İngilizce sayfaların yüklediğini denetler.

### İlk kare: dil betiği

`web/scripts/lib/language-redirect.js`, derlemeden sonra `apply-csp.mjs` ile her uygulama sayfasının
`<head>`'ine **ilk betik** olarak yazılır (bekçiden önce; hash'i sayfanın CSP'sinde, `'unsafe-inline'` yok).
Karar sırası:

1. Adreste `lang=tr|en` (dil düğmesinin açtığı adres): seçim saklanır, kelime adresten silinir.
2. Saklanan seçim (`clip.language`).
3. Tarayıcının dil listesi: Türkçe ya da İngilizceden **ilk gelen** karar verir; ikisi de yoksa İngilizce;
   liste boşsa sayfa olduğu gibi kalır. Türkçe tarayıcı Türkçe sayfada kalır.

Sayfanın dili (`<html lang>`) istenenden farklıysa betik `<html hidden>` yapar (hiçbir şey çizilmez) ve ikizine
`location.replace` ile geçer; sorgu ve hash korunur — paylaşım hedefinin `/?paylasim=…`'ı `/en/?paylasim=…`
olur. İkiz 4 sn içinde gelmezse sayfa kendini gösterir (boş kalmaz). Çevrimdışında ikiz de önbellektedir.
İngilizce bir okur Türkçe bir adresi açtığında bedel, cihazın kendi önbelleğinden (ilk ziyarette ağdan) bir
belge daha yüklemektir.

**Ölçüm (e2e, `english.spec.ts` "first paint"):** İngilizce (en-US) tarayıcı `/`'ı açar. Her belgede sayfa
betiklerinden önce çalışan bir sınama betiği ilk 30 animasyon karesini ve sayfadan çıkarken boyananları kaydeder:
Türkçe belge **hiç animasyon karesi çalıştırmadan** gizli olarak değiştirildi; kaydedilen karelerin **hiçbirinde
Türkçe kelime yok**; İngilizce sayfa ilk karesinden İngilizcedir. Ayrıca her İngilizce sayfanın önceden çizilmiş
HTML'inde (betikler ve bekçinin gizli Türkçe paneli dışında) Türkçe sözcük yoktur.

### Dil düğmesi

"English" (Türkçe sayfada) / "Türkçe" (İngilizce sayfada): o dilin kendi adıyla, `lang` ve `hreflang` ile.
Yerleri: ana ekranın çubuğu, editörün **Ayarlar** paneli (altında "Dil değişince sayfa yeniden yüklenir;
videoyu yeniden seçmen gerekir."), gizlilik sayfası (eski "English" bağlantısının yeri, aynı görünüm). En az
44 × 44 px, klavyeyle. Düz bir bağlantıdır (`…?lang=en`): sayfa canlanmadan basılsa da çalışır ve seçim
hatırlanır; canlıysa adresin sorgusunu da taşır. Sihirbazlarda düğme yok (bir adımlık iş; ana ekrandan seçilir).

### Bekçi, PWA, manifest

- **Bekçi (ADR-044):** uyarı zaten iki dilde önceden çiziliyordu; hangisini göstereceğini artık adresten değil
  `<html lang>`'den alır (`enPrefix` kalktı).
- **Çevrimdışı kopya (ADR-031):** 28 sayfa; `build-sw.mjs` İngilizce sayfaların da derlemede olduğunu denetler.
- **Manifest:** tek manifest, **değişmedi** (ad LiloCut, `lang: "tr"`, Türkçe açıklama). İkinci bir manifest
  ikinci bir uygulama kimliği demektir. Yüklü uygulama `/`'dan başlar; İngilizce telefonda dil betiği `/en/`'e
  geçer. Açıklamanın iki dilli olması kurucu kararıdır (aşağıda).
- **Paylaşım hedefi (ADR-047):** worker değişmedi; Türkçe açılış ekranına yönlendirir, dil betiği gerisini yapar.

## İngilizce metinler

Bütün anahtarlar iki tabloda da var (TypeScript `Record<MessageKey, string>` + `i18nCoverage.test.ts`: aynı
anahtarlar, aynı `{yer tutucular}` — Türkçeye özgü `{acc}` hariç —, aynı `**kalın**` işaretleri, boş metin yok).
Gözden geçirmede düzeltilenler: İngilizce sayfanın Türkçe düğmelere gönderdiği yerler ("İnternette",
"Yazıya dök", "Sesi gönder ve yaz", "Kodu kaydet"…; bir test artık tırnak içindeki her düğme adının İngilizce
uygulamada gerçekten var olduğunu denetler), "recipe" (tarif) yerine "your edits / your project", proje
saklama için "saved", "opening/home screen" yerine tek terim "start screen", tek tırnak yerine ’, sadeleştirilen
en zor cümleler.

### Terim listesi

| Türkçe | İngilizce |
|---|---|
| kesit / kesitler | clip / clips |
| İndir | Download |
| Kaydedildi | Saved |
| Kaydet / Bilgisayara kaydet | Save / Save to this computer |
| (proje) saklandı | (edits) saved |
| tarif | your edits / your project |
| ana ekran | start screen |
| Kendim düzenleyeceğim | I’ll edit it myself |
| Daha fazla ayar → editörde aç | More settings → open in the editor |
| Bunu henüz yapamıyoruz. | We can’t do that yet. |
| Bunu bulamadım. | I couldn’t find that. |
| Bunu mu demek istedin? | Did you mean this? |
| Cihazımda / İnternette | On my device / On the internet |

### Kartlar

| Kart | İngilizce ad | Alt satır |
|---|---|---|
| Kes | **Cut** | Keep the parts you want |
| Boşlukları at | **Remove silences** | Take out the quiet parts |
| Dikey yap | **Make it vertical** | Reels, TikTok, Shorts |
| Küçült | **Shrink** | Fit it into WhatsApp |
| Yazıya dök | **Speech to text** | Subtitles and text |
| Müzik ekle | **Add music** | Put your own music on it |
| Sesini al | **Get the sound** | An audio file from the video |
| Sesi kapat | **Mute** | Make the video silent |
| Her yerde açılsın | **Make it play everywhere** | Turn it into a standard MP4 |
| İyileştir | **Enhance** | Light, colour, sharpness |
| GIF yap | **Make a GIF** | An animated picture from the video |

"Transcribe" bir çocuk için zor bulunduğundan "Speech to text"; "Plays everywhere" yerine öteki kartlarla aynı
kalıpta ("Make it …") bir emir. Yazım İngiliz İngilizcesidir (colour), saat `en-GB` (14:05).

### Sayı, birim, çoğul, dosya adı

Ondalık nokta (`4.5 s`), `min` / `s`, `MB`, yüzde `42%` (Türkçe `%42` aynen), çoğul ("1 minute", "2 minutes",
"1.5 seconds"; Türkçe tek biçim), saat `toLocaleTimeString('en-GB')`. Hata cümlesinin küçük harfe çevrilmesi
sayfanın diline göre (Türkçede "I" → "ı" İngilizcede olmamalı). Önerilen dosya adlarındaki kelimeler sayfanın
dilinde: `trip_whole.mp4`, `trip_3-clips.mp4`, `trip_no-silences.mp4`, `_vertical`, `_with-music`,
`_plays-everywhere`, `_small`, `_sound`, `_muted`, `_captioned`, `_enhanced`, `_gif`; `trip_text.txt`,
`trip_subtitles.srt`, `lilocut-report-….json`, `lilocut-project.lilocut.json`. Türkçe adlar aynen.

## Arama

Açılış ekranının araması zaten iki dilli kelime listeleriyle çalışıyordu; İngilizce sayfada aynı arama, İngilizce
örnek çipler (`remove the silent parts`, `vertical for TikTok`, `cut the start`, `add music`; her biri Türkçe
eşiyle aynı işi emin cevap olarak bulur — birim testi). Ölçüm Türkçe yeni kümelerle aynı yoldan:

- **Ayar kümesi** (`search-eval-en-dev.ts`, 140 ifade): yalnız İngilizce iş adlarını ve açıklamaları gören bir
  yazar; kelime listeleri bunun kaçanlarına bakılarak genişletildi (doğrudan doğru %66,4 → %86,4, yanlış ama
  emin %2,1 → %0 — ayar kümesi, ölçüm değil).
- **Kör küme** (`search-eval-en-fresh.ts`, 200 ifade): başka bir yazar, aynı kısıtla; dönüştürücü yalnız sayıları
  bastı, ifadeler okunmadı. Listeler donduktan sonra ölçüldü.
- **Türkçe değişmedi:** 1 044 Türkçe ifadenin (bütün değerlendirme kümeleri + birim tabloları) hiçbirinin cevabı
  değişmedi. İlk ayarda ortak kelimeler (`mp3`, `mkv`, `avi`) üç Türkçe ifadenin cevabını (iyi yönde) değiştirdi;
  kural gereği geri alındı. Türkçe üçüncü yeni kümenin **İngilizce** ifadelerinden "a bit more"ın "Kes"e kayması
  görülünce "bit" çıkarıldı. Bu iki düzeltme kör kümenin kaçanlarına bakılarak yapılmadı; kör küme ilk ölçümden
  sonra son kodla bir kez daha ölçüldü, iki sayı da aşağıda.

| İngilizce kör küme (sayılan 155; 122 yapılabilen iş) | İlk ölçüm | Son kod |
|---|---|---|
| Doğrudan doğru (tek cevap, doğru iş) | %58,2 | **%57,4** |
| İlk satır doğru (cevap ya da ilk seçenek) | %77,0 | **%76,2** |
| Doğru işe yeniden yazmadan varıldı | %79,5 | **%79,5** |
| Yanlış ama emin (bütün ifadelerde / yapılabilende) | %2,6 / %2,5 | **%2,6 / %2,5** |
| Sordu (yapılabilen işlerde) | %23,0 | **%23,8** |
| Sorduğunda doğru iş seçeneklerde | %92,9 | **%93,1** |
| Yapılabilen işe "bulamadım" | %15,6 | **%15,6** |
| Açık yazılmış isteğe soru | %0 (11 ifade) | **%0** |
| "We can't do that yet." yakalama / isabet | %85,7 / %95,2 | **%85,7 / %95,2** |

Karşılaştırma için Türkçe üçüncü yeni küme (aynı yöntem, 11 Ekim): ilk satır doğru %77,2, yanlış ama emin %3,0.
İngilizce arama Türkçe aramayla aynı düzeyde; ikisi de bütçenin (ilk satır ≥ %85) altında — bulgu.

## Kalite katmanı

`desktop-en` / `phone-en` projeleri (en-US): on bir kartın yürüyüşü ve görsel tabanlar iki dilde; İngilizce
teknik terim listesi; İngilizce okunabilirlik **Flesch okuma kolaylığı** ile, bütçeler Türkçenin aynası
(ortanca ≥ 60, zor ≤ %15, çok zor 0, 20+ kelimelik cümleli metin ≤ 3). Ayrıntı:
[docs/quality/README.md](../quality/README.md) "İngilizce".

## Sayfa ağırlığı (durağan çıktı, `/capcut`; HTML + sayfanın yüklediği betik ve stil, gzip)

Önce: 431696b; sonra: bu değişiklik. KiB, gzip (ham değil); "JS" sayfanın `<script src>` ile yüklediği her şey.
Tembel parçalar (editörün paneli, bulut yolu) sayılmadı.

| Sayfa | Önce: toplam (JS) | Sonra, Türkçe | Sonra, İngilizce ikizi |
|---|---|---|---|
| Açılış ekranı | 231,3 (219,7) | 234,9 (222,1) | `/en/` 234,0 (221,3) |
| Editör | 291,5 (272,4) | 295,1 (275,0) | `/en/editor/` 294,1 (274,2) |
| Sihirbaz (her biri) | 284,1 (264,9) | 287,6 (267,4) | `/en/yap/…` 286,8 (266,6) |
| Gizlilik | 234,0 (219,6) | 240,3 (222,3)\* | — |
| Gizlilik, İngilizce | 260,1 (245,8) | — | `/gizlilik/en/` 239,2 (221,4) |

\* Gizlilik HTML'i "sonra"da yayın derlemesinin değişkenleriyle (veri sorumlusu, barındırma) üretildi; HTML farkının
çoğu odur, JS farkı +2,7.

- **Her sayfa yalnız kendi dilinin tablosunu yükler** (derlenmiş dosyalarda denetlendi: Türkçe sayfaların
  betiklerinde İngilizce tablo, İngilizce sayfalarınkinde Türkçe tablo yok). İngilizce gizlilik sayfası
  **−20,9 KiB** (artık iki tabloyu birden taşımıyor).
- Türkçe sayfalar **+2,4–2,6 KiB** JS (dil bağlamı, dil düğmesi, sözlüklerin ayrılması, İngilizce örnek çipler) ve
  **+1,0–1,1 KiB** HTML (dil betiği 2,4 KB ham, `hreflang` bağlantıları). Kalite bütçesi (ana ekran JS ≤ 192 000
  bayt aktarım) içinde.
- Çevrimdışı kopya: 15 sayfa / 3,77 MB → **28 sayfa / 4,28 MB** (çoğu HTML; ortak betik dosyaları bir kez).

### Ölçülen (son kod)

- Okunabilirlik, varsayılan yol: Türkçe Ateşman ortanca 83,9; **İngilizce Flesch ortanca 87,9**, zor %1,9, çok zor 0,
  20+ kelimelik cümleli metin 3 — bütçe içinde. Teknik terim içeren metin iki dilde de 11 (aynı anahtarlar: hata
  ayrıntıları).
- Yürüyüşler: on bir kartın hepsi İngilizcede de dosyayla biter (Speech to text, Türkçedeki gibi model indirme
  düğmesine kadar); tıklama, karar, ekran sayıları Türkçeyle aynı, adıyla bulunamayan adım 0, teknik terim 0.
  **Bulgu:** İngilizce aynı ekranı daha çok kelimeyle söyler (açılış ekranı 111 → 153); en kalabalık ekran bütçesi
  (160, Türkçenin aynası) iki yerde aşılır: İyileştir seçimi 174 (Türkçe 136), masaüstü editör 172 (Türkçe 152).
  Metinler bir kez kısaltıldı (194 → 174, 183 → 172); bütçe gevşetilmedi.
- Görsel: Türkçe tabanlar değişmedi (açılış ekranı %0,03–0,53 fark, eşik %1); İngilizce 70 taban yazıldı.

## Kurucu kararları

1. **Türkçe ya da İngilizce dışındaki tarayıcılar İngilizce açılır** (ör. Almanca). Türkçe listede İngilizceden
   önceyse Türkçe. Ters yönde istenirse betikte tek satır.
2. **Manifest açıklaması** Türkçe kaldı (tek manifest). Android'in kurulum penceresinde İngilizce okur Türkçe bir
   cümle görebilir. Seçenek: iki dilli tek cümle.
3. **Altyazı izinin varsayılan dili** (`commands.ts newTrack`, içerik bilgisi, arayüz değil) İngilizce sayfada da
   `tr`; kullanıcı Ayarlar'dan değiştirir.
4. **Kart adları** yukarıdaki tablo; "Speech to text" ve "Make it play everywhere" en tartışmalı ikisi.
5. Sihirbazlarda dil düğmesi yok.

## Doğrulanmayan

Gerçek bir İngilizce telefonda (Android Chrome, iOS Safari) ilk kare ve paylaşım; Firefox / WebKit'te dil
betiği (e2e Chromium); ekran okuyucuyla İngilizce oturum; ana dili İngilizce olan bir okurun metinleri okuması.
