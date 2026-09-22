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
 * Hardware encoders are left exactly as they were: same config, same files.
 */

export type VideoEncoderKind = 'hardware' | 'software';

export const SOFTWARE_ENCODER_BITRATE_FACTOR = 3;

export function encoderVideoBitrate(planBitrate: number, kind: VideoEncoderKind): number {
  return kind === 'software' ? Math.round(planBitrate * SOFTWARE_ENCODER_BITRATE_FACTOR) : planBitrate;
}
