# UI araştırması — kaynaklar ve tasarım çıkarımları

> 20 Eylül 2026 · UI v0.2 · Önerilen tasarım ve uygulama sözleşmesi. Kullanıcı testi veya üretim hazır oluş kanıtı değildir.

## Yöntem ve sınır

Resmî ürün sayfaları, resmî kullanım rehberlerindeki ekranlar, W3C erişilebilirlik kaynakları ve platform belgeleri incelendi. Rakiplerin oturum açılan uygulamalarında uçtan uca test yapılmadı. Kaynaklardaki ekranlar o rehberin sürümünü gösterir; bugünkü her hesap/cihaz arayüzüyle birebir aynı olmak zorunda değildir. Reklam iddiaları bağımsız kullanıcı kanıtı kabul edilmedi.

Önceki pakette temel UX ve erişilebilirlik bulunuyordu; bu ek, somut ekran geometrisini, örnek UI'ı ve web-first görevi ekler. Yapılan iş estetik + etkileşim spesifikasyonudur; kullanılabilirlik hipotezi gerçek görev gözlemiyle sınanacaktır.

## İncelenecek tasarım örnekleri

| Referans | Doğrudan gözlem / resmî açıklama | Bizim tasarım çıkarımımız | Kopyalamayacağımız şey |
|---|---|---|---|
| Clipchamp [U01] | Rehber ekranında solda kaynaklar, ortada preview, altta zaman çizelgesi ve sağda bağlamsal araçlar var. | Büyük preview ve değişmeyen mekânsal hiyerarşi. Kullanıcı araç ararken video yerinden oynamasın. | Tüm şablon/efekt/AI kategorilerini ilk ekrana koymak; marka ve görünümü birebir kopyalamak. |
| Kapwing Trim [U02] | Başlangıç/son trim, bölerek ortadan kesme, hassas playhead ve waveform anlatılıyor; örnek dosyayla deneme bağlantısı var. | “Video seç” yanında örnek denemesi; yaklaşık sürükleme yanında kesin zaman girişi. | Projenin ilk sürümüne bütün generative-AI ve ekip araçlarını taşımak. |
| Descript [U03] | Resmî ürün metni, yazıyı düzenleyerek ses/video düzenleme yaklaşımını anlatıyor. | İşin zihinsel modelini kullanıcının anladığı şeye yaklaştırmak: bizde metin değil **saklanacak anlar**. | Transkript tabanlı editörü veya bir AI sohbet kutusunu ilk sürümün merkezi yapmak. |
| InShot [U04] | Resmî site mobil video düzenleme özelliklerini ve uygulama tanıtımlarını sunuyor. | Mobilde preview + kısa şerit + alttan açılan işlem paneli bizim aday düzenimizdir; resmî siteden “en iyi” sonucu çıkarmıyoruz. | Desktop'un üç kolonunu telefona küçültmek; yatay kayan 15 araçlık bir menüyü başlangıç noktası yapmak. |

## Seçilen sentez

Clipchamp'ten panel hiyerarşisi, Kapwing'den erişilebilir hassas kesim ihtiyacı, Descript'ten “işi anlaşılır bir temsil üzerinden düzenleme” fikri alınır. Mobil yerleşim kendi ürün kapsamımıza göre sadeleştirilir.

Ana ekran geleneksel montaj masası değildir. Solda **Kaynaklar / Anlar** sekmesi, ortada bir preview, sağda **Görüntü / Ses** paneli, altta yalnızca bir video şeridi ve bir müzik şeridi bulunur. Çok katmanlı timeline ilk sürümde yoktur.

## Üç görsel yönün tasarım değerlendirmesi

1. **Quiet Studio — seçilen yön.** Kömür nötrler, yüksek okunabilirlik, küçük lime vurgu, minimal krom. Editörü ciddi ama erişilebilir göstermeyi hedefler.
2. **Tam açık, beyaz editör — test alternatifi.** Sık ofis kullanımı ve aydınlık ortamda denenebilir. Koyu temanın herkes için daha rahat olduğunu varsayma. Token mimarisi bu alternatifi kolaylaştırır; ilk görevde iki tam tema yapmak gerekmez.
3. **Neon/glass/AI dashboard — kapsam dışı.** Medyadan rol çalması, çok sayıda kategori çağrıştırması ve daha fazla görsel bakım gerektirmesi nedeniyle tercih edilmedi. Bu bir tasarım yargısıdır; rakip kullanıcıları üzerine ölçülmüş sonuç değildir.

## Standartlardan alınan somut gereksinimler

Normal metin için 4.5:1 kontrast hedefi [U05]. Sürükleme gerektiren işlemlerde sürüklemeden tek işaretçiyle çalışan alternatif [U06]. WCAG 2.2 AA hedef boyut kriteri, istisnalarıyla 24×24 CSS px'dir [U07]; ürün politikamız webde 44×44, dokunmatik araçlarda 48×48 kullanır. Bu sayıları AA'nın evrensel şartı diye yazma. Android rehberi en az 48dp touch target önerir [U08].

Çift uçlu slider'larda her thumb ayrı etiketlenir; değerler değişse de tab sırası sabit kalır. Dokunmatik ekran okuyucu desteği risklidir, zaman inputları kaldırılmaz [U09]. Hazır primitive kullanmak uygulamanın otomatik erişilebilir olduğu anlamına gelmez [U10].

## Kaynak sicili

- **U01 · Clipchamp, resmî ekranlı rehber:** https://clipchamp.com/en/blog/ultimate-guide-video-presentations/ — panel düzeni ve timeline örneği. Erişim 20.09.2026.
- **U02 · Kapwing Video Trimmer:** https://www.kapwing.com/tools/trim — trim/split, playhead, waveform, örnek deneme. Erişim 20.09.2026.
- **U03 · Descript:** https://www.descript.com/ — text-based editing ürün yaklaşımı. Erişim 20.09.2026.
- **U04 · InShot:** https://www.inshot.com/ — mobil ürün özellikleri ve resmî tanıtım. Erişim 20.09.2026.
- **U05 · W3C Contrast Minimum:** https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html — kontrast açıklaması. Erişim 20.09.2026.
- **U06 · W3C Dragging Movements:** https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html — sürüklemeye alternatif. Erişim 20.09.2026.
- **U07 · W3C Target Size Minimum:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — 24 CSS px kriteri ve istisnalar. Erişim 20.09.2026.
- **U08 · Android accessibility:** https://developer.android.com/guide/topics/ui/accessibility/views/apps-views — en az 48dp touch target önerisi. Erişim 20.09.2026.
- **U09 · WAI-ARIA multi-thumb slider:** https://www.w3.org/WAI/ARIA/apg/patterns/slider-multithumb/ — klavye, tab sırası ve assistive-tech uyarısı. Erişim 20.09.2026.
- **U10 · Radix accessibility:** https://www.radix-ui.com/primitives/docs/overview/accessibility — primitive davranışları, focus/label sorumluluğu. Erişim 20.09.2026.
- **U11 · shadcn/ui:** https://ui.shadcn.com/docs/components — dialog, sheet, resizable, slider gibi bileşen adayları. Erişim 20.09.2026.
- **U12 · MDN WebCodecs:** https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API — worker, encode/decode ve mux/demux sınırları. Erişim 20.09.2026.
- **U13 · Mediabunny formats/codecs:** https://mediabunny.dev/guide/supported-formats-and-codecs — ortama bağlı codec yetenekleri. Erişim 20.09.2026.
- **U14 · Next.js server/client components:** https://nextjs.org/docs/app/getting-started/server-and-client-components — interaktif editorün istemci sınırı. Erişim 20.09.2026.

Kaynaklar kendi sayfalarının anlattığını destekler; pazar talebi, fiyat optimumu veya bu arayüzün dönüşüm oranı hakkında kanıt oluşturmaz. Dış sayfa görselleri uygulamada kullanılacak lisanslı varlık olarak bu pakete dahil edilmedi.
