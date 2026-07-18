import type { BufferGeometry } from 'three';

// Enemies, letters, shots, and lock clamps are built dozens of times per run,
// but every instance of a kind is the same shape — only its materials differ,
// because the tint pass mutates them per enemy. Sharing geometry by key keeps
// the GPU resource count flat across a run instead of climbing with the
// spawn timeline.

const cache = new Map<string, BufferGeometry>();

export function cachedGeometry<T extends BufferGeometry>(key: string, make: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing as T;
  const created = make();
  cache.set(key, created);
  return created;
}
