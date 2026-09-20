# 05 — Kaynak sicili

**Erişim / araştırma tarihi: 20 Eylül 2026.** Kaynaklar resmî ürün sayfaları, sağlayıcı belgeleri veya proje sahiplerinin depolarıdır. Fiyatlar ve model özellikleri uygulama gününde yeniden doğrulanmalıdır.

## Pazar

- **S01 — Microsoft Clipchamp:** https://clipchamp.com/en/ ve https://clipchamp.com/en/pricing/  
  Gözlem: web editörü, otomatik altyazı ve ücretsiz/filigransız HD konumlandırması. Bu sayfaların pazarlama ifadeleri bağımsız kullanılabilirlik testi değildir.
- **S02 — CapCut:** https://www.capcut.com/tools/ai-caption-generator  
  Gözlem: web caption akışı ve stiller. Bölgesel/hesaba bağlı planları tek evrensel fiyat saymadık.
- **S03 — VEED:** https://www.veed.io/tools/auto-subtitle-generator-online  
  Gözlem: caption/translation ve düzenleme akışı. Başlıktaki doğruluk iddiası benimsenmedi.
- **S04 — Kapwing:** https://www.kapwing.com/pricing  
  Gözlem: Pro aylık 24 USD veya yıllık ödemede aylık 16 USD; 1.000 kredi ve farklı kullanımlara dönüşüm. Altyazı, çeviri ve dublaj limitleri eşzamanlı ayrı ücretsiz havuzlar gibi toplanmamalı. Sayfada Free için farklı export ifadeleri bulunduğundan ayrıntılı Free garantisi kullanılmadı.
- **S05 — Descript:** https://www.descript.com/  
  Gözlem: metin tabanlı edit ve Underlord. “Komutla düzenle” fikri tek başına özgünlük kanıtı değil.
- **S06 — Submagic:** https://www.submagic.co/  
  Gözlem: kısa video/caption/auto-edit özellik menüsü. “10x” gibi hız iddiaları doğrulanmış performans olarak kullanılmadı.

## Konuşma, hizalama ve fiyat

- **S07 — OpenAI dosya transkripsiyonu:** https://developers.openai.com/api/docs/guides/speech-to-text  
  Gözlem: transkript ile timestamp kabiliyeti ayrımı; kelime/segment timestamp için Whisper yolu; çeviri endpoint’inin hedef dil sınırlaması. Farklı model çıktıları eşdeğer varsayılmadı.
- **S08 — OpenAI fiyatları:** https://developers.openai.com/api/docs/pricing ve https://developers.openai.com/api/docs/models/gpt-transcribe  
  Gözlem: mini transcribe yaklaşık 0,003; gpt-transcribe 0,0045; gpt-4o-transcribe yaklaşık 0,006 USD/dakika. Token fiyatlı modellerde dakika karşılığı sağlayıcının tahminidir.
- **S09 — ElevenLabs transkripsiyon:** https://elevenlabs.io/docs/overview/capabilities/speech-to-text  
  Gözlem: Scribe v2, Türkçe desteği ve kelime zamanları. Sağlayıcı WER sınıflandırması ürünümüzde test sonucu sayılmadı.
- **S09P — ElevenLabs API fiyatları:** https://elevenlabs.io/pricing/api  
  Gözlem: Scribe 0,22 USD/saat; Voice Isolator 0,12 USD/dakika; Dubbing v1 filigranlı 0,33 / filigransız 0,50 ve v2 2,20 USD/dakika; vergiler hariç. Ek özellik ve hesap koşulları yeniden kontrol edilir.
- **S10 — ElevenLabs forced alignment:** https://elevenlabs.io/docs/overview/capabilities/forced-alignment  
  Gözlem: ses + metinden zamanlama; Türkçe listede; alignment dili ve özellik sınırları ASR’den ayrı. Sayfa fiyatı STT oranıyla ilişkilendiriyor; bizim hesaplarımızda her işe alignment eklenmedi.
- **S11 — Yerel modeller:** https://github.com/openai/whisper ve https://github.com/SYSTRAN/faster-whisper  
  Gözlem: kendi altyapısında çalıştırma seçenekleri. Depo hız kıyasları kullanıcı donanımına doğrudan taşınmadı; bütün bağımlılıklar için ayrıca lisans envanteri gerekir.
- **S12 — Tarayıcı modelleri:** https://huggingface.co/docs/transformers.js/en/guides/webgpu  
  Gözlem: WebGPU destekli inference; platforma bağlı kullanılabilirlik. Dokümanın main/stable sürüm ayrımı korunmalı, kurulumda stable sürüm doğrulanıp kilitlenmeli.
- **S13 — WebVTT:** https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API  
  Gözlem: zamanlı metin. Oynatıcı üstündeki caption, videoya burn-in ile aynı şey değildir.
- **S14 — FFmpeg filtreleri:** https://ffmpeg.org/ffmpeg-filters.html#subtitles ve https://ffmpeg.org/ffmpeg-filters.html#silencedetect ve https://ffmpeg.org/ffmpeg-filters.html#sidechaincompress  
  Gözlem: subtitle çizimi, sessizlik tespiti ve sesler arası kompresyon. Bu araçlar bir tarayıcı motorunun hazır olduğu anlamına gelmez.
- **S15 — Google Cloud Translation:** https://cloud.google.com/products/translate/pricing  
  Gözlem: standart NMT, ücretsiz kredi dışındaki temel 20 USD/milyon kaynak karakter; hedef diller maliyeti çoğaltır. Sayfa dipnotundaki karakter tanımı esas alınmıştır; dokümanda bazı tablo hücrelerinin “byte” yazmasına rağmen örnekler karakter hesabını açıklıyor.
- **S16 — Whisper model kartı:** https://github.com/openai/whisper/blob/main/model-card.md  
  Gözlem: kullanım sınırları, dil/bağlam değerlendirmesi gereği. İlan edilen dil sayısı evrensel doğruluk garantisi değildir.
- **S17 — OpenAI veri kontrolleri:** https://developers.openai.com/api/docs/guides/your-data  
  Gözlem: veri saklama ve işleme politikaları endpoint/sözleşme/hesap yapılandırması bazında incelenir. Genel bir “hiçbir şey tutulmaz” iddiası kurulmadı.

## İncelenen mevcut proje belgeleri

Önceki paketin `docs/15_PRICING_FREE_PRO.md`, `docs/ui/07_ASTRA_UI_PROMPT.md`, güncellenmiş `docs/29_ROADMAP_BACKLOG.md` ve `docs/31_AI_FEATURES.md` belgeleri karşılaştırıldı. Bu ek, AI kapsamı ve kullanım politikasında çelişen noktaları öneri olarak işaretler; eski belgeleri yerinde değiştirmez.

## Yapılmayanlar

Canlı rakip ürün benchmark’ı, ödeme isteği araştırması, Türkçe ASR testi, video render deneyi, hukuki uygunluk denetimi ve gerçek provider faturası ölçümü yapılmadı. Bazı Adobe/Canva derin sayfaları erişilebilir veya yeterli olmadığından bu ürünler için ayrıntılı güncel fiyat/limit karşılaştırması kurulmadı. İnternetteki birkaç seçilmiş yorum bütün pazarın talebi kabul edilmedi.
