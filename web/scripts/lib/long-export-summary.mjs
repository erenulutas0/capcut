/**
 * One line per long-export result file (`measure-long-export.mjs`), and the
 * Markdown table rows of docs/perf/2026-10-15-long-export.md.
 *
 *   node scripts/lib/long-export-summary.mjs                 # every file in matrix-results/long-export
 *   node scripts/lib/long-export-summary.mjs --md a.json …   # Markdown rows of these files
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dir = join(root, 'matrix-results', 'long-export');
const args = process.argv.slice(2);
const md = args.includes('--md');
const files = args.filter((a) => a.endsWith('.json'));
const list = files.length ? files.map((f) => (f.includes('/') || f.includes('\\') ? f : join(dir, f))) : readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));

const tr = (n, digits = 1) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits).replace('.', ','));
const stageLine = (profile, top = 4) =>
  profile
    ? Object.entries(profile.stages ?? {})
        .sort((a, b) => b[1].totalMs - a[1].totalMs)
        .slice(0, top)
        .map(([name, s]) => `${name} ${tr(s.share * 100, 0)} % (${tr(s.meanMs, 2)} ms)`)
        .join(', ')
    : '—';

for (const file of list) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const frames = r.frameIdentity ? `${r.frameIdentity.filter((c) => c.ok).length}/${r.frameIdentity.length}` : '—';
  const sync = Array.isArray(r.audioSync) ? r.audioSync.map((w) => (w.medianOffsetMs === null ? '?' : tr(w.medianOffsetMs, 1))).join(' / ') + ' ms' : r.audioSync?.skipped ? 'atlandı' : '—';
  const mem = r.memory ?? {};
  const disk = r.disk ?? {};
  if (md) {
    console.log(
      `| ${r.task} | ${r.source} | ${r.browser} | ${r.outcome ?? r.error} | ${tr(r.elapsedS)} s (×${tr(r.realTimeFactor, 2)}) | ${r.method?.method ?? '—'} | ` +
        `${tr(r.file?.mib, 0)} MiB, ${tr(r.file?.durationS, 3)} s, ${r.file?.video?.frames ?? '—'} kare | ` +
        `${tr(mem.baselineMib, 0)} → ${tr(mem.peakTotalMib, 0)} (renderer ${tr(mem.peakByType?.['renderer-max'], 0)}, GPU ${tr(mem.peakByType?.['gpu-process'], 0)}) → ${tr(mem.afterMib, 0)} | ` +
        `${tr(disk.before?.profileMib, 0)} → ${tr(disk.peakProfileMib, 0)} → ${tr(disk.after?.profileMib, 0)} / ${tr(disk.profileAfterCloseMib, 0)} | ${frames} | ${sync} | ${r.stallWatchdog ?? '—'} / ${r.pageWatchdog ?? '—'} |`,
    );
  } else {
    console.log(
      `${r.label}: ${r.outcome ?? r.error} ${tr(r.elapsedS)} s ×${tr(r.realTimeFactor, 2)} | ${r.method?.method ?? '—'} ${tr(r.file?.mib, 0)} MiB ${tr(r.file?.durationS, 3)} s ${r.file?.video?.frames ?? '—'} kare | ` +
        `mem ${tr(mem.baselineMib, 0)}→${tr(mem.peakTotalMib, 0)} (r ${tr(mem.peakByType?.['renderer-max'], 0)}, gpu ${tr(mem.peakByType?.['gpu-process'], 0)})→${tr(mem.afterMib, 0)}${mem.after20sMib ? `→${tr(mem.after20sMib, 0)}` : ''} | ` +
        `disk ${tr(disk.before?.profileMib, 0)}→${tr(disk.peakProfileMib, 0)}→${tr(disk.after?.profileMib, 0)}/${tr(disk.profileAfterCloseMib, 0)} | kare ${frames} | ses ${sync} | wd ${r.stallWatchdog ?? '—'}/${r.pageWatchdog ?? '—'}` +
        (r.cancel ? ` | iptal %${r.cancel.askedAtPercent} → ${r.cancel.stoppedAfterMs} ms` : '') +
        (r.message ? ` | ${r.message}` : '') +
        (r.failure ? ` | HATA ${r.failure.text}` : '') +
        (r.error ? ` | ERR ${r.error}` : '') +
        `\n    aşama: ${stageLine(r.profile)}` +
        (r.opfsAfter?.length ? `\n    OPFS sonra: ${r.opfsAfter.map((e) => `${e.name} ${e.size}`).join(', ')}` : '') +
        (r.kucult ? `\n    kucult: ${Object.entries(r.kucult.hints).map(([k, h]) => `${k}=${h.state} (${h.text})`).join('; ')}` : '') +
        (r.consoleErrors?.length ? `\n    konsol hataları: ${r.consoleErrors.slice(0, 3).join(' || ')}` : ''),
    );
  }
}
