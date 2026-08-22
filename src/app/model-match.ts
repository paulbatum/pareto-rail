import { rankCatalog, type RankCatalog, type RankCatalogEntrant } from '../benchmark/catalog';

/** The slug a model is addressed by in `/match?model=<slug>`: its catalog name
 * lowercased, with every run of other characters folded to one hyphen. */
export function modelSlug(modelName: string): string {
  return modelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export interface ModelMatchupOptions {
  /** Level ids whose module is present, so the pair is playable. The caller
   * supplies it: this module stays clear of the level registry, which only a
   * bundler can resolve. */
  playable: ReadonlySet<string>;
  catalog?: RankCatalog;
  /** Injected so a test can pin the draw; defaults to `Math.random`. */
  random?: () => number;
}

/**
 * A head-to-head for one model, drawn at random: a theme the model entered, one
 * of its levels there, and an opponent level built by a different model in the
 * same theme. Which side the model's level takes is drawn too, so the pair the
 * page serves does not tell the visitor which side to expect. Returns null when
 * no theme holds both the model and another model, which is also what an unknown
 * slug gives.
 *
 * The draw is over the whole catalog rather than the scheduling pool: a custom
 * match is casual and records nothing, so retired and experimental entrants are
 * eligible too — the same breadth the `/match` picker offers.
 */
export function matchupForModel(slug: string, options: ModelMatchupOptions): { a: string; b: string } | null {
  const catalog = options.catalog ?? rankCatalog;
  const playable = options.playable;
  const random = options.random ?? Math.random;

  const entrants = catalog.entrants.filter((entrant) => playable.has(entrant.levelId));
  const isModel = (entrant: RankCatalogEntrant) => modelSlug(entrant.modelName) === slug;
  const themeIds = [...new Set(entrants.filter(isModel).map((entrant) => entrant.themeId))]
    .filter((themeId) => entrants.some((entrant) => entrant.themeId === themeId && !isModel(entrant)))
    .sort();
  const themeId = pick(themeIds, random);
  if (themeId === null) return null;

  const inTheme = entrants.filter((entrant) => entrant.themeId === themeId);
  const mine = pick(inTheme.filter(isModel).map((entrant) => entrant.levelId).sort(), random);
  const theirs = pick(inTheme.filter((entrant) => !isModel(entrant)).map((entrant) => entrant.levelId).sort(), random);
  if (mine === null || theirs === null) return null;
  return random() < 0.5 ? { a: mine, b: theirs } : { a: theirs, b: mine };
}

function pick<T>(items: readonly T[], random: () => number): T | null {
  return items.length === 0 ? null : items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}
