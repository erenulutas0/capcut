# Clip — web video editörü

**Canlı beta:** https://erenulutas0.github.io/capcut/ · Sorun bildirmek için [GitHub Issues](https://github.com/erenulutas0/capcut/issues) (herkese açıktır: video ya da kişisel bilgi ekleme).

[![CI](https://github.com/erenulutas0/capcut/actions/workflows/ci.yml/badge.svg)](https://github.com/erenulutas0/capcut/actions/workflows/ci.yml)

> Durum: editör, gerçek MP4 çıktısı, yerel kayıt, bölme ve sürükleyerek kırpma,
> altyazı (elle, SRT/VTT, görüntüye bağlı, videoya işleme) ve yerel sessizlik
> kesim önerisi çalışıyor. 15 gerçek kayıt ve 20 vakalık dosya matrisiyle ölçüldü:
> [destek matrisi](docs/SUPPORT_MATRIX.md). Otomatik transkript bütçe kararına
> kadar rafta (ADR-017). "Clip" geçici çalışma adıdır; marka/alan adı araştırması
> yapılmadı.

Kullanıcı kendi videosunda tutmak istediği bölümleri seçer, sıralar, görüntü
çerçevesini ve sesi ayarlar, sonra videoyu indirir. Kodlama tamamen tarayıcıda
yapılır: dosyalar bilgisayardan çıkmaz; bulut yükleme, hesap, abonelik ve dış yapay
zekâ servisi yoktur.

## Çalıştırma

Gereken: **Node ≥ 20.9** (geliştirme Node 20.18.0 ile yapıldı), npm.

```bash
cd web && npm install && npm run dev
```

Ardından tarayıcıda **http://localhost:3000** → editör: **/editor**

Üretim derlemesi:

```bash
cd web && npm run build && npm start
```

## Kontroller

```bash
cd web && npm run typecheck && npm run lint && npm test
```

Tarayıcı testleri (kendi derlemesini `127.0.0.1:3100` üzerinde ayağa kaldırır):

```bash
cd web && npm run build && npm run test:e2e
```

Ekran görüntüleri (`web/screenshots/`), sunucu `:3100`'de ayaktayken:

```bash
cd web && npm run shots
```

Gerçek çıktı doğrulaması — editörü sürer, MP4 üretir, indirir ve **ffprobe** ile
ölçer (sunucu `:3100`'de ayakta olmalı, ffmpeg/ffprobe gerekir):

```bash
cd web && npm run verify:export
```

Aynı doğrulamayı kurulu Google Chrome ile çalıştırmak için:

```bash
cd web && npm run verify:export:chrome
```

Dosya matrisi (doc 22) — fixture'ları üret, bir tarayıcıda çalıştır, destek
matrisini yeniden yaz:

```bash
cd web && npm run matrix:media && npm run matrix -- --browser=chromium && npm run matrix:doc
```

Export bellek ölçümü (Windows; tarayıcı süreç ağacını işletim sisteminden
örnekler, kalıcı profil kullanır):

```bash
cd web && npm run matrix:memory -- --seconds=30,120,300 --label=opfs-route
```

**Kendi kayıtlarınla deneme** — telefon/kamera videolarını `web/tests/media/real/`
klasörüne kopyala (klasör git dışında; dosyalar hiçbir yere yüklenmez, sonuç
dosyasına dosya adı yazılmaz), sunucu `:3100`'de ayaktayken:

```bash
cd web && npm run matrix:real
```

Sentetik test medyası ve EDL fixture'ları üretmek için (ffmpeg gerekir):

```bash
cd web && node scripts/generate-test-media.mjs && node scripts/generate-fixtures.mjs
```

## Depo yapısı

| Yol | İçerik |
|---|---|
| `web/` | Next.js uygulaması (editör + tanıtım sayfası) |
| `web/src/domain/` | Framework'süz EDL v1, zaman, timeline, çerçeveleme, politika, proje kaydı |
| `web/src/application/` | Saf komutlar, undo/redo geçmişi |
| `web/src/adapters/` | Tarayıcı medya probe'u, uygunluk kapısı, IndexedDB proje deposu |
| `web/src/adapters/export/` | Worker tabanlı encode hattı (WebCodecs + Mediabunny) |
| `web/fixtures/edl/` | Dile bağımsız geçerli/geçersiz EDL örnekleri + manifest |
| `video-editor-blueprint/` | Ürün ve mühendislik belge paketi (değiştirilmedi) |
| `UI/` | Quiet Studio tasarım referansı ve HTML prototipi (değiştirilmedi) |
| `transcript_araştırma/` | Altyazı/transkript araştırma eki (değiştirilmedi) |
| `docs/adr/` | Uygulamayla birlikte yazılan karar kayıtları |

## Bu sürümde çalışanlar

- Yerel video seçimi ve **gerçek** metadata okuma (süre, çözünürlük, boyut, tür).
- Oynat/durdur/zamanda gezinme; bozuk veya desteklenmeyen dosya için açık durum.
- Başlangıç/bitiş işaretleme, sayısal zaman alanları, geçersiz aralık reddi.
- Birden fazla an ekleme, düzenleme, kaldırma, sürüklemeden sıralama.
- Aynı kaynak aralığını birden çok kez kullanma.
- "Kaynak" ve "Sonuç" önizleme ayrımı; sonuç modunda sıralı oynatma.
- 9:16 / 16:9 / 1:1 oranları, doldur/sığdır ve merkezden yakınlaştırma.
- Kendi ses dosyasını ekleme; bölüm, çıktı başlangıcı, seviye ve fade ayarları.
- Domain değişikliklerinde undo/redo (son 100 adım).
- **Otomatik yerel kayıt:** düzenleme tarifi 500 ms gecikmeyle bu tarayıcıya
  yazılır. "Kaydedildi" yalnızca yazma gerçekten tamamlandıysa gösterilir;
  reddedilirse sebebi ve yedek indirme yolu görünür.
- **Dosyayı yeniden bağlama:** video dosyaları tarayıcıda saklanamadığı için
  proje geri geldiğinde aynı dosya istenir. Boyut/süre/kare boyutu uyuşmazsa
  dosya sessizce kabul edilmez; kullanıcı uyarılır.
- **Proje yedeği:** tarif `.clip.json` olarak indirilip geri yüklenebilir
  (video içermez).
- **Gerçek MP4 çıktısı:** seçilen anlar sırayla, seçilen çerçeveyle ve kaynak
  sesi + müzik tek ses izinde birleştirilerek H.264/AAC olarak kodlanır.
- Beş aşamalı uygunluk kapısı (ortam → encoder ayarı → sentetik deneme
  dosyası → kaynağın çözülebilirliği → rota). Geçmezse düğme açılmaz.
- Gerçek ilerleme yüzdesi (kodlanan kare / toplam kare), iptal, hata durumları.
- Üretilen dosya yeniden açılıp ölçülür; arayüzdeki süre/çözünürlük/codec
  değerleri o ölçümden gelir.
- **Çıktı diske akar:** destekleyen tarayıcıda dosya belleğe değil tarayıcının
  özel geçici diskine (OPFS) yazılır; bellek kullanımı çıktı uzunluğundan
  bağımsız kalır. Olmazsa bellek yoluna döner ve bunu "Yazıldığı yer"
  satırında söyler. Geçici dosya dialog kapanınca silinir.

## Bu sürümde olmayanlar

Bulut yedeği veya cihazlar arası senkron, çoklu proje listesi, thumbnail
üretimi, serbest kırpma, çoklu video kaynağı, otomatik transkript ve çeviri,
hesap, ödeme ve native uygulama.

Yerel kayıt yalnızca **bu tarayıcıdadır**: tarayıcı verisi temizlenirse veya
başka bir cihaz/tarayıcı kullanılırsa proje orada olmaz. Video dosyaları
hiçbir zaman saklanmaz; proje geri geldiğinde dosya yeniden seçilir.

Çıktı Chromium/Chrome/Edge'de doğrulandı. **Firefox'ta AAC encode olmadığı
için çıktı kapalıdır** ve uygulama bunu açıkça söyler. Gerçek Safari, gerçek
telefon ve gerçek kamera kayıtları hâlâ test edilmedi; ayrıntı ve ölçümler
[destek matrisinde](docs/SUPPORT_MATRIX.md). Çıktı süresi 5 dakika ile
sınırlıdır.

Ayrıntı: [ADR-008](docs/adr/ADR-008-web-w0-stack.md),
[ADR-009 (altyazı sınırı)](docs/adr/ADR-009-captions-boundary.md),
[ADR-010 (W1 çıktı hattı ve ölçümler)](docs/adr/ADR-010-w1-web-export.md),
[ADR-011 (W2 dosya matrisi ve destek sınırları)](docs/adr/ADR-011-w2-file-matrix.md),
[ADR-012 (W3 yerel kayıt ve re-link)](docs/adr/ADR-012-w3-local-persistence.md),
[ADR-013 (W4 çıktıyı OPFS'e akıtmak, gerçek kayıt koşucusu)](docs/adr/ADR-013-w4-output-to-opfs.md),
[ADR-014 (W5 gerçek kayıtlarla kare çözme)](docs/adr/ADR-014-w5-real-media-decoding.md),
[ADR-015 (altyazı: şema v2, videoya işleme)](docs/adr/ADR-015-captions-burn-in.md),
[ADR-016 (SRT/VTT, görüntüye bağlı altyazı)](docs/adr/ADR-016-captions-srt-vtt-source-time.md),
[ADR-017 (cihaz üstü transkript denemesi)](docs/adr/ADR-017-transcript-on-device.md),
[ADR-018 (sessizlik kesim önerisi)](docs/adr/ADR-018-silence-cut-suggestions.md).

## Sıradaki tek görev

W5 tamamlandı: 15 gerçek kayıt (HEVC, döndürmeli, HDR, 60 fps, 5+ dk) Chrome'da
13 geçer / 2 açık ret (HDR), hata yok (ADR-014). Bölme ve sürükleyerek kırpma
eklendi (P1-03).

Altyazı adım 2 tamamlandı (ADR-015): EDL v2 (`captionTracks`, v1 kayıpsız
geçiş), "Altyazı" sekmesi, aynı çizim koduyla önizleme ve dışa aktarmada
piksellere işleme; M17 Chromium/Chrome/Edge'de ölçümle geçiyor.

Altyazı adım 3 tamamlandı (ADR-016): SRT/VTT içe/dışa aktarma (Windows-1254
dahil, saat kullanıcıya sorulur), görüntüye bağlı satırlar (anlarla taşınır,
tekrarda iki kez görünür), saat dönüşümü ve toplu kaydırma; M18/M18b
Chromium/Chrome/Edge'de kare kare ölçümle geçiyor.

Altyazı adım 4 (otomatik transkript): bütçe olmadığı için cihaz üstü rota
seçildi (ADR-017) ve ücretsiz uygunluk denemesi yapıldı; hiçbir açık Whisper
modeli eşikleri tutmadı (Türkçe WER ≥ %20, sessizlikte uydurma metin), uygulama
başlamadı. Rapor: `docs/spikes/2026-09-21-asr-on-device.md`.

Transkript rafa kaldırıldı (kurucu kararı). Yerine belge 31'in ilk yerel AI deneyi
olan **sessizlik kesim önerisi** geldi (ADR-018): tamamen yerel, öneri + onay + tek
geri alma; ölçümle konuşma kesilmesi 37 → 0, bulma %100, sınır p95 37 ms.
Rapor: `docs/spikes/2026-09-22-silence-detector.md`.

Sessizlik önerisinin dinleme kapısı kapandı (kurucu, 10/10 temiz). Beta hazırlığı:
erişilebilirlik (axe 233 → 0), veri envanteri ve taslak gizlilik sayfası, "Sorun bildir"
(GitHub Issues), CI ve GitHub Pages yayını (`docs/beta/`).

**Sıradaki:** kullanıcı testleri (`docs/beta/USER_TEST_KIT.md`, 5–10 kişi) ve kurucunun
Samsung telefonunda canlı adresi denemesi; NVDA ekran okuyucu kontrolü.
Açık küçük kararlar: HDR kayıtları SDR'ye tonlama (şu an reddediliyor) ve
ayrıntılı 60 fps kayıtlarda Chromium'un yazılım kodlayıcısı için bit hızı.
