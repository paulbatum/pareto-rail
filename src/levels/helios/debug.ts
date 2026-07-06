import { Vector3 } from 'three';
import { createHeartEntry, type HeliosEnemyKind, type HeliosSpawnEntry } from './gameplay';

export type HeliosDebugTarget = 'cinder' | 'mote' | 'scorcher' | 'pyre' | 'flare' | 'fang' | 'heart' | 'suneater';

export const HELIOS_DEBUG_TARGETS: Array<{ id: HeliosDebugTarget; title: string }> = [
  { id: 'cinder', title: 'Cinder' },
  { id: 'mote', title: 'Mote' },
  { id: 'scorcher', title: 'Scorcher' },
  { id: 'pyre', title: 'Pyre' },
  { id: 'flare', title: 'Flare' },
  { id: 'fang', title: 'Fang group' },
  { id: 'heart', title: 'Suneater heart' },
  { id: 'suneater', title: 'Full Suneater' },
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

function debugEnemy(kind: Exclude<HeliosDebugTarget, 'fang' | 'heart' | 'suneater'>): HeliosSpawnEntry {
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

function debugSuneater(kind: Extract<HeliosDebugTarget, 'fang' | 'heart' | 'suneater'>): { timeline: HeliosSpawnEntry[]; heartEntry: HeliosSpawnEntry } {
  const heartEntry = createHeartEntry();
  heartEntry.time = 1;
  heartEntry.lockable = kind === 'heart';
  heartEntry.hitStages = Array.from({ length: 12 }, () => 6);
  heartEntry.data = { role: 'heart', debugHold: true };

  const fangs: HeliosSpawnEntry[] = [0, 1, 2, 3].map((socket, index) => tough({
    time: 1.15 + index * 0.1,
    kind: 'fang',
    hitPoints: 3,
    data: { role: 'fang', socket },
  }));

  if (kind === 'heart') return { heartEntry, timeline: [heartEntry] };
  return { heartEntry, timeline: [heartEntry, ...fangs] };
}

export function createHeliosDebugTimeline(target: HeliosDebugTarget): { timeline: HeliosSpawnEntry[]; heartEntry: HeliosSpawnEntry } {
  if (target === 'fang' || target === 'heart' || target === 'suneater') return debugSuneater(target);
  return { heartEntry: createHeartEntry(), timeline: [debugEnemy(target)] };
}
