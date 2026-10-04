# speech-fleurs-en-01.mp4

The one real-speech file in the repository: 9.6 seconds, used by the
end-to-end test that runs the real speech model (`tests/e2e/transcript-real.spec.ts`,
`tests/pages/pages.spec.ts`). Everything else under `tests/media/` is a
generated test pattern or tone.

- **What it is:** one sentence of the Google FLEURS dataset, `en_us` test
  split, sentence id 1749, file `1054805305879816018.wav` (a female speaker
  reading: "It was ruled by the "Vichy" French. These were French people who
  had made peace with the Germans in 1940 and worked with the invaders instead
  of fighting them.").
- **Source:** https://huggingface.co/datasets/google/fleurs, revision
  `70bb2e84b976b7e960aa89f1c648e09c59f894dd` (ungated, no login).
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0).
- **Attribution:** Conneau et al., "FLEURS: Few-shot Learning Evaluation of
  Universal Representations of Speech", 2022 (Google).
- **Changes made:** the 16 kHz mono recording was wrapped into an MP4 with a
  black 320 × 240 picture and re-encoded as AAC (48 kHz, stereo, 128 kbit/s)
  by `web/scripts/transcript/prepare-media.mjs`, so that it is a video the app
  can open. The words were not changed.

The larger measurement sets (LibriSpeech, more FLEURS, music) are not in the
repository; `web/spike/asr/prepare-speech.mjs`, `prepare-english.mjs` and
`web/scripts/transcript/prepare-media.mjs` rebuild them, and their sources and
licences are listed in the generated `web/tests/media/speech/SOURCES.md`.
