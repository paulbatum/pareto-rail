import type { Vector3 } from 'three';

// Level-local moments that the shared event bus has no vocabulary for: the
// climber's hull being latched onto, the Tetherjack's climb, the dock. Gameplay
// emits; visuals and audio subscribe. The engine bus stays untouched.
export type SkyhookSignals = {
  /** A limpet has clamped onto the climber's deck. */
  clamp: { slot: number; worldPosition: Vector3 };
  /** A clamped limpet chews into the hull (damage was attempted). */
  bite: { slot: number; worldPosition: Vector3 };
  /** A clamped limpet was pried off (killed). */
  pry: { slot: number; worldPosition: Vector3 };
  /** The Tetherjack takes hold of the tether far above. */
  bossLatch: { worldPosition: Vector3 };
  /** Its claws are inside targeting range. */
  bossEngage: Record<string, never>;
  /** One lurch down the tether. */
  bossLurch: { index: number; distance: number };
  /** All claws gone: it hangs by its core. */
  bossGrip: Record<string, never>;
  /** Core armor broken: it lunges. */
  bossStage: Record<string, never>;
  /** It has the climber. */
  bossReach: Record<string, never>;
  /** It tears at the climber (damage attempted). */
  bossBite: Record<string, never>;
  /** Dead. The tether is clear. */
  bossDead: { worldPosition: Vector3 };
  /** Closeness 0 (latched far above) → 1 (reached), sampled a few times a second. */
  bossProximity: { closeness: number };
  /** The station iris opens overhead. */
  stationOpen: Record<string, never>;
  /** Fully decelerated inside the bay. */
  docked: Record<string, never>;
};

type Handler<K extends keyof SkyhookSignals> = (payload: SkyhookSignals[K]) => void;
type AnyHandler = (payload: SkyhookSignals[keyof SkyhookSignals]) => void;

function createSignals() {
  const handlers: Partial<Record<keyof SkyhookSignals, Set<AnyHandler>>> = {};
  return {
    on<K extends keyof SkyhookSignals>(type: K, handler: Handler<K>) {
      const bucket = (handlers[type] ??= new Set<AnyHandler>());
      const anyHandler = handler as AnyHandler;
      bucket.add(anyHandler);
      return () => bucket.delete(anyHandler);
    },
    emit<K extends keyof SkyhookSignals>(type: K, payload: SkyhookSignals[K]) {
      const bucket = handlers[type];
      if (!bucket) return;
      for (const handler of bucket) (handler as Handler<K>)(payload);
    },
    clear() {
      for (const bucket of Object.values(handlers)) bucket?.clear();
    },
  };
}

export const skyhookSignals = createSignals();
