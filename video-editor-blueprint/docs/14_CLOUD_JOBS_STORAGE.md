# 14 — Bulut İşleri, Saklama ve Maliyet Sınırları

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Bulutun rolü

P3'te desteklenen yerel rotaya alternatif, açık seçimli ve kotalı işlemedir. Kalıcı arşiv veya sınırsız video dönüştürme servisi değildir. Kullanıcının kaynağını gizlice yüklemek, kota bitince yerel dosyasını kilitlemek ve “Pro her dosyayı işler” demek yasaktır.

## Job durum makinesi

`created → waiting_assets → queued → running → validating → succeeded`.

Yan terminal durumlar `failed`, `canceled`, `expired`. Geçişler compare-and-set ve worker lease epoch ile korunur. Terminal durum tekrar değişmez; success/cancel yarışında atomik olarak ilk tamamlanan geçiş esas alınır. Önceden başarıyla teslim edilen işin ardından gelen cancel talebi ikinci kota iadesi yaratmaz.

Upload/quote sırasında cloud saniyesi düşülmez. Job kabulünde reserve edilir. Başarıda canonical tarifin yukarı yuvarlanmış çıktı saniyesi bir kez commit edilir. Başarısız/iptal/expired işte reserve bırakılır. Altyapının gerçekten harcadığı CPU maliyeti ayrı deftere gider; kullanıcıya ücretsiz başarısızlık şirket için maliyetsiz değildir.

## İş sınırları — P3 başlangıç önerisi

Per hesap aynı anda bir aktif render, en fazla iki bekleyen job. Queue bekleme hedef üst sınırı 10 dakika; tek render attempt için 15 dakika hard timeout; toplam job deadline 40 dakika. En fazla bir otomatik tekrar yalnızca geçici altyapı hatasında; bozuk dosya, deterministik codec hatası veya pahalı timeout otomatik tekrar döngüsüne sokulmaz.

Worker heartbeat 30 saniye; lease 2 dakika; her lease yenilemesinde fencing korunur. Reservation normalde en çok 45 dakika tutulur; terminal job veya geçerli lease durumu kontrol edilmeden sadece duvar saatiyle bırakılıp çalışan işe bedava hak verilmez. Sweeper tutarsızlıkları terminalleştirir ve defteri onarır.

Sayılar gerçek benchmark değildir. Worker concurrency, CPU/RAM/disk sınırı ve job timeout ölçülen dosya maliyetine göre ayarlanır. [Kanonik plan limitleri](15_PRICING_FREE_PRO.md) bu operasyonel sınırlarla birlikte değerlendirilir.

## Güvenli derleyici ve worker

İstemci yalnızca doğrulanmış EDL gönderir; FFmpeg filtre/komut satırı göndermez. Sunucu izinli codec, crop, gain ve süre alanlarından argüman listesi üretir. Shell interpolation yok, `shell=false`, özel temp dizini, rastgele sunucu dosya adları, read-only runtime ve minimum yetki.

Worker arbitrary internet URL fetch etmez; kendisine atanmış private asset'leri servis katmanı kontrollü şekilde staging alanına getirir. Decode/render sırasında ağ erişimi kapalı veya sıkı allowlist olmalı. Container tek başına yeterli varsayılmaz; seccomp/namespace/CPU-memory/disk/process/time sınırları işletilir. Dosya yükleme riskleri için savunma katmanları resmî OWASP rehberinden yararlanır. [S32](35_SOURCES.md#s32)

## Saklama politikası — yayın öncesi uygulanıp onaylanacak

| Veri | Önerilen yaşam süresi |
|---|---|
| Tamamlanmamış upload parçaları | Başlangıçtan 24 saat sonra temizleme |
| Tamamlanmış cloud kaynakları | Upload finalize zamanından 24 saat sonra silme |
| Başarılı çıktı | Başarı zamanından 48 saat sonra silme |
| İptal/başarısız işin artık kullanılmayan medyası | Hemen silme kuyruğu; en geç 24 saat hedefi |
| Worker temp | İş biterken silme; periyodik orphan süpürme |
| Yerel kullanıcı kaynakları | Bu servis tarafından silinmez |

Aktif job kabulünde asset'in kalan ömrü job deadline'ını güvenle karşılamalı; en az 60 dakika kalan kaynak ömrü önerilir. Süresi dolacak asset'e job kabul edilmez. API expiry anında erişimi keser; object fiziksel silme başarısı ayrıca denetlenir. Lifecycle kuralı tek başına silme kanıtı değildir.

Medya objeleri kalıcı backup'a alınmaz. Metadata yedek ve hesap silme süreleri [gizlilik belgesinde](19_PRIVACY_COMPLIANCE.md). Destek için kullanıcının videosunu ayrıca saklama varsayılan kapalıdır. “İndirmen için 48 saat tutulacak” metni ancak gerçek süpürme/erişim sistemi kurulunca yayımlanır.

## Private object storage

Opaque key, owner binding, kısa ömürlü imzalı URL, content-length sınırı, tamamlanınca gerçek byte/probe kontrolü. Bucket public değildir. Filename ve imzalı URL loglara yazılmaz; destek personeli için doğrudan dosya gezgini açılmaz. Kaynak ile çıktı farklı prefix/erişim politikalarında tutulur.

R2 standart depolama için incelenen listede 0,015 USD/GB-ay, Class A 4,50 USD/milyon ve Class B 0,36 USD/milyon işlem; R2 egress ücreti yok. Bunlar encode, diğer servis trafiği ve destek maliyetinin yok olduğu anlamına gelmez. Bölgesel/veri aktarımı uygunluğu ayrı kapıdır. [S31](35_SOURCES.md#s31)

## Kötüye kullanım ve bütçe

Deneme hakkı doğrulanmış hesap ve tekil grant ile verilir; günlük IP/account hız kısıtı yardımcı sinyaldir, paylaşılan ağdaki herkesi otomatik suçlu sayma. İnvaziv cihaz parmak izi varsayılan yok. Hesap silip yeniden denemeyi sınırlayan minimum veri saklama ancak hukuki amaç/süre onayıyla uygulanır.

Ücretsiz cloud beta için önerilen toplam deney bütçesi 50 USD ve günlük 5 USD kontrol limiti; bunlar satın alınmış kaynak veya kullanıcı taahhüdü değildir. Ücretli hizmet açıldığında kapasite bütçesi satılan hakları karşılayacak şekilde yeniden hesaplanır. Bütçe alarmında önce yeni promosyonlar ve yeni denemeler durur; mevcut ücretli haklar sessizce yok edilmez. Kesintide durum mesajı, yerel alternatif ve uygun telafi süreci gerekir.
