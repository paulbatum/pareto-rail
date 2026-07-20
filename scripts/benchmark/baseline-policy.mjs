#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BENCHMARK_SOURCE_ROOT,
  BUILT_IN_LEVEL_REGISTRY_PATH,
  LEVEL_CONTENT_ROOT,
  LEVEL_GALLERY_PATH,
  SCRUBBED_BENCHMARK_SCAFFOLD_PATHS,
} from './protocol.mjs';

const execFileAsync = promisify(execFile);
const RANK_CATALOG_PATH = 'src/benchmark/rank-catalog.json';
const PUBLIC_CONTENT_ROOT = LEVEL_CONTENT_ROOT;

/**
 * Return structural violations that make a commit unsuitable for a scrubbed
 * entrant baseline. All reads come from the commit tree, never its checkout.
 */
export async function scrubbedBaselineViolations({ repo = process.cwd(), baseline }) {
  const commit = await gitCommit(repo, baseline);
  const paths = await treePaths(repo, commit);
  const violations = [];
  const builtInIds = parseBuiltInLevelIds(await gitShow(repo, commit, BUILT_IN_LEVEL_REGISTRY_PATH));

  const benchmarkTreePaths = paths.filter((name) => name === 'benchmark' || name.startsWith('benchmark/'));
  if (benchmarkTreePaths.length > 0) {
    violations.push({
      path: 'benchmark/',
      reason: 'the tracked benchmark tree is present',
    });
  }

  const benchmarkSourcePaths = paths.filter((name) => name.startsWith(`${BENCHMARK_SOURCE_ROOT}/`));
  const allowedScaffold = new Set(SCRUBBED_BENCHMARK_SCAFFOLD_PATHS);
  const benchmarkExtras = benchmarkSourcePaths.filter((name) => !allowedScaffold.has(name));
  for (const pathName of groupedChildPaths(benchmarkExtras, `${BENCHMARK_SOURCE_ROOT}/`)) {
    violations.push({
      path: pathName,
      reason: `contains material outside the cut-baseline scaffold (${SCRUBBED_BENCHMARK_SCAFFOLD_PATHS.join(', ')})`,
    });
  }

  const publicContentPaths = paths.filter((name) => name.startsWith(`${PUBLIC_CONTENT_ROOT}/`));
  for (const pathName of groupedChildPaths(publicContentPaths, `${PUBLIC_CONTENT_ROOT}/`)) {
    const id = pathName.slice(`${PUBLIC_CONTENT_ROOT}/`.length);
    if (!builtInIds.has(id)) {
      violations.push({
        path: pathName,
        reason: `content id is not a built-in level (built-ins from ${BUILT_IN_LEVEL_REGISTRY_PATH}: ${[...builtInIds].join(', ')})`,
      });
    }
  }

  // A generated gallery is built-in only, so this catches a hand-edited or
  // stale committed one rather than anything collect-gallery can produce.
  if (paths.includes(LEVEL_GALLERY_PATH)) {
    const gallery = await gitShow(repo, commit, LEVEL_GALLERY_PATH);
    if (/^## Benchmark levels\s*$/m.test(gallery)) {
      violations.push({
        path: LEVEL_GALLERY_PATH,
        reason: 'the generated gallery still contains benchmark level content',
      });
    }
  }

  if (paths.includes(RANK_CATALOG_PATH)) {
    const catalogSource = await gitShow(repo, commit, RANK_CATALOG_PATH);
    let catalog;
    try {
      catalog = JSON.parse(catalogSource);
    } catch (error) {
      violations.push({ path: RANK_CATALOG_PATH, reason: `is not valid JSON: ${error.message}` });
      catalog = undefined;
    }
    const entrants = catalog?.versions?.flatMap((version) => Array.isArray(version?.entrants) ? version.entrants : []) ?? [];
    if (entrants.length > 0) {
      violations.push({
        path: RANK_CATALOG_PATH,
        reason: `contains ${entrants.length} benchmark entrant record${entrants.length === 1 ? '' : 's'}`,
      });
    }
  }

  return violations;
}

/** Throw the launch-guard error for a scrubbed policy baseline. */
export async function assertScrubbedBaseline({ repo = process.cwd(), baseline }) {
  const commit = await gitCommit(repo, baseline);
  const violations = await scrubbedBaselineViolations({ repo, baseline: commit });
  if (violations.length > 0) {
    throw new Error([
      `Entrant baseline ${commit} is not scrubbed for baselinePolicy "scrubbed".`,
      'Run benchmark:cut-baseline --source <commit-ish> --branch <branch-name> before launching this plan row.',
      ...violations.map(({ path, reason }) => `- ${path}: ${reason}`),
    ].join('\n'));
  }
  return { commit, violations };
}

export function parseBuiltInLevelIds(source) {
  const array = source.match(/export const levelMetadatas: (?:LevelMetadata|BuiltInLevelMetadata)\[\] = \[([\s\S]*?)\n\];/);
  if (!array) throw new Error(`Could not find ${BUILT_IN_LEVEL_REGISTRY_PATH}'s levelMetadatas registry.`);
  const ids = new Set();
  const entries = /\{\s*id:\s*'([^']+)'/g;
  let match;
  while ((match = entries.exec(array[1]))) ids.add(match[1]);
  if (ids.size === 0) throw new Error(`${BUILT_IN_LEVEL_REGISTRY_PATH} contains no built-in level ids.`);
  return ids;
}

async function treePaths(repo, commit) {
  const result = await execFileAsync('git', ['ls-tree', '-r', '--name-only', commit], { cwd: repo, encoding: 'utf8' });
  return result.stdout.split('\n').map((name) => name.trim()).filter(Boolean);
}

async function gitShow(repo, commit, relativePath) {
  const result = await execFileAsync('git', ['show', `${commit}:${relativePath}`], { cwd: repo, encoding: 'utf8' });
  return result.stdout;
}

async function gitCommit(repo, ref) {
  const result = await execFileAsync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repo, encoding: 'utf8' });
  return result.stdout.trim();
}

function groupedChildPaths(paths, prefix) {
  const children = new Set();
  for (const name of paths) {
    if (!name.startsWith(prefix)) continue;
    const child = name.slice(prefix.length).split('/')[0];
    if (child) children.add(`${prefix}${child}`);
  }
  return [...children].sort();
}
