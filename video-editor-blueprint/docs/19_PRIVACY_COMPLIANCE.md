# 19 — Gizlilik, KVKK/GDPR ve Mağaza Uyum Planı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Bu bir şirket özelinde hukuki görüş değildir

Türkiye'de kurulan/işletilen bir ürün ve Avrupa kullanıcı hedefi varsayımıyla riskler listelenmiştir. Veri sorumlusu şirket/kişi, faaliyet yeri, kullanıcı ülkeleri, tedarikçiler ve sözleşmeler henüz kesinleşmedi. Bu bilgiler olmadan örnek politika metni “yayına hazır” değildir.

GDPR ve KVKK açısından veri işleme amaçları, hukuki dayanak, şeffaflık, hak talepleri ve uluslararası aktarım gerçek akışa göre değerlendirilmelidir. Her işlem için otomatik “açık rıza aldık tamam” yaklaşımı kullanılmaz; amaç bazlı uygun dayanak ve zorunlu açıklamalar hukuk değerlendirmesinden geçer. [S37](35_SOURCES.md#s37) [S39](35_SOURCES.md#s39) [S40](35_SOURCES.md#s40)

## Veri envanteri

| Veri | Neden | Varsayılan konum | Yayın öncesi karar |
|---|---|---|---|
| Seçili kaynak video/ses | Kullanıcının düzenlemesi | Yerel cihaz | Bulut seçilmedikçe servis tarafında yok |
| EDL ve thumbnail | Proje/preview kurtarma | Yerel cihaz | Cache temizleme ve silme açıklaması |
| Hesap kimliği/e-posta | Cloud/Pro ve destek | Auth/API sağlayıcıları | Dayanak, saklama, DPA ve aktarım |
| Store işlem/hak metadata'sı | Ödeme erişimi/iadeler | Billing sağlayıcısı + API | Minimum alan, mali kayıt yükümlülüğü |
| Cloud kaynak/çıktı | Seçilen render işi | Private object storage | Açık rota bilgisi, retention, aktarım |
| Operasyon logu | Güvenlik ve hata giderme | Sınırlı log sistemi | IP/kimlik minimizasyonu ve süre |
| Ürün analitiği | Akış iyileştirme | İzinli/uygun analitik hizmeti | Hukuki dayanak, tercih, PII yasağı |
| Pazarlama e-postası | Kullanıcının seçtiği haberler | E-posta sağlayıcısı | Ayrı tercih/çıkış; hesap şartı değil |

Bir videoda yüz, konuşma, çocuk, sağlık veya ev içi özel bilgi bulunabilir. “Sadece video dosyası, kişisel veri değil” varsayımı yapılmaz. Yüz tanıma, reklam profilleme veya model eğitimi amacı ilk ürünün kapsamı değildir.

## Yerel işlem vaadi

Doğru ifade: “Yerel dışa aktarmada seçtiğin medya bu işlem için sunucuya gönderilmez.” Yanlış ifade: “Uygulama hiç veri göndermez” — hesap, billing, isteğe bağlı analitik veya update trafiği varsa doğru olmaz.

Cloud'a geçiş öncesi hangi dosyaların, neden, nerede/kim tarafından ve ne kadar süre işleneceği açıklanır. Seçim ekranı hukuki aydınlatmanın yerine geçen tek checkbox değildir; uygun metinlere bağlanır. Kullanıcının video üzerinde gerekli haklara sahip olması, veri sorumlusunun kendi yükümlülüklerini ortadan kaldırmaz.

## Aktarım ve tedarikçiler

Cloudflare/R2, auth, RevenueCat, web ödeme, e-posta ve hata analitik servisleri için ülke/alt işleyen/DPA/retention kaydı oluştur. “Sunucu Avrupa'da” tek başına bütün KVKK/GDPR aktarım risklerini çözmez. Türkiye için uygun aktarım mekanizması ve gerekiyorsa standard contract süreçleri uzmanla doğrulanır. [S39](35_SOURCES.md#s39) [S40](35_SOURCES.md#s40)

Tedarikçi onayı olmadan gerçek kişisel medya ile entegrasyon testi yapma; sentetik veya hakları bize ait fixture kullan. Provider'ın model eğitimi/veri kullanımı koşulları AI eklenince yeniden incelenir.

## Saklama önerileri — yasal süre olarak sunulmaz

Medya süreleri [cloud belgesindeki](14_CLOUD_JOBS_STORAGE.md) 24 saat kaynak/48 saat çıktı modelidir. Operasyon logları için 14 gün, sanitize crash kayıtları için 30 gün, ham doğrulanmış webhook payload'ı için erişimi kısıtlı ve şifreli en çok 7 gün başlangıç önerisi. Kanonik ödeme/iadeye gereken kayıtlar yasal muhasebe/saklama gerekliliklerine göre ayrıca belirlenir; bütün medya bunun bahanesiyle tutulmaz.

Hesap silme talebi hemen erişim/iş başlatmayı durdurur; canlı sistemde kişisel hesap verisini 7 gün içinde kaldırma hedefi; metadata backup döngüsünden en geç 30 günde düşme önerisi. Yasal olarak tutulması gereken dar kayıtlar açıkça ayrıştırılır. Bunlar altyapı ve hukuk onayı olmadan taahhüt edilmez.

Yedek geri yükleme, silinmiş hesapları tekrar aktif hale getirmemek için deletion tombstone/replay süreci içerir. Destek için kullanıcı kendi rızasıyla küçük dosya gönderirse ayrı amaç ve en çok 7 günlük silme hedefi açıklanır; otomatik saklama yoktur.

## Kullanıcı hakları ve mağaza beyanları

Hesap açılan sürümde uygulama içi silme ve gerekiyorsa webden erişilebilir silme talep yolu hazırlanır. Apple ve Google'ın hesap silme gereklilikleri ayrı doğrulanır; yalnızca “support'a mail at” her durumda yeterli varsayılmaz. [S35](35_SOURCES.md#s35) [S36](35_SOURCES.md#s36)

App Store privacy beyanı ve Google Data Safety formu gerçek SDK/envanterle eşleşmelidir. Lokal kalan medya ile cloud'da işlenen medya ayrı belirtilir. SDK otomatik tanımlayıcı/diagnostic topluyorsa formda unutulmaz. App silme, hesap silme ve abonelik iptali ayrı anlatılır.

Çocuklara yönelik ürün/pazarlama başlangıçta yoktur; yaş derecesi ve hizmet şartları ürün içeriği/ülke bazında doğrulanır. Basitçe “16+” yazmak bütün çocuk verisi yükümlülüklerini çözmez.

## Yayın kapısı

Gerçek veri sorumlusu bilgileri, çalışan iletişim kanalı, privacy/terms/cookie metinleri, sağlayıcı sözleşmeleri, silme testleri, medya erişim testi, mağaza formu ve gerçek feature flags aynı akışı tarif etmelidir. [Hukuki metin hazırlık taslağı](../templates/LEGAL_COPY_DRAFT.md) yalnızca yazım girdisidir.
