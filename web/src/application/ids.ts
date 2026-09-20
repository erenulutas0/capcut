/**
 * Opaque, stable, short ids. Deterministic on purpose: the next id is derived
 * from the ids already in the project, so replaying the same edits yields the
 * same recipe and tests do not need a clock or a random source.
 */

export function nextId(prefix: string, existing: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}_(\\d+)$`);
  let max = 0;
  for (const id of existing) {
    const match = pattern.exec(id);
    if (match?.[1]) {
      max = Math.max(max, Number.parseInt(match[1], 10));
    }
  }
  return `${prefix}_${String(max + 1).padStart(3, '0')}`;
}
