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
export const LEVEL_CONTENT_ROOT = 'public/level-content';
export const BUILT_IN_LEVEL_REGISTRY_PATH = 'src/levels/index.ts';

// The built-in registry imports these files even when no promoted benchmark
// level is present. The cut-baseline tool keeps this minimum discovery seam so
// the application still typechecks and builds with an empty benchmark catalog.
export const SCRUBBED_BENCHMARK_SCAFFOLD_PATHS = [
  `${BENCHMARK_SOURCE_ROOT}/index.ts`,
  `${BENCHMARK_SOURCE_ROOT}/catalog.ts`,
  `${BENCHMARK_SOURCE_ROOT}/types.ts`,
  `${BENCHMARK_SOURCE_ROOT}/validation.ts`,
];

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
        path: `${LEVEL_CONTENT_ROOT}/${levelId}`,
        promotedPath: `${LEVEL_CONTENT_ROOT}/${levelId}`,
        required: false,
      },
    ],
    // The gallery stays scope-permitted for benchmark entrants: v2 baselines ship a floor
    // gate that fails unless the entrant regenerates docs/level-gallery.md with its own
    // card, so forbidding the file here would make those baselines unsealable. Shared
    // derived paths gate scope only — payload and promotion iterate `roots`, so entrant
    // gallery edits still never reach the mainline gallery, which lists built-ins only.
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
        path: `${LEVEL_CONTENT_ROOT}/${levelId}`,
        promotedPath: `${LEVEL_CONTENT_ROOT}/${levelId}`,
        required: false,
      },
    ],
    sharedDerived: [LEVEL_GALLERY_PATH, BUILT_IN_LEVEL_REGISTRY_PATH],
  };
}
