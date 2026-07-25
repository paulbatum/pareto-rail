#!/usr/bin/env node
import { BENCHMARK_SOURCE_ROOT } from '../level-footprint.mjs';

/**
 * The controller's scrub policy: what a scrubbed entrant baseline may not carry.
 * The level footprints live in scripts/level-footprint.mjs, outside this directory,
 * because the scrub removes everything here while the entrant's scope check — which
 * needs the same path model — stays behind.
 */

// The built-in registry imports these files even when no promoted benchmark
// level is present. The cut-baseline tool keeps this minimum discovery seam so
// the application still typechecks and builds with an empty benchmark catalog.
export const SCRUBBED_BENCHMARK_SCAFFOLD_PATHS = [
  `${BENCHMARK_SOURCE_ROOT}/index.ts`,
  `${BENCHMARK_SOURCE_ROOT}/catalog.ts`,
  `${BENCHMARK_SOURCE_ROOT}/types.ts`,
  `${BENCHMARK_SOURCE_ROOT}/validation.ts`,
];

// The controller's own harness and the corpus-enumerating suites. An entrant needs
// none of it — `scaffold`, `check:scope`, and `check:floor` all live outside these
// paths — while leaving it in place hands an entrant other entrants' level ids, and
// in the case of the contamination detector, exactly what the audit looks for.
export const SCRUBBED_REMOVED_PATHS = [
  'scripts/benchmark',
  'src/benchmark/domain.test.ts',
];
