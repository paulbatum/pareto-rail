import { Vector3 } from 'three';
import type { HeliosEnemyKind, HeliosSpawnEntry } from './gameplay';
import { createSuneaterEntries } from './suneater';

export type HeliosDebugTarget = 'cinder' | 'mote' | 'scorcher' | 'pyre' | 'flare' | 'suneater';

export const HELIOS_DEBUG_TARGETS: Array<{ id: HeliosDebugTarget; title: string }> = [
  { id: 'cinder', title: 'Cinder' },
  { id: 'mote', title: 'Mote' },
  { id: 'scorcher', title: 'Scorcher' },
  { id: 'pyre', title: 'Pyre' },
  { id: 'flare', title: 'Flare' },
  { id: 'suneater', title: 'Suneater' },
];

export function normalizeHeliosDebugTarget(value: string | undefined): HeliosDebugTarget {
  return HELIOS_DEBUG_TARGETS.find((target) => target.id === value)?.id ?? 'scorcher';
}

function tough(entry: HeliosSpawnEntry): HeliosSpawnEntry {
  return {
    ...entry,
    hitStages: Array.from({ length: 12 }, () => 6),
    lockable: true,
  };
}

function debugEnemy(kind: Exclude<HeliosDebugTarget, 'suneater'>): HeliosSpawnEntry {
  const base = {
    time: 1,
    kind: kind as HeliosEnemyKind,
  };
  switch (kind) {
    case 'cinder':
      return tough({
        ...base,
        kind: 'cinder',
        data: { role: 'lattice', lead: 0, offset: new Vector3(0, 2.4, 0), spin: 0.35, debugHold: true },
      });
    case 'mote':
      return tough({
        ...base,
        kind: 'mote',
        data: { role: 'mote', lead: 0, fromX: 0, toX: 0, y: 2.4, arc: 0, crossTime: 90, delay: 0, debugHold: true },
      });
    case 'scorcher':
      return tough({
        ...base,
        kind: 'scorcher',
        data: { role: 'scorcher', lead: 0, offset: new Vector3(0, 3.2, 0), seed: 1.7, debugHold: true, fireForever: true },
      });
    case 'pyre':
      return tough({
        ...base,
        kind: 'pyre',
        data: { role: 'pyre', leadStart: 0, leadEnd: 0, closeTime: 90, offset: new Vector3(0, 2.2, 0), debugHold: true },
      });
    case 'flare':
      return tough({
        ...base,
        kind: 'flare',
        countsTowardTotal: false,
        data: { role: 'flare', targetLead: 0, x: 0, debugHold: true },
      });
  }
}

export function createHeliosDebugTimeline(target: HeliosDebugTarget): { timeline: HeliosSpawnEntry[]; heartEntry: HeliosSpawnEntry } {
  if (target === 'suneater') return createSuneaterEntries(1, { debugHold: true });
  return { heartEntry: createSuneaterEntries(1).heartEntry, timeline: [debugEnemy(target)] };
}
