import type { LevelDefinition } from '../engine/types';
import { crystalCorridorLevel } from './crystal';
import { prismBloomLevel } from './prism';

export const levels = [crystalCorridorLevel, prismBloomLevel] satisfies LevelDefinition[];

export function getLevelById(id: string | null) {
  return levels.find((level) => level.id === id) ?? levels[0];
}
