import type { LevelDefinition } from '../engine/types';
import type {
  BenchmarkDescriptorAssets,
  BenchmarkLevelCatalogEntry,
  BenchmarkLevelDescriptor,
  BenchmarkModuleAssets,
  LevelIdentity,
} from './types';
import {
  resolveBenchmarkLevelModule,
  validateBenchmarkAssets,
  validateBenchmarkIdentityCollisions,
  validateLoadedBenchmarkLevel,
} from './validation';

/** Build a lazy benchmark catalog from Vite's eager descriptor and lazy module maps. */
export function createBenchmarkCatalog(
  descriptorAssets: BenchmarkDescriptorAssets,
  moduleAssets: BenchmarkModuleAssets,
  builtInIdentities: readonly LevelIdentity[] = [],
): BenchmarkLevelCatalogEntry[] {
  const assets = validateBenchmarkAssets(descriptorAssets, moduleAssets, builtInIdentities);
  validateBenchmarkIdentityCollisions(assets.map(({ descriptor }) => descriptor), builtInIdentities);

  return assets.map(({ descriptor, modulePath, directoryName }) => createEntry(descriptor, directoryName, moduleAssets[modulePath], modulePath));
}

function createEntry(
  descriptor: BenchmarkLevelDescriptor,
  directoryName: string,
  loadModule: BenchmarkModuleAssets[string],
  modulePath: string,
): BenchmarkLevelCatalogEntry {
  let loaded: Promise<LevelDefinition> | undefined;
  return {
    domain: 'benchmark',
    id: descriptor.id,
    title: descriptor.title,
    ...(descriptor.aliases === undefined ? {} : { aliases: [...descriptor.aliases] }),
    ...(descriptor.contentImages === undefined ? {} : { contentImages: descriptor.contentImages }),
    directoryName,
    load: () => {
      loaded ??= loadModule().then((moduleValue) => validateLoadedBenchmarkLevel(
        descriptor,
        resolveBenchmarkLevelModule(moduleValue, modulePath),
        modulePath,
      ));
      return loaded;
    },
  };
}
