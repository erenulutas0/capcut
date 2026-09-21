# Beta hazırlık denetimi (belge 34 §A–B, yol haritası P2)

> Tarih: 2026-09-22 · Durum: ÇALIŞMA BELGESİ
> Her satırın kanıtı depoda bir test, ölçüm raporu ya da ADR'dir. Kanıtı olmayan satır
> işaretlenmez. Kodla kapatılamayan satırlar "Kurucu kararı" diye ayrılmıştır; bunlar
> para ya da yetki ister ve ajanlar tarafından varsayılmaz.

## A — Yerel alfa

| Satır | Durum | Kanıt / eksik |
|---|---|---|
| Kaynak video asla üzerine yazılmıyor; silme/undo/re-link testleri var | ✅ | Dosya yalnız okunur (`adapters/browserMedia.ts`); undo/redo birim testleri; re-link e2e (`tests/e2e/persistence.spec.ts`), ADR-012 |
| Seçili cihazlarda iki aralık + müzik gerçek dosya üretiyor | ✅ (masaüstü) | Matris M01, M04, M05, M08 (`docs/SUPPORT_MATRIX.md`); gerçek telefonda test yok (aşağı bakın) |
| Orientation, crop, süre ve ses senkronu kontrolleri geçiyor | ✅ | M02 (döndürme), M03 (crop), M07/M09 (süre, sınır), 15 gerçek kayıt (ADR-014) |
| Desteklenmeyen/disk dolu/izin kaybı/iptal anlaşılır ve güvenli | ⚠️ kısmen | Desteklenmeyen: kapı (ADR-010/011), HEVC/HDR açık ret; iptal: e2e; izin kaybı: re-link (M14). **Disk dolu yolu kodda var ama tetiklenmedi** (ADR-013) |
| EDL otomatik kayıt ve kapanma sonrası kurtarma doğrulandı | ✅ | ADR-012, `persistence.spec.ts`, M14 |
| Hesapsız Free akışında gereksiz network/ödeme engeli yok | ✅ | e2e "nothing is sent off the machine"; hesap yok |
| Demo/fixture medyasının hakları temiz | ✅ | Sentetik (ffmpeg), FLEURS CC-BY-4.0, açık lisanslı telefon kayıtları yalnızca yerelde (`web/tests/media/real/SOURCES-web.md`, gitignore) |

## B — Kamuya açık Free beta

| Satır | Durum | Kanıt / eksik |
|---|---|---|
| Desteklenen OS/tarayıcı/codec matrisi gerçek testlerle yazıldı | ⚠️ | Windows'ta Chromium/Chrome/Edge 20/20, Firefox açık ret, 15 gerçek kayıt. **Eksik:** macOS, Safari, gerçek telefon tarayıcısı, düşük bellekli cihaz |
| Türkçe metinler, hata açıklamaları ve erişilebilirlik test edildi | ⚠️ | Türkçe metinler ve hata kodları: e2e. Otomatik erişilebilirlik: axe (WCAG 2.2 A/AA) 32 ekran durumunda 233 → 0 ihlal; klavyeyle tam akış, odak tuzağı, hareket azaltma, %200 yakınlaştırma testlerle geçiyor (`docs/a11y/2026-09-22-audit.md`). **Gerçek ekran okuyucu (NVDA) testi yapılmadı**; 11 adımlık kontrol listesi raporda |
| İsim/domain/iletişim bilgileri gerçek | ❌ **Kurucu kararı (K01)** | "Clip" geçici ad; domain ve iletişim adresi yok |
| Privacy/terms ve veri envanteri gerçek davranışla eşleşiyor | ⚠️ | Koddan çıkarılmış envanter (`docs/privacy/DATA_INVENTORY.md`) ve taslak `/gizlilik` sayfası (TR/EN). Tam oturumun dışarıya sıfır istek yaptığı ve çerez bırakmadığı e2e ile doğrulanıyor. **Veri sorumlusu (K02), barındırma sağlayıcısı ve hukuki inceleme eksik; sayfada görünür "belirlenmedi"** |
| App Store/Play beyanları | — | Web-only; mağaza yok |
| Hesap varsa silme akışları | — | Hesap yok. Yerel projeyi silme var (`persistence.spec.ts`) |
| Beta gözlemleri, destek yolu ve export metrikleri hazır | ⚠️ | Kullanıcı testi kiti: `docs/beta/USER_TEST_KIT.md`. "Sorun bildir": içeriği önceden gösterilen, dosya adı/altyazı metni içermeyen tanı dosyası (birim testli); yerel export günlüğü (son 20, yalnız bu tarayıcıda). **İletişim adresi belirlenmedi** (`NEXT_PUBLIC_SUPPORT_CONTACT`). Uzaktan metrik toplanmıyor, bilerek |
| Landing page yalnızca mevcut özellikleri gösteriyor | ✅ | Tanıtım sayfası tek cümle ve "Editörü aç"; olmayan özellik vaadi yok |
| Analytics ve marketing tercihleri anlaşılır | ✅ (yok) | Analitik ve pazarlama izleme yok; gizlilik sayfası bunu söyleyecek. İleride eklenirse ayrı rıza (P2-05, kurucu kararı) |

## Kodla kapatılamayanlar — kurucu kararları

1. **İsim, domain, iletişim adresi (K01).** Beta daveti ve "Sorun bildir" için en az
   bir iletişim yolu gerekir. Ücretsiz seçenek: GitHub Issues (depo zaten herkese
   açık) ya da kişisel e-posta. Uygulama bunu `NEXT_PUBLIC_SUPPORT_CONTACT` ile okur.
2. **Veri sorumlusu (K02).** Gizlilik sayfası taslaktır; kim adına yazıldığı ve hukuki
   inceleme eksik. Uygulama hiçbir kişisel veriyi dışarı göndermediği için risk düşük,
   ama metin yine de bir kişi/kurum adına yayınlanır.
3. **Yayın (herkese açık adres).** Beta kullanıcılarının uygulamayı açabilmesi için
   HTTPS bir adres gerekir (WebCodecs ve OPFS güvenli bağlam ister). Ücretsiz yollar
   `docs/beta/DEPLOY_GUIDE.md`'de; yayın dışa dönük bir eylem olduğu için kurucu onayı
   olmadan yapılmaz.
4. **Otomatik test (CI).** Depo herkese açık olduğundan GitHub Actions ücretsizdir.
   Kalıcı bir depo ayarı olduğu için onayla eklenir.

## Donanım gerektirenler

- **Gerçek telefon tarayıcısı** (Android Chrome, Samsung Internet): yayın (HTTPS adres)
  gerekir; yerel ağdaki `http://` adres güvenli bağlam sayılmaz ve dışa aktarma kapalı
  kalır. Yayından sonra kurucunun Samsung telefonuyla yapılabilir.
- **Safari / macOS / iPhone:** Mac erişimi gerekir (K04).
- **Bellek ölçümünün başka makinede tekrarı:** yalnızca bu Windows makinesinde ölçüldü.
