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

export type TaskId = 'kes' | 'bosluk' | 'dikey' | 'kucult' | 'yazi' | 'muzik' | 'ses' | 'cevir' | 'iyilestir';

/** Names of the task icons in `components/Icon.tsx`. */
export type TaskIcon =
  | 'taskCut'
  | 'taskSilence'
  | 'taskVertical'
  | 'taskShrink'
  | 'taskText'
  | 'taskMusic'
  | 'taskSound'
  | 'taskConvert'
  | 'taskEnhance';

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
   * False: no card, no route; a search that means it answers "Bu henüz yok,
   * üzerinde çalışıyoruz" with no button (founder rule: no success message
   * for something that does not work).
   */
  available: boolean;
  steps: readonly WizardStep[];
  words: TaskWords;
  /**
   * Shown under the label in the search results instead of `subKey`, where
   * the short card line would promise too much: "İyileştir" is found by
   * "4K yap" and "bulanıklığı sil" and must answer with what it really does.
   */
  resultKey?: 'task.iyilestir.result';
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
  {
    // ADR-037. Classic picture processing on the device: light, colour,
    // sharpness, noise. People also ask for what it cannot do ("4K yap",
    // "bulanıklığı sil", "upscale"): those words lead here too, and the
    // result line says honestly what it does (`resultKey`).
    id: 'iyilestir',
    icon: 'taskEnhance',
    labelKey: 'task.iyilestir.label',
    subKey: 'task.iyilestir.sub',
    resultKey: 'task.iyilestir.result',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: [
        'iyilestir', 'iyilestirme', 'guzellestir', 'toparla', 'netlestir', 'netlik', 'net', 'keskin', 'keskinlestir',
        'keskinlik', 'bulanik', 'bulaniklik', 'bulanikligi', 'flu', 'karanlik', 'aydinlat', 'aydinlik', 'parlak',
        'parlaklik', 'isik', 'isigi', 'isigini', 'renk', 'renkler', 'renkleri', 'renkli', 'soluk', 'kalite', 'kaliteyi',
        'kalitesini', 'kaliteli', 'kalitesiz', 'kumlu', 'kumlanma', 'grenli', 'piksel', 'pikselli', 'cozunurluk',
        '4k', 'hd', 'enhance', 'enhancer', 'improve', 'sharpen', 'sharper', 'sharp', 'brighten', 'brighter', 'bright',
        'dark', 'blurry', 'blur', 'unblur', 'deblur', 'quality', 'upscale', 'upscaler', 'clearer', 'color', 'colors',
        'colour', 'colours', 'denoise', 'grainy', 'noisy', 'lighting',
      ],
      weak: ['yukselt', 'artir', 'duzelt', 'gorunsun', 'goruntu', 'goruntuyu', 'better', 'fix', 'look', 'clear', 'light'],
      phrases: [
        'kaliteyi yukselt', 'kalitesini yukselt', 'kaliteyi artir', 'kalitesini artir', 'daha net', 'daha iyi gorunsun',
        '4k yap', 'hd yap', 'bulanikligi sil', 'bulanikligi gider', 'bulanikligi al', 'goruntuyu duzelt', 'cok karanlik',
        'make it sharper', 'make it brighter', 'improve quality', 'better quality', 'fix lighting', 'too dark',
      ],
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
