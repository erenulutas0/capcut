# Kalite raporu — 2026-10-11

> Üreten: `npm run quality` (`web/scripts/quality/run.mjs`). Ölçüm koşusu: 2026-10-11 10:04 UTC, commit `b8e355f`, 8 dk; ölçülen bölümler: search, text, walkthrough, errors, honesty, output, perf, visual, a11y. Raporun metni 2026-10-11 10:05 UTC tarihinde ölçüm yapılmadan yeniden yazıldı (`--report-only`).
> Makine: Windows_NT 10.0.26200, 12th Gen Intel(R) Core(TM) i5-12500 × 12, 64 GB bellek. Tarayıcı: Playwright’ın Chromium’u. Bütün medya üretilmiş (ffmpeg) ya da depodaki haklı örneklerdir; hiçbir şey makineden çıkmadı.
> Bu rapor bir kullanıcı testinin yerini TUTMAZ; neyi söylemediği en altta ve `docs/quality/README.md` içinde.

## Öne çıkan bulgular

_Bu bölüm elle yazılır (`docs/quality/bulgular.md`); sayılar aşağıdaki tablolardan gelir. Rapor yeniden üretildiğinde olduğu gibi yerine konur — tarihine bakın._

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

## Özet

543 ölçü: **489 bütçe içinde**, **8 bütçe dışı**, **5 ölçülemedi**, 41 bütçesiz (yalnızca bildirilir). Bütçeler: `web/scripts/quality/budgets.json`.


| Bölüm | Ölçüm zamanı | Derleme | Bütçe içinde | Bütçe dışı | Ölçülemedi | Bütçesiz |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Görev tamamlama yürüyüşleri | 2026-10-11 09:58 UTC | statik çıktı + test kancalı | 188 | 0 | **4** | 0 |
| 2. Arama kalitesi | 2026-10-11 09:57 UTC | tarayıcısız | 2 | **6** | 0 | 10 |
| 3. Hata yolları | 2026-10-11 09:59 UTC | statik çıktı | 5 | 0 | 0 | 2 |
| 4. Dürüstlük denetimleri | 2026-10-11 09:59 UTC | statik çıktı | 22 | 0 | 0 | 0 |
| 5. Çıktı kalitesi | 2026-10-11 10:02 UTC | statik çıktı | 44 | **1** | 0 | 0 |
| 6. Yazıya dökme kalitesi | koşulmadı | — | 0 | 0 | **1** | 8 |
| 7. Performans bütçeleri | 2026-10-11 10:04 UTC | statik çıktı | 38 | **1** | 0 | 0 |
| 8. Görsel regresyon | 2026-10-11 10:04 UTC | statik çıktı + test kancalı | 2 | 0 | 0 | 2 |
| 9. Erişilebilirlik ve çocuk-dostu ölçüler | 2026-10-11 10:04 UTC | statik çıktı + tarayıcısız | 188 | 0 | 0 | 19 |

**Başlık sayıları**


| Ölçü | Değer |
| --- | --- |
| Dosyası doğrulanan görev (Yazıya dök hariç; masaüstü / telefon) | 9 / 9 · 9 / 9 |
| Ana ekrandan dosyaya en çok tıklama (masaüstü / telefon) | 4 / 5 |
| Varsayılan yolda görülen, teknik terim içeren farklı cümle | 0 |
| Arama (yeni ayrı küme): ilk sonuç doğru / ilk üçte / yanlış ama emin | %81,8 / %85,8 / %12 |
| Arama, eski küme (KİRLENMİŞ): ilk sonuç doğru / yanlış ama emin | %92,4 / %3,1 |
| Hata hücreleri: iyi / belirsiz / bozuk | 74 / 0 / 0 |
| İlerleme çubuğu geri gitti (kez) · iptalden sonra kalan bayt | 0 · 0 |
| Eklenen ses–görüntü sapması (en kötü) · süre hatası (en kötü) | 1 ms · 16 ms |
| Görüntü sadakati, en düşük: SSIM · VMAF | 0,9658 · 84,6 |
| Küçült → WhatsApp hedefe sığdı | evet |
| Ana ekran: LCP (mobil kısıtlama) · aktarılan JS | 576 ms · 177 KB |
| En yavaş yeniden işleme hızı | 2,2 × gerçek zaman |
| Tabanından farklı ekran | 0 |
| Telefonda 44 px’ten küçük dokunma hedefi · adsız kontrol | 0 · 0 |
| Okunabilirlik (varsayılan yol): ortanca Ateşman · zor metin payı | 81,3 · %2 |

**Bütçe dışı ölçüler** (8)


| Ölçü | Değer | Bütçe |
| --- | --- | --- |
| İlk sonuç doğru (yapılabilen işler) | %81,8 | ≥ %85 |
| İlk üç sonuçta var | %85,8 | ≥ %90 |
| Yanlış ama emin: ilk sonuç başka iş yapan bir kart (bütün ifadelerde) | %12 | ≤ %5 |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %2 | ≤ %0 |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) | %83,9 | ≥ %95 |
| “Bunu henüz yapamıyoruz.” — isabet (precision) | %91,2 | ≥ %95 |
| Dizini (moov) sonda olan dosya — “faststart” değil | 10 / 10 | ≤ 0 |
| Editör, mobil kısıtlama: TBT | 206 ms (167–213) | ≤ 200 ms |

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
| Kes | evet | 4 | 2 | 1 | 3 | 152 | 280 | 1,8 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 3 | 0 | 1 | 4 | 105 | 235 | 1,5 sn | 0 | 0 | 0 |
| Dikey yap | evet | 3 | 0 | 1 | 4 | 105 | 226 | 3,4 sn | 0 | 0 | 0 |
| Küçült | evet | 3 | 0 | 1 | 4 | 105 | 270 | 3,9 sn | 0 | 0 | 0 |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 105 | 196 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 4 | 0 | 1 | 4 | 105 | 228 | 2,5 sn | 0 | 0 | 0 |
| Sesini al | evet | 3 | 0 | 0 | 4 | 105 | 227 | 1,4 sn | 0 | 0 | 0 |
| Sesi kapat | evet | 3 | 0 | 0 | 4 | 105 | 218 | 0,8 sn | 0 | 0 | 0 |
| Her yerde açılsın | evet | 3 | 0 | 0 | 4 | 105 | 234 | 1,3 sn | 0 | 0 | 0 |
| İyileştir | evet | 3 | 0 | 1 | 4 | 136 | 322 | 4,6 sn | 0 | 0 | 0 |

Notlar (masaüstü (1440 × 900)):

- **Yazıya dök:** “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**telefon (390 × 844, dokunmatik)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kes | evet | 5 | 2 | 1 | 3 | 105 | 224 | 1,7 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 4 | 0 | 1 | 4 | 105 | 248 | 1,5 sn | 0 | 0 | 0 |
| Dikey yap | evet | 4 | 0 | 1 | 4 | 105 | 239 | 3,4 sn | 0 | 0 | 0 |
| Küçült | evet | 4 | 0 | 1 | 4 | 105 | 282 | 3,9 sn | 0 | 0 | 0 |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 105 | 192 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 5 | 0 | 1 | 4 | 105 | 241 | 2,5 sn | 0 | 0 | 0 |
| Sesini al | evet | 4 | 0 | 0 | 4 | 105 | 239 | 1,3 sn | 0 | 0 | 0 |
| Sesi kapat | evet | 4 | 0 | 0 | 4 | 105 | 230 | 0,8 sn | 0 | 0 | 0 |
| Her yerde açılsın | evet | 4 | 0 | 0 | 4 | 105 | 247 | 1,3 sn | 0 | 0 | 0 |
| İyileştir | evet | 4 | 0 | 1 | 4 | 136 | 336 | 4,1 sn | 0 | 0 | 0 |

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
| Boşlukları at | masaüstü | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 73 KB, 1280 × 720 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (72.688 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Boşlukları at | telefon | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 73 KB, 1280 × 720 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (72.689 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | masaüstü | other-8s.mp4 (640 × 360 yatay, 8 sn) | 1.607 KB, 1080 × 1920 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.607.351 bayt); tuttu: 1080 × 1920 (1080 × 1920); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | telefon | other-8s.mp4 (640 × 360 yatay, 8 sn) | 1.607 KB, 1080 × 1920 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.607.351 bayt); tuttu: 1080 × 1920 (1080 × 1920); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Küçült | masaüstü | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.009 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.009.106 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,01 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,01 MB) |
| Küçült | telefon | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 14.028 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (14.028.151 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: dosya kaynaktan küçük (24,74 MB → 14,03 MB); tuttu: WhatsApp sınırına (16 MB) sığıyor (14,03 MB) |
| Yazıya dök | masaüstü | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Yazıya dök | telefon | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Müzik ekle | masaüstü | other-8s.mp4 + tone-30s.m4a | 1.611 KB, 1280 × 720 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.611.382 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Müzik ekle | telefon | other-8s.mp4 + tone-30s.m4a | 1.611 KB, 1280 × 720 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.611.446 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Sesini al | masaüstü | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesini al | telefon | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesi kapat | masaüstü | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Sesi kapat | telefon | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Her yerde açılsın | masaüstü | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 1.012 KB, 1280 × 720 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.011.567 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| Her yerde açılsın | telefon | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 1.009 KB, 1280 × 720 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.009.377 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| İyileştir | masaüstü | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.825 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.825.338 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |
| İyileştir | telefon | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.823 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.823.446 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |

**Yazıya dök, baştan sona — TEST KANCALI derleme, betikli tanıyıcı**
Bu satırlar `CLIP_TEST_HOOKS=1` derlemesinde, küçük bir model listesi ve konuşmayı DUYMAYAN betikli bir tanıyıcıyla alındı. Ölçülen şey akıştır (tıklama, ekran, kelime, dosyanın çıkması). **Yazının doğruluğu hakkında hiçbir şey söylemez** (bkz. bölüm 6).


| Görünüm | Dosya çıktı | Tıklama | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Karttan dosyaya | Teknik terim | Adıyla bulunamayan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | evet | 5 | 1 | 4 | 105 | 5 sn (model 360 KB’lık test dosyası) | 0 | 0 |
| telefon | evet | 6 | 1 | 4 | 105 | 5 sn (model 360 KB’lık test dosyası) | 0 | 0 |

## 2. Arama kalitesi

Dört küme var ve hangisinin ne olduğu önemlidir:

- **Yeni ayrı küme** (`web/tests/quality/data/search-eval-fresh2.ts`, 243 ifade; sayılan 209): aramanın kodunu, kelime listelerini ve öteki ifadeleri GÖRMEYEN bir yazar tarafından yazıldı; aramanın son değişikliğinden sonra BİR KEZ ölçüldü. **Başlık sayıları ve bütçeler bu kümedendir.** Kaçanları aşağıda yazılı olduğu için bundan sonra bu küme de görülmüş sayılır: arama onun kaçanlarına bakılarak ayarlanırsa yeni bir küme yazılmalıdır.
- **İlk yeni küme** (`search-eval-fresh.ts`, 178 ifade; sayılan 139): aynı biçimde, görmeyen bir yazarca yazıldı ve ilk arama değişikliğinden sonra bir kez ölçüldü (o ölçüm: ilk sonuç doğru %81,5, yanlış ama emin %12,2 — commit `9dae184`). Sonra kaçanları okundu ve arama onlara göre bir kez daha değiştirildi: **artık ayar kümesidir**, bugünkü sayıları (ilk sonuç %97,8, yanlış ama emin %2,2) bir tahmin değildir.
- **Eski ayrı küme** (`search-eval.ts` içindeki `HELD_OUT`, 282 ifade; sayılan 225): **KİRLENMİŞ.** 10 Ekim’deki arama çalışması bu kümenin kaçanları okunduktan sonra yapıldı (iş onların üzerine istendi). Sayıları bir tahmin değildir; yalnızca “önce → sonra” karşılaştırması için durur.
- **Geliştirme kümesi** (`DEV`, 175 ifade): üzerinde ayar yapıldı; ölçüm değildir.

Ayar tablolarında (`tests/unit/taskSearch*.test.ts`) ya da `DEV` içinde bulunan ifadeler iki ayrı kümenin sayımından da çıkarıldı; eski kümede bulunanlar yeni kümenin sayımından çıkarıldı (yeni kümede sayılmayan: 34; eski kümede sayılmayan: 57).

**Yeni ayrı küme — başlık**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| İlk sonuç doğru (yapılabilen işler) — 148 ifadede | %81,8 | ≥ %85 | BÜTÇE DIŞI |
| İlk üç sonuçta var | %85,8 | ≥ %90 | BÜTÇE DIŞI |
| Yanlış ama emin: ilk sonuç başka iş yapan bir kart (bütün ifadelerde) — 209 ifadede | %12 | ≤ %5 | BÜTÇE DIŞI |
| Yapılabilen işe “Bunu bulamadım.” | %4,7 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %2 | ≤ %0 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 31 ifadede | %83,9 | ≥ %95 | BÜTÇE DIŞI |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 34 kez söylendi | %91,2 | ≥ %95 | BÜTÇE DIŞI |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 20 ifadede; 4 tanesine kart önerildi | %80 | ≥ %80 | bütçe içinde |
| Anlamsız yazı / sohbete kart önerilmedi — 10 ifadede | %90 | ≥ %90 | bütçe içinde |

**İşe göre** (yeni küme, ilk sonuç)

| İş | İfade | İlk sonuç doğru | İlk üçte | Yanlış ama emin | Bulunamadı |
| --- | --- | --- | --- | --- | --- |
| Kes | 17 | 14 (%82,4) | 15 | 2 | 1 |
| Boşlukları at | 15 | 12 (%80) | 13 | 2 | 0 |
| Dikey yap | 16 | 16 (%100) | 16 | 0 | 0 |
| Küçült | 15 | 14 (%93,3) | 14 | 0 | 1 |
| Yazıya dök | 14 | 11 (%78,6) | 11 | 1 | 2 |
| Müzik ekle | 14 | 9 (%64,3) | 10 | 4 | 1 |
| Sesini al | 16 | 13 (%81,3) | 15 | 2 | 0 |
| Sesi kapat | 13 | 8 (%61,5) | 9 | 5 | 0 |
| Her yerde açılsın | 15 | 13 (%86,7) | 13 | 0 | 2 |
| İyileştir | 13 | 11 (%84,6) | 11 | 1 | 0 |

**Yazış biçimine göre** (yeni küme, ilk sonuç; bir ifade birden çok satırda sayılır)

| Biçim | İfade | İlk sonuç doğru |
| --- | --- | --- |
| Türkçe | 115 | 94 (%81,7) |
| Türkçe harfsiz | 21 | 19 (%90,5) |
| yazım hatalı | 17 | 17 (%100) |
| argo / kısaltma | 16 | 14 (%87,5) |
| uzun cümle | 40 | 27 (%67,5) |
| İngilizce | 33 | 27 (%81,8) |

**Kaçanlar, yeni küme** (37) — ifade → beklenen → çıkan

| İfade | Beklenen | Çıkan | Tür |
| --- | --- | --- | --- |
| “video çok uzun olmuş, ilk iki dakikası boş boş bekliyorum, oradan sonrasını istiyorum” | Kes | Boşlukları at (+ Kes) | **yanlış ama emin** |
| “dedemin konuşmasının sonunda kamerayı kapatmayı unutmuşum, o yerdeki ayak görüntülerini nasıl atarım” | Kes | Sesi kapat | **yanlış ama emin** |
| “i only want the part from 0:30 to 1:10” | Kes | Bunu bulamadım. | bulunamadı |
| “susmaları kırp” | Boşlukları at | Kes (+ Boşlukları at) | **yanlış ama emin** |
| “ders anlatırken arada düşünüp susuyorum, video uzuyor, o ses olmayan yerleri tek tek uğraşmadan attırmak istiyorum” | Boşlukları at | Sesi kapat (+ Sesini al) | **yanlış ama emin** |
| “oyun videomda konuşmadığım dakikalar çok sıkıcı, sadece konuştuğum yerler arka arkaya gelsin istiyorum” | Boşlukları at | Bunu henüz yapamıyoruz. [Videoları birleştir] | bulunamadı |
| “telefonumda yer kalmadı, videoları silmek istemiyorum ama daha az alan kaplasınlar istiyorum” | Küçült | Bunu bulamadım. | bulunamadı |
| “hocanın anlattıklarını not olarak istiyorum” | Yazıya dök | Bunu bulamadım. | bulunamadı |
| “toplantı kaydında kim ne söylemiş okumak istiyorum, baştan sona dinlemeye vaktim yok, yazılı hali olsun” | Yazıya dök | Sesini al (+ Kes, Sesi kapat) | **yanlış ama emin** |
| “i recorded an interview and need every spoken word typed out so i can paste it into my essay” | Yazıya dök | Bunu bulamadım. | bulunamadı |
| “telefonumdaki mp3 videoda çalsın” | Müzik ekle | Sesini al | **yanlış ama emin** |
| “videoma parça koycam” | Müzik ekle | Kes | **yanlış ama emin** |
| “video çok sessiz ve sıkıcı duruyor, altına hareketli bir şarkı gelse çok güzel olacak” | Müzik ekle | Boşlukları at (+ Müzik ekle) | **yanlış ama emin** |
| “kendi bestelediğim gitarı kaydettim, onu gezi videomun üstüne ses olarak bindirmek istiyorum” | Müzik ekle | Sesini al | **yanlış ama emin** |
| “i have a tune saved on my phone and want it to play during the whole video” | Müzik ekle | Bunu bulamadım. | bulunamadı |
| “videodaki şarkıyı mp3 yap” | Sesini al | Müzik ekle (+ Sesini al) | **yanlış ama emin** |
| “i just want to listen, no picture needed” | Sesini al | Bunu henüz yapamıyoruz. [Videodan fotoğraf al] | bulunamadı |
| “konusmalar duyulmasin istiyorum” | Sesi kapat | Boşlukları at | **yanlış ama emin** |
| “sesi komple uçur” | Sesi kapat | Sesini al | **yanlış ama emin** |
| “arkada kardeşim bağırıyor, videoyu paylaşacağım ama içinde tek bir ses bile duyulsun istemiyorum” | Sesi kapat | Sesini al | **yanlış ama emin** |
| “çekerken yanımdakiler özel şeyler konuşmuş, görüntü aynı kalsın ama sesin tamamı yok olsun” | Sesi kapat | Sesini al (+ Sesi kapat, İyileştir) | **yanlış ama emin** |
| “people are talking in the background and i want the clip completely silent before i share it” | Sesi kapat | Boşlukları at (+ Kes) | **yanlış ama emin** |
| “dosya turunu degistir” | Her yerde açılsın | Bunu bulamadım. | bulunamadı |
| “codec hatası alıyorum” | Her yerde açılsın | Bunu bulamadım. | bulunamadı |
| “karlı parazitli görüntüyü temizle” | İyileştir | Bunu henüz yapamıyoruz. [Sesteki gürültüyü temizle] | bulunamadı |
| “gece çektim hiçbir şey görünmüyor” | İyileştir | Her yerde açılsın | **yanlış ama emin** |
| “strip the audio track off” | Sesini al / Sesi kapat | Müzik ekle (+ Sesini al) | **yanlış ama emin** |
| “videodan whatsapp çıkartması yapmak istiyorum” | “Bunu henüz yapamıyoruz.” | Küçült | **yanlış ama emin** |
| “arkamdaki dağınık odayı sil” | “Bunu henüz yapamıyoruz.” | Bunu bulamadım. | bulunamadı |
| “arkadaki ugultuyu azalt konusma net duyulsun” | “Bunu henüz yapamıyoruz.” | İyileştir | **yanlış ama emin** |
| “instagram linkinden reels indirmek istiyorum” | “Bunu henüz yapamıyoruz.” | Dikey yap | **yanlış ama emin** |
| “kamerayı aç yeni video çekeceğim” | “Bunu henüz yapamıyoruz.” | Bunu bulamadım. | bulunamadı |
| “videoya şifre koy kimse açamasın” | kart önerilmemesi | Her yerde açılsın | **yanlış ama emin** |
| “bana senaryo yaz” | kart önerilmemesi | Yazıya dök | **yanlış ama emin** |
| “videoyu televizyona yansıt” | kart önerilmemesi | Her yerde açılsın | **yanlış ama emin** |
| “videodaki kişi kim bul” | kart önerilmemesi | İyileştir | **yanlış ama emin** |
| “bugün hava güzel” | kart önerilmemesi | İyileştir | **yanlış ama emin** |

**Eski ayrı küme — KİRLENMİŞ, başlık değil**


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| İlk sonuç doğru (yapılabilen işler) — 172 ifadede | %92,4 | — | bütçesiz |
| İlk üç sonuçta var | %93,6 | — | bütçesiz |
| Yanlış ama emin: ilk sonuç başka iş yapan bir kart (bütün ifadelerde) — 225 ifadede | %3,1 | — | bütçesiz |
| Yapılabilen işe “Bunu bulamadım.” | %3,5 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %0,6 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 29 ifadede | %100 | — | bütçesiz |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 39 kez söylendi | %97,4 | — | bütçesiz |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 12 ifadede; 1 tanesine kart önerildi | %91,7 | — | bütçesiz |
| Anlamsız yazı / sohbete kart önerilmedi — 12 ifadede | %100 | — | bütçesiz |

**Yazış biçimine göre** (eski küme)

| Biçim | İfade | İlk sonuç doğru |
| --- | --- | --- |
| Türkçe | 111 | 105 (%94,6) |
| argo / kısaltma | 13 | 11 (%84,6) |
| uzun cümle | 20 | 15 (%75) |
| yazım hatalı | 6 | 5 (%83,3) |
| Türkçe harfsiz | 5 | 5 (%100) |
| İngilizce | 61 | 54 (%88,5) |

**Kaçanlar, eski küme** (14)

| İfade | Beklenen | Çıkan | Tür |
| --- | --- | --- | --- |
| “sadece gol anını al” | Kes | Bunu bulamadım. | bulunamadı |
| “chop the end off” | Kes | Sesi kapat (+ Kes) | **yanlış ama emin** |
| “susunca kessin” | Boşlukları at | İyileştir | **yanlış ama emin** |
| “sessizlikleri otomatik kes” | Boşlukları at | Kes (+ Boşlukları at) | **yanlış ama emin** |
| “nefes aralarını at” | Boşlukları at | Kes | **yanlış ama emin** |
| “skip the parts where nobody talks” | Boşlukları at | Bunu bulamadım. | bulunamadı |
| “tighten up my talking video” | Boşlukları at | Bunu bulamadım. | bulunamadı |
| “tik tok videosu yap” | Dikey yap | Bunu bulamadım. | bulunamadı |
| “sözleri yazdır” | Yazıya dök | Bunu bulamadım. | bulunamadı |
| “write down what is said” | Yazıya dök | Bunu henüz yapamıyoruz. [Videoya yazı ekle] | bulunamadı |
| “i want to add my own mp3 to the video” | Müzik ekle | Sesini al | **yanlış ama emin** |
| “silence the video” | Sesi kapat | Boşlukları at | **yanlış ama emin** |
| “make it work on any device” | Her yerde açılsın | Bunu bulamadım. | bulunamadı |
| “sesimi kadın sesi yap” | kart önerilmemesi | Sesini al | **yanlış ama emin** |

Geliştirme kümesi (`DEV`, ayar yapılırken kullanılabilir; başlık sayısı değildir): 85 ifade, ilk sonuç %96,9, yanlış ama emin %8,2, kaçan 8 (“arkadaki konuşmalar duyulmasın” → Bunu henüz yapamıyoruz. [Sesteki gürültüyü temizle]; “gece çektiğim videoda hiçbir şey görünmüyor biraz açmak istiyorum” → Her yerde açılsın; “kesinlikle çok güzel olmuş” → İyileştir; “bugün hava çok güzel” → İyileştir; “videoyu instagramda paylaş” → Dikey yap; “şarkının adını bul” → Müzik ekle (+ İyileştir); “dvd ye yaz” → Yazıya dök; “oyun oyna” → Her yerde açılsın).

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
| İçi rastgele bayt olan .mp4 | hepsi | iyi | ““bozuk.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | Boşlukları at, Her yerde açılsın, Dikey yap, Kes, Küçült, Müzik ekle, Sesini al, Sesi kapat, Yazıya dök | iyi | ““yarim-inmis.mp4” açılamadı: bu video yarım kalmış görünüyor: 24,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 12,3 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | İyileştir | iyi | ““yarim-inmis.mp4” açılamadı: bu video yarım kalmış görünüyor: 3,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk 1,5 sn var. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.” | ne olduğunu ve ne yapılacağını söylüyor | 0,4 sn |
| Yalnızca ses dosyası (.m4a) | hepsi | iyi | ““tone-30s.m4a” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| Sesi olmayan video | Her yerde açılsın, Dikey yap, İyileştir, Kes | geçerli değil | (metin yok) | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,4 sn |
| Sesi olmayan video | Küçült | geçerli değil | “Bu video zaten 73 KB; buraya sığıyor. Küçültmene gerek yok.” | bu iş videonun sesine ihtiyaç duymaz; video açıldı, adım indirme sunmadı ve nedenini söyledi (“Bu video zaten 73 KB; buraya sığıyor. Küçültmene gerek yok.”) | 0,2 sn |
| Sesi olmayan video | Müzik ekle | geçerli değil | “Önce müziğini seç.” | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,2 sn |
| Sesi olmayan video | Boşlukları at | iyi | “Bu videoda ses yok; sessizlik aranamaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesini al | iyi | “Bu videoda ses yok; kaydedilecek bir ses dosyası çıkmaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesi kapat | iyi | “Bu videoda zaten ses yok; kapatılacak bir şey yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Yazıya dök | iyi | “Bu videoda ses yok; yazıya dökülecek bir konuşma yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB) | hepsi | iyi | ““kalite-cok-buyuk.mp4” açılamadı: dosya 5,37 GB; bu sürümün sınırı 4,29 GB. Daha küçük bir video seç; ya da bu videoyu önce başka bir uygulamayla parçalara böl.” | ne olduğunu ve ne yapılacağını söylüyor | 0 sn |
| Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika) | hepsi | iyi | ““kalite-cok-uzun.mp4” açılamadı: video bu sürümdeki 120 dakika sınırının üzerinde. Daha kısa bir video seç; ya da bu videoyu önce başka bir uygulamayla parçalara böl.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |

**Konsola düşen hatalar** (aynı satır bir kez)

- 10 hücrede: `Failed to load resource: net::ERR_REQUEST_RANGE_NOT_SATISFIABLE`

## 4. Dürüstlük denetimleri

**İlerleme çubuğu ve “Kaydedildi”** — “İndir”e basıştan sonuca kadar 40 ms’de bir örneklendi (masaüstü, statik çıktı).


| Senaryo | Sonuç | Örnek / farklı değer | İlk → son | Geri gitti | Geçiş arasında geri gitti | %100’de bekleme | “Kaydedildi” anında dosya | Dosyasız başarı |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dikey yap: 12 sn’lik 1920 × 1080 video yeniden işlenir | saved | 120 / 18 | %0 → %99 | 0 kez | 0 kez | 0 ms | 25.255 KB, 12,01 sn, video:h264 + audio:aac | hayır |
| İyileştir: ışığı değişen 10 sn’lik video | saved | 180 / 22 | %0 → %97 | 0 kez | 0 kez | 0 ms | 9.433 KB, 10,01 sn, video:h264 + audio:aac | hayır |
| Küçült → WhatsApp: yaklaşık 24 MB’lık video 16 MB’ın altına iner | saved | 114 / 16 | %0 → %97 | 0 kez | 0 kez | 0 ms | 15.475 KB, 12,01 sn, video:h264 + audio:aac | hayır |

Kaydetme penceresi olmayan yol (telefon, Firefox, Safari): “hazır” dendiğinde bağlantının arkasındaki dosya 1.010 KB; dosyasız başarı: hayır (bütçe içinde).

**İptal** — 24 sn’lik video dikey yapılırken, ilerleme %3’ü geçince “İptal et”e basıldı.


| Yol | Durdu | Durma süresi | Ekrandaki metin | İş sürerken sayfa deposunda | İptalden 4 sn sonra kalan | Kalan bayt | İptalden sonra “kaydedildi” |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kaydetme penceresiz (telefon, Firefox, Safari) | evet | 74 ms | “İndirme durduruldu; yarım dosya bırakılmadı.” | clip-export-exp_mv3nj62h_2.mp4 (38.927 KB) | hiçbir şey | 0 | hayır |
| kaydetme pencereli (Chrome / Edge) | evet | 64 ms | “İndirme durduruldu; yarım dosya bırakılmadı.” | saved-sample-24s_dikey.mp4.crswap (38.927 KB), saved-sample-24s_dikey.mp4 (0 KB) | hiçbir şey | 0 | hayır |

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
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 1080 × 1920, 25,3 MB | 1080 × 1920 | 0,9822 | 45,56 dB | 84,6 | 11 ms | — | 10 denetimin hepsi tuttu |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma (kesim yerleri yeniden işlendi, arası kopya) | 1920 × 1080, 6,7 MB | 1920 × 1080 | 0,9978 | 55,19 dB | 99,2 | 8 ms | — | 10 denetimin hepsi tuttu |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 1920 × 1080, 15,5 MB | 1920 × 1080 | 0,9658 | 42,84 dB | 87,3 | 11 ms | 15,5 MB / 16 MB: sığdı: evet; hedefin kullanılan payı %96,7 (kaynak 24,3 MB) | 10 denetimin hepsi tuttu |

**Dizin başta mı (faststart)?** Dizini dosyanın sonunda olan: 10 / 10 dosya (BÜTÇE DIŞI, bütçe ≤ 0). Dizin sondaysa dosya indirilirken ya da bir sayfaya gömülüyken tamamı gelmeden oynatılamaz; yerel oynatmayı etkilemez. Yukarıdaki “her yerde açılır” sütunu bu denetimi saymaz.

**İyileştir** — ADR-037’nin ölçüleri (`web/tests/e2e/enhance-media.ts`: ortalama parlaklık, Laplace varyansı), üretilmiş dört video üzerinde.


| Video | Uygulamanın dediği | İndirme sunuldu | Parlaklık önce → sonra | Keskinlik önce → sonra | Eklenen en büyük parlaklık sıçraması | Kare |
| --- | --- | --- | --- | --- | --- | --- |
| karanlık | “Yapılacaklar: video belirgin biçimde aydınlatılır, renkler toparlanır.” | evet | 69,2 → 120 (+50,8) | 50,7 → 108,9 | 0,17 | 90 / 90 |
| bulanık | “Yapılacaklar: renkler toparlanır, kenarlar keskinleştirilir.” | evet | 140,3 → 141,6 | 24,7 → 27,9 (× 1,13) | 0,05 | 90 / 90 |
| kumlu | “Yapılacaklar: ışık ve kontrast biraz düzeltilir, renkler toparlanır, kumlanma azaltılır.” | evet | 104,8 → 119,1 | 373,9 → 117,7 | 0,17 | 90 / 90 |
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
| Ana ekran `/` | bu makine | 177 KB (8 dosya) | 185 KB | 80 ms | 80 ms (72–96) | 0 ms | 111 ms | 2,5 MB | 0 |
| Ana ekran `/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 177 KB (8 dosya) | 185 KB | 576 ms | 576 ms (568–588) | 118 ms (111–134) | 1.435 ms | 2,5 MB | 0 |
| Editör `/editor/` | bu makine | 284 KB (16 dosya) | 366 KB | 104 ms | 104 ms (92–104) | 0 ms | 134 ms | 3,4 MB | 0 |
| Editör `/editor/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 284 KB (16 dosya) | 366 KB | 796 ms | 796 ms (760–804) | **206 ms (167–213)** (bütçe ≤ 200 ms) | 1.901 ms | 3,4 MB | 0 |
| Sihirbaz `/yap/dikey/` | bu makine | 234 KB (14 dosya) | 250 KB | 56 ms | 56 ms (56–76) | 0 ms | 96 ms | 2,8 MB | 0 |
| Sihirbaz `/yap/dikey/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 234 KB (14 dosya) | 250 KB | 604 ms | 604 ms (592–612) | 129 ms (122–134) | 1.764 ms | 2,8 MB | 0 |

**Bellek:** 12 sn’lik 1920 × 1080 video dikey yapılırken ana iş parçacığının JS yığını — boşta 2,7 MB, video açıkken 5,3 MB, tepe 6,8 MB (bütçe içinde, bütçe ≤ 150 MB), bittikten sonra 5,5 MB; 58 örnek. Dışa aktarmanın işçileri (worker) ve kodlayıcı bu sayının DIŞINDADIR; bütün süreç ağacının belleği `web/scripts/measure-export-memory.mjs` ile ölçülür (ADR-029), burada yeniden koşulmadı.

**Dışa aktarma hızı** — “İndir”e basıştan dosyanın hazır olmasına; × gerçek zaman = çıktı süresi / geçen süre. Ölçüm kilidi altında, bu makinede.


| Durum | Yol | Çıktı | Geçen süre | × gerçek zaman |
| --- | --- | --- | --- | --- |
| Her yerde açılsın, senkron klibi (H.264 MP4) | kopya | 12 sn, 1080 × 1920 | 0,81 sn | 14,8 × |
| Her yerde açılsın, senkron klibi (VP9 WebM) | yeniden işlendi | 12 sn, 1080 × 1920 | 3,33 sn | 3,6 × |
| Dikey yap, senkron klibi (zaten 9:16) | kopya | 12 sn, 1080 × 1920 | 0,81 sn | 14,9 × |
| Kes 2–8 sn, senkron klibi (H.264 MP4) | kopya | 6 sn, 1080 × 1920 | 0,35 sn | 17,4 × |
| Kes 2–8 sn, senkron klibi (VP9 WebM) | yeniden işlendi | 6 sn, 1080 × 1920 | 1,86 sn | 3,2 × |
| Küçült (seçim değişmeden: WhatsApp), ağır senkron klibi (H.264, yaklaşık 33 MB) | yeniden işlendi | 12 sn, 1080 × 1920 | 4,39 sn | 2,7 × |
| Her yerde açılsın, kamera benzeri 720p VP9 WebM | yeniden işlendi | 6 sn, 1280 × 720 | 1,84 sn | 3,3 × |
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 12 sn, 1080 × 1920 | 5,39 sn | 2,2 × |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma | 3 sn, 1920 × 1080 | 1,34 sn | 2,2 × |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 12 sn, 1920 × 1080 | 5,36 sn | 2,2 × |
| İyileştir, karanlık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 2,83 sn | 1,1 × |
| İyileştir, bulanık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 4,35 sn | 0,7 × |
| İyileştir, kumlu video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 9,12 sn | 0,3 × |
| İyileştir, iyi video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 2,84 sn | 1,1 × |

İyileştir satırları grafik hızlandırma olmadan alındı: Playwright’ın Chromium’u bu makinede WebGL’i yazılımla çiziyor (uygulama da bunu söylüyor). Grafik kartı kullanan gerçek bir tarayıcıdaki hız BURADA ÖLÇÜLMEDİ; bu sayı en kötü durumdur.

## 8. Görsel regresyon

Taban resimler: `web/tests/quality/baselines/` (66 PNG; Windows’ta Chromium’un sistem yazı tipleriyle çizdiği hâl). Karşılaştırma toleranslıdır: bir pikselin bir renk kanalı 40 / 255’ten fazla ayrışırsa “farklı” sayılır; piksellerin %1’inden fazlası farklıysa ekran “farklı” sayılır. Video, canvas ve saate ya da kodlayıcıya bağlı metinler maskelenir. **CI’da koşulmaz** (aşağıda neden).


|  | Ekran | Bütçe | Durum |
| --- | --- | --- | --- |
| Karşılaştırılan ekran | 66 | — | bütçesiz |
| Farklı | 0 | ≤ 0 | bütçe içinde |
| Karşılaştırılamadı | 0 | ≤ 0 | bütçe içinde |
| Bu koşuda taban yazıldı / yenilendi (karşılaştırma değil) | 0 | — | bütçesiz |

**Ekranlar**


| Ekran | Masaüstü | Telefon |
| --- | --- | --- |
| `ana-ekran` | aynı | aynı |
| `ana-ekran-arama` | aynı | aynı |
| `ana-ekran-bulunamadi` | aynı | aynı |
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
| Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”) | 6 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %67 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran | 17 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %31 | 0 | 17 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video yok | 8 | 3 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %47 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video ve bir kesit | 20 | 4 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %84 | 0 | 20 durak; ulaşılamayan 0; geri sıçrama 1 (çok sütunlu; yargılanmaz) | 0 |
| Boşlukları at, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %45 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Dikey yap, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %47 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, ilk ekran (Dikey yap) | 3 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %42 | 0 | 3 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| İyileştir, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %53 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Küçült, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %50 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Müzik ekle, seçim (müzik seçilmiş) | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %47 | 0 | 14 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, sonuç ekranı (Her yerde açılsın) | 7 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %29 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Yazıya dök, model adımı | 5 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %21 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |

**Okunabilirlik** — `web/src/i18n/messages.ts` içindeki Türkçe metinler; Ateşman puanı (90–100 çok kolay · 70–89 kolay · 50–69 orta · 30–49 zor · 30 altı çok zor).


| Metinler | Metin | Puanlanan (5+ kelime) | Ortanca puan | Zor + çok zor | Çok zor | 20 kelimeden uzun cümle | En uzun cümle | En uzun kelime |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Varsayılan yol (ana ekran, kartlar, sihirbazlar, yazıya dökme, indirme, hata) | 422 | 205 | 81,3 | %2 | 0 | 1 | 22 kelime | birleştirilebiliyor |
| Bütün metinler (editör dahil) | 1.034 | 464 | 78,6 | %3,7 | 1 | 4 | 22 kelime | birleştirilebiliyor |

Varsayılan yolun metinlerinden teknik terim içeren: 9 (bütçesiz). Bu, metin tablosunun taramasıdır: bir metnin ekrana hangi koşulda geldiğini bilmez (bir kısmı yalnızca hata olduğunda ya da “Ayrıntılar” açıldığında görünür). Gerçekten görülenler bölüm 1’dedir.

**En zor 20 metin (varsayılan yol)**


| Puan | Anahtar | Cümle başına kelime | Kelime başına hece | Metin |
| --- | --- | --- | --- | --- |
| 33,1 (zor) | `transcript.machine` | 5 | 3,8 | “Otomatik yazıldı — yanlış olabilir, düzeltebilirsin.” |
| 37,7 (zor) | `download.readyWhereDevice` | 4 | 3,75 | “Tarayıcın dosyayı İndirilenler klasörüne kaydeder; Dosyalar uygulamasında bulursun.” |
| 48,2 (zor) | `download.readyWhere` | 10 | 3,1 | “Tarayıcın dosyayı İndirilenler klasörüne kaydeder (ya da nereye kaydedeceğini sorar).” |
| 49,2 (zor) | `download.targetReduced` | 5 | 3,4 | “Sığması için görüntünün ayrıntısı azaltıldı” |
| 50,4 (orta) | `export.fail.output_probe_failed` | 3 | 3,5 | “Oluşan dosya yeniden açılamadı; başarılı sayılmadı.” |
| 51,9 (orta) | `silence.failed.undecodable` | 3,5 | 3,43 | “Bu tarayıcı videonun sesini çözemiyor; sessizlik aranamadı.” |
| 51,9 (orta) | `enhance.preview.failed.source_undecodable` | 3,5 | 3,43 | “Bu tarayıcı bu videoyu çözemiyor; iyileştirme yapılamıyor.” |
| 51,9 (orta) | `transcript.failed.undecodable` | 3,5 | 3,43 | “Bu tarayıcı videonun sesini çözemiyor; yazıya dökülemedi.” |
| 52,6 (orta) | `enhance.setting.previewNote` | 6 | 3,25 | “Oynatıcı videonun kendi hâlini gösterir. Aşağıdaki resim indirilecek videonun gerçek bir karesidir.” |
| 52,8 (orta) | `silence.failed.worker_unavailable` | 4 | 3,38 | “Çözümleme bu tarayıcıda başlatılamadı. Sayfayı yenileyip tekrar dene.” |
| 55,7 (orta) | `download.targetNormal` | 2,5 | 3,4 | “Olağan kalitede sığdı; ayrıntı azaltılmadı” |
| 55,7 (orta) | `transcript.unclearCount` | 2,5 | 3,4 | “{n} yer anlaşılamadı; dinleyip elle yazabilirsin.” |
| 55,9 (orta) | `export.fail.output_duration_mismatch` | 6 | 3,17 | “Oluşan dosyanın süresi beklenen süreyle uyuşmadı.” |
| 55,9 (orta) | `transcript.english` | 6 | 3,17 | “Şimdilik yalnızca İngilizce konuşmaları yazıya döker.” |
| 56,7 (orta) | `wizard.yazi.editorHint` | 13 | 2,69 | “Satırları seçip onlardan kesit yapmak ya da altyazının görünüşünü değiştirmek için editörde aç.” |
| 57,2 (orta) | `enhance.preview.failed.hdr_source_unsupported` | 7 | 3,07 | “Bu tarayıcı bu HDR videoyu doğru çeviremediği için iyileştirme yapılamıyor. Videoyu Chrome’da açmayı dene.” |
| 57,2 (orta) | `export.fail.no_video_track` | 5 | 3,2 | “Seçilen dosyada video izi bulunamadı.” |
| 57,2 (orta) | `task.filigran.sub` | 5 | 3,2 | “Videonun üstündeki yazıyı, logoyu kaldır” |
| 57,2 (orta) | `wizard.yazi.skipped` | 5 | 3,2 | “{n} satır kurallara uymadığı için alınmadı.” |
| 57,7 (orta) | `wizard.yazi.noLines` | 3,5 | 3,29 | “Yazılabilen bir satır çıkmadı; altyazılı video hazırlanamaz.” |

## Bu rapor neyi söylemez

- Bir çocuğun ya da ilk kez kullanan birinin nerede durakladığını, neyi yanlış anladığını, neyi beğenmediğini. Betik hiç duraksamaz ve her düğmenin adını önceden bilir.
- Gerçek telefonu: “telefon” burada masaüstü Chromium’un 390 × 844 dokunmatik öykünmesidir. Gerçek Android / iPhone’da hız, bellek, dosya seçici ve paylaşım ayrı ölçülür (`web/scripts/android/`).
- Gerçek çekimlerde görüntü kalitesini: sadakat ölçüleri üretilmiş, kamera benzeri bir videoda alındı.
- Yazıya dökmenin bugünkü doğruluğunu: bölüm 6 kayıtlı sayılardır.
- e2e testlerinin bu commit’te geçtiğini: atıf yapılan testler burada koşulmaz.
