# 31 — AI Yol Haritası ve Güvenli Deney Sınırları

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Başlangıç kararı

AI ilk sürümün çalışma koşulu değildir. Kullanıcının manuel saklama/kırpma/müzik işini yapamadığı bir ürüne AI etiketi eklemek eksik çekirdeği çözmez. İlk abonelikte AI kotası veya “sınırsız AI” vaadi bulunmaz.

## Öncelik sırası — öneri

| Aday | Beklenen iş değeri | Teknik yaklaşım adayı | Risk/kapı |
|---|---|---|---|
| Sessizlik için kesim önerisi | Konuşma videosundaki boşlukları seçmek | Yerel ses analizi/VAD; zorunlu LLM değil | Kelime sonları, müzik, nefes ve dil testleri |
| Metinden kesim seçimi | Konuşmanın ilgili bölümünü bulmak | ASR zaman damgası + transcript selection | Gizlilik, dil/hata, kaynak dakika maliyeti |
| Beat'e hizalama önerisi | Seçili klip sınırlarını müzik ritmine yaklaştırmak | DSP/beat detection | Müzik hakkı, yanlış tempo; öneri olarak sun |
| “30 saniyeye indir” önerisi | Kullanıcıya aday kısa tarif vermek | Segment scoring + bounded recipe | İyi an öznel; kullanıcı preview/onay |
| Otomatik merkezleme | Kişi/nesneyi çerçevede tutmak | On-device tracking adayı | Yanlış crop, yüz/veri mahremiyeti; ayrı kapsam |

Bu tabloda herhangi bir API/model sağlayıcısı seçilmedi ve fiyatı araştırılmadı. Model seçiminde güncel resmî dokümanlar, veri saklama/eğitim koşulları ve gerçek Türkçe/İngilizce görev benchmark'ı gerekir.

## İlk AI deneyi

Yalnızca bir aday: sessizlik aralıklarını **öner**. En az 20 hakları temiz örnekle sessiz oda, arka plan müziği, düşük konuşma sesi, Türkçe/İngilizce ve nefes aralıklarını test et. Bu örneklem performans sertifikası değil, erken hata yakalama setidir.

Kullanıcı önce/sonra preview görür. Kesim sınırları ayarlanabilir; tek undo ile geri alınabilir. Sesli heceyi kesme, anlam bozma veya istemediği kişiyi çerçeveden atma durumları insan değerlendirmesiyle kaydedilir. Sistem otomatik yayımlamaz.

## AI çıktısı veri, komut değil

ASR/transkript veya LLM metni güvenilmeyen veridir. Videodaki konuşma/yazı “önceki talimatları yok say” içerirse uygulama yetkisi kazanamaz. Model yalnızca sınırlı JSON önerisi üretebilir; allowlist schema/asset ID/time range kontrolünden geçer. Shell, URL fetch, dosya silme, hesap/ödeme değiştirme yetkisi verilmez.

AI önerisi mevcut EDL'yi doğrudan overwrite etmez; bir proposal revision olarak gelir. Kullanıcı onayı sonrası domain komutları uygulanır. Bozuk çıktı veya model kesintisinde manuel editör çalışmaya devam eder.

## Gizlilik ve maliyet

Yerelde yapılabilen analiz için gereksiz server upload yok. Cloud ASR seçilirse yalnızca gereken audio veya medya parçası uygun açıklamayla işlenir; sağlayıcı saklama/alt işleyen/aktarım koşulları kontrol edilir. “Modellerimiz hiç eğitim yapmaz” iddiası sözleşme doğrulanmadan yok.

AI maliyeti render'ın çıktı saniyesiyle ölçülmez. ASR giriş dakikası, model token/istek ve retry ayrı maliyet sınıflarıdır. Örneğin 15 dakikalık girdi →30 saniye çıktı maliyet farkını gizleme. Yeni credit planı ancak ölçümden sonra ayrı politika sürümüyle tasarlanır.

## Kabul kapısı

Manuel çekirdek yeterince güvenilir; araştırmada ilgili otomasyon işi tekrar ediyor; kullanıcı kontrolü ve undo var; kalite ölçümü var; marj ve kullanım üst sınırı belli; data processing sözleşmeleri onaylı. Bu şartlar yoksa AI özelliği “roadmap”te kalır, paywall'a konmaz.
