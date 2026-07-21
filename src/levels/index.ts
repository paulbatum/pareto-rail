import type { LevelDefinition } from '../engine/types';
import { benchmarkLevelCatalog, validateBenchmarkIdentityCollisions } from '../benchmark-levels';

export interface LevelMetadata {
  id: string;
  title: string;
  aliases?: string[];
  kind?: 'playable' | 'technical';
}

export const levelMetadatas: LevelMetadata[] = [
  { id: 'crystal-corridor', title: 'Crystal Corridor', aliases: ['crystal'] },
  { id: 'helios', title: 'Helios' },
  { id: 'prism-bloom', title: 'Prism Bloom', aliases: ['prism'] },
  { id: 'rezdle', title: 'Rezdle' },
  { id: 'rush', title: 'Rush', kind: 'technical' },
];

// The one place the two domains are checked against one another. Benchmark
// entries stay auto-discovered data; they are never appended to the
// human-maintained metadata array above.
validateBenchmarkIdentityCollisions(benchmarkLevelCatalog, levelMetadatas);
export { benchmarkLevelCatalog };

export function selectableLevels({ includeTechnical = false }: { includeTechnical?: boolean } = {}): LevelMetadata[] {
  return includeTechnical ? levelMetadatas : levelMetadatas.filter((level) => level.kind !== 'technical');
}

export function benchmarkReferenceLevels(): LevelMetadata[] {
  return levelMetadatas.filter((level) => level.kind !== 'technical');
}

export async function getLevelById(id: string | null): Promise<LevelDefinition> {
  const benchmarkEntry = benchmarkLevelCatalog.find((level) => level.id === id || level.aliases?.includes(id ?? ''));
  if (benchmarkEntry) return benchmarkEntry.load();

  const matched = levelMetadatas.find((level) => level.id === id || level.aliases?.includes(id ?? '')) ?? levelMetadatas[0];

  switch (matched.id) {
    case 'crystal-corridor':
      return (await import('./crystal')).crystalCorridorLevel;
    case 'helios':
      return (await import('./helios')).heliosLevel;
    case 'prism-bloom':
      return (await import('./prism')).prismBloomLevel;
    case 'rezdle':
      return (await import('./rezdle')).rezdleLevel;
    case 'rush':
      return (await import('./rush')).rushLevel;
    default:
      throw new Error(`Unknown level: ${matched.id}`);
  }
}
