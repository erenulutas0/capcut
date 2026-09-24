# Değişiklik Kaydı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Hızlı kesim — 24 Eylül 2026 (ADR-027, politika değişmedi)

**Eklenen:** Görüntüsü değişmeyen indirmelerde kaynağın sıkıştırılmış kareleri olduğu gibi kopyalanıyor; yalnızca her kesimden sonraki ilk IDR'a kadarki kareler (ve B-kareli kaynakta sondaki en fazla bir B grubu) yeniden kodlanıyor ("smart cut"). Kare hassas: kesit tam işaretlenen karede başlayıp bitiyor; kopyalanan kareler kaynakla bit bit aynı. Ses her zaman eskisi gibi yeniden kodlanıyor (kazanç, müzik, tam kesim çalışır). Dosya başarı demeden önce bu tarayıcının çözücüsüyle dikişlerde yeniden denetleniyor; tutmazsa tam kodlama çalışıyor. Ölçülen (60 dk 1080p kesit, iki aralık): Chrome 437,8 s → 28,1 s, Edge 373,1 s → 28,6 s, Playwright Chromium 804,7 s → 33,7 s; tepe bellek aynı düzeyde. Sonuç ekranında yeni satır: "Yöntem: Hızlı kesim — görüntü yeniden kodlanmadı" ya da "Kodlandı (sebep)".

**Kapsam (bilerek dar, doc 15 değişmedi):** yalnızca altyazısız, kırpmasız, SDR, H.264 MP4/MOV kaynak; indirilen çözünürlük kaynağınkiyle aynı; kareleri 30 fps ızgarasında. 29,97/24/60 fps ve değişken hızlı telefon kayıtları, 4K ve HEVC eskisi gibi tam kodlanıyor (kurucu sorusu ADR-027'de).

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar ve fiyatlar değişmedi; aynı indirme daha hızlı olabilir, dosyası kaynağın bit hızındadır.

## Politika 2026-09-23.v5 — 23 Eylül 2026

**Değişen:** Web yerel toplam kaynak boyutu limiti (video ve müzik birlikte) 2 GiB → 4 GiB (doc 15, doc 11). Kurucu kararı, Edge'de de ölçülme koşuluyla; dayanak ADR-025: 4,45 GiB'lık dosya (yalnızca ölçüm için limiti 8 GiB olan yerel derlemede) ve gerçek politikayla 3,96 GiB'lık dosya Edge, Chrome ve Chromium'da açıldı, 4 GiB ofsetine yakın doğru kareye gidildi, sessizlik önerileri çalıştı, üstüne müzik eklendi, 2 ve 4 GiB ofsetlerini geçen 5 dakika indirildi (9000 kare, 10/10 kare doğru), yeniden yükleme ve yedek dosyasıyla video ve müzik yeniden bağlandı; tepe bellek 916–1265 MiB. 4 GiB'ı aşan dosya ve toplamı aşan müzik dosya adıyla ve "4 GiB (yaklaşık 4,29 GB)" mesajıyla reddedilir. Matris satırı M13 artık 4 GiB + 16 MiB (`m13-oversize-4gib.mp4`). Girdi 120 dakika, çıktı 60 dakika (bellek yolunda 5), 5 video kaynağı, 20 parça, 1 müzik, mobil (2 GiB / 5 GiB) ve cloud limitleri, fiyatlar değişmedi.

**Düzeltilen:** Dosya boyutları (kaynak paneli, yeniden bağlama paneli, çıkan dosya) ikili değer olduğu hâlde "GB/MB" yazılıyordu; artık kontrolün birimiyle "GiB/MiB/KiB" (doc 15: gösterilen birim, kontrol edilen birim).

**Eklenen:** "Bilgisayara kaydet"in altında sessiz bir not: kaydederken bilgisayarda yaklaşık dosyanın boyutu kadar daha boş yer gerekir, gerçek boyutla (ADR-023). HEVC çözücüsü olmayan tarayıcıda HEVC video açılamazsa içe aktarma hatasının altında ipucu: Windows'ta Edge'de Microsoft Store'daki "HEVC Video Uzantıları" gerekebilir ya da Chrome denenebilir; yalnızca video HEVC ve tarayıcının çözücü kontrolü "hayır" dediğinde (ADR-022).

**Kurucu kararları (kayıt):** HDR HLG açık kalır; R11 HLG'nin geçişinin, önceden kaydedilen 5 operatörlük set kaldıktan sonra genişletilen 7 operatörlük sete dayandığı bilerek kabul edildi (ADR-022). Yazılım kodlayıcıya 3 kat bit hızı kalır (ADR-024).

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen her dosya ve geçerli her proje/yedek geçerli kalır.

## Politika 2026-09-23.v4 — 23 Eylül 2026

**Değişen:** Web yerel girdi limiti (toplam video kaynak süresi) 60 dakika → 120 dakika (doc 15, doc 11). Girdi sınırına sığan video artık çıktı sınırından uzun olsa da zaman çizgisine tek parça olarak gelir; çıktı sınırı (60 dakika; diske yazamayan tarayıcıda 5 dakika) tarifin kuralı olmaktan çıktı ve indirmenin kapısı oldu: sonuç sınırdan uzunsa "Videoyu indir" kodlamadan önce sonucun uzunluğunu ve en az ne kadar silinmesi gerektiğini söyler, zaman çizgisi sınırı çizgiyle ve fazlasını taralı gösterir (ADR-021). "İlk 60 dakikayı ekle" seçimi kaldırıldı. Çıktı limiti, 2 GiB toplam boyut, 5 video kaynağı, 20 parça, 1 müzik, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-021 ölçümleri.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen her video ve geçerli her proje/yedek geçerli kalır; tarif doğrulamasındaki süre kuralı artık çıktı sınırını değil girdi sınırını (120 dakika) uygular (`timeline_duration_exceeds_policy`), çıktı sınırı render planında (`output_duration_exceeds_policy`) kaldı.

## Teknik — 23 Eylül 2026 (politika değişmedi)

**Değişen:** Diske (OPFS) yazılan çıktının depolama kontrolü. Tarayıcının depolama tahmini gerçek diski göstermiyor (Chrome her durumda "kullanım + 10 GiB" bildiriyor), bu yüzden eski "tahminin iki katı" kuralı pratikte hiçbir şeyi kontrol etmiyordu. Artık dosyanın ölçülmüş tahmini boyutu (bit hızı × süre × 1,1 + 32 MiB) kodlamadan önce diskte ayrılıyor. Yer yoksa uzun çıktı ilk kare kodlanmadan reddediliyor ve mesaj gereken alanı ve tarayıcının bildirdiği alanı söylüyor. 60 dakika 1080p için gereksinim ~6,0 GiB'tan 2,67 GiB'a indi (ADR-023).

**Değişen:** Donanım H.264 kodlayıcısı olmayan tarayıcıda (ör. Playwright Chromium, VA-API'siz Linux Chrome) video bit hızı 3 kat. Bu tarayıcılarda gerçek görüntüde dosya ~2,7–2,9 kat büyür ve kalite donanım kodlayıcısının düzeyine çıkar. Donanım kodlayıcılı Chrome ve Edge'de dosyalar birebir aynı (ADR-024).

**Düzeltilen:** Gerçek kayıt R15 Chromium'da FAIL (SSIM 0,825) → PASS (0,870). Dışa aktarma sırasında dolan disk artık "yarım dosya silindi" diyor; bu yol tarayıcının kendi kota hatasıyla e2e'de sınanıyor.

Mevcut kullanıcı haklarına etkisi: yok. Sınırlar ve fiyatlar değişmedi.

## HDR kaynaklar SDR'ye çevriliyor — 23 Eylül 2026 (ADR-022)

**Eklenen:** HDR (PQ / HLG, bt2020) videolar artık reddedilmek yerine SDR H.264 olarak dışa aktarılır — ama yalnızca, dışa aktarmadan hemen önce worker'da sentetik bir 10-bit HDR karesiyle yapılan kontrol **bu tarayıcıda** geçerse. Dönüşüm tarayıcının kendi HDR→SDR dönüşümüdür; parlak doygun renklerin kesilmesi (ölçüldü: PQ ColorChecker karesinin %16'sı) float16 tuval ve tonu koruyan bir yumuşak kırpmayla giderilir. Dialog'da yeni satır ("HDR → SDR dönüşümü bu tarayıcıda doğru") ve not: "Bu video HDR. İndirilen dosya SDR olacak; renkler telefondaki görüntüden biraz farklı görünebilir." Ölçüm: `docs/spikes/2026-09-23-hdr-tonemap.md`; eşikler tarayıcı çıktısı ölçülmeden sabitlendi.

**Değişen:** HDR ret mesajı sebebi söylüyor (bu tarayıcı HDR'yi SDR'ye doğru çeviremedi, deneme karesiyle test edildi). Matris satırı M10-hdr artık gerçek 10-bit içerik (VP9 profil 2, PQ) kullanıyor ve reddi değil doğru renkli çıktıyı (ya da HDR gerekçeli açık reddi) kontrol ediyor; yeni M10-hdr-hlg satırı (HLG, 90° döndürmeli). Eski 8-bit "PQ etiketli" H.264 fixture'ı kaldırıldı.

Sınır: HEVC çözücüsü olmayan tarayıcıda (bu makinede Edge ve Playwright Chromium) telefonun HEVC HDR kaydı yine içe aktarmada, codec yüzünden reddedilir. Fiyat, kota ve politika sınırları değişmedi.

## Politika 2026-09-22.v3 — 22 Eylül 2026

**Değişen:** Web yerel çıktı limiti 5 dakika → 60 dakika, yalnızca çıktının tarayıcının özel diskine (OPFS) akıtılabildiği yolda. Diske yazamayan tarayıcıda (bellek yolu) çıktı 5 dakikada kaldı ve daha uzun çıktı kodlamadan önce açık bir mesajla reddedilir; depolama tahmini dosyaya yetmiyorsa da uzun çıktı baştan reddedilir (doc 15, doc 11). Girdi limiti (60 dakika / 2 GiB), 20 parça sınırı, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-013 ve ADR-020 bellek ölçümleri.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden indirilebilen hiçbir çıktı reddedilmez; bellek yolundaki tarayıcılar için sınır aynı kaldı.

## Politika 2026-09-21.v2 — 21 Eylül 2026

**Değişen:** Web yerel girdi limiti 20 dakika / 250 MiB → 60 dakika / 2 GiB (doc 15, doc 11). Çıktı limiti 5 dakika, mobil ve cloud limitleri, fiyatlar değişmedi. Kurucu kararı; dayanak ADR-013 bellek ölçümü.

Mevcut kullanıcı haklarına etkisi: yalnızca genişleme. Önceden açılabilen hiçbir proje kapanmaz.

## 0.1 — 19 Eylül 2026

Araştırmaya dayalı ürün, mimari, medya sözleşmesi, ücretsiz/Pro politika önerisi, ödeme ve kota tasarımı, pazarlama deneyleri, test matrisi, yayın kapıları ve ilk kodlama görevi oluşturuldu.

Bu sürüm yalnızca dokümantasyondur. Uygulama sürümü, test sonucu veya canlı hizmet duyurusu değildir.

Sonraki değişiklikler `Eklenen`, `Değişen`, `Düzeltilen`, `Güvenlik`, `Kırıcı değişiklik` başlıklarıyla kaydedilir. Fiyat/kota değişiklikleri mevcut kullanıcı haklarına etkisiyle birlikte yazılır.
