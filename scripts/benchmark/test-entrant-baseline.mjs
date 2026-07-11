#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertBaselineLevelAllowlist, levelIdsFromRegistry, validateBaselineLevelAllowlist } from './entrant-baseline.mjs';

const registry = `
export const levelMetadatas: LevelMetadata[] = [
  { id: 'crystal-corridor', title: 'Crystal Corridor' },
  { id: 'helios', title: 'Helios' },
];
`;

assert.deepEqual(levelIdsFromRegistry(registry), ['crystal-corridor', 'helios']);
assert.deepEqual(validateBaselineLevelAllowlist(['crystal-corridor', 'helios']), []);
assert.ok(validateBaselineLevelAllowlist(['crystal-corridor', 'crystal-corridor']).some((error) => error.includes('duplicates')));
assert.ok(validateBaselineLevelAllowlist([]).some((error) => error.includes('non-empty')));
assert.throws(
  () => assertBaselineLevelAllowlist({ actualLevelIds: ['crystal-corridor', 'downpour-hlht'], allowedLevelIds: ['crystal-corridor'] }),
  /unallowlisted level\(s\): downpour-hlht.*benchmark\/releases\/README\.md/,
);
assert.throws(
  () => assertBaselineLevelAllowlist({ actualLevelIds: ['crystal-corridor'], allowedLevelIds: ['crystal-corridor', 'helios'] }),
  /missing allowlisted level\(s\): helios/,
);
assert.throws(() => levelIdsFromRegistry('export const levels = [];'), /Could not read levelMetadatas/);

console.log('Entrant baseline allowlist tests passed.');
