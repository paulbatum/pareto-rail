import rawCatalog from './rank-catalog.json' with { type: 'json' };
import type { BenchmarkDataClass, BenchmarkRunMetrics, BenchmarkTheme } from './types';

/** A catalog theme carries one extra scheduling flag beyond the wire contract:
 * `unscheduled` themes stay in the gallery and keep counting past votes, but are
 * never drawn into new matchups. The flag is client-only; the vote API ignores it. */
export interface RankCatalogTheme extends BenchmarkTheme {
  unscheduled?: boolean;
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
  run?: BenchmarkRunMetrics;
  thumbnailPath?: string;
  featured?: boolean;
  retired?: boolean;
  dataClass?: BenchmarkDataClass;
}

export interface RankCatalogVersion {
  benchmarkVersion: string;
  generatedAt: string;
  themes: readonly RankCatalogTheme[];
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

export function allCatalogThemes(catalog: RankCatalog): readonly RankCatalogTheme[] {
  return catalog.versions.flatMap((version) => version.themes);
}

/** Synthetic version string for the merged scheduling pool. It is never
 * persisted or validated: `nextMatchup` resolves each served pair back to its
 * owning slice before recording, so this only fills the version shape the
 * scheduler consumes. */
export const SCHEDULING_POOL_VERSION = 'scheduling-pool';

/** The pool the scheduler draws matchups from: every non-`unscheduled` theme
 * across all catalog slices, merged into one pseudo-version with its entrants.
 * Theme ids are unique across slices today; a collision means two slices claim
 * the same theme, which would silently merge distinct entrant sets, so it throws. */
export function schedulingPool(catalog: RankCatalog): RankCatalogVersion {
  const themes: RankCatalogTheme[] = [];
  const entrants: RankCatalogEntrant[] = [];
  const seenThemeIds = new Set<string>();
  for (const version of catalog.versions) {
    for (const theme of version.themes) {
      if (theme.unscheduled) continue;
      if (seenThemeIds.has(theme.id)) {
        throw new Error(`Theme ${theme.id} appears in more than one scheduled catalog slice; the scheduling pool requires unique theme ids.`);
      }
      seenThemeIds.add(theme.id);
      themes.push(theme);
      for (const entrant of version.entrants) {
        if (entrant.themeId === theme.id) entrants.push(entrant);
      }
    }
  }
  return { benchmarkVersion: SCHEDULING_POOL_VERSION, generatedAt: catalog.generatedAt, themes, entrants };
}

export function findCatalogEntrant(catalog: RankCatalog, levelId: string): RankCatalogEntrant | undefined {
  return allCatalogEntrants(catalog).find((entrant) => entrant.levelId === levelId);
}

export function findCatalogTheme(catalog: RankCatalog, themeId: string): RankCatalogTheme | undefined {
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
