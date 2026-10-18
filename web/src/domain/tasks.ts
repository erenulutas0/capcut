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
  | 'duzelt'
  | 'cevir'
  | 'iyilestir'
  | 'gif'
  // Asked for, not possible yet: no card, no page, an honest answer in the search (see below).
  | 'dondur'
  | 'hiz'
  | 'birlestir'
  | 'sticker'
  | 'filigran'
  | 'efekt'
  | 'arkaplan'
  | 'ters'
  | 'foto'
  | 'stabil'
  | 'yaziekle'
  | 'yuz'
  | 'tercume'
  | 'gurultu'
  // 10 Oct 2026 (quality report): asked of every video tool, and not something this one does.
  | 'indir'
  | 'yukle'
  | 'kayit'
  | 'yayin';

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
  | 'taskFixSound'
  | 'taskConvert'
  | 'taskEnhance'
  | 'taskGif'
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
  /**
   * Words that say the task only when nothing more specific was said: "çevir"
   * is Her yerde açılsın by itself and steps back to a weak word next to
   * another task's own evidence ("mp3e çevir", "gife çevir", "sağa çevir").
   */
  yielding?: readonly string[];
  /**
   * What is done TO what: [things, verbs, gap?] (`gap`: other words allowed between them, default
   * none — "şarkı arkada çalsın" needs one). The task is meant when one of the
   * things stands next to one of the verbs — either order, each with its
   * Turkish endings, words that carry no intent set aside ("ses hiç
   * olmasın", "müziğini almak istiyorum"). Counts like a two-word phrase.
   */
  pairs?: ReadonlyArray<readonly [things: readonly string[], verbs: readonly string[], gap?: number]>;
  /**
   * Verb stems whose NEGATIVE form means the task, whatever the person and
   * tense: "aç" → "açamıyorum", "açılmıyor", "açılmadı" (Her yerde açılsın);
   * "gönder" → "gönderemiyorum", "gönderemedim" (Küçült).
   */
  unable?: readonly string[];
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
        // ADR-048 (English DEV set): how people say it without the word cut.
        'snip', 'chop', 'trimmed', 'trimming',
      ],
      weak: [
        'sil', 'cikar', 'at', 'bas', 'basi', 'basini', 'son', 'sonu', 'sonunu', 'orta', 'ortasini', 'bolum', 'kisim',
        'kismi', 'kismini', 'remove', 'delete', 'part', 'start', 'end', 'beginning', 'middle',
        // Cutting is about WHEN: "ilk on saniyeyi", "son iki dakikayı", "the first minute".
        'ilk', 'saniye', 'dakika', 'sn', 'dk', 'first', 'last', 'seconds', 'second', 'minute', 'minutes',
        // …and about how LONG the video is ("videom çok uzun").
        'uzun', 'kisa', 'long', 'short', 'shorter', 'gereksiz',
        // "Keep only this, the rest can go."
        'kalsin', 'gerisi', 'kalan', 'keep', 'rest',
        // Not "bit": "a bit more" is "a little" (ADR-048).
        'bits', 'moment', 'scene',
      ],
      phrases: [
        'basini kes', 'sonunu kes', 'bir kismini', 'istedigim yer', 'istedigim kismi',
        // ADR-048: keeping one part of a video.
        'keep only', 'only want the', 'the part where', 'the bit where', 'the good part', 'the best part',
      ],
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
        'sessiz', 'sessizlik', 'bosluk', 'bos', 'susma', 'sustugum', 'duraklama', 'duraksama', 'durakla', 'duraksa',
        'bekleme', 'eee',
        'silence', 'silences', 'silent', 'pause', 'pauses', 'gap', 'gaps', 'quiet',
      ],
      weak: ['konusma', 'konusmadigim', 'hizli', 'sikici', 'dead', 'air', 'boring', 'bekle'],
      phrases: [
        'sessiz yer', 'bos yer', 'konusmadigim yer', 'konusmayan yer', 'dead air', 'remove silence', 'cut silence',
        'bosluklari at', 'jump cut', 'olu an', 'olu zaman',
        // ADR-048: the places where nobody speaks, as English speakers describe them.
        'awkward pauses', 'awkward silence', 'long breaks', 'stop talking', 'not talking', 'dont say anything',
        'don t say anything',
      ],
      // A silent or empty PLACE in the video — whatever is then done to it ("sessiz kısımları kırp") —
      // and the places where the speaker waits, stops or thinks ("beklediğim yerleri at").
      pairs: [
        [
          ['sessiz', 'bos', 'olu', 'silent', 'quiet', 'empty', 'dead'],
          ['yer', 'kisim', 'bolum', 'an', 'parca', 'ara', 'aralik', 'part', 'parts', 'bit', 'bits', 'moments', 'gaps', 'spots'],
        ],
        [
          ['bekledigim', 'durdugum', 'sustugum', 'konusmadigim', 'dusundugum', 'duraksadigim', 'takildigim'],
          ['yer', 'kisim', 'bolum', 'an', 'ara'],
        ],
        // "where nobody talks", "no one speaks": nobody's voice in a place of the video (ADR-048).
        [['nobody', 'noone', 'no'], ['talks', 'talking', 'speaks', 'speaking', 'says'], 1],
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
        // A common English misspelling (ADR-048, DEV set): two edits from "vertical", beyond the typo rule.
        'verticle',
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
        'kucult', 'kucuk', 'kucultmek', 'sikistir', 'sikistirmak', 'mb', 'gb',
        'whatsapp', 'wp', 'wpp', 'wapp', 'telegram', 'discord', 'sigmiyor', 'sigmadi', 'sigdir', 'gonderemiyorum', 'gonderilmiyor',
        'gitmiyor', 'buyuk', 'eposta', 'mail', 'email', 'hafiflet', 'compress', 'smaller', 'shrink', 'reduce',
      ],
      // "Size" is the file's weight here — and the frame's shape in "tiktoka uygun boyut": it steps
      // back when another task has a word of its own.
      yielding: ['boyut', 'boyutu', 'boyutunu', 'size'],
      weak: ['gonder', 'gondermek', 'yer', 'send', 'big', 'large', 'fit', 'limit', 'hafiza', 'depolama', 'storage', 'space'],
      phrases: ['cok buyuk', 'too big', 'too large', 'file size', 'dosya boyutu', 'yer kapliyor'],
      // "gönderemiyorum", "atamadım", "sığmıyor", "gitmiyor": it will not go where it has to.
      unable: ['gonder', 'at', 'yolla', 'ilet', 'sig', 'git'],
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
        // ADR-048: who needs the words written down, and how English names them.
        'deaf', 'cc', 'dictation',
      ],
      weak: ['dok', 'yaz', 'soylenen', 'soylenenler', 'kelime', 'words', 'written', 'typed'],
      // "alt yazı" typed as two words is the subtitle, not "yazı ekle" (text laid over the picture).
      phrases: [
        'yaziya dok', 'yaziya cevir', 'metne cevir', 'ne dedigini', 'speech to text', 'alt yazi', 'alt yazi ekle', 'alt yazi koy',
        // ADR-048: what is SAID, written down.
        'write down', 'what they say', 'what people say', 'what he says', 'what she says', 'what i say', 'show the words',
        'into words', 'into text', 'auto captions', 'closed captions',
      ],
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
      strong: ['muzik', 'sarki', 'fon', 'melodi', 'music', 'song', 'soundtrack', 'track', 'musik'],
      // No bare "ekle" / "koy" / "add" / "put": what is added says the task ("şifre koy" is not music);
      // next to the music they are a pair (below).
      weak: ['arka', 'plan', 'mp3', 'background', 'parca', 'parcami'],
      phrases: [
        'muzik ekle', 'muzik koy', 'sarki ekle', 'sarki koy', 'ses ekle', 'arka plan', 'fon muzigi', 'add music',
        'background music', 'add an mp3', 'add mp3', 'put an mp3',
      ],
      // Music put IN: "şarkı eklemek istiyorum", "müzik çalsın", "put a song".
      pairs: [
        [
          ['muzik', 'sarki', 'sarkimi', 'melodi', 'parcami', 'song', 'music', 'soundtrack', 'track'],
          ['ekle', 'koy', 'cal', 'yerlestir', 'add', 'put', 'insert', 'playing', 'over', 'behind'],
          1,
        ],
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
      // "müziğini", "şarkısını": the video's OWN music — taking it out, not putting one in.
      strong: ['mp3', 'sesini', 'ses', 'dinle', 'dinlemek', 'podcast', 'audio', 'wav', 'm4a', 'muzigini', 'sarkisini', 'listen'],
      // No bare "al" (take): it is every task's verb. With the sound next to it, it is a pair (below).
      weak: ['ayir', 'cikar', 'extract', 'only', 'sound'],
      phrases: [
        'ses dosyasi', 'sesini al', 'sesini cikar', 'sesini ayir', 'sadece ses', 'audio only', 'extract audio',
        'muzik cikar', 'muzigi cikar', 'muzigini cikar', 'muzigi al', 'muzigini al', 'sarkiyi al', 'sarkiyi cikar',
        // ADR-048: the sound taken OUT of the video, in English.
        'sound file', 'audio file', 'mp3 file', 'song from', 'music from', 'get mp3', 'get the mp3', 'mp3 from',
      ],
      // The sound taken OUT as a file: "müziğini almak istiyorum", "şarkıyı indir", "sesini kaydet".
      pairs: [
        [
          ['ses', 'muzik', 'sarki', 'audio', 'sound', 'song', 'music', 'soundtrack'],
          ['al', 'ayir', 'kaydet', 'indir', 'dinle', 'dosyasi', 'kaydi', 'extract', 'save', 'rip', 'download', 'grab', 'get', 'keep'],
        ],
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
        // ADR-048: the video made silent ("silent" alone is a silent PLACE: Remove silences).
        'make it silent', 'make the video silent', 'make video silent', 'silent video',
      ],
      // The sound taken AWAY: a word for the sound next to "off", "gone" or "not wanted" — "sesi kapa",
      // "ses hiç olmasın", "sesini istemiyorum", "get rid of the audio". ("kes" is not here: "sesi kes"
      // stays the honest two rows.)
      pairs: [
        [
          ['ses', 'audio', 'sound', 'voice'],
          [
            'kapat', 'kapa', 'kis', 'sil', 'kaldir', 'yok', 'olmasin', 'cikmasin', 'gelmesin', 'duyulmasin',
            'istemiyorum', 'istemem', 'istemiyoruz', 'olmadan', 'gitsin', 'sifirla', 'sustur', 'mute', 'off', 'remove',
            'delete', 'without', 'no', 'dont', 'rid',
          ],
        ],
      ],
    },
  },
  {
    // "Sesi düzelt" (ADR-049, 18 Oct 2026): quiet or uneven sound made audible and even, on the device.
    // Its words say what is wrong with the LEVEL of the sound ("kısık", "duyulmuyor", "too quiet",
    // "volume") or what is done to it ("sesi aç", "turn it up", "normalize"). Not "ses" / "sound" alone
    // (Sesini al), not "sessiz" / "quiet" alone (Boşlukları at: a silent PLACE), not noise ("gürültü",
    // "wind", "hum": an honest "not yet" of its own — this card does not remove noise, and says so).
    id: 'duzelt',
    icon: 'taskFixSound',
    labelKey: 'task.duzelt.label',
    subKey: 'task.duzelt.sub',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: [
        'kisik', 'kisikti', 'kisiktir', 'duyulmuyor', 'duyulmuyo', 'duyulmuyordu', 'duyamiyorum', 'duyamiyoruz', 'duyulmadi',
        'normallestir', 'esitle', 'dengele', 'volume', 'louder', 'loudness', 'normalize', 'normalise', 'inaudible',
        'normalization', 'normalisation',
      ],
      weak: [
        'seviye', 'seviyesi', 'seviyesini', 'yukselt', 'artir', 'guclendir', 'dusuk', 'alcak', 'dengesiz', 'esit',
        'boost', 'level', 'levels', 'low', 'soft', 'uneven', 'even', 'hear', 'audible', 'mic', 'microphone', 'mikrofon',
      ],
      phrases: [
        'sesi duzelt', 'sesini duzelt', 'ses duzelt', 'sesi ac', 'sesini ac', 'sesi yukselt', 'sesini yukselt', 'sesi artir',
        'sesini artir', 'ses seviyesi', 'ses seviyesini', 'sesi esitle', 'sesi dengele', 'ses kisik', 'sesi kisik', 'sesim kisik',
        'ses dusuk', 'sesi dusuk', 'ses cok dusuk', 'sesi cok dusuk', 'sesi duyulmuyor', 'ses duyulmuyor', 'sesi guclendir',
        'sesi normallestir', 'daha yuksek', 'fix the sound', 'fix the audio', 'fix sound', 'fix audio', 'fix my audio',
        'fix my sound', 'too quiet', 'very quiet', 'so quiet', 'too soft', 'too low', 'cant hear', 'can t hear', 'hard to hear',
        'barely hear', 'turn up', 'turn it up', 'make it louder', 'even out', 'audio levels', 'sound levels', 'audio level',
        'sound level', 'volume up', 'boost the audio', 'boost audio', 'boost the sound', 'boost volume', 'increase volume',
        'increase the volume', 'raise the volume', 'normalize audio', 'normalise audio', 'quiet voice', 'quiet audio',
        'quiet sound',
      ],
      // The sound and what is wrong with its level, or what is done to it: "ses çok kısık çıkmış",
      // "sesini biraz yükseltmek istiyorum", "the audio is way too low".
      pairs: [
        [
          ['ses', 'sesi', 'sesim', 'konusma', 'konusmalar', 'audio', 'sound', 'voice', 'voices', 'speech', 'volume'],
          [
            'kisik', 'dusuk', 'alcak', 'yukselt', 'artir', 'guclendir', 'esitle', 'dengele', 'dengesiz', 'duzelt', 'ac',
            'duyulmuyor', 'duyulmuyo', 'louder', 'quiet', 'quieter', 'low', 'soft', 'up', 'boost', 'uneven', 'even', 'level',
            'normalize', 'normalise', 'fix', 'inaudible',
          ],
          1,
        ],
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
        'gorunmuyor', 'mp4', 'format', 'formati', 'bicim', 'bicimi', 'iphone', 'mov', 'hevc', 'h265', 'h264', 'hdr',
        'uyumlu', 'uyumsuz', 'desteklenmiyor', 'compatible', 'compatibility', 'unsupported',
        'webm',
      ],
      // "Turn it into…" — into what is said by the word next to it: alone, a format every device opens.
      yielding: ['cevir', 'donustur', 'convert', 'converter'],
      // "açamıyorum", "açılmadı", "oynatamıyorum", "izleyemiyorum", "çalışmıyor": it will not open or play.
      unable: ['ac', 'oynat', 'oyna', 'izle', 'calis', 'goster', 'oku', 'tani', 'destekle'],
      weak: ['televizyon', 'tv', 'bilgisayar', 'bilgisayarda', 'windows', 'android', 'samsung', 'open', 'play', 'playing'],
      phrases: [
        'her yerde', 'her cihazda', 'wont open', 'won t open', 'cant open', 'can t open', 'not playing', 'doesnt play',
        'doesn t play', 'wont play', 'won t play', 'goruntu yok',
        // ADR-048: the card's own words, and what people say of a video that plays only somewhere.
        'play everywhere', 'plays everywhere', 'play anywhere', 'open everywhere', 'every device', 'all devices',
        'normal video', 'normal mp4',
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
        'parlaklik', 'isik', 'isigi', 'isigini', 'renk', 'renkler', 'renkleri', 'rengi', 'renkli', 'soluk', 'kontrast',
        'doygunluk', 'kalite', 'kaliteyi', 'kalitesini', 'kaliteli', 'kalitesiz', 'kumlu', 'kumlanma',
        'grenli', 'piksel', 'pikselli', 'cozunurluk', '4k', 'hd', 'enhance', 'enhancer', 'improve', 'sharpen',
        'sharper', 'sharp', 'brighten', 'brighter', 'bright', 'brightness', 'dark', 'blurry', 'blur', 'unblur',
        'deblur', 'quality', 'upscale', 'upscaler', 'clearer', 'color', 'colors', 'colour', 'colours', 'contrast',
        'saturation', 'denoise', 'grainy', 'noisy', 'lighting',
      ],
      // "canlı": vivid colours — and "canlı yayın" (a live broadcast), so it only supports.
      weak: ['yukselt', 'artir', 'duzelt', 'gorunsun', 'goruntu', 'goruntuyu', 'better', 'fix', 'look', 'clear', 'light', 'canli', 'night'],
      phrases: [
        'kaliteyi yukselt', 'kalitesini yukselt', 'kaliteyi artir', 'kalitesini artir', 'daha net', 'daha iyi gorunsun',
        '4k yap', 'hd yap', 'bulanikligi sil', 'bulanikligi gider', 'bulanikligi al', 'goruntuyu duzelt', 'cok karanlik',
        'renk ayari', 'renkleri duzelt', 'color correction', 'make it sharper', 'make it brighter', 'improve quality',
        'better quality', 'fix lighting', 'too dark',
      ],
    },
  },
  {
    // ADR-046 (17 Oct 2026): a part of the video, at most ten seconds, as a looping GIF with a top and
    // a bottom text, made on this device. Until then an honest "Bunu henüz yapamıyoruz." (7 Oct 2026).
    // "animasyon" / "animated" only support: "intro animasyonu", "animasyon karakteri" are not GIFs.
    id: 'gif',
    icon: 'taskGif',
    labelKey: 'task.gif.label',
    subKey: 'task.gif.sub',
    available: true,
    steps: ['pick', 'choose', 'download'],
    words: {
      strong: ['gif', 'gife', 'gifi', 'gifler', 'gifini', 'gifs', 'jif'],
      weak: ['hareketli', 'animasyon', 'animated', 'loop', 'dongu', 'looping', 'animation'],
      phrases: [
        'gif e', 'gife cevir', 'gife donustur', 'gif yap', 'to gif', 'hareketli resim', 'hareketli foto',
        // ADR-048: a picture that moves ("picture" alone is a still: not yet).
        'moving picture', 'moving image', 'animated picture', 'animated image', 'gif with text',
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
        'bas asagi', 'yan cekmis', 'yan cekilmis', 'upside down', 'ayna goruntusu', 'yan duruyor', 'yan cikmis',
      ],
      // A direction next to "turn": "videoyu çevir yan duruyor", "sola döndürmek istiyorum".
      pairs: [[['yan', 'ters', 'saga', 'sola', 'duz', 'sideways'], ['cevir', 'dondur', 'donsun', 'turn']]],
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
    // Split off "GIF yap" on 17 Oct 2026 (ADR-046): a sticker of a chat app is a picture of its own
    // format and size, which the GIF card does not make — it stays an honest "Bunu henüz yapamıyoruz."
    id: 'sticker',
    icon: 'taskLater',
    labelKey: 'task.sticker.label',
    subKey: 'task.sticker.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['sticker', 'stickers', 'cikartma', 'cikartmasi', 'cikartmalari'],
      weak: ['whatsapp', 'telegram'],
      phrases: ['whatsapp cikartmasi', 'whatsapp sticker', 'sticker yap', 'cikartma yap'],
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
        'remove the logo', 'remove the text', 'remove watermark', 'remove the watermark', 'filigrani kaldir', 'filigrani sil',
        'tiktok watermark', 'tiktok logo',
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
      // Light, colour, contrast and sharpness are "İyileştir" (ADR-037) since 7 Oct 2026: those
      // words live there. What stays here is a look laid over the picture, which nothing does yet.
      strong: [
        'filtre', 'filtresi', 'efekt', 'efekti', 'filter', 'filters', 'effect', 'effects', 'grayscale', 'sepia',
        'vintage', 'nostaljik', 'lut',
      ],
      weak: ['siyah', 'beyaz', 'black', 'white', 'retro', 'sinematik', 'cinematic'],
      phrases: ['siyah beyaz', 'black and white', 'color grading', 'renk filtresi', 'eski film'],
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
      // "bulanık" / "blur" by themselves are a blurry VIDEO ("İyileştir", ADR-037); here they
      // only support a request that names the background.
      strong: ['arkaplan', 'arkaplani', 'plani', 'bulaniklastir', 'greenscreen', 'chroma'],
      weak: ['arka', 'plan', 'arkayi', 'background', 'bulanik', 'blur', 'flu'],
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
      strong: [
        'titre', 'titreme', 'sarsinti', 'sallan', 'sallaniyor', 'stabil', 'stabilize', 'stabilizasyon', 'stabilization',
        'stabilizer', 'shaky', 'shake', 'shaking', 'steady', 'sabitle',
      ],
      weak: ['duzelt', 'gider', 'smooth'],
      phrases: ['titremeyi duzelt', 'titremeyi gider', 'sarsintiyi gider', 'el titremesi'],
    },
  },
  // ------------------------------------------------------------------
  // Four more of the same kind (10 Oct 2026): asked for often, not possible.
  {
    // Words laid over the picture, typed by the user. NOT "Yazıya dök", which
    // writes the SPEECH down: "yazı", "metin" and "text" stay that task's
    // strong words and are only weak here — what names this entry is what is
    // done with the text ("yazı ekle", "üstüne yaz", "add text") or a word of
    // its own ("başlık", "emoji"). "altyazı ekle" stays "Yazıya dök".
    id: 'yaziekle',
    icon: 'taskLater',
    labelKey: 'task.yaziekle.label',
    subKey: 'task.yaziekle.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['baslik', 'basligi', 'emoji', 'overlay', 'title', 'titles', 'etiket', 'jenerik'],
      weak: ['yazi', 'metin', 'text', 'isim', 'ustune', 'uzerine', 'ustunde', 'write', 'name'],
      phrases: [
        'yazi ekle', 'yazi koy', 'yazi yaz', 'metin ekle', 'metin koy', 'metin yaz', 'isim yaz', 'isim ekle',
        'ustune yaz', 'uzerine yaz', 'add text', 'put text', 'add a text', 'text on', 'write on', 'add title',
        'add a title', 'not dus', 'not ekle', 'not yaz', 'name on', 'add name', 'add my name',
      ],
      // Writing ON the picture: "videonun üstüne ismimi yaz".
      pairs: [[['ustune', 'uzerine', 'ustunde', 'uzerinde'], ['yaz', 'yazi', 'ekle', 'koy', 'write'], 1]],
    },
  },
  {
    // Hiding a face, a number plate, a part of the picture. "bulanık" / "blur"
    // alone stay a blurry VIDEO ("İyileştir"), and with "arka plan" the
    // background entry; here they only support a request that names a face.
    // No bare "yüz": it is also "yüz" (a hundred) and "yüzde" (per cent).
    id: 'yuz',
    icon: 'taskLater',
    labelKey: 'task.yuz.label',
    subKey: 'task.yuz.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: [
        'yuzu', 'yuzler', 'yuzum', 'surat', 'plaka', 'sansur', 'sansurle', 'mozaik', 'buzla', 'buzlama', 'pikselle',
        'piksellestir', 'gizle', 'gizlemek', 'face', 'faces', 'censor', 'censored', 'pixelate', 'pixelated', 'mosaic',
        'anonymize',
      ],
      weak: ['bulanik', 'bulaniklastir', 'blur', 'kapat', 'gorunmesin', 'hide', 'plate', 'kisi', 'kisiyi'],
      phrases: [
        'yuzu bulanik', 'yuzler bulanik', 'yuzu gizle', 'yuzler gizle', 'yuzu kapat', 'yuzler kapat', 'blur face',
        'blur faces', 'blur a face', 'blur the face', 'hide face', 'hide faces', 'license plate', 'number plate',
        'plaka kapat', 'plaka gizle',
      ],
    },
  },
  {
    // Another language: translated subtitles, dubbing. "Yazıya dök" writes
    // down what is said, in the language it is said in (English only today).
    // "çevir" alone is "Her yerde açılsın" (a format) and stays there: this
    // entry is named by a language or by "tercüme" / "translate" / "dublaj".
    id: 'tercume',
    icon: 'taskLater',
    labelKey: 'task.tercume.label',
    subKey: 'task.tercume.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: [
        'tercume', 'ceviri', 'cevirisi', 'cevirmen', 'translate', 'translation', 'translator', 'dublaj', 'dub',
        'dubbing', 'seslendir', 'seslendirme', 'turkce', 'turkceye', 'ingilizce', 'ingilizceye', 'almanca', 'arapca',
        'english', 'turkish', 'dile', 'dili', 'dilini', 'language', 'languages',
      ],
      weak: ['yabanci', 'baska'],
      phrases: [
        'turkceye cevir', 'ingilizceye cevir', 'dile cevir', 'baska dil', 'dilini degistir', 'turkce yap',
        'ingilizce yap', 'translate to', 'translate into', 'translate subtitles', 'to english', 'to turkish',
        'in english', 'in turkish',
      ],
    },
  },
  {
    // Cleaning the SOUND: wind, hum, hiss. The picture's grain ("kumlu",
    // "noisy", "denoise") is "İyileştir" and stays there; "sesi sil" is
    // "Sesi kapat". "noise" is weak: it needs "background", "wind" or
    // "reduction" beside it to mean the sound.
    id: 'gurultu',
    icon: 'taskLater',
    labelKey: 'task.gurultu.label',
    subKey: 'task.gurultu.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['gurultu', 'gurultuyu', 'gurultusu', 'ugultu', 'cizirti', 'cizirtili', 'parazit', 'hisirti', 'ruzgar', 'yanki', 'hiss', 'echo'],
      // "ses" (weak): next to a word of this entry ("ses çok cızırtılı") it is about the sound's
      // quality, not about taking the sound out as a file.
      weak: ['temizle', 'temiz', 'arkadaki', 'noise', 'wind', 'clean', 'reduction', 'ses'],
      phrases: [
        'gurultu sil', 'gurultuyu sil', 'gurultu azalt', 'gurultuyu azalt', 'dip ses', 'ruzgar sesi', 'sesi temizle',
        'sesini temizle', 'ses temizle', 'background noise', 'remove background noise', 'noise reduction',
        'noise removal', 'remove noise', 'wind noise', 'clean audio', 'clean the audio', 'clean sound',
        'clean up the audio', 'clean up the sound', 'clean up audio',
      ],
    },
  },
  // ------------------------------------------------------------------
  // Four more (10 Oct 2026, quality report): things every video tool is asked for and this one does
  // not do — nothing here fetches a video, records one or sends one anywhere (the app has no network
  // side at all). Before, "youtubedan video indir" was offered "Dikey yap" and "canlı yayın yap"
  // "İyileştir", because the site's name or one adjective is all those cards shared with the request.
  {
    // A video fetched from a site or a link. A site's name alone stays what it was ("TikTok için
    // dikey"): this entry is named by the site NEXT TO fetching ("indir", "download", "to mp3").
    id: 'indir',
    icon: 'taskLater',
    labelKey: 'task.indir.label',
    subKey: 'task.indir.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['indirici', 'savefrom', 'ytmp3', 'ytmp4'],
      // No bare "indir" / "download": "İndir" is also this app's own button for saving a finished video.
      weak: ['link', 'linki', 'url', 'internetten', 'netten', 'siteden'],
      phrases: ['linkten indir', 'internetten indir', 'video downloader'],
      pairs: [
        [
          [
            'youtube', 'instagram', 'insta', 'tiktok', 'facebook', 'twitter', 'pinterest', 'link', 'url', 'internet',
            'net', 'site', 'web', 'reels', 'shorts',
          ],
          ['indir', 'download', 'mp3', 'grab'],
        ],
      ],
    },
  },
  {
    // The finished video sent to a site. "Paylaş" under a saved file is the phone's own share sheet;
    // nothing in the app posts to an account.
    id: 'yukle',
    icon: 'taskLater',
    labelKey: 'task.yukle.label',
    subKey: 'task.yukle.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['upload', 'uploader', 'yayinla', 'yayinlamak'],
      weak: ['yukle', 'yuklemek', 'paylas', 'paylasmak', 'post', 'share', 'kanal', 'hesap'],
      phrases: ['youtube a yukle', 'kanalima yukle', 'hesabima yukle', 'upload to', 'post to', 'share on', 'post on'],
      pairs: [
        [
          ['youtube', 'instagram', 'insta', 'tiktok', 'facebook', 'twitter', 'kanal', 'hesap', 'profil'],
          ['yukle', 'upload', 'post', 'yayinla'],
        ],
      ],
    },
  },
  {
    // A NEW video made here: the screen, the camera. The app only works on a video that exists.
    id: 'kayit',
    icon: 'taskLater',
    labelKey: 'task.kayit.label',
    subKey: 'task.kayit.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['webcam', 'recorder', 'kaydedici'],
      weak: ['kamera', 'camera', 'screen', 'record', 'recording', 'kayit', 'cekim'],
      // No "video çek": "video çektim, çok karanlık" is about a video that exists.
      phrases: ['ekran kaydi', 'ekrani kaydet', 'ekran kaydet', 'screen recording', 'screen record', 'record screen'],
      pairs: [
        [
          ['ekran', 'ekranim', 'screen', 'kamera', 'webcam', 'camera', 'mikrofon', 'microphone'],
          ['kayit', 'kaydi', 'kaydet', 'cek', 'record', 'recording', 'recorder', 'capture'],
        ],
      ],
    },
  },
  {
    id: 'yayin',
    icon: 'taskLater',
    labelKey: 'task.yayin.label',
    subKey: 'task.yayin.sub',
    available: false,
    steps: ['pick', 'download'],
    words: {
      strong: ['yayin', 'stream', 'streaming', 'livestream', 'twitch'],
      weak: ['canli', 'live'],
      phrases: ['canli yayin', 'go live', 'live stream'],
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

/** The same four, as an English speaker would type them (ADR-048): each finds the same task. */
export const TASK_EXAMPLES_EN: readonly string[] = [
  'remove the silent parts',
  'vertical for TikTok',
  'cut the start',
  'add music',
];

/** The example chips of the opening screen, in the page's language. */
export function taskExamples(locale: 'tr' | 'en'): readonly string[] {
  return locale === 'en' ? TASK_EXAMPLES_EN : TASK_EXAMPLES;
}

export function taskById(id: string): TaskDefinition | undefined {
  return TASKS.find((task) => task.id === id);
}

/** The tasks that have a card and a route. */
export function availableTasks(tasks: readonly TaskDefinition[] = TASKS): TaskDefinition[] {
  return tasks.filter((task) => task.available);
}
