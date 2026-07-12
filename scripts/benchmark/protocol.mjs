#!/usr/bin/env node

/**
 * Source-root contracts are selected by the recorded benchmark version. Do not
 * infer a contract from whichever directory happens to exist in a worktree.
 */
export const LEGACY_SOURCE_ROOT = 'src/levels';
export const DIRECTORY_SOURCE_ROOT = 'src/benchmark-levels';

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

export function sourceRootForVersion(version) {
  return protocolForVersion(version).sourceRoot;
}

export function isDirectoryOnlyVersion(version) {
  return protocolForVersion(version).directoryOnly;
}
