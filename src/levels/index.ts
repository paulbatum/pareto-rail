import type { LevelDefinition } from '../engine/types';

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
  { id: 'downpour-7snm', title: 'Downpour 7SNM' },
  { id: 'downpour-hlht', title: 'Downpour HLHT' },
  { id: 'downpour-ou7e', title: 'Downpour OU7E' },
  { id: 'downpour-f2e6', title: 'Downpour F2E6' },
  { id: 'downpour-wpxk', title: 'Downpour WPXK' },
  { id: 'rush', title: 'Rush', kind: 'technical' },
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
    case 'crystal-corridor':
      return (await import('./crystal')).crystalCorridorLevel;
    case 'helios':
      return (await import('./helios')).heliosLevel;
    case 'prism-bloom':
      return (await import('./prism')).prismBloomLevel;
    case 'rezdle':
      return (await import('./rezdle')).rezdleLevel;
    case 'downpour-7snm':
      return (await import('./downpour-7snm')).downpour7snmLevel;
    case 'downpour-hlht':
      return (await import('./downpour-hlht')).downpourHlhtLevel;
    case 'downpour-ou7e':
      return (await import('./downpour-ou7e')).downpourOu7eLevel;
    case 'downpour-f2e6':
      return (await import('./downpour-f2e6')).downpourF2e6Level;
    case 'downpour-wpxk':
      return (await import('./downpour-wpxk')).downpourWpxkLevel;
    case 'rush':
      return (await import('./rush')).rushLevel;
    default:
      throw new Error(`Unknown level: ${matched.id}`);
  }
}
