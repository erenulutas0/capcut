/**
 * Writes the audio of one moment: the source clip's sound at its gain, the
 * external music with its envelope, the common headroom and the limiter —
 * mixed in chunks so memory stays flat regardless of duration.
 *
 * Moved out of the worker unchanged so the fast cut (ADR-027) writes exactly
 * the same audio as the full encode. `advanceTo` lets the fast cut interleave
 * audio with the copied video; the full encode calls it once per moment, as
 * before.
 */

import { AudioSample, type AudioSampleSource } from 'mediabunny';

import { clampBuffers, interleave, mixStreamInto, musicEnvelope } from '@/domain/audioMix';
import { frameToUs, type RenderPlan, type RenderSegment } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import type { AudioStreamReader } from './audioStream';

/** Audio is mixed in chunks so memory stays flat regardless of duration. */
const AUDIO_CHUNK_FRAMES = 4096;

export interface AudioContextSources {
  clipReader: AudioStreamReader | null;
  musicReader: AudioStreamReader | null;
}

export class SegmentAudioWriter {
  private readonly lastAudioFrame: number;
  private readonly segmentStartUs: number;
  private frame: number;
  private opened = false;

  constructor(
    private readonly plan: RenderPlan,
    private readonly segment: RenderSegment,
    private readonly sources: AudioContextSources,
    private readonly audioSource: AudioSampleSource,
    private readonly checkCanceled: () => void,
  ) {
    const outRate = plan.audio.sampleRate;
    this.segmentStartUs = frameToUs(segment.startFrame, plan.fpsNum, plan.fpsDen);
    const segmentEndUs = frameToUs(segment.endFrame, plan.fpsNum, plan.fpsDen);
    this.frame = Math.round((this.segmentStartUs * outRate) / US_PER_SECOND);
    this.lastAudioFrame = Math.round((segmentEndUs * outRate) / US_PER_SECOND);
  }

  /** Writes the moment's audio up to output time `untilUs` (the whole moment when omitted). */
  async advanceTo(untilUs?: number): Promise<void> {
    const { plan, segment, sources, audioSource } = this;
    const outRate = plan.audio.sampleRate;
    const channels = plan.audio.channelCount;
    const target =
      untilUs === undefined
        ? this.lastAudioFrame
        : Math.min(this.lastAudioFrame, Math.round((untilUs * outRate) / US_PER_SECOND));
    const { clipReader, musicReader } = sources;

    if (!this.opened) {
      this.opened = true;
      if (clipReader && segment.gain > 0) {
        await clipReader.open(segment.sourceInUs / US_PER_SECOND, segment.sourceOutUs / US_PER_SECOND);
      }
    }

    while (this.frame < target) {
      const frame = this.frame;
      this.checkCanceled();
      const chunkFrames = Math.min(AUDIO_CHUNK_FRAMES, target - frame);
      const planar: Float32Array[] = [];
      for (let channel = 0; channel < channels; channel += 1) {
        planar.push(new Float32Array(chunkFrames));
      }

      // --- source clip audio -------------------------------------------------
      if (clipReader && segment.gain > 0 && clipReader.sampleRate > 0) {
        const srcRate = clipReader.sampleRate;
        const chunkStartUs = (frame * US_PER_SECOND) / outRate;
        const offsetUs = chunkStartUs - this.segmentStartUs;
        const startSourceSeconds = (segment.sourceInUs + offsetUs) / US_PER_SECOND;
        const positionStart = startSourceSeconds * srcRate;
        const positionStep = srcRate / outRate;

        // Buffer forward first, then mix: `pcm` only exists once something
        // has been decoded, and a silent source legitimately never fills it.
        await clipReader.ensure(Math.ceil(positionStart + chunkFrames * positionStep) + 2);
        if (clipReader.pcm) {
          mixStreamInto(planar, chunkFrames, clipReader.pcm, positionStart, positionStep, segment.gain);
          clipReader.release(Math.floor(positionStart) - 1);
        }
      }

      // --- external music ----------------------------------------------------
      const music = plan.audio.music;
      if (musicReader && music) {
        const gains = musicEnvelope(music, frame, chunkFrames, outRate);
        let anyGain = false;
        for (let i = 0; i < chunkFrames; i += 1) {
          if ((gains[i] ?? 0) > 0) {
            anyGain = true;
            break;
          }
        }
        if (anyGain && musicReader.sampleRate > 0) {
          const srcRate = musicReader.sampleRate;
          const chunkStartUs = (frame * US_PER_SECOND) / outRate;
          const musicSourceUs = music.sourceInUs + (chunkStartUs - music.timelineStartUs);
          const positionStart = (musicSourceUs / US_PER_SECOND) * srcRate;
          const positionStep = srcRate / outRate;

          await musicReader.ensure(Math.ceil(positionStart + chunkFrames * positionStep) + 2);
          if (musicReader.pcm) {
            mixStreamInto(planar, chunkFrames, musicReader.pcm, positionStart, positionStep, gains);
            musicReader.release(Math.floor(positionStart) - 1);
          }
        }
      }

      // --- headroom + limiter ------------------------------------------------
      if (plan.audio.safetyGain !== 1) {
        for (const channel of planar) {
          for (let i = 0; i < chunkFrames; i += 1) {
            channel[i] = (channel[i] ?? 0) * plan.audio.safetyGain;
          }
        }
      }
      clampBuffers(planar, chunkFrames);

      const sample = new AudioSample({
        data: interleave(planar, chunkFrames),
        format: 'f32',
        numberOfChannels: channels,
        sampleRate: outRate,
        timestamp: frame / outRate,
      });
      try {
        await audioSource.add(sample);
      } finally {
        // `add` has encoded it by the time it resolves; mediabunny leaves closing to us.
        sample.close();
      }
      this.frame = frame + chunkFrames;
    }
  }

  get done(): boolean {
    return this.frame >= this.lastAudioFrame;
  }
}
