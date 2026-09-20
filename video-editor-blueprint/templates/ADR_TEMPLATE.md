# Şablon — Mimari Karar Kaydı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: DOLDURULMUŞ ÖRNEK ŞABLON — ONAYLANMADI
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Nasıl kullanılacak?

Her önemli tasarım değişikliği için bu belge kopyalanır. Aşağıdaki doldurulmuş örnek **teklif**, gerçek alınmış karar değildir. Karar durumu, kaynak, deney kanıtı ve geri dönüş yolu açık olmalıdır.

## Örnek: ADR-008 — Desteklenmeyen web codec rotası

**Durum:** PROPOSED. **Sahip:** Kurucu/teknik sorumlu. **Faz:** P0-03. **Tarih:** Örnek taslağın tarihi 19 Eylül 2026; gerçek karar tarihi onayda yazılır.

**Problem:** Bazı tarayıcılar seçilen dosyayı oynatabilir, fakat hedef H.264/AAC çıktısını hazırlayamayabilir. Kullanıcı bütün editini yaptıktan sonra başarısız olması kabul edilemez.

**Karar önerisi:** Import sonrası dosya/config bazlı capability ve küçük smoke render çalıştır. Desteklenmeyene early unsupported sonucu ver. P3 cloud açıksa kullanıcıya ayrı upload/kota ekranıyla seçenek sun; sessiz fallback yapma.

**Alternatifler:** Her şeyi sunucuya yüklemek; tek WASM encoder'a geçmek; yalnızca browser adına güvenmek. İlk ikisi maliyet/mahremiyet/lisans ve performans etkisi taşır; sonuncusu gerçek codec uygunluğunu kanıtlamaz.

**Gerekçe:** Kullanıcı kontrolünü koruyup desteklenmeyen yolu erken ayırmak; shared EDL'den vazgeçmeden dar web ürününü sunabilmek. Kütüphane destek bilgisi [S10](../docs/35_SOURCES.md#s10); ürün kararı [web planına](../docs/11_WEB_EDITOR.md) bağlıdır.

**Bedel:** Başlangıç testi gecikmesi, matris bakımı ve unsupported durum UX'i. Henüz ölçülmedi.

**Kabul kanıtı:** H.264 var/AAC yok ortamı; bütün codec'ler var ama smoke render başarısız ortamı; başarılı kısa dosya; kullanıcı onayı olmadan ağda medya byte'ı olmaması. Sonuç alanı başlangıçta `NOT_RUN`.

**Geri alma/değiştirme:** Başlangıç testinin maliyeti çok yüksekse cache/capability fingerprint değerlendirilir; aynı cihaz profilinde sonuç sonsuza dek geçerli sayılmaz. Platform upgrade veya engine değişiminde cache invalidation gerekir.

**Etkilenen belgeler:** web motoru, pricing platform tablosu, privacy metni, QA matrisi, launch checklist. Yeni karar bunlarla çelişirse ilgili değişiklik aynı PR'da yapılır.
