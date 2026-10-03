/**
 * Gives a result file a suffix after the fact (file name and the `suffix`
 * field), without touching what was measured. Needed once on 3 Oct 2026: the
 * Turkish runs were started without a suffix and took the file names of the
 * English runs of the same model (which were then run again).
 *
 *   node relabel-result.mjs <file.json> <suffix> [--only-set=tr]
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const [file, suffix] = process.argv.slice(2);
const onlySet = (process.argv.find((a) => a.startsWith('--only-set=')) ?? '').slice(11);
const result = JSON.parse(readFileSync(file, 'utf8'));
if (onlySet && !result.clips.every((c) => c.set === onlySet)) throw new Error(`${file} holds clips outside set "${onlySet}"; not relabelled`);
result.suffix = suffix;
writeFileSync(file, JSON.stringify(result));
renameSync(file, file.replace(/\.json$/, `${suffix}.json`));
console.log(`${file} → ${suffix}`);
