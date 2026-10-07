/** `a.b.c:1.5,d:2` -> a deep copy of the tuning with those values replaced (parameter sweeps, ADR-037). */
export function tuningWith(base, spec) {
  const tuning = structuredClone(base);
  if (!spec || spec === true) return tuning;
  for (const part of String(spec).split(',')) {
    const [path, raw] = part.split(':');
    const keys = path.split('.');
    let target = tuning;
    for (const key of keys.slice(0, -1)) target = target[key];
    const last = keys[keys.length - 1];
    if (!(last in target)) throw new Error(`unknown tuning key ${path}`);
    target[last] = Number(raw);
  }
  return tuning;
}
