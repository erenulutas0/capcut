import { describe, expect, it } from 'vitest';

import { pickFrames, type TimedFrame } from '@/adapters/export/framePicker';

interface FakeFrame extends TimedFrame {
  id: number;
  closed: boolean;
}

function makeFrames(timestamps: number[], duration: number): FakeFrame[] {
  return timestamps.map((timestamp, id) => ({
    id,
    timestamp,
    duration,
    closed: false as boolean,
    close() {
      this.closed = true;
    },
  }));
}

async function* stream(frames: FakeFrame[]) {
  for (const frame of frames) yield frame;
}

const OUTPUT_FRAME = 1 / 30;

async function pick(frames: FakeFrame[], targets: number[]) {
  const out: { id: number | null; missing: boolean; closedWhenYielded: boolean }[] = [];
  for await (const picked of pickFrames(stream(frames), targets, OUTPUT_FRAME)) {
    out.push({
      id: picked.frame?.id ?? null,
      missing: picked.missing,
      closedWhenYielded: picked.frame?.closed ?? false,
    });
  }
  return out;
}

const range = (from: number, step: number, count: number) =>
  Array.from({ length: count }, (_, i) => Number((from + i * step).toFixed(6)));

describe('pickFrames', () => {
  it('maps a 60 fps source onto a 30 fps grid without gaps', async () => {
    const frames = makeFrames(range(0, 1 / 60, 60), 1 / 60);
    const out = await pick(frames, range(0, 1 / 30, 30));
    expect(out.every((o) => !o.missing)).toBe(true);
    expect(out.map((o) => o.id)).toEqual(range(0, 2, 30));
  });

  it('repeats a 24 fps frame where the 30 fps grid needs it', async () => {
    const frames = makeFrames(range(0, 1 / 24, 24), 1 / 24);
    const out = await pick(frames, range(0, 1 / 30, 30));
    expect(out.every((o) => !o.missing)).toBe(true);
    // 30 targets from 24 frames: some frames are shown twice, none skipped backwards.
    const ids = out.map((o) => o.id as number);
    expect(ids.every((id, i) => id >= (ids[i - 1] ?? 0))).toBe(true);
  });

  it('reports a run of frames the decoder did not deliver instead of hiding it', async () => {
    // 30 fps source with frames 10..19 lost by the decoder.
    const all = makeFrames(range(0, 1 / 30, 30), 1 / 30);
    const delivered = all.filter((f) => f.id < 10 || f.id >= 20);
    const out = await pick(delivered, range(0, 1 / 30, 30));
    // The freeze shows the last good frame, never a newer or empty one.
    expect(out.slice(10, 20).every((o) => o.id === 9)).toBe(true);
    // Frame 9 held one extra output frame is within tolerance; 11..19 are not.
    expect(out.map((o, i) => (o.missing ? i : -1)).filter((i) => i >= 0)).toEqual(range(11, 1, 9));
  });

  it('does not count a single dropped frame of a 60 fps source as a gap', async () => {
    // Hardware decoders drop an odd frame; the neighbour is 1/60 s older.
    const all = makeFrames(range(0, 1 / 60, 60), 1 / 60);
    const delivered = all.filter((f) => f.id !== 21 && f.id !== 40);
    const out = await pick(delivered, range(0, 1 / 30, 30));
    expect(out.some((o) => o.missing)).toBe(false);
  });

  it('treats a small container start offset as the first frame, not a loss', async () => {
    const frames = makeFrames(range(0.05, 1 / 30, 30), 1 / 30);
    const out = await pick(frames, range(0, 1 / 30, 3));
    expect(out[0]).toMatchObject({ id: 0, missing: false });
    expect(out.every((o) => !o.missing)).toBe(true);
  });

  it('marks targets far before the first delivered frame as missing', async () => {
    const frames = makeFrames(range(1, 1 / 30, 10), 1 / 30);
    const out = await pick(frames, [0, 0.5, 1]);
    expect(out[0]).toMatchObject({ id: null, missing: true });
    expect(out[1]).toMatchObject({ id: null, missing: true });
    expect(out[2]).toMatchObject({ id: 0, missing: false });
  });

  it('marks the tail missing when the stream ends early', async () => {
    const frames = makeFrames(range(0, 1 / 30, 5), 1 / 30);
    const out = await pick(frames, range(0, 1 / 30, 8));
    // Frame 4 may stand one output frame longer; after that it is a gap.
    expect(out.slice(0, 6).every((o) => !o.missing)).toBe(true);
    expect(out.slice(6).every((o) => o.missing && o.id === 4)).toBe(true);
  });

  it('never yields a closed frame and closes every frame it received', async () => {
    const frames = makeFrames(range(0, 1 / 60, 60), 1 / 60);
    const out = await pick(frames, range(0, 1 / 30, 30));
    expect(out.some((o) => o.closedWhenYielded)).toBe(false);
    expect(frames.every((f) => f.closed)).toBe(true);
  });

  it('trusts a frame with unknown duration until the next one arrives', async () => {
    const frames = makeFrames([0, 0.5], 0);
    const out = await pick(frames, [0, 0.2, 0.4, 0.5]);
    expect(out.map((o) => o.missing)).toEqual([false, false, false, false]);
    expect(out.map((o) => o.id)).toEqual([0, 0, 0, 1]);
  });
});
