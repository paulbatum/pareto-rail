import type { LevelDefinition } from '../engine/types';
import {
  benchmarkLevelCatalog,
  validateBenchmarkIdentityCollisions,
  type BenchmarkLevelCatalogEntry,
} from '../benchmark-levels';

export type BuiltInLevelKind = 'playable' | 'technical';

export interface BuiltInLevelMetadata {
  id: string;
  title: string;
  aliases?: string[];
  kind: BuiltInLevelKind;
}

/** Compatibility name for the human-maintained built-in registry API. */
export type LevelMetadata = BuiltInLevelMetadata;

export interface BuiltInLevelCatalogEntry extends BuiltInLevelMetadata {
  readonly domain: 'built-in';
  readonly load: () => Promise<LevelDefinition>;
}

export type LevelCatalogEntry = BuiltInLevelCatalogEntry | BenchmarkLevelCatalogEntry;

export const levelMetadatas: LevelMetadata[] = [
  { id: 'crystal-corridor', title: 'Crystal Corridor', aliases: ['crystal'], kind: 'playable' },
  { id: 'helios', title: 'Helios', kind: 'playable' },
  { id: 'prism-bloom', title: 'Prism Bloom', aliases: ['prism'], kind: 'playable' },
  { id: 'rezdle', title: 'Rezdle', kind: 'playable' },
  { id: 'mass-driver-vyxj', title: 'Mass Driver', kind: 'playable' },
  { id: 'downpour-wpxk', title: 'Downpour WPXK', kind: 'playable' },
  { id: 'rush', title: 'Rush', kind: 'technical' },
];

const builtInLoaders: Record<string, () => Promise<LevelDefinition>> = {
  'crystal-corridor': async () => (await import('./crystal')).crystalCorridorLevel,
  helios: async () => (await import('./helios')).heliosLevel,
  'prism-bloom': async () => (await import('./prism')).prismBloomLevel,
  rezdle: async () => (await import('./rezdle')).rezdleLevel,
  'mass-driver-vyxj': async () => (await import('./mass-driver-vyxj')).massDriverVyxjLevel,
  'downpour-wpxk': async () => (await import('./downpour-wpxk')).downpourWpxkLevel,
  rush: async () => (await import('./rush')).rushLevel,
};

export const builtInLevelCatalog: BuiltInLevelCatalogEntry[] = levelMetadatas.map((metadata) => ({
  ...metadata,
  domain: 'built-in',
  load: builtInLoaders[metadata.id],
}));

// This is the one place where the two domains are checked against one another.
// Benchmark entries remain discovered data; they are never appended to the
// human-maintained metadata array.
validateBenchmarkIdentityCollisions(benchmarkLevelCatalog, levelMetadatas);
export { benchmarkLevelCatalog };

export function selectableLevels({ includeTechnical = false }: { includeTechnical?: boolean } = {}): BuiltInLevelMetadata[] {
  return includeTechnical ? [...levelMetadatas] : levelMetadatas.filter((level) => level.kind !== 'technical');
}

export function benchmarkReferenceLevels(): BuiltInLevelMetadata[] {
  return levelMetadatas.filter((level) => level.kind !== 'technical');
}

export function selectableLevelGroups({ includeTechnical = false } = {}) {
  return {
    builtIn: (includeTechnical ? builtInLevelCatalog : builtInLevelCatalog.filter((level) => level.kind !== 'technical')),
    benchmark: [...benchmarkLevelCatalog],
  };
}

export function allLevelCatalog(): LevelCatalogEntry[] {
  return [...builtInLevelCatalog, ...benchmarkLevelCatalog];
}

export function findLevelEntry(id: string | null): LevelCatalogEntry | undefined {
  return allLevelCatalog().find((level) => level.id === id || level.aliases?.includes(id ?? ''));
}

export function findBenchmarkLevelEntry(id: string | null): BenchmarkLevelCatalogEntry | undefined {
  return benchmarkLevelCatalog.find((level) => level.id === id || level.aliases?.includes(id ?? ''));
}

export async function getLevelEntryById(id: string | null): Promise<LevelCatalogEntry> {
  return findLevelEntry(id) ?? builtInLevelCatalog[0];
}

export async function getBuiltInLevelById(id: string | null): Promise<LevelDefinition> {
  const entry = builtInLevelCatalog.find((level) => level.id === id || level.aliases?.includes(id ?? '')) ?? builtInLevelCatalog[0];
  return entry.load();
}

export async function getBenchmarkLevelById(id: string): Promise<LevelDefinition> {
  const entry = findBenchmarkLevelEntry(id);
  if (!entry) throw new Error(`Unknown benchmark level: ${id}`);
  return entry.load();
}

export async function getLevelById(id: string | null): Promise<LevelDefinition> {
  return (await getLevelEntryById(id)).load();
}
