import type { LevelDefinition } from '../engine/types';

export interface LevelMetadata {
  id: string;
  title: string;
  aliases?: string[];
}

export const levelMetadatas: LevelMetadata[] = [
  { id: 'crystal-corridor', title: 'Crystal Corridor', aliases: ['crystal'] },
  { id: 'deluge', title: 'Deluge' },
  { id: 'helios', title: 'Helios' },
  { id: 'prism-bloom', title: 'Prism Bloom', aliases: ['prism'] },
  { id: 'rezdle', title: 'Rezdle' },
];

export function selectableLevels(): LevelMetadata[] {
  return levelMetadatas;
}

export async function getLevelById(id: string | null): Promise<LevelDefinition> {
  const matched = levelMetadatas.find((level) => level.id === id || level.aliases?.includes(id ?? '')) ?? levelMetadatas[0];

  switch (matched.id) {
    case 'crystal-corridor':
      return (await import('./crystal')).crystalCorridorLevel;
    case 'deluge':
      return (await import('./deluge')).delugeLevel;
    case 'helios':
      return (await import('./helios')).heliosLevel;
    case 'prism-bloom':
      return (await import('./prism')).prismBloomLevel;
    case 'rezdle':
      return (await import('./rezdle')).rezdleLevel;
    default:
      throw new Error(`Unknown level: ${matched.id}`);
  }
}

