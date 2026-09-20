# ADR-008 — W0 web yığını, sürümler ve geri alınabilir tercihler

> Tarih: 2026-09-21 · Durum: ÖNERİLEN (W0 uygulamasıyla birlikte)
> Bu ADR yalnızca W0'da gerçekten kurulan ve çalıştırılan şeyleri kaydeder.

## Bağlam

`FIRST_PROMPT_WEB_EDITOR.md` W0 kapsamını tanımlıyor: gerçek yerel video
önizlemesi olan, etkileşimli bir web editörü temeli. Encode motoru, backend,
hesap, bulut ve AI kapsam dışı.

Depoda belge paketi `video-editor-blueprint/` altında, tasarım referansları
`UI/` altında, altyazı araştırması `transcript_araştırma/` altında duruyordu;
uygulama kodu yoktu. Bu ADR uygulamanın nereye ve nasıl kurulduğunu sabitler.

## Karar 1 — Uygulama `web/` altında tek Next.js projesi

Depo kökü `E:\capcut_better`. Belgeler alt klasörlerde olduğu için yeni bir iç
içe uygulama üretilmedi; kök git deposu haline getirildi ve uygulama `web/`
altına kuruldu. Mevcut belge klasörlerinin hiçbiri taşınmadı veya değiştirilmedi.

## Karar 2 — Kilitlenen sürümler

Tümü `--save-exact` ile kuruldu; `web/package-lock.json` repoda.

| Paket | Sürüm | Lisans | Not |
|---|---|---|---|
| next | 16.3.5 | MIT | `engines.node >= 20.9.0`; ortamda Node 20.18.0 |
| react / react-dom | 19.3.0 | MIT | |
| typescript | 5.9.3 | Apache-2.0 | `strict` + `noUncheckedIndexedAccess` |
| vitest | 4.1.11 | MIT | 5.x Node 20.19+ istiyor; 4.x seçildi |
| @playwright/test | 1.63.0 | Apache-2.0 | Chromium 153.0.8010.12 indirildi |
| eslint | 9.39.1 | MIT | |
| eslint-config-next | 16.3.5 | MIT | React 19 hook kuralları dahil |

Medya kütüphanesi **kurulmadı**. Mediabunny, WebCodecs sarmalayıcıları ve
herhangi bir encoder W0'da yok; bunlar W1'in kapsamı ve lisans/boyut/kabiliyet
değerlendirmesi o görevde yapılacak (doc 08, doc 11).

`vitest.config.mts` uzantısı bilinçli: Node 20.18 `require(ESM)` desteklemediği
için `.ts` config CJS olarak yüklenip hata veriyordu.

## Karar 3 — Katmanlar

```
src/domain/       EDL v1, zaman, timeline, çerçeveleme, politika, MediaEngine portu
src/application/  saf komutlar + undo/redo geçmişi + id üretimi
src/adapters/     tarayıcı medya probe'u, W0 MediaEngine (encode yok)
src/components/   React UI
src/i18n/         tr (varsayılan) + en sözlükleri, İngilizce anahtarlar
```

`src/domain` ve `src/application` React, DOM veya Next import etmez; birim
testleri Node ortamında çalışır. Bu sınır ileride Dart/Python tarafının aynı
sözleşmeyi uygulamasını mümkün kılar.

## Karar 4 — W0'da tek video kaynağı

PRD R03 bir projede 5 video kaynağına izin veriyor. W0 tek kaynakla çalışır;
yeni video seçmek onay ister ve eski kaynağa bağlı anları siler. EDL şeması
zaten çoklu kaynağı taşıyabiliyor, dolayısıyla bu bir şema kısıtı değil,
geri alınabilir bir UI kararıdır.

## Karar 5 — Çerçeveleme proje geneli, saklama klip bazında

`view` her klipte saklanır (doc 10), fakat W0'da tek "Görüntü" paneli bütün
kliplere aynı `view`'i yazar. Klip bazlı kırpma sonradan şema değişmeden
eklenebilir.

## Karar 6 — Undo/redo snapshot ile

Ters komut yerine EDL snapshot'ı tutulur (son 100 adım). EDL birkaç KB düz
JSON'dur; medya payload'ı geçmişe girmez (doc 10).

## Karar 7 — Panel görünürlüğü CSS yerine render ile

Gizli bir denetçi kopyası bütün input `id`'lerini ikiye katlıyor ve
`label/for` bağlarını bozuyordu. `useLayoutMode()` dört kabuk döndürür
(`wide / narrow / tablet / phone`) ve paneller moda göre render edilir.

## Karar 8 — Export düğmesi kapalı ve açıklamalı

`assess()` her zaman `canExport: false` döndürür ve ilk engelleyici
`export_engine_not_implemented`'dır. `VideoEncoder`/`AudioEncoder` API tespiti
yalnızca bilgi olarak gösterilir; doc 11'in dediği gibi API'nin bulunması
H.264+AAC çıktısının çalıştığı anlamına gelmez.

## Belgelerdeki çelişkiler (rapor edildi, sessizce çözülmedi)

1. `video-editor-blueprint/docs/33_FIRST_PROMPT.md` Android-first P0-02
   kanıtını istiyor. Güncel görev (`FIRST_PROMPT_WEB_EDITOR.md`,
   `UI/07_ASTRA_UI_PROMPT.md`) web-first W0. Güncel web görevi esas alındı;
   Android kodu üretilmedi.
2. `UI/07_ASTRA_UI_PROMPT.md` şu dosyaları okumayı istiyor ama depoda yoklar:
   `START_HERE_WEB_UI.md`, `docs/ui/00_UI_START_HERE.md`,
   `docs/ui/02_VISUAL_SYSTEM.md`, `docs/ui/03_WEB_SCREENS.md`,
   `docs/ui/04_INTERACTIONS_STATES.md`, `docs/ui/08_ACCEPTANCE_TESTS.md`,
   `docs/ui/09_COPY_EN_TR.md`, `design-preview/landing.html`,
   `design-preview/tokens.css`.
   Mevcut olanlar kullanıldı: `UI/01_UI_RESEARCH_REFERENCES.md`,
   `UI/05_MOBILE_HANDOFF.md`, `UI/VALIDATION.md`, `UI/editor.html` ve
   ekran görüntüleri. Renk/tipografi token'ları `UI/editor.html` içindeki
   `:root` bloğundan ve `UI/VALIDATION.md` kontrast tablosundan alındı.
   Eksik dosyalar okunmuş gibi davranılmadı; W0 durdurulmadı.
3. Klasör adları görevdekinden farklı: `design-preview/` → `UI/`,
   `research/captions-2026-09-20/` → `transcript_araştırma/`,
   `docs/` → `video-editor-blueprint/docs/`. Dosyalar taşınmadı.

## Geri alma yolu

Her karar tek bir modülle sınırlı: yığın `web/package.json`, katman sınırı
klasör yapısı, çerçeveleme `setFraming`, panel modu `useLayoutMode`. W1'de
gerçek motor gelince `src/adapters/w0MediaEngine.ts` yerini alır; `domain`
ve `application` değişmez.
