**Yazıldığı koşu:** 11 Ekim 2026 öğleden sonra, dal `worktree-agent-a511c0275d7647e51` (önceki bulgular: aynı gün, `b8e355f`). O raporda açık kalan üç şey üzerinde çalışıldı: aramanın yanlış karta göndermesi, editörün her videoyu 1080p’ye büyütmesi, 720p’den küçük kaynakların büyütülmesi. Aşağıda her biri için aynı ölçünün önceki → şimdiki değeri var. Açık kalanlar en başta.

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
