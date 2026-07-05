import type { LockOnSpawnEntry } from './lock-on-runner';

export type SpawnTimeline<TKind extends string, TData> = Array<LockOnSpawnEntry<TKind, TData>>;

/** Stamp one entry per offset; entry i lands at `time + i * stagger`. */
export function formation<TKind extends string, TData>(
  time: number,
  stagger: number,
  offsets: ReadonlyArray<readonly [number, number]>,
  make: (offset: readonly [number, number], index: number) => Omit<LockOnSpawnEntry<TKind, TData>, 'time'>,
): SpawnTimeline<TKind, TData> {
  return offsets.map((offset, index) => ({
    time: time + index * stagger,
    ...make(offset, index),
  }));
}

/** Place fragment groups at a shared start time (acts, boss phases): copies each entry with `start + entry.time`. */
export function section<TKind extends string, TData>(
  start: number,
  ...groups: Array<SpawnTimeline<TKind, TData>>
): SpawnTimeline<TKind, TData> {
  return groups.flatMap((group) => group.map((entry) => ({ ...entry, time: start + entry.time })));
}

/** Copy and stable-sort by time — the final step every level currently repeats inline. */
export function sortTimeline<TKind extends string, TData>(
  entries: SpawnTimeline<TKind, TData>,
): SpawnTimeline<TKind, TData> {
  return [...entries].sort((a, b) => a.time - b.time);
}
