/**
 * EDL v1 validation (doc 10 "Doğrulama kuralları").
 *
 * Deliberately hand-written and dependency-free: the same rules must later be
 * re-implemented in Dart and Python and checked against the SAME fixture files
 * in `fixtures/edl/`. Until all three agree, the contract is not "done".
 *
 * Every failure carries a stable machine code so fixtures stay language-neutral.
 */

import {
  ASPECT_RATIOS,
  EDL_SCHEMA_VERSION,
  PROJECT_TOP_LEVEL_KEYS,
  type AssetV1,
  type ClipV1,
  type MusicV1,
  type ProjectV1,
  type ViewRectV1,
} from './edl';
import { WEB_LOCAL_POLICY, type ExportPolicy } from './policy';
import { MIN_CLIP_DURATION_US, isSafeMicros } from './time';

export type IssueCode =
  | 'not_an_object'
  | 'unknown_field'
  | 'missing_field'
  | 'schema_version_unsupported'
  | 'id_invalid'
  | 'asset_id_duplicate'
  | 'asset_kind_invalid'
  | 'asset_duration_invalid'
  | 'asset_dimension_invalid'
  | 'asset_unknown'
  | 'asset_kind_mismatch'
  | 'time_not_safe_integer'
  | 'range_reversed'
  | 'range_out_of_source'
  | 'clip_too_short'
  | 'clips_empty'
  | 'clip_limit_exceeded'
  | 'view_out_of_bounds'
  | 'view_size_invalid'
  | 'fit_invalid'
  | 'gain_out_of_range'
  | 'fade_negative'
  | 'fade_exceeds_selection'
  | 'music_start_after_output'
  | 'aspect_invalid'
  | 'color_invalid'
  | 'export_spec_invalid'
  | 'revision_invalid'
  | 'output_duration_exceeds_policy'
  | 'source_duration_exceeds_policy'
  | 'video_asset_limit_exceeded';

export interface ValidationIssue {
  code: IssueCode;
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; project: ProjectV1; issues: [] }
  | { ok: false; issues: ValidationIssue[] };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Float comparison epsilon for normalised crop coordinates (doc 10). */
export const VIEW_EPSILON = 1e-6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

class IssueBag {
  readonly issues: ValidationIssue[] = [];

  add(code: IssueCode, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  get ok(): boolean {
    return this.issues.length === 0;
  }
}

function checkId(bag: IssueBag, value: unknown, path: string): value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    bag.add('id_invalid', path, 'Kimlik 1-64 karakter opaque metin olmalı.');
    return false;
  }
  return true;
}

function checkMicros(bag: IssueBag, value: unknown, path: string): value is number {
  if (!isSafeMicros(value)) {
    bag.add(
      'time_not_safe_integer',
      path,
      'Zaman değeri negatif olmayan güvenli tam sayı mikrosaniye olmalı.',
    );
    return false;
  }
  return true;
}

function checkUnknownFields(
  bag: IssueBag,
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      const where = path === '' ? key : `${path}.${key}`;
      bag.add('unknown_field', where, 'Bu sürümde bilinmeyen alan reddedilir.');
    }
  }
}

const ASSET_KEYS = [
  'assetId',
  'kind',
  'durationUs',
  'displayWidth',
  'displayHeight',
  'hasAudio',
] as const;

const CLIP_KEYS = [
  'clipId',
  'assetId',
  'sourceInUs',
  'sourceOutUs',
  'sourceGainDb',
  'muted',
  'view',
] as const;

const VIEW_KEYS = ['x', 'y', 'width', 'height', 'fit'] as const;

const MUSIC_KEYS = [
  'assetId',
  'sourceInUs',
  'sourceOutUs',
  'timelineStartUs',
  'gainDb',
  'muted',
  'fadeInUs',
  'fadeOutUs',
] as const;

const CANVAS_KEYS = ['aspect', 'background'] as const;

const EXPORT_KEYS = [
  'container',
  'videoCodec',
  'audioCodec',
  'shortEdge',
  'fpsNum',
  'fpsDen',
  'colorMode',
  'audioSampleRate',
] as const;

function validateAssets(bag: IssueBag, raw: unknown): Map<string, AssetV1> {
  const byId = new Map<string, AssetV1>();
  if (!Array.isArray(raw)) {
    bag.add('missing_field', 'assets', 'assets bir dizi olmalı.');
    return byId;
  }

  raw.forEach((item, index) => {
    const path = `assets[${index}]`;
    if (!isPlainObject(item)) {
      bag.add('not_an_object', path, 'Asset nesnesi bekleniyor.');
      return;
    }
    checkUnknownFields(bag, item, ASSET_KEYS, path);

    const idOk = checkId(bag, item.assetId, `${path}.assetId`);
    const kind = item.kind;
    if (kind !== 'video' && kind !== 'audio') {
      bag.add('asset_kind_invalid', `${path}.kind`, 'Asset türü video veya audio olmalı.');
    }
    const durationOk = checkMicros(bag, item.durationUs, `${path}.durationUs`);
    if (durationOk && (item.durationUs as number) <= 0) {
      bag.add(
        'asset_duration_invalid',
        `${path}.durationUs`,
        'Kaynak süresi sıfırdan büyük olmalı.',
      );
    }

    for (const dim of ['displayWidth', 'displayHeight'] as const) {
      const value = item[dim];
      if (value === undefined) continue;
      if (!isFiniteNumber(value) || !Number.isInteger(value) || value <= 0) {
        bag.add(
          'asset_dimension_invalid',
          `${path}.${dim}`,
          'Görüntü boyutu pozitif tam sayı olmalı.',
        );
      }
    }
    if (item.hasAudio !== undefined && typeof item.hasAudio !== 'boolean') {
      bag.add('asset_kind_invalid', `${path}.hasAudio`, 'hasAudio boolean olmalı.');
    }

    if (idOk && durationOk && (kind === 'video' || kind === 'audio')) {
      const assetId = item.assetId as string;
      if (byId.has(assetId)) {
        bag.add('asset_id_duplicate', `${path}.assetId`, 'Aynı assetId iki kez tanımlanamaz.');
        return;
      }
      byId.set(assetId, item as unknown as AssetV1);
    }
  });

  return byId;
}

function validateView(bag: IssueBag, raw: unknown, path: string): void {
  if (!isPlainObject(raw)) {
    bag.add('not_an_object', path, 'View nesnesi bekleniyor.');
    return;
  }
  checkUnknownFields(bag, raw, VIEW_KEYS, path);

  const { x, y, width, height, fit } = raw;
  if (fit !== 'cover' && fit !== 'contain') {
    bag.add('fit_invalid', `${path}.fit`, 'fit cover veya contain olmalı.');
  }

  const numbers: Array<[string, unknown]> = [
    ['x', x],
    ['y', y],
    ['width', width],
    ['height', height],
  ];
  for (const [key, value] of numbers) {
    if (!isFiniteNumber(value)) {
      bag.add('view_size_invalid', `${path}.${key}`, 'Kırpma değeri sonlu sayı olmalı.');
      return;
    }
  }

  const vx = x as number;
  const vy = y as number;
  const vw = width as number;
  const vh = height as number;

  if (vw <= 0 || vh <= 0) {
    bag.add('view_size_invalid', path, 'Kırpma genişliği ve yüksekliği sıfırdan büyük olmalı.');
  }
  if (vx < -VIEW_EPSILON || vy < -VIEW_EPSILON) {
    bag.add('view_out_of_bounds', path, 'Kırpma başlangıcı negatif olamaz.');
  }
  if (vx + vw > 1 + VIEW_EPSILON || vy + vh > 1 + VIEW_EPSILON) {
    bag.add('view_out_of_bounds', path, 'Kırpma alanı kaynak karesinin dışına taşıyor.');
  }
}

function validateClips(
  bag: IssueBag,
  raw: unknown,
  assets: Map<string, AssetV1>,
  policy: ExportPolicy,
): void {
  if (!Array.isArray(raw)) {
    bag.add('missing_field', 'clips', 'clips bir dizi olmalı.');
    return;
  }
  if (raw.length === 0) {
    bag.add('clips_empty', 'clips', 'En az bir an gerekli.');
  }
  if (raw.length > policy.maxClips) {
    bag.add('clip_limit_exceeded', 'clips', `Bir projede en çok ${policy.maxClips} an olabilir.`);
  }

  raw.forEach((item, index) => {
    const path = `clips[${index}]`;
    if (!isPlainObject(item)) {
      bag.add('not_an_object', path, 'Klip nesnesi bekleniyor.');
      return;
    }
    checkUnknownFields(bag, item, CLIP_KEYS, path);
    checkId(bag, item.clipId, `${path}.clipId`);

    const assetIdOk = checkId(bag, item.assetId, `${path}.assetId`);
    const asset = assetIdOk ? assets.get(item.assetId as string) : undefined;
    if (assetIdOk && !asset) {
      bag.add('asset_unknown', `${path}.assetId`, 'Klip tanımsız bir kaynağa referans veriyor.');
    } else if (asset && asset.kind !== 'video') {
      bag.add(
        'asset_kind_mismatch',
        `${path}.assetId`,
        'Klip yalnızca video kaynağına bağlanabilir.',
      );
    }

    const inOk = checkMicros(bag, item.sourceInUs, `${path}.sourceInUs`);
    const outOk = checkMicros(bag, item.sourceOutUs, `${path}.sourceOutUs`);
    if (inOk && outOk) {
      const inUs = item.sourceInUs as number;
      const outUs = item.sourceOutUs as number;
      if (outUs <= inUs) {
        bag.add('range_reversed', path, 'Bitiş zamanı başlangıçtan büyük olmalı.');
      } else {
        if (outUs - inUs < MIN_CLIP_DURATION_US) {
          bag.add('clip_too_short', path, 'Bir an en az 100 ms sürmeli.');
        }
        if (asset && asset.kind === 'video' && outUs > asset.durationUs) {
          bag.add('range_out_of_source', path, 'Aralık kaynak süresinin dışına taşıyor.');
        }
      }
    }

    if (!isFiniteNumber(item.sourceGainDb)) {
      bag.add('gain_out_of_range', `${path}.sourceGainDb`, 'Ses seviyesi sonlu sayı olmalı.');
    } else if (
      (item.sourceGainDb as number) < policy.minGainDb ||
      (item.sourceGainDb as number) > policy.maxGainDb
    ) {
      bag.add(
        'gain_out_of_range',
        `${path}.sourceGainDb`,
        `Ses seviyesi ${policy.minGainDb}…${policy.maxGainDb} dB aralığında olmalı.`,
      );
    }
    if (typeof item.muted !== 'boolean') {
      bag.add('missing_field', `${path}.muted`, 'muted boolean olmalı.');
    }
    validateView(bag, item.view, `${path}.view`);
  });
}

function validateMusic(
  bag: IssueBag,
  raw: unknown,
  assets: Map<string, AssetV1>,
  totalOutputUs: number,
  policy: ExportPolicy,
): void {
  if (!isPlainObject(raw)) {
    bag.add('not_an_object', 'music', 'Müzik nesnesi bekleniyor.');
    return;
  }
  checkUnknownFields(bag, raw, MUSIC_KEYS, 'music');

  const assetIdOk = checkId(bag, raw.assetId, 'music.assetId');
  const asset = assetIdOk ? assets.get(raw.assetId as string) : undefined;
  if (assetIdOk && !asset) {
    bag.add('asset_unknown', 'music.assetId', 'Müzik tanımsız bir kaynağa referans veriyor.');
  } else if (asset && asset.kind !== 'audio') {
    bag.add('asset_kind_mismatch', 'music.assetId', 'Müzik yalnızca ses kaynağına bağlanabilir.');
  }

  const inOk = checkMicros(bag, raw.sourceInUs, 'music.sourceInUs');
  const outOk = checkMicros(bag, raw.sourceOutUs, 'music.sourceOutUs');
  const startOk = checkMicros(bag, raw.timelineStartUs, 'music.timelineStartUs');

  let selectionUs = 0;
  if (inOk && outOk) {
    const inUs = raw.sourceInUs as number;
    const outUs = raw.sourceOutUs as number;
    if (outUs <= inUs) {
      bag.add('range_reversed', 'music', 'Müzik bitişi başlangıçtan büyük olmalı.');
    } else {
      selectionUs = outUs - inUs;
      if (asset && asset.kind === 'audio' && outUs > asset.durationUs) {
        bag.add('range_out_of_source', 'music', 'Müzik aralığı ses dosyasının dışına taşıyor.');
      }
    }
  }

  if (startOk && totalOutputUs > 0 && (raw.timelineStartUs as number) >= totalOutputUs) {
    bag.add(
      'music_start_after_output',
      'music.timelineStartUs',
      'Müzik başlangıcı çıktı süresinden küçük olmalı.',
    );
  }

  if (!isFiniteNumber(raw.gainDb)) {
    bag.add('gain_out_of_range', 'music.gainDb', 'Ses seviyesi sonlu sayı olmalı.');
  } else if (
    (raw.gainDb as number) < policy.minGainDb ||
    (raw.gainDb as number) > policy.maxGainDb
  ) {
    bag.add(
      'gain_out_of_range',
      'music.gainDb',
      `Ses seviyesi ${policy.minGainDb}…${policy.maxGainDb} dB aralığında olmalı.`,
    );
  }
  if (typeof raw.muted !== 'boolean') {
    bag.add('missing_field', 'music.muted', 'muted boolean olmalı.');
  }

  const fadeInOk = checkMicros(bag, raw.fadeInUs, 'music.fadeInUs');
  const fadeOutOk = checkMicros(bag, raw.fadeOutUs, 'music.fadeOutUs');
  if (fadeInOk && fadeOutOk && selectionUs > 0) {
    const total = (raw.fadeInUs as number) + (raw.fadeOutUs as number);
    if (total > selectionUs) {
      bag.add('fade_exceeds_selection', 'music', 'Fade süreleri toplamı müzik seçimini aşamaz.');
    }
  }
}

function validateCanvas(bag: IssueBag, raw: unknown): void {
  if (!isPlainObject(raw)) {
    bag.add('not_an_object', 'canvas', 'Canvas nesnesi bekleniyor.');
    return;
  }
  checkUnknownFields(bag, raw, CANVAS_KEYS, 'canvas');
  if (typeof raw.aspect !== 'string' || !ASPECT_RATIOS.includes(raw.aspect as never)) {
    bag.add('aspect_invalid', 'canvas.aspect', 'Oran 9:16, 16:9 veya 1:1 olmalı.');
  }
  if (typeof raw.background !== 'string' || !HEX_COLOR.test(raw.background)) {
    bag.add('color_invalid', 'canvas.background', 'Arka plan #RRGGBB biçiminde olmalı.');
  }
}

function validateExportSpec(bag: IssueBag, raw: unknown): void {
  if (!isPlainObject(raw)) {
    bag.add('not_an_object', 'export', 'Export nesnesi bekleniyor.');
    return;
  }
  checkUnknownFields(bag, raw, EXPORT_KEYS, 'export');

  const enums: Array<[string, unknown, readonly string[]]> = [
    ['container', raw.container, ['mp4']],
    ['videoCodec', raw.videoCodec, ['h264']],
    ['audioCodec', raw.audioCodec, ['aac']],
    ['colorMode', raw.colorMode, ['sdr_rec709']],
  ];
  for (const [key, value, allowed] of enums) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      bag.add(
        'export_spec_invalid',
        `export.${key}`,
        `Bu sürümde yalnızca ${allowed.join(', ')} destekleniyor.`,
      );
    }
  }

  const positives: Array<[string, unknown]> = [
    ['shortEdge', raw.shortEdge],
    ['fpsNum', raw.fpsNum],
    ['fpsDen', raw.fpsDen],
    ['audioSampleRate', raw.audioSampleRate],
  ];
  for (const [key, value] of positives) {
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value <= 0) {
      bag.add('export_spec_invalid', `export.${key}`, 'Pozitif tam sayı bekleniyor.');
    }
  }
}

/** Sum of clip durations; there are no transitions or speed changes (doc 09). */
function sumClipDurations(clips: unknown): number {
  if (!Array.isArray(clips)) return 0;
  let total = 0;
  for (const clip of clips) {
    if (!isPlainObject(clip)) continue;
    const inUs = clip.sourceInUs;
    const outUs = clip.sourceOutUs;
    if (isSafeMicros(inUs) && isSafeMicros(outUs) && outUs > inUs) {
      total += outUs - inUs;
    }
  }
  return total;
}

export function validateProject(
  input: unknown,
  policy: ExportPolicy = WEB_LOCAL_POLICY,
): ValidationResult {
  const bag = new IssueBag();

  if (!isPlainObject(input)) {
    bag.add('not_an_object', '', 'Proje nesnesi bekleniyor.');
    return { ok: false, issues: bag.issues };
  }

  checkUnknownFields(bag, input, PROJECT_TOP_LEVEL_KEYS, '');

  if (input.schemaVersion !== EDL_SCHEMA_VERSION) {
    bag.add(
      'schema_version_unsupported',
      'schemaVersion',
      `Yalnızca schemaVersion=${EDL_SCHEMA_VERSION} okunabilir.`,
    );
    // A future schema is read-only: stop before interpreting unknown semantics.
    return { ok: false, issues: bag.issues };
  }

  checkId(bag, input.projectId, 'projectId');
  if (
    !isFiniteNumber(input.revision) ||
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0
  ) {
    bag.add('revision_invalid', 'revision', 'Revision negatif olmayan tam sayı olmalı.');
  }

  const assets = validateAssets(bag, input.assets);
  validateCanvas(bag, input.canvas);
  validateClips(bag, input.clips, assets, policy);
  validateExportSpec(bag, input.export);

  const totalOutputUs = sumClipDurations(input.clips);
  if (totalOutputUs > policy.maxOutputDurationUs) {
    bag.add('output_duration_exceeds_policy', 'clips', 'Toplam çıktı süresi web sınırını aşıyor.');
  }

  let totalSourceUs = 0;
  let videoAssetCount = 0;
  for (const asset of assets.values()) {
    if (asset.kind === 'video') {
      videoAssetCount += 1;
      totalSourceUs += asset.durationUs;
    }
  }
  if (videoAssetCount > policy.maxVideoAssets) {
    bag.add('video_asset_limit_exceeded', 'assets', 'Bir projede çok fazla video kaynağı var.');
  }
  if (totalSourceUs > policy.maxTotalSourceDurationUs) {
    bag.add(
      'source_duration_exceeds_policy',
      'assets',
      'Toplam kaynak süresi web sınırını aşıyor.',
    );
  }

  if (input.music !== undefined) {
    validateMusic(bag, input.music, assets, totalOutputUs, policy);
  }

  if (!bag.ok) {
    return { ok: false, issues: bag.issues };
  }
  return { ok: true, project: input as unknown as ProjectV1, issues: [] };
}

export function issueCodes(result: ValidationResult): IssueCode[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

export type { AssetV1, ClipV1, MusicV1, ProjectV1, ViewRectV1 };
