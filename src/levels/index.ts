import type { LevelDefinition } from '../engine/types';

export interface LevelMetadata {
  id: string;
  title: string;
  aliases?: string[];
  kind?: 'playable' | 'technical';
}

export const levelMetadatas: LevelMetadata[] = [
  { id: 'hull-run-cvs3', title: 'Hull Run' },
  { id: 'crystal-corridor', title: 'Crystal Corridor', aliases: ['crystal'] },
  { id: 'helios', title: 'Helios' },
  { id: 'prism-bloom', title: 'Prism Bloom', aliases: ['prism'] },
  { id: 'rezdle', title: 'Rezdle' },
  { id: 'rush', title: 'Rush', kind: 'technical' },
  { id: 'hull-run-cvs3', title: 'Hull Run' },
];

export function selectableLevels({ includeTechnical = false }: { includeTechnical?: boolean } = {}): LevelMetadata[] {
  return includeTechnical ? levelMetadatas : levelMetadatas.filter((level) => level.kind !== 'technical');
}

export function benchmarkReferenceLevels(): LevelMetadata[] {
  return levelMetadatas.filter((level) => level.kind !== 'technical');
}

export async function getLevelById(id: string | null): Promise<LevelDefinition> {
  const matched = levelMetadatas.find((level) => level.id === id || level.aliases?.includes(id ?? '')) ?? levelMetadatas[0];

  switch (matched.id) {
    case 'hull-run-cvs3':
      return (await import('./hull-run-cvs3')).hullRunCvs3Level;
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
    case 'hull-run-cvs3':
      return (await import('./hull-run-cvs3')).hullRunCvs3Level;
    default:
      throw new Error(`Unknown level: ${matched.id}`);
  }
}
