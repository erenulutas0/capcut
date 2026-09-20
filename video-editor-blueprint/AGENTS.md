# Kod Ajanları İçin Çalışma Sözleşmesi

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Uygulama sınırı

Bu depo önce bir ürün spesifikasyonudur. “Tüm MD'leri uygula” ifadesini bütün fazları tek seferde inşa etme yetkisi olarak yorumlama. İlk çalışma yalnızca [33_FIRST_PROMPT](docs/33_FIRST_PROMPT.md) kapsamındadır. Yeni faza ancak ilgili kabul kanıtları ve kurucu onayıyla geçilir.

## Her görevde okunacaklar

`README.md`, `docs/04_PRD_SCOPE.md`, `docs/07_ARCHITECTURE_ADR.md`, `docs/10_PROJECT_SCHEMA_CONTRACTS.md`, `docs/22_QA_TEST_MATRIX.md`, verilen görev. Kota/ödeme değişiyorsa `docs/15_PRICING_FREE_PRO.md` ve `docs/16_BILLING_ENTITLEMENTS.md`; dosya/bulut etkileniyorsa güvenlik ve gizlilik belgeleri de okunur.

## Değişmez kurallar

- Orijinal medya üzerine yazma. Arızada proje tarifini ve mevcut kullanıcı verisini koru.
- Kullanıcı açıkça bulut işlemeyi seçmeden hiçbir video, ses, thumbnail veya transkript yükleme.
- Ücretsiz yerel editörü oturum, abonelik sunucusu veya analitik erişimine bağımlı yapma.
- Kaynak kodda secret, servis hesabı, gerçek müşteri medyası veya imzalı uzun ömürlü URL tutma.
- Kanonik zamanı integer mikrosaniye ve yarı açık aralıklarla temsil et; kayan noktalı saniyeleri iş kuralı kaynağı yapma.
- Frontend'den gelen `isPro`, fiyat, kota, süre veya dosya tipi beyanına sunucuda güvenme.
- Rastgele paket kurma. Bakım, lisans, güvenlik ve platform uygunluğunu doğrula; sürümü kilitle.
- FFmpeg komutu/URL'si kullanıcı girdisi olamaz; izinli tarif derleyicisi dışında çalıştırma.
- Sahte başarı ekranı, gerçek olmayan export ilerlemesi, boş implementasyona “tamamlandı” raporu, çalıştırılmamış teste “geçti” yazma.
- Kaynaklarda okunmayan API davranışlarını varsayma. İlgili resmî sürüm dokümanını kontrol et.
- Gerçek ödeme, mağazaya yayın, ücretli kaynak oluşturma, DNS/domain değişikliği, üretim deploy'u veya veri silme için ayrı açık yetki gerekir.

## Mimari disiplin

UI → uygulama kullanım durumu → domain → port → platform adaptörü. Domain Flutter widget, React hook, FFmpeg CLI veya ödeme SDK'sına bağımlı olmaz. Tek bir ekran için gereksiz framework/soyutlama üretme; test edilebilir sınır için gereken en küçük tasarımı seç.

Ortak olan sözleşme ve fixture'lardır, her platformun render implementasyonu değildir. Dart, TypeScript ve backend aynı geçerli/geçersiz JSON örneklerini çalıştırır. Özellik unsupported ise erken ve anlaşılır hata ver; sessiz kalite düşürme veya buluta kaçış yapma.

## Görev sonu raporu

Rapor şu bilgileri içersin: değişen dosyalar; uygulanan kabul kriterleri; gerçekten çalıştırılan komutlar ve sonuçları; çalıştırılamayan cihaz/araçlar; bilinen eksikler; tek sonraki görev. Kullanıcının daha önce yaptığı değişiklikleri koru. Kapsam dışı refactor yapma.

`TODO`, test double veya stub gerekiyorsa üretim yolu olarak kullanılmasın ve raporda açıkça sayılsın. CI veya fiziksel cihaz erişimi yoksa hazır script üretilebilir, fakat sonuç üretilmiş sayılmaz.

## Çelişki yönetimi

Güvenli ve geri alınabilir teknik kararlarla ilerle; belirsizliği ADR taslağına kaydet. Ücret, veri paylaşımı, telif hakkı, kapsam genişletme veya geri alınamaz işlem belirsizliğinde varsayımla canlı davranış açma.
