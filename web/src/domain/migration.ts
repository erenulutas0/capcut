/**
 * Reading older recipes (doc 10 "Sürümleme").
 *
 * v1 → v2 only adds `captionTracks` (ADR-015), so the migration is lossless
 * and mechanical: a v1 recipe gets an empty caption list and nothing else
 * changes. v2 → v3 (ADR-036), v3 → v4 (ADR-037) and v4 → v5 (ADR-043) change
 * nothing in an existing recipe but the number. Everything that reads stored
 * or imported recipes goes through `loadProject` or, for a project record,
 * `loadStoredProject`; `validateProject` itself only knows the current schema.
 *
 * There is no way down: a recipe with a HIGHER number than this build knows
 * is returned untouched and the validator refuses it
 * (`schema_version_unsupported`) before reading anything else in it.
 */

import { EDL_SCHEMA_VERSION } from './edl';
import type { ExportPolicy } from './policy';
import { validateProject, validateStoredProject, type ValidationResult } from './validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when any caption line carries the v5 field `speaker`. Looks only; judges nothing. */
function carriesSpeaker(input: Record<string, unknown>): boolean {
  if (!Array.isArray(input.captionTracks)) return false;
  return input.captionTracks.some(
    (track: unknown) =>
      isPlainObject(track) && Array.isArray(track.cues) && track.cues.some((cue: unknown) => isPlainObject(cue) && 'speaker' in cue),
  );
}

/**
 * Upgrades a recipe to the current schema without judging it; validation
 * happens afterwards. Anything that is not a recognisable older recipe is
 * returned untouched so the validator reports it with the usual codes.
 *
 * A recipe that carries a field its own version never had was written by no
 * build. It is not repaired by guessing: it keeps its old number and the
 * validator refuses it.
 */
export function migrateProject(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const version = input.schemaVersion;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) return input;
  // `speaker` on a line is v5 (ADR-043): no older recipe has it.
  if (carriesSpeaker(input)) return input;
  // v4 → v5: the number only. v5 only ADDS the optional `speaker` of a
  // transcript line, so every valid v4 recipe is a valid v5 recipe in which
  // no line names a speaker.
  if (version === 4) return { ...input, schemaVersion: EDL_SCHEMA_VERSION };
  // `enhance` is v4 (ADR-037): no v1, v2 or v3 recipe has it.
  if ('enhance' in input) return input;
  // v2 → v3 (ADR-036) and v3 → v4 (ADR-037): the number only. v3 only ALLOWS
  // more (transcript tracks, their unclear spans, more lines) and v4 only
  // adds the optional `enhance` setting. A v2 or v3 recipe without its
  // caption list is left for the validator to refuse rather than repaired.
  if (version === 2 || version === 3) return { ...input, schemaVersion: EDL_SCHEMA_VERSION };
  // v1 never had captions. If one claims to, it is not a v1 recipe this code
  // understands: leave it for the validator to refuse.
  if ('captionTracks' in input) return input;
  return { ...input, schemaVersion: EDL_SCHEMA_VERSION, captionTracks: [] };
}

/** The single entry point for recipes from storage, backups and fixtures. */
export function loadProject(input: unknown, policy?: ExportPolicy): ValidationResult {
  return validateProject(migrateProject(input), policy);
}

/**
 * A recipe out of a project record (the browser's store, a backup file):
 * upgraded the same way, and allowed to have no kesit yet (`validateStoredProject`).
 */
export function loadStoredProject(input: unknown, policy?: ExportPolicy): ValidationResult {
  return validateStoredProject(migrateProject(input), policy);
}
