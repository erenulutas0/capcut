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
