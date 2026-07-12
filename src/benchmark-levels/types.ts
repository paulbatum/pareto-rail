import type { LevelDefinition } from '../engine/types';

/** Metadata shipped with a generated benchmark level. */
export interface BenchmarkLevelDescriptor {
  id: string;
  title: string;
  aliases?: string[];
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
