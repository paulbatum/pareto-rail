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
  dataClass?: BenchmarkDataClass;
}

export interface RankCatalog {
  generatedAt: string;
  configurations?: readonly RankCatalogConfiguration[];
  themes: readonly BenchmarkTheme[];
  entrants: readonly RankCatalogEntrant[];
}

export const rankCatalog = rawCatalog as RankCatalog;
