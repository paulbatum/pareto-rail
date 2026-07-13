import rawCatalog from './rank-catalog.json';
import type { BenchmarkTheme } from './types';

export interface RankCatalogEntrant {
  levelId: string;
  themeId: string;
  configurationId: string;
  modelName: string;
  workflowName: string;
  generationCost: number;
  thumbnailPath?: string;
  featured?: boolean;
}

export interface RankCatalog {
  generatedAt: string;
  themes: readonly BenchmarkTheme[];
  entrants: readonly RankCatalogEntrant[];
}

export const rankCatalog = rawCatalog as RankCatalog;
