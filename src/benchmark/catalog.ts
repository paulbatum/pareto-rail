import rawCatalog from './rank-catalog.json' with { type: 'json' };
import type { BenchmarkDataClass, BenchmarkRunMetrics, BenchmarkTheme } from './types';

/** A catalog theme carries two client-only scheduling flags beyond the wire
 * contract, both of which keep a theme out of new matchups while leaving it in
 * the gallery. A `retired` theme is finished history that still counts its past
 * votes; an `experimental` theme is a new arrival being shown off before it is
 * admitted to ranking. Neither flag is seen by the vote API. */
export interface RankCatalogTheme extends BenchmarkTheme {
  retired?: boolean;
  experimental?: boolean;
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
  /** The run's measured generation cost. Absent when the run could not be priced — a model
   * published without a price leaves token counts and no dollar figure. An entrant without a
   * cost is never scheduled, because cost is one of the two axes a matchup is voted on. */
  generationCost?: number;
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

/** A catalog entrant whose run carries a cost. The scheduler serves only these, so
 * everything derived from a matchup — reveals, curve points — can read the cost directly. */
export type PricedCatalogEntrant = RankCatalogEntrant & { generationCost: number };

export function pricedEntrants(entrants: readonly RankCatalogEntrant[]): readonly PricedCatalogEntrant[] {
  return entrants.filter((entrant): entrant is PricedCatalogEntrant => entrant.generationCost !== undefined);
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
  entrants: readonly PricedCatalogEntrant[];
  configurations?: readonly RankCatalogConfiguration[];
}

export function allCatalogEntrants(catalog: RankCatalog): readonly RankCatalogEntrant[] {
  return catalog.entrants;
}

export function allCatalogThemes(catalog: RankCatalog): readonly RankCatalogTheme[] {
  return catalog.themes;
}

/** The pool the scheduler draws matchups from: every non-retired, priced entrant
 * of every rankable theme. Retired and experimental themes, retired entrants, and
 * entrants whose run carries no cost stay in the catalog (gallery, past votes)
 * but never enter a new matchup. */
export function schedulingPool(catalog: RankCatalog): SchedulingPool {
  const themes = catalog.themes.filter((theme) => !theme.retired && !theme.experimental);
  const scheduledThemeIds = new Set(themes.map((theme) => theme.id));
  const entrants = pricedEntrants(catalog.entrants).filter((entrant) => !entrant.retired && scheduledThemeIds.has(entrant.themeId));
  return { themes, entrants, configurations: catalog.configurations };
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
