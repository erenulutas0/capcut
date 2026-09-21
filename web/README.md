# web — Clip W0 editörü

Kurulum ve komutlar için depo kökündeki [README](../README.md) dosyasına bak.

## Katmanlar

- `src/domain/` — EDL v1, integer mikrosaniye zaman, timeline eşlemesi,
  çerçeveleme tarifi, politika limitleri, `MediaEngine` portu.
  React/DOM/Next import etmez.
- `src/application/` — saf `ProjectV1 -> ProjectV1` komutları ve undo/redo.
- `src/adapters/` — tarayıcı medya probe'u, uygunluk kapısı ve IndexedDB
  proje deposu (yalnızca EDL + küçük metadata; medya asla yazılmaz).
- `src/adapters/export/` — encode worker'ı: demux → decode → canvas dönüşümü →
  encode → mux → üretilen dosyanın yeniden açılıp ölçülmesi.
- `src/components/` — React arayüzü.
- `src/i18n/` — Türkçe varsayılan, İngilizce anahtarlı sözlükler.

## Fixture'lar

`fixtures/edl/` altındaki JSON dosyaları dile bağımsızdır. `manifest.json`
hangi dosyanın geçerli olduğunu ve geçersizlerin hangi hata kodlarını üretmesi
gerektiğini listeler. Dart ve Python tarafı aynı dosyaları okuyup aynı sonucu
üretene kadar sözleşme tamamlanmış sayılmaz (doc 10).

## Çıktı doğrulaması

`npm run verify:export` gerçek bir export çalıştırır ve sonucu ffprobe ile
ölçer. Ayrıca aynı kesimi ffmpeg ile bağımsız olarak kurup SSIM karşılaştırması
yapar ve ses bantlarını ölçerek hem kaynak sesinin hem müziğin mikse girdiğini
an başına doğrular. Ayrıntılar: `docs/adr/ADR-010-w1-web-export.md`.

## Test medyası

`tests/media/` içindekiler ffmpeg ile yerel olarak üretilmiş sentetik
dosyalardır (`scripts/generate-test-media.mjs`). Telifli içerik veya gerçek
kullanıcı medyası içermez.
