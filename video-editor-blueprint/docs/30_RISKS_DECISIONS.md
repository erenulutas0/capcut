# 30 — Riskler, Varsayımlar ve Açık Kararlar

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Risk sicili

Olasılık ifadeleri ölçülmüş istatistik değildir; ilk mühendislik önceliğidir. Sahip başlangıçta kurucudur; dış hukuk/uzman gerektiren yerde açıkça belirtilmiştir.

| Risk | Etki | Erken sinyal | Azaltım / açılış kapısı |
|---|---|---|---|
| Rakiplerden ayırt edilmeme | Kullanıcı edinimi ve retention zayıf | “Galerimde zaten yapıyorum” | Görev gözlemi ve dar segment |
| Abonelik için iş sıklığı düşük | Churn/ödeme isteği zayıf | Tek çıktı, geri dönüş yok | Tek seferlik yerel-only modeli ayrı test |
| Web codec/bellek sınırı | Export başarısızlığı | Dosya açılıyor ama mux/encode bitmiyor | Capability+gerçek render; dar destek matrisi |
| Native üç motor tutarsızlığı | Yanlış çıktı | Crop/audio golden farkı | Ortak EDL/fixture ve semantic tolerans |
| Müzik hakları | Hukuki/mağaza sorunu | Platformda susturma/şikâyet | Kullanıcı dosyası açıklaması; katalog yok |
| Cloud beklenenden pahalı | Negatif contribution | Uzun girdi/kısa çıktı, tekrarlar | Sıkı input/job sınırı ve gerçek maliyet ölçümü |
| Ödeme/provider kabulü | Para kazanma açılmaz | KYC/ürün kabulü blokajı | Provider ön kabulü, alternatif adaptör planı |
| Store bölgesel kural değişimi | Red/uygunsuz ödeme CTA | İnceleme/red veya güncelleme | Yayın günü resmî politika kontrolü |
| FFmpeg/codec lisans yükü | Dağıtım riski | Build flag/NOTICE belirsizliği | Gerçek binary üzerinden lisans incelemesi |
| Silme/özel medya sızıntısı | Yüksek kullanıcı zararı | Orphan object/public erişim | Private bucket, owner checks, deletion audit |
| Tek geliştirici kapsam aşımı | Ürün tamamlanmaz | Yeni katman var, gerçek çıktı yok | Dikey dilim ve faz onayı |
| Kullanıcı edinimine geç başlanması | Özellik var kullanıcı yok | Sadece kod/indirme sayısı izleniyor | P0 ile paralel görüşmeler |

## Açık kurucu kararları

**K01 İsim ve marka:** Clip geçici isim. Domain, mağaza bulunabilirliği ve marka benzerlik incelemesi yapılmadan tescil/uygunluk iddiası yok.

**K02 Şirket ve tahsilat:** Veri sorumlusu/merchant hangi tüzel/gerçek kişi? Gerçek ülke, vergi ve payout onayı gerekir. Teknik spike bu kararı bekleyebilir; paid launch bekleyemez.

**K03 İlk segment:** Küçük ürün üreticisi önerildi, doğrulanmadı. İlk 15–20 görüşmede bu seçimin yanlış olması kabul edilebilir sonuçtur.

**K04 Platform sırası:** Android + desktop web önerisi, iOS gerçek test koşuluyla. Kullanıcı talebi veya Mac erişimi farklıysa ADR ile değiştir.

**K05 Bütçe:** MD'deki örnek harcamalar yetki değildir. Gerçek azami geliştirme, cihaz, cloud, hukuk ve reklam bütçesi ayrı belirlenir.

**K06 Fiyat:** 6,99/49,99 USD hipotezi; yerel fiyat/vergi/marj/ödeme isteği doğrulanacak. Kalıcı indirim veya lifetime sözü yok.

**K07 Kaynak ve saklama:** R2 aday, kesin tedarikçi değil. Aktarım/region/DPA ve gerçek silme uygulanmadan seçilmiş sayılmaz.

## Varsayım denetimi

A01 Kullanıcı basit aralık seçimi istiyor → görev gözlemi.
A02 Haftalık tekrar var → ilk çıktı cohort'unda gerçek ikinci iş.
A03 Profil/batch para eder → çalışan özellik ve ücretli talep deneyi.
A04 Yerel işlem güvenilir → gerçek medya benchmark'ı.
A05 Cloud 30 dakika hakkı marj taşır → en yüksek izinli iş+retry ile ölçüm.
A06 İngilizce pazar açılabilir → ayrı dil/ülke cohort'u.

Her varsayım için “kanıt”, “aksi kanıt”, “son kontrol tarihi”, “sonraki deney” tutulur. Hiçbirinin cevabı bu doküman paketi oluşturulduğu için Evet değildir.

## Başarısız hipotezde yön değiştirme

Klip seçme tezine ihtiyaç yoksa özellik yığını büyütmek yerine daha dar bir tekrar işini araştır. Mobil güçlü, web zayıfsa web desteğini dürüst sınırlamak kabul edilebilir. Subscription zayıfsa Free'yi kötüleştirmek yerine alternatif ödeme tezi dene. Kullanıcı var ama veri/ödeme uyumu yoksa ilgili hizmet açılmaz.

Belge değişiklikleri [ADR şablonuyla](../templates/ADR_TEMPLATE.md), araştırma sonuçları [deney şablonuyla](../templates/EXPERIMENT_TEMPLATE.md) kaydedilir.
