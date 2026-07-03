import type { Vector3 } from 'three';

export type EnemyKind = 'node' | 'drifter' | 'orbiter';

export type GameEvents = {
  spawn: { enemyId: number; kind: EnemyKind; worldPosition: Vector3 };
  lock: { enemyId: number; lockCount: number; worldPosition: Vector3 };
  unlock: { enemyId: number; lockCount: number; worldPosition: Vector3 };
  fire: {
    projectileId: number;
    enemyId: number;
    volleySize: number;
    worldPosition: Vector3;
    targetPosition: Vector3;
  };
  hit: { enemyId: number; projectileId: number; worldPosition: Vector3 };
  kill: { enemyId: number; worldPosition: Vector3; scoreAwarded: number };
  miss: { enemyId: number; worldPosition: Vector3 };
  beat: { beatNumber: number; isDownbeat: boolean; audioTime: number };
  runstart: { runNumber: number; duration: number; totalEnemies: number };
  runend: { score: number; kills: number; missed: number; totalEnemies: number; rank: string };
};

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;
type AnyHandler = (payload: GameEvents[keyof GameEvents]) => void;

export type EventBus = ReturnType<typeof createEventBus>;

export function createEventBus() {
  const handlers: Partial<Record<keyof GameEvents, Set<AnyHandler>>> = {};

  return {
    on<K extends keyof GameEvents>(type: K, handler: Handler<K>) {
      const bucket = (handlers[type] ??= new Set<AnyHandler>());
      const anyHandler = handler as AnyHandler;
      bucket.add(anyHandler);
      return () => bucket.delete(anyHandler);
    },

    emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]) {
      const bucket = handlers[type];
      if (!bucket) return;
      for (const handler of bucket) (handler as Handler<K>)(payload);
    },

    clear() {
      for (const bucket of Object.values(handlers)) bucket?.clear();
    },
  };
}

export const events = createEventBus();
