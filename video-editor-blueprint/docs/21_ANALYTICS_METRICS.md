# 21 — Analitik, Aktivasyon ve Başarı Ölçümü

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Ölçüm ilkesi

Ürünün değerini kayıt sayısı değil **anlamlı bir videonun başarıyla hazırlanması ve tekrar yapılması** gösterir. Medya içeriğini, dosya adını, ses transkriptini veya kullanıcının seçtiği anları analitik için toplama. Gizlilik tercihi nedeniyle ölçülemeyen kullanımın boyutunu gizleme; dashboard bütün kullanıcıları eksiksiz temsil etmeyebilir.

## Olay sözlüğü

| Event | Tetikleme | İzinli alanlar |
|---|---|---|
| editor_opened | Editör gerçekten hazır | platform, app_version, entry_channel |
| asset_import_started | Kullanıcı kaynak seçti | source_kind, size_bucket |
| asset_import_succeeded | Probe ve izin başarılı | codec_family, duration_bucket, support_route |
| asset_import_failed | Kontrollü hata | error_code, platform |
| first_range_added | İlk geçerli saklanacak aralık | input_duration_bucket |
| meaningful_edit_completed | En az bir anlamlı edit | edit_type enum; içerik/zamanlar yok |
| export_started | Gerçek attempt başladı | attempt_id, route, quality, duration_bucket |
| render_succeeded | Dosya decode/probe doğrulandı | engine, elapsed_bucket, output_duration_bucket |
| export_delivered | Kullanıcıya dosya erişimi sağlandı | attempt_id, save_method |
| export_failed / canceled | Terminal sonuç | sanitized_error, stage, route |
| project_reopened | Daha önceki yerel proje açıldı | age_bucket; gerçek başlık yok |
| paywall_viewed | Bağlamlı ücretli özelliğe girildi | trigger, offering_id, platform |
| purchase_verified | Server provider'dan doğruladı | product, currency, provider, transaction_ref |
| subscription_renewed/refunded | Doğrulanmış server olayı | product/cohort; kart bilgisi yok |

Marketing analytics ile ürün olayları farklı izin/dayanak alanlarına sahip olabilir. SDK seçimi, default identity ve IP davranışı [gizlilik planında](19_PRIVACY_COMPLIANCE.md) değerlendirilir.

## Anlamlı düzenleme ve aktivasyon

Anlamlı edit: en az bir trim/remove, iki farklı aralığı birleştirme, crop/oran değiştirme veya müzik yerleştirme. Sadece orijinal dosyayı aynı biçimde açıp yeniden kaydetme ayrı tutulur.

**Aktivasyon:** desteklenen bir kaynakla anlamlı edit sonrası ilk `export_delivered`. Desktop browser gerçekten indirme tamamlanmasını doğrulayamıyorsa olay `download_initiated` olarak ayrıca adlandırılır; diske kesin yazıldı diye raporlanmaz. Native save API başarısı ile browser download başlatma kanıtı aynı güçte değildir.

**Tekrar kullanım:** ilk aktive olmuş kullanıcının daha sonraki bir günde farklı projede yeni anlamlı çıktı olayı. Aynı çıktının indirmesini tekrar denemek veya job retry ikinci proje sayılmaz.

## Metrik tanımları

Aktivasyon oranı = ilk anlamlı çıktı alan ölçülebilir yeni kullanıcı / editöre erişen ölçülebilir yeni kullanıcı. Uygun dosya seçemeyenleri denominator'dan gizlice çıkarma; ayrıca “desteklenen import sonrası başarı” alt metriğini raporla.

Teknik render başarısı = successful render / başlayan render attempt. İptaller ayrı görünür; toplam girişimdeki oran ayrıca gösterilir. Kullanıcı çok yavaş işlem yüzünden iptal ettiyse bunu ürün başarısına dönüştürme. Çıktı teslim başarısı render başarısından ayrıdır.

Aktif edit süresi = kullanıcının editörde aktif eylem yaptığı süre; encode süresi ayrı. First value zamanı = editör açılışından ilk çıktı girişimine/teslimine kadar, kanıt gücüyle birlikte. Ücretli dönüşüm = doğrulanmış ilk satın alma / ilgili eligible aktif cohort; install veya bütün trafik denominator'ıyla karıştırılmaz.

## İlk dashboard

Platform/codec/engine sürümüne göre import→range→export funnel; error code; output süresi dağılımı; ölçülmüş edit/encode süreleri; 7/14/30 günlük tekrar; Free/Pro yeni/yenileyen; cloud gerçek maliyet ve kullanılan hak; refund; izinli analitik kapsam oranı.

Kohort = ilk aktivasyon haftası ve edinim kanalı. Minimum örneklemde yüzdelerin yanında `8/10` gibi gerçek sayılar yazılır. Unknown attribution ayrı bucket, zorla son reklama yazılmaz.

## Önerilen erken eşikler

10 gözlemde en az 8 yardımsız görev; golden test setinde bütün kritik medya vakalarının geçmesi; beta desteklenen cihaz cohort'unda en az %98 render başarısı araştırma hedefi. Bunlar sektör normu veya üretim garantisi değil; doğrulanacak ürün kapılarıdır. Örneklem küçükken tek yüzdeyle karar verilmez.

D7/D30 tekrar için baştan piyasadan kopyalanmış sayı koyma; ilk kohortta gerçek ihtiyacın haftalık sıklığı öğrenilir. Ücretli ürün kararı, birkaç kişi beğendi diye değil, tekrar edilen iş ve gösterilen Pro değerine dayanır.

## Veri kalitesi

Client event'lerinde event ID ve attempt ID; server billing event'lerinde dedupe ve timestamp. Client offline kuyruğu bounded, consent değişince gönderilmeyen olaylar silinir. Fiyat/gelir server/mağaza kaynağından gelir; UI success ekranından revenue üretilmez. Kendimizin test cihazları/internal hesapları rapordan ayrılır.
