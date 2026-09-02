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

/** One model as the picker addresses it, counted over playable entrants only. */
export interface ModelPickerEntry {
  slug: string;
  /** Every catalog name that folds to this slug, joined for display. One name in
   * every case the published catalog has produced so far. */
  modelName: string;
  levelCount: number;
  themeCount: number;
}

/**
 * The themes a draw for these slugs can use: those holding a level by `slug` and
 * a different level the opponent rule allows. Both slugs naming one model makes
 * the two tests overlap, so this checks for a pair of distinct levels rather
 * than a count on either side. An empty result means the link cannot be built.
 */
export function matchableThemeIds(slug: string, options: ModelMatchupOptions): string[] {
  const catalog = options.catalog ?? rankCatalog;
  const entrants = catalog.entrants.filter((entrant) => options.playable.has(entrant.levelId));
  const isModel = (entrant: RankCatalogEntrant) => modelSlug(entrant.modelName) === slug;
  const isOpponent = opponentTest(slug, options.opponent);
  return [...new Set(entrants.filter(isModel).map((entrant) => entrant.themeId))]
    .filter((themeId) => entrants.some((mine) => mine.themeId === themeId && isModel(mine)
      && entrants.some((theirs) => theirs.themeId === themeId && isOpponent(theirs) && theirs.levelId !== mine.levelId)))
    .sort();
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
  const random = options.random ?? Math.random;
  const entrants = catalog.entrants.filter((entrant) => options.playable.has(entrant.levelId));
  const isModel = (entrant: RankCatalogEntrant) => modelSlug(entrant.modelName) === slug;
  const isOpponent = opponentTest(slug, options.opponent);

  const themeId = pick(matchableThemeIds(slug, options), random);
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

/** Every model with a playable level, for the model builder to list. */
export function modelPickerEntries(playable: ReadonlySet<string>, catalog: RankCatalog = rankCatalog): ModelPickerEntry[] {
  const bySlug = new Map<string, { names: Set<string>; levels: Set<string>; themes: Set<string> }>();
  for (const entrant of catalog.entrants) {
    if (!playable.has(entrant.levelId)) continue;
    const slug = modelSlug(entrant.modelName);
    const entry = bySlug.get(slug) ?? { names: new Set<string>(), levels: new Set<string>(), themes: new Set<string>() };
    entry.names.add(entrant.modelName);
    entry.levels.add(entrant.levelId);
    entry.themes.add(entrant.themeId);
    bySlug.set(slug, entry);
  }
  return [...bySlug.entries()]
    .map(([slug, entry]): ModelPickerEntry => ({
      slug,
      modelName: [...entry.names].sort().join(' / '),
      levelCount: entry.levels.size,
      themeCount: entry.themes.size,
    }))
    .sort((left, right) => left.modelName.localeCompare(right.modelName));
}

function opponentTest(slug: string, opponent: string | undefined): (entrant: RankCatalogEntrant) => boolean {
  if (opponent === undefined) return (entrant) => modelSlug(entrant.modelName) !== slug;
  return (entrant) => modelSlug(entrant.modelName) === opponent;
}

function pick<T>(items: readonly T[], random: () => number): T | null {
  return items.length === 0 ? null : items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}
