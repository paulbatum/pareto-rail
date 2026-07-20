import rawCatalog from './rank-catalog.json' with { type: 'json' };
import type { BenchmarkDataClass, BenchmarkRunMetrics, BenchmarkTheme } from './types';

export interface RankCatalogConfiguration {
  id: string;
  modelName: string;
  workflowName: string;
  primaryModel: string;
  effort: string;
  workflowSummary: string;
  delegateModel?: string;
  delegateEffort?: string;
  delegationGuidance?: string;
  featured?: boolean;
}

export interface RankCatalogEntrant {
  levelId: string;
  themeId: string;
  configurationId: string;
  modelName: string;
  workflowName: string;
  generationCost: number;
  run?: BenchmarkRunMetrics;
  thumbnailPath?: string;
  featured?: boolean;
  retired?: boolean;
  dataClass?: BenchmarkDataClass;
}

export interface RankCatalogVersion {
  benchmarkVersion: string;
  generatedAt: string;
  themes: readonly BenchmarkTheme[];
  entrants: readonly RankCatalogEntrant[];
}

export interface RankCatalog {
  generatedAt: string;
  activeBenchmarkVersion: string;
  configurations?: readonly RankCatalogConfiguration[];
  versions: readonly RankCatalogVersion[];
}

export function activeCatalogVersion(catalog: RankCatalog): RankCatalogVersion | undefined {
  return catalog.versions.find((version) => version.benchmarkVersion === catalog.activeBenchmarkVersion);
}

export function catalogVersion(catalog: RankCatalog, benchmarkVersion: string): RankCatalogVersion | undefined {
  return catalog.versions.find((version) => version.benchmarkVersion === benchmarkVersion);
}

export function allCatalogEntrants(catalog: RankCatalog): readonly RankCatalogEntrant[] {
  return catalog.versions.flatMap((version) => version.entrants);
}

export function allCatalogThemes(catalog: RankCatalog): readonly BenchmarkTheme[] {
  return catalog.versions.flatMap((version) => version.themes);
}

export function findCatalogEntrant(catalog: RankCatalog, levelId: string): RankCatalogEntrant | undefined {
  return allCatalogEntrants(catalog).find((entrant) => entrant.levelId === levelId);
}

export function findCatalogTheme(catalog: RankCatalog, themeId: string): BenchmarkTheme | undefined {
  return allCatalogThemes(catalog).find((theme) => theme.id === themeId);
}

export function findCatalogVersionForLevels(catalog: RankCatalog, levelIdA: string, levelIdB: string): RankCatalogVersion | undefined {
  return catalog.versions.find((version) => {
    const levelIds = new Set(version.entrants.map((entrant) => entrant.levelId));
    return levelIds.has(levelIdA) && levelIds.has(levelIdB);
  });
}

export function catalogLevelIds(catalog: RankCatalog): ReadonlySet<string> {
  return new Set(allCatalogEntrants(catalog).map((entrant) => entrant.levelId));
}

export function catalogThemeIds(catalog: RankCatalog): ReadonlySet<string> {
  return new Set(allCatalogThemes(catalog).map((theme) => theme.id));
}

export const rankCatalog = rawCatalog as RankCatalog;
