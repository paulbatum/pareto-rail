import type { LevelDefinition } from '../engine/types';

/**
 * Content-sheet image URLs a benchmark level may ship. Declared locally because
 * this series-1 substrate predates src/levels/content-images.ts; the shape
 * matches the built-in module the mainline scaffold imports from.
 */
export interface LevelContentImages {
  /** Four-run-moment contact sheet. */
  overview: string;
  /** Attract screen before the run begins. */
  start: string;
  /** A single frame that best represents the level. */
  hero: string;
}

/** Metadata shipped with a generated benchmark level. */
export interface BenchmarkLevelDescriptor {
  id: string;
  title: string;
  aliases?: string[];
  contentImages?: LevelContentImages;
}

export type BenchmarkLevelModule = Record<string, unknown>;
export type BenchmarkLevelLoader = () => Promise<BenchmarkLevelModule>;

export interface LevelIdentity {
  id: string;
  aliases?: readonly string[];
}

export interface BenchmarkLevelCatalogEntry extends BenchmarkLevelDescriptor {
  readonly domain: 'benchmark';
  readonly directoryName: string;
  readonly load: () => Promise<LevelDefinition>;
}

export type BenchmarkDescriptorAssets = Readonly<Record<string, unknown>>;
export type BenchmarkModuleAssets = Readonly<Record<string, BenchmarkLevelLoader>>;
