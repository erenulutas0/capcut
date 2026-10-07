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
- `src/components/` — React arayüzü: `home/` açılış ekranı (iş kartları + yazarak
  bulma), `wizard/` görev sihirbazları (`/yap/<id>/`), `editor/` kesit editörü.
- `src/i18n/` — Türkçe varsayılan, İngilizce anahtarlı sözlükler.

## Açılış ekranı ve sihirbazlar (ADR-034)

- İş kaydı: `src/domain/tasks.ts` (kimlik, etiket, simge, `available`, adımlar, arama
  kelimeleri). Arama: `src/domain/taskSearch.ts` (cihazda, kelime listesiyle; ağ yok).
- Sihirbaz çatısı: `src/components/wizard/` — `TaskWizard` (sayfa; editörün durum kancası,
  proje saklamadan), `WizardFlow` (video seç → karar → indir), `useWizardExport`
  (dışa aktarmaya giden tek yol; ek seçenekler `extras`), `wizards.tsx` (dokuz sihirbaz).
- **Yeni bir işi açmak:** `tasks.ts`'te `available: true` + `wizards.tsx`'te bileşeni ve
  `WIZARDS` tablosundaki satırı. Bileşen eksikse `npm run typecheck` derlemez.
- **Yapılamayan bir isteği dürüstçe yanıtlamak:** `tasks.ts`'te `available: false` bir giriş
  (simgesi `taskLater`, kelimeleri, `task.<id>.label` / `.sub` mesajları). Kartı, sayfası ve
  sihirbazı olmaz; arama "Bunu henüz yapamıyoruz." der. Cümleleri önce
  `tests/unit/taskSearchHeldOut2.test.ts`'e (listelere dokunmadan ölç), sonra
  `taskSearch.test.ts`'e ekle.
- Ekran görüntüleri: `node scripts/home-shots.mjs` → `docs/ux/2026-10-03-home/shots/`.

## Fixture'lar

`fixtures/edl/` altındaki JSON dosyaları dile bağımsızdır. `manifest.json`
hangi dosyanın geçerli olduğunu ve geçersizlerin hangi hata kodlarını üretmesi
gerektiğini listeler. Dart ve Python tarafı aynı dosyaları okuyup aynı sonucu
üretene kadar sözleşme tamamlanmış sayılmaz (doc 10).

## Çıktı doğrulaması

`npm run verify:export` gerçek bir export çalıştırır ve sonucu ffprobe ile
ölçer. Ayrıca aynı kesimi ffmpeg ile bağımsız olarak kurup SSIM karşılaştırması
yapar ve ses bantlarını ölçerek hem kaynak sesinin hem müziğin mikse girdiğini
kesit başına doğrular. Video, kaydetme penceresinin yerine geçen bir test
penceresinin verdiği dosyaya yazılır (ADR-026); gerçek pencerenin ölçümleri
`scripts/measure-save-picker.mjs` ile yapılır. Ayrıntılar: `docs/adr/ADR-010-w1-web-export.md`.

## Test medyası

`tests/media/` içindekiler ffmpeg ile yerel olarak üretilmiş sentetik
dosyalardır (`scripts/generate-test-media.mjs`). Telifli içerik veya gerçek
kullanıcı medyası içermez.
