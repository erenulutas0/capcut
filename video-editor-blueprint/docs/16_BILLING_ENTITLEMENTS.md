# 16 — Abonelik, Hak Doğrulama ve Kota Defteri

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Platforma uygun satın alma

Mobilde varsayılan yol Apple/Google mağaza billing sistemidir. Web checkout ayrı bir sağlayıcıdan geçebilir. Dış ödeme bağlantıları ve çok platformlu erişim kuralları storefront/programa göre değiştiğinden genel “her yerde link serbest/yasak” kuralı yazılmaz. Yayın bölgesi için güncel Apple ve Google politikası kontrol edilir; izin doğrulanmadan mobilde dış checkout CTA'sı açılmaz. [S20](35_SOURCES.md#s20) [S21](35_SOURCES.md#s21)

Pro değerinin sürekliliği gerçek özelliklerle gösterilmeli; sadece isim değiştirerek abonelik açılmamalı. Satın alma öncesi dönem ve toplam bedel açık olmalı. Mevcut web hakkını tanımak ile mobil kullanıcıyı dışarıda ödeme yapmaya yönlendirmek iki ayrı politika konusudur.

## Sağlayıcı ve kanonik hak

RevenueCat mobil mağaza durumunu normalize etmek için adaydır; içeride `pro` entitlement ve ayrı usage ledger bulunur. SDK'nın client-side bool'u sunucu izni değildir. [S24](35_SOURCES.md#s24)

Web için Lemon Squeezy adaydır: desteklenen payout ülkeleri listesinde Türkiye bulunması, şirketin/ürünün KYC ve hesap açılışının garanti kabulü değildir. Merchant kabulü, payout yöntemi ve sözleşme doğrulanmadan “web ödeme hazır” denmez. [S27](35_SOURCES.md#s27)

`account_id` bütün platformlarda aynıdır. RevenueCat App User ID olarak opaque canonical ID kullanılır; e-posta/telefon değil. Satın alma öncesi hesap açılır, guest proje yerelde korunur. Restore aynı mağaza hesabının doğrulanmış receipt'ini doğru canonical hesaba bağlar; sadece cihaz bilgisiyle başka hesaba transfer edilmez.

## Durum tablosu

| Durum | Yerel Pro | Cloud |
|---|---|---|
| active, paidThrough gelecekte | Geçerli doğrulanmış hak | Mevcut dönemin kullanılabilir hakkı |
| renewal canceled, paidThrough gelecekte | Süre sonuna kadar sürer | Süre sonuna ve kota politikasına kadar |
| billing retry / grace | Sağlayıcının doğruladığı yerel grace politikası varsa sınırlı devam | Yeni ödenmiş dönem doğrulanmadan yeni kota verilmez |
| expired | Free davranışı; dosya/proje korunur | Free deneme uygunluğu varsa o; yoksa yerel yol |
| refunded / revoked | Server güncellemesiyle kaldırılır; kısa offline pencere riski kaydedilir | Yeni işler durdurulur; kalan grant geri alınır |
| pending purchase | Pro açılmaz; durum sorgulanır | Kota oluşturulmaz |
| restore in progress | Son güvenli bilinen hak korunur | Sunucu sonucu gelene kadar yeni yetki yok |

Yenilemeyi iptal etmek anında hak silmek değildir. App silmek abonelik iptali değildir. Hesap silme de mağaza tahsilatını kendiliğinden iptal ettiği iddiasıyla sunulmaz; iptal ekranına güvenli yönlendirme ve açık açıklama yapılır.

## Offline önbellek

Server imzalı local entitlement token: account_id, entitlement, issued_at, authorized_until, expires_at, key_id. Önerilen maksimum cache ömrü 72 saat ve gerçek yetki sonundan uzun değil. Doğrulanmış yerel grace varsa `authorized_until` buna göre ayrıca verilir; client kendisi grace yaratmaz.

Free yerel yol bu token'a bağımlı değildir. Cloud her zaman server truth kullanır. İstemci saatini geri almakla sonsuz hak kazanımı azaltılır; yerel DRM'in mutlak güvenliği vaat edilmez. Refresh başarısızlığında kullanıcı videosu silinmez; Free limitleriyle devam yolu vardır.

## Webhook işleme

Provider auth/signature, raw body üzerinden doğrulanır; event inbox'a durable yazılıp hızlı kabul yanıtı verilir. Ayrı worker güncel sağlayıcı durumunu alır, entitlement'ı yeniden hesaplar. Tek event sırasına güvenerek eski iptal mesajıyla yeni aboneliği ezme.

RevenueCat'ın incelenen güncel belgesi HMAC imzası ve tekrar teslimleri açıklıyor. İmza raw JSON byte'ları üzerinden ve sabit zamanlı karşılaştırmayla doğrulanmalı; timestamp toleransı uygulama saatine göre kontrol edilir. Dedupe provider+event ID ile yapılır; imza doğrulaması tek başına dedupe değildir. [S25](35_SOURCES.md#s25)

Sandbox ve production ayrı namespace/kotalarda tutulur. Sandbox satın alması gerçek Pro/cloud hakkı yaratmaz. Provider API erişimi kesilirse son doğrulanmış durum, izlenebilir bekleyen kayıt ve reconciliation ile ele alınır; her webhook retry yeni grant vermez.

## Dönem ve yıllık plan

Aylık abonelikte gerçek sağlayıcı billing period sınırları esas alınır. Yıllıkta iç quota aylık pencerelere bölünür; başlangıç yıldönümünün UTC günü/saati anchor'dır. Ay sonu kısa ayda clamp edilir, sonraki ay orijinal güne dönülür.

Örnek: 31 Ocak 12:00 UTC başlangıç → 28 Şubat 12:00 UTC → 31 Mart 12:00 UTC. Şubat'a clamp olduktan sonra Mart'ı 28'e kaydırma. Leap year, timezone/DST, geç webhook ve duplicate grant testleri zorunlu. `subscription_id + allocation_window_start + policy_version` benzersizdir.

Dönem bitiminde unused monthly quota sona erer, yeni grant ödenmiş hakla açılır. Aktif reservation dönem sonunda aniden yeni grant'e taşınmaz; kabul edildiği grant'e bağlı kalır ve kısa job deadline içinde finalize olur. Geç job bu yüzden iki dönemi harcayamaz.

## Atomik kullanım örneği

180 saniye grant, 0 used. A işi 42 saniye reserve → available 138. Aynı anda B 150 saniye ister → reddedilir. A başarısız → reservation release, available tekrar 180. A success → used 42, available 138. Aynı success eventi tekrar gelirse değişiklik 0.

Release hem `reserved` azaltıp hem grant toplamına ekleyen çift iade algoritması değildir. Ledger immutable event + reservation state üzerinden hesaplanır; cached counter reconciliation ile doğrulanır.

## İadeler, destek ve yenileme

Parasal iadeler sağlayıcı/mağaza ve yürürlükteki tüketici kurallarıyla yönetilir; MD keyfî “iade yok” şartı koymaz. Cloud failure kota iadesi otomatik olmalıdır; tekrar tekrar kullanıcıdan destek isteme. İzinli subscription yönetim bağlantısı, restore, faturanın kimden geldiği ve makul destek yolu görünürdür.

İlk sürümde satın alınabilir ek kredi yoktur. Sonradan eklenirse consumable/non-expiring purchased credit ile dönem sonunda biten subscription allowance ayrı bucket ve mağaza değerlendirmesi gerektirir. Bir yıllık ödemeyi tek ay geliri veya tek seferde yıllık cloud hakkı olarak raporlama.
