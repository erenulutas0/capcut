/**
 * The task registry of the opening screen (ADR-034): every job the app
 * offers — or is honestly not offering yet — in one list. The cards, the
 * type-to-find box and the wizard routes (`/yap/<id>/`) all read it.
 *
 * Pure data: labels are message keys, icons are names of the `Icon`
 * component, the words people type live here in Turkish and English. Nothing
 * here knows React or the export engine.
 *
 * Enabling a task that is not ready yet is one line here (`available: true`)
 * plus its wizard component in `components/wizard/wizards.tsx`; the type
 * check refuses an available task without a wizard (`AvailableTaskId`).
 */

export type TaskId =
  | 'kes'
  | 'bosluk'
  | 'dikey'
  | 'kucult'
  | 'yazi'
  | 'muzik'
  | 'ses'
  | 'sustur'
  | 'cevir'
  // Asked for, not possible yet: no card, no page, an honest answer in the search (see below).
  | 'dondur'
  | 'hiz'
  | 'birlestir'
  | 'gif'
  | 'filigran'
  | 'efekt'
  | 'arkaplan'
  | 'ters'
  | 'foto'
  | 'stabil';

/** Names of the task icons in `components/Icon.tsx`. */
export type TaskIcon =
  | 'taskCut'
  | 'taskSilence'
  | 'taskVertical'
  | 'taskShrink'
  | 'taskText'
  | 'taskMusic'
  | 'taskSound'
  | 'taskMute'
  | 'taskConvert'
  /** The one icon of everything that cannot be done yet. */
  | 'taskLater';

/**
 * A wizard's screens, in order. Every wizard starts with `pick` (the video)
 * and has at most ONE `choose`; `editor` hands the picked video to the kesit
 * editor, `download` is İndir → progress → Kaydedildi.
 */
export type WizardStep = 'pick' | 'choose' | 'download' | 'editor';

export interface TaskWords {
  /**
   * Words that name the task by themselves ("dikey", "whatsapp"). Folded
   * (see `foldText`): lower case, no Turkish diacritics.
   */
  strong: readonly string[];
  /** Words that only support a match ("ekle", "sil"): never enough alone to beat a strong word. */
  weak: readonly string[];
  /** Two or more words that mean the task when typed together ("her yerde", "make it vertical"). */
  phrases: readonly string[];
}

export interface TaskDefinition {
  id: TaskId;
  icon: TaskIcon;
  /** Message keys: `task.<id>.label`, `task.<id>.sub`. */
  labelKey: `task.${TaskId}.label`;
  subKey: `task.${TaskId}.sub`;
  /**
   * False: no card, no route; a search that means it answers "Bunu henüz
   * yapamıyoruz." with no button (founder rule: no success message for
   * something that does not work, and never a card that does another job).
   */
  available: boolean;
  steps: readonly WizardStep[];
  words: TaskWords;
  /**
   * The task whose words people use about any job ("kes", "cut", "sil"):
   * when the search scores it level with another task, the other goes first.
   */
  generic?: true;
}

/**
 * Order = the order of the cards (mockup A), phone and desktop alike.
 * `as const`: the compiler knows which ids are available (`AvailableTaskId`),
 * so the wizard table must hold a component for exactly those.
 */
const REGISTRY = [
  {
    id: 'kes',
    icon: 'taskCut',
    labelKey: 'task.kes.label',
    subKey: 'task.kes.sub',
    available: true,
    generic: true,
    steps: ['pick', 'editor'],
    words: {
      strong: [
        'kes', 'kesmek', 'kirp', 'kirpmak', 'kisalt', 'kisaltmak', 'bol', 'bolmek', 'parca', 'ayir', 'kesit', 'klip',
        'makas', 'trim', 'cut', 'clip', 'split', 'shorten', 'crop',
      ],
      weak: [
        'sil', 'cikar', 'at', 'bas', 'basi', 'basini', 'son', 'sonu', 'sonunu', 'orta', 'ortasini', 'bolum', 'kisim',
        'kismi', 'kismini', 'remove', 'delete', 'part', 'start', 'end', 'beginning', 'middle',
      ],
      phrases: ['basini kes', 'sonunu kes', 'bir kismini', 'istedigim yer', 'istedigim kismi'],
    },
  },
  {
    id: 'bosluk',
    icon: 'taskSilence',
    labelKey: 'task.bosluk.label',
    subKey: 'task.bosluk.sub',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: [
        'sessiz', 'sessizlik', 'bosluk', 'bos', 'susma', 'sustugum', 'duraklama', 'duraksama', 'bekleme', 'eee',
        'silence', 'silences', 'silent', 'pause', 'pauses', 'gap', 'gaps', 'quiet',
      ],
      weak: ['konusma', 'konusmadigim', 'hizli', 'sikici', 'dead', 'air', 'boring'],
      phrases: [
        'sessiz yer', 'bos yer', 'konusmadigim yer', 'konusmayan yer', 'dead air', 'remove silence', 'cut silence',
        'bosluklari at', 'jump cut',
      ],
    },
  },
  {
    id: 'dikey',
    icon: 'taskVertical',
    labelKey: 'task.dikey.label',
    subKey: 'task.dikey.sub',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: [
        'dikey', 'dik', 'reels', 'reel', 'tiktok', 'shorts', 'instagram', 'insta', 'story', 'hikaye', 'vertical',
        'portrait', '916',
      ],
      weak: ['yatay', 'telefon', 'youtube', 'ekran', 'tall', 'phone'],
      phrases: ['9 16', 'dikey yap', 'dik yap', 'make it vertical', 'yan duruyor'],
    },
  },
  {
    id: 'kucult',
    icon: 'taskShrink',
    labelKey: 'task.kucult.label',
    subKey: 'task.kucult.sub',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: [
        'kucult', 'kucuk', 'kucultmek', 'sikistir', 'sikistirmak', 'boyut', 'boyutu', 'boyutunu', 'mb', 'gb',
        'whatsapp', 'telegram', 'discord', 'sigmiyor', 'sigmadi', 'sigdir', 'gonderemiyorum', 'gonderilmiyor',
        'gitmiyor', 'buyuk', 'eposta', 'mail', 'email', 'hafiflet', 'compress', 'smaller', 'shrink', 'size', 'reduce',
      ],
      weak: ['gonder', 'gondermek', 'yer', 'send', 'big', 'large', 'fit', 'limit'],
      phrases: ['cok buyuk', 'too big', 'too large', 'file size', 'dosya boyutu', 'yer kapliyor'],
    },
  },
  {
    id: 'yazi',
    icon: 'taskText',
    labelKey: 'task.yazi.label',
    subKey: 'task.yazi.sub',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: [
        'yazi', 'yaziya', 'altyazi', 'metin', 'metne', 'transkript', 'desifre', 'dokum', 'subtitle', 'subtitles',
        'caption', 'captions', 'transcript', 'transcribe', 'transcription', 'text', 'srt',
      ],
      weak: ['dok', 'yaz', 'soylenen', 'soylenenler', 'kelime', 'words'],
      phrases: ['yaziya dok', 'yaziya cevir', 'metne cevir', 'ne dedigini', 'speech to text'],
    },
  },
  {
    id: 'muzik',
    icon: 'taskMusic',
    labelKey: 'task.muzik.label',
    subKey: 'task.muzik.sub',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: ['muzik', 'sarki', 'fon', 'melodi', 'music', 'song', 'soundtrack', 'track'],
      weak: ['ekle', 'koy', 'arka', 'plan', 'mp3', 'add', 'put', 'background'],
      phrases: [
        'muzik ekle', 'muzik koy', 'sarki ekle', 'sarki koy', 'ses ekle', 'arka plan', 'fon muzigi', 'add music',
        'background music',
      ],
    },
  },
  {
    id: 'ses',
    icon: 'taskSound',
    labelKey: 'task.ses.label',
    subKey: 'task.ses.sub',
    available: true,
    steps: ['pick', 'download'],
    words: {
      // No "sesi": "sesiz" must stay a typo of "sessiz", not "sesi" + "z".
      strong: ['mp3', 'sesini', 'ses', 'dinle', 'dinlemek', 'podcast', 'audio', 'wav', 'm4a'],
      weak: ['al', 'ayir', 'cikar', 'extract', 'only', 'sound'],
      phrases: [
        'ses dosyasi', 'sesini al', 'sesini cikar', 'sesini ayir', 'sadece ses', 'audio only', 'extract audio',
        'muzik cikar', 'muzigi cikar', 'muzigini cikar', 'muzigi al', 'muzigini al', 'sarkiyi al', 'sarkiyi cikar',
      ],
    },
  },
  {
    // "Sesi kapat": the same video with no sound. Its words must not be the
    // words of "Sesini al" (which takes the sound OUT as a file): no "ses",
    // "sesini" or "audio" here — the phrases say what is done to the sound
    // ("sesini kapat", "remove audio"), and a phrase outweighs a single word.
    // No "sessize" either: "sess…" while typing must stay Boşlukları at.
    id: 'sustur',
    icon: 'taskMute',
    labelKey: 'task.sustur.label',
    subKey: 'task.sustur.sub',
    available: true,
    steps: ['pick', 'download'],
    words: {
      strong: ['kapat', 'kapatmak', 'kapansin', 'sustur', 'susturmak', 'mute', 'muted', 'soundless'],
      // No bare "sil" / "kaldır" / "remove": alone they are Kes's words ("ilk 10 saniyeyi sil").
      weak: ['kis', 'kismak', 'olmasin', 'yok', 'off', 'without'],
      phrases: [
        'sesi kapat', 'sesini kapat', 'sesi sil', 'sesini sil', 'sesi kaldir', 'sesini kaldir', 'sesi kis',
        'sesini kis', 'sessiz yap', 'sessiz olsun', 'sessiz video', 'sessize al', 'ses olmasin', 'ses yok',
        'sesi yok', 'remove audio', 'remove sound', 'remove the audio', 'remove the sound', 'delete audio',
        'delete sound', 'delete the audio', 'no sound', 'no audio', 'without sound', 'without audio', 'sound off',
        'audio off', 'turn off', 'sesleri sil', 'sesleri kapat', 'sesleri kaldir', 'sesi tamamen kis', 'sesini tamamen kis',
      ],
    },
  },
  {
    id: 'cevir',
    icon: 'taskConvert',
    labelKey: 'task.cevir.label',
    subKey: 'task.cevir.sub',
    available: true,
    steps: ['pick', 'download'],
    words: {
      strong: [
        'acilmiyor', 'acilmadi', 'acmiyor', 'acamiyorum', 'oynat', 'oynamiyor', 'calismiyor', 'supported',
        'gorunmuyor', 'mp4', 'cevir', 'donustur', 'format', 'formati', 'iphone', 'mov', 'hevc', 'h265', 'h264', 'hdr',
        'uyumlu', 'uyumsuz', 'desteklenmiyor', 'convert', 'converter', 'compatible', 'compatibility', 'unsupported',
      ],
      weak: ['televizyon', 'tv', 'bilgisayar', 'bilgisayarda', 'windows', 'android', 'samsung', 'open', 'play', 'playing'],
      phrases: [
        'her yerde', 'her cihazda', 'wont open', 'won t open', 'cant open', 'can t open', 'not playing', 'doesnt play',
        'doesn t play', 'wont play', 'won t play', 'goruntu yok',
      ],
    },
  },
  // ------------------------------------------------------------------
  // Asked for, not possible yet (7 Oct 2026). These have no card and no page.
  // They exist so that the search can answer "Bunu henüz yapamıyoruz."
  // instead of offering a card that does something else ("gife çevir" used
  // to find "Her yerde açılsın", "logo sil" found "Kes"). When one of them is
  // built: `available: true`, its place among the cards, its wizard.
  {
    id: 'dondur',
    icon: 'taskLater',
    labelKey: 'task.dondur.label',
    subKey: 'task.dondur.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['dondur', 'dondurmek', 'rotate', 'rotation', 'flip', 'mirror', 'ayna', 'aynala', 'derece'],
      weak: ['ters', 'yan', 'saga', 'sola', 'duz', 'duzelt', 'egik', 'sideways', 'degrees', 'upside'],
      phrases: [
        'ters cevir', 'yan cevir', 'saga cevir', 'sola cevir', 'duz cevir', 'derece cevir', 'ters duruyor',
        'bas asagi', 'yan cekmis', 'yan cekilmis', 'upside down', 'ayna goruntusu',
      ],
    },
  },
  {
    id: 'hiz',
    icon: 'taskLater',
    labelKey: 'task.hiz.label',
    subKey: 'task.hiz.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: [
        'hiz', 'hizlandir', 'hizlandirmak', 'hizli', 'yavas', 'yavaslat', 'yavaslatmak', 'speed', 'slow', 'slowmo',
        'slower', 'fast', 'faster', 'timelapse', '2x', 'x2',
      ],
      weak: ['agir', 'cekim', 'motion', 'tempo', 'forward'],
      phrases: [
        'agir cekim', 'slow motion', 'speed up', 'slow down', 'hizli oynat', 'yavas oynat', 'hizli cekim',
        'fast forward', 'time lapse', 'iki kat',
      ],
    },
  },
  {
    id: 'birlestir',
    icon: 'taskLater',
    labelKey: 'task.birlestir.label',
    subKey: 'task.birlestir.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['birlestir', 'birlestirmek', 'merge', 'combine', 'join', 'concat', 'kolaj', 'collage'],
      weak: ['iki', 'birkac', 'two', 'several', 'together'],
      phrases: [
        'arka arkaya', 'uc uca', 'tek video', 'iki video', 'video ekle', 'baska video', 'two videos', 'two clips',
        'one video', 'put together',
      ],
    },
  },
  {
    id: 'gif',
    icon: 'taskLater',
    labelKey: 'task.gif.label',
    subKey: 'task.gif.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['gif', 'gife', 'gifi', 'animasyon', 'animated', 'sticker', 'cikartma'],
      weak: ['hareketli'],
      phrases: ['gif e', 'gife cevir', 'gife donustur', 'gif yap', 'to gif', 'hareketli resim', 'hareketli foto'],
    },
  },
  {
    id: 'filigran',
    icon: 'taskLater',
    labelKey: 'task.filigran.label',
    subKey: 'task.filigran.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['filigran', 'watermark', 'logo', 'damga', 'damgayi'],
      weak: ['kose', 'kosedeki', 'erase'],
      phrases: [
        'logosunu sil', 'logosunu kaldir', 'logoyu sil', 'logoyu kaldir', 'yaziyi sil', 'yaziyi kaldir',
        'yazisini sil', 'yazisini kaldir', 'tiktok logosu', 'tiktok yazisi', 'remove logo', 'remove text',
        'remove the logo', 'remove the text',
      ],
    },
  },
  {
    id: 'efekt',
    icon: 'taskLater',
    labelKey: 'task.efekt.label',
    subKey: 'task.efekt.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: [
        'filtre', 'efekt', 'renk', 'renkleri', 'rengi', 'parlak', 'kontrast', 'doygunluk', 'filter', 'filters',
        'effect', 'effects', 'color', 'colors', 'colour', 'brightness', 'contrast', 'saturation', 'grayscale', 'sepia',
      ],
      weak: ['siyah', 'beyaz', 'karanlik', 'aydinlat', 'canli', 'black', 'white', 'dark', 'bright', 'brighter'],
      phrases: ['siyah beyaz', 'black and white', 'renk ayari', 'color correction', 'color grading'],
    },
  },
  {
    id: 'arkaplan',
    icon: 'taskLater',
    labelKey: 'task.arkaplan.label',
    subKey: 'task.arkaplan.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      // "plani": "arka planı sil" is about the background; music is asked
      // for with "arka plana" / "arka planda" / "arka plan müziği".
      strong: ['arkaplan', 'arkaplani', 'plani', 'bulanik', 'bulaniklastir', 'blur', 'flu', 'greenscreen', 'chroma'],
      weak: ['arka', 'plan', 'arkayi', 'background'],
      phrases: [
        'arka plani', 'arkayi degistir', 'arkayi sil', 'yesil perde', 'yesil ekran', 'green screen',
        'remove background', 'remove the background', 'blur background', 'blur the background',
        'change background', 'change the background', 'background remove', 'background blur', 'arka plan degistir',
        'arka plan sil', 'arka plan kaldir', 'arka plan bulanik',
      ],
    },
  },
  {
    id: 'ters',
    icon: 'taskLater',
    labelKey: 'task.ters.label',
    subKey: 'task.ters.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['tersten', 'geriye', 'reverse', 'reversed', 'backwards', 'backward', 'rewind'],
      weak: ['ters', 'geri', 'sondan'],
      phrases: ['tersten oynat', 'ters oynat', 'geri sar', 'geriye sar', 'geriye dogru', 'sondan basa', 'in reverse'],
    },
  },
  {
    id: 'foto',
    icon: 'taskLater',
    labelKey: 'task.foto.label',
    subKey: 'task.foto.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: [
        'fotograf', 'foto', 'resim', 'resmi', 'screenshot', 'snapshot', 'thumbnail', 'kapak', 'frame', 'photo',
        'picture', 'image', 'jpg', 'jpeg', 'png',
      ],
      weak: ['kare', 'ekran', 'yakala', 'goruntusu', 'still', 'capture'],
      phrases: [
        'ekran goruntusu', 'kare al', 'kare yakala', 'kareyi kaydet', 'fotograf al', 'fotograf cek',
        'resim olarak', 'extract a frame', 'save a frame', 'screen shot', 'still image',
      ],
    },
  },
  {
    id: 'stabil',
    icon: 'taskLater',
    labelKey: 'task.stabil.label',
    subKey: 'task.stabil.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['titre', 'titreme', 'sarsinti', 'sallan', 'sallaniyor', 'stabil', 'stabilize', 'shaky', 'shake', 'shaking', 'steady', 'sabitle'],
      weak: ['duzelt', 'gider', 'smooth'],
      phrases: ['titremeyi duzelt', 'titremeyi gider', 'sarsintiyi gider', 'el titremesi'],
    },
  },
] as const satisfies readonly TaskDefinition[];

/** The ids whose `available` is true: each must have a wizard component. */
export type AvailableTaskId = Extract<(typeof REGISTRY)[number], { available: true }>['id'];

export const TASKS: readonly TaskDefinition[] = REGISTRY;

/** Example phrases under the box (mockup C): one tap fills the box. */
export const TASK_EXAMPLES: readonly string[] = [
  'sessiz yerleri sil',
  'TikTok için dikey',
  'başını kes',
  'müzik koy',
];

export function taskById(id: string): TaskDefinition | undefined {
  return TASKS.find((task) => task.id === id);
}

/** The tasks that have a card and a route. */
export function availableTasks(tasks: readonly TaskDefinition[] = TASKS): TaskDefinition[] {
  return tasks.filter((task) => task.available);
}
