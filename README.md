# Clip — web video editörü (W0)

> Durum: **W0 tamamlandı.** Editör arayüzü ve düzenleme tarifi çalışıyor.
> Gerçek video çıktısı (encode) **yok** — bu W1'in işi.
> "Clip" geçici çalışma adıdır; marka/alan adı araştırması yapılmadı.

Kullanıcı kendi videosunda tutmak istediği bölümleri seçer, sıralar, görüntü
çerçevesini ve sesi ayarlar. Dosyalar bilgisayardan çıkmaz: bulut yükleme,
hesap, abonelik ve yapay zekâ servisi yoktur.

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

Sentetik test medyası ve EDL fixture'ları üretmek için (ffmpeg gerekir):

```bash
cd web && node scripts/generate-test-media.mjs && node scripts/generate-fixtures.mjs
```

## Depo yapısı

| Yol | İçerik |
|---|---|
| `web/` | Next.js uygulaması (W0 editörü + tanıtım sayfası) |
| `web/src/domain/` | Framework'süz EDL v1, zaman, timeline, çerçeveleme, politika |
| `web/src/application/` | Saf komutlar, undo/redo geçmişi |
| `web/src/adapters/` | Tarayıcı medya probe'u, W0 MediaEngine (encode yok) |
| `web/fixtures/edl/` | Dile bağımsız geçerli/geçersiz EDL örnekleri + manifest |
| `video-editor-blueprint/` | Ürün ve mühendislik belge paketi (değiştirilmedi) |
| `UI/` | Quiet Studio tasarım referansı ve HTML prototipi (değiştirilmedi) |
| `transcript_araştırma/` | Altyazı/transkript araştırma eki (değiştirilmedi) |
| `docs/adr/` | W0 ile birlikte yazılan karar kayıtları |

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
- Gerçek proje değerlerinden hesaplanan, **oluşturma düğmesi kapalı** çıktı paneli.

## Bu sürümde olmayanlar

Gerçek encode/export, gerçek ses miksi, kalıcı kayıt (proje yalnızca sekmede
yaşar), thumbnail üretimi, serbest kırpma, çoklu video kaynağı, altyazı,
bulut, hesap, ödeme ve native uygulama.

Ayrıntı: [ADR-008](docs/adr/ADR-008-web-w0-stack.md),
[ADR-009 (altyazı sınırı)](docs/adr/ADR-009-captions-boundary.md).

## Sıradaki tek görev

**W1 — gerçek web video çıktısı kanıtı:** seçilen anlardan, doğru çerçeveyle
ve ses miksiyle gerçek bir MP4 üretilmesi ve ölçülmesi.
