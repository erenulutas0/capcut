# Kalite raporu — 2026-10-10

> Üreten: `npm run quality` (`web/scripts/quality/run.mjs`). Ölçüm koşusu: 2026-10-10 15:20 UTC, commit `70c0b2f`, 9 dk; ölçülen bölümler: search, text, walkthrough, errors, honesty, output, perf, visual, a11y. Raporun metni 2026-10-10 15:20 UTC tarihinde ölçüm yapılmadan yeniden yazıldı (`--report-only`).
> Makine: Windows_NT 10.0.26200, 12th Gen Intel(R) Core(TM) i5-12500 × 12, 64 GB bellek. Tarayıcı: Playwright’ın Chromium’u. Bütün medya üretilmiş (ffmpeg) ya da depodaki haklı örneklerdir; hiçbir şey makineden çıkmadı.
> Bu rapor bir kullanıcı testinin yerini TUTMAZ; neyi söylemediği en altta ve `docs/quality/README.md` içinde.

## Öne çıkan bulgular

_Bu bölüm elle yazılır (`docs/quality/bulgular.md`); sayılar aşağıdaki tablolardan gelir. Rapor yeniden üretildiğinde olduğu gibi yerine konur — tarihine bakın._

**Yazıldığı koşu:** 10 Ekim 2026, commit `70c0b2f`. Sıra önem sırasıdır: önce kullanıcıyı yanlış yere götüren ya da ona yanlış bir şey veren sorunlar. Her maddenin kanıtı aşağıdaki tablolardadır; hiçbiri bu çalışmada düzeltilmedi.

### Önce bunlar

1. **“Küçült”, seçim değiştirilmezse hiçbir şeyi küçültmüyor.** Kart “Küçült — WhatsApp’a sığdır” diyor; sihirbazda önceden seçili olan “Paylaşmak için (52 MB altı)”. İlk kez kullanan biri videosunu seçip “İndir”e basınca 24,74 MB’lık video 24,73 MB olarak kaydediliyor ve ekran “Kaydedildi” / “Video hazır” diyor; WhatsApp’ın 16 MB sınırına sığmıyor. İki görünümde de aynı. Dosya “kartın söz verdiği gibi değil” sayıldığı için dokuz görevden biri tamamlanmamış görünüyor (8 / 9).
   Kanıt: bölüm 1, “Küçült” satırı ve “Çıkan dosyalar”. Yer: `web/src/components/wizard/wizards.tsx` (`KucultWizard`, `useState<SizePresetId>('share')`), `web/src/i18n/messages.ts` (`task.kucult.sub`).

2. **Yarım inmiş bir video sessizce “başarı” üretiyor ya da kullanıcıyı yanlış yöne gönderiyor.** Baytlarının %55’i olan (indirme ya da kopyalama yarıda kalmış) bir MP4, dizini başta olduğu için “24,0 sn” olarak açılıyor. Sonra:
   - *Sesini al:* 24 saniyelik bir ses dosyası kaydediliyor, “Ses dosyası kaydedildi” deniyor; dosyanın son bölümü sessizlik (−91 dB). Uyarı yok.
   - *Boşlukları at:* “24,0 sn” gösterilen videodan 12,5 saniyelik bir dosya kaydediliyor. Uyarı yok.
   - *Diğer yedi sihirbaz:* “Bu tarayıcı videonun bazı karelerini çözemedi. … Chrome veya Edge ile dene.” Ölçüm zaten Chromium’da yapıldı; sorun tarayıcıda değil dosyada. Kullanıcı başka tarayıcı kurup aynı hatayı alır.

   Kanıt: bölüm 3, “Yarıda kesilmiş MP4” satırı (9 hücre “belirsiz”, 1 “ölçülemedi”). Yer: `export.fail.source_frames_missing` (`messages.ts`); ses ve sessizlik yollarında eksik veriye karşı bir denetim yok.

3. **Arama, on istekten birinde başka iş yapan bir kart öneriyor.** Ayrı tutulan 240 ifadede “yanlış ama emin” %10 (bütçe ≤ %5); ilk sonuç doğru %87,8, ilk üçte %91,7. En pahalı örnekler ters işe götürenler: “sesi kapa” ve “ses hiç olmasın istiyorum” → *Sesini al* (kullanıcı sesi kapatmak istiyor, ses dosyası çıkarılıyor); “müziğini almak istiyorum” → *Müzik ekle*; “mp3e çevir” → *Her yerde açılsın*. Listede hiç olmayan 15 isteğin 6’sına “Başla” düğmeli bir kart çıkıyor (“youtubedan video indir” → *Dikey yap*, “canlı yayın yap” → *İyileştir*). Uzun cümlelerde ilk sonuç %60, argo / kısaltmada %64. “Bunu henüz yapamıyoruz.” ise sağlam: 30 / 30 yakalandı, yanlış yere söylenmedi.
   Kanıt: bölüm 2, “Kaçanlar” tablosu (29 satır). Yer: `web/src/domain/taskSearch.ts`, `web/src/domain/tasks.ts`. Küme üzerinde ayar YAPILMAMALI (`web/tests/quality/data/search-eval.ts` başındaki kural).

### Sonra bunlar

4. **Sınır mesajları ne yapılacağını söylemiyor.** “… açılamadı: dosya 5,37 GB; bu sürümün sınırı 4,29 GB.” ve “… video bu sürümdeki 120 dakika sınırının üzerinde.” — on sihirbazın hepsinde, 20 hücre. Kullanıcıya kalan tek şey “Video seç”. (Bozuk dosya, yanlış tür ve sesi olmayan video mesajları iyi: ne olduğunu ve ne yapılacağını söylüyor.)
   Kanıt: bölüm 3. Yer: `error.file_too_large`, `error.source_too_long` (`messages.ts`).

5. **Varsayılan yolda sekiz ayrı cümlede teknik terim var.** Ayarlar ve Ayrıntılar açılmadan görülenler: “iPhone, HEVC ya da HDR videolar…”, “≈ 13,2 MB · 720p · kalite düşmeden sığıyor”, “…gerekirse çözünürlük düşer”, “Hızlı kesim — görüntü yeniden kodlanmadı, orijinal kalite”, “Orijinal görüntü zaten sığıyordu; yeniden kodlanmadı”, “Görüntü yeniden işlendi (kaynak H.264 MP4/MOV değil)”, “Görüntü yeniden işlendi (çözünürlük kaynağınkinden farklı)”, “Yalnızca ses: AAC, M4A dosyası”. Beş görevin sonuç ya da seçim ekranında (Küçült, Her yerde açılsın, Müzik ekle, Sesini al, Sesi kapat).
   Kanıt: bölüm 1, “Varsayılan yolda görülen teknik terimler”. Yer: `export.method.*`, `download.targetCopy`, `wizard.cevir.body`, `wizard.kucult.plan*`, `wizard.kucult.note`.

6. **“Kes”, 720p bir videoyu 1080p’ye büyütüyor.** 1280 × 720’lik örnekten kesilen 3 saniye 1920 × 1080 ve 1,5 MB olarak kaydedildi; kaynağın 24 saniyesinin tamamı 0,47 MB. Diğer sihirbazlar videonun kendi boyutunu koruyor.
   Kanıt: bölüm 1, “Çıkan dosyalar”, Kes satırı. Yer: “Kes” editörün varsayılan çıktı boyutunu kullanıyor (`web/src/components/wizard/wizards.tsx`, `KesWizard`: `importVideo(file)` tarifsiz).

7. **Yeniden işleme yollarında konsola kaynak uyarısı düşüyor.** “An AudioSample was garbage collected without first being closed…” — Küçült yürüyüşünde (iki görünüm) ve dürüstlük bölümünün senaryolarında. Ses örnekleri kapatılmadan bırakılıyor; kısa videolarda etkisi görülmedi, uzun videoda bellek üzerindeki etkisi BURADA ÖLÇÜLMEDİ.
   Kanıt: bölüm 1 notları. Yer: `web/src/adapters/export/` (ses yolu).

8. **Kaydedilen dosyaların hiçbirinde dizin başta değil (10 / 10).** Dosya indirilirken ya da bir sayfaya gömülüyken tamamı gelmeden oynatılamaz; yerelde oynatmayı etkilemez. Diske yazan yollarda bilerek böyle (`fastStart: false`), yalnızca bellek yolunda dizin başta.
   Kanıt: bölüm 5, “Dizin başta mı”. Yer: `web/src/adapters/export/outputSink.ts`.

9. **Telefonda yazıların yarısı 12–13 px; editörde 44 px’ten küçük hedefler var.** Sihirbaz ekranlarında kelimelerin %45–54’ü 14 px’in altında (yalnız Yazıya dök’ün model adımında %21; ana ekranda %62). 44 px’ten küçük 16 dokunma hedefi: ana ekranın dört hâlinde “Gizlilik (taslak)” (30 px yüksek), editörde 40 × 44’lük simgeler, 18 × 16’lık ad bağlantısı, 28 × 32’lik “Mesajı kapat”; editörde 11 px’lik yazılar. Sihirbazların kendisinde 44 px’ten küçük hedef yok, adsız kontrol yok, klavye sırası düzgün.
   Kanıt: bölüm 9, telefon tablosu.

10. **Sihirbaz sayfası editörün tamamını indiriyor.** Aktarılan JS: ana ekran 193 KB, sihirbaz 422 KB, editör 421 KB (30 Eylül’de aynı yöntemle ana ekran 137 KB, editör 237 KB idi: `docs/perf/2026-09-30-load.md`). Mobil kısıtlamada LCP iyi (0,6–0,8 sn); TBT editörde 256 ms (üç koşuda 240–280), sihirbazda 209 ms (197–218): 200 ms sınırının üstünde ya da kıyısında.
    Kanıt: bölüm 7.

### Bilinmesi gerekenler

- **İyileştir, grafik hızlandırma yokken gerçek zamandan yavaş** (0,3–1,1 ×; kumlu 3 saniyelik video yaklaşık 10 sn). Bu, Playwright’ın Chromium’unun yazılımla çizdiği en kötü durumdur; grafik kartlı gerçek bir tarayıcıda hız ölçülmedi. İyi pozlanmış videoda da “renkler toparlanır” denip indirme sunuluyor; o dosyada keskinlik ölçüsü 0,89 katına iniyor (bütçe içinde).
- **Yeniden işlenen görüntüde VMAF 84,6** (Dikey yap, Her yerde açılsın), Küçült’te 87,3; SSIM 0,966–0,982. Kumlu, üretilmiş bir videoda; gerçek çekimde ne olduğu ölçülmedi.
- **“Yazıya dök”te ilk kez kullanan, bir şey görmeden önce 108,8 MB indirmek zorunda.** Gerçek modelle yazı kalitesi bu koşuda ölçülmedi; bölüm 6 kayıtlı sayılardır.
- **İyi olanlar:** ilerleme çubuğu hiç geri gitmedi, dosyasız “Kaydedildi” yok, “İptal et” yaklaşık 0,1 sn içinde durdu ve geride bayt bırakmadı; eklenen ses–görüntü sapması en çok 1 ms, süre hatası en çok 16 ms; dokuz görevin sekizi en çok 4 tıklamayla (telefonda 5) doğru dosyayı verdi; her adım görünen adıyla bulunabildi; metinlerin ortanca Ateşman puanı 79 (“kolay”).

### Açık kalan

- Geliştirme sırasında bir kez, “Kes 2–8 sn, senkron klibi (H.264 MP4)” ölçümü 10 dakika yanıtsız kaldı. O sırada ölçüm betiğinde süresiz bekleyen bir adım vardı (sonradan sınırlandı); takılanın betik mi uygulama mı olduğu ayırt edilemedi. Aynı ölçüm sonraki koşuların hepsinde 1 saniyenin altında bitti. Tekrarlarsa bölüm 5’te “ölçülemedi” ve ekrandaki metinle görünecek.
- Ürün adı değiştiğinde (çalışma adı ekranlarda görünüyor) görsel tabanların hepsi “farklı” çıkar; değişiklik bilerek yapıldığında `--update-baselines` ile yenilenmeli.

## Özet

534 ölçü: **463 bütçe içinde**, **34 bütçe dışı**, **5 ölçülemedi**, 32 bütçesiz (yalnızca bildirilir). Bütçeler: `web/scripts/quality/budgets.json`.


| Bölüm | Ölçüm zamanı | Derleme | Bütçe içinde | Bütçe dışı | Ölçülemedi | Bütçesiz |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Görev tamamlama yürüyüşleri | 2026-10-10 15:13 UTC | statik çıktı + test kancalı | 174 | **14** | **4** | 0 |
| 2. Arama kalitesi | 2026-10-10 15:11 UTC | tarayıcısız | 6 | **2** | 0 | 1 |
| 3. Hata yolları | 2026-10-10 15:14 UTC | statik çıktı | 4 | **1** | 0 | 2 |
| 4. Dürüstlük denetimleri | 2026-10-10 15:15 UTC | statik çıktı | 22 | 0 | 0 | 0 |
| 5. Çıktı kalitesi | 2026-10-10 15:17 UTC | statik çıktı | 44 | **1** | 0 | 0 |
| 6. Yazıya dökme kalitesi | koşulmadı | — | 0 | 0 | **1** | 8 |
| 7. Performans bütçeleri | 2026-10-10 15:19 UTC | statik çıktı | 37 | **2** | 0 | 0 |
| 8. Görsel regresyon | 2026-10-10 15:19 UTC | statik çıktı + test kancalı | 2 | 0 | 0 | 2 |
| 9. Erişilebilirlik ve çocuk-dostu ölçüler | 2026-10-10 15:20 UTC | statik çıktı + tarayıcısız | 174 | **14** | 0 | 19 |

**Başlık sayıları**


| Ölçü | Değer |
| --- | --- |
| Dosyası doğrulanan görev (Yazıya dök hariç; masaüstü / telefon) | 8 / 9 · 8 / 9 |
| Ana ekrandan dosyaya en çok tıklama (masaüstü / telefon) | 4 / 5 |
| Varsayılan yolda görülen, teknik terim içeren farklı cümle | 8 |
| Arama: ilk sonuç doğru / ilk üçte / yanlış ama emin | %87,8 / %91,7 / %10 |
| Hata hücreleri: iyi / belirsiz / bozuk | 44 / 29 / 0 |
| İlerleme çubuğu geri gitti (kez) · iptalden sonra kalan bayt | 0 · 0 |
| Eklenen ses–görüntü sapması (en kötü) · süre hatası (en kötü) | 1 ms · 16 ms |
| Görüntü sadakati, en düşük: SSIM · VMAF | 0,9658 · 84,6 |
| Küçült → WhatsApp hedefe sığdı | evet |
| Ana ekran: LCP (mobil kısıtlama) · aktarılan JS | 620 ms · 193 KB |
| En yavaş yeniden işleme hızı | 1,9 × gerçek zaman |
| Tabanından farklı ekran | 0 |
| Telefonda 44 px’ten küçük dokunma hedefi · adsız kontrol | 16 · 0 |
| Okunabilirlik (varsayılan yol): ortanca Ateşman · zor metin payı | 79,4 · %2,2 |

**Bütçe dışı ölçüler** (34)


| Ölçü | Değer | Bütçe |
| --- | --- | --- |
| Küçült (masaüstü): dosya çıktı ve doğru | hayır | = evet |
| Küçült (masaüstü): teknik terim | 4 | ≤ 0 |
| Küçült (masaüstü): konsol / sayfa hatası | 1 | ≤ 0 |
| Müzik ekle (masaüstü): teknik terim | 1 | ≤ 0 |
| Sesini al (masaüstü): teknik terim | 1 | ≤ 0 |
| Sesi kapat (masaüstü): teknik terim | 1 | ≤ 0 |
| Her yerde açılsın (masaüstü): teknik terim | 3 | ≤ 0 |
| Küçült (telefon): dosya çıktı ve doğru | hayır | = evet |
| Küçült (telefon): teknik terim | 4 | ≤ 0 |
| Küçült (telefon): konsol / sayfa hatası | 1 | ≤ 0 |
| Müzik ekle (telefon): teknik terim | 1 | ≤ 0 |
| Sesini al (telefon): teknik terim | 1 | ≤ 0 |
| Sesi kapat (telefon): teknik terim | 1 | ≤ 0 |
| Her yerde açılsın (telefon): teknik terim | 3 | ≤ 0 |
| Yanlış ama emin: ilk sonuç başka iş yapan bir kart (bütün ifadelerde) | %10 | ≤ %5 |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) | %60 | ≥ %80 |
| Belirsiz hücre | 29 | ≤ 0 |
| Dizini (moov) sonda olan dosya — “faststart” değil | 10 / 10 | ≤ 0 |
| Editör, mobil kısıtlama: TBT | 256 ms (240–280) | ≤ 200 ms |
| Sihirbaz, mobil kısıtlama: TBT | 209 ms (197–218) | ≤ 200 ms |
| Ana ekran, arama sonucu (“sessiz yerleri sil”) (telefon): 44 px’ten küçük dokunma hedefi | 1 | ≤ 0 |
| Ana ekran, “Bunu bulamadım.” (telefon): 44 px’ten küçük dokunma hedefi | 1 | ≤ 0 |
| Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”) (telefon): 44 px’ten küçük dokunma hedefi | 1 | ≤ 0 |
| Ana ekran (telefon): 44 px’ten küçük dokunma hedefi | 1 | ≤ 0 |
| Editör, video yok (telefon): 44 px’ten küçük dokunma hedefi | 5 | ≤ 0 |
| Editör, video yok (telefon): 24 px’ten küçük hedef | 1 | ≤ 0 |
| Editör, video ve bir kesit (telefon): 44 px’ten küçük dokunma hedefi | 7 | ≤ 0 |
| Editör, video ve bir kesit (telefon): 24 px’ten küçük hedef | 1 | ≤ 0 |
| Editör, video ve bir kesit (telefon): 12 px’ten küçük yazılmış kelime | 11 | ≤ 0 |
| Editör, video yok (masaüstü): 24 px’ten küçük hedef | 1 | ≤ 0 |
| Editör, video yok (masaüstü): 12 px’ten küçük yazılmış kelime | 2 | ≤ 0 |
| Editör, video ve bir kesit (masaüstü): 24 px’ten küçük hedef | 1 | ≤ 0 |
| Editör, video ve bir kesit (masaüstü): 12 px’ten küçük yazılmış kelime | 21 | ≤ 0 |
| Varsayılan yol (ana ekran, kartlar, sihirbazlar, yazıya dökme, indirme, hata): “çok zor” metin | 1 | ≤ 0 |

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
| Kes | evet | 4 | 2 | 1 | 3 | 152 | 284 | 2,5 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 3 | 0 | 1 | 4 | 109 | 239 | 1,4 sn | 0 | 0 | 0 |
| Dikey yap | evet | 3 | 0 | 1 | 4 | 109 | 230 | 3,3 sn | 0 | 0 | 0 |
| Küçült | **hayır** (bütçe = evet) | 3 | 0 | 1 | 4 | 109 | 290 | 2,4 sn | **4** (bütçe ≤ 0) | 0 | **1** (bütçe ≤ 0) |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 109 | 200 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 4 | 0 | 1 | 4 | 109 | 231 | 2,4 sn | **1** (bütçe ≤ 0) | 0 | 0 |
| Sesini al | evet | 3 | 0 | 0 | 4 | 109 | 231 | 1,3 sn | **1** (bütçe ≤ 0) | 0 | 0 |
| Sesi kapat | evet | 3 | 0 | 0 | 4 | 109 | 224 | 0,8 sn | **1** (bütçe ≤ 0) | 0 | 0 |
| Her yerde açılsın | evet | 3 | 0 | 0 | 4 | 109 | 235 | 1,3 sn | **3** (bütçe ≤ 0) | 0 | 0 |
| İyileştir | evet | 3 | 0 | 1 | 4 | 136 | 326 | 4,5 sn | 0 | 0 | 0 |

Notlar (masaüstü (1440 × 900)):

- **Küçült:** dosya kaydedildi ama kartın söz verdiği gibi değil (denetimlere bak)
  - denetim tutmadı — dosya kaynaktan küçük: 24,74 MB → 24,73 MB
  - denetim tutmadı — WhatsApp sınırına (16 MB) sığıyor: 24,73 MB
- **Küçült:** konsol: `An AudioSample was garbage collected without first being closed. For proper resource management, make sure to call close() on all your AudioSamples as soon as you're done using them.`
- **Yazıya dök:** “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**telefon (390 × 844, dokunmatik)**

| Görev | Dosya çıktı ve doğru | Tıklama | Yazılan alan | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Toplam kelime | Karttan dosyaya | Teknik terim | Adıyla bulunamayan | Konsol hatası |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kes | evet | 5 | 2 | 1 | 3 | 109 | 228 | 2,5 sn | 0 | 0 | 0 |
| Boşlukları at | evet | 4 | 0 | 1 | 4 | 109 | 252 | 1,4 sn | 0 | 0 | 0 |
| Dikey yap | evet | 4 | 0 | 1 | 4 | 109 | 242 | 3,4 sn | 0 | 0 | 0 |
| Küçült | **hayır** (bütçe = evet) | 4 | 0 | 1 | 4 | 109 | 302 | 1,9 sn | **4** (bütçe ≤ 0) | 0 | **1** (bütçe ≤ 0) |
| Yazıya dök | ölçülemedi | 2 | 0 | 1 | 3 | 109 | 196 | ölçülemedi | 0 | 0 | 0 |
| Müzik ekle | evet | 5 | 0 | 1 | 4 | 109 | 244 | 2,4 sn | **1** (bütçe ≤ 0) | 0 | 0 |
| Sesini al | evet | 4 | 0 | 0 | 4 | 109 | 243 | 1,4 sn | **1** (bütçe ≤ 0) | 0 | 0 |
| Sesi kapat | evet | 4 | 0 | 0 | 4 | 109 | 236 | 0,8 sn | **1** (bütçe ≤ 0) | 0 | 0 |
| Her yerde açılsın | evet | 4 | 0 | 0 | 4 | 109 | 248 | 1,4 sn | **3** (bütçe ≤ 0) | 0 | 0 |
| İyileştir | evet | 4 | 0 | 1 | 4 | 136 | 340 | 4,6 sn | 0 | 0 | 0 |

Notlar (telefon (390 × 844, dokunmatik)):

- **Küçült:** dosya kaydedildi ama kartın söz verdiği gibi değil (denetimlere bak)
  - denetim tutmadı — dosya kaynaktan küçük: 24,74 MB → 24,73 MB
  - denetim tutmadı — WhatsApp sınırına (16 MB) sığıyor: 24,73 MB
- **Küçült:** konsol: `An AudioSample was garbage collected without first being closed. For proper resource management, make sure to call close() on all your AudioSamples as soon as you're done using them.`
- **Yazıya dök:** “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi.

**Varsayılan yolda görülen teknik terimler** (Ayarlar ve Ayrıntılar açılmadan; liste: `web/tests/quality/lib/jargon.ts`)

| Terim | Ekrandaki cümle | Nerede |
| --- | --- | --- |
| H.264 / H.265 / HEVC / AVC | “iPhone, HEVC ya da HDR videolar her cihazda açılan MP4 olur.” | Her yerde açılsın (seçim) |
| HDR / SDR | “iPhone, HEVC ya da HDR videolar her cihazda açılan MP4 olur.” | Her yerde açılsın (seçim) |
| H.264 / H.265 / HEVC / AVC | “Görüntü yeniden işlendi (kaynak H.264 MP4/MOV değil)” | Her yerde açılsın (sonuç) |
| 720p / 1080p | “≈ 13,2 MB · 720p · kalite düşmeden sığıyor” | Küçült (seçim) |
| çözünürlük | “Küçük dosya için görüntü biraz sadeleşir, gerekirse çözünürlük düşer.” | Küçült (seçim) |
| kodlama / encode | “Orijinal görüntü zaten sığıyordu; yeniden kodlanmadı.” | Küçült (sonuç) |
| kodlama / encode | “Hızlı kesim — görüntü yeniden kodlanmadı, orijinal kalite” | Küçült (sonuç); Sesi kapat (sonuç) |
| çözünürlük | “Görüntü yeniden işlendi (çözünürlük kaynağınkinden farklı)” | Müzik ekle (sonuç) |
| AAC / Opus / VP9 | “Yalnızca ses: AAC, M4A dosyası.” | Sesini al (sonuç) |

Yarı teknik (sayıldı, yargılanmadı): MP4 / MOV / WebM × 67 · 9:16 / 1080 × 1920 × 2 · MB / GB × 24 · M4A / MP3 / WAV × 7 · model × 6

**Çıkan dosyalar** (ffprobe)

| Görev | Görünüm | Kaynak | Dosya | Süre | İzler | Denetimler |
| --- | --- | --- | --- | --- | --- | --- |
| Kes | masaüstü | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 1.506 KB, 1920 × 1080 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.505.834 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Kes | telefon | sample-24s.mp4 (1280 × 720, 24 sn); 2–5. saniyeler istenir | 1.506 KB, 1920 × 1080 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.505.834 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Boşlukları at | masaüstü | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 73 KB, 1280 × 720 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (72.684 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Boşlukları at | telefon | bursts.mp4 (4,5 sn, içinde 1,2 sn’lik bir sessizlik) | 73 KB, 1280 × 720 | 3,61 sn | video:h264 + audio:aac | tuttu: dosya boş değil (72.690 bayt); tuttu: süre ≈ 3,6 sn (3,605 sn); tuttu: kaynaktan kısa (4,5 → 3,61 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | masaüstü | other-8s.mp4 (640 × 360 yatay, 8 sn) | 2.919 KB, 1080 × 1920 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.918.617 bayt); tuttu: 1080 × 1920 (1080 × 1920); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Dikey yap | telefon | other-8s.mp4 (640 × 360 yatay, 8 sn) | 2.919 KB, 1080 × 1920 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.918.617 bayt); tuttu: 1080 × 1920 (1080 × 1920); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Küçült | masaüstü | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 24.731 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (24.731.343 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); **TUTMADI**: dosya kaynaktan küçük (24,74 MB → 24,73 MB); **TUTMADI**: WhatsApp sınırına (16 MB) sığıyor (24,73 MB) |
| Küçült | telefon | noisy-720p30-14s.mp4 (yaklaşık 25 MB, 14 sn); seçim değiştirilmeden | 24.731 KB, 1280 × 720 | 14,02 sn | video:h264 + audio:aac | tuttu: dosya boş değil (24.731.343 bayt); tuttu: süre ≈ 14 sn (14,016 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); **TUTMADI**: dosya kaynaktan küçük (24,74 MB → 24,73 MB); **TUTMADI**: WhatsApp sınırına (16 MB) sığıyor (24,73 MB) |
| Yazıya dök | masaüstü | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Yazıya dök | telefon | sample-24s.mp4; yayınlanan derleme, model dosyaları bu makinede yok | — | — | — | — |
| Müzik ekle | masaüstü | other-8s.mp4 + tone-30s.m4a | 2.332 KB, 1280 × 720 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.332.338 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Müzik ekle | telefon | other-8s.mp4 + tone-30s.m4a | 2.328 KB, 1280 × 720 | 8 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.327.753 bayt); tuttu: süre ≈ 8 sn (8 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac) |
| Sesini al | masaüstü | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesini al | telefon | sample-24s.mp4 | 390 KB | 24 sn | audio:aac | tuttu: dosya boş değil (389.662 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: audio:aac (audio:aac) |
| Sesi kapat | masaüstü | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Sesi kapat | telefon | sample-24s.mp4 | 262 KB, 1280 × 720 | 24 sn | video:h264 | tuttu: dosya boş değil (262.213 bayt); tuttu: süre ≈ 24 sn (24 sn); tuttu: izler: video:h264 (video:h264) |
| Her yerde açılsın | masaüstü | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 1.827 KB, 1280 × 720 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.826.537 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| Her yerde açılsın | telefon | tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn) | 1.824 KB, 1280 × 720 | 2,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (1.824.229 bayt); tuttu: süre ≈ 2 sn (2,005 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: MP4 (mov,mp4,m4a,3gp,3g2,mj2) |
| İyileştir | masaüstü | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.824 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.823.652 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |
| İyileştir | telefon | karanlik.mp4 (yaklaşık iki durak karanlık, 1280 × 720, 3 sn) | 2.819 KB, 1280 × 720 | 3,01 sn | video:h264 + audio:aac | tuttu: dosya boş değil (2.819.476 bayt); tuttu: süre ≈ 3 sn (3,008 sn); tuttu: izler: video:h264 + audio:aac (video:h264 + audio:aac); tuttu: görüntü aydınlandı (ortalama parlaklık en az +10) (69,8 → 121); tuttu: boyut aynı (1280 × 720) |

**Yazıya dök, baştan sona — TEST KANCALI derleme, betikli tanıyıcı**
Bu satırlar `CLIP_TEST_HOOKS=1` derlemesinde, küçük bir model listesi ve konuşmayı DUYMAYAN betikli bir tanıyıcıyla alındı. Ölçülen şey akıştır (tıklama, ekran, kelime, dosyanın çıkması). **Yazının doğruluğu hakkında hiçbir şey söylemez** (bkz. bölüm 6).


| Görünüm | Dosya çıktı | Tıklama | Karar ekranı | Ekran | En kalabalık ekran (kelime) | Karttan dosyaya | Teknik terim | Adıyla bulunamayan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| masaüstü | evet | 5 | 1 | 4 | 109 | 4,9 sn (model 360 KB’lık test dosyası) | 0 | 0 |
| telefon | evet | 6 | 1 | 4 | 109 | 4,9 sn (model 360 KB’lık test dosyası) | 0 | 0 |

## 2. Arama kalitesi

Ayrı tutulan küme: `web/tests/quality/data/search-eval.ts` içindeki `HELD_OUT` — 282 ifade; bunlardan 42 tanesi arama listelerinin üzerinde ayarlandığı tablolarda (`tests/unit/taskSearch*.test.ts`) zaten bulunduğu için **sayılmadı**; sayılan 240. Arama bu küme üzerinde ayarlanmadı ve bu çalışmada değiştirilmedi; kaçanlar aşağıda bulgu olarak duruyor.


| Ölçü | Değer | Bütçe | Durum |
| --- | --- | --- | --- |
| İlk sonuç doğru (yapılabilen işler) — 180 ifadede | %87,8 | ≥ %85 | bütçe içinde |
| İlk üç sonuçta var | %91,7 | ≥ %90 | bütçe içinde |
| Yanlış ama emin: ilk sonuç başka iş yapan bir kart (bütün ifadelerde) — 240 ifadede | %10 | ≤ %5 | BÜTÇE DIŞI |
| Yapılabilen işe “Bunu bulamadım.” | %2,8 | — | bütçesiz |
| Yapılabilen işe “Bunu henüz yapamıyoruz.” | %0 | ≤ %0 | bütçe içinde |
| “Bunu henüz yapamıyoruz.” — yakalama (recall) — 30 ifadede | %100 | ≥ %95 | bütçe içinde |
| “Bunu henüz yapamıyoruz.” — isabet (precision) — 33 kez söylendi | %100 | ≥ %95 | bütçe içinde |
| Listede hiç olmayan isteğe dürüst cevap (yapamıyoruz ya da bulamadım) — 15 ifadede; 6 tanesine kart önerildi | %60 | ≥ %80 | BÜTÇE DIŞI |
| Anlamsız yazı / sohbete kart önerilmedi — 15 ifadede | %93,3 | ≥ %90 | bütçe içinde |

**İşe göre** (ilk sonuç)

| İş | İfade | İlk sonuç doğru | İlk üçte | Yanlış ama emin | Bulunamadı |
| --- | --- | --- | --- | --- | --- |
| Kes | 21 | 17 (%81) | 18 | 3 | 1 |
| Boşlukları at | 20 | 14 (%70) | 15 | 4 | 2 |
| Dikey yap | 21 | 20 (%95,2) | 21 | 1 | 0 |
| Küçült | 22 | 21 (%95,5) | 21 | 1 | 0 |
| Yazıya dök | 16 | 14 (%87,5) | 14 | 1 | 1 |
| Müzik ekle | 15 | 14 (%93,3) | 15 | 1 | 0 |
| Sesini al | 17 | 14 (%82,4) | 16 | 3 | 0 |
| Sesi kapat | 14 | 11 (%78,6) | 12 | 3 | 0 |
| Her yerde açılsın | 16 | 15 (%93,8) | 15 | 0 | 1 |
| İyileştir | 18 | 18 (%100) | 18 | 0 | 0 |

**Yazış biçimine göre** (ilk sonuç; bir ifade birden çok satırda sayılır)

| Biçim | İfade | İlk sonuç doğru |
| --- | --- | --- |
| Türkçe | 119 | 105 (%88,2) |
| argo / kısaltma | 14 | 9 (%64,3) |
| uzun cümle | 20 | 12 (%60) |
| yazım hatalı | 7 | 7 (%100) |
| Türkçe harfsiz | 7 | 7 (%100) |
| İngilizce | 61 | 53 (%86,9) |

**Kaçanlar** (29) — ifade → beklenen → çıkan

| İfade | Beklenen | Çıkan | Tür |
| --- | --- | --- | --- |
| “ilk 30 saniye gitsin” | Kes | Bunu bulamadım. | bulunamadı |
| “sadece gol anını al” | Kes | Sesini al | **yanlış ama emin** |
| “i only want the first minute” | Kes | Sesini al | **yanlış ama emin** |
| “chop the end off” | Kes | Sesi kapat (+ Kes) | **yanlış ama emin** |
| “videodaki ölü anları temizle” | Boşlukları at | Bunu bulamadım. | bulunamadı |
| “susunca kessin” | Boşlukları at | İyileştir | **yanlış ama emin** |
| “sessizlikleri otomatik kes” | Boşlukları at | Kes (+ Boşlukları at) | **yanlış ama emin** |
| “nefes aralarını at” | Boşlukları at | Kes | **yanlış ama emin** |
| “skip the parts where nobody talks” | Boşlukları at | Kes | **yanlış ama emin** |
| “tighten up my talking video” | Boşlukları at | Bunu bulamadım. | bulunamadı |
| “tiktoka atıcam boyutu ayarla” | Dikey yap | Küçült (+ Dikey yap) | **yanlış ama emin** |
| “wp den atamıyorum” | Küçült | Her yerde açılsın (+ İyileştir) | **yanlış ama emin** |
| “sözleri yazdır” | Yazıya dök | Bunu bulamadım. | bulunamadı |
| “write down what is said” | Yazıya dök | Küçült | **yanlış ama emin** |
| “i want to add my own mp3 to the video” | Müzik ekle | Sesini al (+ Müzik ekle) | **yanlış ama emin** |
| “müziğini almak istiyorum” | Sesini al | Müzik ekle | **yanlış ama emin** |
| “şarkıyı videodan al” | Sesini al | Müzik ekle (+ Sesini al) | **yanlış ama emin** |
| “mp3e çevir” | Sesini al | Her yerde açılsın (+ Sesini al) | **yanlış ama emin** |
| “ses hiç olmasın istiyorum” | Sesi kapat | Sesini al | **yanlış ama emin** |
| “sesi kapa” | Sesi kapat | Sesini al (+ Sesi kapat) | **yanlış ama emin** |
| “silence the video” | Sesi kapat | Boşlukları at | **yanlış ama emin** |
| “make it work on any device” | Her yerde açılsın | Bunu bulamadım. | bulunamadı |
| “sesimi kadın sesi yap” | kart önerilmemesi | Sesini al | **yanlış ama emin** |
| “videoya emoji ekle” | kart önerilmemesi | Müzik ekle | **yanlış ama emin** |
| “başlık yazısı ekle” | kart önerilmemesi | Yazıya dök (+ Müzik ekle) | **yanlış ama emin** |
| “canlı yayın yap” | kart önerilmemesi | İyileştir | **yanlış ama emin** |
| “ekran kaydı al” | kart önerilmemesi | Dikey yap (+ Sesini al) | **yanlış ama emin** |
| “youtubedan video indir” | kart önerilmemesi | Dikey yap | **yanlış ama emin** |
| “bugün hava çok güzel” | kart önerilmemesi | İyileştir | **yanlış ama emin** |

Geliştirme kümesi (`DEV`, ayar yapılırken kullanılabilir; başlık sayısı değildir): 26 ifade, ilk sonuç %100, yanlış ama emin %7,7, kaçan 2 (“videoyu çevir yan duruyor” → Dikey yap (+ Her yerde açılsın); “ekran kaydı” → Dikey yap).

## 3. Hata yolları

Her sihirbaza sekiz tür sorunlu dosya verildi; ekranda görülen metin kelimesi kelimesine kaydedildi. Derleme: yayınlanan statik çıktı, masaüstü görünümü (mesajları aynı bileşenler üretir; telefonda ayrıca koşulmadı). Sınır üstü iki durumda dosyanın boyutu ve süresi yalnızca test sayfasının içinde büyük gösterildi; uygulamanın kendi denetimi değişmeden çalıştı.

**iyi** = ne olduğunu ve ne yapılacağını söylüyor, ilerleme / geri dönüş var, takılma ve sayfa hatası yok · **belirsiz** = mesaj var ama ne yapılacağını söylemiyor ya da teknik terim içeriyor; ya da sorunlu dosya uyarısız işlendi · **bozuk** = mesaj da ilerleme de yok, bitmeyen bekleme, donan sayfa, sayfa hatası · **ölçülemedi** = bu makinede denenemedi (nedeni tabloda) · **—** = bu iş için hata değil.


|  | Hücre | Bütçe | Durum |
| --- | --- | --- | --- |
| İyi | 44 | — | bütçesiz |
| Belirsiz | 29 | ≤ 0 | BÜTÇE DIŞI |
| Bozuk | 0 | ≤ 0 | bütçe içinde |
| Ölçülemeyen | 1 | ≤ 1 | bütçe içinde |
| Sayfanın yanıt vermediği en uzun süre | 0 sn | ≤ 3 sn | bütçe içinde |
| Sayfa hatası görülen hücre | 0 | ≤ 0 | bütçe içinde |
| Konsol hatası görülen hücre | 10 | — | bütçesiz |

**Tablo** (satır: dosya, sütun: sihirbaz)

| Dosya | Kes | Boşlukları at | Dikey yap | Küçült | Yazıya dök | Müzik ekle | Sesini al | Sesi kapat | Her yerde açılsın | İyileştir |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Video olmayan dosya (.txt) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Sıfır baytlık .mp4 | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| İçi rastgele bayt olan .mp4 | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Yarıda kesilmiş MP4 (baytların %55’i) | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | ölçülemedi | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** |
| Yalnızca ses dosyası (.m4a) | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi | iyi |
| Sesi olmayan video | — | iyi | — | — | iyi | — | iyi | iyi | — | — |
| Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB) | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** |
| Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika) | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** | **belirsiz** |

**Ekranda görülen metinler**

| Dosya | Sihirbaz | Yargı | Ekrandaki metin | Neden | Cevap süresi |
| --- | --- | --- | --- | --- | --- |
| Video olmayan dosya (.txt) | hepsi | iyi | ““notlar.txt” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| Sıfır baytlık .mp4 | hepsi | iyi | ““bos.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| İçi rastgele bayt olan .mp4 | hepsi | iyi | ““bozuk.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,3 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | Boşlukları at | belirsiz | “İndir’e basınca (kaydedildi): Kaydedildi: saved-yarim-inmis_bosluksuz.mp4 Kaydetme penceresinde seçtiğin klasörde. Görüntü yeniden işlendi (kaynağın zaman damgaları uygun değil)” | yarım dosyadan uyarısız bir dosya kaydedildi (ekranda gösterilen süre 24,0 sn, kaydedilen 12,5 sn; dosyanın son bölümünün ses düzeyi -22,3 dB) | 0,2 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | Her yerde açılsın, Dikey yap, İyileştir, Kes, Küçült, Müzik ekle, Sesi kapat | belirsiz | “İndir’e basınca (hata): Çıktı alınamadı. Bu tarayıcı videonun bazı karelerini çözemedi. Eksik karelerle bozuk bir dosya üretmek yerine durduruldu. Chrome veya Edge ile dene.” | sorun dosyada (yarım), mesaj tarayıcıyı gösteriyor ve başka tarayıcı öneriyor: yanlış yöne gönderir | 0,5 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | Sesini al | belirsiz | “İndir’e basınca (kaydedildi): Ses dosyası kaydedildi: saved-yarim-inmis_ses.m4a Kaydetme penceresinde seçtiğin klasörde. Yalnızca ses: AAC, M4A dosyası. Görüntü yok.” | yarım dosyadan uyarısız bir dosya kaydedildi (ekranda gösterilen süre 24,0 sn, kaydedilen 24 sn; dosyanın son bölümünün ses düzeyi -91 dB (sessizlik)) | 0,3 sn |
| Yarıda kesilmiş MP4 (baytların %55’i) | Yazıya dök | ölçülemedi | (metin yok) | yarım dosya açıldı; yazıya dökme model dosyaları bu makinede olmadığı için denenemedi | 0,3 sn |
| Yalnızca ses dosyası (.m4a) | hepsi | iyi | ““tone-30s.m4a” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.” | ne olduğunu ve ne yapılacağını söylüyor | 0,2 sn |
| Sesi olmayan video | Her yerde açılsın, Dikey yap, İyileştir, Kes, Küçült | geçerli değil | (metin yok) | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,3 sn |
| Sesi olmayan video | Müzik ekle | geçerli değil | “Önce müziğini seç.” | bu iş videonun sesine ihtiyaç duymaz; video açıldı | 0,2 sn |
| Sesi olmayan video | Boşlukları at | iyi | “Bu videoda ses yok; sessizlik aranamaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesini al | iyi | “Bu videoda ses yok; kaydedilecek bir ses dosyası çıkmaz.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Sesi kapat | iyi | “Bu videoda zaten ses yok; kapatılacak bir şey yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sesi olmayan video | Yazıya dök | iyi | “Bu videoda ses yok; yazıya dökülecek bir konuşma yok.” | ses olmadığını söylüyor; indirme kapalı; geri dönüş ve başka video seçme var | 0,2 sn |
| Sınırın üstünde dosya (5 GiB gibi gösterildi; sınır 4 GiB) | hepsi | belirsiz | ““kalite-cok-buyuk.mp4” açılamadı: dosya 5,37 GB; bu sürümün sınırı 4,29 GB.” | ne olduğunu söylüyor, ne yapılacağını söylemiyor (ekrandaki düğmeler: Geri, Ana ekrana dön, Video seç Dosyalarından seç ya da videoyu buraya sürükleyip bırak, Uyarıyı kapat) | 0 sn |
| Sınırın üstünde süre (3 saat gibi gösterildi; sınır 120 dakika) | hepsi | belirsiz | ““kalite-cok-uzun.mp4” açılamadı: video bu sürümdeki 120 dakika sınırının üzerinde.” | ne olduğunu söylüyor, ne yapılacağını söylemiyor (ekrandaki düğmeler: Geri, Ana ekrana dön, Video seç Dosyalarından seç ya da videoyu buraya sürükleyip bırak, Uyarıyı kapat) | 0,3 sn |

**Konsola düşen hatalar** (aynı satır bir kez)

- 10 hücrede: `Failed to load resource: net::ERR_REQUEST_RANGE_NOT_SATISFIABLE`

## 4. Dürüstlük denetimleri

**İlerleme çubuğu ve “Kaydedildi”** — “İndir”e basıştan sonuca kadar 40 ms’de bir örneklendi (masaüstü, statik çıktı).


| Senaryo | Sonuç | Örnek / farklı değer | İlk → son | Geri gitti | Geçiş arasında geri gitti | %100’de bekleme | “Kaydedildi” anında dosya | Dosyasız başarı |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dikey yap: 12 sn’lik 1920 × 1080 video yeniden işlenir | saved | 141 / 21 | %0 → %100 | 0 kez | 0 kez | 40 ms | 25.269 KB, 12,01 sn, video:h264 + audio:aac | hayır |
| İyileştir: ışığı değişen 10 sn’lik video | saved | 200 / 29 | %0 → %100 | 0 kez | 0 kez | 40 ms | 9.435 KB, 10,01 sn, video:h264 + audio:aac | hayır |
| Küçült → WhatsApp: yaklaşık 24 MB’lık video 16 MB’ın altına iner | saved | 127 / 19 | %0 → %97 | 0 kez | 0 kez | 0 ms | 15.474 KB, 12,01 sn, video:h264 + audio:aac | hayır |

Kaydetme penceresi olmayan yol (telefon, Firefox, Safari): “hazır” dendiğinde bağlantının arkasındaki dosya 1.825 KB; dosyasız başarı: hayır (bütçe içinde).

**İptal** — 24 sn’lik video dikey yapılırken, ilerleme %3’ü geçince “İptal et”e basıldı.


| Yol | Durdu | Durma süresi | Ekrandaki metin | İş sürerken sayfa deposunda | İptalden 4 sn sonra kalan | Kalan bayt | İptalden sonra “kaydedildi” |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kaydetme penceresiz (telefon, Firefox, Safari) | evet | 72 ms | “İndirme durduruldu; yarım dosya bırakılmadı.” | clip-export-exp_mv2jcoax_2.mp4 (89.404 KB) | hiçbir şey | 0 | hayır |
| kaydetme pencereli (Chrome / Edge) | evet | 121 ms | “İndirme durduruldu; yarım dosya bırakılmadı.” | saved-sample-24s_dikey.mp4.crswap (89.404 KB), saved-sample-24s_dikey.mp4 (0 KB) | hiçbir şey | 0 | hayır |

Not: kaydetme pencereli yolda testin “kaydetme penceresi” kullanıcının seçtiği dosya yerine sayfa deposunda bir dosya verir. İptalden sonra o dosyanın 0 bayt olarak kalması, gerçek pencerede kullanıcının seçtiği adda boş bir dosya kalması demektir; bayt kalması yarım dosya demektir.

**e2e paketinin zaten kanıtladıkları** (burada yeniden ölçülmedi; test adı dosyada arandı)


| Ne | Test | Dosya | Atıf |
| --- | --- | --- | --- |
| İptal: kaydetme penceresinde seçilen adda dosya kalmaz | “cancel while encoding leaves no file under the chosen name” | `web/tests/e2e/kesit.spec.ts` | dosyada var |
| İptal: kaydetme penceresi olmayan yolda geçici dosya kalmaz | “a canceled download leaves no temporary file behind” | `web/tests/e2e/editor.spec.ts` | dosyada var |
| Sihirbazda iptal: çıkmadan önce sorar, “İptal et” durdurur, “Kaydedildi” görünmez | “leaving while the video is being prepared asks first; “İptal et” stops it and leaves no file” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Kaydetme penceresini kapatmak hiçbir şey yapmaz ve hiçbir şey söylemez | “closing the save dialog does nothing and says nothing” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Sığmayan hedef: indirme kapalı, hiçbir şey yazılmaz | “a video that cannot fit: the option says the smallest size, İndir stays off, nothing is written” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Uygulamanın söylediği boyut dosyanın gerçek boyutudur (Küçült) | “one choice, each option says its outcome first; WhatsApp: the saved file is under 16 MB and says its real size” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Sesi olmayan video: başarı yok, kaydetme penceresi yok, dosya yok | “a video without sound: said on the step, İndir stays off, no save dialog, nothing written” | `web/tests/e2e/wizards.spec.ts` | dosyada var |
| Değiştirecek bir şey yoksa indirme sunulmaz (İyileştir) | “a video with nothing to fix is told so: no download that would change nothing, no save dialog” | `web/tests/e2e/enhance.spec.ts` | dosyada var |
| Disk dolarsa dürüst hata; yarım dosya silinir | “a disk that fills up mid-file ends in an honest failure; the partial file is deleted” | `web/tests/e2e/output-limits.spec.ts` | dosyada var |
| Seçilen dosya diski doldurursa: dürüst hata, o adda yarım dosya yok | “the picked file fills the disk mid-file: an honest failure, no half file under its name” | `web/tests/e2e/output-limits.spec.ts` | dosyada var |
| Sınırı aşan çıktı, tek kare kodlanmadan reddedilir | “a kesit, the joined kesitler and the whole video over 60 minutes are refused before encoding” | `web/tests/e2e/kesit.spec.ts` | dosyada var |
| Sessizlik aramasının ilerlemesi gerçektir ve durdurulabilir | “a long analysis shows real progress and can be stopped” | `web/tests/e2e/silence.spec.ts` | dosyada var |
| Yazıya dökmeyi durdurmak geride hiçbir şey bırakmaz; hata söylenir | “stopping a transcription keeps nothing; a failure is said and can be retried” | `web/tests/e2e/transcript.spec.ts` | dosyada var |
| Bozuk inen model dosyası reddedilir, silinir, kullanılmaz | “a damaged file is refused, deleted and never used; a clean retry works” | `web/tests/e2e/transcript.spec.ts` | dosyada var |

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
| Küçült (seçim değişmeden), senkron klibi (VP9 WebM) | yeniden işlendi | 12,01 → 12,011 sn | 3 ms | 37 / 37 | 0,1 ms (0,08 … 0,1) | 0 ms | 10 denetimin hepsi tuttu |

**Görüntü sadakati** — aynı düzenlemenin yalnızca ffmpeg ile yapılmış, kayıpsız referansına karşı; kamera benzeri ÜRETİLMİŞ video (gerçek çekim değil).


| Durum | Yol | Çıktı | Karşılaştırma boyutu | SSIM | PSNR | VMAF | Süre hatası | Hedef boyut | Her yerde açılır (dizin yeri hariç) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Her yerde açılsın, kamera benzeri 720p VP9 WebM | yeniden işlendi | 1280 × 720, 5,7 MB | 1280 × 720 | 0,9766 | 42,6 dB | 84,7 | 8 ms | — | 10 denetimin hepsi tuttu |
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 1080 × 1920, 25,3 MB | 1080 × 1920 | 0,9823 | 45,56 dB | 84,6 | 11 ms | — | 10 denetimin hepsi tuttu |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma (kesim yerleri yeniden işlendi, arası kopya) | 1920 × 1080, 6,7 MB | 1920 × 1080 | 0,9978 | 55,19 dB | 99,2 | 8 ms | — | 10 denetimin hepsi tuttu |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 1920 × 1080, 15,5 MB | 1920 × 1080 | 0,9658 | 42,84 dB | 87,3 | 11 ms | 15,5 MB / 16 MB: sığdı: evet; hedefin kullanılan payı %96,7 (kaynak 24,3 MB) | 10 denetimin hepsi tuttu |

**Dizin başta mı (faststart)?** Dizini dosyanın sonunda olan: 10 / 10 dosya (BÜTÇE DIŞI, bütçe ≤ 0). Dizin sondaysa dosya indirilirken ya da bir sayfaya gömülüyken tamamı gelmeden oynatılamaz; yerel oynatmayı etkilemez. Yukarıdaki “her yerde açılır” sütunu bu denetimi saymaz.

**İyileştir** — ADR-037’nin ölçüleri (`web/tests/e2e/enhance-media.ts`: ortalama parlaklık, Laplace varyansı), üretilmiş dört video üzerinde.


| Video | Uygulamanın dediği | İndirme sunuldu | Parlaklık önce → sonra | Keskinlik önce → sonra | Eklenen en büyük parlaklık sıçraması | Kare |
| --- | --- | --- | --- | --- | --- | --- |
| karanlık | “Yapılacaklar: video belirgin biçimde aydınlatılır, renkler toparlanır.” | evet | 69,2 → 120 (+50,8) | 50,7 → 109,2 | 0,15 | 90 / 90 |
| bulanık | “Yapılacaklar: renkler toparlanır, kenarlar keskinleştirilir.” | evet | 140,3 → 141,6 | 24,7 → 28,3 (× 1,15) | 0,05 | 90 / 90 |
| kumlu | “Yapılacaklar: ışık ve kontrast biraz düzeltilir, renkler toparlanır, kumlanma azaltılır.” | evet | 104,8 → 119,1 | 373,9 → 117,8 | 0,17 | 90 / 90 |
| iyi (doğru pozlanmış, keskin) | “Yapılacaklar: renkler toparlanır.” | evet | 140,3 → 141,7 (1,4 kaydı) | 198 → 176,6 (× 0,89) | 0,11 | 90 / 90 |

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
| Ana ekran `/` | bu makine | 193 KB (8 dosya) | 202 KB | 88 ms | 88 ms (84–100) | 0 ms | 120 ms | 2,6 MB | 0 |
| Ana ekran `/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 193 KB (8 dosya) | 202 KB | 620 ms | 620 ms (616–620) | 145 ms (130–154) | 1.539 ms | 2,6 MB | 0 |
| Editör `/editor/` | bu makine | 421 KB (14 dosya) | 504 KB | 120 ms | 120 ms (116–124) | 0 ms | 152 ms | 4,1 MB | 0 |
| Editör `/editor/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 421 KB (14 dosya) | 504 KB | 836 ms | 836 ms (816–840) | **256 ms (240–280)** (bütçe ≤ 200 ms) | 1.900 ms | 4,1 MB | 0 |
| Sihirbaz `/yap/dikey/` | bu makine | 422 KB (14 dosya) | 438 KB | 68 ms | 68 ms (64–72) | 0 ms | 116 ms | 3,5 MB | 0 |
| Sihirbaz `/yap/dikey/` | mobil kısıtlama (150 ms, 1,6 Mbit/s, 4× yavaş CPU) | 422 KB (14 dosya) | 438 KB | 624 ms | 624 ms (620–632) | **209 ms (197–218)** (bütçe ≤ 200 ms) | 1.978 ms | 3,5 MB | 0 |

**Bellek:** 12 sn’lik 1920 × 1080 video dikey yapılırken ana iş parçacığının JS yığını — boşta 2,9 MB, video açıkken 5,8 MB, tepe 6,9 MB (bütçe içinde, bütçe ≤ 150 MB), bittikten sonra 5,5 MB; 64 örnek. Dışa aktarmanın işçileri (worker) ve kodlayıcı bu sayının DIŞINDADIR; bütün süreç ağacının belleği `web/scripts/measure-export-memory.mjs` ile ölçülür (ADR-029), burada yeniden koşulmadı.

**Dışa aktarma hızı** — “İndir”e basıştan dosyanın hazır olmasına; × gerçek zaman = çıktı süresi / geçen süre. Ölçüm kilidi altında, bu makinede.


| Durum | Yol | Çıktı | Geçen süre | × gerçek zaman |
| --- | --- | --- | --- | --- |
| Her yerde açılsın, senkron klibi (H.264 MP4) | kopya | 12 sn, 1080 × 1920 | 0,82 sn | 14,7 × |
| Her yerde açılsın, senkron klibi (VP9 WebM) | yeniden işlendi | 12 sn, 1080 × 1920 | 3,87 sn | 3,1 × |
| Dikey yap, senkron klibi (zaten 9:16) | kopya | 12 sn, 1080 × 1920 | 0,83 sn | 14,5 × |
| Kes 2–8 sn, senkron klibi (H.264 MP4) | kopya | 6 sn, 1080 × 1920 | 0,85 sn | 7,1 × |
| Kes 2–8 sn, senkron klibi (VP9 WebM) | yeniden işlendi | 6 sn, 1080 × 1920 | 2,36 sn | 2,6 × |
| Küçült (seçim değişmeden), senkron klibi (VP9 WebM) | yeniden işlendi | 12 sn, 1080 × 1920 | 3,87 sn | 3,1 × |
| Her yerde açılsın, kamera benzeri 720p VP9 WebM | yeniden işlendi | 6 sn, 1280 × 720 | 1,85 sn | 3,3 × |
| Dikey yap (Doldur), kamera benzeri 1080p | yeniden işlendi | 12 sn, 1080 × 1920 | 6,43 sn | 1,9 × |
| Kes 2,5–5,5 sn, kamera benzeri 1080p | karma | 3 sn, 1920 × 1080 | 1,36 sn | 2,2 × |
| Küçült → WhatsApp (16 MB), kamera benzeri 1080p, yaklaşık 24 MB | yeniden işlendi | 12 sn, 1920 × 1080 | 5,89 sn | 2 × |
| İyileştir, karanlık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 2,84 sn | 1,1 × |
| İyileştir, bulanık video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 4,85 sn | 0,6 × |
| İyileştir, kumlu video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 9,98 sn | 0,3 × |
| İyileştir, iyi video | yeniden işlendi + görüntü işleme (grafik hızlandırma YOK) | 3 sn, 1280 × 720 | 2,86 sn | 1,1 × |

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
| Ana ekran, arama sonucu (“sessiz yerleri sil”) | 6 | **1** (bütçe ≤ 0) | 0 | 0 | 12 px; %68 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu bulamadım.” | 5 | **1** (bütçe ≤ 0) | 0 | 0 | 12 px; %56 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”) | 6 | **1** (bütçe ≤ 0) | 0 | 0 | 12 px; %69 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran | 17 | **1** (bütçe ≤ 0) | 0 | 0 | 12 px; %62 | 0 | 17 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video yok | 7 | **5** (bütçe ≤ 0) | **1** (bütçe ≤ 0) | 0 | 12 px; %33 | 0 | 6 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video ve bir kesit | 19 | **7** (bütçe ≤ 0) | **1** (bütçe ≤ 0) | 0 | 11 px; %74 | **11** (bütçe ≤ 0) | 19 durak; ulaşılamayan 0; geri sıçrama 1 (çok sütunlu; yargılanmaz) | 0 |
| Boşlukları at, seçim | 8 | 0 | 0 | 0 | 13 px; %45 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Dikey yap, seçim | 8 | 0 | 0 | 0 | 13 px; %47 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, ilk ekran (Dikey yap) | 3 | 0 | 0 | 0 | 13 px; %50 | 0 | 3 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| İyileştir, seçim | 9 | 0 | 0 | 0 | 12 px; %53 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Küçült, seçim | 9 | 0 | 0 | 0 | 13 px; %54 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Müzik ekle, seçim (müzik seçilmiş) | 9 | 0 | 0 | 0 | 13 px; %47 | 0 | 14 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, sonuç ekranı (Her yerde açılsın) | 8 | 0 | 0 | 0 | 12 px; %49 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Yazıya dök, model adımı | 5 | 0 | 0 | 0 | 13 px; %21 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |

- **Ana ekran, arama sonucu (“sessiz yerleri sil”)** — 44 px’ten küçük: Gizlilik (taslak) — 78,9 × 30 px
- **Ana ekran, “Bunu bulamadım.”** — 44 px’ten küçük: Gizlilik (taslak) — 78,9 × 30 px
- **Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”)** — 44 px’ten küçük: Gizlilik (taslak) — 78,9 × 30 px
- **Ana ekran** — 44 px’ten küçük: Gizlilik (taslak) — 78,9 × 30 px
- **Editör, video yok** — 44 px’ten küçük: clip — 18,4 × 16 px; Ana ekrana dön — 30 × 44 px; Diğer — 40 × 44 px; Ayarlar — 40 × 44 px; Oynatma çizgisi — 24 × 96 px
- **Editör, video ve bir kesit** — 44 px’ten küçük: clip — 18,4 × 16 px; Ana ekrana dön — 30 × 44 px; Geri al — 40 × 44 px; Diğer — 40 × 44 px; Ayarlar — 40 × 44 px; Oynatma çizgisi — 24 × 96 px; Mesajı kapat — 28 × 32 px
- **14 px’ten küçük yazılardan örnekler** (bütün ekranlardan): 11 px: 00:00 · 11 px: 00:02 · 11 px: 00:04 · 11 px: 00:06 · 11 px: 00:08 · 11 px: 1 · 12 px: Bu bir deneme sürümüdür. İndirme en iyi Chrome ve Edge’de ça · 12 px: Clip geçici çalışma adıdır. · 12 px: Gizlilik (taslak) · 12 px: Deneme sürümü · videon cihazından çıkmaz · bulut yok · 12 px: clip · 12 px: ×1 · 12 px: 1 · 12 px: Önce
- **Görünür yazısı olmayan düğmeler** (yalnız simge; erişilebilir adı var): Yazdığını sil; Diğer; Ayarlar; Oynatma çizgisi; Geri al; Tam ekran izle (F); Oynat; Mesajı kapat; Kesit 1'i oynat, 00:01–00:03; Kesit 1'i sil, 00:01–00:03

**masaüstü (1440 × 900)**


| Ekran | Kontrol | 44 px’ten küçük hedef | 24 px’ten küçük | Adsız kontrol | En küçük yazı; 14 px altı kelime | 12 px altı kelime | Klavye (Tab) sırası | Odak halkası görünmeyen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ana ekran, arama sonucu (“sessiz yerleri sil”) | 6 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %68 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu bulamadım.” | 5 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %56 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran, “Bunu henüz yapamıyoruz.” (“gif yap”) | 6 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %69 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Ana ekran | 17 | 1 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %33 | 0 | 17 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video yok | 8 | 3 (fareyle; yargılanmaz) | **1** (bütçe ≤ 0) | 0 | 11 px; %47 | **2** (bütçe ≤ 0) | 7 durak; ulaşılamayan 0; geri sıçrama 0 (çok sütunlu; yargılanmaz) | 0 |
| Editör, video ve bir kesit | 20 | 4 (fareyle; yargılanmaz) | **1** (bütçe ≤ 0) | 0 | 11 px; %84 | **21** (bütçe ≤ 0) | 20 durak; ulaşılamayan 0; geri sıçrama 1 (çok sütunlu; yargılanmaz) | 0 |
| Boşlukları at, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %45 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Dikey yap, seçim | 8 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %47 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, ilk ekran (Dikey yap) | 3 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %42 | 0 | 3 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| İyileştir, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %53 | 0 | 8 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Küçült, seçim | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %54 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Müzik ekle, seçim (müzik seçilmiş) | 9 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %47 | 0 | 14 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Sihirbaz, sonuç ekranı (Her yerde açılsın) | 7 | 0 (fareyle; yargılanmaz) | 0 | 0 | 12 px; %29 | 0 | 7 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |
| Yazıya dök, model adımı | 5 | 0 (fareyle; yargılanmaz) | 0 | 0 | 13 px; %21 | 0 | 5 durak; ulaşılamayan 0; geri sıçrama 0 | 0 |

**Okunabilirlik** — `web/src/i18n/messages.ts` içindeki Türkçe metinler; Ateşman puanı (90–100 çok kolay · 70–89 kolay · 50–69 orta · 30–49 zor · 30 altı çok zor).


| Metinler | Metin | Puanlanan (5+ kelime) | Ortanca puan | Zor + çok zor | Çok zor | 20 kelimeden uzun cümle | En uzun cümle | En uzun kelime |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Varsayılan yol (ana ekran, kartlar, sihirbazlar, yazıya dökme, indirme, hata) | 392 | 180 | 79,4 | %2,2 | **1** (bütçe ≤ 0) | 1 | 22 kelime | birleştirilebiliyor |
| Bütün metinler (editör dahil) | 980 | 425 | 78,3 | %3,3 | 1 | 4 | 22 kelime | birleştirilebiliyor |

Varsayılan yolun metinlerinden teknik terim içeren: 15 (bütçesiz). Bu, metin tablosunun taramasıdır: bir metnin ekrana hangi koşulda geldiğini bilmez (bir kısmı yalnızca hata olduğunda ya da “Ayrıntılar” açıldığında görünür). Gerçekten görülenler bölüm 1’dedir.

**En zor 20 metin (varsayılan yol)**


| Puan | Anahtar | Cümle başına kelime | Kelime başına hece | Metin |
| --- | --- | --- | --- | --- |
| 7,5 (çok zor) | `download.shareFailedSaved` | 2,5 | 4,6 | “Paylaşılamadı. Kaydedilen dosyayı klasöründen paylaşabilirsin.” |
| 33,1 (zor) | `transcript.machine` | 5 | 3,8 | “Otomatik yazıldı — yanlış olabilir, düzeltebilirsin.” |
| 37,7 (zor) | `download.readyWhereDevice` | 4 | 3,75 | “Tarayıcın dosyayı İndirilenler klasörüne kaydeder; Dosyalar uygulamasında bulursun.” |
| 48,2 (zor) | `download.readyWhere` | 10 | 3,1 | “Tarayıcın dosyayı İndirilenler klasörüne kaydeder (ya da nereye kaydedeceğini sorar).” |
| 50,4 (orta) | `export.fail.output_probe_failed` | 3 | 3,5 | “Oluşan dosya yeniden açılamadı; başarılı sayılmadı.” |
| 51,9 (orta) | `silence.failed.undecodable` | 3,5 | 3,43 | “Bu tarayıcı videonun sesini çözemiyor; sessizlik aranamadı.” |
| 51,9 (orta) | `enhance.preview.failed.source_undecodable` | 3,5 | 3,43 | “Bu tarayıcı bu videoyu çözemiyor; iyileştirme yapılamıyor.” |
| 51,9 (orta) | `transcript.failed.undecodable` | 3,5 | 3,43 | “Bu tarayıcı videonun sesini çözemiyor; yazıya dökülemedi.” |
| 52,6 (orta) | `enhance.setting.previewNote` | 6 | 3,25 | “Oynatıcı videonun kendi hâlini gösterir. Aşağıdaki resim indirilecek videonun gerçek bir karesidir.” |
| 52,8 (orta) | `silence.failed.worker_unavailable` | 4 | 3,38 | “Çözümleme bu tarayıcıda başlatılamadı. Sayfayı yenileyip tekrar dene.” |
| 55,7 (orta) | `download.targetNormal` | 2,5 | 3,4 | “Video zaten sığıyordu; kalite düşürülmedi” |
| 55,7 (orta) | `transcript.unclearCount` | 2,5 | 3,4 | “{n} yer anlaşılamadı; dinleyip elle yazabilirsin.” |
| 55,9 (orta) | `export.fail.output_duration_mismatch` | 6 | 3,17 | “Oluşan dosyanın süresi beklenen süreyle uyuşmadı.” |
| 55,9 (orta) | `transcript.english` | 6 | 3,17 | “Şimdilik yalnızca İngilizce konuşmaları yazıya döker.” |
| 56,7 (orta) | `wizard.yazi.editorHint` | 13 | 2,69 | “Satırları seçip onlardan kesit yapmak ya da altyazının görünüşünü değiştirmek için editörde aç.” |
| 57,1 (orta) | `download.targetCopy` | 3 | 3,33 | “Orijinal görüntü zaten sığıyordu; yeniden kodlanmadı” |
| 57,1 (orta) | `error.unknown_duration` | 3 | 3,33 | “Dosyanın süresi okunamadı; bu haliyle düzenlenemez.” |
| 57,2 (orta) | `enhance.preview.failed.hdr_source_unsupported` | 7 | 3,07 | “Bu tarayıcı bu HDR videoyu doğru çeviremediği için iyileştirme yapılamıyor. Videoyu Chrome’da açmayı dene.” |
| 57,2 (orta) | `export.fail.no_video_track` | 5 | 3,2 | “Seçilen dosyada video izi bulunamadı.” |
| 57,2 (orta) | `task.filigran.sub` | 5 | 3,2 | “Videonun üstündeki yazıyı, logoyu kaldır” |

## Bu rapor neyi söylemez

- Bir çocuğun ya da ilk kez kullanan birinin nerede durakladığını, neyi yanlış anladığını, neyi beğenmediğini. Betik hiç duraksamaz ve her düğmenin adını önceden bilir.
- Gerçek telefonu: “telefon” burada masaüstü Chromium’un 390 × 844 dokunmatik öykünmesidir. Gerçek Android / iPhone’da hız, bellek, dosya seçici ve paylaşım ayrı ölçülür (`web/scripts/android/`).
- Gerçek çekimlerde görüntü kalitesini: sadakat ölçüleri üretilmiş, kamera benzeri bir videoda alındı.
- Yazıya dökmenin bugünkü doğruluğunu: bölüm 6 kayıtlı sayılardır.
- e2e testlerinin bu commit’te geçtiğini: atıf yapılan testler burada koşulmaz.
