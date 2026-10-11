**Yazıldığı koşu:** 11 Ekim 2026, commit `b8e355f` (önceki bulgular: 10 Ekim, `70c0b2f`). 10 Ekim’de yazılan on bulgunun dokuzu üzerinde çalışıldı; aşağıda her biri için ne değiştiği ve aynı ölçünün önceki → şimdiki değeri var. Sıra yine önem sırasıdır. Açık kalanlar en başta.

### Hâlâ açık

1. **Arama hâlâ sekiz istekten birinde başka iş yapan bir kart öneriyor (bütçe ≤ %5).** Kuralları hiç görmemiş bir yazarın yazdığı, bir kez ölçülen ikinci yeni kümede (243 ifade, 209’u sayılır): “yanlış ama emin” %19,6 → **%12,0**; ilk sonuç doğru %75,0 → %81,8; ilk üçte %81,1 → %85,8; yapılabilen işe “yapamıyoruz” %4,1 → %2,0; “Bunu henüz yapamıyoruz.” yakalama %71,0 → %83,9, isabet %82,9 → %91,2. Uzun cümlelerde ilk sonuç %67,5 → %67,5 (değişmedi). Altı arama bütçesi dışarıda.
   - **Eski küme artık kirlenmiş sayılır** (10 Ekim’in 240 ifadesi; bu çalışmada bir bölümü yanlışlıkla görüldü, aşağıda): ilk sonuç %89,0 → %92,4, yanlış ama emin %7,1 → %3,1. Bu sayılar başlık DEĞİLDİR.
   - İlk yeni küme (178 ifade) bir kez ölçüldü (ilk sonuç %77,2 → %81,5; yanlış ama emin %20,9 → %12,2), sonra kaçanlarına bakılıp genel kurallar çıkarıldı; artık ayar kümesidir.
   - İki ayrı görmeyen kümede aynı sonuç (%12) çıkması, kelime listesi + ek kuralı yaklaşımının buraya kadar getirdiğini gösteriyor. %5’e inmek için ya başka bir yaklaşım ya da bütçenin yeniden konuşulması gerekir (kurucu kararı). “İlk sonuç ≥ %85” ve “ilk üçte ≥ %90” bütçeleri eski, daha kolay kümede ayarlanmıştı.
   Kanıt: bölüm 2. Yer: `web/src/domain/taskSearch.ts`, `web/src/domain/tasks.ts`, `web/src/domain/turkishSuffix.ts`.

2. **Editörün açılışı yavaş telefonda hâlâ sınırın kıyısında.** Mobil kısıtlamada TBT 256 ms (240–280) → bu koşuda **206 ms (167–213)**, bir önceki koşuda 176 ms (157–209): bütçe 200 ms; ortanca koşudan koşuya sınırın iki yanına düşüyor. Sayfa ağırlığı indi (aşağıda, 11. madde) ama bu ölçü “düzeldi” sayılamaz. Kanıt: bölüm 7.

3. **Kaydedilen dosyaların hiçbirinde dizin başta değil (10 / 10).** Bu çalışmanın kapsamı dışındaydı; değişmedi. Kanıt: bölüm 5.

### Düzeltilenler (önce → şimdi)

4. **“Küçült” artık söz verdiğini yapıyor** (`7e31a69`). Önceden seçili olan “WhatsApp (16 MB altı)”; video zaten sığıyorsa “İndir” kapalı ve “Bu video zaten … ; buraya sığıyor. Küçültmene gerek yok.” deniyor; 16 MB’ın altındaki videoya “Daha da küçült (yaklaşık yarısı)” seçeneği çıkıyor. Seçim değiştirilmeden: 24,74 MB → 24,73 MB (“Kaydedildi”) idi; şimdi yaklaşık 25 MB → **14,0 MB**, 1280 × 720. Dosyası doğrulanan görev 8 / 9 → **9 / 9** (iki görünümde).

5. **Yarım kalmış video seçildiği anda reddediliyor** (`5bf0e7d`, ADR-040). Dosyanın söylediği süre ile gerçekten okunabilen süre karşılaştırılıyor; fark 1 saniyeden büyükse on sihirbaz ve editör aynı şeyi söylüyor (“… yarım kalmış görünüyor: 24,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 12,3 sn var. …”), dışa aktarma başlamadan önce de aynı denetim var. “Chrome veya Edge ile dene” yalnızca tarayıcı Chromium değilken gösteriliyor. Hata hücreleri: 9 belirsiz + 1 ölçülemedi → **0 belirsiz**; toplamda iyi / belirsiz / bozuk **74 / 0 / 0**.

6. **Sınır mesajları ne yapılacağını söylüyor** (`7ba9a84`). Çok büyük dosya ve çok uzun video mesajları sınırı politikadan okuyup bir çıkış yolu öneriyor. 20 belirsiz hücre → 0.

7. **Varsayılan yolda teknik terim yok** (`84ec4ea`). Sekiz cümle → **0**. Yöntemin teknik adı “Ayrıntılar”ın içinde duruyor; söylenen şey hâlâ ölçülen şey.

8. **“Kes” videonun kendi boyutunu koruyor** (`7e31a69`). Neden: sihirbaz videoyu editörün varsayılan 1080p tarifiyle açıyordu; bu hem büyütüyor hem hızlı kesimi engelliyordu. 1280 × 720’den kesilen 3 saniye: 1920 × 1080, 1,5 MB, yeniden kodlanmış → **1280 × 720, 83 KB, görüntüye dokunulmadan**. Ayrıca yeniden kodlanan dosyanın bit hızı kaynağınkinin iki katını geçmiyor (ADR-024 eki). İki katı çarpanı gerçek çekimde ÖLÇÜLMEDİ.

9. **Çözülmüş ses / görüntü örnekleri kapatılıyor** (`70e0947`). İki sızıntı: kodlayıcı öz-sınamasındaki ses örneği ve iptalde kare seçicinin elindeki bir sonraki kare. Konsoldaki “… garbage collected without first being closed” uyarısı görev yürüyüşlerinde artık çıkmıyor (Küçült’te iki görünümde çıkıyordu; şimdi “Konsol hatası” sütunu bütün görevlerde 0); çöp toplama zorlanarak denetleyen üç e2e testi eklendi.

10. **Telefonda yazı ve hedefler** (`a30b8ac`, `a873a90`). 14 px’in altındaki kelime payı: ana ekran %62 → **%0**, sihirbaz ekranları %21–54 → **%0**, boş editör %74 → %0; video ve bir kesit olan editörde %17 (şeridin 12 px’lik zaman etiketleri — açık). 44 px’ten küçük dokunma hedefi 16 → **0**. Görsel tabanlar iki görünümde ekranlara bakıldıktan sonra yenilendi (36 ekran).

11. **Sayfa ağırlığı** (`b594a58`, `c0a989a`). Sihirbaz editörü, İngilizce metinleri ve başka işlerin ekranını artık taşımıyor; medya kitaplığı video açılınca iniyor. Aktarılan JS: ana ekran 193 → **177 KB**, sihirbaz 422 → **234 KB**, editör 421 → **284 KB**. Mobil kısıtlamada TBT: sihirbaz 209 → 129 ms (122–134), ana ekran 118 ms; editör için 2. maddeye bakın (bütçe dışı). Bu üç sayfa ağırlığı bütçesi ve telefon yazı bütçesi yeni ölçülere göre sıkılaştırıldı; hiçbir bütçe gevşetilmedi.

### Bilinmesi gerekenler

- **Ölçüm temizliği (arama):** eski ayrı kümenin “Küçült” bölümü bir arama komutunun çıktısında, ikinci yeni kümenin bazı kaçanları da ölçümden SONRA rapor çıktısında görüldü. İkinci yeni kümenin ölçümünden sonra arama kurallarına dokunulmadı; yine de o küme bir daha “görülmemiş” sayılmamalı: bir sonraki arama çalışması yeni bir küme yazdırmalı.
- **Editör doğrudan açıldığında** varsayılan çıktı hâlâ 1080p’dir (yalnız sihirbazlar videonun boyutunu izler); 720p’den küçük kaynaklar hâlâ 720p’ye büyütülür. İkisi de politika sorusu, bu çalışmada değiştirilmedi.
- **Yarım dosyanın okunabilen kısmını yine de açma** seçeneği yok (ADR-040’ta açık soru).
- **İyileştir, grafik hızlandırma yokken gerçek zamandan yavaş**; yeniden işlenen görüntüde en düşük VMAF 84,6, SSIM 0,966 (üretilmiş kumlu video; gerçek çekimde ölçülmedi). Değişmedi.
- **“Yazıya dök”** bu koşuda model dosyaları olmadığı için ölçülmedi (4 yürüyüş ölçüsü + gerçek model WER’i “ölçülemedi”).
- **Ölçülmeyen:** gerçek telefon, Safari / Firefox, gerçek çekimler, tarayıcı matrisi — bu çalışmada koşulmadı.
- **İyi olanlar:** ilerleme çubuğu hiç geri gitmedi, iptalden sonra bayt kalmadı; eklenen ses–görüntü sapması en çok 1 ms, süre hatası en çok 16 ms; dokuz görevin dokuzu en çok 4 tıklamayla (telefonda 5) doğru dosyayı verdi; metinlerin ortanca Ateşman puanı 81,3.

### Açık kalan

- Ürün adı ya da ekran düzeni bilerek değiştiğinde görsel tabanların hepsi “farklı” çıkar; ekranlara bakıldıktan sonra `--update-baselines` ile yenilenmeli. `docs/quality/diffs/` yalnızca farklı ekran varken üretilir; rapor ona bağ veriyorsa raporla birlikte commit edilir.
