# 06 — Tasarım Sistemi ve Erişilebilirlik

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Görsel yön

Amaç, preview içeriğine odaklanan sakin bir editör. Dekoratif hareket, yoğun renk ve gereksiz araç barı değil; seçili klip, aktif aralık ve bir sonraki eylem belirgin olsun. Açık/koyu tema için semantik token kullan; tasarım sistemi marka adı kesinleşmeden de çalışabilsin.

Token grupları: `surface`, `text`, `border`, `accent`, `danger`, `warning`, `success`, `focus`. Başarı ve hata yalnızca yeşil/kırmızı farkıyla anlaşılmasın; ikon ve açıklama da olsun. Sayısal zaman etiketleri hizalı, okunabilir; medya zamanları yerelleştirilse de saklama biçimi değişmez.

## Bileşenler

Dosya seçici, işlenebilirlik kartı, video preview, aralık kontrolü, klip kartı, sıra taşıma eylemi, oran seçici, crop çerçevesi, ses slider'ı + sayısal giriş, undo/redo, kaydetme durumu, export modalı, hata/kurtarma kartı, açık fiyat tablosu.

Her bileşenin loading, empty, valid, invalid, disabled, offline ve screen-reader durumları tanımlanır. Disabled eylem neden kapalı olduğunu erişilebilir şekilde açıklar; yalnızca soluklaştırılmaz.

## Erişilebilirlik kabul hedefi

Web için WCAG 2.2 AA uyumunu ürün hedefi olarak al; tam uyum testi yapılmadan rozet yayımlama. Mobilde TalkBack/VoiceOver gerçek cihaz testleri gerekir. WCAG kapsamı ve kriterleri resmî metinden izlenir. [S41](35_SOURCES.md#s41)

Ürün politikası olarak mobilde en az 48 dp, webde tercihen en az 44 CSS px dokunma alanı hedefle; bunları WCAG AA'nın aynen sayısal şartı diye sunma. Metin büyütüldüğünde zaman düğmeleri ve fiyatlar kesilmesin. Focus görünür olsun ve modal açılıp kapanırken doğru yere dönsün.

Sürükleme isteyen her işin düğme/klavye alternatifi olmalı. Timeline'ı görmeden de “Klip 2, başlangıç 8 saniye, bitiş 14 saniye” okunabilmeli. Crop için merkezle, sola/sağa küçük adım ve fit gibi alternatifler bulunmalı.

## Web klavye önerisi

Space oynat/duraklat; I başlangıç; O bitiş; Enter seçimi ekle; Delete seçili klibi kaldır; Ctrl/Cmd+Z geri al; platforma uygun redo. Metin alanı odaktayken bu kısayollar metin girişini çalmamalı. Kullanıcıya yardım paneli sunulur; standart tarayıcı kısayolları gereksiz ele geçirilmez.

> Uygulandı (ADR-026, 2026-09-23): yukarıdakilere ek olarak F tam ekran, Escape seçili kesitten çık / tam ekrandan çık; şeritteki oynatma çizgisinde ←/→ 1 kare, Shift ile 1 sn, Home/End; kesit kartının tutamacında ↑/↓/Home/End sırayı değiştirir (sürüklemenin klavye karşılığı). Kart düğmeleri ekran okuyucuya kesitin numarası ve aralığıyla okunur ("Kesit 2'yi indir, 00:09–00:14"); kesitler gerçek bir liste (`ol`) olarak sunulur.

## Hareket ve ses

Reduced-motion tercihine uy. Otomatik yüksek sesle oynatma yok; arka plan sesi düğmeye basılmadan başlamaz. Ses seviyesi sayısal ve görsel sunulur. Dalga biçimi, işin tek kontrol aracı değildir; oluşmasa da zamanla seçim yapılabilir.

## Yerelleştirme

İlk tasarım Türkçe + İngilizce metin anahtarlarıyla yürür; kod içinde gömülü metin yok. Tarih/para birimi sağlayıcının bölgesel çıktısından alınır. USD analiz fiyatı Türkçe mağaza fiyatı diye gösterilmez. Uzun Türkçe hata metni, dar telefon ekranı ve sistem font büyütmesi test edilir.

Editör bağlamında “kırpma” terimi zaman/görüntü ayrımıyla kullanılır. “Export” kullanıcı metninde “Dışa aktar”, teknik loglarda `export` olarak kalabilir.
