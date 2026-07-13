import type { LevelDefinition } from '../engine/types';
import { getBenchmarkLevelById } from '../levels';

export async function loadRankLevel(levelId: string): Promise<LevelDefinition> {
  return getBenchmarkLevelById(levelId);
}
