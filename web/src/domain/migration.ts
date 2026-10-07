/**
 * Reading older recipes (doc 10 "Sürümleme").
 *
 * v1 → v2 only adds `captionTracks` (ADR-015), so the migration is lossless
 * and mechanical: a v1 recipe gets an empty caption list and nothing else
 * changes. v2 → v3 (ADR-036) and v3 → v4 (ADR-037) change nothing in an
 * existing recipe but the number. Everything that reads stored or imported
 * recipes goes through `loadProject`; `validateProject` itself only knows the
 * current schema.
 */

import { EDL_SCHEMA_VERSION } from './edl';
import type { ExportPolicy } from './policy';
import { validateProject, type ValidationResult } from './validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Upgrades a recipe to the current schema without judging it; validation
 * happens afterwards. Anything that is not a recognisable v1 recipe is
 * returned untouched so the validator reports it with the usual codes.
 */
export function migrateProject(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  // v2 → v3 (ADR-036): the number only. v3 only ALLOWS more (transcript
  // tracks, their unclear spans, more lines), so every valid v2 recipe is a
  // valid v3 recipe. A v2 recipe without its caption list is left for the
  // validator to refuse rather than repaired by guessing.
  if (input.schemaVersion === 2) return 'enhance' in input ? input : { ...input, schemaVersion: EDL_SCHEMA_VERSION };
  // v3 → v4 (ADR-037): the number only. v4 only ADDS the optional `enhance`
  // setting, so every valid v3 recipe is a valid v4 recipe with enhancement
  // off. An older recipe that already carries the field was written by no
  // build: left for the validator to refuse.
  if (input.schemaVersion === 3) return 'enhance' in input ? input : { ...input, schemaVersion: EDL_SCHEMA_VERSION };
  if (input.schemaVersion !== 1) return input;
  // A v1 recipe never had captions. If one claims to, it is not a v1 recipe
  // this code understands: leave it for the validator to refuse.
  if ('captionTracks' in input || 'enhance' in input) return input;
  return { ...input, schemaVersion: EDL_SCHEMA_VERSION, captionTracks: [] };
}

/** The single entry point for recipes from storage, backups and fixtures. */
export function loadProject(input: unknown, policy?: ExportPolicy): ValidationResult {
  return validateProject(migrateProject(input), policy);
}
