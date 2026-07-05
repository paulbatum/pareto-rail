import type { LevelDefinition } from '../engine/types';

export interface LevelMetadata {
  id: string;
  title: string;
  aliases?: string[];
  debugOnly?: boolean;
}

export const levelMetadatas: LevelMetadata[] = [
  { id: 'crystal-corridor', title: 'Crystal Corridor', aliases: ['crystal'] },
  { id: 'helios', title: 'Helios' },
  { id: 'crystal-debug', title: 'Crystal Corridor (Debug)', debugOnly: true, aliases: ['crystal-lancer-debug'] },
  { id: 'prism-bloom', title: 'Prism Bloom', aliases: ['prism'] },
  { id: 'rezdle', title: 'Rezdle' },
];

export function selectableLevels(includeDebug = false): LevelMetadata[] {
  return levelMetadatas.filter((level) => includeDebug || level.debugOnly !== true);
}

export async function getLevelById(id: string | null): Promise<LevelDefinition> {
  const matched = levelMetadatas.find((level) => level.id === id || level.aliases?.includes(id ?? '')) ?? levelMetadatas[0];

  switch (matched.id) {
    case 'crystal-corridor':
      return (await import('./crystal')).crystalCorridorLevel;
    case 'helios':
      return (await import('./helios')).heliosLevel;
    case 'crystal-debug':
      return (await import('./crystal-debug')).crystalDebugLevel;
    case 'prism-bloom':
      return (await import('./prism')).prismBloomLevel;
    case 'rezdle':
      return (await import('./rezdle')).rezdleLevel;
    default:
      throw new Error(`Unknown level: ${matched.id}`);
  }
}

