/**
 * The doc 22 media matrix, expressed as things the runner does to the real app
 * and things ffprobe/ffmpeg must then be able to measure in the produced file.
 *
 * Each case owns its own assertions. A case that cannot be driven here says so
 * with `notRun` and a reason — it is never reported as a pass.
 */

export const TONE = {
  /** Frequency of the tone baked into most video fixtures. */
  source: 440,
  /** The 220 Hz music fixture. */
  music: 220,
  /** The 330 Hz WAV music fixture. */
  wav: 330,
  /** The 880 Hz tone in the boundary fixture. */
  boundary: 880,
  /** Neither fixture has energy here; used as the noise floor reference. */
  control: 3000,
};

/**
 * @typedef {object} MatrixCase
 * @property {string} id
 * @property {string} title
 * @property {string} expectation   What doc 22 says must be true.
 * @property {string} [notRun]      Set when this environment cannot run it.
 * @property {object} [setup]       What the runner does in the app.
 * @property {object} [expect]      What must hold afterwards.
 */

/** @type {MatrixCase[]} */
export const CASES = [
  {
    id: 'M01',
    title: '20 s dikey H.264/SDR + iki aralık',
    expectation: 'Çıktı 10 s; doğru sıra ve görüntü',
    setup: {
      video: 'm01-portrait-20s.mp4',
      moments: [['00:00.000', '00:04.000'], ['00:08.000', '00:14.000']],
      aspect: '9-16',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 10,
      frames: 300,
      size: [720, 1280],
      videoCodec: 'h264',
      audioCodec: 'aac',
      reference: { filter: 'crop=iw:ih,scale=720:1280', trims: [[0, 4], [8, 14]] },
      minSsim: 0.9,
      tonePresent: [TONE.source],
      perMomentTone: TONE.source,
    },
  },
  {
    id: 'M02',
    title: '90° rotation metadata',
    expectation: 'Dikey görüntü doğru; ikinci kez dönmemiş',
    setup: {
      video: 'm02-rotate90.mp4',
      moments: [['00:00.000', '00:05.000']],
      aspect: '9-16',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 5,
      frames: 150,
      size: [720, 1280],
      // ffmpeg applies the display matrix once on decode. If the browser applied
      // it twice (or not at all) this comparison collapses.
      reference: { filter: 'crop=ih*9/16:ih,scale=720:1280', trims: [[0, 5]] },
      minSsim: 0.9,
      editorDisplaySize: [720, 1280],
    },
  },
  {
    id: 'M03',
    title: 'Yatay kaynak → 9:16 crop',
    expectation: 'Preview ve çıktı aynı alan',
    setup: {
      video: 'm03-landscape-1080p.mp4',
      moments: [['00:02.000', '00:07.000']],
      aspect: '9-16',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 5,
      frames: 150,
      size: [720, 1280],
      reference: { filter: 'crop=ih*9/16:ih,scale=720:1280', trims: [[2, 7]] },
      minSsim: 0.9,
    },
  },
  {
    id: 'M04',
    title: 'Sessiz video + WAV müzik',
    expectation: 'Ses kaynağı doğru, sessiz stream hatası yok',
    setup: {
      video: 'm04-silent.mp4',
      music: 'm04-music.wav',
      moments: [['00:00.000', '00:06.000']],
      aspect: '16-9',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 6,
      audioCodec: 'aac',
      tonePresent: [TONE.wav],
      // The source has no audio track, so 440 Hz must stay far below the music.
      // An absolute threshold would not work: a 330 Hz tone leaks about 20 dB
      // into a 440 Hz band no matter what is in the file.
      toneBelow: { frequency: TONE.source, reference: TONE.wav, minMarginDb: 14 },
    },
  },
  {
    id: 'M05',
    title: '44.1 kHz müzik + 48 kHz kaynak',
    expectation: 'Drift/pitch değişimi yok',
    setup: {
      video: 'm01-portrait-20s.mp4',
      music: 'm05-music-44k.m4a',
      moments: [['00:00.000', '00:05.000']],
      aspect: '9-16',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 5,
      tonePresent: [TONE.music],
      // 220 Hz played back without resampling would land at 220*48/44.1 = 239.5 Hz.
      // 220 and 239.5 Hz are only 20 Hz apart, so this needs a narrow filter.
      pitchCheck: { expected: 220, wrong: 240, width: 4, minMarginDb: 12 },
    },
  },
  {
    id: 'M06',
    title: 'VFR kaynak',
    expectation: 'PTS sırası, kesim aralıkları ve sync korunuyor',
    setup: {
      video: 'm06-vfr.mp4',
      moments: [['00:01.000', '00:04.000'], ['00:08.000', '00:11.000']],
      aspect: '16-9',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 6,
      frames: 180,
      constantFrameRate: 30,
      tonePresent: [TONE.source],
    },
  },
  {
    id: 'M07',
    title: '29.97 fps kaynak',
    expectation: 'Yuvarlanan fps yüzünden zaman kaymıyor',
    setup: {
      video: 'm07-2997fps.mp4',
      moments: [['00:00.000', '00:10.000']],
      aspect: '16-9',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 10,
      frames: 300,
      constantFrameRate: 30,
    },
  },
  {
    id: 'M08',
    title: 'Müzik 5–15 s, timeline başlangıcı 2 s',
    expectation: 'İlk 2 s müzik yok; sonraki offset doğru',
    setup: {
      video: 'm01-portrait-20s.mp4',
      music: 'm05-music-44k.m4a',
      moments: [['00:00.000', '00:04.000'], ['00:08.000', '00:14.000']],
      aspect: '9-16',
      quality: '720',
      musicSegment: { inTime: '00:05.000', outTime: '00:15.000', startTime: '00:02.000' },
    },
    expect: {
      exports: true,
      durationSeconds: 10,
      // The 440 Hz source tone is ~25 dB louder than the music, so it is
      // notched out before the music band is measured.
      musicWindow: {
        frequency: TONE.music,
        notch: TONE.source,
        silentUntil: 1.8,
        audibleFrom: 2.4,
        minMarginDb: 15,
      },
    },
  },
  {
    id: 'M09',
    title: 'Klip sınırında ses',
    expectation: 'Beklenmedik çift ses/boşluk yok',
    setup: {
      video: 'm09-boundary.mp4',
      moments: [['00:00.000', '00:03.000'], ['00:10.000', '00:13.000']],
      aspect: '16-9',
      quality: '720',
    },
    expect: {
      exports: true,
      durationSeconds: 6,
      // The 880 Hz tone runs through the whole source, so the level must not
      // dip at the 3 s clip boundary.
      boundaryContinuity: { frequency: TONE.boundary, atSeconds: 3, windowSeconds: 0.25, maxDipDb: 6 },
    },
  },
  {
    id: 'M10-hevc',
    title: '4K HEVC kaynağı',
    expectation: 'Doğrulanmış yol veya erken açık unsupported; yanlış renkli başarı yok',
    setup: {
      video: 'm10-4k-hevc.mp4',
      moments: [['00:00.000', '00:03.000']],
      aspect: '16-9',
      quality: '720',
    },
    expect: {
      // Three outcomes are acceptable — import refusal, gate refusal, or a
      // correct file. A silent wrong success is not.
      exportsOrBlocks: true,
      durationSeconds: 3,
    },
  },
  {
    id: 'M10-hdr',
    title: 'HDR (bt2020 / PQ) kaynağı',
    expectation: 'Tone mapping doğrulanmadığı için açıkça reddedilmeli',
    // H.264 on purpose: an HEVC file is already refused at import, which would
    // never let the HDR gate run.
    setup: {
      video: 'm10-hdr-h264.mp4',
      moments: [['00:00.000', '00:03.000']],
      aspect: '16-9',
      quality: '720',
    },
    expect: { blocksWith: 'hdr_source_unsupported' },
  },
  {
    id: 'M11',
    title: 'Bozuk/truncated MP4',
    expectation: 'Kontrollü hata; app ve proje korunuyor',
    setup: { video: 'm11-truncated.mp4', expectImportFailure: true },
    expect: { importRejected: true, appStillUsable: true },
  },
  {
    id: 'M12',
    title: 'Çok kısa ve maksimum 20 klip',
    expectation: 'Minimum aralık ve boundary tutarlı',
    setup: {
      video: 'm01-portrait-20s.mp4',
      repeatMoment: { count: 20, lengthSeconds: 0.2 },
      expectExtraRejected: true,
      aspect: '16-9',
      quality: '720',
    },
    expect: { exports: true, durationSeconds: 4, frames: 120 },
  },
  {
    id: 'M13',
    title: 'Politika sınırını aşan büyük dosya',
    expectation: 'Ön kontrol/hata; yarım çıktı başarı sayılmıyor',
    setup: { video: 'm13-oversize.mp4', expectImportFailure: true },
    expect: { importRejected: true, appStillUsable: true },
  },
  {
    id: 'M14',
    title: 'Kaynağa erişim kaybı ve yeniden bağlama',
    expectation: 'Re-link yolu; EDL kaybolmuyor',
    // Reloading the tab reproduces the real condition: the recipe is still
    // stored but the `File` object is gone, exactly as after a restart. A
    // browser API to revoke a picked file mid-session does not exist.
    setup: {
      video: 'm01-portrait-20s.mp4',
      moments: [['00:00.000', '00:04.000'], ['00:08.000', '00:14.000']],
      aspect: '9-16',
      quality: '720',
      reloadBeforeExport: true,
    },
    expect: {
      exports: true,
      durationSeconds: 10,
      frames: 300,
      size: [720, 1280],
      relinked: true,
    },
  },
  {
    id: 'M15',
    title: 'Export sırasında sekme arka plana alınıyor',
    expectation: 'Kurtarma; sahte resume iddiası yok',
    setup: {
      video: 'm01-portrait-20s.mp4',
      moments: [['00:00.000', '00:06.000']],
      aspect: '16-9',
      quality: '720',
      backgroundDuringExport: true,
    },
    expect: { exports: true, durationSeconds: 6, frames: 180 },
  },
  {
    id: 'M16',
    title: 'Gain toplamı / fade sınırları',
    expectation: 'Güvenli miks ve preview/render tutarlılığı',
    setup: {
      video: 'm01-portrait-20s.mp4',
      music: 'm05-music-44k.m4a',
      moments: [['00:00.000', '00:06.000']],
      aspect: '16-9',
      quality: '720',
      musicGainDb: 0,
      fades: { inTime: '00:01.000', outTime: '00:01.000' },
    },
    expect: {
      exports: true,
      durationSeconds: 6,
      // Two full-gain sources must still not clip.
      maxPeakDb: -0.5,
      fadeCheck: { frequency: TONE.music, quietAt: 0.1, loudAt: 3, minMarginDb: 10 },
    },
  },
  {
    id: 'M17',
    title: 'Altyazı videoya işleniyor',
    expectation:
      'Satırlar planlanan karelerde ve doğru bölgede görünüyor; satır dışındaki kareler altyazısız referansla aynı',
    // The captions reach the project through the backup import (a supported
    // app path), not through any caption editing UI. One track has one style,
    // so the two presets are two exports of the same edit.
    setup: {
      video: 'm01-portrait-20s.mp4',
      moments: [['00:00.000', '00:04.000'], ['00:08.000', '00:14.000']],
      aspect: '9-16',
      quality: '720',
      captions: {
        variants: [
          { label: 'kutu-alt', style: { preset: 'box', position: 'bottom', size: 'medium' } },
          { label: 'kontur-ust', style: { preset: 'outline', position: 'top', size: 'medium' } },
        ],
        // Output time. The second cue crosses the 4 s cut between the two
        // moments, so the worker must follow OUTPUT frames, not source time.
        cues: [
          { startUs: 500_000, endUs: 2_500_000, text: 'Günaydın İstanbul' },
          { startUs: 3_500_000, endUs: 7_000_000, text: 'Dağlar ışıl ışıl\nŞimdi başlıyoruz' },
        ],
      },
    },
    expect: {
      exports: true,
      durationSeconds: 10,
      frames: 300,
      size: [720, 1280],
      videoCodec: 'h264',
      audioCodec: 'aac',
      captions: {
        fps: 30,
        totalFrames: 300,
        // Same independent ffmpeg edit as M01, without captions.
        reference: { filter: 'crop=iw:ih,scale=720:1280', trims: [[0, 4], [8, 14]] },
        // M01's whole-file bar; per frame a little lower for codec variance.
        minCleanSsim: 0.9,
        minCleanSsimFrame: 0.85,
        // Mean absolute luma difference (0-255) inside the cue region, over
        // the noise of two different encoders (~13-14 on this busy pattern).
        minRegionRise: 10,
        minRegionSeparation: 4,
        screenshots: [
          { file: 'screenshots/caption-export-frame.png', frame: 150 },
          { file: 'screenshots/caption-export-frame-outline.png', frame: 150 },
        ],
      },
    },
  },
  {
    id: 'M18',
    title: 'Görüntüye bağlı altyazı anlarla taşınıyor',
    expectation:
      'Kaynak zamanlı satırlar, sırası değişmiş ve tekrar eden anlarda O + (t − S) karelerinde görünüyor; başka yerde yok',
    setup: anchoredSetup({
      variants: [
        // Negative control: the same edit, imported with no caption track,
        // must measure as caption-free everywhere.
        { label: 'altyazisiz', track: null },
        { label: 'kaynak', track: 'source' },
      ],
    }),
    expect: anchoredExpect({
      screenshot: { file: 'screenshots/caption-source-anchored-frame.png', variant: 'kaynak', frame: 285 },
    }),
  },
  {
    id: 'M18b',
    title: 'Kaynak → sonuç dönüşümü görünen altyazıyı değiştirmiyor',
    expectation: 'Aynı kurgu, satırlar sonuç zamanına çevrilmiş; altyazı kareleri M18 ile aynı',
    setup: anchoredSetup({ variants: [{ label: 'cikti', track: 'output' }] }),
    expect: anchoredExpect({ sameAs: { caseId: 'M18', variant: 'kaynak' } }),
  },
];

/**
 * M18/M18b share one edit. m01's testsrc burns the SOURCE second into every
 * frame, so a frame grab shows which source instant a caption sits on.
 *
 * Moments are out of order and [2,4) is used twice:
 *   output [0,4)  ← source [8,12)
 *   output [4,8)  ← source [0,4)
 *   output [8,12) ← source [2,6)
 * Source lines: "bir" [1,3) is shown twice (whole, then cut at the start of
 * the third moment); "dokuz" [9,11) once; "üç-beş" [3,5) is cut by the 4 s
 * edge of the second moment and shown whole in the third. Their boxes differ
 * (width, and a second line for "üç-beş"), which is how the measurement
 * tells back-to-back lines apart.
 */
function anchoredSetup({ variants }) {
  return {
    video: 'm01-portrait-20s.mp4',
    moments: [['00:08.000', '00:12.000'], ['00:00.000', '00:04.000'], ['00:02.000', '00:06.000']],
    aspect: '9-16',
    quality: '720',
    anchoredCaptions: {
      style: { preset: 'box', position: 'bottom', size: 'medium' },
      // SOURCE time (timeBase 'source', bound to the video asset).
      sourceCues: [
        { startUs: 1_000_000, endUs: 3_000_000, text: 'bir' },
        { startUs: 3_000_000, endUs: 5_000_000, text: 'üç-beş\nkesimin iki yanında' },
        { startUs: 9_000_000, endUs: 11_000_000, text: 'dokuz' },
      ],
      variants,
    },
  };
}

function anchoredExpect(extra) {
  return {
    exports: true,
    durationSeconds: 12,
    frames: 360,
    size: [720, 1280],
    videoCodec: 'h264',
    audioCodec: 'aac',
    anchoredCaptions: {
      fps: 30,
      totalFrames: 360,
      // Caption-free ffmpeg edit of the same moments, in the same order.
      reference: { filter: 'crop=iw:ih,scale=720:1280', trims: [[8, 12], [0, 4], [2, 6]] },
      // Picture check on the caption-free control and on frames with no line.
      minSsim: 0.9,
      minCleanSsimFrame: 0.85,
      // Edge contrast (mean |luma diff| just inside a box edge minus just
      // outside it, 0-255) a frame needs to count as showing that box. See
      // ADR-016 "Ölçüm (M18)" for the measured levels this sits between.
      minContrast: 12,
      ...extra,
    },
  };
}
