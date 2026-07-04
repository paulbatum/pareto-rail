import type { LevelDefinition } from '../engine/types';
import { crystalCorridorLevel } from './crystal';
import { crystalDebugLevel } from './crystal-debug';
import { heliosLevel } from './helios';
import { prismBloomLevel } from './prism';
import { rezdleLevel } from './rezdle';

export const levels = [crystalCorridorLevel, heliosLevel, crystalDebugLevel, prismBloomLevel, rezdleLevel] satisfies LevelDefinition[];

export function selectableLevels(includeDebug = false) {
  return levels.filter((level) => includeDebug || level.debugOnly !== true);
}

export function getLevelById(id: string | null) {
  return levels.find((level) => level.id === id || level.aliases?.includes(id ?? '')) ?? levels[0];
}
