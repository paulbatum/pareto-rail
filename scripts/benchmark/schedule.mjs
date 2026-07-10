#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertAllowedKeys,
  assertOnlyOptions,
  assertPrivateOrExternalPath,
  formatErrors,
  ID_PATTERN,
  isPlainObject,
  parseArgs,
  readJson,
  requireOption,
  RUN_ID_PATTERN,
  SHA256_PATTERN,
  SLOT_PATTERN,
  sha256,
  writeJson,
} from './common.mjs';

const SCHEDULE_KEYS = new Set(['schemaVersion', 'benchmarkVersion', 'generatedAt', 'randomization', 'assignments']);
const ASSIGNMENT_KEYS = new Set(['scheduleIndex', 'runId', 'slotId', 'configurationId', 'recipe', 'theme', 'levelId', 'levelTitle']);
const ARTIFACT_KEYS = new Set(['id', 'path', 'sha256']);
const THEME_KEYS = new Set(['id', 'path', 'sha256']);
const DEFINITION_KEYS = new Set(['benchmarkVersion', 'configurations', 'themes']);
const CONFIGURATION_KEYS = new Set(['id', 'recipe']);
const DEFINITION_THEME_KEYS = new Set(['id', 'path', 'sha256', 'levelTitle']);
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function validateDefinition(definition) {
  const errors = [];
  if (!isPlainObject(definition)) return ['Definition must be an object.'];
  assertAllowedKeys(definition, DEFINITION_KEYS, 'definition', errors);
  if (!/^v[1-9][0-9]*$/.test(definition.benchmarkVersion ?? '')) errors.push('definition.benchmarkVersion must be v<number>.');
  if (!Array.isArray(definition.configurations) || definition.configurations.length === 0) errors.push('definition.configurations must be a non-empty array.');
  if (!Array.isArray(definition.themes) || definition.themes.length === 0) errors.push('definition.themes must be a non-empty array.');

  const configurationIds = new Set();
  for (const [index, configuration] of (definition.configurations ?? []).entries()) {
    const label = `definition.configurations[${index}]`;
    if (!isPlainObject(configuration)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    assertAllowedKeys(configuration, CONFIGURATION_KEYS, label, errors);
    validateId(configuration.id, `${label}.id`, errors);
    if (configurationIds.has(configuration.id)) errors.push(`${label}.id duplicates ${configuration.id}.`);
    configurationIds.add(configuration.id);
    validateArtifact(configuration.recipe, `${label}.recipe`, errors);
  }

  const themeIds = new Set();
  for (const [index, theme] of (definition.themes ?? []).entries()) {
    const label = `definition.themes[${index}]`;
    if (!isPlainObject(theme)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    assertAllowedKeys(theme, DEFINITION_THEME_KEYS, label, errors);
    validateId(theme.id, `${label}.id`, errors);
    if (themeIds.has(theme.id)) errors.push(`${label}.id duplicates ${theme.id}.`);
    themeIds.add(theme.id);
    validateString(theme.path, `${label}.path`, errors);
    validateSha(theme.sha256, `${label}.sha256`, errors);
    validateString(theme.levelTitle, `${label}.levelTitle`, errors);
  }
  return errors;
}

export async function validateDefinitionFiles(definition, root = process.cwd()) {
  const errors = [];
  for (const [index, configuration] of (definition.configurations ?? []).entries()) {
    const label = `definition.configurations[${index}].recipe`;
    await validateArtifactFile(configuration.recipe, label, root, errors);
  }
  for (const [index, theme] of (definition.themes ?? []).entries()) {
    const label = `definition.themes[${index}]`;
    const source = await validateArtifactFile(theme, label, root, errors);
    if (source === undefined) continue;
    const title = firstLevelOneHeading(source);
    if (!title) errors.push(`${label}.path must contain a level-one heading.`);
    else if (title !== theme.levelTitle) errors.push(`${label}.levelTitle must equal its first level-one heading.`);
  }
  return errors;
}

export function createSchedule(definition, random = randomBytes) {
  const definitionErrors = validateDefinition(definition);
  if (definitionErrors.length) throw new Error(`Invalid schedule definition:\n${formatErrors(definitionErrors)}`);

  const assignments = [];
  const usedSlots = new Set();
  const usedRunIds = new Set();
  for (const configuration of definition.configurations) {
    for (const theme of definition.themes) {
      const slotId = uniqueOpaqueId(4, usedSlots, random);
      const runId = `run-${uniqueOpaqueId(12, usedRunIds, random)}`;
      assignments.push({
        runId,
        slotId,
        configurationId: configuration.id,
        recipe: { ...configuration.recipe },
        theme: { id: theme.id, path: theme.path, sha256: theme.sha256 },
        levelId: `${theme.id}-${slotId}`,
        levelTitle: theme.levelTitle,
      });
    }
  }
  shuffle(assignments, random);
  return {
    schemaVersion: 1,
    benchmarkVersion: definition.benchmarkVersion,
    generatedAt: new Date().toISOString(),
    randomization: { method: 'cryptographic-shuffle' },
    assignments: assignments.map((assignment, index) => ({ scheduleIndex: index + 1, ...assignment })),
  };
}

export function validateSchedule(schedule, definition) {
  const errors = [...validateDefinition(definition)];
  if (!isPlainObject(schedule)) return [...errors, 'Schedule must be an object.'];
  assertAllowedKeys(schedule, SCHEDULE_KEYS, 'schedule', errors);
  if (schedule.schemaVersion !== 1) errors.push('schedule.schemaVersion must equal 1.');
  if (schedule.benchmarkVersion !== definition.benchmarkVersion) errors.push('schedule.benchmarkVersion does not match the definition.');
  if (!isIsoDate(schedule.generatedAt)) errors.push('schedule.generatedAt must be an ISO date-time.');
  validateRandomization(schedule.randomization, errors);
  if (!Array.isArray(schedule.assignments)) {
    errors.push('schedule.assignments must be an array.');
    return errors;
  }

  const expectedPairs = new Map();
  for (const configuration of definition.configurations ?? []) {
    for (const theme of definition.themes ?? []) expectedPairs.set(`${configuration.id}\u0000${theme.id}`, { configuration, theme });
  }
  if (schedule.assignments.length !== expectedPairs.size) errors.push(`schedule.assignments must contain ${expectedPairs.size} configuration × theme assignments.`);

  const slots = new Set();
  const runIds = new Set();
  const indices = new Set();
  const actualPairs = new Set();
  for (const [index, assignment] of schedule.assignments.entries()) {
    const label = `schedule.assignments[${index}]`;
    if (!isPlainObject(assignment)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    assertAllowedKeys(assignment, ASSIGNMENT_KEYS, label, errors);
    if (!Number.isInteger(assignment.scheduleIndex) || assignment.scheduleIndex < 1) errors.push(`${label}.scheduleIndex must be a positive integer.`);
    if (indices.has(assignment.scheduleIndex)) errors.push(`${label}.scheduleIndex duplicates ${assignment.scheduleIndex}.`);
    indices.add(assignment.scheduleIndex);
    validateStringPattern(assignment.runId, RUN_ID_PATTERN, `${label}.runId`, errors);
    if (runIds.has(assignment.runId)) errors.push(`${label}.runId duplicates ${assignment.runId}.`);
    runIds.add(assignment.runId);
    validateStringPattern(assignment.slotId, SLOT_PATTERN, `${label}.slotId`, errors);
    if (slots.has(assignment.slotId)) errors.push(`${label}.slotId duplicates ${assignment.slotId}.`);
    slots.add(assignment.slotId);
    validateId(assignment.configurationId, `${label}.configurationId`, errors);
    validateArtifact(assignment.recipe, `${label}.recipe`, errors);
    validateTheme(assignment.theme, `${label}.theme`, errors);
    validateId(assignment.levelId, `${label}.levelId`, errors);
    validateString(assignment.levelTitle, `${label}.levelTitle`, errors);

    const pairKey = `${assignment.configurationId}\u0000${assignment.theme?.id}`;
    if (!expectedPairs.has(pairKey)) {
      errors.push(`${label} names an undeclared configuration/theme pair.`);
      continue;
    }
    if (actualPairs.has(pairKey)) errors.push(`${label} duplicates a configuration/theme pair.`);
    actualPairs.add(pairKey);
    const { configuration, theme } = expectedPairs.get(pairKey);
    if (!sameArtifact(assignment.recipe, configuration.recipe)) errors.push(`${label}.recipe does not match its configuration definition.`);
    if (!sameTheme(assignment.theme, theme)) errors.push(`${label}.theme does not match its theme definition.`);
    if (assignment.levelId !== `${theme.id}-${assignment.slotId}`) errors.push(`${label}.levelId must equal ${theme.id}-${assignment.slotId}.`);
    if (assignment.levelTitle !== theme.levelTitle) errors.push(`${label}.levelTitle does not match its theme definition.`);
  }
  for (let index = 1; index <= schedule.assignments.length; index += 1) {
    if (!indices.has(index)) errors.push(`scheduleIndex ${index} is missing.`);
  }
  for (const key of expectedPairs.keys()) if (!actualPairs.has(key)) errors.push('Schedule is missing a declared configuration/theme pair.');
  return errors;
}

async function validateArtifactFile(artifact, label, root, errors) {
  if (!isPlainObject(artifact) || typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string') return undefined;
  const artifactPath = path.resolve(root, artifact.path);
  let source;
  try {
    source = await fs.readFile(artifactPath, 'utf8');
  } catch {
    errors.push(`${label}.path cannot be read: ${artifact.path}.`);
    return undefined;
  }
  if (sha256(source) !== artifact.sha256) errors.push(`${label}.sha256 does not match ${artifact.path}.`);
  return source;
}

function firstLevelOneHeading(source) {
  const match = source.match(/^#\s+(.+?)\s*$/m);
  return match?.[1] ?? undefined;
}

function validateRandomization(randomization, errors) {
  if (!isPlainObject(randomization)) {
    errors.push('schedule.randomization must be an object.');
    return;
  }
  assertAllowedKeys(randomization, new Set(['method', 'seed', 'notes']), 'schedule.randomization', errors);
  if (!['cryptographic-shuffle', 'seeded-shuffle'].includes(randomization.method)) errors.push('schedule.randomization.method is invalid.');
  if (randomization.method === 'seeded-shuffle' && !randomization.seed) errors.push('A seeded shuffle requires randomization.seed.');
}

function validateArtifact(value, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an artifact object.`);
    return;
  }
  assertAllowedKeys(value, ARTIFACT_KEYS, label, errors);
  validateString(value.path, `${label}.path`, errors);
  validateSha(value.sha256, `${label}.sha256`, errors);
  if ('id' in value) validateString(value.id, `${label}.id`, errors);
}

function validateTheme(value, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be a theme object.`);
    return;
  }
  assertAllowedKeys(value, THEME_KEYS, label, errors);
  validateId(value.id, `${label}.id`, errors);
  validateString(value.path, `${label}.path`, errors);
  validateSha(value.sha256, `${label}.sha256`, errors);
}

function validateId(value, label, errors) {
  validateStringPattern(value, ID_PATTERN, label, errors);
}

function validateSha(value, label, errors) {
  validateStringPattern(value, SHA256_PATTERN, label, errors);
}

function validateString(value, label, errors) {
  if (typeof value !== 'string' || value.length === 0) errors.push(`${label} must be a non-empty string.`);
}

function validateStringPattern(value, pattern, label, errors) {
  if (typeof value !== 'string' || !pattern.test(value)) errors.push(`${label} has an invalid format.`);
}

function sameArtifact(left, right) {
  return left?.path === right?.path && left?.sha256 === right?.sha256 && left?.id === right?.id;
}

function sameTheme(left, right) {
  return left?.id === right?.id && left?.path === right?.path && left?.sha256 === right?.sha256;
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function uniqueOpaqueId(length, used, random) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bytes = random(length);
    let value = '';
    for (let index = 0; index < length; index += 1) value += ALPHABET[bytes[index] % ALPHABET.length];
    if (!used.has(value)) {
      used.add(value);
      return value;
    }
  }
  throw new Error('Could not generate a unique opaque identifier.');
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const randomIndex = random(4).readUInt32BE(0) % (index + 1);
    [values[index], values[randomIndex]] = [values[randomIndex], values[index]];
  }
}

async function main() {
  const { rest, options } = parseArgs(process.argv.slice(2), { positional: true });
  if (options.help || rest.length === 0) {
    console.log('Usage:\n  npm run benchmark:schedule -- create --definition <private-json> --out <private-json>\n  npm run benchmark:schedule -- validate --definition <private-json> --schedule <private-json>');
    return;
  }
  assertOnlyOptions(options, new Set(['help', 'definition', 'out', 'schedule']));
  const command = rest[0];
  if (rest.length !== 1 || !['create', 'validate'].includes(command)) throw new Error(`Unknown schedule command: ${rest.join(' ')}.`);
  const definition = await readJson(requireOption(options, 'definition'));
  const definitionFileErrors = await validateDefinitionFiles(definition);
  if (definitionFileErrors.length) throw new Error(`Invalid schedule definition files:\n${formatErrors(definitionFileErrors)}`);
  if (command === 'create') {
    const outputPath = assertPrivateOrExternalPath(requireOption(options, 'out'));
    const schedule = createSchedule(definition);
    const errors = validateSchedule(schedule, definition);
    if (errors.length) throw new Error(`Generated invalid schedule:\n${formatErrors(errors)}`);
    await writeJson(outputPath, schedule);
    console.log(`Generated and validated ${schedule.assignments.length} private assignments.`);
    return;
  }
  const schedule = await readJson(requireOption(options, 'schedule'));
  const errors = validateSchedule(schedule, definition);
  if (errors.length) throw new Error(`Invalid schedule:\n${formatErrors(errors)}`);
  console.log(`Validated ${schedule.assignments.length} private assignments.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
