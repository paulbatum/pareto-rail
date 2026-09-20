import descriptorAssets from 'virtual:benchmark-descriptors';
import { createBenchmarkCatalog } from './catalog';
import type { BenchmarkLevelCatalogEntry, BenchmarkLevelModule } from './types';

export * from './catalog';
export * from './types';
export * from './validation';

// Descriptors arrive together so menus and catalogs never need to load generated
// gameplay. They come from a virtual module rather than an eager glob so a dev server
// serves them in one request; see benchmarkDescriptorsPlugin in vite.config.ts for the
// discovery rules. The corresponding index modules stay lazy until a level is actually
// launched. That glob is deliberately direct-child: nested test-fixtures are not
// promoted catalog entries.
const moduleAssets = import.meta.glob<BenchmarkLevelModule>('./*/index.ts');

export const benchmarkLevelCatalog: readonly BenchmarkLevelCatalogEntry[] = createBenchmarkCatalog(descriptorAssets, moduleAssets);
