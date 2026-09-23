import type { EventBus } from '../../events';

// Level-private events riding the shared bus instance. The engine's event
// map is fixed, but pickups and size-ups are Tinker Ball's own vocabulary:
// visuals announce them, audio plays them. Keeping them on the per-game bus
// (not a module singleton) scopes them to one running level.

export type TinkerEvents = {
  /** A piece stuck to the ball. `size` is its radius relative to the ball's. */
  'tinker:pickup': { size: number; rescued: boolean };
  /** The ball just grew into the next tier. */
  'tinker:grow': { tier: number };
  /** A spill layer is being recycled around a core. */
  'tinker:recycle': { enemyId: number; layer: number };
  /** The spill evaporates. */
  'tinker:clean': undefined;
};

type LooseBus = {
  on(type: string, handler: (payload: unknown) => void): () => void;
  emit(type: string, payload: unknown): void;
};

export function emitTinker<K extends keyof TinkerEvents>(bus: EventBus, type: K, payload: TinkerEvents[K]) {
  (bus as unknown as LooseBus).emit(type, payload);
}

export function onTinker<K extends keyof TinkerEvents>(bus: EventBus, type: K, handler: (payload: TinkerEvents[K]) => void) {
  return (bus as unknown as LooseBus).on(type, handler as (payload: unknown) => void);
}
