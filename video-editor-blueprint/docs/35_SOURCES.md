# 35 — Kaynaklar, Araştırma Sınırları ve Güncellik

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ARAŞTIRMA SİCİLİ
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Araştırma kaydı

Kaynak erişim/kontrol tarihi **19 Eylül 2026**. Öncelik resmî ürün, proje, platform ve düzenleyici kaynaklara verildi. Ürün fiyat/özellik ve mağaza kuralları değişebileceği için kodlama ve yayın gününde kritik başlıklar yeniden kontrol edilmelidir.

Her kaydın “desteklediği” ve “sınırı” ayrı yazıldı. Yazar/sağlayıcı özelliği açıklaması bağımsız kalite testi değildir. Bu paket gelir, indirme veya rakip kullanıcı memnuniyeti verisi uydurmaz. Araştırma sonuçlarıyla kendi önerilerimiz ayrı tutuldu.

<a id="s01"></a>

## S01 — Android — Media3 Transformer

**Kaynak:** [Android — Media3 Transformer](https://developer.android.com/media/media3/transformer)  
**Tür:** Resmî geliştirici dokümanı  
**Desteklediği:** Android düzenleme motoru adayı; trim/crop/transform yaklaşımı.  
**Sınır:** Cihaz/dosya bazlı başarının kanıtı değildir; gerçek spike gerekir.

<a id="s02"></a>

## S02 — Android — Transformer supported formats

**Kaynak:** [Android — Transformer supported formats](https://developer.android.com/media/media3/transformer/supported-formats)  
**Tür:** Resmî geliştirici dokümanı  
**Desteklediği:** Codec/donanım ve HDR desteğinin koşullu olması.  
**Sınır:** İncelenen sayfa 8 Eylül 2026 güncellemesi gösteriyordu; kurulum/release sırasında yeniden kontrol.

<a id="s03"></a>

## S03 — Apple — AVMutableComposition API

**Kaynak:** [Apple — AVMutableComposition API](https://developer.apple.com/documentation/avfoundation/avmutablecomposition)  
**Tür:** Resmî API giriş sayfası  
**Desteklediği:** Güncel API referansının konumu.  
**Sınır:** Sayfa JavaScript gerektirdiği için ayrıntılı API imzası bu çalışmada okunmuş sayılmadı; S04 kavramsal yardımcıdır.

<a id="s04"></a>

## S04 — Apple — AVFoundation Programming Guide: Editing

**Kaynak:** [Apple — AVFoundation Programming Guide: Editing](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/AVFoundationPG/Articles/03_Editing.html)  
**Tür:** Arşivlenmiş resmî rehber  
**Desteklediği:** Composition, audio mix, transform ve export kavramları.  
**Sınır:** Arşiv belgesidir; güncel Swift kodu veya API sürümü olarak kopyalanmaz.

<a id="s05"></a>

## S05 — Flutter — Platform channels

**Kaynak:** [Flutter — Platform channels](https://docs.flutter.dev/platform-integration/platform-channels)  
**Tür:** Resmî geliştirici dokümanı  
**Desteklediği:** Dart ile native platform kodu arasında entegrasyon yaklaşımı.  
**Sınır:** Seçilen köprü DTO/lifecycle tasarımı bizim önerimizdir.

<a id="s06"></a>

## S06 — Flutter — Build and release an iOS app

**Kaynak:** [Flutter — Build and release an iOS app](https://docs.flutter.dev/deployment/ios)  
**Tür:** Resmî geliştirici dokümanı  
**Desteklediği:** iOS build/signing için macOS/Xcode akışı.  
**Sınır:** Fiziksel cihazda medya doğrulaması ayrıca gerekir; bir CI build yeterli değildir.

<a id="s07"></a>

## S07 — FFmpegKit — Orijinal repository

**Kaynak:** [FFmpegKit — Orijinal repository](https://github.com/arthenica/ffmpeg-kit)  
**Tür:** Yazarın resmî repository kaydı  
**Desteklediği:** Orijinal projenin emekliliği/arşiv durumu ve Next devamına yönlendirme.  
**Sınır:** Bütün ekosistemin bakımının sona erdiği sonucu çıkarılmaz.

<a id="s08"></a>

## S08 — FFmpegKitNext — Official continuation

**Kaynak:** [FFmpegKitNext — Official continuation](https://github.com/arthenica/ffmpeg-kit-next)  
**Tür:** Yazarın resmî repository kaydı  
**Desteklediği:** Kaynak tabanlı devam projesinin varlığı; alternatif inceleme adayı.  
**Sınır:** Projede kurulmadı, derlenmedi veya performansı test edilmedi; otomatik seçilmiş dependency değildir.

<a id="s09"></a>

## S09 — Mediabunny — Introduction

**Kaynak:** [Mediabunny — Introduction](https://mediabunny.dev/guide/introduction)  
**Tür:** Resmî kütüphane dokümanı  
**Desteklediği:** Web medya araçları ve MPL-2.0 lisans bilgisi.  
**Sınır:** MIT değildir. Genel kabiliyet listesi cihazdaki bütün codec yollarını garanti etmez.

<a id="s10"></a>

## S10 — Mediabunny — Supported formats and codecs

**Kaynak:** [Mediabunny — Supported formats and codecs](https://mediabunny.dev/guide/supported-formats-and-codecs)  
**Tür:** Resmî kütüphane dokümanı  
**Desteklediği:** Codec uygunluğu ve ortam bazlı encode/decode kontrolü.  
**Sınır:** Actual file/config smoke render ile doğrulanacak; sadece API varlığı yeterli değil.

<a id="s11"></a>

## S11 — MDN — WebCodecs API

**Kaynak:** [MDN — WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)  
**Tür:** MDN API açıklaması  
**Desteklediği:** WebCodecs kavramları için yardımcı okuma.  
**Sınır:** Platform destek garantisi yerine kullanılmadı; birincil implementasyon için S09/S10 ve ilgili resmî API referansları esas.

<a id="s12"></a>

## S12 — ffmpeg.wasm — FAQ

**Kaynak:** [ffmpeg.wasm — FAQ](https://ffmpegwasm.netlify.app/docs/faq/)  
**Tür:** Projenin resmî SSS dokümanı  
**Desteklediği:** Performans/core lisansı konusunda alternatif değerlendirmesi.  
**Sınır:** Sayfadaki sayısal sınırlar bütün WebAssembly/tarayıcılar için evrensel limit olarak genellenmedi.

<a id="s13"></a>

## S13 — FFmpeg — Legal

**Kaynak:** [FFmpeg — Legal](https://ffmpeg.org/legal.html)  
**Tür:** Projenin resmî hukuk/lisans sayfası  
**Desteklediği:** Build bileşenlerine bağlı LGPL/GPL ve ayrı lisans değerlendirmesi.  
**Sınır:** Gerçek dağıtım/build için profesyonel inceleme yerine geçmez; patent lisansı sağlanmış değildir.

<a id="s14"></a>

## S14 — Android — Foreground service timeouts

**Kaynak:** [Android — Foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)  
**Tür:** Resmî geliştirici dokümanı  
**Desteklediği:** Uzun/arka plan işlerinde platform süre kısıtları.  
**Sınır:** Desteklenen OS/servis türüne göre uygulama ve test gerekir.

<a id="s15"></a>

## S15 — Apple WWDC25 — Background tasks session

**Kaynak:** [Apple WWDC25 — Background tasks session](https://developer.apple.com/videos/play/wwdc2025/227/)  
**Tür:** Resmî konferans oturumu, 2025  
**Desteklediği:** iOS 26 BGContinuedProcessingTask seçeneği ve uzun iş yaklaşımı.  
**Sınır:** 2025 sunumudur; bütün iOS sürümlerinde sınırsız background export garantisi değildir.

<a id="s16"></a>

## S16 — Microsoft Clipchamp — Pricing

**Kaynak:** [Microsoft Clipchamp — Pricing](https://clipchamp.com/en/pricing/)  
**Tür:** Resmî ürün/fiyat sayfası  
**Desteklediği:** Ücretsiz filigransız 1080p ve temel araç teklifinin varlığı.  
**Sınır:** Fiyat/özellikler değişebilir; hesapla uçtan uca rakip testi yapılmadı.

<a id="s17"></a>

## S17 — VN — Official website

**Kaynak:** [VN — Official website](https://www.vlognow.me/)  
**Tür:** Resmî ürün sayfası  
**Desteklediği:** Karşılaştırılacak mobil video editörünün konumu.  
**Sınır:** Site içindeki seçilmiş yorumlar bağımsız kullanıcı memnuniyeti kanıtı kabul edilmedi.

<a id="s18"></a>

## S18 — Meta — Introducing Edits

**Kaynak:** [Meta — Introducing Edits](https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/)  
**Tür:** Resmî ürün duyurusu, Nisan 2025  
**Desteklediği:** Edits ürününün duyurusu ve video üretim bağlamı.  
**Sınır:** Bütün 2026 özelliklerini doğrulayan güncel fiyat/özellik tablosu değildir.

<a id="s19"></a>

## S19 — CapCut — Official website

**Kaynak:** [CapCut — Official website](https://www.capcut.com/)  
**Tür:** Resmî ürün giriş adresi / araştırma giriş noktası  
**Desteklediği:** Rakip deneyi için resmî ürün adresi.  
**Sınır:** Bölge/hesap/plan bazlı fiyat ve tüm akışlar doğrulanmadı; şikâyet veya gelir iddiası türetilmedi.

<a id="s20"></a>

## S20 — Apple — App Review Guidelines

**Kaynak:** [Apple — App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)  
**Tür:** Resmî mağaza politikası  
**Desteklediği:** Dijital satın alma/abonelik/çok platformlu erişim ve storefront ayrımları için temel kaynak.  
**Sınır:** Genel özet mağaza incelemesi veya hukuk onayı yerine geçmez; yayın bölgesinde yeniden kontrol edilir.

<a id="s21"></a>

## S21 — Google Play — Payments policy

**Kaynak:** [Google Play — Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)  
**Tür:** Resmî mağaza politikası  
**Desteklediği:** Play üzerinden dijital hizmet ödeme kuralı ve istisnalar.  
**Sınır:** Bölgesel programlar ve kullanıcı yönlendirmesi release sırasında ayrıca doğrulanır.

<a id="s22"></a>

## S22 — Google Play — Service fees

**Kaynak:** [Google Play — Service fees](https://support.google.com/googleplay/android-developer/answer/112622)  
**Tür:** Resmî güncel ücret tablosu  
**Desteklediği:** 30 Haziran 2026 sonrası bölgesel servis/billing ücret ayrımı ve diğer pazar tabloları.  
**Sınır:** %15 baz/%30 stres değerleri model senaryosudur; her satışın gerçek oranı değildir.

<a id="s23"></a>

## S23 — Apple — App Store Small Business Program

**Kaynak:** [Apple — App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/)  
**Tür:** Resmî program sayfası  
**Desteklediği:** Uygun ve kabul edilmiş geliştiriciler için açıklanan küçük işletme komisyonu.  
**Sınır:** Kurucunun uygunluğu veya programa kaydı doğrulanmadı.

<a id="s24"></a>

## S24 — RevenueCat — Entitlements

**Kaynak:** [RevenueCat — Entitlements](https://www.revenuecat.com/docs/getting-started/entitlements)  
**Tür:** Resmî entegrasyon dokümanı  
**Desteklediği:** Ürünlerden erişim hakkı türetme modeli.  
**Sınır:** Cloud usage defteri ve canonical account uygulama sorumluluğudur.

<a id="s25"></a>

## S25 — RevenueCat — Webhooks

**Kaynak:** [RevenueCat — Webhooks](https://www.revenuecat.com/docs/integrations/webhooks)  
**Tür:** Resmî entegrasyon dokümanı  
**Desteklediği:** Auth/HMAC, tekrar teslim ve güncel durumla senkronizasyon.  
**Sınır:** Gerçek endpoint kurulmadı; HMAC açık değilken varmış gibi kabul edilmez.

<a id="s26"></a>

## S26 — RevenueCat — Pricing

**Kaynak:** [RevenueCat — Pricing](https://www.revenuecat.com/pricing/)  
**Tür:** Resmî fiyat sayfası  
**Desteklediği:** İnceleme tarihinde aylık izlenen gelir eşiği ve %1 fiyat yapısı.  
**Sınır:** Sözleşme/kapsam/hesap koşulları satın alma öncesi tekrar doğrulanır.

<a id="s27"></a>

## S27 — Lemon Squeezy — Supported countries

**Kaynak:** [Lemon Squeezy — Supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)  
**Tür:** Resmî sağlayıcı dokümanı  
**Desteklediği:** Türkiye banka payout listesinde yer alıyor.  
**Sınır:** Şirket/ürün/KYC kabulü garanti değildir; hesap açılışı bu çalışmada yapılmadı.

<a id="s28"></a>

## S28 — Lemon Squeezy — Pricing

**Kaynak:** [Lemon Squeezy — Pricing](https://www.lemonsqueezy.com/pricing)  
**Tür:** Resmî fiyat sayfası  
**Desteklediği:** Temel %5 + 0,50 USD teklifi.  
**Sınır:** Ek ücretler S29; bu başlık tek başına tam efektif fee değildir.

<a id="s29"></a>

## S29 — Lemon Squeezy — Fees

**Kaynak:** [Lemon Squeezy — Fees](https://docs.lemonsqueezy.com/help/getting-started/fees)  
**Tür:** Resmî sağlayıcı dokümanı  
**Desteklediği:** Abonelik/uluslararası/PayPal/payout ekleri ve vergi dahil fee tabanı örneği.  
**Sınır:** Belgede hesaplanan netler vergi yok varsayımlı senaryodur; muhasebe sonucu değildir.

<a id="s30"></a>

## S30 — Stripe — Global availability

**Kaynak:** [Stripe — Global availability](https://stripe.com/global)  
**Tür:** Resmî sağlayıcı uygunluk sayfası  
**Desteklediği:** Merchant ülke uygunluğunu doğrulamak için giriş kaynağı.  
**Sınır:** Bu projeye Stripe hesabı açılabildiği veya açılamadığı sonucu teyit edilmedi; yığında zorunlu değil.

<a id="s31"></a>

## S31 — Cloudflare R2 — Pricing

**Kaynak:** [Cloudflare R2 — Pricing](https://developers.cloudflare.com/r2/pricing/)  
**Tür:** Resmî altyapı fiyat dokümanı  
**Desteklediği:** Standart depolama/istek maliyeti ve R2 egress koşulu.  
**Sınır:** Compute, diğer ağ ücretleri, vergi ve veri aktarımı uyumu hariç; 7 Ağustos 2026 güncellemesi görüldü.

<a id="s32"></a>

## S32 — OWASP — File Upload Cheat Sheet

**Kaynak:** [OWASP — File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)  
**Tür:** OWASP birincil güvenlik rehberi  
**Desteklediği:** Dosya işleme/yükleme için katmanlı doğrulama ve erişim kontrolü.  
**Sınır:** Kontrollerin uygulanması ve test edilmesi gerekir; tek tarama güvenlik garantisi değildir.

<a id="s33"></a>

## S33 — Spotify — Developer Policy

**Kaynak:** [Spotify — Developer Policy](https://developer.spotify.com/policy)  
**Tür:** Resmî platform politikası  
**Desteklediği:** Görsel medya ile kayıt senkronizasyonu konusunda API erişiminin sınırları.  
**Sınır:** Müzik için ülke/eser özelinde hukuki görüş veya lisans sağlamaz.

<a id="s34"></a>

## S34 — Google Play — App testing requirements for new personal accounts

**Kaynak:** [Google Play — App testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)  
**Tür:** Resmî yayın/test yönergesi  
**Desteklediği:** Bazı yeni kişisel hesapların production öncesi kapalı test gereksinimi.  
**Sınır:** Kullanıcının hesabına uygulanıp uygulanmadığı ve güncel sayılar konsolda kontrol edilmeli.

<a id="s35"></a>

## S35 — Google Play — Account deletion requirements

**Kaynak:** [Google Play — Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)  
**Tür:** Resmî mağaza veri politikası açıklaması  
**Desteklediği:** Hesap açılan ürünlerde silme akışının mağaza beklentileri.  
**Sınır:** Gerçek form ve endpoint testi yapılmadı.

<a id="s36"></a>

## S36 — Apple — Offering account deletion in your app

**Kaynak:** [Apple — Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)  
**Tür:** Resmî geliştirici destek yönergesi  
**Desteklediği:** Uygulama içi hesap silme hazırlığı.  
**Sınır:** Abonelik iptali ve hesap verisi silme ayrı ele alınır.

<a id="s37"></a>

## S37 — European Union — GDPR official text

**Kaynak:** [European Union — GDPR official text](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)  
**Tür:** Resmî mevzuat metni  
**Desteklediği:** Amaç, dayanak, veri hakları ve aktarım değerlendirmesi için kaynak.  
**Sınır:** Uygulama/ülke kapsamı ve yorum profesyonel inceleme ister.

<a id="s38"></a>

## S38 — KVKK — Kurum resmî sitesi

**Kaynak:** [KVKK — Kurum resmî sitesi](https://www.kvkk.gov.tr/)  
**Tür:** Resmî kurum  
**Desteklediği:** Güncel mevzuat/rehber erişim noktası.  
**Sınır:** Somut uyum belgesi veya kuruma yapılmış başvuru değildir.

<a id="s39"></a>

## S39 — KVKK — Standart Sözleşmeler

**Kaynak:** [KVKK — Standart Sözleşmeler](https://www.kvkk.gov.tr/Icerik/7929/Standart-Sozlesmeler)  
**Tür:** Resmî kurum rehber/doküman sayfası  
**Desteklediği:** Yurt dışı aktarım mekanizması incelemesi için kaynak.  
**Sınır:** İlgili sözleşme seçilmedi/imzalanmadı; belge ve bildirim gereklilikleri uzmanla değerlendirilir.

<a id="s40"></a>

## S40 — KVKK — Yurt Dışına Aktarım

**Kaynak:** [KVKK — Yurt Dışına Aktarım](https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim)  
**Tür:** Resmî kurum açıklaması  
**Desteklediği:** Türkiye bağlamında uluslararası aktarım risklerinin değerlendirilmesi.  
**Sınır:** EU sunucu veya genel checkbox ile otomatik uygunluk sonucu çıkarılmaz.

<a id="s41"></a>

## S41 — W3C — Web Content Accessibility Guidelines 2.2

**Kaynak:** [W3C — Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)  
**Tür:** Resmî W3C standardı  
**Desteklediği:** Erişilebilirlik kabul çerçevesi.  
**Sınır:** 44/48 hedef alanı ürün tercihidir; AA sayısal şartı diye yanlış etiketlenmedi.

<a id="s42"></a>

## S42 — Google Search — Helpful, reliable, people-first content

**Kaynak:** [Google Search — Helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)  
**Tür:** Resmî arama rehberi  
**Desteklediği:** Görev çözen özgün içerik/araç sayfası yaklaşımı.  
**Sınır:** Sıralama, trafik veya dönüşüm garantisi sağlamaz.

## Tekrar doğrulama sırası

Kod başlangıcında native/browser API sürümleri, FFmpeg/Mediabunny lisansı ve exact dependencies. Ödeme entegrasyonunda provider uygunluğu, ücretler ve mağaza yönlendirme kuralları. Yayından önce hesap silme/privacy beyanı, veri aktarımı, müzik lisansları ve gerçek destek matrisi. Fiyat/kota değişiminde mevcut kullanıcı hakları ve güncel provider şartları.

## Bu araştırmada yapılmayanlar

Rakiplerin ücretli hesaplarıyla tam görev karşılaştırması; arama hacmi/keyword veri seti; TAM/gelir tahmini; gerçek kullanıcı görüşmesi; cihaz benchmark'ı; hesap/KYC açılışı; hukuk veya bağımsız güvenlik onayı. İlgili belgeler bunları yapmanın yöntemini verir, yapılmış olduğunu iddia etmez.
