# 15 — Free, Pro, Fiyatlar ve Kanonik Kullanım Politikası

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Durum

**Bu belge bütün fiyat/kota sayıların tek kaynağıdır.** Bunlar pazar araştırmasıyla doğrulanmış ideal fiyatlar veya yapılmış özellikler değildir. P0/P1/P2 alfa-beta sırasında ödeme kapalıdır; teslim edilen temel özellikler ücretsiz denenir. P3 satış, gerçek Pro değeri + billing/restore + hukuk + destek + maliyet kapıları geçince açılır.

Politika kimliği: `2026-09-23.v5`. Limitler ürün güvenliği için başlangıç önerisidir; teknik motorların mutlak maksimum kapasitesi değildir. Daha fazla para ödemek desteklenmeyen codec/donanımı destekli yapmaz.

## Planlar

| Özellik | Free | Pro — yalnızca uygulanmışsa |
|---|---|---|
| Yerel dışa aktarma adedi | Sınırsız | Sınırsız |
| Filigran | Yok | Yok |
| Yerel temel işte hesap | Gerekmez | Ücretli hakkı ortak kullanmak için gerekir |
| Kırp/sil/sırala/crop/müzik | Dahil | Dahil |
| Temel undo/redo ve otomatik kayıt | Dahil | Dahil |
| 720p / 1080p, SDR, 30 fps | Desteklenen cihazda dahil | Desteklenen cihazda dahil |
| Cihazda yerel proje adedi | Uygulama kotası yok; disk sınırı var | Aynı |
| Mobil yerel çıktı süresi | En çok 5 dakika/proje | En çok 30 dakika/proje |
| Mobil toplam video kaynak süresi | En çok 20 dakika/proje | En çok 60 dakika/proje |
| Mobil toplam seçili medya boyutu | En çok 2 GiB/proje | En çok 5 GiB/proje |
| Web yerel limitleri | 60 dakika çıktı (diske yazamayan tarayıcıda 5 dakika) / 120 dakika video girdi / 4 GiB toplam | İlk destek matrisinde aynı; Pro tarayıcı sınırını artırmaz |
| Tek projede kaynak/klip | En çok 5 video kaynağı, 20 klip, 1 harici müzik | İlk sürümde aynı |
| Harici müzik dosyası | En çok 10 dakika ve 100 MiB; toplam byte limitine dahil | Aynı |
| Kaydedilebilir çalışma profilleri | Yok; hazır temel oranlar ve ayarlar dahil | Yerelde kullanıcı profilleri; pratik disk sınırı |
| Proje kopyası / sürüm anlık görüntüsü | Temel otomatik kurtarma dahil | Açık kopya ve en çok 20 saklanan sürüm/proje |
| Yerel sıralı batch | Yok | En çok 10 çıktı varyantı; her biri platform limitine uyar |
| AI işlemleri | Yok | Başlangıç aboneliğine dahil değil |
| Kalıcı cloud arşivi / cihazlar arası medya senkronu | Yok | Yok |

GiB = 1.073.741.824 byte, MiB = 1.048.576 byte. Kullanıcı arayüzü hangi birimi gösteriyorsa gerçek kontrol aynı birimde yapılmalı. “2 GB” deyip farklı limit uygulama.

**Değişiklik `2026-09-23.v5` (kurucu kararı, 23 Eylül 2026):** Web yerel toplam kaynak boyutu limiti (video ve müzik birlikte) 2 GiB'den 4 GiB'ye (4.294.967.296 byte) çıkarıldı. Kurucunun koşulu, 2 GiB'nin üzerindeki dosyanın Chrome ve Chromium'a ek olarak Edge'de de ölçülmesiydi. Dayanak: `docs/adr/ADR-025-source-bytes-4gib.md` ölçümü — 60 dakikalık sentetik 1080p kaynak (10,5 Mbit/s, indeks dosyanın sonunda), birleşik koddaki (depolama ayırma, HDR yolu, yazılım kodlayıcıya 3 kat bit hızı dahil) uygulamayla, kalıcı profil ve OPFS yoluyla Edge 153, Chrome 153 ve Playwright Chromium 153'te: (1) 4,45 GiB'lık dosya, yalnızca bu ölçüm için limiti 8 GiB yapılmış yerel bir derlemede (depoya girmedi) 0,11 sn'de zaman çizgisine geldi (ilk önizleme karesi 0,15–0,26 sn); ~4,4 GiB ofsetindeki 59:00'a gitmek 16–61 ms sürdü ve doğru kare göründü; 2 GiB ve 4 GiB ofsetlerini geçen iki parçadan oluşan 5 dakikalık 1080p çıktı üç tarayıcıda da tamamlandı (Edge 32,9 sn, Chrome 36,4 sn, Chromium 75,2 sn; ffprobe 300,000 sn ve 9000 kare; gömülü kare numarasıyla 10/10 kare doğru); (2) gerçek 4 GiB politikasıyla 3,96 GiB'lık dosya (4.252.160.630 byte) üç tarayıcıda açıldı, ~3,9 GiB ofsetine gidildi, 53 dakikanın sessizlik önerileri 10,6–13,0 sn sürdü, üstüne 3 dakikalık müzik eklendi ve 5 dakikalık çıktı müzikle birlikte tamamlandı (10/10 kare doğru, müzik dosyada ölçüldü); videoyla toplamı 4 GiB'yi aşan 55 MiB'lik müzik dosya adıyla ve "video ve müzik birlikte … 4 GiB (yaklaşık 4,29 GB)" mesajıyla reddedildi, açık video değişmedi; 4 GiB'yi 8,3 MiB aşan dosya ve 4,45 GiB'lık dosya hiçbir byte okunmadan 29–33 ms'de dosya adıyla ve "4 GiB (yaklaşık 4,29 GB)" mesajıyla reddedildi; yeniden yükleme ve yedek dosyasından boş profile geri yüklemede video ve müzik yeniden bağlandı (her biri ≤ 0,15 sn, dosya okunmadan). Tarayıcı süreç ağacının tepe belleği 916–1265 MiB (dosya boyutuna değil çıktıya bağlı; sessizlik analizinde tepe 989–1183 MiB, pencere kapanınca geri verildi). Arayüzde dosya boyutları artık kontrolün birimiyle (KiB/MiB/GiB) gösterilir; "GB" yalnızca parantezdeki yaklaşık ondalık değerdir. Değişmeyenler: 120 dakika girdi, 60 dakika çıktı (diske yazamayan tarayıcıda 5 dakika), 5 video kaynağı, 20 parça, 1 harici müzik (10 dakika / 100 MiB), mobil satırlar (2 GiB / 5 GiB), cloud satırları, fiyat ve ücretli haklar. Mevcut kullanıcı haklarına etkisi: yalnızca genişleme; önceden açılabilen her dosya ve geçerli her proje/yedek geçerli kalır, daha önce indirilebilen hiçbir çıktı reddedilmez. Ölçülmeyen: Safari ve Firefox (desteklenen çıktı hedefi değil; Firefox'ta AAC kodlayıcı yok), başka makineler ve düşük RAM'li dizüstüler, gerçek (değişken bit hızlı, HEVC) 2–4 GiB telefon kayıtları, 5 dakikadan uzun çıktının 4 GiB'lik kaynaktan alınması ve gizli pencere ölçülmedi; ölçümler tek makinede ve sentetik kaynakla yapıldı (n=1).

**Değişiklik `2026-09-23.v4` (kurucu kararı, 23 Eylül 2026):** Web yerel girdi limiti (toplam video kaynak süresi) 60 dakikadan 120 dakikaya çıkarıldı. Aynı değişiklikle çıktı limiti tarifin kuralı olmaktan çıkıp indirmenin kapısı oldu: girdi limitine sığan video, çıktı limitinden uzun olsa da zaman çizgisine tek parça gelir; kullanıcı böler ve siler, sonuç limiti aşarken "Videoyu indir" kodlamadan önce sonucun uzunluğunu ve en az ne kadar silinmesi gerektiğini söyler. Tarifin toplam süresi girdi limitiyle (120 dakika) sınırlıdır. Dayanak: `docs/adr/ADR-021-input-limit-120min.md` ölçümü — 120 dakikalık sentetik 1080p (1,60 GiB) ve 720p (1,01 GiB) kaynak, kalıcı profil ve OPFS yoluyla Chromium, Chrome ve Edge'de açıldı (tek parça ~0,2 sn, ilk önizleme karesi 0,2–0,4 sn); 1:59:00'a gitmek 7–11 ms; 2 saatin sessizlik önerileri 19–24 sn, bellek analiz boyunca düz; bölüp silerek elde edilen 60 dakikalık sonuç dört koşuda da tamamlandı (Chrome 1080p 418 sn, Chromium 722 sn; ffprobe 3600,000 sn ve 108000 kare; gömülü kare numarasıyla başlangıç, kesim ve son kareleri 10/10 doğru); tarayıcı süreç ağacının tepe belleği 945–1198 MiB, kodlama boyunca büyümedi (kesimde bir kez +70…170 MiB basamak; 20 parçalı sonuçta basamaklar birikmedi, tepe 1076 MiB, 100/100 kare doğru); 2 saatlik sonuçta indirme kodlamadan önce reddedildi ve geçici dosya kalmadı; yeniden bağlama dosyayı okumadan ~0,2 sn sürdü. Değişmeyenler: çıktı limiti (60 dakika; diske yazamayan tarayıcıda 5 dakika), 2 GiB toplam boyut, 5 video kaynağı, 20 parça, 1 harici müzik, mobil ve cloud satırları, fiyat ve ücretli haklar. Mevcut kullanıcı haklarına etkisi: yalnızca genişleme; önceden açılabilen her video ve geçerli her proje/yedek geçerli kalır, daha önce indirilebilen hiçbir çıktı reddedilmez. Ölçülmeyen: başka makineler ve düşük RAM'li dizüstüler, Safari ve Firefox, gizli pencere, gerçek 2 saatlik telefon/kamera kayıtları ölçülmedi; ölçümler tek makinede ve sentetik kaynakla yapıldı (n=1). 2 GiB'ın üzerindeki dosyalar için yalnızca kanıt toplandı, politika değişmedi (ADR-021).

**Değişiklik `2026-09-22.v3` (kurucu kararı, 22 Eylül 2026):** Web yerel çıktı limiti 5 dakikadan 60 dakikaya çıkarıldı; yalnızca çıktının tarayıcının özel diskine (OPFS) akıtılabildiği yolda. Tarayıcı diske yazamıyorsa (bellek yolu) çıktı 5 dakikada kaldı ve daha uzun çıktı kodlamadan önce açık mesajla reddedilir; depolama tahmini dosyaya yetmiyorsa da uzun çıktı baştan reddedilir. Dayanak: `docs/adr/ADR-020-output-limit-60min.md` ölçümü — Chromium'da kalıcı profil ve OPFS yoluyla 60 dakikalık 1080p çıktı tamamlandı (2447 MiB, 108000 kare, süre birebir 3600 sn); tarayıcı süreç ağacının belleği kodlama boyunca 476–506 MiB aralığında düz kaldı, tepe 664 MiB (taban 218, artış +446), geçici dosya sonra silindi; Chrome'da aynı çıktı 720–736 MiB aralığında düz kaldı (tepe 774 MiB). Bellek yolunda bellek çıktıyla büyüdüğü için (ADR-013: 5 dakikada ~1 GiB) o yolun sınırı değişmedi. Girdi limiti, 20 parça, mobil ve cloud satırları, fiyat ve ücretli haklar değişmedi. Mevcut kullanıcı haklarına etkisi: yalnızca genişleme, daha önce indirilebilen hiçbir çıktı reddedilmez. Ölçülmeyen: başka makineler, düşük RAM'li dizüstüler, Safari, Firefox, gerçek uzun kamera kayıtları; ölçüm tek makine ve sentetik kaynakla (n=1) yapıldı.

**Değişiklik `2026-09-21.v2` (kurucu kararı, 21 Eylül 2026):** Web yerel girdi limiti 20 dakika / 250 MiB'den 60 dakika / 2 GiB'ye çıkarıldı; 5 dakika çıktı limiti değişmedi. Dayanak: `docs/adr/ADR-013-w4-output-to-opfs.md` ölçümü — dışa aktarmada bellek çıktı süresiyle büyür, kaynak dosya diskten okunur; 32 dakikalık 257,7 MiB gerçek kayıt 720p'de 363–434 MiB tepe bellekle tamamlandı. Yalnızca yerel web rotasını etkiler; mobil ve cloud satırları, fiyat ve ücretli haklar değişmedi. Mevcut kullanıcı haklarına etkisi: yalnızca genişleme, hiçbir proje daha önce açılabilirken kapanmaz. 2 GiB üzerinde dosya henüz ölçülmedi.

Yerel limitsiz adet, aynı anda sınırsız encode demek değildir. Cihazda bir aktif encode; batch sırayla çalışır. Limitin üzerinde Pro projesi hakkı sona erince silinmez; kullanıcı proje/medyayı görebilir, Free sınırına indirip çıktı alabilir. Daha önce oluşturduğu dosyalar etkilenmez.

## Cloud hakları — yalnızca P3 hizmeti açıkken

| Politika | Free deneme | Pro |
|---|---|---|
| Toplam dahil hak | Doğrulanmış hesap başına bir defalık 180 saniye | Her aylık tahsis döneminde 1.800 saniye |
| Dönem yenileme | Yok; aylık ücretsiz hak değil | Aylık; yıllık abonelikte de ay ay |
| Kullanılmayan hak | Deneme hesabı aktifken önerilen 30 günlük kullanım penceresi | Sonraki döneme devretmez |
| Tek job çıktı süresi | En çok 60 saniye | En çok 300 saniye |
| Tek job toplam video girdi süresi | En çok 5 dakika | En çok 15 dakika |
| Tek job toplam medya boyutu | En çok 250 MiB | En çok 1 GiB |
| Çıktı kalitesi | 1080p veya 720p, SDR, 30 fps | Aynı |
| Eşzamanlı job | 1 aktif / en çok 2 bekleyen | Aynı |

Denemenin 30 günlük kullanım penceresi, doğrulanmış kullanıcının “Bulut denemesini başlat” eylemiyle grant oluşturulduğu andan başlar; bitiş tarihi UI'da görünür. Pro satın almak ikinci deneme grant'i yaratmaz. **İlk sürümde aktif Pro yalnızca Pro bucket'ını, Free yalnızca uygun deneme bucket'ını kullanır.** Deneme bakiyesi Pro'ya geçişte devretmez veya birleşmez; kendi bitiş tarihine kadar ayrı kayıtta kalır. Bir job birden fazla grant'e bölünmez. Bu basit davranış sonradan değişirse ayrı politika/transaction testi gerekir.

Batch başlangıçta yalnızca yerel rotadadır; cloud batch ilk ücretli kapsamda yoktur.

Cloud hak hesabı `ceil(outputDurationUs / 1_000_000)`. 20,2 saniye → 21 saniye; tam 20 saniye → 20 saniye. Quote kullanıcı kabulünden önce görünür. Kabul edilen tarifin süresi faturalama kaynağıdır; encoder'ın kare yuvarlaması tolerans içinde ise ek saniye alınmaz.

Her job'da reserve → başarıda commit; hata/iptalde release. İndirme tekrarı veya otomatik aynı-job retry ikinci kez harcatmaz. Tamamlanmış yeni bir render talebi yeni iş sayılır. Kaynak/çözünürlük/çıktı süre sınırları gerçek compute'u sınırlamak için de vardır; yalnızca final saniye hesabı maliyetin tamamını temsil etmez.

## Fiyat hipotezi

**Aylık 6,99 USD; yıllık 49,99 USD.** Bunlar vergi hariç iç analiz referanslarıdır. Yıllık eşdeğer yaklaşık 4,17 USD/ay; tahsilat 49,99 USD olarak yıllıktır. Aylığa göre yaklaşık %40,4 fiyat farkı vardır; kampanya metni güncel mağaza fiyatından hesaplanır, bölgesel fiyat değişince bu oran kopyalanmaz.

Mağazada kullanıcının yerel para birimi, vergisi, dönem ve yenileme koşulları checkout verisinden gösterilir. Türkiye fiyatı rastgele döviz çevirisiyle değil, küçük ödeme isteği araştırması + komisyon + vergi + yerel fiyat noktalarıyla ayrıca belirlenir. Bu paket TRY fiyatı uydurmaz.

Ücretsiz denemeyi kredi kartı zorunlu otomatik yenilenen bir deneme olarak başlatmama önerisi vardır. İlk temel Free zaten deneme işini görür. Yıllık planda 360 cloud dakikası peşin yüklenmez; 30 dakika her ay tahsis edilir.

## Paywall ve plan değişiklikleri

Paywall'da çalışır özellik listesi, platform sınırları, bulutun aylık kotası, toplam yıllık bedel, iptal/geri yükleme ve destek görünür. Web ve mobil süre sınırları farklıyken genel “Pro 30 dakika” ifadesi küçük yazıyla saklanmaz; “Mobil yerel projelerde 30 dakika” denir.

Bir kullanıcıda başka sağlayıcıdan etkin Pro varsa yeni aboneliğe yönlendirmeden önce mevcut hak ve yönetim kaynağı gösterilir. Plan iptali mevcut ödenmiş süreyi normalde bitirmez; geri ödeme/revoke ayrı durumdur. Ayrıntılar [billing belgesinde](16_BILLING_ENTITLEMENTS.md).

## Alternatif para kazanma deneyi

Düzenli tekrar veya ücretli iş akışı talebi çıkmazsa bir defalık **yerel-only lisans** hipotezi ayrı denenebilir. Yaşam boyu cloud/AI vaadi verilmez. Aynı anda üç abonelik, jeton, reklam kaldırma ve lifetime paketiyle karmaşa yaratılmaz.

Reklam/ödüllü video ilk ürün modeline dahil değildir. Ücretsiz core'a sürpriz filigran koymak gelir optimizasyonu varsayımı olarak kabul edilmez. Ücret değişikliği mevcut kullanıcı bildirim/mağaza koşulları ve hak etkisiyle ayrı sürüm olur.
