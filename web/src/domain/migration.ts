/**
 * Reading older recipes (doc 10 "Sürümleme").
 *
 * v1 → v2 only adds `captionTracks` (ADR-015), so the migration is lossless
 * and mechanical: a v1 recipe gets an empty caption list and nothing else
 * changes. Everything that reads stored or imported recipes goes through
 * `loadProject`; `validateProject` itself only knows the current schema.
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
  if (!isPlainObject(input) || input.schemaVersion !== 1) return input;
  // A v1 recipe never had captions. If one claims to, it is not a v1 recipe
  // this code understands: leave it for the validator to refuse.
  if ('captionTracks' in input) return input;
  return { ...input, schemaVersion: EDL_SCHEMA_VERSION, captionTracks: [] };
}

/** The single entry point for recipes from storage, backups and fixtures. */
export function loadProject(input: unknown, policy?: ExportPolicy): ValidationResult {
  return validateProject(migrateProject(input), policy);
}
