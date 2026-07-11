#!/usr/bin/env node
/**
 * Build and validate the small, deliberately boring public benchmark catalog.
 *
 * This module is intentionally independent of the web app.  It is the boundary
 * between redacted benchmark records and the two public projections consumed by
 * the comparison UI.  Keep private run records out of this command.
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DOWNPOUR_REHEARSAL_IDS = ['downpour-7snm', 'downpour-hlht', 'downpour-ou7e', 'downpour-f2e6', 'downpour-wpxk'];
export const THUMBNAIL_DEFAULTS = Object.freeze({ seed: 424242, width: 1280, height: 720, thumbWidth: 320, columns: 4, immortal: true, projectiles: false });

const FORBIDDEN_PRE_VOTE_KEYS = /^(configuration|config|model|models|workflow|recipe|cost|costUsd|manifestRef|manifest|provider|snapshot|runner|executor|sourceCommit|generation)/i;
const IDENTITY_HINT = /(?:^|[-_/])(?:codex|claude|gpt(?:[-_]?\d)?|sonnet|opus|terra|sol|delegat(?:ed|ion)?|workflow|model|solo)(?:$|[-_/.])/i;
const HEX64 = /^[a-f0-9]{64}$/;

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export function validateCatalog(catalog, { mode = catalog?.mode ?? 'production', root = ROOT, requireDownpourFixture = false } = {}) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return ['catalog must be an object'];
  if (catalog.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!Array.isArray(catalog.themes) || catalog.themes.length === 0) errors.push('themes must be a non-empty array');
  if (!Array.isArray(catalog.entrants) || catalog.entrants.length === 0) errors.push('entrants must be a non-empty array');
  const themeIds = new Set((catalog.themes ?? []).map((theme) => theme?.id));
  const entrantIds = new Set();
  for (const [index, entrant] of (catalog.entrants ?? []).entries()) {
    const at = `entrants[${index}]`;
    if (!entrant || typeof entrant !== 'object' || Array.isArray(entrant)) { errors.push(`${at} must be an object`); continue; }
    const id = entrant.opaqueEntrantId;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,80}$/i.test(id)) errors.push(`${at}.opaqueEntrantId must be a stable opaque id`);
    else if (entrantIds.has(id)) errors.push(`duplicate opaqueEntrantId ${id}`);
    else entrantIds.add(id);
    if (typeof entrant.themeId !== 'string' || !themeIds.has(entrant.themeId)) errors.push(`${at}.themeId must refer to a public theme`);
    if (typeof entrant.levelId !== 'string' || entrant.levelId.length === 0) errors.push(`${at}.levelId is required`);
    if (typeof entrant.playableRef !== 'string' || entrant.playableRef.length === 0) errors.push(`${at}.playableRef is required`);
    if (mode === 'production' && (entrant.opaqueEntrantId === entrant.levelId || entrant.playableRef === entrant.levelId)) errors.push(`${at} must not expose its integrated levelId as a public id`);
    if (mode === 'production' && (IDENTITY_HINT.test(String(id)) || IDENTITY_HINT.test(String(entrant.playableRef)))) errors.push(`${at} public ids must not contain model/workflow identity hints`);
    if (entrant.playable !== true) errors.push(`${at} must be marked playable`);
    if (!['eligible', 'rehearsal'].includes(entrant.eligibility)) errors.push(`${at}.eligibility must be eligible or rehearsal`);
    if (entrant.disposition !== 'playable') errors.push(`${at}.disposition must be playable`);
    validateThumbnail(entrant.thumbnail, at, errors, { mode, root, levelId: entrant.levelId });
    validateReveal(entrant.reveal, at, errors);
    if (mode === 'production' && entrant.eligibility !== 'eligible') errors.push(`${at} rehearsal/ineligible entrant is forbidden in production`);
    if (mode === 'production' && entrant.disposition !== 'playable') errors.push(`${at} DNF/non-playable entrant is forbidden in production`);
  }
  if (mode === 'production') {
    if (catalog.mode === 'development' || catalog.benchmarkVersion === 'rehearsal') errors.push('rehearsal catalog cannot be built in production');
    if ((catalog.entrants ?? []).some((entrant) => entrant.thumbnail?.status !== 'actual')) errors.push('production catalog requires every thumbnail asset to be actual');
  }
  if (requireDownpourFixture || (mode === 'development' && catalog.fixture === 'downpour-rehearsal')) {
    const ids = [...entrantIds].sort();
    const expected = [...DOWNPOUR_REHEARSAL_IDS].sort();
    if (JSON.stringify(ids) !== JSON.stringify(expected)) errors.push(`Downpour development fixture must contain exactly ${DOWNPOUR_REHEARSAL_IDS.join(', ')}`);
    if ((catalog.themes ?? []).filter((theme) => theme.id === 'downpour').length !== 1) errors.push('Downpour development fixture requires one downpour theme');
    if ((catalog.entrants ?? []).some((entrant) => entrant.themeId !== 'downpour' || entrant.eligibility !== 'rehearsal')) errors.push('Downpour fixture entrants must all be rehearsal Downpour entries');
  }
  return errors;
}

function validateThumbnail(thumbnail, at, errors, { mode, root, levelId }) {
  if (!thumbnail || typeof thumbnail !== 'object') { errors.push(`${at}.thumbnail is required`); return; }
  if (!['actual', 'placeholder'].includes(thumbnail.status)) errors.push(`${at}.thumbnail.status must be actual or placeholder`);
  if (typeof thumbnail.path !== 'string' || thumbnail.path.length === 0) errors.push(`${at}.thumbnail.path is required`);
  else if (thumbnail.path.toLowerCase().includes(String(levelId).toLowerCase())) errors.push(`${at}.thumbnail.path must use an opaque asset id, not levelId`);
  if (mode === 'production' && IDENTITY_HINT.test(String(thumbnail.path))) errors.push(`${at}.thumbnail.path must not contain model/workflow identity hints`);
  const metadata = thumbnail.metadata;
  if (!metadata || typeof metadata !== 'object') { errors.push(`${at}.thumbnail.metadata is required`); return; }
  for (const key of ['seed', 'width', 'height', 'thumbWidth', 'columns']) if (!Number.isInteger(metadata[key])) errors.push(`${at}.thumbnail.metadata.${key} must be an integer`);
  for (const [key, value] of Object.entries(THUMBNAIL_DEFAULTS)) if (metadata[key] !== value) errors.push(`${at}.thumbnail.metadata.${key} must be ${JSON.stringify(value)}`);
  if (typeof metadata.fidelity !== 'string' || !['auto', 'full', 'postless', 'flat', 'mixed'].includes(metadata.fidelity)) errors.push(`${at}.thumbnail.metadata.fidelity must record the resolved fidelity`);
  if (!Array.isArray(metadata.frameFidelities) || metadata.frameFidelities.length !== 4 || metadata.frameFidelities.some((fidelity) => !['full', 'postless', 'flat'].includes(fidelity))) errors.push(`${at}.thumbnail.metadata.frameFidelities must record four resolved fidelities`);
  if (!Array.isArray(metadata.times) || metadata.times.length !== 4 || metadata.times.some((time) => typeof time !== 'number' || !Number.isFinite(time))) errors.push(`${at}.thumbnail.metadata.times must contain exactly four times`);
  else if (metadata.times.some((time, i) => i > 0 && time <= metadata.times[i - 1])) errors.push(`${at}.thumbnail.metadata.times must be strictly increasing`);
  if (thumbnail.status === 'actual') {
    if (!HEX64.test(thumbnail.sha256 ?? '')) errors.push(`${at}.thumbnail.sha256 must be a SHA-256 hash for an actual asset`);
    const relative = thumbnail.path.replace(/^\//, '');
    const assetPath = path.resolve(root, 'public', relative);
    const legacyAssetPath = path.resolve(root, relative);
    if (!existsSync(assetPath) && !existsSync(legacyAssetPath)) errors.push(`${at}.thumbnail asset is missing: ${thumbnail.path}`);
  } else if (thumbnail.sha256 !== null && thumbnail.sha256 !== undefined) errors.push(`${at}.thumbnail placeholder must not claim an asset hash`);
  if (mode === 'production' && thumbnail.status === 'placeholder') errors.push(`${at}.thumbnail placeholder is development-only`);
}

function validateReveal(reveal, at, errors) {
  if (!reveal || typeof reveal !== 'object') { errors.push(`${at}.reveal is required`); return; }
  for (const key of ['configuration', 'model', 'workflow', 'costUsd', 'manifestRef']) if (!(key in reveal)) errors.push(`${at}.reveal.${key} is required`);
  if (typeof reveal.configuration !== 'string' || typeof reveal.model !== 'string' || typeof reveal.workflow !== 'string' || typeof reveal.manifestRef !== 'string') errors.push(`${at}.reveal identity fields must be strings`);
  if (typeof reveal.costUsd !== 'number' || reveal.costUsd < 0) errors.push(`${at}.reveal.costUsd must be a non-negative number`);
}

export function assertNoIdentityLeak(projection) {
  const leaks = [];
  function visit(value, keyPath = '') {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${keyPath}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_PRE_VOTE_KEYS.test(key)) leaks.push(`${keyPath}.${key}`);
      visit(child, `${keyPath}.${key}`);
    }
  }
  visit(projection);
  return leaks;
}

export function projectPreVote(catalog) {
  const projection = {
    schemaVersion: 1,
    projection: 'pre-vote',
    benchmarkVersion: catalog.benchmarkVersion,
    mode: catalog.mode,
    themes: (catalog.themes ?? []).map(({ id, title, summary, prompt }) => ({ id, title, summary, prompt })),
    entrants: (catalog.entrants ?? []).map((entrant) => ({
      opaqueEntrantId: entrant.opaqueEntrantId,
      themeId: entrant.themeId,
      playable: entrant.playable,
      playableRef: entrant.playableRef,
      thumbnail: { path: entrant.thumbnail.path, status: entrant.thumbnail.status, metadata: entrant.thumbnail.metadata },
    })),
  };
  const leaks = assertNoIdentityLeak(projection);
  if (leaks.length) throw new Error(`pre-vote projection leaks reveal metadata: ${leaks.join(', ')}`);
  return projection;
}

export function projectReveal(catalog) {
  return {
    schemaVersion: 1,
    projection: 'reveal',
    benchmarkVersion: catalog.benchmarkVersion,
    mode: catalog.mode,
    themes: catalog.themes,
    entrants: catalog.entrants,
  };
}

export async function buildCatalog({ sourcePath, outDir, mode = 'production', requireDownpourFixture = false }) {
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const errors = validateCatalog(source, { mode, root: ROOT, requireDownpourFixture });
  if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join('\n- ')}`);
  const preVote = projectPreVote(source);
  const reveal = projectReveal(source);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'catalog-pre-vote.json'), stableJson(preVote));
  await fs.writeFile(path.join(outDir, 'catalog-reveal.json'), stableJson(reveal));
  const manifest = { schemaVersion: 1, source: path.relative(ROOT, sourcePath), mode, preVoteSha256: sha256(stableJson(preVote)), revealSha256: sha256(stableJson(reveal)) };
  await fs.writeFile(path.join(outDir, 'catalog-manifest.json'), stableJson(manifest));
  return { preVote, reveal, manifest };
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function main() {
  const { command, source, out, mode, fixture } = parseArgs(process.argv.slice(2));
  if (command === 'validate') {
    const catalog = JSON.parse(await fs.readFile(source, 'utf8'));
    const errors = validateCatalog(catalog, { mode, root: ROOT, requireDownpourFixture: fixture });
    if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join('\n- ')}`);
    projectPreVote(catalog);
    console.log(`catalog valid mode=${mode} entrants=${catalog.entrants.length}`);
  } else if (command === 'build') {
    const result = await buildCatalog({ sourcePath: source, outDir: out, mode, requireDownpourFixture: fixture });
    console.log(`catalog built ${path.relative(ROOT, out)} preVoteSha256=${result.manifest.preVoteSha256} revealSha256=${result.manifest.revealSha256}`);
  } else throw new Error(`Unknown command '${command}' (use build or validate)`);
}

function parseArgs(argv) {
  const result = { command: argv[0] ?? 'validate', source: path.join(ROOT, 'benchmark/public/fixtures/downpour-rehearsal.json'), out: path.join(ROOT, 'public/catalog'), mode: 'production', fixture: false };
  let i = argv[0]?.startsWith('--') ? 0 : 1;
  for (; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') result.source = path.resolve(ROOT, argv[++i]);
    else if (arg === '--out') result.out = path.resolve(ROOT, argv[++i]);
    else if (arg === '--mode') { result.mode = argv[++i]; if (!['development', 'production'].includes(result.mode)) throw new Error('--mode must be development or production'); }
    else if (arg === '--fixture') result.fixture = true;
    else if (arg === '--help') { console.log('Usage: benchmark:catalog <build|validate> [--source file] [--out dir] [--mode development|production] [--fixture]'); process.exit(0); }
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
  }
  return result;
}
