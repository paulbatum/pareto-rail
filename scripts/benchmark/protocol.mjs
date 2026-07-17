#!/usr/bin/env node

/**
 * Source-root contracts are selected by the recorded benchmark version. Do not
 * infer a contract from whichever directory happens to exist in a worktree.
 */
export const LEGACY_SOURCE_ROOT = 'src/levels';
export const DIRECTORY_SOURCE_ROOT = 'src/benchmark-levels';
export const LEVEL_GALLERY_PATH = 'docs/level-gallery.md';
export const LEGACY_LEVEL_REGISTRY_PATH = 'src/levels/index.ts';

export function protocolForVersion(version) {
  if (version === 'v1' || version === 'rehearsal') {
    return {
      benchmarkVersion: version,
      sourceRoot: LEGACY_SOURCE_ROOT,
      directoryOnly: false,
      promotionRequired: true,
    };
  }
  if (/^v[2-9][0-9]*$/.test(version ?? '')) {
    return {
      benchmarkVersion: version,
      sourceRoot: DIRECTORY_SOURCE_ROOT,
      directoryOnly: true,
      promotionRequired: false,
    };
  }
  throw new Error(`Unsupported benchmark protocol version: ${version}`);
}

/**
 * The per-id roots and controller-mediated shared files owned by one level.
 * Per-id roots are disjoint across level ids, allowing independently generated
 * outputs to integrate without touching shared engine code.
 */
export function levelFootprint(levelId, version) {
  const protocol = protocolForVersion(version);
  return {
    roots: [
      {
        id: 'source',
        path: `${protocol.sourceRoot}/${levelId}`,
        promotedPath: `${DIRECTORY_SOURCE_ROOT}/${levelId}`,
        required: true,
      },
      {
        id: 'content',
        path: `public/level-content/${levelId}`,
        promotedPath: `public/level-content/${levelId}`,
        required: false,
      },
    ],
    sharedDerived: [
      LEVEL_GALLERY_PATH,
      ...(protocol.directoryOnly ? [] : [LEGACY_LEVEL_REGISTRY_PATH]),
    ],
  };
}

export function sourceRootForVersion(version) {
  return protocolForVersion(version).sourceRoot;
}

export function isDirectoryOnlyVersion(version) {
  return protocolForVersion(version).directoryOnly;
}
