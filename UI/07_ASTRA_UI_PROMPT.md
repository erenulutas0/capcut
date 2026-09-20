# Astra için ilk web UI prompt’u

> 20 Eylül 2026 · UI v0.2 · Önerilen tasarım ve uygulama sözleşmesi. Kullanıcı testi veya üretim hazır oluş kanıtı değildir.

## Kullanım

Proje kökünde aşağıdaki görevi çalıştır. Sadece bu Markdown dosyasını boş bir repo içine atmak yerine güncellenmiş paketin tamamını ver. Mevcut kod varsa önce diffe bak; kullanıcının çalışmasını ezme.

```text
Read AGENTS.md, START_HERE_WEB_UI.md, and docs/33_FIRST_PROMPT.md.
The project is now WEB-FIRST. Implement only W0. Do not start Android or iOS.

Read these sources of truth before coding:
- docs/04_PRD_SCOPE.md
- docs/07_ARCHITECTURE_ADR.md
- docs/10_PROJECT_SCHEMA_CONTRACTS.md
- docs/11_WEB_EDITOR.md
- docs/ui/00_UI_START_HERE.md
- docs/ui/02_VISUAL_SYSTEM.md
- docs/ui/03_WEB_SCREENS.md
- docs/ui/04_INTERACTIONS_STATES.md
- docs/ui/05_MOBILE_HANDOFF.md
- docs/ui/08_ACCEPTANCE_TESTS.md
- docs/ui/09_COPY_EN_TR.md
Inspect design-preview/editor.html, landing.html, tokens.css and the screenshots.
The HTML files are design references, NOT production media/domain code.

OBJECTIVE
Build a polished, calm, usable browser-based clip maker, not a generic SaaS dashboard
and not a miniature Premiere clone. The user's job is: keep selected moments from
one local video, arrange them, adjust framing and audio, and prepare an export.
Design direction: Quiet Studio. Charcoal neutral editor, warm off-white landing,
restrained soft-lime accent. Retain the provisional product name Clip. Do not
invent a trademark clearance, app-store listing, testimonials or user count.

1. Inspect the existing repo, versions, package manager, working tree and tooling.
   Preserve all user changes. Keep an existing suitable stack. For a new project,
   use Next.js/React and TypeScript with CSS variables; Tailwind is optional.
   Radix/shadcn primitives are candidates for dialogs, sheets and controls, not a
   substitute for product-specific design. Verify official APIs and lock actual
   versions. No paid resources, subscriptions, production deploys or secrets.

2. Establish a small framework-independent TypeScript domain layer using document 10.
   Preserve microsecond half-open ranges and source/output time separation.
   Add valid/invalid fixtures and duration/mapping tests. Do not invent an
   incompatible project JSON format. Do not scaffold Dart or backend code in W0.

3. Implement the actual editor first, then its matching landing page.
   Desktop: fixed top bar; 264px Source/Moments panel; large centered preview;
   284px contextual Frame/Audio inspector; compact output sequence below.
   At narrower desktop widths collapse the inspector to a drawer. On phone-sized
   viewports use a vertical layout and a bottom tool sheet, not squeezed columns.
   The main preview and the next meaningful action must dominate visually.
   Avoid fake avatars, team navigation, KPI cards, notification bells, AI chat,
   template malls, huge gradients, excessive shadows and decorative dead buttons.

4. Make these W0 interactions real:
   - pick a local video and read its actual metadata, handle unsupported preview;
   - play/pause/seek with an HTML media element and lifecycle cleanup;
   - mark source in/out, validate numeric time inputs, add/remove/reorder moments;
   - undo/redo domain edits, preserve local source files;
   - visibly distinguish source time from output time and source preview from
     assembled preview; implement a basic ordered preview or label it unavailable;
   - switch aspect presets and center fit/fill; define a shared transform boundary;
   - select an audio file, expose its real metadata and editable segment/offset;
     do not claim final mixed-audio playback unless it actually works;
   - open an honest export settings panel. MediaEngine is not implemented in W0:
     show that fact, disable creation with an explanation, and NEVER simulate a
     completed MP4, fake progress, a successful upload or a successful saved file.
   A mock progress/success story may exist only in an explicitly marked dev-only
   state gallery, never the normal user flow. Prefer no fake success story at all.

5. UI details:
   Use semantic tokens from document 02, readable Turkish defaults and English keys.
   Respect focus, keyboard scope, reduced motion and visible labels. Every drag
   action needs a non-drag control. Time fields remain usable without thumbnails.
   Use textContent/escaped text for filenames. Show honest save state: if persistence
   is not implemented, say this-session only; never say backed up or synced.
   Do not upload video/audio/thumbnails to any service. No session replay analytics.
   Never serialize large video blobs into localStorage or persist blob URLs as assets.

6. Provide empty, importing, invalid-range, source-missing, unsupported-preview,
   unsaved, no-audio and export-unimplemented states. Document the W1 capability
   boundary: playback support is NOT H.264/AAC export support. Do not silently
   fall back to a cloud service or drop audio to make a check appear successful.

7. Run the checks available in this environment: typecheck, lint, unit tests and
   browser UI tests. Capture screenshots at 1440x900, 1366x768, 1024x768 and 390x844.
   Verify no page-level horizontal overflow, modal focus/escape, long Turkish
   filenames and keyboard-only add/reorder/remove. Test layout at 200% zoom where
   the tool permits it. Do not claim physical-phone or screen-reader testing unless run.

8. Report files changed, pinned dependencies, actual commands/results, screenshots,
   implemented interactions, known visual differences, and PASS/FAIL/NOT_RUN criteria.
   Keep MediaEngine/export, billing, cloud, native and AI explicitly out of scope.
   Stop after W0. The next task is W1: a real browser export capability spike.

Quality bar: a coherent working product shell, not a screenshot-only mockup and not
an entire product built with unverified APIs. Where the visual prototype and the
written interaction contract disagree, follow the contract and document the difference.
```

## Tek satırlık başlatma

```text
Read AGENTS.md and docs/33_FIRST_PROMPT.md, then execute docs/ui/07_ASTRA_UI_PROMPT.md for W0 only. The project is web-first; do not implement native apps or fake video exports.
```

## İlk rapordan sonra

Önce `11_UI_REVIEW_PROMPT.md` ile UI'ı denetle. Sonra W1 için doküman 11/09/10 ve QA matrisiyle gerçek 10 saniyelik render görevi ver. UI “güzel” diye codec/senkron testi atlanmaz.
