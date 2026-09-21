# 15 — Free, Pro, Fiyatlar ve Kanonik Kullanım Politikası

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Durum

**Bu belge bütün fiyat/kota sayıların tek kaynağıdır.** Bunlar pazar araştırmasıyla doğrulanmış ideal fiyatlar veya yapılmış özellikler değildir. P0/P1/P2 alfa-beta sırasında ödeme kapalıdır; teslim edilen temel özellikler ücretsiz denenir. P3 satış, gerçek Pro değeri + billing/restore + hukuk + destek + maliyet kapıları geçince açılır.

Politika kimliği: `2026-09-21.v2`. Limitler ürün güvenliği için başlangıç önerisidir; teknik motorların mutlak maksimum kapasitesi değildir. Daha fazla para ödemek desteklenmeyen codec/donanımı destekli yapmaz.

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
| Web yerel limitleri | 5 dakika çıktı / 60 dakika video girdi / 2 GiB toplam | İlk destek matrisinde aynı; Pro tarayıcı sınırını artırmaz |
| Tek projede kaynak/klip | En çok 5 video kaynağı, 20 klip, 1 harici müzik | İlk sürümde aynı |
| Harici müzik dosyası | En çok 10 dakika ve 100 MiB; toplam byte limitine dahil | Aynı |
| Kaydedilebilir çalışma profilleri | Yok; hazır temel oranlar ve ayarlar dahil | Yerelde kullanıcı profilleri; pratik disk sınırı |
| Proje kopyası / sürüm anlık görüntüsü | Temel otomatik kurtarma dahil | Açık kopya ve en çok 20 saklanan sürüm/proje |
| Yerel sıralı batch | Yok | En çok 10 çıktı varyantı; her biri platform limitine uyar |
| AI işlemleri | Yok | Başlangıç aboneliğine dahil değil |
| Kalıcı cloud arşivi / cihazlar arası medya senkronu | Yok | Yok |

GiB = 1.073.741.824 byte, MiB = 1.048.576 byte. Kullanıcı arayüzü hangi birimi gösteriyorsa gerçek kontrol aynı birimde yapılmalı. “2 GB” deyip farklı limit uygulama.

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

Paywall'da çalışır özellik listesi, platform sınırları, bulutun aylık kotası, toplam yıllık bedel, iptal/geri yükleme ve destek görünür. Webde 5 dakika sınırı varken genel “Pro 30 dakika” ifadesi küçük yazıyla saklanmaz; “Mobil yerel projelerde 30 dakika” denir.

Bir kullanıcıda başka sağlayıcıdan etkin Pro varsa yeni aboneliğe yönlendirmeden önce mevcut hak ve yönetim kaynağı gösterilir. Plan iptali mevcut ödenmiş süreyi normalde bitirmez; geri ödeme/revoke ayrı durumdur. Ayrıntılar [billing belgesinde](16_BILLING_ENTITLEMENTS.md).

## Alternatif para kazanma deneyi

Düzenli tekrar veya ücretli iş akışı talebi çıkmazsa bir defalık **yerel-only lisans** hipotezi ayrı denenebilir. Yaşam boyu cloud/AI vaadi verilmez. Aynı anda üç abonelik, jeton, reklam kaldırma ve lifetime paketiyle karmaşa yaratılmaz.

Reklam/ödüllü video ilk ürün modeline dahil değildir. Ücretsiz core'a sürpriz filigran koymak gelir optimizasyonu varsayımı olarak kabul edilmez. Ücret değişikliği mevcut kullanıcı bildirim/mağaza koşulları ve hak etkisiyle ayrı sürüm olur.
