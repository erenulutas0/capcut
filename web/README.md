# web — Clip W0 editörü

Kurulum ve komutlar için depo kökündeki [README](../README.md) dosyasına bak.

## Katmanlar

- `src/domain/` — EDL v1, integer mikrosaniye zaman, timeline eşlemesi,
  çerçeveleme tarifi, politika limitleri, `MediaEngine` portu.
  React/DOM/Next import etmez.
- `src/application/` — saf `ProjectV1 -> ProjectV1` komutları ve undo/redo.
- `src/adapters/` — tarayıcı medya probe'u ve W0 MediaEngine (encode yok).
- `src/components/` — React arayüzü.
- `src/i18n/` — Türkçe varsayılan, İngilizce anahtarlı sözlükler.

## Fixture'lar

`fixtures/edl/` altındaki JSON dosyaları dile bağımsızdır. `manifest.json`
hangi dosyanın geçerli olduğunu ve geçersizlerin hangi hata kodlarını üretmesi
gerektiğini listeler. Dart ve Python tarafı aynı dosyaları okuyup aynı sonucu
üretene kadar sözleşme tamamlanmış sayılmaz (doc 10).

## Test medyası

`tests/media/` içindekiler ffmpeg ile yerel olarak üretilmiş sentetik
dosyalardır (`scripts/generate-test-media.mjs`). Telifli içerik veya gerçek
kullanıcı medyası içermez.
