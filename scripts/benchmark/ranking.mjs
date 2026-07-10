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
  SHA256_PATTERN,
  SLOT_PATTERN,
  writeJson,
} from './common.mjs';

const PROJECTION_KEYS = new Set(['benchmarkVersion', 'themes']);
const PROJECTION_THEME_KEYS = new Set(['id', 'slotIds']);
const PAIR_SCHEDULE_KEYS = new Set(['schemaVersion', 'benchmarkVersion', 'generatedAt', 'randomization', 'pairs']);
const PAIR_KEYS = new Set(['rankingId', 'themeId', 'pairSlotIds', 'presentationOrder']);
const RANKING_KEYS = new Set(['schemaVersion', 'benchmarkVersion', 'rankingId', 'themeId', 'pairSlotIds', 'presentationOrder', 'playCounts', 'verdict', 'winnerSlotId', 'notes', 'recordedAt']);
const SET_SCHEDULE_KEYS = new Set(['schemaVersion', 'benchmarkVersion', 'generatedAt', 'randomization', 'sets']);
const SET_KEYS = new Set(['rankingId', 'themeId', 'slotIds', 'presentationOrder']);
const SET_RANKING_KEYS = new Set(['schemaVersion', 'benchmarkVersion', 'rankingId', 'themeId', 'slotIds', 'presentationOrder', 'playCounts', 'tiers', 'notes', 'recordedAt']);
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function validateProjection(projection) {
  const errors = [];
  if (!isPlainObject(projection)) return ['Playable projection must be an object.'];
  assertAllowedKeys(projection, PROJECTION_KEYS, 'projection', errors);
  if (!/^v[1-9][0-9]*$/.test(projection.benchmarkVersion ?? '')) errors.push('projection.benchmarkVersion must be v<number>.');
  if (!Array.isArray(projection.themes) || projection.themes.length === 0) {
    errors.push('projection.themes must be a non-empty array.');
    return errors;
  }
  const themes = new Set();
  const slots = new Set();
  for (const [index, theme] of projection.themes.entries()) {
    const label = `projection.themes[${index}]`;
    if (!isPlainObject(theme)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    assertAllowedKeys(theme, PROJECTION_THEME_KEYS, label, errors);
    if (typeof theme.id !== 'string' || !ID_PATTERN.test(theme.id)) errors.push(`${label}.id has an invalid format.`);
    if (themes.has(theme.id)) errors.push(`${label}.id duplicates ${theme.id}.`);
    themes.add(theme.id);
    if (!Array.isArray(theme.slotIds)) {
      errors.push(`${label}.slotIds must be an array.`);
      continue;
    }
    for (const slotId of theme.slotIds) {
      if (typeof slotId !== 'string' || !SLOT_PATTERN.test(slotId)) errors.push(`${label}.slotIds contains an invalid slot.`);
      if (slots.has(slotId)) errors.push(`${label}.slotIds repeats slot ${slotId} across themes.`);
      slots.add(slotId);
    }
  }
  return errors;
}

export function createPairSchedule(projection, random = randomBytes) {
  const errors = validateProjection(projection);
  if (errors.length) throw new Error(`Invalid playable projection:\n${formatErrors(errors)}`);
  const pairs = [];
  const rankingIds = new Set();
  for (const theme of projection.themes) {
    for (let left = 0; left < theme.slotIds.length; left += 1) {
      for (let right = left + 1; right < theme.slotIds.length; right += 1) {
        const pairSlotIds = [theme.slotIds[left], theme.slotIds[right]];
        const presentationOrder = random(1)[0] % 2 === 0 ? [...pairSlotIds] : [...pairSlotIds].reverse();
        pairs.push({
          rankingId: `pair-${uniqueOpaqueId(12, rankingIds, random)}`,
          themeId: theme.id,
          pairSlotIds,
          presentationOrder,
        });
      }
    }
  }
  shuffle(pairs, random);
  return {
    schemaVersion: 1,
    benchmarkVersion: projection.benchmarkVersion,
    generatedAt: new Date().toISOString(),
    randomization: { method: 'cryptographic-shuffle' },
    pairs,
  };
}

export function extendPairSchedule(pairSchedule, projection, random = randomBytes) {
  const projectionErrors = validateProjection(projection);
  if (projectionErrors.length) throw new Error(`Invalid playable projection:\n${formatErrors(projectionErrors)}`);
  if (!isPlainObject(pairSchedule) || !Array.isArray(pairSchedule.pairs)) throw new Error('Invalid existing pair schedule.');
  if (pairSchedule.benchmarkVersion !== projection.benchmarkVersion) throw new Error('Existing pair schedule benchmarkVersion does not match the projection.');
  const expected = expectedPairs(projection);
  const observed = new Set();
  const rankingIds = new Set();
  for (const pair of pairSchedule.pairs) {
    const key = keyForPair(pair.themeId, pair.pairSlotIds);
    if (!expected.has(key)) throw new Error('Pair schedule extension projections may not remove an existing slot or theme.');
    observed.add(key);
    rankingIds.add(pair.rankingId.replace(/^pair-/, ''));
  }
  const additions = [];
  for (const [key, pair] of expected) {
    if (observed.has(key)) continue;
    const presentationOrder = random(1)[0] % 2 === 0 ? [...pair.pairSlotIds] : [...pair.pairSlotIds].reverse();
    additions.push({ rankingId: `pair-${uniqueOpaqueId(12, rankingIds, random)}`, ...pair, presentationOrder });
  }
  shuffle(additions, random);
  const extended = { ...pairSchedule, pairs: [...pairSchedule.pairs, ...additions] };
  const errors = validatePairSchedule(extended, projection);
  if (errors.length) throw new Error(`Extended pair schedule is invalid:\n${formatErrors(errors)}`);
  return extended;
}

export function createSetSchedule(projection, random = randomBytes) {
  const errors = validateProjection(projection);
  if (errors.length) throw new Error(`Invalid playable projection:\n${formatErrors(errors)}`);
  const rankingIds = new Set();
  const sets = projection.themes.filter((theme) => theme.slotIds.length >= 2).map((theme) => {
    const presentationOrder = [...theme.slotIds];
    shuffle(presentationOrder, random);
    return {
      rankingId: `set-${uniqueOpaqueId(12, rankingIds, random)}`,
      themeId: theme.id,
      slotIds: [...theme.slotIds],
      presentationOrder,
    };
  });
  shuffle(sets, random);
  return {
    schemaVersion: 1,
    benchmarkVersion: projection.benchmarkVersion,
    generatedAt: new Date().toISOString(),
    randomization: { method: 'cryptographic-shuffle' },
    sets,
  };
}

export function validateSetSchedule(setSchedule, projection) {
  const errors = [...validateProjection(projection)];
  if (!isPlainObject(setSchedule)) return [...errors, 'Set schedule must be an object.'];
  assertAllowedKeys(setSchedule, SET_SCHEDULE_KEYS, 'setSchedule', errors);
  if (setSchedule.schemaVersion !== 1) errors.push('setSchedule.schemaVersion must equal 1.');
  if (setSchedule.benchmarkVersion !== projection.benchmarkVersion) errors.push('setSchedule.benchmarkVersion does not match the projection.');
  if (!isIsoDate(setSchedule.generatedAt)) errors.push('setSchedule.generatedAt must be an ISO date-time.');
  if (!isPlainObject(setSchedule.randomization) || setSchedule.randomization.method !== 'cryptographic-shuffle') errors.push('setSchedule.randomization must record cryptographic-shuffle.');
  if (!Array.isArray(setSchedule.sets)) return [...errors, 'setSchedule.sets must be an array.'];
  const expected = new Map(projection.themes.filter((theme) => theme.slotIds.length >= 2).map((theme) => [theme.id, theme.slotIds]));
  const seenThemes = new Set();
  const rankingIds = new Set();
  for (const [index, set] of setSchedule.sets.entries()) {
    const label = `setSchedule.sets[${index}]`;
    if (!isPlainObject(set)) { errors.push(`${label} must be an object.`); continue; }
    assertAllowedKeys(set, SET_KEYS, label, errors);
    if (typeof set.rankingId !== 'string' || !set.rankingId) errors.push(`${label}.rankingId must be non-empty.`);
    if (rankingIds.has(set.rankingId)) errors.push(`${label}.rankingId duplicates ${set.rankingId}.`);
    rankingIds.add(set.rankingId);
    if (!expected.has(set.themeId)) errors.push(`${label}.themeId is not an expected playable theme.`);
    if (seenThemes.has(set.themeId)) errors.push(`${label}.themeId duplicates ${set.themeId}.`);
    seenThemes.add(set.themeId);
    validateSlotSet(set.slotIds, `${label}.slotIds`, errors);
    validateSlotSet(set.presentationOrder, `${label}.presentationOrder`, errors);
    if (!sameSlots(set.slotIds, expected.get(set.themeId))) errors.push(`${label}.slotIds do not match the playable projection.`);
    if (!sameSlots(set.slotIds, set.presentationOrder)) errors.push(`${label}.presentationOrder must contain the same slots.`);
  }
  if (setSchedule.sets.length !== expected.size) errors.push(`setSchedule.sets must contain ${expected.size} set(s).`);
  for (const themeId of expected.keys()) if (!seenThemes.has(themeId)) errors.push(`Set schedule is missing theme ${themeId}.`);
  return errors;
}

export function validateSetRankings(rankings, setSchedule, projection) {
  const errors = [...validateSetSchedule(setSchedule, projection)];
  if (!Array.isArray(rankings)) return [...errors, 'Rankings must be an array.'];
  const scheduled = new Map(setSchedule.sets.map((set) => [set.rankingId, set]));
  const seen = new Set();
  for (const [index, ranking] of rankings.entries()) {
    const label = `rankings[${index}]`;
    if (!isPlainObject(ranking)) { errors.push(`${label} must be an object.`); continue; }
    assertAllowedKeys(ranking, SET_RANKING_KEYS, label, errors);
    if (ranking.schemaVersion !== 1) errors.push(`${label}.schemaVersion must equal 1.`);
    if (ranking.benchmarkVersion !== projection.benchmarkVersion) errors.push(`${label}.benchmarkVersion does not match the projection.`);
    const set = scheduled.get(ranking.rankingId);
    if (!set) { errors.push(`${label}.rankingId is not in the set schedule.`); continue; }
    if (seen.has(ranking.rankingId)) errors.push(`${label}.rankingId is duplicated.`);
    seen.add(ranking.rankingId);
    if (ranking.themeId !== set.themeId) errors.push(`${label}.themeId does not match its scheduled set.`);
    if (!sameArray(ranking.presentationOrder, set.presentationOrder)) errors.push(`${label}.presentationOrder does not match its scheduled set.`);
    if (!sameSlots(ranking.slotIds, set.slotIds)) errors.push(`${label}.slotIds do not match its scheduled set.`);
    validateSetPlayCounts(ranking.playCounts, set.slotIds, label, errors);
    validateTiers(ranking.tiers, set.slotIds, label, errors);
    if (!isIsoDate(ranking.recordedAt)) errors.push(`${label}.recordedAt must be an ISO date-time.`);
  }
  if (rankings.length !== scheduled.size) errors.push(`Expected ${scheduled.size} ranked-set record(s), found ${rankings.length}.`);
  for (const rankingId of scheduled.keys()) if (!seen.has(rankingId)) errors.push(`Missing ranking record ${rankingId}.`);
  return errors;
}

export function validatePairSchedule(pairSchedule, projection) {
  const errors = [...validateProjection(projection)];
  if (!isPlainObject(pairSchedule)) return [...errors, 'Pair schedule must be an object.'];
  assertAllowedKeys(pairSchedule, PAIR_SCHEDULE_KEYS, 'pairSchedule', errors);
  if (pairSchedule.schemaVersion !== 1) errors.push('pairSchedule.schemaVersion must equal 1.');
  if (pairSchedule.benchmarkVersion !== projection.benchmarkVersion) errors.push('pairSchedule.benchmarkVersion does not match the projection.');
  if (!isIsoDate(pairSchedule.generatedAt)) errors.push('pairSchedule.generatedAt must be an ISO date-time.');
  if (!isPlainObject(pairSchedule.randomization) || pairSchedule.randomization.method !== 'cryptographic-shuffle') errors.push('pairSchedule.randomization must record cryptographic-shuffle.');
  if (!Array.isArray(pairSchedule.pairs)) {
    errors.push('pairSchedule.pairs must be an array.');
    return errors;
  }
  const expected = expectedPairs(projection);
  const observed = new Set();
  const rankingIds = new Set();
  for (const [index, pair] of pairSchedule.pairs.entries()) {
    const label = `pairSchedule.pairs[${index}]`;
    if (!isPlainObject(pair)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    assertAllowedKeys(pair, PAIR_KEYS, label, errors);
    if (typeof pair.rankingId !== 'string' || pair.rankingId.length === 0) errors.push(`${label}.rankingId must be non-empty.`);
    if (rankingIds.has(pair.rankingId)) errors.push(`${label}.rankingId duplicates ${pair.rankingId}.`);
    rankingIds.add(pair.rankingId);
    const pairKey = keyForPair(pair.themeId, pair.pairSlotIds);
    if (!expected.has(pairKey)) errors.push(`${label} is not an expected playable same-theme pair.`);
    if (observed.has(pairKey)) errors.push(`${label} duplicates a pair.`);
    observed.add(pairKey);
    validatePairFields(pair, label, errors);
  }
  if (pairSchedule.pairs.length !== expected.size) errors.push(`pairSchedule.pairs must contain ${expected.size} pair(s).`);
  for (const pairKey of expected.keys()) if (!observed.has(pairKey)) errors.push('Pair schedule is missing an expected playable pair.');
  return errors;
}

export function validateRankings(rankings, pairSchedule, projection) {
  const errors = [...validatePairSchedule(pairSchedule, projection)];
  if (!Array.isArray(rankings)) return [...errors, 'Rankings must be an array.'];
  const pairs = new Map(pairSchedule.pairs.map((pair) => [pair.rankingId, pair]));
  const seen = new Set();
  for (const [index, ranking] of rankings.entries()) {
    const label = `rankings[${index}]`;
    if (!isPlainObject(ranking)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    assertAllowedKeys(ranking, RANKING_KEYS, label, errors);
    if (ranking.schemaVersion !== 1) errors.push(`${label}.schemaVersion must equal 1.`);
    if (ranking.benchmarkVersion !== projection.benchmarkVersion) errors.push(`${label}.benchmarkVersion does not match the projection.`);
    const scheduledPair = pairs.get(ranking.rankingId);
    if (!scheduledPair) {
      errors.push(`${label}.rankingId is not in the pair schedule.`);
      continue;
    }
    if (seen.has(ranking.rankingId)) errors.push(`${label}.rankingId is duplicated.`);
    seen.add(ranking.rankingId);
    if (ranking.themeId !== scheduledPair.themeId) errors.push(`${label}.themeId does not match its scheduled pair.`);
    if (!sameSlots(ranking.pairSlotIds, scheduledPair.pairSlotIds)) errors.push(`${label}.pairSlotIds do not match its scheduled pair.`);
    if (!sameSlots(ranking.presentationOrder, scheduledPair.presentationOrder) || !sameArray(ranking.presentationOrder, scheduledPair.presentationOrder)) errors.push(`${label}.presentationOrder does not match its scheduled pair.`);
    validatePairFields(ranking, label, errors);
    validatePlayCounts(ranking.playCounts, scheduledPair.pairSlotIds, label, errors);
    if (!['preference', 'tie'].includes(ranking.verdict)) errors.push(`${label}.verdict must be preference or tie.`);
    if (ranking.verdict === 'preference') {
      if (!scheduledPair.pairSlotIds.includes(ranking.winnerSlotId)) errors.push(`${label}.winnerSlotId must be one of the compared slots.`);
    }
    if (ranking.verdict === 'tie' && Object.hasOwn(ranking, 'winnerSlotId')) errors.push(`${label}.winnerSlotId must be absent for a tie.`);
    if (!isIsoDate(ranking.recordedAt)) errors.push(`${label}.recordedAt must be an ISO date-time.`);
  }
  if (rankings.length !== pairs.size) errors.push(`Expected ${pairs.size} ranking record(s), found ${rankings.length}.`);
  for (const rankingId of pairs.keys()) if (!seen.has(rankingId)) errors.push(`Missing ranking record ${rankingId}.`);
  return errors;
}

function expectedPairs(projection) {
  const pairs = new Map();
  for (const theme of projection.themes ?? []) {
    for (let left = 0; left < theme.slotIds.length; left += 1) {
      for (let right = left + 1; right < theme.slotIds.length; right += 1) {
        const pairSlotIds = [theme.slotIds[left], theme.slotIds[right]];
        pairs.set(keyForPair(theme.id, pairSlotIds), { themeId: theme.id, pairSlotIds });
      }
    }
  }
  return pairs;
}

function validatePairFields(pair, label, errors) {
  if (typeof pair.themeId !== 'string' || !ID_PATTERN.test(pair.themeId)) errors.push(`${label}.themeId has an invalid format.`);
  for (const field of ['pairSlotIds', 'presentationOrder']) {
    if (!Array.isArray(pair[field]) || pair[field].length !== 2 || !pair[field].every((slot) => typeof slot === 'string' && SLOT_PATTERN.test(slot)) || new Set(pair[field]).size !== 2) {
      errors.push(`${label}.${field} must contain two unique opaque slots.`);
    }
  }
  if (!sameSlots(pair.pairSlotIds, pair.presentationOrder)) errors.push(`${label}.presentationOrder must contain the pair slots.`);
}

function validatePlayCounts(playCounts, pairSlotIds, label, errors) {
  if (!Array.isArray(playCounts) || playCounts.length !== 2) {
    errors.push(`${label}.playCounts must contain two records.`);
    return;
  }
  const slots = new Set();
  for (const [index, entry] of playCounts.entries()) {
    if (!isPlainObject(entry) || typeof entry.slotId !== 'string' || !pairSlotIds.includes(entry.slotId) || !Number.isInteger(entry.count) || entry.count < 1) {
      errors.push(`${label}.playCounts[${index}] is invalid.`);
      continue;
    }
    slots.add(entry.slotId);
  }
  if (slots.size !== 2) errors.push(`${label}.playCounts must cover each compared slot exactly once.`);
}

function validateSlotSet(slotIds, label, errors) {
  if (!Array.isArray(slotIds) || slotIds.length < 2 || !slotIds.every((slot) => typeof slot === 'string' && SLOT_PATTERN.test(slot)) || new Set(slotIds).size !== slotIds.length) {
    errors.push(`${label} must contain at least two unique opaque slots.`);
  }
}

function validateSetPlayCounts(playCounts, slotIds, label, errors) {
  if (!Array.isArray(playCounts) || playCounts.length !== slotIds.length) { errors.push(`${label}.playCounts must cover every slot.`); return; }
  const seen = new Set();
  for (const [index, entry] of playCounts.entries()) {
    if (!isPlainObject(entry) || !slotIds.includes(entry.slotId) || !Number.isInteger(entry.count) || entry.count < 1 || seen.has(entry.slotId)) errors.push(`${label}.playCounts[${index}] is invalid.`);
    else seen.add(entry.slotId);
  }
}

function validateTiers(tiers, slotIds, label, errors) {
  if (!Array.isArray(tiers) || tiers.length === 0) { errors.push(`${label}.tiers must contain one or more ordered tiers.`); return; }
  const seen = new Set();
  for (const [index, tier] of tiers.entries()) {
    if (!Array.isArray(tier) || tier.length === 0) { errors.push(`${label}.tiers[${index}] must be a non-empty slot array.`); continue; }
    for (const slotId of tier) {
      if (!slotIds.includes(slotId) || seen.has(slotId)) errors.push(`${label}.tiers[${index}] contains an invalid or repeated slot.`);
      else seen.add(slotId);
    }
  }
  if (seen.size !== slotIds.length) errors.push(`${label}.tiers must rank every slot exactly once.`);
}

function keyForPair(themeId, slotIds) {
  if (!Array.isArray(slotIds)) return `${themeId}\u0000invalid`;
  return `${themeId}\u0000${[...slotIds].sort().join('\u0000')}`;
}

function sameSlots(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && [...left].sort().join('\u0000') === [...right].sort().join('\u0000');
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.every((value, index) => value === right[index]);
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

async function loadRankings(inputPath) {
  const stats = await fs.stat(inputPath);
  if (stats.isFile()) {
    const value = await readJson(inputPath);
    return Array.isArray(value) ? value : [value];
  }
  const names = (await fs.readdir(inputPath)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map((name) => readJson(path.join(inputPath, name))));
}

async function main() {
  const { rest, options } = parseArgs(process.argv.slice(2), { positional: true });
  if (options.help || rest.length === 0) {
    console.log('Usage:\n  npm run benchmark:ranking -- sets --projection <private-json> --out <private-json>\n  npm run benchmark:ranking -- validate-sets --projection <private-json> --sets <private-json> --rankings <private-file-or-dir>\n  npm run benchmark:ranking -- pairs --projection <private-json> --out <private-json>\n  npm run benchmark:ranking -- extend-pairs --projection <private-json> --pairs <private-json> --out <private-json>\n  npm run benchmark:ranking -- validate --projection <private-json> --pairs <private-json> --rankings <private-file-or-dir>');
    return;
  }
  assertOnlyOptions(options, new Set(['help', 'projection', 'out', 'pairs', 'sets', 'rankings']));
  const command = rest[0];
  if (rest.length !== 1 || !['sets', 'validate-sets', 'pairs', 'extend-pairs', 'validate'].includes(command)) throw new Error(`Unknown ranking command: ${rest.join(' ')}.`);
  const projection = await readJson(requireOption(options, 'projection'));
  if (command === 'sets') {
    const outputPath = assertPrivateOrExternalPath(requireOption(options, 'out'));
    const setSchedule = createSetSchedule(projection);
    const errors = validateSetSchedule(setSchedule, projection);
    if (errors.length) throw new Error(`Generated invalid set schedule:\n${formatErrors(errors)}`);
    await writeJson(outputPath, setSchedule);
    console.log(`Generated ${setSchedule.sets.length} slot-only ranked set(s).`);
    return;
  }
  if (command === 'validate-sets') {
    const setSchedule = await readJson(requireOption(options, 'sets'));
    const rankings = await loadRankings(requireOption(options, 'rankings'));
    const errors = validateSetRankings(rankings, setSchedule, projection);
    if (errors.length) throw new Error(`Invalid ranked-set records:\n${formatErrors(errors)}`);
    console.log(`Validated ${rankings.length} slot-only ranked-set record(s).`);
    return;
  }
  if (command === 'pairs') {
    const outputPath = assertPrivateOrExternalPath(requireOption(options, 'out'));
    const pairSchedule = createPairSchedule(projection);
    const errors = validatePairSchedule(pairSchedule, projection);
    if (errors.length) throw new Error(`Generated invalid pair schedule:\n${formatErrors(errors)}`);
    await writeJson(outputPath, pairSchedule);
    console.log(`Generated ${pairSchedule.pairs.length} slot-only ranking pair(s).`);
    return;
  }
  if (command === 'extend-pairs') {
    const pairSchedule = await readJson(requireOption(options, 'pairs'));
    const outputPath = assertPrivateOrExternalPath(requireOption(options, 'out'));
    const extended = extendPairSchedule(pairSchedule, projection);
    await writeJson(outputPath, extended);
    console.log(`Preserved ${pairSchedule.pairs.length} and added ${extended.pairs.length - pairSchedule.pairs.length} slot-only pair(s).`);
    return;
  }
  const pairSchedule = await readJson(requireOption(options, 'pairs'));
  const rankings = await loadRankings(requireOption(options, 'rankings'));
  const errors = validateRankings(rankings, pairSchedule, projection);
  if (errors.length) throw new Error(`Invalid ranking set:\n${formatErrors(errors)}`);
  console.log(`Validated ${rankings.length} slot-only ranking record(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
