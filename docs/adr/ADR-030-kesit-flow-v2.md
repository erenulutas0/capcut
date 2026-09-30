# ADR-030 — Kesit akışı v2: bitişte ekleme, milisaniyesiz zaman, GB/MB, telefonda kesit çubuğu

> Tarih: 2026-09-30 · Durum: UYGULANDI (kurucu kararları 30 Eylül 2026). Kaynak:
> [ilk kullanıcı UX denetimi](../ux/2026-09-30-kesit-flow-audit.md)'nin yapısal
> önerileri Ö1, Ö3, Ö5, Ö6, Ö8. [ADR-026](ADR-026-kesit-list.md)'nın işaretleme ve
> "Kesit ekle" satırlarının, ADR-025'in birim cümlesinin **yerine geçer**. Şema
> (EDL v2, belge 10) ve politika (`2026-09-24.v6`, belge 15) **değişmedi**.

## Kurucu kararları (30 Eylül 2026)

1. **"Bitişi işaretle" kesiti hemen ekler** (Ö1).
2. **İşaretsiz "Kesit ekle" videonun tamamını sessizce eklemez** (Ö5); tüm video üstteki
   "Videoyu indir"de kalır.
3. **İnce ayar dışında milisaniyesiz zaman** (Ö8); yuvarlama bir aralığı yanlış
   göstermemeli.
4. **"GiB/MiB" yerine "GB/MB"**, Türkçede ondalık virgülle (Ö6); kontroller baytla,
   sınırlar aynı bayt sayısıyla kalır; arayüzün söylediği birim kontrolün birimi olmalı
   (belge 15).
5. **Telefonda alta yapışkan çubuk** "Kesitler (3) · Hepsini indir" (Ö3).

## 1. Bitişte ekleme

| Durum (kesit seçili değil) | "Bitişi işaretle" / O | "Kesit ekle" / Enter |
|---|---|---|
| Hiçbir şey işaretli değil | Ret: "Önce başlangıcı işaretle." + "Videoda kesitin başlayacağı yere git ve “Başlangıcı işaretle”ye bas." | Aynı ret (tüm video eklenmez) |
| Başlangıç işaretli | **Başlangıç → oynatma çizgisi kesit olur**, tek geri alma adımı | Başlangıç → videonun sonu (ADR-026'daki kural, bildirimde aralık yazar) |
| Başlangıç + yazılmış/sürüklenmiş bitiş | Başlangıç → oynatma çizgisi (yazılan bitişin yerine) | **Başlangıç → yazılan bitiş** |
| Yalnızca yazılmış bitiş | "Önce başlangıcı işaretle." (0'dan başlatılmaz) | Aynı |
| Bitiş başlangıçta ya da önünde | Mevcut ret + sonraki adım ("Bitişi düzelt ya da videoda daha ileri gidip “Bitişi işaretle”ye bas."); **başlangıç işaretli kalır** | Yazılan ters aralık tarifin kuralıyla reddedilir (aynı metin) |
| 0,1 sn'den kısa, 21. kesit, 120 dk toplam | Tarifin kendi retleri (değişmedi) | Aynı |

- Eklenince: işaretler temizlenir, "Kesit N eklendi: 00:02 → 00:07 · sağdaki listede ·
  Geri al: Ctrl+Z" (telefonda "aşağıdaki listede · Geri al: üstteki ↶ düğmesi"), yeni
  kart bir kez parlar (azaltılmış harekette yok). **Bir** geri alma kesiti kaldırır.
- **Kesit seçiliyken** (ince ayar) I ve O o kesitin kenarlarını taşır, yeni kesit
  eklenmez (değişmedi).
- Kod: `markEnd` ve `addFromPending` (`web/src/domain/kesit.ts`, saf; birim testli),
  `EditorApp.addPending`.

### "Kesit ekle" neden kaldı

Seçenekler: (a) kaldırmak, yazılan bitişi Enter/odak kaybında eklemek; (b) bırakmak,
yalnızca yazılan ya da şeritte sürüklenen bitiş için. **(b) seçildi:**

- Zaman alanları harf harf yazılır ve odaktan çıkınca kaydedilir. Odaktan çıkınca kesit
  eklemek, yarım yazılmış ya da başlangıcı düzeltilmemiş aralıkları ekler; Tab ile
  alanlar arasında gezmek kesit üretir. Şeritteki bekleyen bitiş tutamacını sürüklemek de
  bir ayardır, karar değil.
- Ekran en sade haliyle kalır: düğme **yerinde** durur (görünüp kaybolan düğme işaret
  satırını oynatır), ama **birincil değildir**; yalnızca bitiş yazılmış ya da sürüklenmişse
  sıradaki adım olarak vurgulanır. Açıklama balonu: "Kutulara yazdığın başlangıç ve
  bitişle kesit ekle (Enter)". Alt çubuktaki kısayol satırından "Enter kesit ekle" çıktı
  ("O bitiş ve ekle"); Enter kısayolu yardımda "Kutulara yazılan zamanlarla kesit ekle".
- Belge 05'in "Başlangıcın öncesinde bitiş seçilirse değer sessizce değiştirilmez"
  kuralı artık O için de tam geçerli: eskiden ters O başlangıcı düşürüyordu, şimdi
  reddediyor ve başlangıcı tutuyor.

### Tıklama sayısı (fare, video açık; ADR-026 tanımı: her basış + penceredeki "Kaydet")

| Görev | Önce (ADR-026 / UX denetimi) | Sonra (ölçülen) |
|---|---|---|
| Bir aralığı kesip kaydet | 7: şerit, Başlangıcı işaretle, şerit, Bitişi işaretle, Kesit ekle, İndir, Kaydet | **6**: şerit, Başlangıcı işaretle, şerit, Bitişi işaretle, İndir, Kaydet |
| Üç aralık, birleştirip kaydet | 17 | **14**: 3 × 4 + Hepsini birleştirip indir + Kaydet |
| Videonun tamamı | 2 | **2** |

Ölçüm: `kesit.spec.ts` "ADR-030: clicks for the three core tasks" (her görev gerçekten
kaydedilir, basışlar sayılır ve 6 / 14 / 2'ye eşitlenir) ve `scripts/ux-audit.mjs`
(masaüstü ve telefonda dokunma, `v2-measurements.json`: 6 / 14 / 2). "Önce" sütunu
denetimin aynı tanımla saydığı değerdir (bu dalda eski derleme yeniden koşulmadı).
Klavyeyle aralık başına: I, O (Enter yok).

## 2. Boş "Kesit ekle"

Yukarıdaki tabloda. Tüm video indirmesi üstteki "Videoyu indir"de (kesit yokken) aynen
duruyor; hiçbir akış tüm videoyu kesit olarak eklemiyor (Sessizlikleri bul'un "kalan
bölümler kesit olur" yolu hariç, o ADR-026'daki gibi açıkça söylüyor).

## 3. Zaman gösterimi

**Kural** (`web/src/domain/time.ts`):

- **Konum** (bir kesitin başı ya da sonu, oynatma çizgisi, videonun toplam süresi saat
  üzerinde): düştüğü saniye, **aşağı yuvarlanmış**. Bir saatin altında `MM:SS`
  ("00:07"), bir saatten itibaren `S:DD:SS` ("1:02:07"). Gösterilen konum gerçeğinden
  hiç ileride değildir; videonun sonundaki oynatma çizgisi toplamla aynı okunur.
- **Uzunluk**: bir dakikanın altında saniyenin onda biri, **aşağı yuvarlanmış**
  ("4,6 sn", İngilizcede "4.6 s"); bir dakikadan itibaren tam saniye, aşağı
  yuvarlanmış ("1:04", "1:02:07"). En kısa kesit (0,1 sn) "0,0" okunmaz.
- **Neden ikisi ayrı:** aşağı yuvarlanan iki uç, gerçek uzunluktan bir saniyeye kadar
  fazla ya da az bir fark gösterebilir; uzunluk ise hiçbir zaman fazla göstermez ve
  0,1 sn'den (dakikadan uzunda 1 sn'den) az eksik gösterir. 00:02.600 → 00:07.200
  kartta "00:02 → 00:07", "4,6 sn" okunur — "5 saniyelik" değil. Birim testi ilk iki
  dakikadaki 1/30 sn'lik aralıklarda bunu tarar (`tests/unit/timeDisplay.test.ts`).

**Nerede milisaniyesiz:** kesit kartları (aralık, uzunluk, düğmelerin ekran okuyucu
adları "Kesit 1'i indir, 00:02–00:07"), şerit başlığındaki oynatma çizgisi saati ve
altyazı işaretlerinin balonu, oynatma saati (şimdi / toplam, tam ekran dahil),
bildirimler ("Video açıldı (24,0 sn)", "Kesit 1 eklendi: 00:02 → 00:07"), dosya satırı
("sample-24s.mp4 · 24,0 sn" — eskiden Türkçede de ondalık noktaydı), yeniden bağlama
panelindeki süre.

**Nerede milisaniye kalır (hassasiyetin düzenlendiği ya da ölçüldüğü yer):**
Başlangıç/Bitiş alanları (bekleyen aralıkta ve seçili kesitte; yazılan zamanlar),
kaydırıcıların ekran okuyucu değerleri (şeritteki oynatma çizgisi "4,033 saniye",
kenar tutamaçları, tam ekran arama çubuğu — 1 kare adımlı denetimler, değişimin
duyulması gerekir), sürüklerken tutamacın uzunluk etiketi (onda bir), altyazı düzenleyici
ve sessizlik penceresi (ince ayar/gözden geçirme listeleri), Ayarlar'daki müzik bölümü,
indirme sonucunun "Ayrıntılar"ı (ölçülen süre bir ölçümdür).

## 4. GB/MB

**Kural** (`web/src/domain/policy.ts`: `formatBytes`, `formatByteLimit`,
`formatBytesAgainstLimit`, `shownBytes`):

- Ondalık birimler: 1 KB = 1000, 1 MB = 10⁶, 1 GB = 10⁹ bayt. Izgara: tam B ve KB,
  0,1 MB, 0,01 GB; sondaki sıfırlar yazılmaz ("2 MB", "2,5 GB"). "1000 KB" yerine
  "1 MB". Ondalık işareti dilin (`time.decimalMark`: "," / ".").
- **Sınır aşağı yuvarlanır:** 4 GiB = 4 294 967 296 bayt → **"4,29 GB"**; müzik
  100 MiB = 104 857 600 bayt → **"104,8 MB"**; altyazı dosyası 2 MiB → "2 MB"
  (metin zaten buydu).
- **Sınırın yanındaki boyut:** sığıyorsa en yakın adıma yuvarlanır ama gösterilen
  sınırdan büyük yazılmaz; sığmıyorsa **yukarı** yuvarlanır. Sonuç: gösterilen boyut ≤
  gösterilen sınır ⇔ bayt kontrolü geçer. 4 290 000 001 … 4 294 967 296 bayt "4,29 GB"
  okunur ve açılır; 4 294 967 297 bayt "4,3 GB" okunur ve reddedilir.
- **Yer iletileri:** gereken yer yukarı, bildirilen boş yer aşağı yuvarlanır (ADR-023
  kuralı, yeni birimle): "yaklaşık 2,58 GB daha boş yer", "Tarayıcının bildirdiği boş
  alan: 41,9 MB".
- Ret metinleri artık boyutu da söylüyor: "“tatil.mp4” açılamadı: dosya 4,3 GB; bu
  sürümün sınırı 4,29 GB." / "video ve müzik birlikte …; bu sürümde ikisinin toplam
  sınırı 4,29 GB." / "müzik dosyası 104,9 MB; bu sürümün müzik sınırı 104,8 MB."
  Yardımdaki sınır satırı "120 dakika ve 4,29 GB".
- **Kanıt:** `tests/unit/byteUnits.test.ts` — üç sınırın her birinde (4 GiB, 100 MiB,
  2 MiB) sınır ±1 bayt, gösterilen sınır ±1 bayt ve ızgara adımlarının yanındaki
  baytlar: "görünen sayı sınırın üstünde" ⇔ "kontrol reddeder"; 4 GiB'ta bayt bayt
  tablo `exceedsTotalSourceBytes` ile karşılaştırılır. Ayrıca hiçbir mesajda "KiB/MiB/GiB"
  kalmadığı (`policy.test.ts`).
- Destek dosyasındaki (Sorun bildir) depolama alanı da ondalık MB oldu (gizlilik
  sayfası "MB" diyordu; `quotaMb`/`usageMb` 10⁶ bayt).
- Belge 15'in politika sayıları değişmedi; ADR-025'e not düşüldü.

## 5. Telefonda kesit çubuğu

`web/src/components/editor/KesitDock.tsx`, yalnızca telefon düzeninde (≤ 760 px).

| Kesit sayısı | Çubuk |
|---|---|
| 0 | **Yok.** Liste boş, gidilecek bir şey yok; tüm video üstteki "Videoyu indir"de. |
| 1 | "Kesitler (1)" · "Kesiti indir" |
| ≥ 2 | "Kesitler (N)" · "Hepsini birleştirip indir" |

- Yalnızca liste ekranın altındayken görünür (listenin ~56 px'i görünür olunca çekilir;
  `IntersectionObserver`). Portre videoda listeye genelde kaydırmak gerekir; yatay
  videoda 390 × 844'te liste başlığı çoğu zaman zaten görünür ve çubuk çıkmaz.
- "Kesitler (N)": listeye kaydırır, odağı liste başlığına koyar. İndirme yarısı üstteki
  düğmeyle **aynı** işi yapar (kaydetme penceresi tıklamanın içinde açılır), sonra
  ilerleme ve sonuç görünsün diye listeyi getirir.
- **WCAG 2.4.11:** çubuk görünürken sayfanın alt boşluğu çubuk kadar ayrılır
  (`scroll-padding-bottom`, çubuk yüksekliği + 8 px), tarayıcı odaklanan denetimi
  çubuğun üstüne kaydırır; çubuk belirdiğinde ekranda duran ve altında kalan odaklı
  denetim (ör. az önce basılan "Bitişi işaretle") görünür yere kaydırılır. Ekranın
  altındaki bir denetim için kaydırma yapılmaz (sayfayı kullanıcının elinden almamak
  için). Test: sayfada 40 Tab durağı, çubuk görünürken hiçbir durak çubukla kesişmiyor;
  koruma kapatılınca aynı test kırılıyor (bu dalda denendi).
- Güvenli alan: `env(safe-area-inset-bottom/left/right)` dolguda; 320 px'te iki düğme
  alt alta sarılır (yatay kaydırma yok, 44 px hedef); hareket yok (geçiş/animasyon
  yok), azaltılmış harekette kaydırma anında; `aside` + "Kesitler kısayolu" adı,
  `hidden` iken sekme sırasında değil. CSP: stil sınıflarla ve CSSOM ile
  (`element.style`), satır içi `<style>` yok.

## Test edilen

Bu dalda, 2026-09-30:

- `npx tsc --noEmit -p .` temiz, `npx eslint .` temiz, `npm run build` başarılı
  (CSP adımı dahil).
- `npx vitest run`: **40 dosya, 509 test geçti** (yeni `byteUnits.test.ts`,
  `timeDisplay.test.ts`; `kesit.test.ts`'te `markEnd` / `addFromPending`).
- `E2E_PORT=3231 npx playwright test` (ölçüm kilidi altında): **155 geçti, 2 atlandı**
  (isteğe bağlı sessizlik ekran görüntüleri), hata yok, 3,8 dk. İçinde: `kesit.spec.ts`
  29 test (yeni: bitişte ekleme + tek geri alma + parlama, başlangıçsız bitiş, ters
  bitiş, boş "Kesit ekle", üç görevin tıklama sayısı, telefon çubuğu ×4); `a11y.spec.ts`
  29 test (yalnız klavyeyle akış I/O'ya göre güncellendi, yeni axe durumu "telefonda
  kesit çubuğu"; axe 0 ihlal masaüstü/tablet/telefon, odak tuzağı ve dönüşü, 320 px,
  metin aralığı, azaltılmış hareket); `csp.spec.ts` 3 test (tam oturumda CSP ihlali yok).
- Destek matrisi (`next start -p 3100`, kilit altında): **Chromium 22 PASS, Chrome 22
  PASS**, 0 FAIL. M13'ün ret metni: "“m13-oversize-4gib.mp4” açılamadı: dosya 4,32 GB;
  bu sürümün sınırı 4,29 GB."
- Ekran görüntüleri: `docs/ux/2026-09-30/v2-{desktop,phone}-NN-adım.png` (önce: aynı
  klasördeki `after-*.png`, UX denetimi dalının derlemesi), telefon portre çubuğu
  `v2-phone-16-portrait-kesit-bar.png`, işaretsiz "Kesit ekle" reddi
  `v2-*-12a-add-nothing-marked.png`; ölçümler `v2-measurements.json` (teknik kelime
  taramasında "MiB/GiB" artık yok).

## Test edilmeyen

- Gerçek kullanıcı (kit hazır; özellikle "Bitişi işaretle"nin kesiti eklediğinin
  beklenip beklenmediği ve "Kesit ekle"nin yazılan zamanlar için kalmasının anlaşılıp
  anlaşılmadığı sorulmalı).
- Gerçek telefon, çentikli ekranda güvenli alan (yalnızca kural CSSOM'da denetlendi;
  `viewport-fit=cover` bu dalın kapsamı dışında, düzen başlığı başka işte), iOS Safari,
  gerçek ekran okuyucu (adlar erişilebilirlik ağacında denetlendi).
- Windows Gezgini boyutları ikili birimle "GB" diye yazar (4 GiB'lık dosya "4,00 GB");
  arayüzün ondalık "4,29 GB"ı ile aynı dosya farklı sayı gösterebilir. Ret metni
  dosyanın boyutunu kendi birimiyle söylediği için karar yine anlaşılır; gerçek
  kullanıcıyla denenmedi.
