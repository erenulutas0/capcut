/**
 * The video bitrate handed to the encoder, by encoder kind (ADR-024).
 *
 * The render plan's bitrate (~0.09 bit per pixel) was tuned on hardware
 * encoders. Where the browser has no hardware H.264 encoder (Playwright's
 * Chromium, Linux Chrome without VA-API, VMs, Chrome/Edge asked for software)
 * it falls back to a software encoder (OpenH264) that needs far more bits for
 * the same picture. Measured on the hardest real recording (R15, 1080p60
 * phone video, 720p output): hardware at the plan's 2.49 Mbit/s target
 * reached SSIM 0.861; software reached 0.825 at 2x, 0.851 at 2.5x and 0.871
 * at 3x the target, with bitrate mode, latency mode and key frame interval
 * making no difference. 3x is the smallest measured step that matches the
 * hardware encoder's quality there with margin.
 *
 * Hardware encoders keep the plan's bitrate (their rate control is ADR-045's,
 * `ORDINARY_BITRATE_MODE` below).
 */

export type VideoEncoderKind = 'hardware' | 'software';

export const SOFTWARE_ENCODER_BITRATE_FACTOR = 3;

export function encoderVideoBitrate(planBitrate: number, kind: VideoEncoderKind): number {
  return kind === 'software' ? Math.round(planBitrate * SOFTWARE_ENCODER_BITRATE_FACTOR) : planBitrate;
}

/**
 * A re-encode may spend this many times the source's own bitrate, and no
 * more. Not 1: the browser's real-time H.264 encoder needs more bits than the
 * encoder that made the file (a phone's HEVC, a screen recorder's VP9, x264
 * at a slow preset) to show the same picture, and the picture may have been
 * scaled up on the way. Twice the source leaves that room and still stops a
 * small file from coming back many times its size.
 */
export const SOURCE_BITRATE_HEADROOM = 2;

/** No re-encode is asked for less than this (the plan's own floor, `videoBitrateFor`). */
export const MIN_REENCODE_BITRATE = 500_000;

/**
 * The plan's bitrate, held to what the source itself has (10 Oct 2026).
 *
 * The plan's table (~0.09 bit per pixel) is right for camera footage, which
 * arrives with far more bits than that. A video that is small to begin with —
 * a screen recording, a slide show, a clip that was already compressed hard —
 * has nothing those bits could show: a 24-second 720p file of 0.5 MB came
 * back as 1.5 MB for three seconds of it. So the bitrate asked of the encoder
 * is the plan's, but never more than `SOURCE_BITRATE_HEADROOM` × the source's
 * own (file bytes over length: sound included, so it errs on the generous
 * side), and never under `MIN_REENCODE_BITRATE`.
 *
 * ADR-024 is untouched: the software encoder's 3× is put on top of THIS
 * value (`encoderVideoBitrate`), exactly as before. A source whose bitrate is
 * unknown keeps the plan's bitrate.
 */
export function sourceBoundedBitrate(planBitrate: number, sourceBitrate: number | null | undefined): number {
  if (sourceBitrate === null || sourceBitrate === undefined || !Number.isFinite(sourceBitrate) || sourceBitrate <= 0) {
    return planBitrate;
  }
  const ceiling = Math.max(MIN_REENCODE_BITRATE, Math.round(sourceBitrate * SOURCE_BITRATE_HEADROOM));
  return Math.min(planBitrate, ceiling);
}

/* ------------------------------------------------------------ rate control */

/** WebCodecs' `VideoEncoderConfig.bitrateMode`, as far as a download asks for one. */
export type VideoBitrateMode = 'constant' | 'variable';

/**
 * The rate control an ORDINARY (re-encoded) download asks for, by encoder kind
 * (ADR-045). A target-size download always asks for `constant` (ADR-035);
 * copies and the fast cut's seams are not touched by this.
 *
 * - hardware: `constant`. On the phone (S23) the variable mode wrote 1.06–1.51
 *   times the asked bitrate (1.97 on a short detailed clip), constant 0.999–
 *   1.003. On this desktop's hardware encoder (Chrome and Edge, nine cases,
 *   docs/quality/2026-10-14-cbr.md) constant passed the rule registered before
 *   measuring on every case: mean VMAF at most 1.85 lower, worst-frame SSIM at
 *   most 0.006 lower, every file smaller (0.80–0.99 of the variable one), and a
 *   flat picture is not padded up (0.05 of the asked bitrate in both modes).
 * - software: `variable`, by the same rule: on a flat test pattern the
 *   constant file came out 1.9–2.5 % larger (the rule allowed 1 %), a matter
 *   of content the app cannot know before encoding. The software encoder
 *   already writes 0.99 of what it is asked in either mode, so constant would
 *   gain it nothing.
 */
export const ORDINARY_BITRATE_MODE: Record<VideoEncoderKind, VideoBitrateMode> = {
  hardware: 'constant',
  software: 'variable',
};

/** The rate control asked for, and the one the encoder is really configured with. */
export interface BitrateModeChoice {
  asked: VideoBitrateMode;
  used: VideoBitrateMode;
}

/**
 * Settles the rate control before the encoder exists. `variable` is what an
 * encoder without a mode is given anyway (mediabunny's and WebCodecs' default),
 * so it is not asked about. `constant` is used only where the browser says it
 * can encode this picture that way; otherwise — a refusal, or no answer — the
 * download goes on in `variable` and says so (`asked` differs from `used`).
 * The choice never ends a download.
 */
export async function chooseBitrateMode(
  asked: VideoBitrateMode,
  supports: (mode: VideoBitrateMode) => Promise<boolean>,
): Promise<BitrateModeChoice> {
  if (asked === 'variable') return { asked, used: 'variable' };
  let supported = false;
  try {
    supported = (await supports(asked)) === true;
  } catch {
    supported = false;
  }
  return { asked, used: supported ? asked : 'variable' };
}
