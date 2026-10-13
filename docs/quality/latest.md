# Kalite raporu — 2026-10-13

> Üreten: `npm run quality` (`web/scripts/quality/run.mjs`). Ölçüm koşusu: 2026-10-13 07:31 UTC, commit `bbc13ea` + kaydedilmemiş değişiklikler, 26 dk; ölçülen bölümler: search, text, walkthrough, errors, honesty, output, perf, visual, a11y. Raporun metni 2026-10-13 07:32 UTC tarihinde ölçüm yapılmadan yeniden yazıldı (`--report-only`).
> Makine: Windows_NT 10.0.26200, 12th Gen Intel(R) Core(TM) i5-12500 × 12, 64 GB bellek. Tarayıcı: Playwright’ın Chromium’u. Bütün medya üretilmiş (ffmpeg) ya da depodaki haklı örneklerdir; hiçbir şey makineden çıkmadı.
> Bu rapor bir kullanıcı testinin yerini TUTMAZ; neyi söylemediği en altta ve `docs/quality/README.md` içinde.

## Öne çıkan bulgular

_Bu bölüm elle yazılır (`docs/quality/bulgular.md`); sayılar aşağıdaki tablolardan gelir. Rapor yeniden üretildiğinde olduğu gibi yerine konur — tarihine bakın._

**Yazıldığı koşu:** 11 Ekim 2026 öğleden sonra, dal `worktree-agent-a511c0275d7647e51` (önceki bulgular: aynı gün, `b8e355f`). O raporda açık kalan üç şey üzerinde çalışıldı: aramanın yanlış karta göndermesi, editörün her videoyu 1080p’ye büyütmesi, 720p’den küçük kaynakların büyütülmesi. Aşağıda her biri için aynı ölçünün önceki → şimdiki değeri var. Açık kalanlar en başta.

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

3. **Editörün açılışı yavaş telefonda sınırın kıyısında.** Mobil kısıtlamada TBT bu koşuda 176 ms (167–191) — bütçe (200 ms) içinde; sabahki koşuda 206 ms (167–213) idi. Bu çalışmada editörün açılışına dokunulmadı: ölçü koşudan koşuya sınırın iki yanına düşüyor, “düzeldi” sayılamaz. Kanıt: bölüm 7.

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

641 ölçü: **564 bütçe içinde**, **8 bütçe dışı**, **5 ölçülemedi**, 64 bütçesiz (yalnızca bildirilir). Bütçeler: `web/scripts/quality/budgets.json`.


| Bölüm | Ölçüm zamanı | Derleme | Bütçe içinde | Bütçe dışı | Ölçülemedi | Bütçesiz |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Görev tamamlama yürüyüşleri | 2026-10-13 07:23 UTC | statik çıktı + test kancalı + bulut (sahte sunucu) | 220 | 0 | **4** | 0 |
| 2. Arama kalitesi | 2026-10-13 07:21 UTC | tarayıcısız | 5 | **7** | 0 | 32 |
| 3. Hata yolları | 2026-10-13 07:23 UTC | statik çıktı | 5 | 0 | 0 | 2 |
| 4. Dürüstlük denetimleri | 2026-10-13 07:25 UTC | statik çıktı | 22 | 0 | 0 | 0 |
| 5. Çıktı kalitesi | 2026-10-13 07:29 UTC | statik çıktı | 71 | **1** | 0 | 0 |
| 6. Yazıya dökme kalitesi | koşulmadı | — | 0 | 0 | **1** | 8 |
| 7. Performans bütçeleri | 2026-10-13 07:31 UTC | statik çıktı | 39 | 0 | 0 | 0 |
| 8. Görsel regresyon | 2026-10-13 07:31 UTC | statik çıktı + bulut (sahte sunucu) + test kancalı | 2 | 0 | 0 | 2 |
| 9. Erişilebilirlik ve çocuk-dostu ölçüler | 2026-10-13 07:31 UTC | statik çıktı + tarayıcısız | 200 | 0 | 0 | 20 |

**Başlık sayıları**


| Ölçü | Değer |
| --- | --- |
| Dosyası doğrulanan görev (Yazıya dök hariç; masaüstü / telefon) | 9 / 9 · 9 / 9 |
| Ana ekrandan dosyaya en çok tıklama (masaüstü / telefon) | 4 / 5 |
| Varsayılan yolda görülen, teknik terim içeren farklı cümle | 0 |
| Arama (yeni ayrı küme): ilk satır doğru / ilk üçte / yanlış ama emin | %75,7 / %80,4 / %3 |
| Arama: sordu (“Bunu mu demek istedin?”) / sorduğunda doğrusu seçeneklerde / açık isteğe soru / doğrudan doğru | %25,2 / %88,6 / %5,6 / %54,1 |
| Arama, eski küme (KİRLENMİŞ): ilk satır doğru / yanlış ama emin | %92,4 / %0,9 |
| Hata hücreleri: iyi / belirsiz / bozuk | 74 / 0 / 0 |
| İlerleme çubuğu geri gitti (kez) · iptalden sonra kalan bayt | 0 · 0 |
| Kaynağından büyük çıkan dosya (9 yol × 360p, 480p, 720p kaynak) | 0 / 27 |
| Eklenen ses–görüntü sapması (en kötü) · süre hatası (en kötü) | 1 ms · 16 ms |
| Görüntü sadakati, en düşük: SSIM · VMAF | 0,9658 · 84,7 |
| Küçült → WhatsApp hedefe sığdı | evet |
| Ana ekran: LCP (mobil kısıtlama) · aktarılan JS | 580 ms · 178 KB |
| En yavaş yeniden işleme hızı | 2,2 × gerçek zaman |
| Tabanından farklı ekran | 0 |
| Telefonda 44 px’ten küçük dokunma hedefi · adsız kontrol | 0 · 0 |
| Okunabilirlik (varsayılan yol): ortanca Ateşman · zor metin payı | 81,1 · %2 |

**Bütçe dışı ölçüler** (8)


| Ölçü | Değer | Bütçe |
| --- | --- | --- |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) | %75,7 | ≥ %85 |
| İlk üç satırda var | %80,4 | ≥ %90 |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %2 | ≤ %0 |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) | %88 | ≥ %95 |
| “Bunu henüz yapamıyoruz.” — isabet (precision) | %88,2 | ≥ %95 |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) | %65 | ≥ %80 |
| Anlamsız yazı / sohbete kart önerilmedi | %88,9 | ≥ %90 |
| Dizini (moov) sonda olan dosya — “faststart” değil | 10 / 10 | ≤ 0 |

**Ölçülemeyenler** (5)


| Ölçü | Neden |
| --- | --- |
| Yazıya dök (masaüstü): dosya çıktı ve doğru | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Yazıya dök (masaüstü): karttan dosyaya süre | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Yazıya dök (telefon): dosya çıktı ve doğru | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Yazıya dök (telefon): karttan dosyaya süre | “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. |
| Gerçek küçük model, tek cümle: WER | `--with-transcript` verilmedi; varsayılan koşu modeli çalıştırmaz |

Tablolarda **kalın** yazılan değer bütçesinin dışındadır; “ölçülemedi” yazan hücre ölçülememiştir, sıfır değildir.

## 1. Görev tamamlama yürüyüşleri

Betikli “ilk kez kullanan”: ana ekrandan başlar, yalnızca görünen ve adıyla bulunabilen düğmelere basar (test kimliği kullanmaz), küçük bir deneme videosuyla işi bitirir, kaydedilen dosya ffprobe / ffmpeg ile denetlenir. Derleme: yayınlanan statik çıktı. Sistem pencereleri (dosya seçme, masaüstünde kaydetme) uygulamanın tıklaması sayılmaz. Süre, hiç duraksamayan bir betiğin süresidir: alt sınırdır.

**masaüstü (1440 × 900)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kes | evet | 4 | 2 | 1 | 3 | 152 | 280 | 1,6 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 3 | 0 | 1 | 4 | 105 | 235 | 1,4 sn | 0 | 0 | 0 |
| Dikey yap | evet | 3 | 0 | 1 | 4 | 105 | 233 | 1,4 sn | 0 | 0 | 0 |
| Küçült | evet | 3 | 0 | 1 | 4 | 105 | 270 | 4 sn | 0 | 0 | 0 |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 105 | 196 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 4 | 0 | 1 | 4 | 105 | 226 | 1,5 sn | 0 | 0 | 0 |
| Sesini al | evet | 3 | 0 | 0 | 4 | 105 | 227 | 1,3 sn | 0 | 0 | 0 |
| Sesi kapat | evet | 3 | 0 | 0 | 4 | 105 | 218 | 0,8 sn | 0 | 0 | 0 |
| Her yerde açılsın | evet | 3 | 0 | 0 | 4 | 105 | 234 | 1,4 sn | 0 | 0 | 0 |
| İyileştir | evet | 3 | 0 | 1 | 4 | 136 | 322 | 4,7 sn | 0 | 0 | 0 |

Notlar (masaüstü (1440 × 900)):

- **Yazıya dök:** “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**telefon (390 × 844, dokunmatik)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kes | evet | 5 | 2 | 1 | 3 | 105 | 224 | 1,8 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 4 | 0 | 1 | 4 | 105 | 248 | 1,6 sn | 0 | 0 | 0 |
| Dikey yap | evet | 4 | 0 | 1 | 4 | 105 | 245 | 1,4 sn | 0 | 0 | 0 |
| Küçült | evet | 4 | 0 | 1 | 4 | 105 | 282 | 4 sn | 0 | 0 | 0 |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 105 | 192 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 5 | 0 | 1 | 4 | 105 | 238 | 1,5 sn | 0 | 0 | 0 |
| Sesini al | evet | 4 | 0 | 0 | 4 | 105 | 239 | 1,4 sn | 0 | 0 | 0 |
| Sesi kapat | evet | 4 | 0 | 0 | 4 | 105 | 230 | 0,9 sn | 0 | 0 | 0 |
| Her yerde açılsın | evet | 4 | 0 | 0 | 4 | 105 | 246 | 1,4 sn | 0 | 0 | 0 |
| İyileştir | evet | 4 | 0 | 1 | 4 | 136 | 336 | 4,7 sn | 0 | 0 | 0 |

Notlar (telefon (390 × 844, dokunmatik)):

- **Yazıya dök:** “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**Varsayılan yolda görülen teknik terimler** (Ayarlar ve Ayrıntılar açılmadan; liste: `web/tests/quality/lib/jargon.ts`)
_Yok._

Yarı teknik (sayıldı, yargılanmadı): MP4 / MOV / WebM × 65 · 9:16 / 1080 × 1920 × 2 · MB / GB × 24 · M4A / MP3 / WAV × 7 · model × 6

**Çıkan dosyalar** (ffprobe)

| Görev | Görünüm | Kaynak | Dosya | Süre | İzler | Denetimler |
| --- | --- | --- | --- | --- | --- | --- |
| Kes | masaüstü | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 83 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (82.744 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü kaynaktan büyük değil (1280 × 720 → 1280 × 720); tuttu: kesit, videonun tamamından küçük (472,91 KB → 82,74 KB) |
| Kes | telefon | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 83 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (82.744 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü kaynaktan büyük değil (1280 × 720 → 1280 × 720); tuttu: kesit, videonun tamamından küçük (472,91 KB → 82,74 KB) |
| Boşlukları at | masaüstü | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 62 KB, 256 × 144 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (62.140 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Boşlukları at | telefon | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 62 KB, 256 × 144 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (62.140 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | masaüstü | other-8s.mp4 (640 × 360 yatay, 8 sn) | 385 KB, 202 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (384.942 bayt); tuttu: dikey (9:16) ve kaynaktan büyük değil (202 × 360); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | telefon | other-8s.mp4 (640 × 360 yatay, 8 sn) | 385 KB, 202 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (384.942 bayt); tuttu: dikey (9:16) ve kaynaktan büyük değil (202 × 360); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Küçült | masaüstü | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.032 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.032.070 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,03 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,03 MB) |
| Küçült | telefon | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.032 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.031.529 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,03 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,03 MB) |
| Yazıya dök | masaüstü | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Yazıya dök | telefon | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Müzik ekle | masaüstü | other-8s.mp4 + tone-30s.m4a | 184 KB, 640 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (183.809 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Müzik ekle | telefon | other-8s.mp4 + tone-30s.m4a | 184 KB, 640 × 360 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (183.809 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Sesini al | masaüstü | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesini al | telefon | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesi kapat | masaüstü | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Sesi kapat | telefon | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Her yerde açılsın | masaüstü | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 503 KB, 640 × 360 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (502.990 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| Her yerde açılsın | telefon | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 503 KB, 640 × 360 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (502.990 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| İyileştir | masaüstü | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.828 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.828.363 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |
| İyileştir | telefon | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.819 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.819.143 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |

**Yazıya dök, baştan sona — TEST KANCALI derleme, betikli tanıyıcı**
Bu satırlar `CLIP_TEST_HOOKS=1` derlemesinde, küçük bir model listesi ve konuşmayı DUYMAYAN betikli bir tanıyıcıyla alındı. Ölçülen şey akıştır (tıklama, ekran, kelime, dosyanın çıkması). **Yazının doğruluğu hakkında hiçbir şey söylemez** (bkz. bölüm 6).


| Görünüm | Dosya çıktı | Tıklama | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Karttan dosyaya | Teknik terim | Adıyla bulunamayan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | evet | 5 | 1 | 4 | 105 | 5,1 sn (model 360 KB’lık test dosyası) | 0 | 0 |
| telefon | evet | 6 | 1 | 4 | 105 | 5,1 sn (model 360 KB’lık test dosyası) | 0 | 0 |

**Yazıya dök → İnternette, baştan sona — SAHTE SUNUCUYA KARŞI (bulut derlemesi; yayındaki sitede bu yol yok)**
Bu satırlar, vekil sunucumuzun **yerel bir sahtesine** (`cloud/fake-worker/`, 127.0.0.1) karşı, bulut yolunun açık olduğu test kancalı derlemede alındı. Hiçbir dış hizmete istek atılmadı. Sahte sunucu konuşmayı DUYMAZ; betikte yazan kelimeleri döndürür. Ölçülen şey rıza ekranının ve akışın kendisidir (tıklama, ekran, okunacak kelime, sade dil, dosyanın çıkması, giden şeyin yalnız ses olması). **Yazının doğruluğu, hızı ya da gerçek sunucunun davranışı hakkında hiçbir şey söylemez.**


| Görünüm | Dosya çıktı | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Teknik terim | Adıyla bulunamayan | Giden dosya | Sunucuda kalan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | evet | 5 | 1 | 1 | 5 | 110 | 0 | 0 | 1 × audio/webm, 85 KB | 0 |
| telefon | evet | 6 | 1 | 1 | 5 | 110 | 0 | 0 | 1 × audio/webm, 85 KB | 0 |

Ekran ekran okunacak kelime:

- masaüstü: “Ne yapmak istiyorsun?” (ana ekran) — 105 kelime
- masaüstü: “Videonu seç” (video seç) — 24 kelime
- masaüstü: “Yazıyı nerede çıkaralım?” (nerede (kodsuz)) — 110 kelime
- masaüstü: “Videonu yazıya dökelim” (yazı) — 107 kelime
- masaüstü: “Kaydedildi” (sonuç) — 54 kelime
- telefon: “Ne yapmak istiyorsun?” (ana ekran) — 105 kelime
- telefon: “Videonu seç” (video seç) — 20 kelime
- telefon: “Yazıyı nerede çıkaralım?” (nerede (kodsuz)) — 110 kelime
- telefon: “Videonu yazıya dökelim” (yazı) — 107 kelime
- telefon: “Videon hazır” (sonuç) — 71 kelime

**“Kim konuştu” kalıcı mı — SAHTE SUNUCUYA KARŞI (bulut derlemesi; yayındaki sitede bu yol yok)**
Betikteki yazıda iki kişi dört sırayla konuşur; yazının gösterildiği her yerde dört etiket beklenir (“1. kişi”, “2. kişi”, “1. kişi”, “2. kişi”). Sayılan: doğru yerde duran doğru etiket. Sihirbazın işi tarayıcıya kaydedilmez (ADR-034); yazı kalıcı projeye **yedek dosyasıyla** geçer — “yedekten açılan editör” ve “sayfa yenilenince” sütunları o yolu ölçer. Altyazı dosyalarında: VTT konuşanı ses etiketiyle taşır, SRT taşımaz (ADR-043). Sahte sunucu kimin konuştuğunu DUYMAZ; betikte yazanı döndürür — gerçek sunucunun kişileri ne kadar doğru ayırdığı hakkında hiçbir şey söylemez.

| Görünüm | Beklenen | Sonuç ekranı | Editör | Yedek dosyası (satır) | Yedekten açılan editör | Yenilemeden sonra depoda (satır) | Sayfa yenilenince | VTT ses etiketi | SRT’de “kişi” |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 0 |
| telefon | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 0 |

## 2. Arama kalitesi

Arama iki biçimde iş gösterir (ADR-034, 11 Ekim 2026 eki): **emin olduğunda** tek bir işi cevap diye sunar (satırı seçilidir, Enter onu başlatır); **emin olmadığında** “Bunu mu demek istedin?” diye 1–3 seçenek sorar, hiçbiri seçili değildir, kullanıcı seçmeden hiçbir şey başlamaz. “Yanlış ama emin” artık yalnızca birincisidir: tek cevap ve yanlış iş. Her zaman sormak bu sayıyı sıfırlardı; bu yüzden yanında ne sıklıkla sorduğu, sorduğunda doğru işin seçeneklerde olup olmadığı ve açık yazılmış bir isteğe soru sorup sormadığı da bütçelidir.

Beş küme var ve hangisinin ne olduğu önemlidir:

- **Yeni ayrı küme** (`web/tests/quality/data/search-eval-fresh3.ts`, 280 ifade; sayılan 202): kendisine yalnızca işlerin listesi ve birer satırlık açıklamaları verilen, aramanın kodunu, kelime listelerini, eşiklerini ve öteki ifadeleri GÖRMEYEN bir yazar tarafından yazıldı; eminlik kuralı dondurulduktan sonra BİR KEZ ölçüldü. **Başlık sayıları ve bütçeler bu kümedendir.** Kaçanları aşağıda yazılı olduğu için bundan sonra bu küme de görülmüş sayılır: arama onun kaçanlarına bakılarak ayarlanırsa yeni bir küme yazılmalıdır.
- **İkinci yeni küme** (`search-eval-fresh2.ts`, 243 ifade; sayılan 209): 10–11 Ekim raporlarının başlığıydı (o ölçüm: ilk sonuç doğru %81,8, yanlış ama emin %12,0). Kaçanları raporda yazılıydı ve eminlik kuralı bu kümeye de bakılarak ayarlandı: **artık ayar kümesidir**, bugünkü sayıları (yanlış ama emin %1, sordu %27,8) bir tahmin değildir.
- **İlk yeni küme** (`search-eval-fresh.ts`, 178 ifade; sayılan 139): 10 Ekim’den beri ayar kümesi (bugün: yanlış ama emin %0, sordu %13,7).
- **Eski ayrı küme** (`search-eval.ts` içindeki `HELD_OUT`, 282 ifade; sayılan 225): **KİRLENMİŞ.** 10 Ekim’deki arama çalışması bu kümenin kaçanları okunduktan sonra yapıldı; eminlik kuralı da ona bakılarak ayarlandı. Sayıları bir tahmin değildir.
- **Geliştirme kümesi** (`DEV`, 175 ifade): üzerinde ayar yapıldı; ölçüm değildir. Açık yazılmış isteklerin soruya düşmediği burada da izlenir.

Ayar tablolarında (`tests/unit/taskSearch*.test.ts`) ya da daha eski bir kümede bulunan ifadeler yeni kümenin sayımından çıkarıldı (yeni kümede sayılmayan: 78; bunlar çoğunlukla kısa, açık ifadelerdir — sayılan küme bu yüzden yazılandan zordur).

**Yeni ayrı küme — başlık**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| Yanlış ama emin: TEK bir iş cevap diye sunuldu ve başka iş yapıyor (bütün ifadelerde) — 202 ifadede | %3 | ≤ %5 | bütçe içinde |
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 51 kez; 16 tanesinde tek seçenek; 7 tanesi yapılabilen bir iş değildi | %25,2 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 148 ifadede | %29,7 | ≤ %33 | bütçe içinde |
| Sorduğunda doğru iş seçeneklerin arasında — 44 soruda; 5 tanesinde yok | %88,6 | ≥ %80 | bütçe içinde |
| Açık yazılmış isteğe (“kolay”) doğrudan cevap yerine soru — 18 ifadede | %5,6 | ≤ %15 | bütçe içinde |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %54,1 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %80,4 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 148 ifadede | %75,7 | ≥ %85 | BÜTÇE DIŞI |
| İlk üç satırda var | %80,4 | ≥ %90 | BÜTÇE DIŞI |
| Yapılabilen işe “Bunu bulamadım.” | %12,2 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %2 | ≤ %0 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 25 ifadede | %88 | ≥ %95 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 34 kez söylendi | %88,2 | ≥ %95 | BÜTÇE DIŞI |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 20 ifadede; 3 tanesine tek kart cevap diye sunuldu, 4 tanesinde seçenek soruldu | %65 | ≥ %80 | BÜTÇE DIŞI |
| Anlamsız yazı / sohbete kart önerilmedi — 9 ifadede | %88,9 | ≥ %90 | BÜTÇE DIŞI |

**İşe göre** (yeni küme)

| İş | İfade | Doğrudan doğru | Soruldu (doğrusu içinde) | İlk üçte | Yanlış ama emin | Bulunamadı |
| --- | --- | --- | --- | --- | --- | --- |
| Kes | 18 | 11 (%61,1) | 4 (4) | 15 | 0 | 3 |
| Boşlukları at | 16 | 8 (%50) | 6 (6) | 14 | 1 | 1 |
| Dikey yap | 15 | 7 (%46,7) | 4 (4) | 11 | 0 | 4 |
| Küçült | 16 | 13 (%81,3) | 2 (2) | 15 | 0 | 1 |
| Yazıya dök | 13 | 2 (%15,4) | 6 (4) | 6 | 1 | 4 |
| Müzik ekle | 15 | 6 (%40) | 7 (7) | 13 | 1 | 1 |
| Sesini al | 16 | 11 (%68,8) | 4 (4) | 15 | 0 | 0 |
| Sesi kapat | 13 | 7 (%53,8) | 3 (1) | 8 | 0 | 2 |
| Her yerde açılsın | 13 | 8 (%61,5) | 5 (5) | 13 | 0 | 0 |
| İyileştir | 13 | 7 (%53,8) | 3 (2) | 9 | 0 | 2 |

**Yazış biçimine göre** (yeni küme; bir ifade birden çok satırda sayılır)

| Biçim | İfade | Doğrudan doğru | Soruldu (doğrusu içinde) | Yanlış ama emin |
| --- | --- | --- | --- | --- |
| Türkçe | 113 | 62 (%54,9) | 31 (29) | 3 |
| kısa ve açık (“kolay”) | 18 | 17 (%94,4) | 1 (1) | 0 |
| İngilizce | 35 | 18 (%51,4) | 13 (10) | 0 |
| yazım hatalı | 16 | 7 (%43,8) | 7 (7) | 0 |
| Türkçe harfsiz | 20 | 16 (%80) | 4 (4) | 0 |
| argo / kısaltma | 22 | 9 (%40,9) | 7 (7) | 0 |
| uzun cümle | 40 | 14 (%35) | 15 (12) | 1 |

**Kaçanlar, yeni küme** (79) — ifade → beklenen → çıkan. “Soruldu, doğrusu seçeneklerde” de burada sayılır (doğrudan cevap değildir), ama kullanıcı doğru işe bir dokunuşla varır.

| İfade | Beklenen | Çıkan | Tür |
| --- | --- | --- | --- |
| “vidyoyu kesmek istiyorm” | Kes | Bunu mu demek istedin? Kes | soruldu, doğrusu seçeneklerde |
| “vidyonun sonu çok saçma olmuş orayı atsak ya” | Kes | Bunu bulamadım. | bulunamadı |
| “düğün videosu iki saat sürüyor ben sadece takı töreninin olduğu yeri arkadaşıma göstermek istiyorum” | Kes | Bunu bulamadım. | bulunamadı |
| “i only want the part from 1:20 to 2:05” | Kes | Bunu bulamadım. | bulunamadı |
| “my recording has like two minutes of me setting up the camera at the start and i want that gone” | Kes | Bunu mu demek istedin? Kes (+ yapılamayan satır) | soruldu, doğrusu seçeneklerde |
| “klibin fazlalıklarını ayıkla” | Kes | Bunu mu demek istedin? Kes | soruldu, doğrusu seçeneklerde |
| “sessizlikleri sil” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
| “sesiz kısımları otomatk kes” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
| “bosluklari otomatik sil” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
| “arada susuyom ya onları uçur” | Boşlukları at | Bunu bulamadım. | bulunamadı |
| “videoda konuşurken sürekli düşünüp duruyorum aralarda uzun uzun bekliyorum bunlar tek tek uğraşmadan kendiliğinden gitsin istiyorum” | Boşlukları at | Kes | **yanlış ama emin** |
| “sunum kaydı aldım ama cümleler arasında çok bekleme var izleyen sıkılıyor daha akıcı olsun” | Boşlukları at | Bunu mu demek istedin? Boşlukları at | soruldu, doğrusu seçeneklerde |
| “podcast çekiyoruz misafir cevap vermeden önce hep beş saniye susuyor o ölü anları ayıklayabilir misin” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Sesini al / Kes | soruldu, doğrusu seçeneklerde |
| “auto cut the pauses where nobody talks” | Boşlukları at | Bunu mu demek istedin? Boşlukları at / Kes | soruldu, doğrusu seçeneklerde |
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
| “i recorded a long meeting and need everything that was said written down so i can paste it into a doc” | Yazıya dök | Bunu bulamadım. | bulunamadı |
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
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 58 kez; 22 tanesinde tek seçenek; 8 tanesi yapılabilen bir iş değildi | %27,8 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 148 ifadede | %33,8 | — | bütçesiz |
| Sorduğunda doğru iş seçeneklerin arasında — 50 soruda; 9 tanesinde yok | %82 | — | bütçesiz |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %58,1 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %85,8 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 148 ifadede | %81,8 | — | bütçesiz |
| İlk üç satırda var | %86,5 | — | bütçesiz |
| Yapılabilen işe “Bunu bulamadım.” | %4,7 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %2 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 31 ifadede | %83,9 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 34 kez söylendi | %91,2 | — | bütçesiz |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 20 ifadede; 0 tanesine tek kart cevap diye sunuldu, 4 tanesinde seçenek soruldu | %80 | — | bütçesiz |
| Anlamsız yazı / sohbete kart önerilmedi — 10 ifadede | %90 | — | bütçesiz |

**Eski ayrı küme — KİRLENMİŞ, başlık değil**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| Yanlış ama emin: TEK bir iş cevap diye sunuldu ve başka iş yapıyor (bütün ifadelerde) — 225 ifadede | %0,9 | — | bütçesiz |
| Tahmin etmek yerine sordu: “Bunu mu demek istedin?” (bütün ifadelerde) — 26 kez; 12 tanesinde tek seçenek; 0 tanesi yapılabilen bir iş değildi | %11,6 | — | bütçesiz |
| Yapılabilen işlerde sorma oranı — 172 ifadede | %15,1 | — | bütçesiz |
| Sorduğunda doğru iş seçeneklerin arasında — 26 soruda; 2 tanesinde yok | %92,3 | — | bütçesiz |
| Doğrudan doğru: tek cevap ve doğru iş (yapılabilen işler) | %80,2 | — | bütçesiz |
| Doğru işe yeniden yazmadan varıldı: doğrudan ya da seçeneklerden | %94,2 | — | bütçesiz |
| İlk satır doğru iş — cevap ya da ilk seçenek olarak (önceki raporların “ilk sonuç doğru”su) — 172 ifadede | %92,4 | — | bütçesiz |
| İlk üç satırda var | %94,2 | — | bütçesiz |
| Yapılabilen işe “Bunu bulamadım.” | %3,5 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %0,6 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 29 ifadede | %100 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 39 kez söylendi | %97,4 | — | bütçesiz |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 12 ifadede; 1 tanesine tek kart cevap diye sunuldu, 0 tanesinde seçenek soruldu | %91,7 | — | bütçesiz |
| Anlamsız yazı / sohbete kart önerilmedi — 12 ifadede | %100 | — | bütçesiz |

Geliştirme kümesi (`DEV`, ayar yapılırken kullanılabilir; başlık sayısı değildir): 85 ifade, doğrudan doğru %85,9, yanlış ama emin %0, yapılabilen işe soru %12,5 (bütçe ≤ %15; bütçe içinde), kaçan 15 (“sessizligi sil” → Bunu mu demek istedin? Boşlukları at / Kes; “arkadaki konuşmalar duyulmasın” → Bunu henüz yapamıyoruz. [Sesteki gürültüyü temizle]; “videoyu sessize almak istiyorum çünkü arkada çok konuşan var” → Bunu mu demek istedin? Sesi kapat / Boşlukları at; “aradaki boşlukları silmek istiyorum” → Bunu mu demek istedin? Boşlukları at / Kes; “videoda çok duraksıyorum onları at” → Bunu mu demek istedin? Boşlukları at / Kes; “sonunu atmak istiyorum” → Bunu mu demek istedin? Kes; “dosyayı küçültmem lazım” → Bunu mu demek istedin? Küçült; “videoda söylediklerimin metnini istiyorum” → Bunu mu demek istedin? Yazıya dök; “gece çektiğim videoda hiçbir şey görünmüyor biraz açmak istiyorum” → Bunu mu demek istedin? Her yerde açılsın; “kesinlikle çok güzel olmuş” → Bunu mu demek istedin? İyileştir; “bugün hava çok güzel” → Bunu mu demek istedin? İyileştir; “videoyu instagramda paylaş” → Bunu mu demek istedin? Dikey yap (+ yapılamayan satır); “şarkının adını bul” → Bunu mu demek istedin? Müzik ekle / İyileştir (+ yapılamayan satır); “dvd ye yaz” → Bunu mu demek istedin? Yazıya dök; “oyun oyna” → Bunu mu demek istedin? Her yerde açılsın).

## 3. Hata yolları

Her sihirbaza sekiz tür sorunlu dosya verildi; ekranda görülen metin kelimesi kelimesine kaydedildi. Derleme: yayınlanan statik çıktı, masaüstü görünümü (mesajları aynı bileşenler üretir; telefonda ayrıca koşulmadı). Sınır üstü iki durumda dosyanın boyutu ve süresi yalnızca test sayfasının içinde büyük gösterildi; uygulamanın kendi denetimi değişmeden çalıştı.

**iyi** = ne olduğunu ve ne yapılacağını söylüyor, ilerleme / geri dönüş var, takılma ve sayfa hatası yok · **belirsiz** = mesaj var ama ne yapılacağını söylemiyor ya da teknik terim içeriyor; ya da sorunlu dosya uyarısız işlendi · **bozuk** = mesaj da ilerleme de yok, bitmeyen bekleme, donan sayfa, sayfa hatası · **ölçülemedi** = bu makinede denenemedi (nedeni tabloda) · **—** = bu iş için hata değil.


|  | Hücre | Bütçe | Durum |
| --- | --- | --- | --- |
| İyi | 74 | — | bütçesiz |
| Belirsiz | 0 | ≤ 0 | bütçe içinde |
| Bozuk | 0 | ≤ 0 | bütçe içinde |
| Ölçülemeyen | 0 | ≤ 1 | bütçe içinde |
| Sayfanın yanıt vermediği en uzun süre | 0 sn | ≤ 3 sn | bütçe içinde |
| Sayfa hatası görülen hücre | 0 | ≤ 0 | bütçe içinde |
| Konsol hatası görülen hücre | 10 | — | bütçesiz |

**Tablo** (satır: dosya, sütun: sihirbaz)

| Dosya | Kes | Boşlukları at | Dikey yap | Küçült | Yazıya dök | Müzik ekle | Sesini al | Sesi kapat | Her yerde açılsın | İyileştir |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Video olmayan dosya (.txt) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Sıfır baytlık .mp4 | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| İçi rastgele bayt olan .mp4 | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Yarıda kesilmiş MP4 (baytların %55’i) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Yalnızca ses dosyası (.m4a) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Sesi olmayan video | — | iyi | — | — | iyi | — | iyi | iyi | — | — |
| Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |

**Ekranda görülen metinler**

| Dosya | Sihirbaz | Yargı | Ekrandaki metin | Neden | Cevap süresi |
| --- | --- | --- | --- | --- | --- |
| Video olmayan dosya (.txt) | hepsi | iyi | ““notlar.txt” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| Sıfır baytlık .mp4 | hepsi | iyi | ““bos.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| İçi rastgele bayt olan .mp4 | hepsi | iyi | ““bozuk.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | Boşlukları at, Her yerde açılsın, Dikey yap, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““yarim-inmis.mp4” açılamadı: bu video yarım kalmış görünüyor: 24,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 12,3 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | İyileştir | iyi | ““yarim-inmis.mp4” açılamadı: bu video yarım kalmış görünüyor: 3,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 1,5 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.” | ne olduğunu ve ne yapılacağını söylüyor | 0,5 sn |
| Yalnızca ses dosyası (.m4a) | hepsi | iyi | ““tone-30s.m4a” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| Sesi olmayan video | Her yerde açılsın, Dikey yap, İyileştir, Kes | geçerli değil | (metin yok) | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,4 sn |
| Sesi olmayan video | Küçült | geçerli değil | “Bu video zaten 73 KB; buraya sığıyor. Küçültmene gerek yok.” | bu iş videonun sesine ihtiyaç duymaz; video açıldı, adım indirme sunmadı ve nedenini söyledi (“Bu video zaten 73 KB; buraya sığıyor. Küçültmene gerek yok.”) | 0,2 sn |
| Sesi olmayan video | Müzik ekle | geçerli değil | “Önce müziğini seç.” | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,2 sn |
| Sesi olmayan video | Boşlukları at | iyi | “Bu videoda ses yok; sessizlik aranamaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesini al | iyi | “Bu videoda ses yok; kaydedilecek bir ses dosyası çıkmaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesi kapat | iyi | “Bu videoda zaten ses yok; kapatılacak bir şey yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Yazıya dök | iyi | “Bu videoda ses yok; yazıya dökülecek bir konuşma yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB) | hepsi | iyi | ““kalite-cok-buyuk.mp4” açılamadı: dosya 5,37 GB; bu sürümün sınırı 4,29 GB. Daha küçük bir video seç; ya da bu videoyu önce başka bir uygulamayla parçalara böl.” | ne olduğunu ve ne yapılacağını söylüyor | 0 sn |
| Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika) | hepsi | iyi | ““kalite-cok-uzun.mp4” açılamadı: video bu sürümdeki 120 dakika sınırının üzerinde. Daha kısa bir video seç; ya da bu videoyu önce başka bir uygulamayla parçalara böl.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |

**Konsola düşen hatalar** (aynı satır bir kez)

- 10 hücrede: `Failed to load resource: net::ERR_REQUEST_RANGE_NOT_SATISFIABLE`

## 4. Dürüstlük denetimleri

**İlerleme çubuğu ve “Kaydedildi”** — “İndir”e basıştan sonuca kadar 40 ms’de bir örneklendi (masaüstü, statik çıktı).


| Senaryo | Sonuç | Örnek / farklı değer | İlk → son | Geri gitti | Geçiş arasında geri gitti | %100’de bekleme | “Kaydedildi” anında dosya | Dosyasız başarı |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dikey yap: 12 sn’lik 1920 × 1080 video yeniden işlenir | saved | 64 / 10 | %0 → %96 | 0 kez | 0 kez | 0 ms | 8.151 KB, 12,01 sn, video:h264 + audio:aac | hayır |
| İyileştir: ışığı değişen 10 sn’lik video | saved | 169 / 21 | %0 → %98 | 0 kez | 0 kez | 0 ms | 9.444 KB, 10,01 sn, video:h264 + audio:aac | hayır |
| Küçült → WhatsApp: yaklaşık 24 MB’lık video 16 MB’ın altına iner | saved | 116 / 16 | %0 → %94 | 0 kez | 0 kez | 0 ms | 15.480 KB, 12,01 sn, video:h264 + audio:aac | hayır |

Kaydetme penceresi olmayan yol (telefon, Firefox, Safari): “hazır” dendiğinde bağlantının arkasındaki dosya 503 KB; dosyasız başarı: hayır (bütçe içinde).

**İptal** — 24 sn’lik video dikey yapılırken, ilerleme %3’ü geçince “İptal et”e basıldı.


| Yol | Durdu | Durma süresi | Ekrandaki metin | İş sürerken sayfa deposunda | İptalden 4 sn sonra kalan | Kalan bayt | İptalden sonra “kaydedildi” |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kaydetme penceresiz (telefon, Firefox, Safari) | evet | 73 ms | “İndirme durduruldu; yarım dosya bırakılmadı.” | clip-export-exp_mv6cwxq8_2.mp4 (38.927 KB) | hiçbir şey | 0 | hayır |
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
| Her yerde açılsın, kamera benzeri 720p VP9 WebM | yeniden işlendi | 1280 × 720, 5,7 MB | 1280 × 720 | 0,9766 | 42,6 dB | 84,7 | 8 ms | — | 10 denetimin hepsi tuttu |
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 608 × 1080, 8,2 MB | 608 × 1080 | 0,9713 | 43,83 dB | 89,8 | 11 ms | — | 10 denetimin hepsi tuttu |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma (kesim yerleri yeniden işlendi, arası kopya) | 1920 × 1080, 6,7 MB | 1920 × 1080 | 0,9978 | 55,19 dB | 99,2 | 8 ms | — | 10 denetimin hepsi tuttu |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 1920 × 1080, 15,5 MB | 1920 × 1080 | 0,9658 | 42,84 dB | 87,3 | 11 ms | 15,5 MB / 16 MB: sığdı: evet; hedefin kullanılan payı %96,8 (kaynak 24,3 MB) | 10 denetimin hepsi tuttu |

**Dizin başta mı (faststart)?** Dizini dosyanın sonunda olan: 10 / 10 dosya (BÜTÇE DIŞI, bütçe ≤ 0). Dizin sondaysa dosya indirilirken ya da bir sayfaya gömülüyken tamamı gelmeden oynatılamaz; yerel oynatmayı etkilemez. Yukarıdaki “her yerde açılır” sütunu bu denetimi saymaz.

**Büyütme yok (ADR-041)** — video dosyası üreten her yol, 640 × 360, 854 × 480 ve 1280 × 720 kaynakla: kaydedilen dosyanın piksel sayısı kaynağınkini geçmemeli. Hücre: çıkan boyut ve çıkan / kaynak piksel oranı (1’in üstü büyütmedir). Kaynak: üretilmiş, loş ve kumlu deneme deseni, 6 sn. “Yazıya dök” ve “Sesini al” görüntü kaydetmez.


| Yol | 360p kaynak | 480p kaynak | 720p kaynak |
| --- | --- | --- | --- |
| Boşlukları at | 640 × 360 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 854 × 480 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 1280 × 720 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) |
| Her yerde açılsın (WebM kaynak) | 640 × 360 (× 1), yeniden işlendi | 854 × 480 (× 1), yeniden işlendi | 1280 × 720 (× 1), yeniden işlendi |
| Dikey yap (Doldur) | 202 × 360 (× 0,32), yeniden işlendi | 270 × 480 (× 0,32), yeniden işlendi | 406 × 720 (× 0,32), yeniden işlendi |
| Editör (doğrudan açıldı, Ayarlar’a dokunulmadı) | 640 × 360 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 854 × 480 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 1280 × 720 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) |
| İyileştir (karanlık, kamera benzeri kaynak) | 640 × 360 (× 1), yeniden işlendi | 854 × 480 (× 1), yeniden işlendi | 1280 × 720 (× 1), yeniden işlendi |
| Kes | 640 × 360 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 854 × 480 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) | 1280 × 720 (× 1), karma (kesim yerleri yeniden işlendi, arası kopya) |
| Küçült (Daha da küçült) | 640 × 360 (× 1), yeniden işlendi | 854 × 480 (× 1), yeniden işlendi | 1280 × 720 (× 1), yeniden işlendi |
| Müzik ekle | 640 × 360 (× 1), kopya (yeniden işlenmedi) | 854 × 480 (× 1), kopya (yeniden işlenmedi) | 1280 × 720 (× 1), kopya (yeniden işlenmedi) |
| Sesi kapat | 640 × 360 (× 1), kopya (yeniden işlenmedi) | 854 × 480 (× 1), kopya (yeniden işlenmedi) | 1280 × 720 (× 1), kopya (yeniden işlenmedi) |

**İyileştir** — ADR-037’nin ölçüleri (`web/tests/e2e/enhance-media.ts`: ortalama parlaklık, Laplace varyansı), üretilmiş dört video üzerinde.


| Video | Uygulamanın dediği | İndirme sunuldu | Parlaklık önce → sonra | Keskinlik önce → sonra | Eklenen en büyük parlaklık sıçraması | Kare |
| --- | --- | --- | --- | --- | --- | --- |
| karanlık | “Yapılacaklar: video belirgin biçimde aydınlatılır, renkler toparlanır.” | evet | 69,2 → 120 (+50,8) | 50,7 → 109,1 | 0,15 | 90 / 90 |
| bulanık | “Yapılacaklar: renkler toparlanır, kenarlar keskinleştirilir.” | evet | 140,3 → 141,6 | 24,7 → 28 (× 1,13) | 0,05 | 90 / 90 |
| kumlu | “Yapılacaklar: ışık ve kontrast biraz düzeltilir, renkler toparlanır, kumlanma azaltılır.” | evet | 104,8 → 119,1 | 373,9 → 115,9 | 0,1 | 90 / 90 |
| iyi (doğru pozlanmış, keskin) | “Yapılacaklar: renkler toparlanır.” | evet | 140,3 → 141,7 (1,4 kaydı) | 198 → 176,7 (× 0,89) | 0,09 | 90 / 90 |

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
| Ana ekran `/` | bu makine | 178 KB (8 dosya) | 187 KB | 88 ms | 88 ms (72–112) | 0 ms | 104 ms | 2,5 MB | 0 |
| Ana ekran `/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 178 KB (8 dosya) | 187 KB | 580 ms | 580 ms (572–592) | 107 ms (100–108) | 1.439 ms | 2,5 MB | 0 |
| Editör `/editor/` | bu makine | 289 KB (16 dosya) | 371 KB | 92 ms | 92 ms (84–100) | 0 ms | 126 ms | 3,4 MB | 0 |
| Editör `/editor/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 289 KB (16 dosya) | 371 KB | 808 ms | 808 ms (792–808) | 157 ms (157–160) | 1.901 ms | 3,4 MB | 0 |
| Sihirbaz `/yap/dikey/` | bu makine | 237 KB (14 dosya) | 254 KB | 52 ms | 52 ms (52–64) | 0 ms | 87 ms | 2,8 MB | 0 |
| Sihirbaz `/yap/dikey/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 237 KB (14 dosya) | 254 KB | 632 ms | 632 ms (624–652) | 103 ms (96–117) | 1.786 ms | 2,8 MB | 0 |

**Bellek:** 12 sn’lik 1920 × 1080 video dikey yapılırken ana iş parçacığının JS yığını — boşta 2,7 MB, video açıkken 5,5 MB, tepe 6,4 MB (bütçe içinde, bütçe ≤ 150 MB), bittikten sonra 5,5 MB; 32 örnek. Dışa aktarmanın işçileri (worker) ve kodlayıcı bu sayının DIŞINDADIR; bütün süreç ağacının belleği `web/scripts/measure-export-memory.mjs` ile ölçülür (ADR-029), burada yeniden koşulmadı.

**Dışa aktarma hızı** — “İndir”e basıştan dosyanın hazır olmasına; × gerçek zaman = çıktı süresi / geçen süre. Ölçüm kilidi altında, bu makinede.


| Durum | Yol | Çıktı | Geçen süre | × gerçek zaman |
| --- | --- | --- | --- | --- |
| Her yerde açılsın, senkron klibi (H.264 MP4) | kopya | 12 sn, 1080 × 1920 | 0,88 sn | 13,7 × |
| Her yerde açılsın, senkron klibi (VP9 WebM) | yeniden işlendi | 12 sn, 1080 × 1920 | 3,43 sn | 3,5 × |
| Dikey yap, senkron klibi (zaten 9:16) | kopya | 12 sn, 1080 × 1920 | 0,85 sn | 14,2 × |
| Kes 2–8 sn, senkron klibi (H.264 MP4) | kopya | 6 sn, 1080 × 1920 | 0,37 sn | 16,4 × |
| Kes 2–8 sn, senkron klibi (VP9 WebM) | yeniden işlendi | 6 sn, 1080 × 1920 | 1,92 sn | 3,1 × |
| Küçült (seçim değişmeden: WhatsApp), ağır senkron klibi (H.264, yaklaşık 33 MB) | yeniden işlendi | 12 sn, 1080 × 1920 | 4,44 sn | 2,7 × |
| Her yerde açılsın, kamera benzeri 720p VP9 WebM | yeniden işlendi | 6 sn, 1280 × 720 | 1,88 sn | 3,2 × |
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 12 sn, 608 × 1080 | 3,45 sn | 3,5 × |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma | 3 sn, 1920 × 1080 | 1,39 sn | 2,2 × |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 12 sn, 1920 × 1080 | 5,49 sn | 2,2 × |
| İyileştir, karanlık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 3,5 sn | 0,9 × |
| İyileştir, bulanık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 4,47 sn | 0,7 × |
| İyileştir, kumlu video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 9,29 sn | 0,3 × |
| İyileştir, iyi video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 2,91 sn | 1 × |

İyileştir satırları grafik hızlandırma olmadan alındı: Playwright’ın Chromium’u bu makinede WebGL’i yazılımla çiziyor (uygulama da bunu söylüyor). Grafik kartı kullanan gerçek bir tarayıcıdaki hız BURADA ÖLÇÜLMEDİ; bu sayı en kötü durumdur.

## 8. Görsel regresyon

Taban resimler: `web/tests/quality/baselines/` (78 PNG; Windows’ta Chromium’un sistem yazı tipleriyle çizdiği hâl). Karşılaştırma toleranslıdır: bir pikselin bir renk kanalı 40 / 255’ten fazla ayrışırsa “farklı” sayılır; piksellerin %1’inden fazlası farklıysa ekran “farklı” sayılır. Video, canvas ve saate ya da kodlayıcıya bağlı metinler maskelenir. **CI’da koşulmaz** (aşağıda neden).


|  | Ekran | Bütçe | Durum |
| --- | --- | --- | --- |
| Karşılaştırılan ekran | 78 | — | bütçesiz |
| Farklı | 0 | ≤ 0 | bütçe içinde |
| Karşılaştırılamadı | 0 | ≤ 0 | bütçe içinde |
| Bu koşuda taban yazıldı / yenilendi (karşılaştırma değil) | 0 | — | bütçesiz |

**Ekranlar**


| Ekran | Masaüstü | Telefon |
| --- | --- | --- |
| `ana-ekran` | aynı | aynı |
| `ana-ekran-arama` | aynı | aynı |
| `ana-ekran-bulunamadi` | aynı | aynı |
| `ana-ekran-soru` | aynı | aynı |
| `ana-ekran-yapamiyoruz` | aynı | aynı |
| `editor-bos` | aynı | aynı |
| `sihirbaz-bosluk-secim` | aynı | aynı |
| `sihirbaz-dikey-secim` | aynı | aynı |
| `sihirbaz-iyilestir-secim` | aynı | aynı |
| `sihirbaz-kucult-secim` | aynı | aynı |
| `sihirbaz-muzik-secim` | aynı | aynı |
| `sihirbaz-sonuc` | aynı | aynı |
| `sihirbaz-yazi-model` | aynı | aynı |
| `yol-bosluk-ilk` | aynı | aynı |
| `yol-bosluk-sonuc` | aynı | aynı |
| `yol-cevir-ilk` | aynı | aynı |
| `yol-cevir-sonuc` | aynı | aynı |
| `yol-dikey-ilk` | aynı | aynı |
| `yol-dikey-sonuc` | aynı | aynı |
| `yol-iyilestir-ilk` | aynı | aynı |
| `yol-iyilestir-sonuc` | aynı | aynı |
| `yol-kes-ilk` | aynı | aynı |
| `yol-kes-sonuc` | aynı | aynı |
| `yol-kucult-ilk` | aynı | aynı |
| `yol-kucult-sonuc` | aynı | aynı |
| `yol-muzik-ilk` | aynı | aynı |
| `yol-muzik-sonuc` | aynı | aynı |
| `yol-ses-ilk` | aynı | aynı |
| `yol-ses-sonuc` | aynı | aynı |
| `yol-sustur-ilk` | aynı | aynı |
| `yol-sustur-sonuc` | aynı | aynı |
| `yol-yazi-bulut-ilk` | aynı | aynı |
| `yol-yazi-bulut-secim` | aynı (%0,19) | aynı (%0,5) |
| `yol-yazi-bulut-secim-kodsuz` | aynı (%0,18) | aynı (%0,45) |
| `yol-yazi-bulut-sonuc` | aynı | aynı |
| `yol-yazi-bulut-yazi` | aynı | aynı |
| `yol-yazi-ilk` | aynı | aynı |
| `yol-yazi-kancali-ilk` | aynı | aynı |
| `yol-yazi-kancali-sonuc` | aynı | aynı |

**CI kararı:** bu karşılaştırma CI’da kapı değildir ve `.github/workflows/ci.yml` dosyasına eklenmedi. CI da Windows’ta koşar, ama GitHub’ın Windows Server görüntüsündeki yazı tipi çizimi bu makinedekiyle (Windows 11) aynı tabanları verecek mi, ölçülmedi; tabanlar bu makinede üretildi. Kararlı olduğu CI’da gösterilmeden kapı yapılmamalı.

## 9. Erişilebilirlik ve çocuk-dostu ölçüler

Kontrast, rol ve ad kuralları axe ile zaten denetleniyor (`web/tests/e2e/a11y.spec.ts`, `enhance-a11y.spec.ts`, `transcript-a11y.spec.ts`; WCAG 2.2 AA etiketleri); burada tekrar edilmedi. Aşağıdakiler axe’ın ölçmediği şeylerdir.

**telefon (390 × 844, dokunmatik)**


| Ekran | Kontrol | 44 px’ten küçük hedef | 24 px’ten küçük | Adsız kontrol | En küçük yazı; 14 px altı kelime | 12 px altı kelime | Klavye (Tab) sırası | Odak halkası görünmeyen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ana ekran, arama sonucu (“sessiz yerleri sil”) | 6 | 0 | 0 | 0 | 14 px; %0 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu bulamadım.” | 5 | 0 | 0 | 0 | 14 px; %0 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, emin değilken seçenekler (“tiktok için kes”) | 7 | 0 | 0 | 0 | 14 px; %0 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”) | 6 | 0 | 0 | 0 | 14 px; %0 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran | 17 | 0 | 0 | 0 | 14 px; %0 | 0 | 17 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video yok | 7 | 0 | 0 | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video ve bir kesit | 19 | 0 | 0 | 0 | 12 px; %17 | 0 | 19 durak; ulaşılamayan 0; geri sıçrama 1 (çok sütunlu; yargılanmaz) | 0 |
| Boşlukları at, seçim | 8 | 0 | 0 | 0 | 14 px; %0 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Dikey yap, seçim | 8 | 0 | 0 | 0 | 14 px; %0 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, ilk ekran (Dikey yap) | 3 | 0 | 0 | 0 | 14 px; %0 | 0 | 3 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| İyileştir, seçim | 9 | 0 | 0 | 0 | 14 px; %0 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Küçült, seçim | 9 | 0 | 0 | 0 | 14 px; %0 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Müzik ekle, seçim (müzik seçilmiş) | 9 | 0 | 0 | 0 | 14 px; %0 | 0 | 14 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, sonuç ekranı (Her yerde açılsın) | 8 | 0 | 0 | 0 | 14 px; %0 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Yazıya dök, model adımı | 5 | 0 | 0 | 0 | 14 px; %0 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |

- **14 px’ten küçük yazılardan örnekler** (bütün ekranlardan): 12 px: 00:00 · 12 px: 00:02 · 12 px: 00:04 · 12 px: 00:06 · 12 px: 00:08 · 12 px: 1
- **Görünür yazısı olmayan düğmeler** (yalnız simge; erişilebilir adı var): Yazdığını sil; Diğer; Ayarlar; Oynatma çizgisi; Geri al; Tam ekran izle (F); Oynat; Mesajı kapat; Kesit 1'i oynat, 00:01–00:03; Kesit 1'i sil, 00:01–00:03

**masaüstü (1440 × 900)**


| Ekran | Kontrol | 44 px’ten küçük hedef | 24 px’ten küçük | Adsız kontrol | En küçük yazı; 14 px altı kelime | 12 px altı kelime | Klavye (Tab) sırası | Odak halkası görünmeyen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ana ekran, arama sonucu (“sessiz yerleri sil”) | 6 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %65 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu bulamadım.” | 5 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %53 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, emin değilken seçenekler (“tiktok için kes”) | 7 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %49 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”) | 6 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %67 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran | 17 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %31 | 0 | 17 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video yok | 8 | 3 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %47 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video ve bir kesit | 20 | 4 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %84 | 0 | 20 durak; ulaşılamayan 0; geri sıçrama 1 (çok sütunlu; yargılanmaz) | 0 |
| Boşlukları at, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %45 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Dikey yap, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %41 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, ilk ekran (Dikey yap) | 3 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %42 | 0 | 3 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| İyileştir, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %53 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Küçült, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %50 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Müzik ekle, seçim (müzik seçilmiş) | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %47 | 0 | 14 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, sonuç ekranı (Her yerde açılsın) | 7 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %29 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Yazıya dök, model adımı | 5 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %21 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |

**Okunabilirlik** — `web/src/i18n/messages.ts` içindeki Türkçe metinler; Ateşman puanı (90–100 çok kolay · 70–89 kolay · 50–69 orta · 30–49 zor · 30 altı çok zor).


| Metinler | Metin | Puanlanan (5+ kelime) | Ortanca puan | Zor + çok zor | Çok zor | 20 kelimeden uzun cümle | En uzun cümle | En uzun kelime |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Varsayılan yol (ana ekran, kartlar, sihirbazlar, yazıya dökme, indirme, hata) | 496 | 253 | 81,1 | %2 | 0 | 1 | 22 kelime | birleştirilebiliyor |
| Bütün metinler (editör dahil) | 1.136 | 537 | 78,8 | %3,5 | 2 | 5 | 22 kelime | birleştirilebiliyor |

Varsayılan yolun metinlerinden teknik terim içeren: 9 (bütçesiz). Bu, metin tablosunun taramasıdır: bir metnin ekrana hangi koşulda geldiğini bilmez (bir kısmı yalnızca hata olduğunda ya da “Ayrıntılar” açıldığında görünür). Gerçekten görülenler bölüm 1’dedir.

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

## Bu rapor neyi söylemez

- Bir çocuğun ya da ilk kez kullanan birinin nerede durakladığını, neyi yanlış anladığını, neyi beğenmediğini. Betik hiç duraksamaz ve her düğmenin adını önceden bilir.
- Gerçek telefonu: “telefon” burada masaüstü Chromium’un 390 × 844 dokunmatik öykünmesidir. Gerçek Android / iPhone’da hız, bellek, dosya seçici ve paylaşım ayrı ölçülür (`web/scripts/android/`).
- Gerçek çekimlerde görüntü kalitesini: sadakat ölçüleri üretilmiş, kamera benzeri bir videoda alındı.
- Yazıya dökmenin bugünkü doğruluğunu: bölüm 6 kayıtlı sayılardır.
- e2e testlerinin bu commit’te geçtiğini: atıf yapılan testler burada koşulmaz.
