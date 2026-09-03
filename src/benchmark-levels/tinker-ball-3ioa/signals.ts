// Level-local signals that the shared event bus does not carry: pieces sticking
// to the ball (visuals → audio/gameplay) and the ball's growth spurts. One
// runtime exists at a time, so a module singleton is enough; listeners
// unsubscribe on dispose.

export type TinkerSignals = {
  /** A rescued supply just stuck to the ball. */
  stick: { type: string; count: number };
  /** A boss shell or core broke and showered the route. */
  shower: { pieces: number };
  /** The player's ball was gummed by a glue glob. */
  gummed: { shineRemaining: number };
};

type Handler<K extends keyof TinkerSignals> = (payload: TinkerSignals[K]) => void;

type AnyHandler = (payload: TinkerSignals[keyof TinkerSignals]) => void;

const handlers = new Map<keyof TinkerSignals, Set<AnyHandler>>();

export function onSignal<K extends keyof TinkerSignals>(type: K, handler: Handler<K>) {
  let bucket = handlers.get(type);
  if (!bucket) {
    bucket = new Set();
    handlers.set(type, bucket);
  }
  const anyHandler = handler as AnyHandler;
  bucket.add(anyHandler);
  return () => {
    bucket?.delete(anyHandler);
  };
}

/** Drop every listener: called when the level runtime is torn down. */
export function resetSignals() {
  handlers.clear();
}

export function emitSignal<K extends keyof TinkerSignals>(type: K, payload: TinkerSignals[K]) {
  const bucket = handlers.get(type);
  if (!bucket) return;
  for (const handler of bucket) (handler as Handler<K>)(payload);
}
