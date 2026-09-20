# 33 — İlk Kodlama Promptu

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Kullanım

Zip içeriğini proje köküne çıkar. Yeni repo veya mevcut repo fark etmez; mevcut kod varsa korunmalıdır. Aşağıdaki prompt'u kod ajanına ver. Ücretli hesap açma/production deploy yetkisi vermez. İlk görev **P0-01 + Android için P0-02'nin tek kaynaklı kanıt dilimi** ile sınırlıdır; tam editör veya bütün platformlar değildir.

```text
Read AGENTS.md completely, then read:
- README.md
- docs/04_PRD_SCOPE.md
- docs/07_ARCHITECTURE_ADR.md
- docs/08_TECH_STACK_DEPENDENCIES.md
- docs/09_MEDIA_PIPELINE.md
- docs/10_PROJECT_SCHEMA_CONTRACTS.md
- docs/12_MOBILE_NATIVE.md
- docs/22_QA_TEST_MATRIX.md
- docs/29_ROADMAP_BACKLOG.md

The documents describe a multi-phase product. They are not permission to implement
all phases now. Work only on P0-01 and a minimal Android P0-02 proof.
Treat all provider choices, prices, quotas, and benchmark thresholds as documented
proposals, not existing services or verified results.

1. Inspect the existing repository and preserve all user changes.
   Report the detected environment: Flutter/Dart, Android toolchain, Node/TypeScript,
   Python, FFmpeg if already available, and any real devices/emulators.
   Do not assume macOS/Xcode or an iPhone exists. Do not install paid services,
   purchase anything, create production resources, or deploy.

2. Establish the versioned EDL v1 contract described in document 10.
   Add an actual machine-readable JSON Schema and shared valid/invalid fixtures.
   Implement the smallest Dart and TypeScript validation/duration helpers needed
   for the spike. If backend scaffolding is unnecessary, do not create a backend;
   document the later Python contract requirement instead.
   Validate half-open microsecond ranges, references, safe integers, crop bounds,
   fade bounds, and total output duration. No UI framework dependency in the domain.

3. Build a deliberately plain Flutter Android proof screen, not the final editor.
   Use the system picker to select one compatible SDR H.264 test video and one
   user-selected compatible audio file. Do not request broad gallery access.
   Implement a typed native Kotlin MediaEngine adapter using a verified current
   Media3 version. Check official APIs before writing integration code.
   Do not install the retired original FFmpegKit package as the default solution.

4. The proof must export a real 10-second video made from [0s,4s) and [8s,14s)
   of a source of at least 20 seconds. Use a fixed 9:16 crop/fit recipe consistent
   with the contract. Use audio [5s,15s) starting at output 0s when the selected
   audio supports that range. Apply documented gains and preserve source media.
   If a fixture is missing, create or specify a synthetic licensed fixture path;
   never invent a local file, silently download copyrighted media, or claim export ran.
   The minimal screen may use fixed test ranges rather than the full range-selection UI.

5. Implement actual prepare/export/progress/cancel/failure states and resource cleanup.
   Do not simulate a successful export. A success result must reference a valid file.
   Add a source-read failure and cancel regression path. Keep media on-device.
   No auth, subscription, cloud upload, AI, stock music, or advanced effects.

6. Run available format/type/unit/contract/build checks. If an Android device is
   available, run the export and inspect output duration, orientation, audio alignment,
   and source preservation. If physical verification is unavailable, say NOT_RUN and
   provide exact reproducible steps. An emulator result is not a physical-device result.

7. Produce a concise implementation report:
   changed files, exact dependency versions and license notes, real commands/results,
   artifact paths if created, passed/failed/not-run acceptance criteria, blockers,
   and the next single backlog item. Do not proceed to full P1, iOS, web editor,
   cloud, or billing automatically.

Where a safe local technical choice is not specified, make a small reversible choice
and record an ADR proposal. Where payment, privacy, licensing, destructive changes,
or production access is involved, keep the feature disabled rather than guessing.
```

## Neden bu başlangıç?

Bu dilim, projenin temel riskini erkenden gösterir: seçilen iki aralık, doğru crop ve doğru sesle gerçek video oluşuyor mu? Sadece ekran tasarımı üretmek bu soruyu cevaplamaz. Native araç yoksa başarılı sonuç uydurmak yerine contracts/test harness ilerletilir ve eksik ortam açıkça yazılır.

## İlk rapordan sonra ikinci görev

Android kanıtını kontrol ettikten sonra **P0-03 web capability harness** gelir. Ajan `docs/11_WEB_EDITOR.md` ve ortak fixtures üzerinden H.264/AAC encode, gerçek kısa render, memory/dispose ve unsupported durumunu test eder. iOS P0-04, macOS ve fiziksel cihaz erişimiyle ayrı görevdir. Bütün motorlar aynı commit'te “tamamlandı” ilan edilmez.

## Kodlamaya başlatan kısa komut

```text
Read AGENTS.md, then read docs/33_FIRST_PROMPT.md and execute only its initial scope.
Do not implement later phases automatically.
```
