# 04 — Doğrulama, geliştirme sırası ve Astra’ya aktarım

> Buradaki rakamlar hedef/deney tasarımıdır; gerçekleşmiş sonuç değildir.

## Web-first sırasını koruyan öneri

| Mevcut faz | Araştırma sonrası önerilen ek | Kapı |
|---|---|---|
| W0 | Altyazı kavramına ayrılabilir mimari sınır; çalışan diye sahte düğme ekleme | Mevcut UI ve domain kontrolleri |
| W1 | Önce gerçek kesim + ses çıktısı. Ardından tek manuel cue’nun gerçek MP4’te çizimi için küçük ek spike | İndirilen gerçek dosya bağımsız oynatıcıda doğrulanır |
| W2 | SRT/VTT import, manuel cue edit, üç stil, kaynak/çıktı zaman eşleme, burn-in | Senkron, undo/reorder ve export testleri |
| W3 özel beta | ASR adaptörü; ardından TR↔EN çeviri. Kontrollü harcama ve veri işleme kapılarıyla | Gerçek dil testleri, maliyet kayıtları, kullanıcı izni |
| W4 | Talep varsa AI kotası ve Pro revizyonu; para alma ve kota muhasebesi | Kanonik plan, billing ve gizlilik onayı |
| M1/M2 | Çalışan ortak caption sözleşmesini native motorlara taşı | Cihazda görüntü/ses/metin eşliği |

Önceki belgelerin AI’ı daha sonraya bırakması bu değişiklik önerisiyle çelişebilir. Ajan bunu gizlice çözmesin; PRD/roadmap/AI/pricing/privacy belgelerine açık bir değişiklik önerisi hazırlasın. Özel beta için küçük ASR backend’i gerekebilir; bu genel bulut video upload/render hizmeti açıldığı anlamına gelmez.

## Teknik deney seti

İzinli veya kendi ürettiğimiz 30 kısa fixture önerisi:

- 12 temiz Türkçe tek konuşmacı; özel isimler, sayılar, marka/yazılım terimleri.
- 6 temiz İngilizce tek konuşmacı.
- 4 Türkçe/İngilizce geçişli konuşma.
- 4 gürültülü veya arka plan müzikli konuşma.
- 2 birden fazla kişinin konuştuğu kayıt.
- 2 sessiz veya yalnız müzik içeren negatif örnek.

Referans metin ve seçili kelime zamanlarını insan kontrol eder. Model seçiminde aynı ses, aynı ön işlem, aynı kabul tanımı kullanılmalı; sonuçlar ham fiyat kadar düzeltme emeğini de içermeli. Bu küçük set bütün dillerin/aksanların temsili değildir.

Ölçümler: WER/CER, özel isim/sayı hatası, kullanıcı düzeltme süresi, zaman sapması, no-speech yanlış çıktıları, gecikme, gerçek maliyet ve başarısızlık oranı. Sağırlık erişilebilirliği için yalnız diyalog değil gerektiğinde konuşmacı/ses olayı bilgisi de ayrıca değerlendirilir; otomatik transcript tek başına erişilebilirlik sertifikası değildir.

Örnek başlangıç hedefleri: temiz TR/EN altkümede WER ≤ %10; elle işaretli kelimelerde p95 zaman sapması ≤ 250 ms; iki negatif örnekte görünür uydurma altyazı olmaması. Bunlar ticari doğruluk vaadi değildir. Hatalı hedef seçimi görülürse hata türüyle birlikte revize edilir.

## Zorunlu regresyonlar

Zamanlı dosyada negatif/sıfır süre, ters aralık, UTF-8/Türkçe harfler, uzun satır, HTML-benzeri metin, eksik kaynak, kaynak değişimi, aynı klibin iki kez kullanımı, yeniden sıralama, kesim ortasındaki kelime ve kaynak/çıktı SRT ayrımı test edilir.

Altyazı düzeltildiğinde çevrilmiş track’in eski revizyonda kaldığı görünmeli. Yeniden çeviri otomatik ücret doğurmamalı; önce teklif/kullanıcı eylemi. Export iptalinde kaynaklar temizlenmeli, yerel proje kaybolmamalı. Browser tabında doğru görünmesi MP4 başarısı sayılmaz.

RTL/CJK dillerini yayın kapsamına almak için font ve shaping fixture’ları ayrıca gerekir. Fiziksel telefon/Safari/Firefox test edilmediyse yapılmış sayılmaz.

## Gerçek kullanıcı deneyi

10 hedef yetişkin kullanıcı; edit deneyimi düşük, farklı teknik rahatlık düzeyleri. Üç görev:

1. 90 saniyelik videodan iki bölüm seçerek 30–45 saniyelik klip yap.
2. Altyazı üret, kasıtlı yanlış iki kelimeyi düzelt, müzik seviyesini ayarla.
3. Aynı klibin İngilizce altyazılı versiyonunu oluştur ve indir.

Kendi prototipimizle iki doğrudan rakibi karşılaştır. Sıra etkisini azaltmak için görev/ürün sırasını değiştir; aynı zorlukta farklı içerik kullan. Katılımcının rakibe alışkanlığını kaydet. Katılımcı bütün işi yaparken kurucu ekranı yönlendirmesin.

Ölç: yardımsız başarı, kullanıcı eylem süresi, bekleme süresi, yanlış tıklama, geri dönüş, düzeltme yükü, ücretin anlaşılması ve sonucun kullanılabilirliği. Yardımsız başarı için başlangıç hedefi 10 kişiden en az 8’idir. Yerel 90 saniyelik temiz örnekte ilk anlamlı önizlemeye 2 dakika aktif kullanım hedeflenebilir; model bekleme süresini bu değerden ayrı raporla.

Rakiplere göre daha kolay olduğumuz gösterilemiyorsa yeni özellik eklemek yerine akışı yeniden tasarla. Memnuniyet sözü veya indirme sayısı tek başına ödeme isteği değildir. İkinci kullanım ve küçük, açık bir ücret teklifine gerçek tepkiyi izle; henüz hazır olmayan ürünü satma.

## Maliyet deneyleri

Aynı fixture için gerçek provider faturası/usage ile backend kaydı eşleşsin. Ses aralıkları, çeviri karakterleri, hata/retry, iptal ve tekrar indirme ayrı gözlensin. 10–20 ücretli test işini bile global harcama sınırıyla çalıştır; bu belge API anahtarı kullanma ya da ücretli deneme başlatma yetkisi değildir.

## Astra planlama prompt’u

Aşağıdaki görev **doküman değişiklik önerisi** üretir; tüm altyazı ürününü tek seferde kodlatmaz.

```text
Read AGENTS.md and the current web-first project documents.
Then read research/captions-2026-09-20/README.md and the other five Markdown
files in that research directory.

Treat this addendum as RESEARCH AND PROPOSALS, not an automatic override of
approved architecture, pricing, privacy or current implementation scope.

Do not implement product code, call paid APIs, upload media, deploy, create
subscriptions, or change existing prices/quotas in this task.

1. Inspect current PRD, project schema, media engine boundaries, web-first roadmap,
   UI specification, AI roadmap, pricing, usage ledger, privacy and test plan.
   Preserve all user changes.
2. Produce a concise change proposal for editable captions, SRT/VTT import/export,
   timestamped transcription and later subtitle translation. Keep W0/W1 core gates.
3. Design a backward-compatible transcript/caption schema extension. Preserve
   half-open microsecond ranges, source/output time separation, stable references,
   undo/redo, local-first manual operations, and explicit AI network consent.
4. Specify provider capabilities separately: text, word timing, diarization,
   supported languages, input limits, privacy and price. Do not assume all models
   have identical timestamp support. Mark untested capabilities UNKNOWN.
5. Keep ASR input-time, translated language-time, provider character/token usage,
   alignment and video-render output-time separate. Describe idempotency and retry.
6. Add an approval-required pricing proposal, not a silently active policy.
   Existing platform duration/file limits remain unchanged.
7. Produce a dependency-ordered backlog. First implementation candidate after W1:
   one manually supplied subtitle cue burned into a real short exported video.
   No ASR provider is required for that first caption proof.
8. Report conflicts, proposed document diffs, acceptance criteria, tests not run,
   open decisions and the next single implementation task. Stop at planning.
```

İlk caption proof’undan sonra manuel altyazı sistemi, daha sonra ASR adapteri ve son olarak çeviri eklenir. Her adımın gerçek çıktısı/kanıtı olmadan sonraki özelliğe geçilmez.
