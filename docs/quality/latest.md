# Kalite raporu — 2026-10-20

> Üreten: `npm run quality` (`web/scripts/quality/run.mjs`). Ölçüm koşusu: 2026-10-20 21:19 UTC, commit `a922aec` + kaydedilmemiş değişiklikler, 12 dk; ölçülen bölümler: search, text, walkthrough, errors, honesty, output, perf, visual, a11y. Raporun metni 2026-10-20 21:20 UTC tarihinde ölçüm yapılmadan yeniden yazıldı (`--report-only`).
> Makine: Windows_NT 10.0.26200, 12th Gen Intel(R) Core(TM) i5-12500 × 12, 64 GB bellek. Tarayıcı: Playwright’ın Chromium’u. Bütün medya üretilmiş (ffmpeg) ya da depodaki haklı örneklerdir; hiçbir şey makineden çıkmadı.
> Bu rapor bir kullanıcı testinin yerini TUTMAZ; neyi söylemediği en altta ve `docs/quality/README.md` içinde.

## Öne çıkan bulgular

_Bu bölüm elle yazılır (`docs/quality/bulgular.md`); sayılar aşağıdaki tablolardan gelir. Rapor yeniden üretildiğinde olduğu gibi yerine konur — tarihine bakın._

**Yazıldığı koşu:** 11 Ekim 2026 öğleden sonra, dal `worktree-agent-a511c0275d7647e51` (önceki bulgular: aynı gün, `b8e355f`). O raporda açık kalan üç şey üzerinde çalışıldı: aramanın yanlış karta göndermesi, editörün her videoyu 1080p’ye büyütmesi, 720p’den küçük kaynakların büyütülmesi. Aşağıda her biri için aynı ölçünün önceki → şimdiki değeri var. Açık kalanlar en başta.

### 20 Ekim — GIF: "Orta" varsayılan, "Büyük", 10 MB uyarısı; telefonda ana düğme ekranda (ADR-046 eki; dal `worktree-agent-a0999750006c187e8`)

967 ölçü: **852 bütçe içinde, 16 dışında**, 9 ölçülemedi, 90 bütçesiz. Farklı ekran **0** — ilk koşuda 32 ekran
"farklı"ydı, hepsi bu işin bilerek yaptığı değişiklik: telefonda (ve kısa pencerede) ana düğme ekranın altına yapışan
bir çubukta (tam sayfa görüntüde çubuk görünümün altında durur, arkasındaki son satır kaydırınca görünür), "Daha
fazla ayar" çubuğun altında (sayfa 8–20 px uzadı), GIF ekranında üç boyut ve bir açıklama satırı, Yazıya dök'te
"Modeli indir" kutunun dışında. Fark resimlerine bakılıp `--update-baselines` ile yalnız o 32 ekran yenilendi
(aracın tolerans içinde yeniden yazdığı 28 taban geri alındı). Yürüyüşte GIF'in beklediği boyut 320 × 180 → 480 × 270
(varsayılan Orta, kurucu kararı); dört GIF yürüyüşü yine "dosya çıktı ve doğru". Bütçe dışı 16'nın 12'si aramanın
önceden açık ölçüleri, 1'i `out.notFaststart` (önceden açık). **Bu koşuda görülen 3 yeni madde:** "Editör, video yok
(telefon)" — "Proje adı" kutusu 22 × 38 px ve Tab'la ulaşılamıyor (44 px, 24 px, Tab: üçü aynı kutu). Bu iş editöre
dokunmadı; aynı kodla yapılan iki önceki koşuda (ilk koşu ve taban yenileme koşusu) bu madde yoktu, ikincisinde
onun yerine bir kez "Sihirbaz, mobil kısıtlama: TBT" 205 ms çıktı (≤ 200; ilk ve son koşuda bütçe içinde). İkisi de
kararsız bir ölçüm gibi görünüyor; ayrıca bakılmalı, bütçeler gevşetilmedi.

### 17 Ekim akşamı — "LiloCut'a paylaş" (ADR-047; dal `worktree-agent-a586f5ccf4bee0ed2`)

676 ölçü: **598 bütçe içinde, 8 dışında** (aynı açık maddeler; bu işten yeni bütçe dışı ölçü yok), 5 ölçülemedi,
65 bütçesiz. Farklı ekran **0**, taban yenilenmedi: elde video yokken açılış ekranı öncekiyle aynı. Ana ekran
aktarılan JS 184 → **188 KB** (paylaşılan videonun kutusu ve paylaşma hedefinin ortak modülü); LCP (mobil
kısıtlama) 580 → 612 ms, bütçe içinde. Paylaşılan videonun ekranı bu katmanda ölçülmüyor (Android paylaşma
menüsü gerekir); e2e `share-target.spec.ts` ve ekran görüntüleri `docs/ux/2026-10-17-paylas/`.

### 17 Ekim — "GIF yap" on birinci kart (ADR-046; dal `worktree-agent-ab29a64817aeefa71`)

676 ölçü (önce 643): **598 bütçe içinde, 8 dışında** (aynı açık maddeler: yedi arama ölçüsü ve
`out.notFaststart`; bu işten yeni bütçe dışı ölçü yok), 5 ölçülemedi, 65 bütçesiz. Farklı ekran **0** — ilk
koşuda `ana-ekran` iki görünümde farklıydı (%4,2 / %19,9: on bir kart, öndeki kart iki yer kaplıyor); fark
resimlerine bakıldıktan sonra yalnız bu iki taban elle yenilendi. Yeni tabanlar: `sihirbaz-gif-secim` (iki yazı
yazılmış; video gizlenerek, yoksa maskesi yazı kutularını örtüyordu), `yol-gif-ilk`, `yol-gif-sonuc`.

- **GIF yürüyüşü:** masaüstü ve telefonda dosya çıktı ve doğru (GIF, 320 × 180, 50 kare, 4 sn, sonsuz döngü);
  tıklama 3 / 4, yazılan alan 1, karar ekranı 1, teknik terim 0, adıyla bulunamayan 0; karttan dosyaya 9,7 sn
  (masaüstü; iki kez boyut tahmininin bitmesi beklendi) / 3,5 sn (telefon). Dosyası doğrulanan görev 9 → **10**.
- **GIF ekranı, erişilebilirlik:** telefonda en küçük yazı 14 px, 44 px'ten küçük hedef 0, adsız kontrol 0, axe 0;
  11 sekme durağı, ulaşılamayan 0.
- **Arama:** yeni ayrı kümede doğrudan doğru %54,1 → %53,7, ilk satır %75,7 → %75,8, yanlış ama emin %3 → %3;
  "henüz yapamıyoruz" isabet / kesinlik %88 / %88,2 → %87,5 / %87,5 (bir ifade "yapamıyoruz"dan işe geçti;
  ADR-046 "Arama").
- **Yük:** ana ekran aktarılan JS 183 → 184 KB, sihirbaz `/yap/dikey/` 230 → 233 KB (yeni metinler ve
  `WizardFlow`); GIF ekranının kodu, kodlayıcısı ve worker'ı ayrı parçalarda, yalnız `/yap/gif` yükler.
  Telefon kısıtlamasında TBT ana ekran 121, editör 121, sihirbaz 113 ms (bütçe ≤ 200).

### 15 Ekim akşamı — ölü görünen bağlantılar, ölü kod, react 19.3.1 yaması (ADR-044 Ek 2; dal `worktree-agent-a1b21395390822816`)

Bu rapor o dalın son koduyla (`f1dd38e`) koşuldu. Farklı ekran **0**, taban yenilenmedi; 643 ölçü: **566 bütçe içinde,
8 dışında** (aynı açık maddeler), 5 ölçülemedi, 64 bütçesiz. Telefon kısıtlamasında editör TBT'si **173 ms (149–185)**
(aşağıdaki 15 Ekim koşusunda 141): bütçe (≤ 200) içinde ve aynı kodla daha önce görülen 176–268 bandında; bu işe
bağlanmadı, ayrıca A/B ölçülmedi — sonraki koşu izlenmeli. Editörün aktarılan JS'i 255 KB / 16 → 238 KB / 14 dosya
(düşüşün nedeni ayrıca incelenmedi). Sihirbaz 119 ms, ana ekran 122 ms.

### 15 Ekim — editörün ilk yükü hafifledi (dal `worktree-agent-abfa7505f484bcb77`)

Yayındaki sitede görünen bir şey değişmedi; ekran tabanlarından farklı ekran **0**. 643 ölçü: **566 bütçe içinde, 8
dışında** (hepsi önceki açık maddeler: yedi arama ölçüsü ve `out.notFaststart`), 5 ölçülemedi, 64 bütçesiz.

- **Telefon kısıtlamasında TBT** (3 koşunun ortancası, parantezde en az–en çok; önce = 14 Ekim akşamki rapor):
  editör 193 (186–244) → **141 ms (130–158)**, sihirbaz `/yap/dikey/` 157 (157–373) → **135 ms (130–149)**,
  ana ekran (dokunulmadı) 148 (129–216) → 142 ms (122–146). Bütçe ≤ 200 ms; bütçe değişmedi.
- **Aktarılan JS:** editör 299 KB / 18 dosya → **255 KB / 16**, sihirbaz 244 KB / 15 → **230 KB / 14**, ana ekran
  181 KB / 9 → 182 KB / 10 (aynı kod, paketleyici bir Next.js parçasını ayrı dosyaya ayırdı). LCP değişmedi
  (editör 816 → 832 ms, sihirbaz 640 → 636 ms; gürültü içinde).
- **Gürültüden ayırmak için** aynı makinede, aynı saatte önceki (`8927bcd`) ve yeni durağan çıktı **sırayla** açıldı
  (her biri 8–10 kez, mobil kısıtlama): editör ortanca 184 → 123 ms ve 126 → 93 ms (iki ayrı oturum; makinenin
  arka plan yükü %15–45 arası oynadı), sihirbaz 141 → 119 ms ve 131 → 129 ms. Yalnızca hidrasyon değişikliği
  (aşağıda 3.) ayrıca ölçüldü: editör 100 → 90 ms, sihirbazda fark yok.
- **Ne taşındı:** (1) Kayıt planı İyileştir'in matematiğini taşıyordu (yalnızca bir sürüm sabiti için; ~15 KB) —
  sabit ayrı dosyada. (2) Kayıtlı projeyi okuma ve tarif doğrulaması (~13 KB) yalnızca okunacak kayıt ya da yedek
  varken gelir. (3) Editörde Ayarlar sayfasının panelleri, yardım, "Yazıya dök" penceresi (model deposu ve WebGPU
  soruları dahil) ve indirme durumu basışla gelir; sihirbazda indirme durumu da. Gelmeyen parça yerinde "Bu bölüm
  açılamadı · Tekrar dene" der (ADR-044). (4) Hidrasyondan sonra pencere genişliğine geçiş artık editörün tamamını
  bir uzun görevde yeniden çizmiyor (geçiş, kısa dilimlerle). Yeni parçalar çevrimdışı listede (59 / 59 JS dosyası).

### 14 Ekim akşamı — telefonda büyük model yok, ölü görünen kart, video açıkken proje silme (ADR-036 Ek 2, ADR-044 eki, ADR-012 eki; dal `worktree-agent-a47f69274849b8c7a`)

- 643 ölçü: **566 bütçe içinde, 8 dışında** (hepsi önceki koşulardaki açık maddeler: yedi arama ölçüsü ve
  `out.notFaststart`), 5 ölçülemedi (model dosyaları yok), 64 bütçesiz. Sabahki iki TBT ölçüsü bu koşuda bütçe
  içinde (editör 193 ms, sihirbaz 157 ms); aynı kodla ilk tam koşuda ikisi yine dışarıdaydı (218 / 208 ms) —
  sınırın iki yanına düşen gürültü, "düzeldi" sayılmaz.
- **Ekran tabanları:** ilk koşuda bir ekran “farklı”: `sihirbaz-yazi-model` telefon (%10,83) — eklenen
  “Büyük model telefonda henüz yok.” satırı, altındaki kutu bir satır aşağıda. Ekrana bakıldı, `--update-baselines`
  ile yenilendi; depoya giren taban değişikliği yalnızca bu resim. Sonra tam koşu: farklı ekran **0**. Bu rapor o koşudur.
- Aktarılan JS: ana ekran 180 → 181 KB, editör 293 → 299 KB (16 → 18 dosya), sihirbaz 243 → 244 KB. Önceki rapor
  `a1c068c`'nin; arada bu dalın dışındaki üç commit var (`bb3c860` editöre yeni bir parça ekledi), editördeki
  farkın ne kadarının bu işten olduğu ayrıca ölçülmedi.

### 14 Ekim — cihazda yazılan yazı da editöre geçişte saklanır (ADR-034 “Ek 2”; dal `worktree-agent-a52e453bcc58fbe27`)

**Yayındaki sitede görünen bir şey değişti:** “Yazıya dök”ün sonuç ekranında, editör bağlantısının üstünde artık
“Bu yazı henüz saklanmadı: editörde açarsan ya da metni indirirsen kalır, yoksa sayfa kapanınca gider.” yazıyor
(sabah yalnızca bulut yolundaydı); editörde açılan yazı kayıtlı proje oluyor.

- 643 ölçü: 564 bütçe içinde, **10 dışında**, 5 ölçülemedi (model dosyaları yok), 64 bütçesiz. Sekizi önceki
  koşulardaki açık maddeler (yedi arama ölçüsü ve `out.notFaststart`). **İkisi yeni: telefon kısıtlamasında TBT** —
  editör 268 ms (233–322), sihirbaz 202 ms (174–250); bütçe ≤ 200 ms. Aşağıda “Gürültü mü, bu iş mi?”.
- Sözler bulut tablosundan sihirbazın tablosuna taşındı (`cloud.keep.*` → `wizard.yazi.keep*`); ikisi de varsayılan
  yol sayılıyordu, metin ölçüleri aynı: Ateşman ortancası 82,7, zor metin %1,9, “çok zor” 0, 20 kelimeden uzun cümle 1,
  teknik terimli satır 9. Yazıya dök yürüyüşü (betikli tanıyıcı): masaüstü 5 / telefon 6 basış, en kalabalık ekran
  105 kelime, teknik terim 0 — değişmedi.
- **Ekran tabanları:** ilk koşuda bir ekran “farklı” çıktı: `yol-yazi-kancali-sonuc` telefon (%1,53) — eklenen cümle,
  bağlantı bir satır aşağıda; masaüstü %0,4 ile tolerans içindeydi ama o da cümleyi gösteriyor. Ekranlara bakıldı,
  `--update-baselines` ile yenilendi; depoya giren taban değişikliği yalnızca bu iki resim. Aynı yenilemede yeniden
  yazılan, tolerans içindeki ve bu işle ilgisi olmayan altı taban geri alındı (`editor-bos` telefon, `yol-kes-sonuc`
  masaüstü, `yol-yazi-bulut-secim` / `-kodsuz` iki görünüm). Sonra rapor tabanlarla karşılaştırılarak yeniden koşuldu: farklı ekran **0**. Bu rapor o koşudur.
- **Gürültü mü, bu iş mi?** Aynı kodla üç tam koşuda editör TBT'si 248 → 157 → 268 ms çıktı (önceki rapor: 167). Bu
  yüzden yalnızca `--only=perf` ile, bu işin `web/src` + `web/tests`'i ile öncekinin (`5911725`) sırayla üçer kez
  ölçüldü (aynı makine, aynı saat; makinede başka işler de vardı). Editör: bu iş 165 / 226 / 229 ms, önceki 228 / 186 /
  171 ms; sihirbaz: bu iş 163 / 156 / 184, önceki 146 / 149 / 129; ana ekran (bu işin dokunmadığı sayfa): bu iş 124 /
  168 / 134, önceki 137 / 246 / 143. Aynı kodun iki ölçümü arasındaki fark (≈ 60–110 ms) iki kod arasındaki farktan
  büyük; önceki kod da bu koşullarda bütçeyi aştı (228 ms). JS: editör 293 KB / 16 dosya (önce 294 KB / 17), sihirbaz
  ve ana ekran aynı. Ölçülen sihirbaz sayfası `/yap/dikey/`: Yazıya dök'ün kodunu hiç yüklemez; bu işten ona giden tek
  şey her sayfanın taşıdığı söz tablosuna eklenen ≈ 2 KB cümle. Yine de orada bu iş üç çiftin üçünde de biraz yüksek
  (17, 7 ve 55 ms). Sonuç: bu işe bağlanabilen bir yavaşlama **gösterilemedi**, ama yokluğu da kanıtlanmadı — boş bir
  makinede yeniden bakılmalı. Bütçe gevşetilmedi; iki ölçü raporda bütçe dışı duruyor.
- Soru penceresi (“Saklanan bir projen var”) bu katmanda da **ölçülmüyor** (yürüyüş boş depoyla başlar); olağan
  e2e'de (`transcript-keep.spec.ts`) sınanıyor.

### 13 Ekim (akşam) — internette yazılan yazı editöre geçişte saklanır (ADR-034 eki; dal `worktree-agent-a2b52e38355c6d5f7`)

Yayındaki sitede görünen bir şey değişmedi (bulut yolu kapalı). Aşağıdaki “açık bulgu” (yazı kalıcı projeye yalnızca
yedek dosyasıyla geçiyor) **kapandı**: “Kim konuştu” tablosunda “sayfa yenilenince” artık yedek dosyası olmadan,
editöre geçişin sakladığı projenin kendi sayfası yenilenerek ölçülüyor. Yeni sütun “editöre geçince depoda”; yedek
dosyası deposu boş başka bir tarayıcıda açılıyor. Hepsi **4 / 4**, SRT **0** — masaüstü ve telefon (sahte sunucuya karşı).

- 643 ölçü: 566 bütçe içinde, **8 dışında** (aynı yedi arama ölçüsü ve `out.notFaststart`; bu işten yeni bütçe dışı
  ölçü yok), 5 ölçülemedi (model dosyaları yok), 64 bütçesiz.
- Bulut akışının yazı ekranı **110 → 122 kelime** (bütçe ≤ 180): eklenen tek cümle “Bu yazı henüz saklanmadı: …”.
  Tıklama, karar ekranı ve teknik terim sayıları değişmedi.
- **Ekran tabanları:** ilk koşuda üç ekran “farklı” çıktı — hepsi eklenen cümle (`yol-yazi-bulut-yazi` iki görünüm,
  `yol-yazi-bulut-sonuc` telefon). Ekranlara bakıldı; yalnızca bulut yürüyüşünün tabanları yenilendi
  (`--only=walkthrough --grep="internet route" --update-baselines`), sonra bütün rapor tabanlarla karşılaştırılarak
  yeniden koşuldu: farklı ekran 0. Depoya giren taban değişikliği dört resim: `yol-yazi-bulut-yazi` ve
  `yol-yazi-bulut-sonuc`, iki görünüm (masaüstü `sonuc` %0,4 ile tolerans içindeydi; o da bir satır uzadı).
  Yenileme sırasında yeniden yazılan seçim ekranı tabanları geri alındı (içerikleri değişmemişti).
- Soru penceresi (“Saklanan bir projen var”) bu katmanda **ölçülmüyor** (yürüyüş boş depoyla başlar); bulut e2e’sinde sınanıyor.

### 13 Ekim — “kim konuştu” kalıcı (EDL v5, ADR-043; dal `worktree-agent-a08295f6ffb53c053`)

Yayındaki sitede görünen bir şey değişmedi (bulut yolu kapalı). **Yerel sahte sunucuya karşı** ölçülen yeni tablo
(bölüm 1, son tablo): betikteki iki kişinin dört konuşma sırası sonuç ekranında, editörde, yedek dosyasında,
yedekten açılan editörde, yenilemeden sonra depoda ve ekranda, VTT’de **4 / 4**; SRT’de “kişi” **0** — masaüstü ve
telefon. Bu, saklamanın ve göstermenin ölçüsüdür; kişi ayrımının doğruluğunu söylemez (sahte sunucu duymaz).

- Bu koşuda 641 ölçü: 564 bütçe içinde, **8 dışında** (yedi arama ölçüsü ve `out.notFaststart` — hepsi önceki
  koşulardaki açık maddeler; bu işten yeni bütçe dışı ölçü yok), 5 ölçülemedi (model dosyaları yok), 64 bütçesiz.
  Var olan ekran tabanları değişmedi; bulut akışının tıklama / ekran / kelime sayıları değişmedi.
- **Açık bulgu (ölçü değil, yol):** sihirbaz proje saklamadığı için internette yazılan yazı kalıcı projeye yalnızca
  yedek dosyasıyla geçiyor; tablonun “yedekten açılan editör” sütunları o yolu ölçer. Ayrıntı ve seçenekler ADR-043.

### 11 Ekim akşamı — bulut yazıya dökme yolu eklendi (kapalı; dal `worktree-agent-a4ba1c069e813cc66`)

Yayındaki sitede bir şey değişmedi; aşağıdakiler yalnızca yolun açık olduğu derlemeyle ilgilidir ve
**yerel bir sahte sunucuya karşı** ölçüldü (bölüm 1, son tablo). Yazının doğruluğu hakkında bir şey söylemezler.

- **Yeni bütçe dışı ölçü: rıza ekranındaki bir cümle “çok zor” çıkıyor** (`text.defaultPath.veryHard` 0 → 1).
  Cümle kurucunun onayladığı metindir: “AssemblyAI adlı şirketin Avrupa’daki bilgisayarlarına gider.” (Ateşman 29,2;
  uzun kelimeler: “bilgisayarlarına”, “Avrupa’daki”). Metne dokunulmadı, bütçe gevşetilmedi. Daha kolay bir
  söyleyiş kurucu kararıdır — örneğin “AssemblyAI adlı bir şirkete gider. Bilgisayarları Avrupa’da.”
- Rıza ekranı (kodsuz hâli) 109 kelime: ana ekranla (105) aynı düzeyde, bütçe (180) içinde. Akış masaüstünde 5,
  telefonda 6 basış (davet kodu bir kez yazılır); teknik terim 0; adıyla bulunamayan düğme 0; giden tek dosya
  85 KB’lık bir ses dosyası; sahte sunucuda kalan kayıt 0.
- Bulut cümleleri okunabilirlik ölçümüne katıldı (bölüm 9): toplam dize sayısı bu yüzden arttı.

### Hâlâ açık

1. **Arama beş istekten birinde doğru işi hiç göstermiyor.** Yeni kör kümede (aşağıda, madde 4) doğru iş ilk satırda %75,7, ilk üç satırda %80,4 (bütçeler ≥ %85 ve ≥ %90); yapılabilen işlerin %12,2’sine “Bunu bulamadım.” deniyor. Uzun, derdini anlatan cümlelerde doğrudan doğru cevap %35 (40 ifade); “Yazıya dök” isteyen 13 ifadenin 2’si doğrudan doğru. Madde 4’teki değişiklik **sıralamayı değiştirmedi**; yanlış karta göndermeyi azalttı, bulamamayı azaltmadı. Yedi arama bütçesi dışarıda: ilk satır, ilk üç, yapılabilen işe “yapamıyoruz” (%2), “yapamıyoruz” yakalama (%88) ve isabet (%88,2), listede olmayan isteğe dürüst cevap (%65: 20 ifadenin 3’üne hâlâ tek kart, 4’üne soru), anlamsız yazı (%88,9: 9 ifadenin 1’i). Kelime listesi + ek kuralıyla iki turda düzelmedi; gerçek kullanıcı cümleleri ya da cihazda küçük bir anlam modeli gerekir. Kanıt: bölüm 2.

2. **Kaydedilen dosyaların hiçbirinde dizin başta değil (10 / 10).** Bu çalışmanın kapsamı dışındaydı; değişmedi. Kanıt: bölüm 5.

3. **Editörün açılışı telefonda artık sınırdan uzak (15 Ekim).** Mobil kısıtlamada TBT 141 ms (130–158); önce 176–268 ms arasında, sınırın iki yanına düşüyordu. Ayrıntı en üstte (15 Ekim). Kanıt: bölüm 7.

### Düzeltilenler (önce → şimdi)

4. **Arama emin değilken tek karta göndermek yerine soruyor** (`fd6ce81`, `d8ad0b5`; ADR-034 eki). Sıralama aynı; değişen sunuş: kelimeler işi belirlemiyorsa satırlar birer seçenektir (“Bunu mu demek istedin?”, altında “Tam emin olamadım. Hangisini istiyorsan ona bas.”), hiçbiri seçili değildir ve **Enter hiçbir şey başlatmaz**. Kendisine yalnızca işlerin listesi verilen bir yazarın yazdığı, kural dondurulduktan sonra bir kez ölçülen kör kümede (280 ifade; daha önce görülen 78’i sayılmadı, sayılan 202):
   - **yanlış ama emin** (tek cevap, yanlış iş) %12,4 (25 kart) → **%3,0** (6 kart) — bütçe ≤ %5, ilk kez içinde;
   - sordu: %25,2 (51 kez; 16’sında tek seçenek, 7’si yapılabilen bir iş değildi); yapılabilen işlerde %29,7 (bütçe ≤ %33);
   - sorduğunda doğru iş seçeneklerde: %88,6 (44 sorunun 39’u; bütçe ≥ %80);
   - açık yazılmış isteğe soru: %5,6 (18 ifadeden 1’i; bütçe ≤ %15);
   - **bedeli:** doğrudan doğru cevap %75,7 → %54,1; yeniden yazmadan doğru işe varma %75,7 → %80,4.
   - **Kirlenmiş kümeler, başlık değil** (kural bunlara bakılarak ayarlandı): `search-eval-fresh2.ts` %12,0 → %1,0; `search-eval-fresh.ts` → %0; `HELD_OUT` %3,1 → %0,9; `DEV` → %0.
   - Üçüncü bağımsız kümede de eski aramanın yanlış kart oranı %12 çıktı (%12,2, %12,0, %12,4).
   Önce / sonra ekranları: `docs/ux/2026-10-11-did-you-mean/`.

5. **Editör videonun boyutunu izliyor** (`8d73554`, ADR-041). Editör doğrudan açılıp hiçbir ayara dokunulmadan: 1280 × 720 kaynaktan kesit 1920 × 1080, baştan sona yeniden kodlanmış → **1280 × 720, görüntüye dokunulmadan** (hızlı kesim; `export-method` öznitelikleri “Kes” sihirbazındakiyle aynı — e2e `own-size.spec.ts`). “Ayarlar”daki seçim artık bir üst sınır (“Videonun kendi boyutu (en çok 1080p)”, “En çok 720p”) ve altında gerçek boyut yazıyor.

6. **Hiçbir yol görüntüyü büyütmüyor** (`8d73554`, ADR-041, belge 15 v9). Dokuz yol × üç kaynak (640 × 360, 854 × 480, 1280 × 720), kaydedilen dosyada: kaynağından büyük çıkan **0 / 27** (bölüm 5, “Büyütme yok”). Önceki kuralla (bu kaynaklarla yeniden ölçülmedi; eski kuraldan ve eski e2e beklentilerinden): editör üçünü de 1920 × 1080 yapıyordu; sihirbazlar 360p ve 480p kaynağı 1280 × 720; Dikey yap üçünü de 1080 × 1920. Şimdi: kendi biçiminde kalan yollarda 640 × 360 / 854 × 480 / 1280 × 720; Dikey yap (Doldur) 202 × 360 / 270 × 480 / 406 × 720 — kestiği dilimin kendisi. Yan kazanç: 360p ve 480p kaynakta Kes, Boşlukları at, Müzik ekle ve Sesi kapat artık görüntüyü yeniden kodlamıyor (tabloda “kopya” / “karma”).

### Bilinmesi gerekenler

- **“Dikey yap” küçük videodan küçük dikey video verir** (1280 × 720’den 406 × 720). Kural gereği doğru ve sihirbaz indirmeden önce söylüyor; paylaşım sitelerinin bunu nasıl karşıladığı ÖLÇÜLMEDİ. Kurucu kararı gerekebilir (ADR-041, “Kurucuya”).
- **“Sığdır”** görüntüyü büyütmez ama çevresine boşluk ekler: 640 × 360 → 640 × 1138. Kaynağından fazla pikseli olan tek durum budur; fazlası siyah boşluktur. Kalite tablosu “Doldur”u ölçer.
- **İki taban, iki büyütme istisnası:** kısa kenarı 144’ün altındaki görüntü 144’e; içine altyazı gömülen ve kısa kenarı 360’ın altındaki görüntü 360’a getirilir (ADR-041).
- **Kaynağından büyük indirme seçeneği yok.** İstenirse “Ayarlar”a açık bir seçenek olarak eklenir (şema alanı gerekir).
- **Ölçüm temizliği (arama):** eminlik kuralı yalnızca görülmüş kümelerde ayarlandı; yeni küme ölçümden önce okunmadı; ölçümden sonra arama koduna dokunulmadı. Yeni bütçelerin değerleri ölçümle aynı oturumda yazıldı, `DEV` bütçesi bir kez düzeltildi (≤ %12 → ≤ %15: ilk değer raporun saymadığı ifadeleri de sayan bir hesaba dayanıyordu). Yeni kümenin kaçanları bu raporda yazılı: bir sonraki arama çalışması dördüncü bir küme yazdırmalı.
- **Donanım kodlayıcı ölçülmedi.** Bütün dosyalar Playwright’ın Chromium’unda (yazılım kodlayıcı) üretildi; gerçek Chrome / Edge’in 360p’nin altındaki karelerde (202 × 360) ne yaptığı bilinmiyor.
- **Görsel tabanlar** ekranlara bakıldıktan sonra yenilendi: `sihirbaz-dikey-secim` (iki görünüm; boyutu söyleyen cümle uzadı, telefonda bir satır daha), `yol-muzik-sonuc` ve `yol-kes-sonuc` (sonuç satırı), yeni ekran `ana-ekran-soru`.
- **“Yazıya dök”** bu koşuda model dosyaları olmadığı için ölçülmedi (4 yürüyüş ölçüsü + gerçek model WER’i “ölçülemedi”).
- **Ölçülmeyen:** gerçek telefon, Safari / Firefox, gerçek çekimler, tarayıcı matrisi, gerçek kullanıcı cümleleri.
- **İyi olanlar:** dokuz görevin dokuzu en çok 4 tıklamayla (telefonda 5) doğru dosyayı verdi; hata hücreleri 74 / 0 / 0; ilerleme çubuğu hiç geri gitmedi, iptalden sonra bayt kalmadı; eklenen ses–görüntü sapması en çok 1 ms, süre hatası en çok 16 ms; varsayılan yolda teknik terim içeren cümle 0; telefonda 44 px’ten küçük hedef 0.

### Açık kalan

- Ürün adı ya da ekran düzeni bilerek değiştiğinde görsel tabanların hepsi “farklı” çıkar; ekranlara bakıldıktan sonra `--update-baselines` ile yenilenmeli. `docs/quality/diffs/` yalnızca farklı ekran varken üretilir; rapor ona bağ veriyorsa raporla birlikte commit edilir.

## Özet

967 ölçü: **852 bütçe içinde**, **16 bütçe dışı**, **9 ölçülemedi**, 90 bütçesiz (yalnızca bildirilir). Bütçeler: `web/scripts/quality/budgets.json`.


| Bölüm | Ölçüm zamanı | Derleme | Bütçe içinde | Bütçe dışı | Ölçülemedi | Bütçesiz |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Görev tamamlama yürüyüşleri | 2026-10-20 21:11 UTC | statik çıktı + test kancalı + bulut (sahte sunucu) | 470 | 0 | **8** | 0 |
| 2. Arama kalitesi | 2026-10-20 21:08 UTC | tarayıcısız | 11 | **12** | 0 | 51 |
| 3. Hata yolları | 2026-10-20 21:12 UTC | statik çıktı | 5 | 0 | 0 | 2 |
| 4. Dürüstlük denetimleri | 2026-10-20 21:13 UTC | statik çıktı | 22 | 0 | 0 | 0 |
| 5. Çıktı kalitesi | 2026-10-20 21:16 UTC | statik çıktı | 74 | **1** | 0 | 0 |
| 6. Yazıya dökme kalitesi | koşulmadı | — | 0 | 0 | **1** | 8 |
| 7. Performans bütçeleri | 2026-10-20 21:18 UTC | statik çıktı | 39 | 0 | 0 | 0 |
| 8. Görsel regresyon | 2026-10-20 21:19 UTC | statik çıktı + bulut (sahte sunucu) + test kancalı | 2 | 0 | 0 | 2 |
| 9. Erişilebilirlik ve çocuk-dostu ölçüler | 2026-10-20 21:19 UTC | statik çıktı + tarayıcısız | 229 | **3** | 0 | 27 |

**Başlık sayıları**


| Ölçü | Değer |
| --- | --- |
| Dosyası doğrulanan görev (Yazıya dök hariç; masaüstü / telefon) | 11 / 11 · 11 / 11 |
| Ana ekrandan dosyaya en çok tıklama (masaüstü / telefon) | 4 / 5 |
| Varsayılan yolda görülen, teknik terim içeren farklı cümle | 0 |
| Arama (yeni ayrı küme): ilk satır doğru / ilk üçte / yanlış ama emin | %77,2 / %81,9 / %3 |
| Arama: sordu (“Bunu mu demek istedin?”) / sorduğunda doğrusu seçeneklerde / açık isteğe soru / doğrudan doğru | %25,2 / %88,6 / %5,6 / %55,7 |
| Arama, eski küme (KİRLENMİŞ): ilk satır doğru / yanlış ama emin | %93,6 / %0,9 |
| Hata hücreleri: iyi / belirsiz / bozuk | 82 / 0 / 0 |
| İlerleme çubuğu geri gitti (kez) · iptalden sonra kalan bayt | 0 · 0 |
| Kaynağından büyük çıkan dosya (9 yol × 360p, 480p, 720p kaynak) | 0 / 30 |
| Eklenen ses–görüntü sapması (en kötü) · süre hatası (en kötü) | 1 ms · 16 ms |
| Görüntü sadakati, en düşük: SSIM · VMAF | 0,9658 · 84,6 |
| Küçült → WhatsApp hedefe sığdı | evet |
| Ana ekran: LCP (mobil kısıtlama) · aktarılan JS | 608 ms · 192 KB |
| En yavaş yeniden işleme hızı | 2,2 × gerçek zaman |
| Tabanından farklı ekran | 0 |
| Telefonda 44 px’ten küçük dokunma hedefi · adsız kontrol | 1 · 0 |
| Okunabilirlik (varsayılan yol): ortanca Ateşman · zor metin payı | 85,9 · %1,6 |

**Bütçe dışı ölçüler** (16)


| Ölçü | Değer | Bütçe |
| --- | --- | --- |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) | %77,2 | ≥ %85 |
| İlk üç satırda var | %81,9 | ≥ %90 |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %2 | ≤ %0 |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) | %87,5 | ≥ %95 |
| “Bunu henüz yapamıyoruz.” — isabet (precision) | %87,5 | ≥ %95 |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) | %65 | ≥ %80 |
| Anlamsız yazı / sohbete kart önerilmedi | %88,9 | ≥ %90 |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) (İngilizce kör küme) | %76,2 | ≥ %85 |
| İlk üç satırda var (İngilizce kör küme) | %79,5 | ≥ %90 |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” (İngilizce kör küme) | %0,8 | ≤ %0 |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) (İngilizce kör küme) | %85,7 | ≥ %95 |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) (İngilizce kör küme) | %62,5 | ≥ %80 |
| Dizini (moov) sonda olan dosya — “faststart” değil | 10 / 10 | ≤ 0 |
| Editör, video yok (telefon): 44 px’ten küçük dokunma hedefi | 1 | ≤ 0 |
| Editör, video yok (telefon): 24 px’ten küçük hedef | 1 | ≤ 0 |
| Editör, video yok (telefon): Tab ile ulaşılamayan kontrol | 1 | ≤ 0 |

**Ölçülemeyenler** (9)


| Ölçü | Neden |
| --- | --- |
| Yazıya dök (masaüstü): dosya çıktı ve doğru | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Yazıya dök (masaüstü): karttan dosyaya süre | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Yazıya dök (telefon): dosya çıktı ve doğru | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Yazıya dök (telefon): karttan dosyaya süre | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Speech to text (masaüstü EN): dosya çıktı ve doğru | “Download the model (≈108.8 MB, once)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Speech to text (masaüstü EN): karttan dosyaya süre | “Download the model (≈108.8 MB, once)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Speech to text (telefon EN): dosya çıktı ve doğru | “Download the model (≈108.8 MB, once)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Speech to text (telefon EN): karttan dosyaya süre | “Download the model (≈108.8 MB, once)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Gerçek küçük model, tek cümle: WER | `--with-transcript` verilmedi; varsayılan koşu modeli çalıştırmaz |

Tablolarda **kalın** yazılan değer bütçesinin dışındadır; “ölçülemedi” yazan hücre ölçülememiştir, sıfır değildir.

## 1. Görev tamamlama yürüyüşleri

Betikli “ilk kez kullanan”: ana ekrandan başlar, yalnızca görünen ve adıyla bulunabilen düğmelere basar (test kimliği kullanmaz), küçük bir deneme videosuyla işi bitirir, kaydedilen dosya ffprobe / ffmpeg ile denetlenir. Derleme: yayınlanan statik çıktı. Sistem pencereleri (dosya seçme, masaüstünde kaydetme) uygulamanın tıklaması sayılmaz. Süre, hiç duraksamayan bir betiğin süresidir: alt sınırdır.

**masaüstü (1440 × 900)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kes | evet | 4 | 2 | 1 | 3 | 152 | 292 | 1,6 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 3 | 0 | 1 | 4 | 117 | 247 | 1,5 sn | 0 | 0 | 0 |
| Dikey yap | evet | 3 | 0 | 1 | 4 | 117 | 245 | 1,5 sn | 0 | 0 | 0 |
| Küçült | evet | 3 | 0 | 1 | 4 | 117 | 282 | 4 sn | 0 | 0 | 0 |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 117 | 208 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 4 | 0 | 1 | 4 | 117 | 238 | 1,4 sn | 0 | 0 | 0 |
| Sesini al | evet | 3 | 0 | 0 | 4 | 117 | 239 | 1,4 sn | 0 | 0 | 0 |
| Sesi kapat | evet | 3 | 0 | 0 | 4 | 117 | 230 | 0,9 sn | 0 | 0 | 0 |
| Sesi düzelt | evet | 3 | 0 | 0 | 4 | 117 | 240 | 2,2 sn | 0 | 0 | 0 |
| Her yerde açılsın | evet | 3 | 0 | 0 | 4 | 117 | 246 | 1,4 sn | 0 | 0 | 0 |
| İyileştir | evet | 3 | 0 | 1 | 4 | 136 | 334 | 4,7 sn | 0 | 0 | 0 |
| GIF yap | evet | 3 | 1 | 1 | 4 | 117 | 248 | 3,5 sn | 0 | 0 | 0 |

Notlar (masaüstü (1440 × 900)):

- **Yazıya dök:** “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**telefon (390 × 844, dokunmatik)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kes | evet | 5 | 2 | 1 | 3 | 117 | 236 | 1,7 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 4 | 0 | 1 | 4 | 117 | 260 | 1 sn | 0 | 0 | 0 |
| Dikey yap | evet | 4 | 0 | 1 | 4 | 117 | 257 | 1,4 sn | 0 | 0 | 0 |
| Küçült | evet | 4 | 0 | 1 | 4 | 117 | 294 | 4 sn | 0 | 0 | 0 |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 117 | 210 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 5 | 0 | 1 | 4 | 117 | 250 | 1,5 sn | 0 | 0 | 0 |
| Sesini al | evet | 4 | 0 | 0 | 4 | 117 | 251 | 1,4 sn | 0 | 0 | 0 |
| Sesi kapat | evet | 4 | 0 | 0 | 4 | 117 | 242 | 0,9 sn | 0 | 0 | 0 |
| Sesi düzelt | evet | 4 | 0 | 0 | 4 | 117 | 252 | 2,2 sn | 0 | 0 | 0 |
| Her yerde açılsın | evet | 4 | 0 | 0 | 4 | 117 | 258 | 1,4 sn | 0 | 0 | 0 |
| İyileştir | evet | 4 | 0 | 1 | 4 | 136 | 348 | 4,8 sn | 0 | 0 | 0 |
| GIF yap | evet | 4 | 1 | 1 | 4 | 117 | 251 | 3,6 sn | 0 | 0 | 0 |

Notlar (telefon (390 × 844, dokunmatik)):

- **Yazıya dök:** “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**masaüstü, İngilizce (1440 × 900, en-US)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cut | evet | 4 | 2 | 1 | 3 | 159 | 351 | 1,5 sn | 0 | 0 | 0 |
| Remove silences | evet | 3 | 0 | 1 | 4 | 159 | 327 | 1,5 sn | 0 | 0 | 0 |
| Make it vertical | evet | 3 | 0 | 1 | 4 | 159 | 343 | 1,5 sn | 0 | 0 | 0 |
| Shrink | evet | 3 | 0 | 1 | 4 | 159 | 383 | 4,5 sn | 0 | 0 | 0 |
| Speech to text | ölçülemedi | 2 | 0 | 1 | 3 | 159 | 288 | ölçülemedi | 0 | 0 | 0 |
| Add music | evet | 4 | 0 | 1 | 4 | 159 | 331 | 1,5 sn | 0 | 0 | 0 |
| Get the sound | evet | 3 | 0 | 0 | 4 | 159 | 326 | 1,4 sn | 0 | 0 | 0 |
| Mute | evet | 3 | 0 | 0 | 4 | 159 | 319 | 1 sn | 0 | 0 | 0 |
| Fix the sound | evet | 3 | 0 | 0 | 4 | 159 | 338 | 2,2 sn | 0 | 0 | 0 |
| Make it play everywhere | evet | 3 | 0 | 0 | 4 | 159 | 337 | 1,4 sn | 0 | 0 | 0 |
| Enhance | evet | 3 | 0 | 1 | 4 | 159 | 423 | 4,7 sn | 0 | 0 | 0 |
| Make a GIF | evet | 3 | 1 | 1 | 4 | 159 | 338 | 3,5 sn | 0 | 0 | 0 |

Notlar (masaüstü, İngilizce (1440 × 900, en-US)):

- **Speech to text:** “Download the model (≈108.8 MB, once)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**telefon, İngilizce (390 × 844, dokunmatik, en-US)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cut | evet | 5 | 2 | 1 | 3 | 159 | 287 | 1,6 sn | 0 | 0 | 0 |
| Remove silences | evet | 4 | 0 | 1 | 4 | 159 | 347 | 1,5 sn | 0 | 0 | 0 |
| Make it vertical | evet | 4 | 0 | 1 | 4 | 159 | 363 | 1,4 sn | 0 | 0 | 0 |
| Shrink | evet | 4 | 0 | 1 | 4 | 159 | 403 | 4 sn | 0 | 0 | 0 |
| Speech to text | ölçülemedi | 2 | 0 | 1 | 3 | 159 | 292 | ölçülemedi | 0 | 0 | 0 |
| Add music | evet | 5 | 0 | 1 | 4 | 159 | 350 | 1 sn | 0 | 0 | 0 |
| Get the sound | evet | 4 | 0 | 0 | 4 | 159 | 346 | 1,4 sn | 0 | 0 | 0 |
| Mute | evet | 4 | 0 | 0 | 4 | 159 | 339 | 0,9 sn | 0 | 0 | 0 |
| Fix the sound | evet | 4 | 0 | 0 | 4 | 159 | 358 | 2,2 sn | 0 | 0 | 0 |
| Make it play everywhere | evet | 4 | 0 | 0 | 4 | 159 | 356 | 1,4 sn | 0 | 0 | 0 |
| Enhance | evet | 4 | 0 | 1 | 4 | 159 | 445 | 4,8 sn | 0 | 0 | 0 |
| Make a GIF | evet | 4 | 1 | 1 | 4 | 159 | 347 | 3,5 sn | 0 | 0 | 0 |

Notlar (telefon, İngilizce (390 × 844, dokunmatik, en-US)):

- **Speech to text:** “Download the model (≈108.8 MB, once)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**Varsayılan yolda görülen teknik terimler** (Ayarlar ve Ayrıntılar açılmadan; liste: `web/tests/quality/lib/jargon.ts`)
_Yok._

Yarı teknik (sayıldı, yargılanmadı): MP4 / MOV / WebM × 156 · 9:16 / 1080 × 1920 × 4 · MB / GB × 58 · M4A / MP3 / WAV × 14 · model × 14

**Çıkan dosyalar** (ffprobe)

| Görev | Görünüm | Kaynak | Dosya | Süre | İzler | Denetimler |
| --- | --- | --- | --- | --- | --- | --- |
| Kes | masaüstü | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 83 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (82.744 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü kaynaktan büyük değil (1280 × 720 → 1280 × 720); tuttu: kesit, videonun tamamından küçük (472,91 KB → 82,74 KB) |
| Cut | masaüstü EN | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 83 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (82.744 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü kaynaktan büyük değil (1280 × 720 → 1280 × 720); tuttu: kesit, videonun tamamından küçük (472,91 KB → 82,74 KB) |
| Kes | telefon | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 83 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (82.744 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü kaynaktan büyük değil (1280 × 720 → 1280 × 720); tuttu: kesit, videonun tamamından küçük (472,91 KB → 82,74 KB) |
| Cut | telefon EN | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 83 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (82.744 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü kaynaktan büyük değil (1280 × 720 → 1280 × 720); tuttu: kesit, videonun tamamından küçük (472,91 KB → 82,74 KB) |
| Boşlukları at | masaüstü | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 62 KB, 256 × 144 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (62.140 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Remove silences | masaüstü EN | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 62 KB, 256 × 144 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (62.140 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Boşlukları at | telefon | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 62 KB, 256 × 144 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (62.140 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Remove silences | telefon EN | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 62 KB, 256 × 144 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (62.140 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | masaüstü | other-8s.mp4 (640 × 360 yatay, 8 sn) | 385 KB, 202 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (384.942 bayt); tuttu: dikey (9:16) ve kaynaktan büyük değil (202 × 360); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Make it vertical | masaüstü EN | other-8s.mp4 (640 × 360 yatay, 8 sn) | 385 KB, 202 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (384.942 bayt); tuttu: dikey (9:16) ve kaynaktan büyük değil (202 × 360); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | telefon | other-8s.mp4 (640 × 360 yatay, 8 sn) | 385 KB, 202 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (384.942 bayt); tuttu: dikey (9:16) ve kaynaktan büyük değil (202 × 360); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Make it vertical | telefon EN | other-8s.mp4 (640 × 360 yatay, 8 sn) | 385 KB, 202 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (384.942 bayt); tuttu: dikey (9:16) ve kaynaktan büyük değil (202 × 360); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Küçült | masaüstü | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.035 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.034.817 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,03 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,03 MB) |
| Shrink | masaüstü EN | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.022 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.022.025 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,02 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,02 MB) |
| Küçült | telefon | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.034 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.034.284 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,03 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,03 MB) |
| Shrink | telefon EN | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.032 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.032.251 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,03 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,03 MB) |
| Yazıya dök | masaüstü | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Speech to text | masaüstü EN | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Yazıya dök | telefon | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Speech to text | telefon EN | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Müzik ekle | masaüstü | other-8s.mp4 + tone-30s.m4a | 184 KB, 640 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (183.809 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Add music | masaüstü EN | other-8s.mp4 + tone-30s.m4a | 184 KB, 640 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (183.809 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Müzik ekle | telefon | other-8s.mp4 + tone-30s.m4a | 184 KB, 640 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (183.809 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Add music | telefon EN | other-8s.mp4 + tone-30s.m4a | 184 KB, 640 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (183.809 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Sesini al | masaüstü | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Get the sound | masaüstü EN | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesini al | telefon | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Get the sound | telefon EN | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesi kapat | masaüstü | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Mute | masaüstü EN | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Sesi kapat | telefon | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Mute | telefon EN | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Sesi düzelt | masaüstü | kisik-konusma.mp4 (640 × 360, 16 sn, yapay ses, yaklaşık −38 LUFS) | 1.872 KB, 640 × 360 | 16,38 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.871.877 bayt); tuttu: süre ≈ 16,37 sn (16,384 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: −16 LUFS (±1) (-16 LUFS); tuttu: gerçek tepe ≤ −1 dBTP (-4,7 dBTP) |
| Fix the sound | masaüstü EN | kisik-konusma.mp4 (640 × 360, 16 sn, yapay ses, yaklaşık −38 LUFS) | 1.872 KB, 640 × 360 | 16,38 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.871.877 bayt); tuttu: süre ≈ 16,37 sn (16,384 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: −16 LUFS (±1) (-16 LUFS); tuttu: gerçek tepe ≤ −1 dBTP (-4,7 dBTP) |
| Sesi düzelt | telefon | kisik-konusma.mp4 (640 × 360, 16 sn, yapay ses, yaklaşık −38 LUFS) | 1.872 KB, 640 × 360 | 16,38 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.871.877 bayt); tuttu: süre ≈ 16,37 sn (16,384 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: −16 LUFS (±1) (-16 LUFS); tuttu: gerçek tepe ≤ −1 dBTP (-4,7 dBTP) |
| Fix the sound | telefon EN | kisik-konusma.mp4 (640 × 360, 16 sn, yapay ses, yaklaşık −38 LUFS) | 1.872 KB, 640 × 360 | 16,38 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.871.877 bayt); tuttu: süre ≈ 16,37 sn (16,384 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: −16 LUFS (±1) (-16 LUFS); tuttu: gerçek tepe ≤ −1 dBTP (-4,7 dBTP) |
| Her yerde açılsın | masaüstü | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 503 KB, 640 × 360 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (502.990 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| Make it play everywhere | masaüstü EN | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 503 KB, 640 × 360 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (502.990 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| Her yerde açılsın | telefon | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 503 KB, 640 × 360 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (502.990 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| Make it play everywhere | telefon EN | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 503 KB, 640 × 360 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (502.990 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| İyileştir | masaüstü | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.824 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.823.807 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |
| Enhance | masaüstü EN | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.823 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.823.035 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |
| İyileştir | telefon | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.827 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.827.477 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |
| Enhance | telefon EN | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.823 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.823.462 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |
| GIF yap | masaüstü | sample-24s.mp4 (1280 × 720, 24 sn); üste yazı yazılır, kısım ve boyut değiştirilmeden | 286 KB, 480 × 270 | 4 sn | video:gif | tuttu: dosya boş değil (286.487 bayt); tuttu: GIF (gif / gif); tuttu: 480 × 270 (Orta, kaynaktan büyük değil) (480 × 270); tuttu: 50 kare, 4 sn, durmadan döner (50 kare, 4 sn, döngü 0) |
| Make a GIF | masaüstü EN | sample-24s.mp4 (1280 × 720, 24 sn); üste yazı yazılır, kısım ve boyut değiştirilmeden | 286 KB, 480 × 270 | 4 sn | video:gif | tuttu: dosya boş değil (286.487 bayt); tuttu: GIF (gif / gif); tuttu: 480 × 270 (Orta, kaynaktan büyük değil) (480 × 270); tuttu: 50 kare, 4 sn, durmadan döner (50 kare, 4 sn, döngü 0) |
| GIF yap | telefon | sample-24s.mp4 (1280 × 720, 24 sn); üste yazı yazılır, kısım ve boyut değiştirilmeden | 286 KB, 480 × 270 | 4 sn | video:gif | tuttu: dosya boş değil (286.487 bayt); tuttu: GIF (gif / gif); tuttu: 480 × 270 (Orta, kaynaktan büyük değil) (480 × 270); tuttu: 50 kare, 4 sn, durmadan döner (50 kare, 4 sn, döngü 0) |
| Make a GIF | telefon EN | sample-24s.mp4 (1280 × 720, 24 sn); üste yazı yazılır, kısım ve boyut değiştirilmeden | 286 KB, 480 × 270 | 4 sn | video:gif | tuttu: dosya boş değil (286.487 bayt); tuttu: GIF (gif / gif); tuttu: 480 × 270 (Orta, kaynaktan büyük değil) (480 × 270); tuttu: 50 kare, 4 sn, durmadan döner (50 kare, 4 sn, döngü 0) |

**Yazıya dök, baştan sona — TEST KANCALI derleme, betikli tanıyıcı**
Bu satırlar `CLIP_TEST_HOOKS=1` derlemesinde, küçük bir model listesi ve konuşmayı DUYMAYAN betikli bir tanıyıcıyla alındı. Ölçülen şey akıştır (tıklama, ekran, kelime, dosyanın çıkması). **Yazının doğruluğu hakkında hiçbir şey söylemez** (bkz. bölüm 6).


| Görünüm | Dosya çıktı | Tıklama | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Karttan dosyaya | Teknik terim | Adıyla bulunamayan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | evet | 5 | 1 | 4 | 117 | 6,2 sn (model 360 KB’lık test dosyası) | 0 | 0 |
| telefon | evet | 6 | 1 | 4 | 117 | 5,6 sn (model 360 KB’lık test dosyası) | 0 | 0 |

**Yazıya dök → İnternette, baştan sona — SAHTE SUNUCUYA KARŞI (bulut derlemesi; yayındaki sitede bu yol yok)**
Bu satırlar, vekil sunucumuzun **yerel bir sahtesine** (`cloud/fake-worker/`, 127.0.0.1) karşı, bulut yolunun açık olduğu test kancalı derlemede alındı. Hiçbir dış hizmete istek atılmadı. Sahte sunucu konuşmayı DUYMAZ; betikte yazan kelimeleri döndürür. Ölçülen şey rıza ekranının ve akışın kendisidir (tıklama, ekran, okunacak kelime, sade dil, dosyanın çıkması, giden şeyin yalnız ses olması). **Yazının doğruluğu, hızı ya da gerçek sunucunun davranışı hakkında hiçbir şey söylemez.**


| Görünüm | Dosya çıktı | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Teknik terim | Adıyla bulunamayan | Giden dosya | Sunucuda kalan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | evet | 5 | 1 | 1 | 5 | 132 | 0 | 0 | 1 × audio/webm, 85 KB | 0 |
| telefon | evet | 6 | 1 | 1 | 5 | 132 | 0 | 0 | 1 × audio/webm, 85 KB | 0 |

Ekran ekran okunacak kelime:

- masaüstü: “Ne yapmak istiyorsun?” (ana ekran) — 132 kelime
- masaüstü: “Videonu seç” (video seç) — 24 kelime
- masaüstü: “Yazıyı nerede çıkaralım?” (nerede (kodsuz)) — 110 kelime
- masaüstü: “Videonu yazıya dökelim” (yazı) — 122 kelime
- masaüstü: “Kaydedildi” (sonuç) — 69 kelime
- telefon: “Ne yapmak istiyorsun?” (ana ekran) — 132 kelime
- telefon: “Videonu seç” (video seç) — 20 kelime
- telefon: “Yazıyı nerede çıkaralım?” (nerede (kodsuz)) — 110 kelime
- telefon: “Videonu yazıya dökelim” (yazı) — 122 kelime
- telefon: “Videon hazır” (sonuç) — 86 kelime

**“Kim konuştu” kalıcı mı — SAHTE SUNUCUYA KARŞI (bulut derlemesi; yayındaki sitede bu yol yok)**
Betikteki yazıda iki kişi dört sırayla konuşur; yazının gösterildiği her yerde dört etiket beklenir (“1. kişi”, “2. kişi”, “1. kişi”, “2. kişi”). Sayılan: doğru yerde duran doğru etiket. İnternette yazılan yazı, sihirbazdan **editöre geçince** bu tarayıcıda proje olarak saklanır (ADR-034 eki, 13 Ekim 2026): “editöre geçince depoda”, “yenilemeden sonra depoda” ve “sayfa yenilenince” sütunları o yolu ölçer — arada yedek dosyası yoktur. “Yedekten açılan editör” ayrı bir yoldur: yedek dosyası, deposu boş başka bir tarayıcıda açılır. Altyazı dosyalarında: VTT konuşanı ses etiketiyle taşır, SRT taşımaz (ADR-043). Sahte sunucu kimin konuştuğunu DUYMAZ; betikte yazanı döndürür — gerçek sunucunun kişileri ne kadar doğru ayırdığı hakkında hiçbir şey söylemez.

| Görünüm | Beklenen | Sonuç ekranı | Editör | Editöre geçince depoda (satır) | Yenilemeden sonra depoda (satır) | Sayfa yenilenince | Yedek dosyası (satır) | Yedekten açılan editör (başka tarayıcı) | VTT ses etiketi | SRT’de “kişi” |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 0 |
| telefon | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 0 |

## 2. Arama kalitesi

Arama iki biçimde iş gösterir (ADR-034, 11 Ekim 2026 eki): **emin olduğunda** tek bir işi cevap diye sunar (satırı seçilidir, Enter onu başlatır); **emin olmadığında** “Bunu mu demek istedin?” diye 1–3 seçenek sorar, hiçbiri seçili değildir, kullanıcı seçmeden hiçbir şey başlamaz. “Yanlış ama emin” artık yalnızca birincisidir: tek cevap ve yanlış iş. Her zaman sormak bu sayıyı sıfırlardı; bu yüzden yanında ne sıklıkla sorduğu, sorduğunda doğru işin seçeneklerde olup olmadığı ve açık yazılmış bir isteğe soru sorup sormadığı da bütçelidir.

Beş küme var ve hangisinin ne olduğu önemlidir:

- **Yeni ayrı küme** (`web/tests/quality/data/search-eval-fresh3.ts`, 280 ifade; sayılan 202): kendisine yalnızca işlerin listesi ve birer satırlık açıklamaları verilen, aramanın kodunu, kelime listelerini, eşiklerini ve öteki ifadeleri GÖRMEYEN bir yazar tarafından yazıldı; eminlik kuralı dondurulduktan sonra BİR KEZ ölçüldü. **Başlık sayıları ve bütçeler bu kümedendir.** Kaçanları aşağıda yazılı olduğu için bundan sonra bu küme de görülmüş sayılır: arama onun kaçanlarına bakılarak ayarlanırsa yeni bir küme yazılmalıdır.
- **İkinci yeni küme** (`search-eval-fresh2.ts`, 243 ifade; sayılan 209): 10–11 Ekim raporlarının başlığıydı (o ölçüm: ilk sonuç doğru %81,8, yanlış ama emin %12,0). Kaçanları raporda yazılıydı ve eminlik kuralı bu kümeye de bakılarak ayarlandı: **artık ayar kümesidir**, bugünkü sayıları (yanlış ama emin %1, sordu %27,3) bir tahmin değildir.
- **İlk yeni küme** (`search-eval-fresh.ts`, 178 ifade; sayılan 139): 10 Ekim’den beri ayar kümesi (bugün: yanlış ama emin %0, sordu %12,9).
- **Eski ayrı küme** (`search-eval.ts` içindeki `HELD_OUT`, 282 ifade; sayılan 225): **KİRLENMİŞ.** 10 Ekim’deki arama çalışması bu kümenin kaçanları okunduktan sonra yapıldı; eminlik kuralı da ona bakılarak ayarlandı. Sayıları bir tahmin değildir.
- **Geliştirme kümesi** (`DEV`, 175 ifade): üzerinde ayar yapıldı; ölçüm değildir. Açık yazılmış isteklerin soruya düşmediği burada da izlenir.

Ayar tablolarında (`tests/unit/taskSearch*.test.ts`) ya da daha eski bir kümede bulunan ifadeler yeni kümenin sayımından çıkarıldı (yeni kümede sayılmayan: 78; bunlar çoğunlukla kısa, açık ifadelerdir — sayılan küme bu yüzden yazılandan zordur).

**Yeni ayrı küme — başlık**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| Yanlış ama emin: TEK bir iş cevap diye sunuldu ve başka iş yapıyor (bütün ifadelerde) — 202 ifadede | %3 | ≤ %5 | bütçe içinde |
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 51 kez; 16 tanesinde tek seçenek; 7 tanesi yapılabilen bir iş değildi | %25,2 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 149 ifadede | %29,5 | ≤ %33 | bütçe içinde |
| Sorduğunda doğru iş seçeneklerin arasında — 44 soruda; 5 tanesinde yok | %88,6 | ≥ %80 | bütçe içinde |
| Açık yazılmış isteğe (“kolay”) doğrudan cevap yerine soru — 18 ifadede | %5,6 | ≤ %15 | bütçe içinde |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %55,7 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %81,9 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 149 ifadede | %77,2 | ≥ %85 | BÜTÇE DIŞI |
| İlk üç satırda var | %81,9 | ≥ %90 | BÜTÇE DIŞI |
| Yapılabilen işe “Bunu bulamadım.” | %10,7 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %2 | ≤ %0 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 24 ifadede | %87,5 | ≥ %95 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 32 kez söylendi | %87,5 | ≥ %95 | BÜTÇE DIŞI |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 20 ifadede; 3 tanesine tek kart cevap diye sunuldu, 4 tanesinde seçenek soruldu | %65 | ≥ %80 | BÜTÇE DIŞI |
| Anlamsız yazı / sohbete kart önerilmedi — 9 ifadede | %88,9 | ≥ %90 | BÜTÇE DIŞI |

**İşe göre** (yeni küme)

| İş | İfade | Doğrudan doğru | Soruldu (doğrusu içinde) | İlk üçte | Yanlış ama emin | Bulunamadı |
| --- | --- | --- | --- | --- | --- | --- |
| Kes | 18 | 12 (%66,7) | 4 (4) | 16 | 0 | 2 |
| Boşlukları at | 16 | 9 (%56,3) | 5 (5) | 14 | 1 | 1 |
| Dikey yap | 15 | 7 (%46,7) | 4 (4) | 11 | 0 | 4 |
| Küçült | 16 | 13 (%81,3) | 2 (2) | 15 | 0 | 1 |
| Yazıya dök | 13 | 3 (%23,1) | 6 (4) | 7 | 1 | 3 |
| Müzik ekle | 15 | 6 (%40) | 7 (7) | 13 | 1 | 1 |
| Sesini al | 16 | 11 (%68,8) | 4 (4) | 15 | 0 | 0 |
| Sesi kapat | 13 | 7 (%53,8) | 3 (1) | 8 | 0 | 2 |
| Her yerde açılsın | 13 | 8 (%61,5) | 5 (5) | 13 | 0 | 0 |
| İyileştir | 13 | 7 (%53,8) | 3 (2) | 9 | 0 | 2 |
| GIF yap | 1 | 0 (%0) | 1 (1) | 1 | 0 | 0 |

**Yazış biçimine göre** (yeni küme; bir ifade birden çok satırda sayılır)

| Biçim | İfade | Doğrudan doğru | Soruldu (doğrusu içinde) | Yanlış ama emin |
| --- | --- | --- | --- | --- |
| Türkçe | 114 | 62 (%54,4) | 32 (30) | 3 |
| kısa ve açık (“kolay”) | 18 | 17 (%94,4) | 1 (1) | 0 |
| İngilizce | 35 | 21 (%60) | 12 (9) | 0 |
| yazım hatalı | 16 | 7 (%43,8) | 7 (7) | 0 |
| Türkçe harfsiz | 20 | 16 (%80) | 4 (4) | 0 |
| argo / kısaltma | 23 | 9 (%39,1) | 8 (8) | 0 |
| uzun cümle | 40 | 15 (%37,5) | 15 (12) | 1 |

**Kaçanlar, yeni küme** (77) — ifade → beklenen → çıkan. “Soruldu, doğrusu seçeneklerde” de burada sayılır (doğrudan cevap değildir), ama kullanıcı doğru işe bir dokunuşla varır.

| İfade | Beklenen | Çıkan | Tür |
| --- | --- | --- | --- |
| “vidyoyu kesmek istiyorm” | Kes | Bunu mu demek istedin? Kes | soruldu, doğrusu seçeneklerde |
| “vidyonun sonu çok saçma olmuş orayı atsak ya” | Kes | Bunu bulamadım. | bulunamadı |
| “düğün videosu iki saat sürüyor ben sadece takı töreninin olduğu yeri arkadaşıma göstermek istiyorum” | Kes | Bunu bulamadım. | bulunamadı |
| “my recording has like two minutes of me setting up the camera at the start and i want that gone” | Kes | Bunu mu demek istedin? Kes (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “klibin fazlalıklarını ayıkla” | Kes | Bunu mu demek istedin? Kes | soruldu, doğrusu seçeneklerde |
| “sessizlikleri sil” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
| “sesiz kısımları otomatk kes” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
| “bosluklari otomatik sil” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
| “arada susuyom ya onları uçur” | Boşlukları at | Bunu bulamadım. | bulunamadı |
| “videoda konuşurken sürekli düşünüp duruyorum aralarda uzun uzun bekliyorum bunlar tek tek uğraşmadan kendiliğinden gitsin istiyorum” | Boşlukları at | Kes | **yanlış ama emin** |
| “sunum kaydı aldım ama cümleler arasında çok bekleme var izleyen sıkılıyor daha akıcı olsun” | Boşlukları at | Bunu mu demek istedin? Boşlukları at | soruldu, doğrusu seçeneklerde |
| “podcast çekiyoruz misafir cevap vermeden önce hep beş saniye susuyor o ölü anları ayıklayabilir misin” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Sesini al / Kes | soruldu, doğrusu seçeneklerde |
| “dkey video yapma” | Dikey yap | Bunu bulamadım. | bulunamadı |
| “hikayeye sigmiyor yanlar kesilsin” | Dikey yap | Bunu mu demek istedin? Küçült / Dikey yap / Kes | soruldu, doğrusu seçeneklerde |
| “tt ye atcam ama yatay çekmişim” | Dikey yap | Bunu bulamadım. | bulunamadı |
| “reelse koyunca küçücük kalıyo ekranı doldursun” | Dikey yap | Bunu mu demek istedin? Dikey yap (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “telefonu yatay tutarak çekmişim instagramda üstte altta kocaman siyah boşluk kalıyor boydan boya olsun” | Dikey yap | Bunu mu demek istedin? Dikey yap / Boşlukları at | soruldu, doğrusu seçeneklerde |
| “turn my widescreen clip into a tall one for stories” | Dikey yap | Bunu mu demek istedin? Kes / Dikey yap | soruldu, doğrusu seçeneklerde |
| “i filmed in landscape but i need to post it as a short and it looks tiny with black bars on top and bottom” | Dikey yap | Bunu bulamadım. | bulunamadı |
| “2 gb lık vidyoyu ufalt” | Küçült | Bunu mu demek istedin? Küçült | soruldu, doğrusu seçeneklerde |
| “ödev videosunu öğretmene e-postayla yollamam gerekiyor ama ek 25 megabaytı geçemez diyor benimki 300” | Küçült | Bunu bulamadım. | bulunamadı |
| “altyzı olşutur” | Yazıya dök | Bunu mu demek istedin? Yazıya dök | soruldu, doğrusu seçeneklerde |
| “videodaki sozleri metin olarak ver” | Yazıya dök | Bunu mu demek istedin? Yazıya dök / Dikey yap | soruldu, doğrusu seçeneklerde |
| “hocanın anlattıklarını not olarak çıkar bana” | Yazıya dök | Bunu bulamadım. | bulunamadı |
| “dersi kaydettim sınavdan önce tekrar dinlemeye vaktim yok hocanın söylediklerini okuyabileceğim bir şekle sokmak istiyorum” | Yazıya dök | Bunu mu demek istedin? Sesini al / Sesi kapat | soruldu, doğrusu seçeneklerde YOK |
| “dedemin kulakları iyi duymuyor videoda ne konuşulduğunu ekranda okuyabilsin istiyorum” | Yazıya dök | Bunu bulamadım. | bulunamadı |
| “röportaj yaptım bir saatlik şimdi oturup hepsini tek tek elle yazmak istemiyorum bunu benim yerime yapar mısın” | Yazıya dök | Bunu bulamadım. | bulunamadı |
| “add captions so people can watch without sound” | Yazıya dök | Bunu mu demek istedin? Sesi kapat / Yazıya dök | soruldu, doğrusu seçeneklerde |
| “sessiz izleyenler için konuşmalar ekranda çıksın” | Yazıya dök | Boşlukları at | **yanlış ama emin** |
| “srt dosyası çıkar” | Yazıya dök | Bunu mu demek istedin? Yazıya dök / Sesini al / Kes | soruldu, doğrusu seçeneklerde |
| “müzk eklme” | Müzik ekle | Bunu bulamadım. | bulunamadı |
| “vidyoya şarkı eklemk istiyorum” | Müzik ekle | Bunu mu demek istedin? Müzik ekle | soruldu, doğrusu seçeneklerde |
| “arkada bi parça çalsın ya” | Müzik ekle | Bunu mu demek istedin? Kes / Müzik ekle | soruldu, doğrusu seçeneklerde |
| “vidyo çok kuru olmuş altına bi şarkı döşe” | Müzik ekle | Bunu mu demek istedin? Müzik ekle | soruldu, doğrusu seçeneklerde |
| “tatil videomuz çok sessiz ve sıkıcı duruyor telefonumdaki sevdiğim şarkı arkada çalsın istiyorum” | Müzik ekle | Bunu mu demek istedin? Müzik ekle / Boşlukları at | soruldu, doğrusu seçeneklerde |
| “kendi bestelediğim bir parça var mp3 olarak bunu çektiğim klibin üstüne yerleştirmek istiyorum” | Müzik ekle | Bunu mu demek istedin? Kes / Sesini al / Müzik ekle | soruldu, doğrusu seçeneklerde |
| “kızımın bale gösterisini çektim ama salonun sesi kötü onun yerine arkada güzel bir melodi olsun elimde dosyası var” | Müzik ekle | Bunu mu demek istedin? Müzik ekle / Sesini al | soruldu, doğrusu seçeneklerde |
| “i have an mp3 on my computer and want it playing under my holiday footage” | Müzik ekle | Bunu mu demek istedin? Sesini al / Müzik ekle / Her yerde açılsın | soruldu, doğrusu seçeneklerde |
| “videoya ses dosyası ekle” | Müzik ekle | Sesini al | **yanlış ama emin** |
| “vidoyu mp3e cevr” | Sesini al | Bunu mu demek istedin? Sesini al / Müzik ekle | soruldu, doğrusu seçeneklerde |
| “klipteki şarkıyı kulaklıkla dinlicem görüntüsüz” | Sesini al | Bunu mu demek istedin? Müzik ekle / Sesini al / Kes | soruldu, doğrusu seçeneklerde |
| “dersin videosu çok yer tutuyor zaten görüntüye bakmıyorum yürürken sadece dinlemek için kaydetmek istiyorum” | Sesini al | Bunu mu demek istedin? Sesini al / Küçült / İyileştir | soruldu, doğrusu seçeneklerde |
| “i just need the sound, not the picture” | Sesini al | Bunu henüz yapamıyoruz. [Videodan fotoğraf al] | bulunamadı |
| “i filmed my band rehearsal and want only the sound part as a separate file to send to the drummer” | Sesini al | Bunu mu demek istedin? Sesini al / Küçült / Kes | soruldu, doğrusu seçeneklerde |
| “arkada annem bağırıyo ses hiç duyulmasın” | Sesi kapat | Bunu mu demek istedin? Sesi kapat / Sesini al | soruldu, doğrusu seçeneklerde |
| “videoyu çekerken arkada televizyon açıktı ve biz kavga ediyorduk paylaşacağım ama hiçbir şey duyulmasın istiyorum” | Sesi kapat | Bunu bulamadım. | bulunamadı |
| “ürün tanıtımı için çekim yaptım rüzgar uğultusu berbat zaten konuşma yok tümden sessiz olsa daha iyi” | Sesi kapat | Bunu henüz yapamıyoruz. [Sesteki gürültüyü temizle] (+ Boşlukları at) | bulunamadı |
| “bebeğim uyurken çektim arkadan birinin özel telefon konuşması geliyor onu kimse duymasın görüntü yeter” | Sesi kapat | Bunu bulamadım. | bulunamadı |
| “remove all sound from my video” | Sesi kapat | Bunu mu demek istedin? Sesini al / Kes | soruldu, doğrusu seçeneklerde YOK |
| “i want to post this clip but people are swearing in the background so it should be totally silent” | Sesi kapat | Bunu mu demek istedin? Boşlukları at / Kes / Müzik ekle | soruldu, doğrusu seçeneklerde YOK |
| “vidyo açlmıyor telefnda” | Her yerde açılsın | Bunu mu demek istedin? Her yerde açılsın | soruldu, doğrusu seçeneklerde |
| “mkv dosyasi acilmiyor” | Her yerde açılsın | Bunu mu demek istedin? Her yerde açılsın | soruldu, doğrusu seçeneklerde |
| “annem videoyu açamıyor telefonu eski bende sorunsuz oynuyor ama onda siyah ekran çıkıyor” | Her yerde açılsın | Bunu mu demek istedin? Her yerde açılsın / Dikey yap | soruldu, doğrusu seçeneklerde |
| “my friend sent me a clip from her iphone and my old windows pc just shows an error when i try to open it” | Her yerde açılsın | Bunu mu demek istedin? Her yerde açılsın / Kes | soruldu, doğrusu seçeneklerde |
| “görntüyü netleştr” | İyileştir | Bunu mu demek istedin? İyileştir | soruldu, doğrusu seçeneklerde |
| “vidyo çok loş çıkmış bi şey gözükmüyo” | İyileştir | Bunu bulamadım. | bulunamadı |
| “görüntü bi tık daha güzel dursun” | İyileştir | Bunu bulamadım. | bulunamadı |
| “akşam yemeğinde çektiğimiz videoda yüzler neredeyse hiç seçilmiyor ortam loştu biraz aydınlansa yeter” | İyileştir | Bunu henüz yapamıyoruz. [Yüzü gizle] | bulunamadı |
| “sharpen the picture a little” | İyileştir | Bunu mu demek istedin? İyileştir (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “the clip i shot indoors came out dull and kind of washed out, can you make it pop a bit more” | İyileştir | Bunu mu demek istedin? Kes | soruldu, doğrusu seçeneklerde YOK |
| “telefona uygun hale getir” | Dikey yap / Her yerde açılsın | Bunu bulamadım. | bulunamadı |
| “whatsapptan yollayınca karşı tarafta açılmıyor” | Her yerde açılsın / Küçült | Bunu mu demek istedin? Her yerde açılsın / Küçült | soruldu, doğrusu seçeneklerde |
| “konuşmaları ayrı bir dosya olarak ver” | Yazıya dök / Sesini al | Bunu mu demek istedin? Dikey yap / Boşlukları at | soruldu, doğrusu seçeneklerde YOK |
| “cant send my video” | Küçült / Her yerde açılsın | Bunu mu demek istedin? Küçült | soruldu, doğrusu seçeneklerde |
| “dead parts cut out pls” | Kes / Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
| “vidyodan hareketli resim yapcam caps gibi” | GIF yap | Bunu mu demek istedin? GIF yap (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “blur my background” | “Bunu henüz yapamıyoruz.” | Bunu mu demek istedin? İyileştir / Müzik ekle (+ yapılamayan satır) | soruldu (yapılabilen bir iş değildi) |
| “instagram linkinden vidyo çekme” | “Bunu henüz yapamıyoruz.” | Bunu mu demek istedin? Dikey yap | soruldu (yapılabilen bir iş değildi) |
| “tiktokta paylaş direkt” | “Bunu henüz yapamıyoruz.” | Bunu mu demek istedin? Dikey yap (+ yapılamayan satır) | soruldu (yapılabilen bir iş değildi) |
| “videoya kendi sesimle anlatım kaydet” | kart önerilmemesi | Bunu mu demek istedin? Sesini al | soruldu (yapılabilen bir iş değildi) |
| “sesimi robot sesi yap” | kart önerilmemesi | Sesini al | **yanlış ama emin** |
| “köşede küçük pencerede ikinci video oynasın” | kart önerilmemesi | Bunu mu demek istedin? Küçült | soruldu (yapılabilen bir iş değildi) |
| “sarkinin sozlerini sil sadece muzik kalsin karaoke” | kart önerilmemesi | Müzik ekle (+ Kes) | **yanlış ama emin** |
| “podcast için iki ses dosyasını miksle” | kart önerilmemesi | Sesini al | **yanlış ama emin** |
| “text to speech narration” | kart önerilmemesi | Bunu mu demek istedin? Yazıya dök | soruldu (yapılabilen bir iş değildi) |
| “şarkıdan zil sesi yap” | kart önerilmemesi | Bunu mu demek istedin? Müzik ekle / Sesini al | soruldu (yapılabilen bir iş değildi) |
| “whats your name” | kart önerilmemesi | Bunu henüz yapamıyoruz. [Videoya yazı ekle] | bulunamadı |

**İkinci yeni küme — artık AYAR KÜMESİ, başlık değil**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| Yanlış ama emin: TEK bir iş cevap diye sunuldu ve başka iş yapıyor (bütün ifadelerde) — 209 ifadede | %1 | — | bütçesiz |
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 57 kez; 21 tanesinde tek seçenek; 8 tanesi yapılabilen bir iş değildi | %27,3 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 148 ifadede | %33,1 | — | bütçesiz |
| Sorduğunda doğru iş seçeneklerin arasında — 49 soruda; 9 tanesinde yok | %81,6 | — | bütçesiz |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %60,1 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %87,2 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 148 ifadede | %83,1 | — | bütçesiz |
| İlk üç satırda var | %87,8 | — | bütçesiz |
| Yapılabilen işe “Bunu bulamadım.” | %4,1 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %1,4 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 31 ifadede | %83,9 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 33 kez söylendi | %93,9 | — | bütçesiz |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 20 ifadede; 0 tanesine tek kart cevap diye sunuldu, 4 tanesinde seçenek soruldu | %80 | — | bütçesiz |
| Anlamsız yazı / sohbete kart önerilmedi — 10 ifadede | %90 | — | bütçesiz |

**Eski ayrı küme — KİRLENMİŞ, başlık değil**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| Yanlış ama emin: TEK bir iş cevap diye sunuldu ve başka iş yapıyor (bütün ifadelerde) — 225 ifadede | %0,9 | — | bütçesiz |
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 25 kez; 11 tanesinde tek seçenek; 0 tanesi yapılabilen bir iş değildi | %11,1 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 173 ifadede | %14,5 | — | bütçesiz |
| Sorduğunda doğru iş seçeneklerin arasında — 25 soruda; 2 tanesinde yok | %92 | — | bütçesiz |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %82,1 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %95,4 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 173 ifadede | %93,6 | — | bütçesiz |
| İlk üç satırda var | %95,4 | — | bütçesiz |
| Yapılabilen işe “Bunu bulamadım.” | %2,9 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %0 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 28 ifadede | %100 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 37 kez söylendi | %100 | — | bütçesiz |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 12 ifadede; 1 tanesine tek kart cevap diye sunuldu, 0 tanesinde seçenek soruldu | %91,7 | — | bütçesiz |
| Anlamsız yazı / sohbete kart önerilmedi — 12 ifadede | %100 | — | bütçesiz |

### İngilizce arama (ADR-048)

- **İngilizce kör küme** (`web/tests/quality/data/search-eval-en-fresh.ts`, 200 ifade; sayılan 155): yalnızca İngilizce iş adlarını ve birer satırlık açıklamaları gören bir yazar yazdı; ifadeler sayılar dışında okunmadan dönüştürüldü ve İngilizce kelime listeleri ayrı ayar kümesine bakılarak dondurulduktan sonra ölçüldü. Kaçanları aşağıda yazılı: bundan sonra görülmüş sayılır.
- **İngilizce ayar kümesi** (`search-eval-en-dev.ts`, 140 ifade): İngilizce kelime listeleri bunun kaçanlarına bakılarak genişletildi; ölçüm değildir.
- Sayımdan çıkanlar: Türkçe ayar tablolarında, Türkçe kümelerde ya da İngilizce ayar kümesinde zaten bulunan ifadeler (kör kümede 45).

**İngilizce kör küme**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| Yanlış ama emin: TEK bir iş cevap diye sunuldu ve başka iş yapıyor (bütün ifadelerde) — 155 ifadede | %2,6 | ≤ %5 | bütçe içinde |
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 33 kez; 13 tanesinde tek seçenek; 4 tanesi yapılabilen bir iş değildi | %21,3 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 122 ifadede | %23,8 | ≤ %33 | bütçe içinde |
| Sorduğunda doğru iş seçeneklerin arasında — 29 soruda; 2 tanesinde yok | %93,1 | ≥ %80 | bütçe içinde |
| Açık yazılmış isteğe (“kolay”) doğrudan cevap yerine soru — 11 ifadede | %0 | ≤ %15 | bütçe içinde |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %57,4 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %79,5 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 122 ifadede | %76,2 | ≥ %85 | BÜTÇE DIŞI |
| İlk üç satırda var | %79,5 | ≥ %90 | BÜTÇE DIŞI |
| Yapılabilen işe “Bunu bulamadım.” | %15,6 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %0,8 | ≤ %0 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 21 ifadede | %85,7 | ≥ %95 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 21 kez söylendi | %95,2 | ≥ %95 | bütçe içinde |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 8 ifadede; 0 tanesine tek kart cevap diye sunuldu, 3 tanesinde seçenek soruldu | %62,5 | ≥ %80 | BÜTÇE DIŞI |
| Anlamsız yazı / sohbete kart önerilmedi — 4 ifadede | %100 | ≥ %90 | bütçe içinde |

**İşe göre** (İngilizce kör küme)

| İş | İfade | Doğrudan doğru | Soruldu (doğrusu içinde) | İlk üçte | Yanlış ama emin | Bulunamadı |
| --- | --- | --- | --- | --- | --- | --- |
| Cut | 13 | 10 (%76,9) | 1 (1) | 11 | 0 | 2 |
| Remove silences | 11 | 6 (%54,5) | 4 (4) | 10 | 1 | 0 |
| Make it vertical | 12 | 7 (%58,3) | 2 (2) | 9 | 0 | 3 |
| Shrink | 10 | 4 (%40) | 4 (4) | 8 | 0 | 1 |
| Speech to text | 10 | 7 (%70) | 1 (1) | 8 | 0 | 2 |
| Add music | 11 | 5 (%45,5) | 5 (5) | 10 | 0 | 1 |
| Get the sound | 9 | 6 (%66,7) | 1 (1) | 7 | 0 | 2 |
| Mute | 11 | 6 (%54,5) | 1 (0) | 6 | 2 | 2 |
| Make it play everywhere | 11 | 6 (%54,5) | 3 (2) | 8 | 0 | 2 |
| Enhance | 12 | 8 (%66,7) | 1 (1) | 9 | 0 | 3 |
| Make a GIF | 12 | 5 (%41,7) | 6 (6) | 11 | 0 | 1 |

**Yazış biçimine göre** (İngilizce kör küme)

| Biçim | İfade | Doğrudan doğru | Soruldu (doğrusu içinde) | Yanlış ama emin |
| --- | --- | --- | --- | --- |
| İngilizce | 122 | 70 (%57,4) | 29 (27) | 3 |
| kısa ve açık (“kolay”) | 11 | 11 (%100) | 0 (0) | 0 |
| çocuk | 14 | 5 (%35,7) | 4 (4) | 1 |
| uzun cümle | 22 | 11 (%50) | 6 (5) | 0 |
| yazım hatalı | 17 | 7 (%41,2) | 5 (5) | 0 |
| argo / kısaltma | 16 | 10 (%62,5) | 2 (2) | 1 |

**Kaçanlar, İngilizce kör küme** (58)

| İfade | Beklenen | Çıkan | Tür |
| --- | --- | --- | --- |
| “trimm vidoe” | Cut | Did you mean this? Cut | soruldu, doğrusu seçeneklerde |
| “keep just the goal from the football match” | Cut | I couldn’t find that. | bulunamadı |
| “cutt the vid in half” | Cut | I couldn’t find that. | bulunamadı |
| “remove the dead air from my podcast” | Remove silences | Did you mean this? Remove silences / Get the sound | soruldu, doğrusu seçeneklerde |
| “My lecture recording has loads of long pauses, can you cut them out automatically?” | Remove silences | Did you mean this? Cut / Remove silences | soruldu, doğrusu seçeneklerde |
| “jump cut my talking head video” | Remove silences | Did you mean this? Remove silences / Cut | soruldu, doğrusu seçeneklerde |
| “skip the bits where i forgot what to say” | Remove silences | Cut | **yanlış ama emin** |
| “trim the silent bits out of my vlog” | Remove silences | Did you mean this? Remove silences / Cut | soruldu, doğrusu seçeneklerde |
| “verticle video for tik tok” | Make it vertical | Did you mean this? Make it vertical | soruldu, doğrusu seçeneklerde |
| “my video is wide and i want it to fill the whole phone screen when people watch it” | Make it vertical | I couldn’t find that. | bulunamadı |
| “On TikTok it has big black bars at the top and bottom, I want it full screen.” | Make it vertical | Did you mean this? Make it vertical / Shrink / Cut | soruldu, doğrusu seçeneklerde |
| “resize for snapchat” | Make it vertical | I couldn’t find that. | bulunamadı |
| “portrate mode pls” | Make it vertical | I couldn’t find that. | bulunamadı |
| “make it under 25mb so i can email it” | Shrink | Did you mean this? Shrink | soruldu, doğrusu seçeneklerde |
| “compres vidio” | Shrink | Did you mean this? Shrink | soruldu, doğrusu seçeneklerde |
| “make it less heavy so it sends faster” | Shrink | We can’t do that yet. [Speed up or slow down] | bulunamadı |
| “this video takes up too much space on my phone” | Shrink | I couldn’t find that. | bulunamadı |
| “squash the video so i can send it to grandma” | Shrink | Did you mean this? Shrink | soruldu, doğrusu seçeneklerde |
| “reduse the size of my clip” | Shrink | Did you mean this? Shrink / Cut | soruldu, doğrusu seçeneklerde |
| “My grandpa is hard of hearing so he needs the words on screen to follow along.” | Speech to text | I couldn’t find that. | bulunamadı |
| “get the text out of my lecture video” | Speech to text | Did you mean this? Speech to text | soruldu, doğrusu seçeneklerde |
| “i want to read what the teacher said instead of watching the whole video again” | Speech to text | I couldn’t find that. | bulunamadı |
| “put a beat on it” | Add music | I couldn’t find that. | bulunamadı |
| “can i add my own mp3 to the video” | Add music | Did you mean this? Get the sound / Add music | soruldu, doğrusu seçeneklerde |
| “my birthday video is so boring without music” | Add music | Did you mean this? Add music / Remove silences / Mute | soruldu, doğrusu seçeneklerde |
| “I want to add a song from my phone to the video I made for my mum's birthday.” | Add music | Did you mean this? Add music / Get the sound | soruldu, doğrusu seçeneklerde |
| “swap the sound for a song” | Add music | Did you mean this? Add music / Get the sound | soruldu, doğrusu seçeneklerde |
| “put a tune in the background” | Add music | Did you mean this? Add music (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “turn the video into music i can listen to” | Get the sound | Did you mean this? Add music / Get the sound | soruldu, doğrusu seçeneklerde |
| “i recorded my band playing live and i want just the sound as a file” | Get the sound | I couldn’t find that. | bulunamadı |
| “make a ringtone from this video” | Get the sound | I couldn’t find that. | bulunamadı |
| “take all the sound out” | Mute | I couldn’t find that. | bulunamadı |
| “mutte vidoe” | Mute | I couldn’t find that. | bulunamadı |
| “silence my video” | Mute | Remove silences | **yanlış ama emin** |
| “kill the audio” | Mute | Get the sound | **yanlış ama emin** |
| “There is swearing in it so I want to remove all the audio before I show my teacher.” | Mute | Did you mean this? Get the sound / Cut | soruldu, doğrusu seçeneklerde YOK |
| “make it work on my tv” | Make it play everywhere | Did you mean this? Make it play everywhere | soruldu, doğrusu seçeneklerde |
| “the video only shows a black screen on android” | Make it play everywhere | I couldn’t find that. | bulunamadı |
| “make it work on any phone” | Make it play everywhere | Did you mean this? Make it vertical | soruldu, doğrusu seçeneklerde YOK |
| “My friend can't open the video I sent her, can you fix it so it works?” | Make it play everywhere | Did you mean this? Make it play everywhere | soruldu, doğrusu seçeneklerde |
| “plz fix my vidio it wont opun” | Make it play everywhere | I couldn’t find that. | bulunamadı |
| “it was filmed at night and you can barely see anything” | Enhance | I couldn’t find that. | bulunamadı |
| “brighen my vidoe” | Enhance | Did you mean this? Enhance | soruldu, doğrusu seçeneklerde |
| “make it look less dull and grey” | Enhance | I couldn’t find that. | bulunamadı |
| “my videos look washed out, can you make them nicer” | Enhance | I couldn’t find that. | bulunamadı |
| “i want to make a reaction gif of my cat” | Make a GIF | Did you mean this? Make a GIF | soruldu, doğrusu seçeneklerde |
| “meme gif with words at the top and bottom” | Make a GIF | Did you mean this? Make a GIF / Speech to text / Cut | soruldu, doğrusu seçeneklerde |
| “make a gif for discord” | Make a GIF | Did you mean this? Shrink / Make a GIF | soruldu, doğrusu seçeneklerde |
| “turn this funny bit into a moving picture” | Make a GIF | Did you mean this? Make a GIF / Make it play everywhere (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “convert mp4 to gif” | Make a GIF | Did you mean this? Make a GIF / Make it play everywhere | soruldu, doğrusu seçeneklerde |
| “giff of my dog falling off the couch” | Make a GIF | I couldn’t find that. | bulunamadı |
| “I need a small animated image of me waving to put in my email signature.” | Make a GIF | Did you mean this? Make a GIF / Shrink (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “translate the subtitles into spanish” | “Bunu henüz yapamıyoruz.” | Did you mean this? Speech to text (+ yapılamayan satır) | soruldu (yapılabilen bir iş değildi) |
| “clean up the background hum” | “Bunu henüz yapamıyoruz.” | I couldn’t find that. | bulunamadı |
| “save this insta reel from a link” | “Bunu henüz yapamıyoruz.” | Make it vertical | **yanlış ama emin** |
| “buy more storage” | kart önerilmemesi | Did you mean this? Shrink | soruldu (yapılabilen bir iş değildi) |
| “how do i get more followers on instagram” | kart önerilmemesi | Did you mean this? Make it vertical | soruldu (yapılabilen bir iş değildi) |
| “my phone keeps crashing” | kart önerilmemesi | Did you mean this? Make it vertical / Cut | soruldu (yapılabilen bir iş değildi) |

**İngilizce ayar kümesi — ölçüm değil**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| Yanlış ama emin: TEK bir iş cevap diye sunuldu ve başka iş yapıyor (bütün ifadelerde) — 106 ifadede | %0 | — | bütçesiz |
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 15 kez; 3 tanesinde tek seçenek; 1 tanesi yapılabilen bir iş değildi | %14,2 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 86 ifadede | %16,3 | — | bütçesiz |
| Sorduğunda doğru iş seçeneklerin arasında — 14 soruda; 0 tanesinde yok | %100 | — | bütçesiz |
| Açık yazılmış isteğe (“kolay”) doğrudan cevap yerine soru — 15 ifadede | %6,7 | — | bütçesiz |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %81,4 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %97,7 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 86 ifadede | %95,3 | — | bütçesiz |
| İlk üç satırda var | %97,7 | — | bütçesiz |
| Yapılabilen işe “Bunu bulamadım.” | %2,3 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %0 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 13 ifadede | %100 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 16 kez söylendi | %100 | — | bütçesiz |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 5 ifadede; 0 tanesine tek kart cevap diye sunuldu, 1 tanesinde seçenek soruldu | %80 | — | bütçesiz |
| Anlamsız yazı / sohbete kart önerilmedi — 2 ifadede | %100 | — | bütçesiz |

Geliştirme kümesi (`DEV`, ayar yapılırken kullanılabilir; başlık sayısı değildir): 85 ifade, doğrudan doğru %86,2, yanlış ama emin %0, yapılabilen işe soru %12,3 (bütçe ≤ %15; bütçe içinde), kaçan 15 (“sessizligi sil” → Bunu mu demek istedin? Boşlukları at / Kes; “arkadaki konuşmalar duyulmasın” → Bunu henüz yapamıyoruz. [Sesteki gürültüyü temizle]; “videoyu sessize almak istiyorum çünkü arkada çok konuşan var” → Bunu mu demek istedin? Sesi kapat / Boşlukları at; “aradaki boşlukları silmek istiyorum” → Bunu mu demek istedin? Boşlukları at / Kes; “videoda çok duraksıyorum onları at” → Bunu mu demek istedin? Boşlukları at / Kes; “sonunu atmak istiyorum” → Bunu mu demek istedin? Kes; “dosyayı küçültmem lazım” → Bunu mu demek istedin? Küçült; “videoda söylediklerimin metnini istiyorum” → Bunu mu demek istedin? Yazıya dök; “gece çektiğim videoda hiçbir şey görünmüyor biraz açmak istiyorum” → Bunu mu demek istedin? Her yerde açılsın; “kesinlikle çok güzel olmuş” → Bunu mu demek istedin? İyileştir; “bugün hava çok güzel” → Bunu mu demek istedin? İyileştir; “videoyu instagramda paylaş” → Bunu mu demek istedin? Dikey yap (+ yapılamayan satır); “şarkının adını bul” → Bunu mu demek istedin? Müzik ekle / İyileştir (+ yapılamayan satır); “dvd ye yaz” → Bunu mu demek istedin? Yazıya dök; “oyun oyna” → Bunu mu demek istedin? Her yerde açılsın).

## 3. Hata yolları

Her sihirbaza sekiz tür sorunlu dosya verildi; ekranda görülen metin kelimesi kelimesine kaydedildi. Derleme: yayınlanan statik çıktı, masaüstü görünümü (mesajları aynı bileşenler üretir; telefonda ayrıca koşulmadı). Sınır üstü iki durumda dosyanın boyutu ve süresi yalnızca test sayfasının içinde büyük gösterildi; uygulamanın kendi denetimi değişmeden çalıştı.

**iyi** = ne olduğunu ve ne yapılacağını söylüyor, ilerleme / geri dönüş var, takılma ve sayfa hatası yok · **belirsiz** = mesaj var ama ne yapılacağını söylemiyor ya da teknik terim içeriyor; ya da sorunlu dosya uyarısız işlendi · **bozuk** = mesaj da ilerleme de yok, bitmeyen bekleme, donan sayfa, sayfa hatası · **ölçülemedi** = bu makinede denenemedi (nedeni tabloda) · **—** = bu iş için hata değil.


|  | Hücre | Bütçe | Durum |
| --- | --- | --- | --- |
| İyi | 82 | — | bütçesiz |
| Belirsiz | 0 | ≤ 0 | bütçe içinde |
| Bozuk | 0 | ≤ 0 | bütçe içinde |
| Ölçülemeyen | 0 | ≤ 1 | bütçe içinde |
| Sayfanın yanıt vermediği en uzun süre | 0 sn | ≤ 3 sn | bütçe içinde |
| Sayfa hatası görülen hücre | 0 | ≤ 0 | bütçe içinde |
| Konsol hatası görülen hücre | 0 | — | bütçesiz |

**Tablo** (satır: dosya, sütun: sihirbaz)

| Dosya | Kes | Boşlukları at | Dikey yap | Küçült | Yazıya dök | Müzik ekle | Sesini al | Sesi kapat | Sesi düzelt | Her yerde açılsın | İyileştir | GIF yap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Video olmayan dosya (.txt) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | ölçülemedi |
| Sıfır baytlık .mp4 | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | ölçülemedi |
| İçi rastgele bayt olan .mp4 | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | ölçülemedi |
| Yarıda kesilmiş MP4 (baytların %55’i) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | ölçülemedi |
| Yalnızca ses dosyası (.m4a) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | ölçülemedi |
| Sesi olmayan video | — | iyi | — | — | iyi | — | iyi | iyi | iyi | — | — | ölçülemedi |
| Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | ölçülemedi |
| Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | ölçülemedi |

**Ekranda görülen metinler**

| Dosya | Sihirbaz | Yargı | Ekrandaki metin | Neden | Cevap süresi |
| --- | --- | --- | --- | --- | --- |
| Video olmayan dosya (.txt) | Boşlukları at, Her yerde açılsın, Dikey yap, Sesi düzelt, İyileştir, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““notlar.txt” açılamadı: bu dosya bir video gibi görünmüyor; bozuk ya da başka türde bir dosya olabilir. Başka bir video seç.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |
| Sıfır baytlık .mp4 | Boşlukları at, Her yerde açılsın, Dikey yap, Sesi düzelt, İyileştir, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““bos.mp4” açılamadı: bu dosya boş; içinde hiçbir şey yok. İnerken ya da kopyalanırken bir sorun olmuş olabilir. Dosyayı yeniden indir ya da yeniden kopyala; ya da başka bir dosya seç.” | ne olduğunu ve ne yapılacağını söylüyor | 0 sn |
| İçi rastgele bayt olan .mp4 | Boşlukları at, Her yerde açılsın, Dikey yap, Sesi düzelt, İyileştir, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““bozuk.mp4” açılamadı: bu dosya bir video gibi görünmüyor; bozuk ya da başka türde bir dosya olabilir. Başka bir video seç.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | Boşlukları at, Her yerde açılsın, Dikey yap, Sesi düzelt, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““yarim-inmis.mp4” açılamadı: bu video yarım kalmış görünüyor: 24,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 12,3 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | İyileştir | iyi | ““yarim-inmis.mp4” açılamadı: bu video yarım kalmış görünüyor: 3,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 1,5 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.” | ne olduğunu ve ne yapılacağını söylüyor | 0,5 sn |
| Yalnızca ses dosyası (.m4a) | Boşlukları at, Her yerde açılsın, Dikey yap, Sesi düzelt, İyileştir, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““tone-30s.m4a” açılamadı: bu dosyada görüntü yok, yalnızca ses var. Görüntüsü olan bir video seç.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| Sesi olmayan video | Her yerde açılsın, Dikey yap, İyileştir, Kes | geçerli değil | (metin yok) | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,2 sn |
| Sesi olmayan video | Küçült | geçerli değil | “Bu video zaten 73 KB; buraya sığıyor. Küçültmene gerek yok.” | bu iş videonun sesine ihtiyaç duymaz; video açıldı, adım indirme sunmadı ve nedenini söyledi (“Bu video zaten 73 KB; buraya sığıyor. Küçültmene gerek yok.”) | 0,2 sn |
| Sesi olmayan video | Müzik ekle | geçerli değil | “Önce müziğini seç.” | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,2 sn |
| Sesi olmayan video | Boşlukları at | iyi | “Bu videoda ses yok; sessizlik aranamaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesi düzelt | iyi | “Bu videoda ses yok; düzeltilecek bir ses yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesini al | iyi | “Bu videoda ses yok; kaydedilecek bir ses dosyası çıkmaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesi kapat | iyi | “Bu videoda zaten ses yok; kapatılacak bir şey yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Yazıya dök | iyi | “Bu videoda ses yok; yazıya dökülecek bir konuşma yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB) | Boşlukları at, Her yerde açılsın, Dikey yap, Sesi düzelt, İyileştir, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““kalite-cok-buyuk.mp4” açılamadı: dosya 5,37 GB; bu sürümün sınırı 4,29 GB. Daha küçük bir video seç; ya da bu videoyu önce başka bir uygulamayla parçalara böl.” | ne olduğunu ve ne yapılacağını söylüyor | 0,1 sn |
| Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika) | Boşlukları at, Her yerde açılsın, Dikey yap, Sesi düzelt, İyileştir, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““kalite-cok-uzun.mp4” açılamadı: video bu sürümdeki 120 dakika sınırının üzerinde. Daha kısa bir video seç; ya da bu videoyu önce başka bir uygulamayla parçalara böl.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |

## 4. Dürüstlük denetimleri

**İlerleme çubuğu ve “Kaydedildi”** — “İndir”e basıştan sonuca kadar 40 ms’de bir örneklendi (masaüstü, statik çıktı).


| Senaryo | Sonuç | Örnek / farklı değer | İlk → son | Geri gitti | Geçiş arasında geri gitti | %100’de bekleme | “Kaydedildi” anında dosya | Dosyasız başarı |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dikey yap: 12 sn’lik 1920 × 1080 video yeniden işlenir | saved | 71 / 11 | %0 → %99 | 0 kez | 0 kez | 0 ms | 8.145 KB, 12,01 sn, video:h264 + audio:aac | hayır |
| İyileştir: ışığı değişen 10 sn’lik video | saved | 184 / 23 | %0 → %98 | 0 kez | 0 kez | 0 ms | 9.437 KB, 10,01 sn, video:h264 + audio:aac | hayır |
| Küçült → WhatsApp: yaklaşık 24 MB’lık video 16 MB’ın altına iner | saved | 134 / 20 | %0 → %99 | 0 kez | 0 kez | 0 ms | 15.481 KB, 12,01 sn, video:h264 + audio:aac | hayır |

Kaydetme penceresi olmayan yol (telefon, Firefox, Safari): “hazır” dendiğinde bağlantının arkasındaki dosya 503 KB; dosyasız başarı: hayır (bütçe içinde).

**İptal** — 24 sn’lik video dikey yapılırken, ilerleme %3’ü geçince “İptal et”e basıldı.


| Yol | Durdu | Durma süresi | Ekrandaki metin | İş sürerken sayfa deposunda | İptalden 4 sn sonra kalan | Kalan bayt | İptalden sonra “kaydedildi” |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kaydetme penceresiz (telefon, Firefox, Safari) | evet | 70 ms | “İndirme durduruldu; yarım dosya bırakılmadı.” | clip-export-exp_mvh6ji6y_2.mp4 (38.927 KB) | hiçbir şey | 0 | hayır |
| kaydetme pencereli (Chrome / Edge) | evet | 57 ms | “İndirme durduruldu; yarım dosya bırakılmadı.” | saved-sample-24s_dikey.mp4.crswap (38.927 KB), saved-sample-24s_dikey.mp4 (0 KB) | hiçbir şey | 0 | hayır |

Not: kaydetme pencereli yolda testin “kaydetme penceresi” kullanıcının seçtiği dosya yerine sayfa deposunda bir dosya verir. İptalden sonra o dosyanın 0 bayt olarak kalması, gerçek pencerede kullanıcının seçtiği adda boş bir dosya kalması demektir; bayt kalması yarım dosya demektir.

**e2e paketinin zaten kanıtladıkları** (burada yeniden ölçülmedi; test adı dosyada arandı)


| Ne | Test | Dosya | Atıf |
| --- | --- | --- | --- |
| İptal: kaydetme penceresinde seçilen adda dosya kalmaz | “cancel while encoding leaves no file under the chosen name” | `web/tests/e2e/kesit.spec.ts` | dosyada var |
| İptal: kaydetme penceresi olmayan yolda geçici dosya kalmaz | “a canceled download leaves no temporary file behind” | `web/tests/e2e/editor.spec.ts` | dosyada var |
| Sihirbazda iptal: çıkmadan önce sorar, “İptal et” durdurur, “Kaydedildi” görünmez | “leaving while the video is being prepared asks first; “İptal et” stops it and leaves no file” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Kaydetme penceresini kapatmak hiçbir şey yapmaz ve hiçbir şey söylemez | “closing the save dialog does nothing and says nothing” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Sığmayan hedef: indirme kapalı, hiçbir şey yazılmaz | “a video that cannot fit WhatsApp: the option says the smallest size, the next size that works is chosen, nothing is written” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Uygulamanın söylediği boyut dosyanın gerçek boyutudur (Küçült) | “one choice, WhatsApp chosen as the card says; each option says its outcome first; the saved file is under 16 MB and says its real size” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Sesi olmayan video: başarı yok, kaydetme penceresi yok, dosya yok | “a video without sound: said on the step, İndir stays off, no save dialog, nothing written” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Değiştirecek bir şey yoksa indirme sunulmaz (İyileştir) | “a video with nothing to fix is told so: no download that would change nothing, no save dialog” | `web/tests/e2e/enhance.spec.ts` | dosyada var |
| Disk dolarsa dürüst hata; yarım dosya silinir | “a disk that fills up mid-file ends in an honest failure; the partial file is deleted” | `web/tests/e2e/output-limits.spec.ts` | dosyada var |
| Seçilen dosya diski doldurursa: dürüst hata, o adda yarım dosya yok | “the picked file fills the disk mid-file: an honest failure, no half file under its name” | `web/tests/e2e/output-limits.spec.ts` | dosyada var |
| Sınırı aşan çıktı, tek kare kodlanmadan reddedilir | “a kesit, the joined kesitler and the whole video over 60 minutes are refused before encoding” | `web/tests/e2e/kesit.spec.ts` | dosyada var |
| Sessizlik aramasının ilerlemesi gerçektir ve durdurulabilir | “a long analysis shows real progress and can be stopped” | `web/tests/e2e/silence.spec.ts` | dosyada var |
| Yazıya dökmeyi durdurmak geride hiçbir şey bırakmaz; hata söylenir | “stopping a transcription keeps nothing; a failure is said and can be retried” | `web/tests/e2e/transcript.spec.ts` | dosyada var |
| Bozuk inen model dosyası reddedilir, silinir, kullanılmaz | “a damaged file is refused, deleted and never used; a clean retry works” | `web/tests/e2e/transcript.spec.ts` | dosyada var |
| Zaten sığan video yeniden kaydedilmez: İndir kapalı, nedeni yazılı, hiçbir dosya yok (Küçült) | “a video already under every size: said before İndir, nothing is saved; “Daha da küçült” is the way on” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Yarım kalmış video seçildiği anda reddedilir; tarayıcı suçlanmaz (ADR-040) | “every wizard refuses half a video when it is picked: what is wrong, what to do, nothing about the browser” | `web/tests/e2e/incomplete-source.spec.ts` | dosyada var |
| Yarım video “İndir”e ulaşırsa: “Kaydedildi” yok, dosya yok (ADR-040) | “if half a video ever reaches “İndir”, the export refuses it and saves nothing” | `web/tests/e2e/incomplete-source.spec.ts` | dosyada var |
| Çözülmüş ses ve görüntü örnekleri kapatılır: çöp toplayıcı zorlandığında konsol uyarısı yok | “Küçült (a full re-encode with sound): nothing decoded is left open” | `web/tests/e2e/resource-leak.spec.ts` | dosyada var |

Bu testlerin bu koşuda geçtiği burada İDDİA EDİLMEZ: e2e paketi bu betikle koşulmaz (`npm run test:e2e`, CI).

## 5. Çıktı kalitesi

Dosyalar uygulamanın kendisiyle (statik çıktı, masaüstü Chromium) üretildi; ölçümler ffmpeg / ffprobe ile yapıldı. Ses–görüntü: `web/scripts/lib/av-sync.mjs` klibi (her olayda bir beyaz kare ve tam o karede başlayan kısa bir ses); sapma = ses eksi görüntü, + ise ses geç.

**Ses–görüntü eşzamanı ve süre**

Kaynakların kendi sapması: H.264 MP4 0,08 ms (37 olay), VP9 WebM 0,1 ms (37 olay). Tablodaki “eklenen sapma” çıktı eksi kaynak.


| Durum | Yol | İstenen → çıkan süre | Süre hatası | Eşleşen olay | Sapma (ortanca; en az … en çok) | Eklenen sapma | Her yerde açılır (dizin yeri hariç) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Her yerde açılsın, senkron klibi (H.264 MP4) | kopya (yeniden işlenmedi) | 12 → 12,011 sn | 11 ms | 37 / 37 | 0,1 ms (0,08 … 0,1) | 0,02 ms | 10 denetimin hepsi tuttu |
| Her yerde açılsın, senkron klibi (VP9 WebM) | yeniden işlendi | 12,01 → 12,011 sn | 3 ms | 37 / 37 | 0,1 ms (0,08 … 0,1) | 0 ms | 10 denetimin hepsi tuttu |
| Dikey yap, senkron klibi (zaten 9:16) | kopya (yeniden işlenmedi) | 12 → 12,011 sn | 11 ms | 37 / 37 | 0,1 ms (0,08 … 0,1) | 0,02 ms | 10 denetimin hepsi tuttu |
| Kes 2–8 sn, senkron klibi (H.264 MP4) | kopya (yeniden işlenmedi) | 6 → 6,016 sn | 16 ms | 19 / 19 | 0,1 ms (0,08 … 0,1) | 0,02 ms | 10 denetimin hepsi tuttu |
| Kes 2–8 sn, senkron klibi (VP9 WebM) | yeniden işlendi | 6 → 6,016 sn | 16 ms | 19 / 19 | 1,1 ms (1,08 … 1,1) | 1 ms | 10 denetimin hepsi tuttu |
| Küçült (seçim değişmeden: WhatsApp), ağır senkron klibi (H.264, yaklaşık 33 MB) | yeniden işlendi | 12 → 12,011 sn | 11 ms | 37 / 37 | 0,1 ms (0,08 … 0,1) | 0,02 ms | 10 denetimin hepsi tuttu |

**Görüntü sadakati** — aynı düzenlemenin yalnızca ffmpeg ile yapılmış, kayıpsız referansına karşı; kamera benzeri ÜRETİLMİŞ video (gerçek çekim değil).


| Durum | Yol | Çıktı | Karşılaştırma boyutu | SSIM | PSNR | VMAF | Süre hatası | Hedef boyut | Her yerde açılır (dizin yeri hariç) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Her yerde açılsın, kamera benzeri 720p VP9 WebM | yeniden işlendi | 1280 × 720, 5,7 MB | 1280 × 720 | 0,9766 | 42,59 dB | 84,6 | 8 ms | — | 10 denetimin hepsi tuttu |
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 608 × 1080, 8,2 MB | 608 × 1080 | 0,9714 | 43,83 dB | 89,8 | 11 ms | — | 10 denetimin hepsi tuttu |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma (kesim yerleri yeniden işlendi, arası kopya) | 1920 × 1080, 6,7 MB | 1920 × 1080 | 0,9978 | 55,19 dB | 99,2 | 8 ms | — | 10 denetimin hepsi tuttu |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 1920 × 1080, 15,5 MB | 1920 × 1080 | 0,9658 | 42,84 dB | 87,3 | 11 ms | 15,5 MB / 16 MB: sığdı: evet; hedefin kullanılan payı %96,8 (kaynak 24,3 MB) | 10 denetimin hepsi tuttu |

**Dizin başta mı (faststart)?** Dizini dosyanın sonunda olan: 10 / 10 dosya (BÜTÇE DIŞI, bütçe ≤ 0). Dizin sondaysa dosya indirilirken ya da bir sayfaya gömülüyken tamamı gelmeden oynatılamaz; yerel oynatmayı etkilemez. Yukarıdaki “her yerde açılır” sütunu bu denetimi saymaz.

**Büyütme yok (ADR-041)** — video dosyası üreten her yol, 640 × 360, 854 × 480 ve 1280 × 720 kaynakla: kaydedilen dosyanın piksel sayısı kaynağınkini geçmemeli. Hücre: çıkan boyut ve çıkan / kaynak piksel oranı (1’in üstü büyütmedir). Kaynak: üretilmiş, loş ve kumlu deneme deseni, 6 sn. “Yazıya dök” ve “Sesini al” görüntü kaydetmez.


| Yol | 360p kaynak | 480p kaynak | 720p kaynak |
| --- | --- | --- | --- |
| Boşlukları at | 640 × 360 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 854 × 480 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 1280 × 720 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) |
| Her yerde açılsın (WebM kaynak) | 640 × 360 (× 1), yeniden işlendi | 854 × 480 (× 1), yeniden işlendi | 1280 × 720 (× 1), yeniden işlendi |
| Dikey yap (Doldur) | 202 × 360 (× 0,32), yeniden işlendi | 270 × 480 (× 0,32), yeniden işlendi | 406 × 720 (× 0,32), yeniden işlendi |
| Sesi düzelt | 640 × 360 (× 1), kopya (yeniden işlenmedi) | 854 × 480 (× 1), kopya (yeniden işlenmedi) | 1280 × 720 (× 1), kopya (yeniden işlenmedi) |
| Editör (doğrudan açıldı, Ayarlar’a dokunulmadı) | 640 × 360 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 854 × 480 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 1280 × 720 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) |
| İyileştir (karanlık, kamera benzeri kaynak) | 640 × 360 (× 1), yeniden işlendi | 854 × 480 (× 1), yeniden işlendi | 1280 × 720 (× 1), yeniden işlendi |
| Kes | 640 × 360 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 854 × 480 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 1280 × 720 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) |
| Küçült (Daha da küçült) | 640 × 360 (× 1), yeniden işlendi | 854 × 480 (× 1), yeniden işlendi | 1280 × 720 (× 1), yeniden işlendi |
| Müzik ekle | 640 × 360 (× 1), kopya (yeniden işlenmedi) | 854 × 480 (× 1), kopya (yeniden işlenmedi) | 1280 × 720 (× 1), kopya (yeniden işlenmedi) |
| Sesi kapat | 640 × 360 (× 1), kopya (yeniden işlenmedi) | 854 × 480 (× 1), kopya (yeniden işlenmedi) | 1280 × 720 (× 1), kopya (yeniden işlenmedi) |

**İyileştir** — ADR-037’nin ölçüleri (`web/tests/e2e/enhance-media.ts`: ortalama parlaklık, Laplace varyansı), üretilmiş dört video üzerinde.


| Video | Uygulamanın dediği | İndirme sunuldu | Parlaklık önce → sonra | Keskinlik önce → sonra | Eklenen en büyük parlaklık sıçraması | Kare |
| --- | --- | --- | --- | --- | --- | --- |
| karanlık | “Yapılacaklar: video belirgin biçimde aydınlatılır, renkler toparlanır.” | evet | 69,2 → 120 (+50,8) | 50,7 → 109,3 | 0,18 | 90 / 90 |
| bulanık | “Yapılacaklar: renkler toparlanır, kenarlar keskinleştirilir.” | evet | 140,3 → 141,6 | 24,7 → 27,9 (× 1,13) | 0,05 | 90 / 90 |
| kumlu | “Yapılacaklar: ışık ve kontrast biraz düzeltilir, renkler toparlanır, kumlanma azaltılır.” | evet | 104,8 → 119,1 | 373,9 → 116 | 0,17 | 90 / 90 |
| iyi (doğru pozlanmış, keskin) | “Yapılacaklar: renkler toparlanır.” | evet | 140,3 → 141,7 (1,4 kaydı) | 198 → 176,6 (× 0,89) | 0,1 | 90 / 90 |

Gerçek kayıtlardaki “zarar verme” ölçümü (ADR-037, Ölçüm 2; `web/scripts/enhance-eval/no-harm.mjs`) kurucunun kendi videolarını gerektirir; bu betik onlara dokunmaz ve o ölçümü yeniden koşmaz.

## 6. Yazıya dökme kalitesi

**KAYITLI, BU KOŞUDA YENİDEN ÖLÇÜLMEDİ.** Aşağıdaki sayılar ADR-036 çalışmasında, gerçek modellerle ve gerçekçi değerlendirme kümesiyle alındı; bu betik onları bir dosyadan (`web/scripts/quality/recorded.json`) okur, hiçbir şeyi yeniden hesaplamaz.

Kaynak: `docs/adr/ADR-036-on-device-transcript.md — “Sonuç: önce / sonra” (gerçekçi küme, bugünkü ayarlar: “sonra” sütunları)` — ölçüm tarihi 2026-10-07 / 2026-10-08, belgeyi yazan commit `2292e16`, gerçek modeller (base: WebAssembly, turbo: WebGPU), Chromium; doğrulama yarısı üretim derlemesinde, geliştirme yarısı e2e derlemesinde.


| Küme, model | WER normalize (katı) | Konuşma süresinin yazılan payı | Koruma attı | Hiç duyulmadı | Negatifte uydurma metin |
| --- | --- | --- | --- | --- | --- |
| Doğrulama yarısı (rval: 8 klip, 116 dk), küçük model (base) | %19,6 (%24,1) | %89,8 | %6,3 | %3,9 | 0 / 45 |
| Doğrulama yarısı (rval), büyük model (turbo) | %14,3 (%19,2) | %95,6 | %0,5 | %3,9 | 0 / 45 |
| Geliştirme yarısı (rdev: 7 klip, 72 dk; ayarlar bunun üstünde seçildi), küçük model (base) | %26,5 (—) | %82,2 | %9 | %8,8 | 0 / 45 |
| Geliştirme yarısı (rdev), büyük model (turbo) | %18,1 (—) | %90,1 | %1,1 | %8,8 | 0 / 45 |

- Küme toplantı ve konferans görüşmesi kayıtlarıdır (dolgu sözleri, üst üste konuşma); bu WER’ler okunmuş konuşmanınkilerle karşılaştırılmaz. Aynı belgede temiz, okunmuş uzun dosyalarda küçük modelin katı WER’i %4,9–9,7 olarak kayıtlıdır (7 Ekim’deki ayar değişikliğinden önce ölçüldü).
- “Negatifte uydurma metin”: doğru çıktısı boş olan 45 klipte yazılan metin; iki modelde de 0.
- Yalnızca İngilizce. Türkçe uygulamada kapalıdır.
- Gerçekçi kümenin medyası ve model dosyaları bu depoda yoktur; yeniden ölçmek saatler sürer: `web/scripts/transcript/run-app.mjs`, `run-parts.mjs`, `score-real.mjs` (ADR-036’daki komutlar).

**Bu koşuda gerçek model** (`--with-transcript`)

Ölçülmedi: `--with-transcript` verilmedi (varsayılan koşu modeli çalıştırmaz).

Görev yürüyüşlerindeki “Yazıya dök” satırı betikli bir tanıyıcıyla alınmıştır ve yazı kalitesi DEĞİLDİR (bölüm 1).

## 7. Performans bütçeleri

Statik çıktı, gzip’li yerel sunucu (GitHub Pages gibi), her ölçüm yeni tarayıcı bağlamı ve boş önbellek, 3 koşunun ortancası. Baytlar gerçekten aktarılan (sıkıştırılmış) baytlardır. Ortancanın yanındaki parantez üç koşunun en az–en çok değeridir; TBT koşudan koşuya onlarca ms oynar. Service worker kapalıydı: ilk ziyaret ölçülür, arka plandaki çevrimdışı indirmesi sayılmaz. “Mobil kısıtlama” masaüstü işlemcide bir öykünmedir, telefon değildir. Yöntem `docs/perf/2026-09-30-load.md` ile aynı.


| Sayfa | Profil | Aktarılan JS | Toplam aktarılan | FCP | LCP | TBT | load | JS yığını (yükleme sonrası) | Dış istek |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ana ekran `/` | bu makine | 192 KB (10 dosya) | 206 KB | 72 ms | 72 ms (64–108) | 0 ms | 105 ms | 2,7 MB | 0 |
| Ana ekran `/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 192 KB (10 dosya) | 206 KB | 608 ms | 608 ms (600–648) | 102 ms (98–148) | 1.542 ms | 2,7 MB | 0 |
| Editör `/editor/` | bu makine | 248 KB (15 dosya) | 330 KB | 112 ms | 112 ms (104–120) | 0 ms | 129 ms | 3,3 MB | 0 |
| Editör `/editor/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 248 KB (15 dosya) | 330 KB | 820 ms | 820 ms (804–940) | 123 ms (105–153) | 1.880 ms | 3,3 MB | 0 |
| Sihirbaz `/yap/dikey/` | bu makine | 241 KB (14 dosya) | 263 KB | 76 ms | 76 ms (56–84) | 0 ms | 114 ms | 3 MB | 0 |
| Sihirbaz `/yap/dikey/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 241 KB (14 dosya) | 263 KB | 680 ms | 680 ms (664–704) | 173 ms (160–191) | 1.920 ms | 3 MB | 0 |

**Bellek:** 12 sn’lik 1920 × 1080 video dikey yapılırken ana iş parçacığının JS yığını — boşta 2,7 MB, video açıkken 5,7 MB, tepe 6,8 MB (bütçe içinde, bütçe ≤ 150 MB), bittikten sonra 5,7 MB; 33 örnek. Dışa aktarmanın işçileri (worker) ve kodlayıcı bu sayının DIŞINDADIR; bütün süreç ağacının belleği `web/scripts/measure-export-memory.mjs` ile ölçülür (ADR-029), burada yeniden koşulmadı.

**Dışa aktarma hızı** — “İndir”e basıştan dosyanın hazır olmasına; × gerçek zaman = çıktı süresi / geçen süre. Ölçüm kilidi altında, bu makinede.


| Durum | Yol | Çıktı | Geçen süre | × gerçek zaman |
| --- | --- | --- | --- | --- |
| Her yerde açılsın, senkron klibi (H.264 MP4) | kopya | 12 sn, 1080 × 1920 | 0,89 sn | 13,5 × |
| Her yerde açılsın, senkron klibi (VP9 WebM) | yeniden işlendi | 12 sn, 1080 × 1920 | 3,43 sn | 3,5 × |
| Dikey yap, senkron klibi (zaten 9:16) | kopya | 12 sn, 1080 × 1920 | 0,86 sn | 14 × |
| Kes 2–8 sn, senkron klibi (H.264 MP4) | kopya | 6 sn, 1080 × 1920 | 0,93 sn | 6,5 × |
| Kes 2–8 sn, senkron klibi (VP9 WebM) | yeniden işlendi | 6 sn, 1080 × 1920 | 2,43 sn | 2,5 × |
| Küçült (seçim değişmeden: WhatsApp), ağır senkron klibi (H.264, yaklaşık 33 MB) | yeniden işlendi | 12 sn, 1080 × 1920 | 4,51 sn | 2,7 × |
| Her yerde açılsın, kamera benzeri 720p VP9 WebM | yeniden işlendi | 6 sn, 1280 × 720 | 1,9 sn | 3,2 × |
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 12 sn, 608 × 1080 | 3,45 sn | 3,5 × |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma | 3 sn, 1920 × 1080 | 1,39 sn | 2,2 × |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 12 sn, 1920 × 1080 | 5,51 sn | 2,2 × |
| İyileştir, karanlık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 2,91 sn | 1 × |
| İyileştir, bulanık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 4,99 sn | 0,6 × |
| İyileştir, kumlu video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 9,91 sn | 0,3 × |
| İyileştir, iyi video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 3,44 sn | 0,9 × |

İyileştir satırları grafik hızlandırma olmadan alındı: Playwright’ın Chromium’u bu makinede WebGL’i yazılımla çiziyor (uygulama da bunu söylüyor). Grafik kartı kullanan gerçek bir tarayıcıdaki hız BURADA ÖLÇÜLMEDİ; bu sayı en kötü durumdur.

## 8. Görsel regresyon

Taban resimler: `web/tests/quality/baselines/` (166 PNG; Windows’ta Chromium’un sistem yazı tipleriyle çizdiği hâl). Karşılaştırma toleranslıdır: bir pikselin bir renk kanalı 40 / 255’ten fazla ayrışırsa “farklı” sayılır; piksellerin %1’inden fazlası farklıysa ekran “farklı” sayılır. Video, canvas ve saate ya da kodlayıcıya bağlı metinler maskelenir. **CI’da koşulmaz** (aşağıda neden).


|  | Ekran | Bütçe | Durum |
| --- | --- | --- | --- |
| Karşılaştırılan ekran | 166 | — | bütçesiz |
| Farklı | 0 | ≤ 0 | bütçe içinde |
| Karşılaştırılamadı | 0 | ≤ 0 | bütçe içinde |
| Bu koşuda taban yazıldı / yenilendi (karşılaştırma değil) | 0 | — | bütçesiz |

**Ekranlar**


| Ekran | Masaüstü | Telefon | Masaüstü EN | Telefon EN |
| --- | --- | --- | --- | --- |
| `ana-ekran` | aynı | aynı | aynı | aynı |
| `ana-ekran-arama` | aynı (%0,04) | aynı (%0,14) | aynı | aynı |
| `ana-ekran-bulunamadi` | aynı (%0,04) | aynı (%0,14) | aynı | aynı |
| `ana-ekran-soru` | aynı (%0,04) | aynı (%0,14) | aynı | aynı |
| `ana-ekran-yapamiyoruz` | aynı (%0,14) | aynı (%0,53) | aynı | aynı |
| `editor-bos` | aynı | aynı | aynı (%0,27) | aynı |
| `sihirbaz-bosluk-secim` | aynı | aynı | aynı | aynı |
| `sihirbaz-dikey-secim` | aynı | aynı | aynı | aynı |
| `sihirbaz-duzelt-secim` | aynı | aynı | aynı | aynı |
| `sihirbaz-gif-secim` | aynı | aynı | aynı | aynı |
| `sihirbaz-iyilestir-secim` | aynı | aynı | aynı | aynı |
| `sihirbaz-kucult-secim` | aynı | aynı | aynı | aynı |
| `sihirbaz-muzik-secim` | aynı | aynı | aynı | aynı |
| `sihirbaz-sonuc` | aynı | aynı | aynı | aynı |
| `sihirbaz-yazi-model` | aynı | aynı | aynı | aynı |
| `yol-bosluk-ilk` | aynı | aynı | aynı | aynı |
| `yol-bosluk-sonuc` | aynı | aynı | aynı | aynı |
| `yol-cevir-ilk` | aynı | aynı | aynı | aynı |
| `yol-cevir-sonuc` | aynı | aynı | aynı | aynı |
| `yol-dikey-ilk` | aynı | aynı | aynı | aynı |
| `yol-dikey-sonuc` | aynı | aynı | aynı | aynı |
| `yol-duzelt-ilk` | aynı | aynı | aynı | aynı |
| `yol-duzelt-sonuc` | aynı | aynı | aynı | aynı |
| `yol-gif-ilk` | aynı | aynı | aynı | aynı |
| `yol-gif-sonuc` | aynı (%0,01) | aynı (%0,05) | aynı (%0,01) | aynı (%0,05) |
| `yol-iyilestir-ilk` | aynı | aynı | aynı | aynı |
| `yol-iyilestir-sonuc` | aynı | aynı | aynı | aynı |
| `yol-kes-ilk` | aynı | aynı | aynı | aynı |
| `yol-kes-sonuc` | aynı | aynı | aynı (%0,24) | aynı |
| `yol-kucult-ilk` | aynı | aynı | aynı | aynı |
| `yol-kucult-sonuc` | aynı | aynı | aynı | aynı |
| `yol-muzik-ilk` | aynı | aynı | aynı | aynı |
| `yol-muzik-sonuc` | aynı | aynı | aynı | aynı |
| `yol-ses-ilk` | aynı | aynı | aynı | aynı |
| `yol-ses-sonuc` | aynı | aynı | aynı | aynı |
| `yol-sustur-ilk` | aynı | aynı | aynı | aynı |
| `yol-sustur-sonuc` | aynı | aynı | aynı | aynı |
| `yol-yazi-bulut-ilk` | aynı | aynı | — | — |
| `yol-yazi-bulut-secim` | aynı (%0,19) | aynı (%0,5) | — | — |
| `yol-yazi-bulut-secim-kodsuz` | aynı (%0,18) | aynı (%0,45) | — | — |
| `yol-yazi-bulut-sonuc` | aynı | aynı | — | — |
| `yol-yazi-bulut-yazi` | aynı | aynı | — | — |
| `yol-yazi-ilk` | aynı | aynı | aynı | aynı |
| `yol-yazi-kancali-ilk` | aynı | aynı | — | — |
| `yol-yazi-kancali-sonuc` | aynı | aynı | — | — |

**CI kararı:** bu karşılaştırma CI’da kapı değildir ve `.github/workflows/ci.yml` dosyasına eklenmedi. CI da Windows’ta koşar, ama GitHub’ın Windows Server görüntüsündeki yazı tipi çizimi bu makinedekiyle (Windows 11) aynı tabanları verecek mi, ölçülmedi; tabanlar bu makinede üretildi. Kararlı olduğu CI’da gösterilmeden kapı yapılmamalı.

## 9. Erişilebilirlik ve çocuk-dostu ölçüler

Kontrast, rol ve ad kuralları axe ile zaten denetleniyor (`web/tests/e2e/a11y.spec.ts`, `enhance-a11y.spec.ts`, `transcript-a11y.spec.ts`; WCAG 2.2 AA etiketleri); burada tekrar edilmedi. Aşağıdakiler axe’ın ölçmediği şeylerdir.

**telefon (390 × 844, dokunmatik)**


| Ekran | Kontrol | 44 px’ten küçük hedef | 24 px’ten küçük | Adsız kontrol | En küçük yazı; 14 px altı kelime | 12 px altı kelime | Klavye (Tab) sırası | Odak halkası görünmeyen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ana ekran, arama sonucu (“sessiz yerleri sil”) | 7 | 0 | 0 | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu bulamadım.” | 6 | 0 | 0 | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, emin değilken seçenekler (“tiktok için kes”) | 8 | 0 | 0 | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu henüz yapamıyoruz.” (“videoyu döndür”) | 7 | 0 | 0 | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran | 20 | 0 | 0 | 0 | 14 px; %0 | 0 | 20 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video yok | 8 | **1** (bütçe ≤ 0) | **1** (bütçe ≤ 0) | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan **1** (bütçe ≤ 0); geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video ve bir kesit | 19 | 0 | 0 | 0 | 12 px; %17 | 0 | 19 durak; ulaşılamayan 0; geri sıçrama 1 (çok sütunlu; yargılanmaz) | 0 |
| Boşlukları at, seçim | 8 | 0 | 0 | 0 | 14 px; %0 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Dikey yap, seçim | 8 | 0 | 0 | 0 | 14 px; %0 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sesi düzelt, özet (dengesiz konuşma) | 7 | 0 | 0 | 0 | 14 px; %0 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| GIF yap, tek ekran (iki yazı yazılmış) | 13 | 0 | 0 | 0 | 14 px; %0 | 0 | 11 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, ilk ekran (Dikey yap) | 3 | 0 | 0 | 0 | 14 px; %0 | 0 | 3 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| İyileştir, seçim | 9 | 0 | 0 | 0 | 14 px; %0 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Küçült, seçim | 9 | 0 | 0 | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Müzik ekle, seçim (müzik seçilmiş) | 9 | 0 | 0 | 0 | 14 px; %0 | 0 | 14 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, sonuç ekranı (Her yerde açılsın) | 8 | 0 | 0 | 0 | 14 px; %0 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Yazıya dök, model adımı | 5 | 0 | 0 | 0 | 14 px; %0 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |

- **Editör, video yok** — 44 px’ten küçük: Proje adı — 22 × 38 px
- **Editör, video yok** — Tab ile ulaşılamayan: Proje adı
- **14 px’ten küçük yazılardan örnekler** (bütün ekranlardan): 12 px: 00:00 · 12 px: 00:02 · 12 px: 00:04 · 12 px: 00:06 · 12 px: 00:08 · 12 px: 1
- **Görünür yazısı olmayan düğmeler** (yalnız simge; erişilebilir adı var): Yazdığını sil; Diğer; Oynatma çizgisi; Geri al; Ayarlar; Tam ekran izle (F); Oynat; Mesajı kapat; Kesit 1'i oynat, 00:01–00:03; Kesit 1'i sil, 00:01–00:03; Önizlemeyi oynat; GIF olacak kısım; Kısmın başı; Kısmın sonu

**masaüstü (1440 × 900)**


| Ekran | Kontrol | 44 px’ten küçük hedef | 24 px’ten küçük | Adsız kontrol | En küçük yazı; 14 px altı kelime | 12 px altı kelime | Klavye (Tab) sırası | Odak halkası görünmeyen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ana ekran, arama sonucu (“sessiz yerleri sil”) | 7 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %64 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu bulamadım.” | 6 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %52 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, emin değilken seçenekler (“tiktok için kes”) | 8 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %49 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu henüz yapamıyoruz.” (“videoyu döndür”) | 7 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %67 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran | 20 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %28 | 0 | 20 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video yok | 8 | 3 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %47 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video ve bir kesit | 20 | 4 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %84 | 0 | 20 durak; ulaşılamayan 0; geri sıçrama 1 (çok sütunlu; yargılanmaz) | 0 |
| Boşlukları at, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %45 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Dikey yap, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %41 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sesi düzelt, özet (dengesiz konuşma) | 7 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %28 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| GIF yap, tek ekran (iki yazı yazılmış) | 13 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %23 | 0 | 11 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, ilk ekran (Dikey yap) | 3 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %42 | 0 | 3 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| İyileştir, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %53 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Küçült, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %50 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Müzik ekle, seçim (müzik seçilmiş) | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %47 | 0 | 14 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, sonuç ekranı (Her yerde açılsın) | 7 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %29 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Yazıya dök, model adımı | 5 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %21 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |

**Okunabilirlik** — `web/src/i18n/messages.ts` içindeki Türkçe metinler; Ateşman puanı (90–100 çok kolay · 70–89 kolay · 50–69 orta · 30–49 zor · 30 altı çok zor).


| Metinler | Metin | Puanlanan (5+ kelime) | Ortanca puan | Zor + çok zor | Çok zor | 20 kelimeden uzun cümle | En uzun cümle | En uzun kelime |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Varsayılan yol (ana ekran, kartlar, sihirbazlar, yazıya dökme, indirme, hata) | 609 | 315 | 85,9 | %1,6 | 0 | 1 | 22 kelime | birleştirilebiliyor |
| Bütün metinler (editör dahil) | 1.341 | 647 | 80,1 | %3,7 | 2 | 8 | 28 kelime | transcriptLargeFailed |

Varsayılan yolun metinlerinden teknik terim içeren: 11 (bütçesiz). Bu, metin tablosunun taramasıdır: bir metnin ekrana hangi koşulda geldiğini bilmez (bir kısmı yalnızca hata olduğunda ya da “Ayrıntılar” açıldığında görünür). Gerçekten görülenler bölüm 1’dedir.

**En zor 20 metin (varsayılan yol)**


| Puan | Anahtar | Cümle başına kelime | Kelime başına hece | Metin |
| --- | --- | --- | --- | --- |
| 33,1 (zor) | `transcript.machine` | 5 | 3,8 | “Otomatik yazıldı — yanlış olabilir, düzeltebilirsin.” |
| 37,7 (zor) | `download.readyWhereDevice` | 4 | 3,75 | “Tarayıcın dosyayı İndirilenler klasörüne kaydeder; Dosyalar uygulamasında bulursun.” |
| 41,1 (zor) | `cloud.machine` | 5 | 3,6 | “İnternette yazıldı — yanlış olabilir, düzeltebilirsin.” |
| 48,2 (zor) | `download.readyWhere` | 10 | 3,1 | “Tarayıcın dosyayı İndirilenler klasörüne kaydeder (ya da nereye kaydedeceğini sorar).” |
| 49,2 (zor) | `download.targetReduced` | 5 | 3,4 | “Sığması için görüntünün ayrıntısı azaltıldı” |
| 50,4 (orta) | `export.fail.output_probe_failed` | 3 | 3,5 | “Oluşan dosya yeniden açılamadı; başarılı sayılmadı.” |
| 51,1 (orta) | `cloud.failed.audio_unavailable` | 4 | 3,42 | “Bu tarayıcı videonun sesini gönderilecek hâle getiremiyor; hiçbir şey gönderilmedi. Cihazında yazabiliriz.” |
| 51,9 (orta) | `silence.failed.undecodable` | 3,5 | 3,43 | “Bu tarayıcı videonun sesini çözemiyor; sessizlik aranamadı.” |
| 51,9 (orta) | `enhance.preview.failed.source_undecodable` | 3,5 | 3,43 | “Bu tarayıcı bu videoyu çözemiyor; iyileştirme yapılamıyor.” |
| 51,9 (orta) | `transcript.failed.undecodable` | 3,5 | 3,43 | “Bu tarayıcı videonun sesini çözemiyor; yazıya dökülemedi.” |
| 52,6 (orta) | `enhance.setting.previewNote` | 6 | 3,25 | “Oynatıcı videonun kendi hâlini gösterir. Aşağıdaki resim indirilecek videonun gerçek bir karesidir.” |
| 52,8 (orta) | `silence.failed.worker_unavailable` | 4 | 3,38 | “Çözümleme bu tarayıcıda başlatılamadı. Sayfayı yenileyip tekrar dene.” |
| 54,3 (orta) | `cloud.file.header` | 7 | 3,14 | “LiloCut ile internette otomatik yazıldı — yanlış olabilir.” |
| 55,7 (orta) | `download.targetNormal` | 2,5 | 3,4 | “Olağan kalitede sığdı; ayrıntı azaltılmadı” |
| 55,7 (orta) | `transcript.unclearCount` | 2,5 | 3,4 | “{n} yer anlaşılamadı; dinleyip elle yazabilirsin.” |
| 55,9 (orta) | `export.fail.output_duration_mismatch` | 6 | 3,17 | “Oluşan dosyanın süresi beklenen süreyle uyuşmadı.” |
| 55,9 (orta) | `transcript.english` | 6 | 3,17 | “Şimdilik yalnızca İngilizce konuşmaları yazıya döker.” |
| 55,9 (orta) | `cloud.done.skipped` | 6 | 3,17 | “{n} satır altyazı kurallarına uymadığı için atlandı.” |
| 56,7 (orta) | `wizard.yazi.editorHint` | 13 | 2,69 | “Satırları seçip onlardan kesit yapmak ya da altyazının görünüşünü değiştirmek için editörde aç.” |
| 57,1 (orta) | `cloud.online.off` | 3 | 3,33 | “Şu an internette yazamıyoruz. Cihazında yazabiliriz.” |

**Okunabilirlik, İngilizce** — `web/src/i18n/messages.en.ts` ve `cloudMessages.en.ts`; Flesch okuma kolaylığı (90–100 çok kolay · 80–89 kolay · 70–79 oldukça kolay · 60–69 sade · 50–59 oldukça zor · 30–49 zor · 30 altı çok zor). Aynı anahtarlar, aynı “varsayılan yol”, İngilizce teknik terim listesi (`STRONG_EN`). Heceler İngilizce yazımdan kural ile sayılır (ünlü öbekleri, sondaki sessiz “e”): çoğu kelimede doğru, bazılarında bir eksik ya da fazla.


| Metinler (İngilizce) | Metin | Puanlanan (5+ kelime) | Ortanca puan | Zor + çok zor | Çok zor | 20 kelimeden uzun cümle | En uzun cümle | En uzun kelime |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Varsayılan yol (İngilizce) | 609 | 382 | 88 | %1,8 | 0 | 3 | 26 kelime | automatically |
| Bütün metinler (İngilizce, editör dahil) | 1.341 | 792 | 87 | %3,2 | 5 | 27 | 39 kelime | transcriptLargeFailed |

Varsayılan yolun İngilizce metinlerinden teknik terim içeren: 11 (bütçesiz).

**En zor 20 İngilizce metin (varsayılan yol)**


| Puan | Anahtar | Cümle başına kelime | Kelime başına hece | Metin |
| --- | --- | --- | --- | --- |
| 34,2 (difficult) | `cloud.file.header` | 11 | 1,91 | “Written automatically on the internet with LiloCut — it may be wrong.” |
| 41,9 (difficult) | `transcript.file.header` | 11 | 1,82 | “Written automatically on this device with LiloCut — it may be wrong.” |
| 45,6 (difficult) | `task.tercume.sub` | 6 | 1,83 | “Subtitles or speech in another language” |
| 49,5 (difficult) | `task.filigran.label` | 5 | 1,8 | “Remove a watermark or logo” |
| 49,5 (difficult) | `wizard.dikey.preview` | 5 | 1,8 | “Preview of the vertical video” |
| 49,5 (difficult) | `wizard.yazi.downloadVideo` | 5 | 1,8 | “Download the video with subtitles” |
| 49,5 (difficult) | `cloud.done.speakers` | 5 | 1,8 | “{n} different people were told apart.” |
| 50,7 (fairly difficult) | `export.fail.audio_undecodable` | 8 | 1,75 | “This browser cannot decode the selected audio file.” |
| 51,9 (fairly difficult) | `silence.failed.internal_error` | 4,5 | 1,78 | “The analysis stopped with an unexpected error. Try again.” |
| 52 (fairly difficult) | `transcript.model.turbo` | 2,5 | 1,8 | “Recommended: large model (≈{size}, downloaded once)” |
| 52 (fairly difficult) | `transcript.model.baseRecommended` | 2,5 | 1,8 | “Recommended: small model (≈{size}, downloaded once)” |
| 54,7 (fairly difficult) | `cloud.online.body` | 4 | 1,75 | “More accurate, much faster. Also tells speakers apart.” |
| 55,1 (fairly difficult) | `wizard.duzelt.failed.internal_error` | 5,5 | 1,73 | “Something unexpected went wrong while listening to the sound. Try again.” |
| 57,2 (fairly difficult) | `transcript.machine` | 11 | 1,64 | “Written automatically — it may be wrong, and you can correct it.” |
| 59,7 (fairly difficult) | `task.gif.sub` | 6 | 1,67 | “An animated picture from the video” |
| 59,7 (fairly difficult) | `task.indir.label` | 6 | 1,67 | “Download a video from the internet” |
| 59,7 (fairly difficult) | `wizard.moreSettings` | 6 | 1,67 | “More settings → open in the editor” |
| 59,7 (fairly difficult) | `wizard.muzik.keepHint` | 6 | 1,67 | “The music plays quietly behind it.” |
| 59,7 (fairly difficult) | `cloud.online.fact.who` | 6 | 1,67 | “It goes to a company called **AssemblyAI**. Its computers are in Europe.” |
| 60,6 (plain) | `wizard.cevir.body` | 21 | 1,48 | “Videos shot on an iPhone, or that will not open on other devices, become an MP4 that opens on every device.” |

## Bu rapor neyi söylemez

- Bir çocuğun ya da ilk kez kullanan birinin nerede durakladığını, neyi yanlış anladığını, neyi beğenmediğini. Betik hiç duraksamaz ve her düğmenin adını önceden bilir.
- Gerçek telefonu: “telefon” burada masaüstü Chromium’un 390 × 844 dokunmatik öykünmesidir. Gerçek Android / iPhone’da hız, bellek, dosya seçici ve paylaşım ayrı ölçülür (`web/scripts/android/`).
- Gerçek çekimlerde görüntü kalitesini: sadakat ölçüleri üretilmiş, kamera benzeri bir videoda alındı.
- Yazıya dökmenin bugünkü doğruluğunu: bölüm 6 kayıtlı sayılardır.
- e2e testlerinin bu commit’te geçtiğini: atıf yapılan testler burada koşulmaz.
