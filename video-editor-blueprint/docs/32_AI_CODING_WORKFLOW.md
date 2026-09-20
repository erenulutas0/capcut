# 32 — AI ile Kodlama İş Akışı ve Görev Prompts

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Neden tek dev prompt değil?

Bu paketin genişliği ürünün bütün risklerini görünür kılmak içindir; tek seferde bütün uygulamayı ürettirmek için değil. Medya API'lerinde derlenen ama yanlış ses/görüntü üreten kod mümkündür. Küçük görev, gerçek çıktı ve ortak fixture kabulü daha değerlidir.

## Çalışma döngüsü

1. İlgili belge ve backlog ID okunur; mevcut repo/çalışan kod incelenir.
2. Somut kabul kriteri ve test verisi seçilir; belirsiz API resmi sürüm kaynağından doğrulanır.
3. En küçük dikey dilim uygulanır; hiçbir ücretli/üretim kaynağı kendiliğinden açılmaz.
4. Gerçek testler çalıştırılır; mümkün olmayan cihaz/araç açıkça `NOT_RUN` yazılır.
5. Değişiklik, sonuç dosyaları ve kalan risk raporlanır; sonraki faz otomatik başlamaz.

İlk başlangıç metni [33_FIRST_PROMPT](33_FIRST_PROMPT.md) içindedir. Ortak kurallar [AGENTS](../AGENTS.md).

## Görev prompt'u — özellik

```text
Read AGENTS.md and docs/04_PRD_SCOPE.md.
Implement only backlog item P1-02 using the existing project contracts.
Read docs/05_USER_FLOWS_UX.md, docs/10_PROJECT_SCHEMA_CONTRACTS.md,
and the relevant tests in docs/22_QA_TEST_MATRIX.md.

Preserve user changes and source media. Do not add billing, cloud, AI,
new analytics SDKs, or unrelated refactors. Keep platform limitations explicit.
First inspect the repository, then implement the smallest working vertical slice.
Run actual checks that are available and report commands/results honestly.
Stop after the acceptance criteria for P1-02 are met or concrete blockers are documented.
```

Bu İngilizce görev bloğu kod ajanına verilmek üzere hazırlanmıştır; ürün belgelerinin dili Türkçe kalır. ID başka hikâyeye değişirse ilgili dosya ve kabul ölçütü de değiştirilir.

## Görev prompt'u — hata düzeltme

```text
Read AGENTS.md and the supplied bug report.
Reproduce the bug with a licensed or synthetic fixture before changing behavior.
Add a failing regression test where practical. Identify whether the fault is
in EDL semantics, preview, native/web rendering, or output delivery.
Fix the smallest responsible layer. Do not mask the error by changing the expected
output duration or silently uploading media. Report what was and was not verified.
```

## Görev prompt'u — bağımsız review

```text
Review this change without rewriting it wholesale.
Focus on source preservation, timestamp accuracy, audio/video synchronization,
resource cleanup, ownership checks, idempotency, and quota invariants.
Classify findings by user impact and attach a concrete reproduction or code reference.
Distinguish verified defects from hypotheses. Do not claim tests ran unless they did.
```

## Context yönetimi

Bütün belgeleri her küçük görevde prompt'a doldurmak yerine ortak kurallar + ilgili kapsam + contracts + test bölümünü seç. Kanonik sayı/kural değişirse referans belgesini güncelle, eski prompt'a kopyalanmış değeri tek gerçek kaynak yapma.

Task sonucu `implementation report` olarak branch/PR içinde tutulabilir: amaç, değişen dosyalar, test komutları, gerçek output artifact'leri, süre/crop/sync kanıtı, engeller. Ajanın “tamam” cümlesi teknik kanıt yerine geçmez.

## İnsan kontrolü gereken alanlar

Gerçek cihaz görüntü/ses incelemesi, lisans sözleşmesi, ödeme sağlayıcısı kabulü, store metadata beyanı, kullanıcı görüşmesi, ücret değişikliği, production secrets ve deploy. AI taslak hazırlayabilir; bunları gerçekleştirilmiş veya hukuken onaylanmış diye raporlayamaz.

Sonraki göreve geçiş: kodun açılması değil, kabul ölçütlerinin kanıtı. Başlangıçta görsel polish'ten önce 10 saniyelik doğru dosya üretmeyi seç.
