import featuredModelsDoc from './featured-models.md?raw';

export interface FeaturedModel {
  name: string;
  isNew: boolean;
  href?: string;
  note?: string;
}

/** A model the home page does not name, whether it was removed or never shown.
 * Its line stays in the file so the export can tell a deliberate omission from
 * copy that still needs writing. This is site copy only: it does not affect
 * matchups, which is what `retired` means on a theme or entrant. */
export interface UnlistedFeaturedModel {
  name: string;
}

/** Reads the bullet list out of `featured-models.md`. The format is deliberately
 * minimal — one model per bullet, optional trailing `(new)` or `(unlisted)`, a name
 * that may be written as a markdown link, and an optional note after an em dash —
 * so the file stays readable as prose. `benchmark:export-rank-catalog` parses the
 * same file with the same rules to reconcile it against the published catalog;
 * change one and change the other. */
export function parseFeaturedModels(source: string): (FeaturedModel & { isUnlisted: boolean })[] {
  return source.split('\n')
    .map((line) => /^-\s+(.*\S)\s*$/.exec(line.trim())?.[1])
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => {
      const isNew = /\(new\)$/i.test(entry);
      const isUnlisted = /\(unlisted\)$/i.test(entry);
      const labelled = entry.replace(/\s*\((?:new|unlisted)\)$/i, '');
      const noted = /^(.*?)\s+—\s+(.*\S)$/.exec(labelled);
      const subject = noted ? noted[1] : labelled;
      const link = /^\[(.+)\]\((\S+)\)$/.exec(subject);
      return {
        name: link ? link[1] : subject,
        isNew,
        isUnlisted,
        ...(link ? { href: link[2] } : {}),
        ...(noted ? { note: noted[2] } : {}),
      };
    });
}

/** The models the home page names, in file order. An unlisted model is dropped here
 * and kept in the file, which is what separates it from a model whose line nobody
 * has written yet. */
export const featuredModels: readonly FeaturedModel[] = parseFeaturedModels(featuredModelsDoc).filter((model) => !model.isUnlisted);
