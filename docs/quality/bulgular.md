**Yazıldığı koşu:** 11 Ekim 2026 öğleden sonra, dal `worktree-agent-a511c0275d7647e51` (önceki bulgular: aynı gün, `b8e355f`). O raporda açık kalan üç şey üzerinde çalışıldı: aramanın yanlış karta göndermesi, editörün her videoyu 1080p’ye büyütmesi, 720p’den küçük kaynakların büyütülmesi. Aşağıda her biri için aynı ölçünün önceki → şimdiki değeri var. Açık kalanlar en başta.

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
