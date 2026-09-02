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
  /** The slug of the model to draw the other side from, given by `&vs=<slug>`.
   * Without it, the other side is any model but the named one. Naming the same
   * model on both sides draws two of its own levels. */
  opponent?: string;
  catalog?: RankCatalog;
  /** Injected so a test can pin the draw; defaults to `Math.random`. */
  random?: () => number;
}

/**
 * A head-to-head for one model, drawn at random: a theme the model entered, one
 * of its levels there, and an opponent level in the same theme. Which side the
 * model's level takes is drawn too, so the pair the page serves does not tell
 * the visitor which side to expect. Returns null when no theme holds two levels
 * the slugs allow, which is also what an unknown slug gives.
 *
 * The draw is over the whole catalog rather than the scheduling pool, so retired
 * and experimental entrants are eligible too — the same breadth the `/match`
 * picker offers. Both sides come from one theme, so the vote the match produces
 * is recorded like any other.
 */
export function matchupForModel(slug: string, options: ModelMatchupOptions): { a: string; b: string } | null {
  const catalog = options.catalog ?? rankCatalog;
  const playable = options.playable;
  const random = options.random ?? Math.random;
  const opponentSlug = options.opponent;

  const entrants = catalog.entrants.filter((entrant) => playable.has(entrant.levelId));
  const isModel = (entrant: RankCatalogEntrant) => modelSlug(entrant.modelName) === slug;
  const isOpponent = (entrant: RankCatalogEntrant) => (opponentSlug === undefined
    ? !isModel(entrant)
    : modelSlug(entrant.modelName) === opponentSlug);

  // A theme qualifies when it holds two different levels, one each side of the
  // draw. Both slugs naming one model makes those tests overlap, so the pair of
  // levels is what is checked rather than the count on either side.
  const themeIds = [...new Set(entrants.filter(isModel).map((entrant) => entrant.themeId))]
    .filter((themeId) => entrants.some((mine) => mine.themeId === themeId && isModel(mine)
      && entrants.some((theirs) => theirs.themeId === themeId && isOpponent(theirs) && theirs.levelId !== mine.levelId)))
    .sort();
  const themeId = pick(themeIds, random);
  if (themeId === null) return null;

  const inTheme = entrants.filter((entrant) => entrant.themeId === themeId);
  const mineCandidates = inTheme.filter((entrant) => isModel(entrant)
    && inTheme.some((theirs) => isOpponent(theirs) && theirs.levelId !== entrant.levelId));
  const mine = pick(mineCandidates.map((entrant) => entrant.levelId).sort(), random);
  if (mine === null) return null;
  const theirs = pick(inTheme.filter((entrant) => isOpponent(entrant) && entrant.levelId !== mine).map((entrant) => entrant.levelId).sort(), random);
  if (theirs === null) return null;
  return random() < 0.5 ? { a: mine, b: theirs } : { a: theirs, b: mine };
}

function pick<T>(items: readonly T[], random: () => number): T | null {
  return items.length === 0 ? null : items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}
