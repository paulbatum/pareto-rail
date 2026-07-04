import type { LevelDefinition } from '../engine/types';
import { crystalCorridorLevel } from './crystal';
import { crystalLancerDebugLevel } from './crystal-debug';
import { prismBloomLevel } from './prism';
import { rezdleLevel } from './rezdle';

export const levels = [crystalCorridorLevel, crystalLancerDebugLevel, prismBloomLevel, rezdleLevel] satisfies LevelDefinition[];

export function selectableLevels(includeDebug = false) {
  return levels.filter((level) => includeDebug || level.debugOnly !== true);
}

export function getLevelById(id: string | null) {
  return levels.find((level) => level.id === id) ?? levels[0];
}
