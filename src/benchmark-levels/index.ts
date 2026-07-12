import { createBenchmarkCatalog } from './catalog';
import type { BenchmarkLevelCatalogEntry, BenchmarkLevelDescriptor, BenchmarkLevelModule } from './types';

export * from './catalog';
export * from './types';
export * from './validation';

// Descriptors are intentionally eager so menus and catalogs never need to load
// generated gameplay. The corresponding index modules stay lazy until a level
// is actually launched.
const descriptorAssets = import.meta.glob<BenchmarkLevelDescriptor>('./*/level.json', {
  eager: true,
  import: 'default',
});
const moduleAssets = import.meta.glob<BenchmarkLevelModule>('./*/index.ts');

export const benchmarkLevelCatalog: readonly BenchmarkLevelCatalogEntry[] = createBenchmarkCatalog(descriptorAssets, moduleAssets);
