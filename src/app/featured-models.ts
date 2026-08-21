import featuredModelsDoc from './featured-models.md?raw';

export interface FeaturedModel {
  name: string;
  isNew: boolean;
  href?: string;
}

/** Reads the bullet list out of `featured-models.md`. The format is deliberately
 * minimal — one model per bullet, an optional trailing `(new)`, and a name that
 * may be written as a markdown link — so the file stays readable as prose.
 * `benchmark:export-rank-catalog` reconciles the same file against the published
 * catalog and strips the same decorations to recover each name. */
export function parseFeaturedModels(source: string): FeaturedModel[] {
  return source.split('\n')
    .map((line) => /^-\s+(.*\S)\s*$/.exec(line.trim())?.[1])
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => {
      const isNew = /\(new\)$/i.test(entry);
      const label = entry.replace(/\s*\(new\)$/i, '');
      const link = /^\[(.+)\]\((\S+)\)$/.exec(label);
      return link ? { name: link[1], isNew, href: link[2] } : { name: label, isNew };
    });
}

export const featuredModels: readonly FeaturedModel[] = parseFeaturedModels(featuredModelsDoc);
