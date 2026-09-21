# ADR-017 — Altyazı adım 4: otomatik transkript, cihaz üstü (tarayıcıda) rota

> Tarih: 2026-09-21 · Durum: ROTA KABUL EDİLDİ, **UYGUNLUK DENEMESİ GEÇMEDİ — uygulama başlamadı**
> Deneme raporu: `docs/spikes/2026-09-21-asr-on-device.md`. Özet: hiçbir açık Whisper
> modeli (tiny/base/small; WebGPU ve WASM; Chromium/Chrome/Edge/Firefox) eşikleri
> tutmadı. Türkçe WER en iyi modelde %20,6 (eşik %10); üç model de sessizlik ve müzikte
> uydurma metin yazdı ("Abone olmayı unutmayın."); small/WebGPU 8,6 GiB bellek. Kendi
> kuralımız gereği çalışmayan özellik ana akışa konmadı. Ücretsiz ek yollar raporda
> (Türkçe ince ayarlı model, VAD ön filtresi, boyut sınırı gevşetilirse large-v3-turbo);
> devam kararı kurucunun.
> Bu ADR, `transcript_araştırma/04` belgesinin istediği **değişiklik önerisidir**: araştırma
> ekiyle belge 31 arasındaki sıralama çelişkisini açıkça çözer ve kanonik belgelerde
> neyin değiştiğini, neyin değişmediğini yazar. Uygulama, aşağıdaki uygunluk
> denemesi geçmeden başlamaz.

## Bağlam

- Altyazı adım 1–3 bitti (ADR-015, ADR-016): elle satır, SRT/VTT, kaynağa bağlı
  satırlar, videoya işleme. Transkript bu hattın üstüne oturur: kelime zamanlı bir
  transkript, kaynak zamanlı (`timeBase: "source"`) bir altyazı izine çevrilir.
- Araştırma eki (`transcript_araştırma/02–04`) transkript için dört bulut adayı ve bir
  yerel seçenek (Whisper, tarayıcıda) sayıyor; hiçbirini seçmiyor ve "ilk sürümde tek
  ana rota" diyor.
- Belge 31 ilk AI deneyi olarak yerel sessizlik kesim önerisini koyuyor; araştırma eki
  bulut transkripti öneriyor. İki belge çelişiyor.
- **Bütçe:** Kurucu ücretli test için para olmadığını söyledi (belge 30 K05 zaten
  "örnek harcamalar yetki değildir" diyor). Ücretli sağlayıcıyla 30 fixture'lık kalite
  ölçümü bile yapılamaz.

## Karar

1. **Tek ana rota: cihaz üstü transkript.** Ses, tarayıcıda çalışan açık kaynak bir
   Whisper modeliyle yazıya çevrilir (Transformers.js / ONNX, WebGPU varsa GPU, yoksa
   WASM). Hiçbir ses, görüntü ya da metin bilgisayardan çıkmaz. API anahtarı, backend,
   kota defteri, rıza ekranı ve sağlayıcı sözleşmesi bu rota için gerekmez.
2. **Bulut rota ertelendi, kapatılmadı.** Kurucu bütçe ve sağlayıcı kararı verirse
   ADR-009 §4'teki adaptör sınırından takılır. Yerel işlem başarısız olunca sessiz
   bulut fallback yoktur (araştırma eki §Yerel model).
3. **Sıralama çelişkisinin çözümü:** Transkript önce gelir, çünkü altyazı hattı hazır ve
   transkript onun doğal devamıdır; sessizlik kesim önerisi (belge 31) sonraki yerel
   deney olarak kalır. İkisi de yerel ve ücretsizdir; belge 31'in "AI önerisi veri,
   komut değil; kullanıcı onayı; tek undo" kuralları aynen geçerlidir.
4. **Kanonik belgelerde değişen:** belge 31'e bu rota ve sıra eklenir; belge 15
   **değişmez** ("AI işlemleri: dahil değil" bulut/ücretli AI için doğru kalır; yerel
   transkript ücretsiz temel özelliktir, kota gerektirmez). Araştırma ekindeki 120 dk /
   30 dil-dakika önerisi onaysız kalır.
5. **Çeviri (adım 5)** bu ADR'nin dışındadır; yerel çeviri modeli ayrı ölçüm ister.

## Kullanıcıya dürüst maliyet

Para yok ama bedel var, açıkça gösterilir:

- **Model indirme:** ilk kullanımda ~40–250 MB (modele göre), tarayıcı önbelleğinde
  kalır. Kullanıcı açık düğmeyle başlatır ("Modeli indir, ~X MB"); otomatik indirme
  yok. Bu, uygulamanın kendi model dosyasını almasıdır; kullanıcı verisi gitmez.
- **Süre ve pil:** dizüstü CPU'da WASM ile gerçek zamanın 1–5 katı sürebilir; ilerleme
  ve iptal zorunlu.
- **Doğruluk:** küçük modeller Türkçede zayıftır. Uygunluk denemesi geçmeyen model
  sunulmaz. Transkript "taslak" olarak gelir; kullanıcı düzeltir (ADR-009 §1).

## Uygunluk denemesi (uygulamadan önce, ücretsiz)

Ölçüm verisi: hakları temiz, girişsiz indirilebilen konuşma kayıtları (CC0/CC-BY:
Common Voice, FLEURS gibi; kaynak ve lisans `web/tests/media/speech/SOURCES.md`'de,
klasör gitignore) ve kurucunun kendi sesiyle kısa Türkçe kayıtlar. Araştırma ekinin
30'luk seti hedef; en az 12 Türkçe + 6 İngilizce + 2 sessiz/müzik negatif.

Ölçülenler (araştırma eki §Teknik deney seti): WER/CER, kelime zaman sapması (p95),
sessiz kayıtta uydurma metin, süre (gerçek zamana oran), tepe bellek, model boyutu,
WebGPU/WASM ve tarayıcı desteği. Başlangıç eşikleri: temiz TR/EN'de WER ≤ %10,
p95 zaman sapması ≤ 250 ms, negatif örneklerde görünür uydurma yok. Eşikler
tutmuyorsa sonuç yazılır ve uygulama başlamaz; "çalışmayan özellik" ana akışa konmaz.

## Uygulama sınırları (deneme geçerse)

- Girdi: yalnızca tutulan anların sesi (varsayılan) ya da açıkça seçilirse tüm kaynak;
  eklenen müzik hiçbir zaman gönderilmez/çözülmez.
- Çıktı: `TranscriptAsset` (kaynak zamanlı kelimeler) → kullanıcı düzeltmesi →
  kaynak zamanlı altyazı izi. Transkript ile gösterilen altyazı ayrı kalır (ADR-009 §1).
  Şema genişletmesi ayrı bir ADR ve kurucu onayı ister.
- Web Worker'da çalışır; sekme kapanınca iş iptal olur; kısmi sonuç kaydedilmez.
- Model dosyaları ya uygulamayla birlikte sunulur ya da ilk kullanımda tek, açık bir
  eylemle indirilir; hangi adresten indiğini arayüz söyler.
