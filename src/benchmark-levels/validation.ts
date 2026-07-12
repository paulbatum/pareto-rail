import type { LevelDefinition } from '../engine/types';
import type {
  BenchmarkDescriptorAssets,
  BenchmarkLevelDescriptor,
  BenchmarkLevelModule,
  BenchmarkModuleAssets,
  LevelIdentity,
} from './types';

export interface ValidatedBenchmarkAsset {
  descriptorPath: string;
  modulePath: string;
  directoryName: string;
  descriptor: BenchmarkLevelDescriptor;
}

/** Validate the filesystem-shaped side of benchmark discovery without loading level code. */
export function validateBenchmarkAssets(
  descriptorAssets: BenchmarkDescriptorAssets,
  moduleAssets: BenchmarkModuleAssets,
  builtInIdentities: readonly LevelIdentity[] = [],
): ValidatedBenchmarkAsset[] {
  const descriptors = Object.entries(descriptorAssets).map(([descriptorPath, value]) => ({
    descriptorPath,
    directoryName: directoryNameForDescriptor(descriptorPath),
    descriptor: parseDescriptor(value, descriptorPath),
  }));

  const seenIdentities = new Map<string, string>();
  for (const identity of builtInIdentities) registerIdentity(seenIdentities, identity, `built-in level "${identity.id}"`);

  const validated: ValidatedBenchmarkAsset[] = [];
  for (const item of descriptors) {
    if (item.descriptor.id !== item.directoryName) {
      throw new Error(`Benchmark descriptor ${item.descriptorPath} declares id "${item.descriptor.id}", expected directory id "${item.directoryName}".`);
    }
    registerIdentity(seenIdentities, item.descriptor, `benchmark level "${item.descriptor.id}"`, true);

    const modulePath = expectedModulePath(item.descriptorPath);
    if (!moduleAssets[modulePath]) {
      throw new Error(`Benchmark descriptor ${item.descriptorPath} has no matching module ${modulePath}.`);
    }
    validated.push({ ...item, modulePath });
  }

  for (const modulePath of Object.keys(moduleAssets)) {
    const descriptorPath = expectedDescriptorPath(modulePath);
    if (!descriptorAssets[descriptorPath]) {
      throw new Error(`Benchmark module ${modulePath} has no matching descriptor ${descriptorPath}.`);
    }
  }

  return validated;
}

/** Validate the identity promised by a descriptor against the lazy level module. */
export function validateLoadedBenchmarkLevel(
  descriptor: BenchmarkLevelDescriptor,
  level: LevelDefinition,
  modulePath = 'benchmark level module',
): LevelDefinition {
  if (level.id !== descriptor.id) {
    throw new Error(`Benchmark module ${modulePath} exports level id "${level.id}", expected descriptor id "${descriptor.id}".`);
  }
  if (level.title !== descriptor.title) {
    throw new Error(`Benchmark module ${modulePath} exports title "${level.title}", expected descriptor title "${descriptor.title}".`);
  }
  return level;
}

/** Resolve the one LevelDefinition exported by a benchmark module. */
export function resolveBenchmarkLevelModule(moduleValue: BenchmarkLevelModule, modulePath: string): LevelDefinition {
  const candidates: LevelDefinition[] = [];
  for (const value of Object.values(moduleValue)) {
    if (isLevelDefinition(value) && !candidates.includes(value)) candidates.push(value);
  }
  if (candidates.length === 0) throw new Error(`Benchmark module ${modulePath} does not export a LevelDefinition.`);
  if (candidates.length > 1) throw new Error(`Benchmark module ${modulePath} exports more than one LevelDefinition.`);
  return candidates[0];
}

/** Check collisions after a benchmark catalog has been built from Vite assets. */
export function validateBenchmarkIdentityCollisions(
  benchmarkIdentities: readonly LevelIdentity[],
  builtInIdentities: readonly LevelIdentity[],
): void {
  const seen = new Map<string, string>();
  for (const identity of builtInIdentities) registerIdentity(seen, identity, `built-in level "${identity.id}"`);
  for (const identity of benchmarkIdentities) registerIdentity(seen, identity, `benchmark level "${identity.id}"`, true);
}

export function directoryNameForDescriptor(assetPath: string): string {
  const segments = normalizePath(assetPath).split('/');
  if (segments.length < 2 || segments.at(-1) !== 'level.json') {
    throw new Error(`Benchmark descriptor path ${assetPath} must end in <id>/level.json.`);
  }
  return segments.at(-2)!;
}

export function expectedModulePath(descriptorPath: string): string {
  return normalizePath(descriptorPath).replace(/\/level\.json$/, '/index.ts');
}

export function expectedDescriptorPath(modulePath: string): string {
  const normalized = normalizePath(modulePath);
  if (!normalized.endsWith('/index.ts')) {
    throw new Error(`Benchmark module path ${modulePath} must end in <id>/index.ts.`);
  }
  return normalized.replace(/\/index\.ts$/, '/level.json');
}

function parseDescriptor(value: unknown, assetPath: string): BenchmarkLevelDescriptor {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.title !== 'string' || value.title.length === 0) {
    throw new Error(`Benchmark descriptor ${assetPath} must contain non-empty string id and title fields.`);
  }
  if (value.aliases !== undefined && (!Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== 'string' || alias.length === 0))) {
    throw new Error(`Benchmark descriptor ${assetPath} has invalid aliases; aliases must be non-empty strings.`);
  }
  const contentImages = parseContentImages(value.contentImages, assetPath);
  return {
    id: value.id,
    title: value.title,
    ...(value.aliases === undefined ? {} : { aliases: [...value.aliases] as string[] }),
    ...(contentImages === undefined ? {} : { contentImages }),
  };
}

function parseContentImages(value: unknown, assetPath: string): BenchmarkLevelDescriptor['contentImages'] {
  if (value === undefined) return undefined;
  if (!isRecord(value) || ['overview', 'start', 'hero'].some((key) => typeof value[key] !== 'string' || value[key].length === 0)) {
    throw new Error(`Benchmark descriptor ${assetPath} has invalid contentImages; overview, start, and hero must be non-empty strings.`);
  }
  return {
    overview: value.overview as string,
    start: value.start as string,
    hero: value.hero as string,
  };
}

function registerIdentity(
  seen: Map<string, string>,
  identity: LevelIdentity,
  owner: string,
  benchmark = false,
): void {
  const names = [identity.id, ...(identity.aliases ?? [])];
  for (const name of names) {
    const prior = seen.get(name);
    if (prior) {
      const prefix = benchmark ? 'Benchmark identity' : 'Level identity';
      throw new Error(`${prefix} "${name}" collides with ${prior}.`);
    }
    seen.set(name, owner);
  }
}

function isLevelDefinition(value: unknown): value is LevelDefinition {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.createAudio === 'function'
    && typeof value.createRuntime === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}
