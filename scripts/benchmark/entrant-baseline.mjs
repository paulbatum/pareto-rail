import { fail } from './common.mjs';

const REGISTRY_PATTERN = /export const levelMetadatas: LevelMetadata\[] = \[([\s\S]*?)\n\];/;
const LEVEL_ID_PATTERN = /\bid:\s*['"]([^'"]+)['"]/g;
const LEVEL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function levelIdsFromRegistry(source) {
  const registry = source.match(REGISTRY_PATTERN);
  if (!registry) fail('Could not read levelMetadatas from src/levels/index.ts in the entrant baseline.');

  const levelIds = [...registry[1].matchAll(LEVEL_ID_PATTERN)].map((match) => match[1]);
  if (levelIds.length === 0) fail('The entrant baseline level registry contains no level ids.');
  const duplicates = levelIds.filter((id, index) => levelIds.indexOf(id) !== index);
  if (duplicates.length) fail(`The entrant baseline level registry contains duplicate level ids: ${[...new Set(duplicates)].join(', ')}.`);
  return levelIds;
}

export function validateBaselineLevelAllowlist(allowedLevelIds) {
  if (!Array.isArray(allowedLevelIds) || allowedLevelIds.length === 0) return ['release.entrantBaseline.allowedLevelIds must be a non-empty array.'];
  const errors = [];
  const seen = new Set();
  for (const [index, levelId] of allowedLevelIds.entries()) {
    const label = `release.entrantBaseline.allowedLevelIds[${index}]`;
    if (typeof levelId !== 'string' || !LEVEL_ID.test(levelId)) errors.push(`${label} must be a valid level id.`);
    else if (seen.has(levelId)) errors.push(`${label} duplicates ${levelId}.`);
    else seen.add(levelId);
  }
  return errors;
}

export function assertBaselineLevelAllowlist({ actualLevelIds, allowedLevelIds, guide = 'benchmark/releases/README.md' }) {
  const errors = validateBaselineLevelAllowlist(allowedLevelIds);
  if (errors.length) fail(`Invalid entrant baseline allowlist:\n${errors.map((error) => `- ${error}`).join('\n')}`);

  const allowed = new Set(allowedLevelIds);
  const actual = new Set(actualLevelIds);
  const unexpected = actualLevelIds.filter((levelId) => !allowed.has(levelId));
  const missing = allowedLevelIds.filter((levelId) => !actual.has(levelId));
  if (!unexpected.length && !missing.length) return;

  const details = [
    ...(unexpected.length ? [`unallowlisted level(s): ${unexpected.join(', ')}`] : []),
    ...(missing.length ? [`missing allowlisted level(s): ${missing.join(', ')}`] : []),
  ].join('; ');
  fail(`Entrant baseline level allowlist mismatch (${details}). Refusing to start an eligible benchmark run. Cut and freeze a clean entrant baseline as described in ${guide}.`);
}
