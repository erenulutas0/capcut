# Diğer tarayıcı motorları: son koşu

> Bu dosyayı `npm run browsers` yazar (`web/scripts/browsers/report.mjs`); elle düzeltilmez.
> Ölçüm: 2026-10-13 08:17 – 2026-10-13 08:23 (UTC), commit `baf4715`, derleme: düz `npm run build` + `next start`.
>
> **Bunlar motor derlemeleridir, tarayıcının kendisi değil.** “WebKit” Playwright’ın Windows için WebKit derlemesidir: Safari değildir, medya katmanı (kodekler, WebCodecs, donanım kodlayıcıları) macOS / iOS’takinden farklıdır. “Firefox” Playwright’ın yamalı masaüstü Firefox’udur: Android’deki Firefox değildir; “telefon boyu” masaüstü motorunun 390 × 844 dokunmatik görünümüdür. Her satırın gerçek Safari’ye ya da Android Firefox’a taşınıp taşınmayacağı elle yazılan yorum dosyasındadır (`browsers-2026-10-13.md`).

Satır sayısı: 115; bozuk: 0.

Sınıflar: **çalışıyor** (iş bitti, çıkan dosya ffprobe ile denetlendi) · **dürüst ret** (uygulama durdu ve nedenini söyledi; metin aşağıda) · **BOZUK** (sahte başarı, bitmeyen bekleme, kimseye söylenmeyen hata, açıklamasız duruş) · **yok** (tarayıcıda özellik yok, uygulama da vaat etmiyor) · **koşulmadı** (nedeniyle).

## Kartlar

| | Chromium (kontrol), masaüstü | Firefox, masaüstü | Firefox, telefon boyu | WebKit, masaüstü | WebKit, telefon boyu |
|---|---|---|---|---|---|
| Kes | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 3,008 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Boşlukları at | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 3,605 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Dikey yap | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 8 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Küçült | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 14,016 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Yazıya dök | **koşulmadı** — “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. | **koşulmadı** — “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. | **koşulmadı** — “Modeli indir (≈108,8 MB, bir kez)” düğmesine kadar gelindi. Model dosyaları bu makinede olmadığı için yazıya dökme ve dosya ölçülmedi. | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Müzik ekle | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 8 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Sesini al | **çalışıyor** — dosya çıktı: audio:aac, 24 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Sesi kapat | **çalışıyor** — dosya çıktı: video:h264, 24 sn | **çalışıyor** — dosya çıktı: video:h264, 24 sn | **çalışıyor** — dosya çıktı: video:h264, 24 sn | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| Her yerde açılsın | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 2,005 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| İyileştir | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 3,008 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |

## Kartların dışı

| | Chromium (kontrol), masaüstü | Firefox, masaüstü | Firefox, telefon boyu | WebKit, masaüstü | WebKit, telefon boyu |
|---|---|---|---|---|---|
| Ana ekran ve arama | **çalışıyor** — açıldı; 10 kart; “kucult” yazıp Enter → Küçült sihirbazı | **çalışıyor** — açıldı; 10 kart; “kucult” yazıp Enter → Küçült sihirbazı | **çalışıyor** — açıldı; 10 kart; “kucult” yazıp Enter → Küçült sihirbazı | **çalışıyor** — açıldı; 10 kart; “kucult” yazıp Enter → Küçült sihirbazı | **çalışıyor** — açıldı; 10 kart; “kucult” yazıp Enter → Küçült sihirbazı |
| Çevrimdışı kabuk (service worker) | **çalışıyor** — sunucuya ulaşılamazken ana ekran ve Kes sihirbazı açıldı, düğmeleri çalışır durumda | **çalışıyor** — sunucuya ulaşılamazken ana ekran ve Kes sihirbazı açıldı, düğmeleri çalışır durumda | **çalışıyor** — sunucuya ulaşılamazken ana ekran ve Kes sihirbazı açıldı, düğmeleri çalışır durumda | **çalışıyor** — sunucuya ulaşılamazken ana ekran ve Kes sihirbazı açıldı, düğmeleri çalışır durumda | **çalışıyor** — sunucuya ulaşılamazken ana ekran ve Kes sihirbazı açıldı, düğmeleri çalışır durumda |
| Editör: video, klavye, kesit listesi | **çalışıyor** — video açıldı; oynatma çizgisi klavyeyle 2. saniyeye gitti; kesit listeye eklendi | **çalışıyor** — video açıldı; oynatma çizgisi klavyeyle 2. saniyeye gitti; kesit listeye eklendi | **çalışıyor** — video açıldı; oynatma çizgisi klavyeyle 2. saniyeye gitti; kesit listeye eklendi | **dürüst ret** — editör videoyu açmadı ve nedenini söyledi | **dürüst ret** — editör videoyu açmadı ve nedenini söyledi |
| Editör: tam ekran (F) | **çalışıyor** — F tuşu tam ekrana geçti ve geri döndü | **çalışıyor** — F tuşu tam ekrana geçti ve geri döndü | **çalışıyor** — F tuşu tam ekrana geçti ve geri döndü | **koşulmadı** — editör videoyu açmadığı için denenemedi | **koşulmadı** — editör videoyu açmadığı için denenemedi |
| Dosyanın tarayıcıdan çıkışı | **çalışıyor** — kaydetme penceresi var (testte yerine geçen pencere); dosya seçilen yere yazıldı | **çalışıyor** — kaydetme penceresi yok → “Bilgisayara kaydet” bağlantısı dosyayı indirdi (sample-24s_00-03-00-05.mp4) — SESİ KAPATILMIŞ kesitle; sesli kesit reddedildi (metin aşağıda) | **çalışıyor** — kaydetme penceresi yok → “Kaydet” bağlantısı dosyayı indirdi (sample-24s_00-03-00-05.mp4) — SESİ KAPATILMIŞ kesitle; sesli kesit reddedildi (metin aşağıda) | **koşulmadı** — editör videoyu açmadığı için denenemedi | **koşulmadı** — editör videoyu açmadığı için denenemedi |
| “Paylaş” düğmesi | **koşulmadı** — kaydetme pencereli yolda “Paylaş” sunulmaz | **yok (sorun değil)** — tarayıcıda dosya paylaşma yok; “Paylaş” gösterilmiyor, kaydetme yolu duruyor | **yok (sorun değil)** — tarayıcıda dosya paylaşma yok; “Paylaş” gösterilmiyor, kaydetme yolu duruyor | **koşulmadı** — editör videoyu açmadığı için denenemedi | **koşulmadı** — editör videoyu açmadığı için denenemedi |
| Uygulama olarak yükleme | **yok (sorun değil)** — yükleme önerisi yok (bu tarayıcı sunmuyor); bir şey de vaat edilmiyor | **yok (sorun değil)** — yükleme önerisi yok (bu tarayıcı sunmuyor); bir şey de vaat edilmiyor | **yok (sorun değil)** — yükleme önerisi yok (bu tarayıcı sunmuyor); bir şey de vaat edilmiyor | **yok (sorun değil)** — yükleme önerisi yok (bu tarayıcı sunmuyor); bir şey de vaat edilmiyor | **çalışıyor** — iPhone / iPad için “Ana Ekrana Ekle” adımları gösteriliyor |
| Yazıya dök: model adımı | **dürüst ret** — “Modeli indir (≈108,8 MB, bir kez)” düğmesine basıldı; model dosyaları bu makinede yok, uygulama bunu söyledi (yazıya dökmenin kendisi KOŞULMADI) | **dürüst ret** — “Modeli indir (≈108,8 MB, bir kez)” düğmesine basıldı; model dosyaları bu makinede yok, uygulama bunu söyledi (yazıya dökmenin kendisi KOŞULMADI) | **dürüst ret** — “Modeli indir (≈108,8 MB, bir kez)” düğmesine basıldı; model dosyaları bu makinede yok, uygulama bunu söyledi (yazıya dökmenin kendisi KOŞULMADI) | **dürüst ret** — model adımına gelmeden durdu ve nedenini söyledi | **dürüst ret** — model adımına gelmeden durdu ve nedenini söyledi |
| Sesi kapat, WebM kaynak (tarayıcının H.264 kodlayıcısı) | **çalışıyor** — dosya çıktı: video:h264, 2 sn | **çalışıyor** — dosya çıktı: video:h264, 2 sn | **çalışıyor** — dosya çıktı: video:h264, 2 sn | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| HEVC kaynak → Her yerde açılsın | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| HDR kaynak → Her yerde açılsın | **çalışıyor** — dosya çıktı: video:h264 + audio:aac, 2,005 sn | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — indirme başlamadan durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi | **dürüst ret** — video verildikten sonra durdu ve nedenini söyledi |
| axe (ana ekran + bir sihirbaz) | **çalışıyor** — ana ekran ve Dikey yap sihirbazı: 0 bulgu | **çalışıyor** — ana ekran ve Dikey yap sihirbazı: 0 bulgu | **çalışıyor** — ana ekran ve Dikey yap sihirbazı: 0 bulgu | **çalışıyor** — ana ekran ve Dikey yap sihirbazı: 0 bulgu | **çalışıyor** — ana ekran ve Dikey yap sihirbazı: 0 bulgu |
| Editörde yakalanmamış hata | yok | yok | yok | yok | yok |

## Tarayıcının gerçekte nesi var (sayfanın içinde ölçüldü)

| | Chromium (kontrol), masaüstü | Firefox, masaüstü | Firefox, telefon boyu | WebKit, masaüstü | WebKit, telefon boyu |
|---|---|---|---|---|---|
| WebCodecs: VideoEncoder | var | var | var | yok | yok |
| WebCodecs: AudioEncoder | var | var | var | yok | yok |
| WebCodecs: VideoDecoder | var | var | var | yok | yok |
| H.264 kodlar (1280 × 720) | var | var | var | yok (API yok) | yok (API yok) |
| AAC kodlar | var | yok | yok | yok (API yok) | yok (API yok) |
| Opus kodlar | var | var | var | yok (API yok) | yok (API yok) |
| H.264 çözer | var | var | var | yok (API yok) | yok (API yok) |
| VP9 çözer | var | var | var | yok (API yok) | yok (API yok) |
| HEVC çözer | yok | yok | yok | yok (API yok) | yok (API yok) |
| AAC çözer | var | var | var | yok (API yok) | yok (API yok) |
| OffscreenCanvas | var | var | var | yok | yok |
| WebGL2 | var | var | var | var | var |
| Sayfanın özel deposu (OPFS) | var | var | var | yok | yok |
| Depolama kotası (bildirilen) | 10,7 GB | 10,7 GB | 10,7 GB | 1 GB | 1 GB |
| Kaydetme penceresi (File System Access) | var | yok | yok | yok | yok |
| Web Share (dosya) | yok | yok | yok | yok | yok |
| Service worker | var | var | var | var | var |
| Tam ekran | var | var | var | var | yok |
| <video> MP4 (H.264 + AAC) oynatır | probably | probably | probably | probably | probably |
| <video> WebM (VP9 + Opus) oynatır | probably | probably | probably | probably | probably |

## Kullanıcının gördüğü metinler: retler ve uyarılar (kelimesi kelimesine)

- ““telefon-hevc.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır. Bu video HEVC (H.265) biçiminde ve bu tarayıcıda HEVC çözücüsü yok. Windows’ta Edge kullanıyorsan Microsoft Store’daki “HEVC Video Uzantıları” gerekebilir; ya da videoyu Google Chrome’da açmayı dene.”
  - chromium-desktop / kaynak-hevc
- “Model dosyası bu sitede bulunamadı. Biraz sonra tekrar dene.”
  - chromium-desktop / yazi-model, firefox-desktop / yazi-model, firefox-phone / yazi-model
- “Bu tarayıcıda çıktı alınamıyor. Aşağıdaki kontrol geçmediği için dosya oluşturulmuyor. Sessizce başka bir codec kullanmıyoruz ve sesi atarak başarılı göstermiyoruz. Bu tarayıcıda AAC kodlama bu ayarla desteklenmiyor. Chrome ya da Edge ile dene. Sorun bildir”
  - firefox-desktop / bosluk, firefox-desktop / cevir, firefox-desktop / dikey, firefox-desktop / iyilestir, firefox-desktop / kes, firefox-desktop / kucult, firefox-desktop / muzik, firefox-desktop / ses, firefox-desktop / kaydetme, firefox-phone / bosluk, firefox-phone / cevir, firefox-phone / dikey, firefox-phone / iyilestir, firefox-phone / kes, firefox-phone / kucult, firefox-phone / muzik, firefox-phone / ses, firefox-phone / kaydetme
- “Bu tarayıcı video dosyası hazırlayamıyor. Videonu seçip bakabilirsin ama indiremezsin. Chrome ya da Edge ile dene.”
  - firefox-desktop / bosluk (“İndir”e basılmadan önce), firefox-desktop / cevir (“İndir”e basılmadan önce), firefox-desktop / dikey (“İndir”e basılmadan önce), firefox-desktop / iyilestir (“İndir”e basılmadan önce), firefox-desktop / kucult (“İndir”e basılmadan önce), firefox-desktop / muzik (“İndir”e basılmadan önce), firefox-desktop / ses (“İndir”e basılmadan önce), firefox-desktop / kaynak-hdr (“İndir”e basılmadan önce), firefox-desktop / kaynak-hevc (“İndir”e basılmadan önce), firefox-phone / bosluk (“İndir”e basılmadan önce), firefox-phone / cevir (“İndir”e basılmadan önce), firefox-phone / dikey (“İndir”e basılmadan önce), firefox-phone / iyilestir (“İndir”e basılmadan önce), firefox-phone / kucult (“İndir”e basılmadan önce), firefox-phone / muzik (“İndir”e basılmadan önce), firefox-phone / ses (“İndir”e basılmadan önce), firefox-phone / kaynak-hdr (“İndir”e basılmadan önce), firefox-phone / kaynak-hevc (“İndir”e basılmadan önce), webkit-desktop / bosluk (video seçilmeden önce), webkit-desktop / cevir (video seçilmeden önce), webkit-desktop / dikey (video seçilmeden önce), webkit-desktop / iyilestir (video seçilmeden önce), webkit-desktop / kes (video seçilmeden önce), webkit-desktop / kucult (video seçilmeden önce), webkit-desktop / muzik (video seçilmeden önce), webkit-desktop / ses (video seçilmeden önce), webkit-desktop / sustur (video seçilmeden önce), webkit-desktop / kaynak-hdr (video seçilmeden önce), webkit-desktop / kaynak-hevc (video seçilmeden önce), webkit-desktop / sessiz-kodlama (video seçilmeden önce)
- “Bu tarayıcıda çıktı alınamıyor. Aşağıdaki kontrol geçmediği için dosya oluşturulmuyor. Sessizce başka bir codec kullanmıyoruz ve sesi atarak başarılı göstermiyoruz. Bu tarayıcıda AAC kodlama bu ayarla desteklenmiyor. Bu video HDR. Bu tarayıcı HDR görüntüyü SDR’ye doğru çeviremedi (deneme karesiyle test edildi), bu yüzden renkleri bozuk bir dosya üretmemek için çıktı alınmıyor. Google Chrome’da deneyebilirsin. Chrome ya da Edge ile dene. Sorun bildir”
  - firefox-desktop / kaynak-hdr, firefox-phone / kaynak-hdr
- “Bu tarayıcıda çıktı alınamıyor. Aşağıdaki kontrol geçmediği için dosya oluşturulmuyor. Sessizce başka bir codec kullanmıyoruz ve sesi atarak başarılı göstermiyoruz. Bu tarayıcıda AAC kodlama bu ayarla desteklenmiyor. Bu tarayıcı kaynak videoyu çözemiyor. Chrome ya da Edge ile dene. Sorun bildir”
  - firefox-desktop / kaynak-hevc, firefox-phone / kaynak-hevc
- ““bursts.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / bosluk, webkit-phone / bosluk
- ““tarayici-kaydi.webm” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / cevir, webkit-desktop / sessiz-kodlama, webkit-phone / cevir, webkit-phone / sessiz-kodlama
- ““other-8s.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / dikey, webkit-desktop / muzik, webkit-phone / dikey, webkit-phone / muzik
- ““karanlik.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / iyilestir, webkit-phone / iyilestir
- ““sample-24s.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / kes, webkit-desktop / ses, webkit-desktop / sustur, webkit-desktop / yazi, webkit-desktop / editor, webkit-desktop / yazi-model, webkit-phone / kes, webkit-phone / ses, webkit-phone / sustur, webkit-phone / yazi, webkit-phone / editor, webkit-phone / yazi-model
- ““noisy-720p30-14s.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / kucult, webkit-phone / kucult
- ““pq-2s.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / kaynak-hdr, webkit-phone / kaynak-hdr
- ““telefon-hevc.mp4” açılamadı: bu dosyanın önizlemesi bu tarayıcıda açılamadı. Dosya bozuk olabilir veya tarayıcı bu biçimi oynatmıyor. Başka bir video dene; telefonla çekilmiş MP4 ya da MOV dosyaları genelde açılır.”
  - webkit-desktop / kaynak-hevc, webkit-phone / kaynak-hevc
- “Bu tarayıcı video dosyası hazırlayamıyor. Videonu seçip bakabilirsin ama indiremezsin. iPhone ve iPad’de başka bir tarayıcı yüklemek çoğunlukla işe yaramaz. Bir bilgisayarda ya da Android telefonda Chrome ile dene.”
  - webkit-phone / bosluk (video seçilmeden önce), webkit-phone / cevir (video seçilmeden önce), webkit-phone / dikey (video seçilmeden önce), webkit-phone / iyilestir (video seçilmeden önce), webkit-phone / kes (video seçilmeden önce), webkit-phone / kucult (video seçilmeden önce), webkit-phone / muzik (video seçilmeden önce), webkit-phone / ses (video seçilmeden önce), webkit-phone / sustur (video seçilmeden önce), webkit-phone / kaynak-hdr (video seçilmeden önce), webkit-phone / kaynak-hevc (video seçilmeden önce), webkit-phone / sessiz-kodlama (video seçilmeden önce)
- “Ana ekrana ekle Safari’de Paylaş düğmesine bas, sonra “Ana Ekrana Ekle”yi seç.”
  - webkit-phone / yukleme

## Çıkan dosyalar

| Motor | Kart | İzler | Süre (sn) | Boyut | Bayt | Yoldan dosyaya (sn) |
|---|---|---|---|---|---|---|
| Chromium (kontrol), masaüstü | bosluk | video:h264 + audio:aac | 3,605 | 256 × 144 | 62.140 | 4,3 |
| Chromium (kontrol), masaüstü | cevir | video:h264 + audio:aac | 2,005 | 640 × 360 | 502.990 | 4,2 |
| Chromium (kontrol), masaüstü | dikey | video:h264 + audio:aac | 8 | 202 × 360 | 384.942 | 4,7 |
| Chromium (kontrol), masaüstü | iyilestir | video:h264 + audio:aac | 3,008 | 1280 × 720 | 2.820.875 | 7 |
| Chromium (kontrol), masaüstü | kes | video:h264 + audio:aac | 3,008 | 1280 × 720 | 82.744 | 5 |
| Chromium (kontrol), masaüstü | kucult | video:h264 + audio:aac | 14,016 | 1280 × 720 | 14.041.215 | 7,3 |
| Chromium (kontrol), masaüstü | muzik | video:h264 + audio:aac | 8 | 640 × 360 | 183.809 | 4,3 |
| Chromium (kontrol), masaüstü | ses | audio:aac | 24 | — | 389.662 | 4,2 |
| Chromium (kontrol), masaüstü | sustur | video:h264 | 24 | 1280 × 720 | 262.213 | 4,1 |
| Chromium (kontrol), masaüstü | kaynak-hdr | video:h264 + audio:aac | 2,005 | 640 × 360 | 501.317 | 5,2 |
| Chromium (kontrol), masaüstü | sessiz-kodlama | video:h264 | 2 | 640 × 360 | 469.615 | 4,1 |
| Firefox, masaüstü | sustur | video:h264 | 24 | 1280 × 720 | 262.213 | 4,5 |
| Firefox, masaüstü | kaydetme | video:h264 | 2 | 1280 × 720 | 22.466 | — |
| Firefox, masaüstü | sessiz-kodlama | video:h264 | 2 | 640 × 360 | 270.656 | 4,5 |
| Firefox, telefon boyu | sustur | video:h264 | 24 | 1280 × 720 | 262.213 | 4,5 |
| Firefox, telefon boyu | kaydetme | video:h264 | 2 | 1280 × 720 | 22.466 | — |
| Firefox, telefon boyu | sessiz-kodlama | video:h264 | 2 | 640 × 360 | 270.656 | 4,5 |

## Konsol hataları ve yakalanmamış hatalar

Yok.

