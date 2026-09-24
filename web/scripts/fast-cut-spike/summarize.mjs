/**
 * One line per case from a spike result file:
 *   node scripts/fast-cut-spike/summarize.mjs fastcut-spike-results/chrome/spike-chrome.json
 */
import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const summary = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`# ${summary.browser} (${summary.ranAt}) sayfa hataları: ${summary.pageErrors.length}`);
  for (const r of summary.results) {
    if (r.error) {
      console.log(`${r.case.padEnd(22)} ERROR ${r.error}`);
      continue;
    }
    if (r.kind === 'editlist') {
      console.log(
        `${r.case.padEnd(22)} edit list: ffmpeg ilk kare ${r.ffmpegDecoded.first} (beklenen ${r.ffmpegDecoded.expectedFirst}), ` +
          `ffmpeg ${r.ffmpegDecoded.frames} kare, WebCodecs ${r.webcodecs.frames} kare (ilk t=${r.webcodecs.first?.t}), ` +
          `<video> t=0 → ${r.video.seeks[0]?.frame}`,
      );
      continue;
    }
    if (!r.cut.ok) {
      console.log(`${r.case.padEnd(22)} ${String(r.cut.reason).padEnd(8)} (tam kodlamaya düşer)`);
      continue;
    }
    const failed = (r.verify?.checks ?? []).filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
    const id = r.verify?.identity ?? {};
    console.log(
      `${r.case.padEnd(22)} ${r.cut.method.padEnd(6)} ${String(r.cut.totalFrames).padStart(5)} kare, kopya ${id.copiedExact}/${id.copied} bit-aynı, ` +
        `dikiş ${r.cut.framesEncoded} kare SSIM min ${id.seamSsimMin ?? '—'}, ses ${r.verify?.audioSync?.worstMs ?? '—'} ms, ` +
        `iç denetim ${r.cut.verify}, <video> atlama ${r.video?.seekOk ?? '—'} sona ${r.video?.ended}, ` +
        `${(r.cut.ms.verified / 1000).toFixed(2)} s` +
        (failed.length ? `\n    FAIL ${failed.join('\n    FAIL ')}` : ''),
    );
  }
}
