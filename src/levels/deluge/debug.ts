import { Vector3 } from 'three';
import type { DelugeEnemyKind, DelugeSpawnEntry } from './gameplay';

export type DelugeDebugTarget = 'gnat' | 'interceptor' | 'turret' | 'barrier' | 'dropvan' | 'vulture';

export const DELUGE_DEBUG_TARGETS: Array<{ id: DelugeDebugTarget; title: string }> = [
  { id: 'gnat', title: 'Gnat' },
  { id: 'interceptor', title: 'Interceptor' },
  { id: 'turret', title: 'Turret' },
  { id: 'barrier', title: 'Holo-barrier' },
  { id: 'dropvan', title: 'Dropvan' },
  { id: 'vulture', title: 'Vulture' },
];

export function normalizeDelugeDebugTarget(value: string | undefined): DelugeDebugTarget {
  return DELUGE_DEBUG_TARGETS.find((target) => target.id === value)?.id ?? 'gnat';
}

function tough(entry: DelugeSpawnEntry): DelugeSpawnEntry {
  return { ...entry, hitStages: Array.from({ length: 10 }, () => 6), lockable: true };
}

function debugEnemy(kind: Exclude<DelugeDebugTarget, 'vulture'>): DelugeSpawnEntry {
  const base = { time: 1, kind: kind as DelugeEnemyKind };
  switch (kind) {
    case 'gnat':
      return tough({ ...base, kind: 'gnat', data: { role: 'gnat', lead: 0, center: new Vector3(0, 2.6, 0), seed: 1, boid: 0, debugHold: true } });
    case 'interceptor':
      return tough({ ...base, kind: 'interceptor', data: { role: 'interceptor', lead: 0, side: 1, y: 2.5, seed: 2, fireAt: 1.3, debugHold: true } });
    case 'turret':
      return tough({ ...base, kind: 'turret', data: { role: 'turret', lead: 0, wall: 1, y: 2.5, seed: 3, fireEvery: 1.8, debugHold: true } });
    case 'barrier':
      return tough({ ...base, kind: 'barrier', countsTowardTotal: false, data: { role: 'barrier', lead: 0, gapX: -4.2, gapY: 0, width: 3, seed: 4, debugHold: true } });
    case 'dropvan':
      return tough({ ...base, kind: 'dropvan', data: { role: 'dropvan', lead: 0, offset: new Vector3(0, 2.8, 0), seed: 5, debugHold: true } });
  }
}

export function createDelugeDebugTimeline(target: DelugeDebugTarget, vultureTimeline: DelugeSpawnEntry[]): DelugeSpawnEntry[] {
  if (target === 'vulture') {
    return vultureTimeline.map((entry) => ({
      ...entry,
      time: entry.kind === 'vultureCore' ? 3 : 1,
      lockable: true,
      data: entry.data.role === 'vulturePod'
        ? { ...entry.data, debugHold: true }
        : entry.data.role === 'vultureCore'
          ? { ...entry.data, debugHold: true }
          : entry.data,
    }));
  }
  return [debugEnemy(target)];
}
