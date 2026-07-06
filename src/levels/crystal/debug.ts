import { Vector3 } from 'three';
import type { CrystalMovementPattern, CrystalSpawnEntry } from './gameplay';
import type { CrystalWarden } from './warden';

export type CrystalDebugTarget = 'lancer' | 'warden' | 'node' | 'drifter' | 'orbiter';

export const CRYSTAL_DEBUG_TARGETS: Array<{ id: CrystalDebugTarget; title: string }> = [
  { id: 'lancer', title: 'Lancer' },
  { id: 'warden', title: 'Crystal Warden' },
  { id: 'node', title: 'Node' },
  { id: 'drifter', title: 'Drifter' },
  { id: 'orbiter', title: 'Orbiter' },
];

export function normalizeCrystalDebugTarget(value: string | undefined): CrystalDebugTarget {
  return CRYSTAL_DEBUG_TARGETS.find((target) => target.id === value)?.id ?? 'lancer';
}

function debugWave(kind: Exclude<CrystalDebugTarget, 'warden'>): CrystalSpawnEntry {
  const pattern: CrystalMovementPattern = kind === 'drifter' ? 'drift' : kind === 'orbiter' ? 'orbit' : 'hold';
  return {
    time: 1.0,
    kind,
    hitStages: Array.from({ length: 12 }, () => 6),
    data: {
      role: 'wave',
      lead: 0,
      pattern,
      offset: new Vector3(0, kind === 'lancer' ? 2.8 : 1.8, 0),
      debugHold: true,
      fireForever: kind === 'lancer',
    },
  };
}

export function createDebugTimeline(target: CrystalDebugTarget, warden: CrystalWarden): CrystalSpawnEntry[] {
  return target === 'warden' ? warden.entries(1.0) : [debugWave(target)];
}
