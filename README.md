# Clip — web video editörü (W3)

> Durum: **W3 tamamlandı.** Editör çalışıyor, desteklenen tarayıcıda
> **gerçek MP4 (H.264/AAC) çıktısı** üretiyor, doc 22 dosya matrisi beş
> tarayıcıda çalıştırıldı ve proje artık **tarayıcıya kaydediliyor**;
> sekme kapansa bile düzenleme tarifi geri geliyor.
> Sonuçlar: [destek matrisi](docs/SUPPORT_MATRIX.md).
> "Clip" geçici çalışma adıdır; marka/alan adı araştırması yapılmadı.

Kullanıcı kendi videosunda tutmak istediği bölümleri seçer, sıralar, görüntü
çerçevesini ve sesi ayarlar, sonra videoyu indirir. Kodlama tamamen tarayıcıda
yapılır: dosyalar bilgisayardan çıkmaz, bulut yükleme, hesap, abonelik ve yapay
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

## Bu sürümde olmayanlar

Bulut yedeği veya cihazlar arası senkron, çoklu proje listesi, thumbnail
üretimi, serbest kırpma, çoklu video kaynağı, altyazı, hesap, ödeme ve native
uygulama.

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
[ADR-012 (W3 yerel kayıt ve re-link)](docs/adr/ADR-012-w3-local-persistence.md).

## Sıradaki tek görev

**W4 — gerçek kullanıcı medyası:** matrisi gerçek telefon/kamera kayıtlarıyla
tekrarlamak (gerçek VFR, rotation, HEVC, 4K, uzun kayıt) ve oradan çıkacak
bellek/süre ölçümleriyle `StreamTarget` kararını vermek.
