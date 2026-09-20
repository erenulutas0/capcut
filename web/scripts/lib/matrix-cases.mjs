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
    title: 'İzin iptali / kaynağın silinmesi',
    expectation: 'Re-link yolu; EDL kaybolmuyor',
    notRun:
      'Tarayıcıda seçilmiş bir File referansının iznini test sürücüsünden iptal etmenin yolu yok; ' +
      'ayrıca kalıcı kayıt (re-link) henüz uygulanmadı.',
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
];
