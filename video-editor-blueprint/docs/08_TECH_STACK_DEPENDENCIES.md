# 08 — Teknoloji Yığını, Lisanslar ve Bağımlılık Politikası

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Önerilen yığın

| Katman | Seçim | Kurulum öncesi doğrulama |
|---|---|---|
| Mobil UI | Flutter/Dart stable | Gerçek mevcut stable sürüm; minimum OS; lockfile |
| Android medya | Kotlin + Media3 Transformer | Seçili dosyada trim/crop/mix/export; donanım codec'i |
| iOS medya | Swift + AVFoundation | Composition/audio mix/export; orientation ve dosya izinleri |
| Web | Next.js/React/TypeScript | Client-only editör, worker derleme ve CSP uyumu |
| Web medya | WebCodecs + Mediabunny adayı | Gerçek encode/decode, mux, AAC, lisans yükümlülükleri |
| API | Python/FastAPI | Pydantic sözleşmeleri, async I/O sınırı, auth adapter |
| Veritabanı | PostgreSQL | Migration, transaction, backup/restore |
| Bulut render | İzole FFmpeg CPU worker | Build flags, codec lisansı, resource cap, fixture doğruluğu |
| Geçici nesne saklama | R2 adayı veya uygun bölgesel S3 hizmeti | KVKK/GDPR aktarımı, DPA, lifecycle, maliyet |
| Mobil billing | RevenueCat adayı + store billing | Ülke/plan koşulları, webhook ve restore testi |
| Web billing | Lemon Squeezy adayı | Ürün/şirket kabulü, KYC, banka payout, vergi/fee koşulları |

Güncel paket versiyonları bu belgeye tahminle yazılmadı. İlk spike gününde resmi kaynaklardan seçilir, ADR'ye tarih ve exact version kaydedilir; lockfile repoya alınır. “latest” etiketiyle tekrarlanamaz build bırakılmaz.

## FFmpegKit düzeltmesi

Orijinal FFmpegKit emekli/arşivli durumdadır; ancak Temmuz 2026'da aynı yazarın **FFmpegKitNext** devam projesi bulunmaktadır. Bu nedenle “FFmpegKit ekosistemi tamamen bitti” sonucu doğru olmaz. Next kaynak koddan derleme yükü ve proje kapsamı ayrıca değerlendirilmelidir. Native motor tercihimiz, Next'in olmadığı varsayımına değil, ilk ürünün kontrollü medya ihtiyacına dayanır. [S07](35_SOURCES.md#s07) [S08](35_SOURCES.md#s08)

## Lisans sicili

Mediabunny **MPL-2.0** lisanslıdır; MIT diye kaydedilmez. Dağıtılan kod, değiştirilen MPL kapsamındaki dosyalar ve kaynak erişimi yükümlülükleri ürünün gerçek kullanımı üzerinden incelenir. [S09](35_SOURCES.md#s09)

FFmpeg'in kullanılabilir lisansı build bileşenlerine bağlıdır; bazı opsiyonel bileşenler GPL etkisi doğurur. Codec patent hakları ayrı konudur. Sunucuda çalıştırma ile istemciye WASM/native binary dağıtımı aynı değerlendirme değildir. “FFmpeg ücretsiz, her şey serbest” varsayımı kullanılmaz. [S13](35_SOURCES.md#s13)

ffmpeg.wasm bir ihtiyaç halinde araştırılabilecek alternatiftir; ilk mobil/web üretim hattının otomatik seçimi değildir. Performans ve dağıtılan core lisansı ayrıca incelenir. [S12](35_SOURCES.md#s12)

## Zorunlu dependency kaydı

Her bağımlılık için ad, tam sürüm, official URL, lisans SPDX, değiştirilen dosyalar, derleme bayrakları, transitive bağımlılıklar, dağıtım yeri, son güvenlik kontrolü, kaldırma/güncelleme yolu tutulur. Binary artifact için kaynak commit ve checksum bulunur. THIRD_PARTY_NOTICES dosyası gerçek dependency seçildikten sonra gerçek içerikle oluşturulur; şimdiden hayali bir lisans manifesti hazırlanmaz.

## Neyi eklemiyoruz?

Başlangıçta Redis/PubSub, ayrı analytics warehouse, Kubernetes, GPU API, farklı dillerde beş backend, ağır animation framework ve hazır stock media SDK zorunlu değildir. Yerel alfa için hesap/ödeme sunucusu da zorunlu değildir. Bulut açılınca queue ve server-side usage gerçekten gerekir.

AI kod ajanı bir Flutter paketi popüler diye native media pipeline'a bağımlı yapamaz. P0 kanıtı ve bakım/lisans kaydı olmadan çekirdek paket kabul edilmez.
