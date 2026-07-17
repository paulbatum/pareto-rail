#!/usr/bin/env node

/**
 * The two level footprints the repository recognizes. A footprint is the set of
 * per-id roots and controller-mediated shared files owned by one level. Per-id
 * roots are disjoint across level ids, so independently generated outputs
 * integrate without touching shared engine code.
 */
export const BUILT_IN_SOURCE_ROOT = 'src/levels';
export const BENCHMARK_SOURCE_ROOT = 'src/benchmark-levels';
export const LEVEL_GALLERY_PATH = 'docs/level-gallery.md';
export const BUILT_IN_LEVEL_REGISTRY_PATH = 'src/levels/index.ts';

/**
 * Benchmark levels: entrant-authored directories under src/benchmark-levels/<id>,
 * auto-discovered by Vite, each carrying its own level.json descriptor. This is the
 * only footprint the controller pipeline (seal/gates/payload/promotion) uses.
 */
export function benchmarkLevelFootprint(levelId) {
  return {
    roots: [
      {
        id: 'source',
        path: `${BENCHMARK_SOURCE_ROOT}/${levelId}`,
        promotedPath: `${BENCHMARK_SOURCE_ROOT}/${levelId}`,
        required: true,
      },
      {
        id: 'content',
        path: `public/level-content/${levelId}`,
        promotedPath: `public/level-content/${levelId}`,
        required: false,
      },
    ],
    sharedDerived: [LEVEL_GALLERY_PATH],
  };
}

/**
 * Built-in levels: hand-registered directories under src/levels/<id>, with the
 * registry index as shared-derived. Used only by the level-authoring scope check.
 */
export function builtInLevelFootprint(levelId) {
  return {
    roots: [
      {
        id: 'source',
        path: `${BUILT_IN_SOURCE_ROOT}/${levelId}`,
        promotedPath: `${BUILT_IN_SOURCE_ROOT}/${levelId}`,
        required: true,
      },
      {
        id: 'content',
        path: `public/level-content/${levelId}`,
        promotedPath: `public/level-content/${levelId}`,
        required: false,
      },
    ],
    sharedDerived: [LEVEL_GALLERY_PATH, BUILT_IN_LEVEL_REGISTRY_PATH],
  };
}
