#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { protocolForVersion, DIRECTORY_SOURCE_ROOT } from './benchmark/protocol.mjs';

const execFileAsync = promisify(execFile);
const BUILT_IN_REGISTRY = 'src/levels/index.ts';
const PERMANENT_BENCHMARK_FILES = new Set([
  'catalog.ts',
  'domain.test.ts',
  'index.ts',
  'types.ts',
  'validation.ts',
]);

export async function assertBenchmarkBaseline({
  root = process.cwd(),
  ref = 'HEAD',
  benchmarkVersion = 'v2',
  expectedBuiltInLevelIds,
  expectedBuiltInTreeSha256,
} = {}) {
  const protocol = protocolForVersion(benchmarkVersion);
  if (!protocol.directoryOnly) {
    if (expectedBuiltInLevelIds) {
      const actual = parseBuiltInIds(await git(root, ['show', `${ref}:${BUILT_IN_REGISTRY}`]));
      assertSameIds(actual, expectedBuiltInLevelIds);
    }
    return { benchmarkVersion, sourceRoot: protocol.sourceRoot, builtInLevelIds: expectedBuiltInLevelIds ?? [] };
  }

  const registry = await git(root, ['show', `${ref}:${BUILT_IN_REGISTRY}`]);
  const actualBuiltIns = parseBuiltInIds(registry);
  if (expectedBuiltInLevelIds) assertSameIds(actualBuiltIns, expectedBuiltInLevelIds);
  if (expectedBuiltInTreeSha256) {
    const actualTree = sha256(await gitBuffer(root, ['ls-tree', '-r', '-z', '--full-tree', ref, '--', 'src/levels']));
    if (actualTree !== expectedBuiltInTreeSha256) {
      throw new Error(`Benchmark baseline built-in tree mismatch (expected ${expectedBuiltInTreeSha256}, found ${actualTree}).`);
    }
  }

  const entries = await benchmarkTreeEntries(root, ref);
  const missingInfrastructure = [...PERMANENT_BENCHMARK_FILES].filter((file) => !entries.includes(file));
  if (missingInfrastructure.length) {
    throw new Error(`Benchmark baseline is missing permanent discovery infrastructure: ${missingInfrastructure.join(', ')}`);
  }
  const unexpected = entries.filter((entry) => !isPermanentBenchmarkPath(entry));
  if (unexpected.length) {
    const promotedDirectory = unexpected[0].split('/')[0];
    throw new Error(`Benchmark baseline output root is not empty; remove promoted output directory: ${promotedDirectory}`);
  }
  return {
    benchmarkVersion,
    sourceRoot: DIRECTORY_SOURCE_ROOT,
    builtInLevelIds: actualBuiltIns,
    builtInTreeSha256: sha256(await gitBuffer(root, ['ls-tree', '-r', '-z', '--full-tree', ref, '--', 'src/levels'])),
  };
}

export function parseBuiltInIds(source) {
  const match = source.match(/export const levelMetadatas: (?:LevelMetadata|BuiltInLevelMetadata)\[\] = \[([\s\S]*?)\n\];/);
  if (!match) throw new Error('Could not read levelMetadatas from the entrant baseline.');
  const ids = [...match[1].matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((item) => item[1]);
  if (!ids.length) throw new Error('The entrant baseline level registry contains no built-in level ids.');
  if (new Set(ids).size !== ids.length) throw new Error('The entrant baseline level registry contains duplicate level ids.');
  return ids;
}

export async function benchmarkTreeEntries(root, ref) {
  const source = await git(root, ['ls-tree', '-r', '--name-only', ref, '--', DIRECTORY_SOURCE_ROOT]);
  return source.split('\n').map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.slice(`${DIRECTORY_SOURCE_ROOT}/`.length));
}

export function isPermanentBenchmarkPath(relativePath) {
  return PERMANENT_BENCHMARK_FILES.has(relativePath) || relativePath.startsWith('test-fixtures/');
}

function assertSameIds(actual, expected) {
  if (!Array.isArray(expected) || expected.length === 0 || expected.some((id) => typeof id !== 'string') || new Set(expected).size !== expected.length) {
    throw new Error('Expected built-in level ids must be a non-empty unique string array.');
  }
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(`Benchmark baseline built-in ids mismatch (expected ${expectedSorted.join(', ')}, found ${actualSorted.join(', ')}).`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function git(cwd, args) {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout;
}

async function gitBuffer(cwd, args) {
  return (await execFileAsync('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout;
}

function parseArgs(argv) {
  const options = { benchmarkVersion: 'v2', ref: 'HEAD', expectedBuiltInLevelIds: undefined, expectedBuiltInTreeSha256: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'help') {
      console.log('Usage: npm run check:benchmark-baseline -- [--version v2] [--ref <commit>] [--expected-built-ins id,id] [--expected-built-in-tree <sha256>]');
      process.exit(0);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (key === 'version' || key === 'benchmark-version') options.benchmarkVersion = value;
    else if (key === 'ref' || key === 'baseline') options.ref = value;
    else if (key === 'expected-built-ins') options.expectedBuiltInLevelIds = value.split(',').map((item) => item.trim()).filter(Boolean);
    else if (key === 'expected-built-in-tree') options.expectedBuiltInTreeSha256 = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  assertBenchmarkBaseline(parseArgs(process.argv.slice(2)))
    .then((result) => console.log(`benchmark baseline valid (${result.benchmarkVersion}; built-ins ${result.builtInLevelIds.length}; output root empty)`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
