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

# The realistic measurement set (7 Oct 2026) — not in the repository

After real use showed that long, conversational videos lose much of their
speech (ADR-036, "Gerçekçi küme"), the measurements were repeated on speech
that is NOT read aloud. None of these files is committed: `web/tests/media/speech/`
and `web/tests/media/transcript/` are gitignored, and
`node web/scripts/transcript/prepare-realistic.mjs --set=dev|val` followed by
`node web/scripts/transcript/prepare-media.mjs` rebuilds them from the
sources below (downloaded without a login; nothing is uploaded anywhere).
The founder's own recordings (`web/tests/media/real/`) were never read.

| Source | What is used | Licence | Where from |
|---|---|---|---|
| **AMI Meeting Corpus** (University of Edinburgh et al.) | Meetings ES2004a, ES2004b (development) and IS1009a, TS3003a (validation): the headset mix (`Mix-Headset.wav`) and one far-field table microphone (`Array1-01.wav`); the manual word-level transcripts with word times (`ami_public_manual_1.6.2.zip`, `words/*.words.xml`) | CC BY 4.0 (the corpus' own `LICENCE.txt`: "released under the Creative Commons Attribution 4.0 International Public License") | `https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/<meeting>/audio/…`, `https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip` |
| **Earnings-22** (Rev.com) | Whole earnings calls with their reference transcripts (`.nlp`, text only — no word times): 4475604 (development), 4474229 and 4481221 (validation) | CC BY-SA 4.0 (the dataset's `LICENSE.md`, which names the transcripts; the recordings are publicly broadcast calls distributed in the same repository) | `https://github.com/revdotcom/speech-datasets/tree/main/earnings22` |
| **LibriSpeech test-clean** + **LibriSpeech Alignments** | Clean read speech with word times, used ONLY as raw material for the synthetic loudness-step clips and the "music right next to speech" clips (readers not used in the October sets) | CC BY 4.0 | openslr.org/12; zenodo.org/records/2619474 |
| Music (Wikimedia Commons) | Kevin MacLeod "Scheming Weasel (faster)" (CC BY 4.0), Chopin Nocturne Op. 15 no. 1 (CC0), John Bartmann "Robot Gypsy Jazz" (CC0); validation only: Kevin MacLeod "Calmant" and "Windswept" (CC BY 3.0) | as stated | the October spike's files (`web/spike/asr/prepare-english.mjs`) |
| Everyday sounds without speech (Wikimedia Commons) | applause (`277021 sandermotions applause-2.wav`, CC0), a computer keyboard (`Computer keyboard.ogg`, public domain), ocean waves (`Ocean Waves on a Tropical Beach.ogg`, CC0); validation only: typing (`Typing - Model M 1986.ogg`, CC0), surf (`Oceanwavescrushing.ogg`, CC BY 3.0), street sweepers (`Vacuum street cleaners after street parade.ogg`, public domain) | as stated | `https://commons.wikimedia.org/wiki/File:<name>` |

Not used, and why: **TED-LIUM** (CC BY-NC-ND 3.0: non-commercial, no
derivatives — cutting and mixing would be a derivative); **Common Voice**,
**GigaSpeech**, **SPGISpeech** (behind a login); **VoxPopuli** (CC0, usable,
but left out for time: two real conversational sources were judged enough
for this round).

**Changes made:** every clip is converted to 16 kHz mono 16-bit WAV, then
wrapped as an MP4 (black 320 × 240 picture, AAC 48 kHz stereo 128 kbit/s) so
that it is a video the app opens. The synthetic clips change the LEVEL of
speech over time (steps of up to 45 dB), mix a music bed under a meeting, or
butt music against speech with no silence between; the "negative" clips hold
no speech at all (very quiet music, loud-then-quiet music, quiet noise, the
everyday sounds above). The words were never changed. Each clip's exact
recipe is in `prepare-realistic.mjs`; the byte counts and sha256 of every
downloaded file are written to the generated `manifest-real.json`.

**The two sets were made at different times on purpose.** The development
set was built first and every setting was chosen on it; the validation set
(other meetings, other calls, other readers, other music and sounds) was
built only after the settings were frozen, and was run once.
