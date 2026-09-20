# 18 — Tehdit Modeli ve Güvenlik Gereksinimleri

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Korunan varlıklar ve güven sınırları

Varlıklar: kullanıcının özel video/sesi, orijinal dosyası, proje tarifi, hesap kimliği, ödeme hakkı, cloud kredisi, provider secret'ları, derleme imzaları ve servis kapasitesi. Sınırlar: kullanıcı dosyası→decoder; UI→native; istemci→API; API→store/provider; API→worker; worker→private storage; support→hesap verisi.

Yerel dosya da güvenilmeyen girdidir. Cloud kullanılmasa bile bozuk medya parser'ı ve disk kullanımı riski vardır. Backend `content_type` ve dosya uzantısını gerçek format yerine kabul etmez. Dosya yüklemede allowlist, boyut sınırı, yetki ve izolasyon birlikte kullanılır. [S32](35_SOURCES.md#s32)

## Tehdit ve kontrol matrisi

| Tehdit | Kontrol önerisi | Test |
|---|---|---|
| Başka kullanıcı asset/job erişimi | Her sorguda owner scope; private bucket; opaque ID | A hesabı B ID'siyle GET/DELETE/download ister |
| Sahte Pro veya receipt replay | Server-side provider doğrulaması; canonical binding | Aynı transaction başka hesapta kullanılır |
| Webhook sahteciliği/tekrar | Auth/HMAC, timestamp, event unique, reconciliation | Bozuk imza, eski body, duplicate, out-of-order |
| Kota yarışı | DB lock/transaction, job unique, idempotency | Son 60 saniye için 20 paralel istek |
| Komut/filter injection | Allowlist recipe compiler, shell yok, arbitrary filter yok | Noktalama/çok uzun input/name payload |
| SSRF/private network erişimi | URL import yok; worker render sırasında ağsız | Metadata içinde URL, playlist, protocol denemesi |
| Parser açığı/bozuk medya | Güncel build, sandbox, minimum yetki, fuzz corpus | Truncated MP4, bozuk atom, aşırı track sayısı |
| Resource exhaustion | Byte/duration/dimension/frame/track caps, timeout | Küçük byte ama dev çözünürlük/süre beyanı |
| Disk taşması/cache race | Ayrı temp, quota, cleanup lease | Tam disk, aktif cache temizleme |
| XSS/analytics sızıntısı | Escape, CSP, editörde session replay yok | Dosya adı/script benzeri proje başlığı |
| Local path traversal | Platform handle repository; kullanıcıdan path kabulü yok | `../`, encoded separator, symlink senaryoları |
| Tedarik zinciri | Lockfiles, checksum, SBOM, lisans/security review | Beklenmeyen dependency/binary farkı |
| Hesap ele geçirme | Yönetilen auth, kısa oturum, hassas işte yeniden doğrulama | Session revoke/account-link testleri |

## Kaynak bütçeleri

Upload byte limiti object tamamlanınca tekrar denetlenir. Container header'ındaki duration/dimensions gerçeğe aykırı olabilir; decode bütçesi ayrıca uygulanır. Input sayısı, stream/track sayısı ve çıktı piksel bütçesi allowlist'tir; sınırsız metadata/track parsellenmez.

Worker non-root, salt okunur uygulama dosyaları, tek job temp alanı, minimum servis kimliği, process/memory/CPU/elapsed-time limitiyle çalışır. Bulut provider token'ı codec process environment'ına aktarılmamalı; staging/downloading işini daha dar ayrı bileşen yapabilir. Container kaçışı riski yokmuş gibi davranılmaz; host patching ve least privilege sürdürülür.

## Local güvenlik

Seçilmeyen galeri içeriği taranmaz. Büyük dosyayı copy etmeden önce alan/izin kontrolü yapılır. Projeden asset silmek cihaz kaynak dosyasını silmez. Sahte `.mp4` dosyası açılması kontrol edilen hata olmalı. Platform decoder crash'i uygulama seviyesinde gözlemlenip kaynak/proje kaybına dönüşmemeli.

App logları path, gerçek filename, medya hash'i veya kişisel görüntü içermez. Crash attachments ekran/video yakalamaz. Kullanıcı cihazında root/jailbreak gibi ortamların hak korumasını sınırsız güçle garanti etmeyiz; cloud yetkisi yine server'dadır.

## Secret ve erişim

Store private keys, webhook secrets, DB password ve signing key CI secret manager'da; least privilege ve ayrı staging/production. Secret erişimi build/test loguna dökülmez. Key rotation runbook'u ve acil revoke yolu mevcut olmalı. Geliştirici kendi admin hesabında MFA kullanır.

Support rolü job status/anonim hata kodunu görebilir; medya indirmek için genel izin yok. Özel destek upload'ı ayrı kullanıcı onayı ve süreyle değerlendirilir. Yönetici her hesap için Pro toggle yapabilse bile işlem neden/aktör/audit kaydı gerektirir.

## Yayın engelleri

Yetkisiz başka hesaba erişim, reproducible medya kaybı, doğrulanmamış webhook'tan hak açılması, sınırsız cloud kaynak tüketimi veya üretim secret sızıntısı varsa release yapılmaz. Otomatik tarama “0 bulgu” sonucu güvenlik denetimi yerine geçmez.

İlk cloud/billing yayını öncesi en az bağımsız bir teknik gözle auth/ownership/ledger incelemesi önerilir. Bug bounty veya penetrasyon testi yapılmış gibi etiket kullanılmaz. Olay müdahalesi [operasyon belgesinde](24_OBSERVABILITY_OPERATIONS.md).
