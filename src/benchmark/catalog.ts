import rawCatalog from './rank-catalog.json' with { type: 'json' };
import type { BenchmarkDataClass, BenchmarkRunMetrics, BenchmarkTheme } from './types';

/** A catalog theme carries one extra scheduling flag beyond the wire contract:
 * a `retired` theme stays in the gallery and keeps counting past votes, but is
 * never drawn into new matchups. The flag is client-only; the vote API ignores it. */
export interface RankCatalogTheme extends BenchmarkTheme {
  retired?: boolean;
}

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
  /** Non-blank lines of authored TypeScript in the level's promoted source tree.
   * A deterministic size proxy derived from committed source (not measured during
   * the run), recomputed on every catalog export. Absent for module-less retired
   * entrants whose source is no longer on disk. */
  linesOfCode?: number;
  run?: BenchmarkRunMetrics;
  thumbnailPath?: string;
  featured?: boolean;
  /** A retired entrant stays in the catalog as history but is never scheduled. */
  retired?: boolean;
  dataClass?: BenchmarkDataClass;
  /** Provenance copied from the run manifest: the entrant baseline the level was
   * generated on, and the materials commit it was handed. */
  entrantBaseline?: string;
  materialsCommit?: string;
}

export interface RankCatalog {
  generatedAt: string;
  configurations?: readonly RankCatalogConfiguration[];
  themes: readonly RankCatalogTheme[];
  entrants: readonly RankCatalogEntrant[];
}

/** The themes and entrants the scheduler draws matchups from. Derived, never
 * persisted: the pair the scheduler serves is recorded by level ids alone. */
export interface SchedulingPool {
  themes: readonly RankCatalogTheme[];
  entrants: readonly RankCatalogEntrant[];
}

export function allCatalogEntrants(catalog: RankCatalog): readonly RankCatalogEntrant[] {
  return catalog.entrants;
}

export function allCatalogThemes(catalog: RankCatalog): readonly RankCatalogTheme[] {
  return catalog.themes;
}

/** The pool the scheduler draws matchups from: every non-retired entrant of
 * every non-retired theme. Retired themes and retired entrants stay in the
 * catalog (gallery, past votes) but never enter a new matchup. */
export function schedulingPool(catalog: RankCatalog): SchedulingPool {
  const themes = catalog.themes.filter((theme) => !theme.retired);
  const scheduledThemeIds = new Set(themes.map((theme) => theme.id));
  const entrants = catalog.entrants.filter((entrant) => !entrant.retired && scheduledThemeIds.has(entrant.themeId));
  return { themes, entrants };
}

export function findCatalogEntrant(catalog: RankCatalog, levelId: string): RankCatalogEntrant | undefined {
  return catalog.entrants.find((entrant) => entrant.levelId === levelId);
}

export function findCatalogTheme(catalog: RankCatalog, themeId: string): RankCatalogTheme | undefined {
  return catalog.themes.find((theme) => theme.id === themeId);
}

export function catalogLevelIds(catalog: RankCatalog): ReadonlySet<string> {
  return new Set(catalog.entrants.map((entrant) => entrant.levelId));
}

export function catalogThemeIds(catalog: RankCatalog): ReadonlySet<string> {
  return new Set(catalog.themes.map((theme) => theme.id));
}

export const rankCatalog = rawCatalog as RankCatalog;
